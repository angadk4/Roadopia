/**
 * Request-dataset loader + leakage validator (M4-T01; Protocol §6.4/§6.5).
 *
 * `loadReqset` reads a versioned dataset directory (default: the newest
 * `reqset-vN` under eval/datasets) and zod-validates every file — malformed
 * fixtures throw at load, never propagate. `validateReqset` then enforces the
 * cross-file rules the schemas cannot see:
 *   ERRORS  — duplicate ids; unknown origin_id; the same (origin, normalized
 *             brief) in more than one split; identical brief phrasing across
 *             DEV/VAL/TEST (§6.4 disjoint-phrasings rule); manifest counts
 *             that disagree with the actual files; missing gold when
 *             `requireGold` (the M4-T02 completion contract).
 *   WARNINGS — split sizes below the §6.2 targets (expected until M4-T02);
 *             origin reuse across DEV/TEST ("disjoint where possible").
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  PinnedOriginSchema,
  RefExampleSchema,
  ReqsetManifestSchema,
  RequestExampleSchema,
  SPLIT_TARGETS,
  type PinnedOrigin,
  type RefExample,
  type Reqset,
  type RequestExample,
} from './schema';

/** eval/datasets — data lives outside src/ so vitest discovery stays clean. */
export const DATASETS_DIR = fileURLToPath(new URL('../../datasets', import.meta.url));

/** Newest reqset-vN directory under eval/datasets (highest N). */
export function latestReqsetVersion(baseDir: string = DATASETS_DIR): string {
  const versions = readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^reqset-v\d+$/.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => Number(a.slice(8)) - Number(b.slice(8)));
  const latest = versions[versions.length - 1];
  if (!latest) throw new Error(`no reqset-vN directory found under ${baseDir}`);
  return latest;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

export function loadReqset(version?: string, baseDir: string = DATASETS_DIR): Reqset {
  const v = version ?? latestReqsetVersion(baseDir);
  const dir = join(baseDir, v);
  const manifest = ReqsetManifestSchema.parse(readJson(join(dir, 'manifest.json')));
  const origins = z.array(PinnedOriginSchema).parse(readJson(join(baseDir, manifest.origins_file)));
  const single = (name: string): RequestExample[] =>
    z.array(RequestExampleSchema).parse(readJson(join(dir, `${name}.json`)));
  const ref: RefExample[] = z.array(RefExampleSchema).parse(readJson(join(dir, 'ref.json')));
  return {
    manifest,
    origins,
    dev: single('dev'),
    val: single('val'),
    test: single('test'),
    adv: single('adv'),
    ref,
    pfr: single('pfr'),
  };
}

export interface ReqsetValidation {
  errors: string[];
  warnings: string[];
}

/** Lowercase, collapse whitespace/punctuation — the phrasing-identity key. */
export function normalizeBrief(brief: string): string {
  return brief
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function validateReqset(
  reqset: Reqset,
  { requireGold = false }: { requireGold?: boolean } = {},
): ReqsetValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const originIds = new Set(reqset.origins.map((o) => o.id));

  const singles: Array<[string, RequestExample[]]> = [
    ['dev', reqset.dev],
    ['val', reqset.val],
    ['test', reqset.test],
    ['adv', reqset.adv],
    ['pfr', reqset.pfr],
  ];

  // unique ids everywhere
  const seenIds = new Set<string>();
  const allExamples: Array<{
    split: string;
    id: string;
    brief: string;
    origin: string | null;
    gold: unknown;
  }> = [
    ...singles.flatMap(([split, list]) =>
      list.map((e) => ({ split, id: e.id, brief: e.brief, origin: e.origin_id, gold: e.gold })),
    ),
    ...reqset.ref.map((e) => ({
      split: 'ref',
      id: e.id,
      brief: e.turns[0]!,
      origin: e.origin_id,
      gold: e.gold,
    })),
  ];
  for (const e of allExamples) {
    if (seenIds.has(e.id)) errors.push(`duplicate id: ${e.id}`);
    seenIds.add(e.id);
    if (e.split !== e.id.split('-')[0]) errors.push(`${e.id}: filed under split '${e.split}'`);
    if (e.origin !== null && !originIds.has(e.origin)) {
      errors.push(`${e.id}: unknown origin_id '${e.origin}'`);
    }
    if (requireGold && e.gold === null) errors.push(`${e.id}: gold label missing (requireGold)`);
  }

  // leakage: same (origin, normalized brief) in >1 split; identical phrasing across DEV/VAL/TEST
  const pairSeen = new Map<string, string>(); // key → "split:id"
  for (const e of allExamples) {
    const key = `${e.origin ?? '∅'}|${normalizeBrief(e.brief)}`;
    const prior = pairSeen.get(key);
    if (prior && !prior.startsWith(`${e.split}:`)) {
      errors.push(`leakage: (origin, brief) shared across splits — ${prior} vs ${e.split}:${e.id}`);
    }
    if (!prior) pairSeen.set(key, `${e.split}:${e.id}`);
  }
  const phrasing = new Map<string, string>();
  for (const [split, list] of singles) {
    if (split !== 'dev' && split !== 'val' && split !== 'test') continue;
    for (const e of list) {
      const key = normalizeBrief(e.brief);
      const prior = phrasing.get(key);
      if (prior && !prior.startsWith(`${split}:`)) {
        errors.push(
          `leakage: identical phrasing across DEV/VAL/TEST — ${prior} vs ${split}:${e.id}`,
        );
      }
      if (!prior) phrasing.set(key, `${split}:${e.id}`);
    }
  }

  // "disjoint origins where possible" (§6.4) — soft: warn on DEV∩TEST origin reuse
  const devOrigins = new Set(reqset.dev.map((e) => e.origin_id).filter(Boolean));
  for (const e of reqset.test) {
    if (e.origin_id && devOrigins.has(e.origin_id)) {
      warnings.push(
        `origin '${e.origin_id}' appears in both DEV and TEST (${e.id}) — §6.4 prefers disjoint`,
      );
    }
  }

  // manifest counts must match the files
  const actual = {
    dev: reqset.dev.length,
    val: reqset.val.length,
    test: reqset.test.length,
    adv: reqset.adv.length,
    ref: reqset.ref.length,
    pfr: reqset.pfr.length,
  };
  for (const [split, n] of Object.entries(actual) as Array<[keyof typeof actual, number]>) {
    if (reqset.manifest.counts[split] !== n) {
      errors.push(
        `manifest count mismatch for ${split}: manifest ${reqset.manifest.counts[split]}, actual ${n}`,
      );
    }
    const target = split === 'pfr' ? null : SPLIT_TARGETS[split];
    if (target && n < target.min) {
      warnings.push(`${split} below §6.2 target (${n} < ${target.min}) — fills at M4-T02`);
    }
  }

  // archetype coverage: every archetype must have ≥1 pinned origin (§5/§6.3)
  const archetypes = new Set(reqset.origins.map((o) => o.archetype));
  for (const a of [
    'dense_urban',
    'suburban_edge',
    'rural_twisty_rich',
    'sparse',
    'water_adjacent',
    'escarpment',
  ]) {
    if (!archetypes.has(a as PinnedOrigin['archetype'])) {
      errors.push(`no pinned origin for archetype '${a}'`);
    }
  }

  return { errors, warnings };
}
