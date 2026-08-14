/**
 * Spot-photo endpoints (M10-T05; FR-035/036/310-312; spec §56; SPK-18).
 *
 * The ONLY write path for images. Raw bytes come here (never to Storage
 * directly — the bucket has no app-role policies), get validated by magic
 * bytes, EXIF-stripped + re-encoded, and only the PROCESSED artifacts are
 * uploaded and recorded. The original buffer dies with the request. If any
 * pipeline step fails the upload is rejected — an unprocessed image is
 * never retrievable (Hard rule E, fail closed).
 *
 * All routes require auth (photos are owner-scoped in MVP, matching the
 * 0028 RLS): POST processes+stores, GET lists with fresh signed URLs,
 * DELETE removes the row then its blobs.
 *
 * This module also owns the two CASCADING deletes (M10-T07): DELETE
 * /spots/:id and DELETE /account. Current Storage forbids SQL deletes of
 * storage.objects (protect_delete trigger — measured, see 0029), so ANY
 * path that removes photo rows must sweep the matching blobs via the
 * Storage API. Ordering is chosen per path so a crash never strands data the
 * user could not clean up: photo/spot deletes drop rows first (an orphan blob
 * is unreachable — no row can sign it), while ACCOUNT delete sweeps blobs
 * first, because losing the auth user is unretryable.
 */

import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { requireAuth } from '../auth/jwt';
import { ImageRejectedError, MAX_IMAGE_BYTES, processImage } from '../images/process';
import {
  removeByPrefix,
  removeObject,
  signObjectUrl,
  StorageError,
  uploadObject,
  type StorageConfig,
} from '../images/storage';
import { AppError, errorBody } from '../lib/errors';
import type { RateLimiter } from '../lib/rate_limit';

export const PHOTO_URL_TTL_S = 7 * 24 * 3600;
export const MAX_PHOTOS_PER_SPOT = 6;
/** Raw-body ceiling: the image cap plus protocol slack. */
export const PHOTO_BODY_LIMIT = MAX_IMAGE_BYTES + 64 * 1024;

const IMAGE_CONTENT_TYPES = ['application/octet-stream', 'image/jpeg', 'image/png', 'image/webp'];

interface DbLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface PhotosEndpointDeps {
  db: DbLike;
  storage: StorageConfig;
  /** SPK-14 posture: Storage/egress have no hard cap (Hard rule F), so the
   *  write path needs a limiter like every other public surface. */
  rateLimiter?: RateLimiter;
  /** DI for tests. */
  processFn?: typeof processImage;
  uploadFn?: typeof uploadObject;
  signFn?: typeof signObjectUrl;
  removeFn?: typeof removeObject;
  sweepFn?: typeof removeByPrefix;
  deleteAccountFn?: (supabaseUrl: string, userToken: string) => Promise<void>;
}

/**
 * DEV-ONLY host fix: a loopback Supabase URL is correct for THIS process but
 * meaningless on a phone (127.0.0.1 is the phone itself), so signed photo
 * URLs would render broken on a LAN device. Rewrite the host to whatever host
 * the client used to reach us — the same trick the app's own Supabase URL
 * resolution uses. A hosted deploy never matches the loopback branch, so its
 * URLs are returned untouched.
 */
export function reachableFrom(url: string, hostHeader: string | undefined): string {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) return url;
  const host = hostHeader?.split(':')[0];
  if (!host || host === '127.0.0.1' || host === 'localhost') return url;
  return url.replace(/^(https?:\/\/)(127\.0\.0\.1|localhost)/, `$1${host}`);
}

export function registerPhotosEndpoints(app: FastifyInstance, deps: PhotosEndpointDeps): void {
  /**
   * `onRequest`, not `preHandler`: Fastify parses the body between them, so a
   * preHandler check happily buffers an anonymous 10 MB upload before saying
   * 401. Auth (from registerAuth's earlier onRequest hook) and the rate limit
   * both belong before a single byte is read.
   */
  const guard = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await requireAuth(request);
    if (!deps.rateLimiter) return;
    const session = request.headers['x-session-id'];
    const decision = deps.rateLimiter.check(
      request.ip,
      typeof session === 'string' ? session : (request.user?.sub ?? null),
    );
    if (!decision.allowed) {
      await reply
        .status(429)
        .header('retry-after', String(decision.retryAfterS))
        .send(
          errorBody(
            'rate_limited',
            `Too many requests at once — try again in ${decision.retryAfterS}s.`,
            request.id,
          ),
        );
    }
  };

  const process = deps.processFn ?? processImage;
  const upload = deps.uploadFn ?? uploadObject;
  const sign = deps.signFn ?? signObjectUrl;
  const remove = deps.removeFn ?? removeObject;
  const sweep = deps.sweepFn ?? removeByPrefix;

  // Raw image bodies for these routes only; JSON routes are untouched.
  app.addContentTypeParser(
    IMAGE_CONTENT_TYPES,
    { parseAs: 'buffer', bodyLimit: PHOTO_BODY_LIMIT },
    (_req, body, done) => done(null, body),
  );

  app.post<{ Params: { id: string } }>(
    '/spots/:id/photos',
    {
      bodyLimit: PHOTO_BODY_LIMIT,
      onRequest: guard,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const sub = request.user!.sub;
      const spotId = request.params.id;
      if (!Buffer.isBuffer(request.body)) {
        throw new AppError(400, 'bad_upload', 'Send the image bytes as the request body.');
      }

      // Only the owner of a USER spot attaches photos (OSM seeds stay bare).
      const spot = await deps.db.query('select owner_id, source from spots where id = $1', [
        spotId,
      ]);
      const row = spot.rows[0];
      if (!row || row['owner_id'] !== sub || row['source'] !== 'user') {
        throw new AppError(404, 'not_found', 'That spot isn’t yours (or doesn’t exist).');
      }
      let processed;
      try {
        processed = await process(request.body);
      } catch (err) {
        if (err instanceof ImageRejectedError) {
          throw new AppError(err.statusCode, 'image_rejected', err.message);
        }
        throw err;
      }

      const photoId = randomUUID();
      const base = `${sub}/${spotId}/${photoId}`;
      const fullPath = `${base}.jpg`;
      const thumbPath = `${base}_thumb.jpg`;
      let uploaded = false;
      try {
        await upload(deps.storage, fullPath, processed.full, 'image/jpeg');
        await upload(deps.storage, thumbPath, processed.thumb, 'image/jpeg');
        uploaded = true;

        // The cap is enforced IN the insert: a count-then-insert lets N
        // concurrent uploads all read 0 and all write.
        const inserted = await deps.db.query(
          `insert into photos (id, owner_id, spot_id, storage_path, thumb_path)
           select $1, $2, $3, $4, $5
            where (select count(*) from photos where spot_id = $3) < $6
           returning id`,
          [photoId, sub, spotId, fullPath, thumbPath, MAX_PHOTOS_PER_SPOT],
        );
        if (inserted.rows.length === 0) {
          throw new AppError(
            400,
            'photo_limit',
            `A spot holds up to ${MAX_PHOTOS_PER_SPOT} photos.`,
          );
        }

        const host = request.headers.host;
        return reply.code(201).send({
          id: photoId,
          url: reachableFrom(await sign(deps.storage, fullPath, PHOTO_URL_TTL_S), host),
          thumb_url: reachableFrom(await sign(deps.storage, thumbPath, PHOTO_URL_TTL_S), host),
        });
      } catch (err) {
        // Nothing half-done survives: a blob with no row is unreachable dead
        // weight, so drop it before answering.
        if (uploaded || err instanceof StorageError) {
          await remove(deps.storage, fullPath).catch(() => undefined);
          await remove(deps.storage, thumbPath).catch(() => undefined);
        }
        if (err instanceof StorageError) {
          // M11-T07: storage down/unreachable = fail CLOSED with plain words
          throw new AppError(
            502,
            'storage_down',
            'Photos can’t be processed right now — try later.',
          );
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    '/spots/:id/photos',
    {
      onRequest: guard,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request) => {
      const sub = request.user!.sub;
      const rows = await deps.db.query(
        'select id, storage_path, thumb_path from photos where spot_id = $1 and owner_id = $2 order by created_at',
        [request.params.id, sub],
      );
      const host = request.headers.host;
      // allSettled: one unsignable row (a blob removed out from under us) must
      // not blank the whole strip — §18 degrades, never breaks.
      const settled = await Promise.allSettled(
        rows.rows.map(async (r) => ({
          id: r['id'] as string,
          url: reachableFrom(
            await sign(deps.storage, r['storage_path'] as string, PHOTO_URL_TTL_S),
            host,
          ),
          thumb_url: reachableFrom(
            await sign(deps.storage, r['thumb_path'] as string, PHOTO_URL_TTL_S),
            host,
          ),
        })),
      );
      return {
        photos: settled
          .filter(
            (r): r is PromiseFulfilledResult<{ id: string; url: string; thumb_url: string }> =>
              r.status === 'fulfilled',
          )
          .map((r) => r.value),
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/photos/:id',
    {
      onRequest: guard,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const sub = request.user!.sub;
      const gone = await deps.db.query(
        'delete from photos where id = $1 and owner_id = $2 returning storage_path, thumb_path',
        [request.params.id, sub],
      );
      const row = gone.rows[0];
      if (!row) throw new AppError(404, 'not_found', 'That photo isn’t yours (or is gone).');
      // Blobs must not outlive the row (Hard rule E: real deletion incl. blobs).
      await remove(deps.storage, row['storage_path'] as string);
      await remove(deps.storage, row['thumb_path'] as string);
      return reply.code(204).send();
    },
  );

  // M10-T07: spot deletion — rows cascade in SQL, blobs swept via the API.
  app.delete<{ Params: { id: string } }>(
    '/spots/:id',
    {
      onRequest: guard,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const sub = request.user!.sub;
      const gone = await deps.db.query(
        "delete from spots where id = $1 and owner_id = $2 and source = 'user' returning id",
        [request.params.id, sub],
      );
      if (gone.rows.length === 0) {
        throw new AppError(404, 'not_found', 'That spot isn’t yours (or is gone).');
      }
      // A prefix sweep instead of a path list read before the delete: it needs
      // no surviving rows, catches anything uploaded mid-request, and is safe
      // to repeat.
      await sweep(deps.storage, `${sub}/${request.params.id}/`);
      return reply.code(204).send();
    },
  );

  // M10-T07/FR-207: account deletion — blob sweep + the 0029 rows-only RPC.
  // The RPC runs AS THE CALLER (their bearer token through PostgREST), so
  // this endpoint can only ever delete the account presenting it.
  app.delete('/account', { onRequest: guard }, async (request, reply) => {
    const sub = request.user!.sub;
    // Blobs FIRST. Deleting the auth user is irreversible AND unretryable —
    // once it is gone the caller can never authenticate again, so a blob
    // failure afterwards strands those photos forever. Sweeping first means a
    // failure here leaves the account intact and the operation safe to retry.
    await sweep(deps.storage, `${sub}/`);
    const rpc = deps.deleteAccountFn ?? defaultDeleteAccount;
    await rpc(deps.storage.url, request.headers.authorization!.slice('Bearer '.length));
    return reply.code(204).send();
  });
}

/** Forward delete_account to PostgREST with the CALLER's token (never a
 *  service credential — the RPC's auth.uid() must be the user's own). */
async function defaultDeleteAccount(supabaseUrl: string, userToken: string): Promise<void> {
  const anonKey = process.env['SUPABASE_ANON_KEY'] ?? '';
  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/delete_account`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${userToken}`,
      'content-type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) {
    throw new AppError(502, 'delete_failed', 'Could not delete the account right now.');
  }
}
