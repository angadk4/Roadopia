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
 * Storage API. Rows go first, blobs second: a crash can orphan an
 * UNREACHABLE blob in the private bucket, never leave a reachable one.
 */

import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { requireAuth } from '../auth/jwt';
import { ImageRejectedError, MAX_IMAGE_BYTES, processImage } from '../images/process';
import {
  removeObject,
  signObjectUrl,
  StorageError,
  uploadObject,
  type StorageConfig,
} from '../images/storage';
import { AppError } from '../lib/errors';

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
  /** DI for tests. */
  processFn?: typeof processImage;
  uploadFn?: typeof uploadObject;
  signFn?: typeof signObjectUrl;
  removeFn?: typeof removeObject;
  deleteAccountFn?: (supabaseUrl: string, userToken: string) => Promise<void>;
}

export function registerPhotosEndpoints(app: FastifyInstance, deps: PhotosEndpointDeps): void {
  const process = deps.processFn ?? processImage;
  const upload = deps.uploadFn ?? uploadObject;
  const sign = deps.signFn ?? signObjectUrl;
  const remove = deps.removeFn ?? removeObject;

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
      preHandler: requireAuth,
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
      const count = await deps.db.query(
        'select count(*)::int as n from photos where spot_id = $1',
        [spotId],
      );
      if (((count.rows[0]?.['n'] as number) ?? 0) >= MAX_PHOTOS_PER_SPOT) {
        throw new AppError(400, 'photo_limit', `A spot holds up to ${MAX_PHOTOS_PER_SPOT} photos.`);
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
      try {
        await upload(deps.storage, fullPath, processed.full, 'image/jpeg');
        await upload(deps.storage, thumbPath, processed.thumb, 'image/jpeg');
      } catch (err) {
        if (err instanceof StorageError) {
          // M11-T07: storage down = fail CLOSED with plain words, never a raw 500
          throw new AppError(
            502,
            'storage_down',
            'Photos can’t be processed right now — try later.',
          );
        }
        throw err;
      }
      await deps.db.query(
        'insert into photos (id, owner_id, spot_id, storage_path, thumb_path) values ($1, $2, $3, $4, $5)',
        [photoId, sub, spotId, fullPath, thumbPath],
      );

      return reply.code(201).send({
        id: photoId,
        url: await sign(deps.storage, fullPath, PHOTO_URL_TTL_S),
        thumb_url: await sign(deps.storage, thumbPath, PHOTO_URL_TTL_S),
      });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/spots/:id/photos',
    {
      preHandler: requireAuth,
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
      return {
        photos: await Promise.all(
          rows.rows.map(async (r) => ({
            id: r['id'] as string,
            url: await sign(deps.storage, r['storage_path'] as string, PHOTO_URL_TTL_S),
            thumb_url: await sign(deps.storage, r['thumb_path'] as string, PHOTO_URL_TTL_S),
          })),
        ),
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/photos/:id',
    {
      preHandler: requireAuth,
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
      preHandler: requireAuth,
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
      const paths = await deps.db.query(
        `select p.storage_path, p.thumb_path from photos p
          join spots s on s.id = p.spot_id
         where s.id = $1 and s.owner_id = $2`,
        [request.params.id, sub],
      );
      const gone = await deps.db.query(
        "delete from spots where id = $1 and owner_id = $2 and source = 'user' returning id",
        [request.params.id, sub],
      );
      if (gone.rows.length === 0) {
        throw new AppError(404, 'not_found', 'That spot isn’t yours (or is gone).');
      }
      for (const r of paths.rows) {
        await remove(deps.storage, r['storage_path'] as string);
        await remove(deps.storage, r['thumb_path'] as string);
      }
      return reply.code(204).send();
    },
  );

  // M10-T07/FR-207: account deletion — blob sweep + the 0029 rows-only RPC.
  // The RPC runs AS THE CALLER (their bearer token through PostgREST), so
  // this endpoint can only ever delete the account presenting it.
  app.delete('/account', { preHandler: requireAuth }, async (request, reply) => {
    const sub = request.user!.sub;
    const paths = await deps.db.query(
      'select storage_path, thumb_path from photos where owner_id = $1',
      [sub],
    );
    const rpc = deps.deleteAccountFn ?? defaultDeleteAccount;
    await rpc(deps.storage.url, request.headers.authorization!.slice('Bearer '.length));
    for (const r of paths.rows) {
      await remove(deps.storage, r['storage_path'] as string);
      await remove(deps.storage, r['thumb_path'] as string);
    }
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
