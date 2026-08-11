/**
 * RQ32-U4 — settle the hard-exclusion mystery against the RUNNING engine.
 *
 * The contradiction (Recovery §5.1 + our own config): `allow_hard_exclusions:
 * true` sits in infra/valhalla/valhalla.json AND data/valhalla/valhalla.json,
 * yet R25-U2 measured `exclude_highways: true` as byte-identical to a bogus
 * control key. One of these is wrong: the running container's config, the old
 * probe, or our reading of 3.7.0. This probe asks the ENGINE, with the
 * `warnings` array we now capture (R32-U4) instead of discard.
 *
 * Three arms per control pair, RAW requests (bypassing realizeCostingOptions,
 * which deliberately rewrites exclude_highways into use_highways:0 — here we
 * test the ENGINE lever, not our translation):
 *   A. no exclusion            (baseline)
 *   B. exclude_highways: true  (the hard lever under test)
 *   C. use_highways: 0         (the soft lever we ship today)
 *
 * Pairs:
 *   1. highway-OPTIONAL: Mississauga → Brampton (403/407/410 fastest, but
 *      arterials exist) — B must remove highway or warn; silence+identical = broken.
 *   2. highway-ONLY-ish: two points best joined by the 410 corridor.
 *
 * Verdict rules (Recovery §5.1): a hard exclusion must change the route, or
 * error, or WARN. It must never be silently identical.
 *
 * Run: TSX_TSCONFIG_PATH=backend/tsconfig.json npx tsx eval/experiments/rq32_hard_exclusions.ts
 */
const VALHALLA = process.env['VALHALLA_URL'] ?? 'http://127.0.0.1:8002';

interface Arm {
  label: string;
  costing: Record<string, unknown>;
}

async function rawRoute(
  waypoints: Array<[number, number]>,
  costing: Record<string, unknown>,
): Promise<{
  km: number;
  min: number;
  hasHighway: boolean | null;
  shapeHash: string;
  warnings: string[];
}> {
  const res = await fetch(`${VALHALLA}/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      locations: waypoints.map(([lng, lat]) => ({ lat, lon: lng, type: 'break' })),
      costing: 'auto',
      costing_options: { auto: costing },
    }),
  });
  const body = (await res.json()) as {
    trip?: {
      summary?: { length?: number; time?: number; has_highway?: boolean };
      legs?: Array<{ shape?: string }>;
    };
    warnings?: Array<{ text?: string; message?: string; code?: number }>;
    error?: string;
  };
  if (!res.ok || !body.trip) {
    return {
      km: -1,
      min: -1,
      hasHighway: null,
      shapeHash: `ERROR:${body.error ?? res.status}`,
      warnings: (body.warnings ?? []).map((w) => w.text ?? w.message ?? `code ${w.code}`),
    };
  }
  const shape = (body.trip.legs ?? []).map((l) => l.shape ?? '').join('|');
  let h = 0;
  for (let i = 0; i < shape.length; i++) h = (h * 31 + shape.charCodeAt(i)) | 0;
  return {
    km: +(body.trip.summary?.length ?? 0).toFixed(1),
    min: Math.round((body.trip.summary?.time ?? 0) / 60),
    hasHighway: body.trip.summary?.has_highway ?? null,
    shapeHash: (h >>> 0).toString(16),
    warnings: (body.warnings ?? []).map((w) => w.text ?? w.message ?? `code ${w.code}`),
  };
}

async function main(): Promise<void> {
  const PAIRS: Array<{ name: string; wps: Array<[number, number]> }> = [
    // Mississauga City Centre → downtown Brampton: 403→410 fastest; Hurontario/arterials exist
    {
      name: 'hwy-OPTIONAL Mississauga→Brampton',
      wps: [
        [-79.6441, 43.589],
        [-79.7599, 43.689],
      ],
    },
    // Square One → Bramalea (410 corridor heart)
    {
      name: 'hwy-CORRIDOR SquareOne→Bramalea',
      wps: [
        [-79.6441, 43.589],
        [-79.697, 43.717],
      ],
    },
    // rural control where no highway is near (should be identical in all arms)
    {
      name: 'rural-CONTROL Erin→Belfountain',
      wps: [
        [-80.0714, 43.7736],
        [-80.0088, 43.7935],
      ],
    },
  ];
  const ARMS: Arm[] = [
    { label: 'A none', costing: {} },
    { label: 'B exclude_highways', costing: { exclude_highways: true } },
    { label: 'C use_highways:0', costing: { use_highways: 0 } },
  ];

  for (const pair of PAIRS) {
    console.log(`\n=== ${pair.name} ===`);
    const results: Record<string, Awaited<ReturnType<typeof rawRoute>>> = {};
    for (const arm of ARMS) {
      const r = await rawRoute(pair.wps, arm.costing);
      results[arm.label] = r;
      console.log(
        `  ${arm.label.padEnd(20)} ${String(r.km).padStart(6)} km ${String(r.min).padStart(4)} min ` +
          `hwy=${String(r.hasHighway).padEnd(5)} shape=${r.shapeHash}` +
          (r.warnings.length > 0 ? `  WARNINGS: ${r.warnings.join(' | ')}` : ''),
      );
    }
    const a = results['A none']!;
    const b = results['B exclude_highways']!;
    const identical = a.shapeHash === b.shapeHash;
    const warned = b.warnings.length > 0;
    console.log(
      `  VERDICT: exclude_highways ${
        identical
          ? warned
            ? 'IGNORED WITH WARNING (config/engine refuses hard exclusion)'
            : a.hasHighway === false
              ? 'identical — but baseline has no highway (inconclusive here)'
              : 'SILENTLY IGNORED — the R25-U2 no-op is REAL and unexplained by warnings'
          : 'CHANGED THE ROUTE — the hard lever WORKS on this instance'
      }`,
    );
  }
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
