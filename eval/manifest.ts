/**
 * R32-U0 — the baseline manifest (Recovery §4.1).
 *
 * Every evaluation artifact records the FULL identity of what produced it, so
 * a routing-engine upgrade, tileset rebuild, config edit, or planner change
 * can never silently contaminate a comparison again. (The BD-119 disaster —
 * adopting a lever on an eval blind to the wall budget — and the BD-154
 * false no-op both trace to under-specified experiment identity.)
 *
 * Usage: `const manifest = await buildManifest({ suite: 'gold-loops-v1' })`,
 * embed in the artifact JSON and print in the run header.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { DRIVE_CORES_VERSION } from '../backend/src/planner/discover_cores';
import { WALL_CLOCK_BUDGET_MS } from '../backend/src/planner/run';

export interface BaselineManifest {
  /** git describe --always --dirty (READ-ONLY git — Hard rule G untouched). */
  gitDescribe: string;
  /** Valhalla /status: version + tileset_last_modified (the tileset id). */
  valhallaVersion: string;
  valhallaTilesetLastModified: number | null;
  /** sha256 of the checked-in server config (first 16 hex chars). */
  valhallaConfigHash: string;
  valhallaUrl: string;
  driveCoresVersion: string;
  wallClockBudgetMs: number;
  /** Which frozen suite produced the numbers (Recovery §4.2/4.3). */
  suite: string;
  /** Env overrides that change planner behavior, captured verbatim. */
  envOverrides: Record<string, string>;
  generatedAt: string;
}

/** Planner-behavior env vars worth freezing into every artifact. */
const TRACKED_ENV = [
  'DRIVE_FIRST',
  'ATOB_DRIVE_FIRST',
  'HARD_EXCLUSIONS',
  'DRIVE_CORES_VERSION',
  'TRIP_DURATION_TOL',
  'TRIP_BUILD_MAX',
  'RING_ARC_MIN_FRAC',
  'ARC_FIDELITY_MIN',
  'RIBBON_CHAINS',
  'CONNECTOR_TOPSPEED',
  'COUNTRY_VALUE',
  'AUDIT_SEED',
  // sweep knobs (R36: the r35 sidecar was missing these — a run's own
  // generator config must be readable from its artifact, BD-167 bars depend on it)
  'SWEEP_LAYERED',
  'GENERATOR_VERSION',
  'LOOP_CORE_DURATIONS_S',
  'LOOP_ORIGINS_PER_CELL',
  'LOOP_CANDIDATES_PER_ORIGIN',
  'RIBBONS_PER_CELL',
  'CELL_KEEP_MAX',
  'CELLS',
];

export async function buildManifest(opts: { suite: string }): Promise<BaselineManifest> {
  let gitDescribe = 'unknown';
  try {
    gitDescribe = execFileSync('git', ['describe', '--always', '--dirty'], {
      encoding: 'utf8',
    }).trim();
  } catch {
    /* not a git checkout (CI tarball) — recorded as unknown, never fatal */
  }

  let valhallaVersion = 'unreachable';
  let tileset: number | null = null;
  const valhallaUrl = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';
  try {
    const res = await fetch(`${valhallaUrl}/status`);
    const body = (await res.json()) as { version?: string; tileset_last_modified?: number };
    valhallaVersion = body.version ?? 'unknown';
    tileset = body.tileset_last_modified ?? null;
  } catch {
    /* engine down — recorded honestly; the run itself will fail loudly */
  }

  let configHash = 'missing';
  try {
    configHash = createHash('sha256')
      .update(readFileSync('infra/valhalla/valhalla.json'))
      .digest('hex')
      .slice(0, 16);
  } catch {
    /* config not present at this cwd — recorded as missing */
  }

  const envOverrides: Record<string, string> = {};
  for (const k of TRACKED_ENV) {
    const v = process.env[k];
    if (v !== undefined) envOverrides[k] = v;
  }

  return {
    gitDescribe,
    valhallaVersion,
    valhallaTilesetLastModified: tileset,
    valhallaConfigHash: configHash,
    valhallaUrl,
    driveCoresVersion: DRIVE_CORES_VERSION,
    wallClockBudgetMs: WALL_CLOCK_BUDGET_MS,
    suite: opts.suite,
    envOverrides,
    generatedAt: new Date().toISOString(),
  };
}

/** One-line header for run logs. */
export function manifestLine(m: BaselineManifest): string {
  return (
    `manifest: git ${m.gitDescribe} · valhalla ${m.valhallaVersion} ` +
    `(tiles ${m.valhallaTilesetLastModified ?? '?'}, cfg ${m.valhallaConfigHash}) · ` +
    `cores ${m.driveCoresVersion} · wall ${m.wallClockBudgetMs} ms · suite ${m.suite}` +
    (Object.keys(m.envOverrides).length > 0
      ? ` · env ${Object.entries(m.envOverrides)
          .map(([k, v]) => `${k}=${v}`)
          .join(',')}`
      : '')
  );
}
