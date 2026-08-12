/** RQ37e — dump the ACTUAL ranked candidate list for the 2h ask at home
 *  (replicates driveFirstTrip's retrieval + fit + rank, read-only).
 *  Run: DRIVE_CORES_VERSION=r35-rib npx tsx eval/experiments/rq37_2h_candidates.ts */
import { Client } from 'pg';

// retrieval identical to driveFirstTrip: readDriveCores from discover_cores
import { DRIVE_CORES_VERSION, readDriveCores } from '../../backend/src/planner/discover_cores';
import { RING_ARC_MIN_FRAC, TRIP_REACH_FRAC } from '../../backend/src/planner/drive_first_trip';

const HOME = { lat: 43.7565, lng: -79.8335 };
const TARGET_S = 7200;
const COMMUTE_DETOUR_FACTOR = 1.3;
const COMMUTE_SPEED_MPS = 55_000 / 3600;
const TRIP_DURATION_TOL = Number(process.env['TRIP_DURATION_TOL'] ?? 0.25);

const hav = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
  const R = 6_371_008.8;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

async function main(): Promise<void> {
  const db = new Client({
    connectionString: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  });
  await db.connect();
  const reachM = Math.max(12_000, TARGET_S * TRIP_REACH_FRAC * COMMUTE_SPEED_MPS);
  const half = reachM / 111_320;
  const rows = await readDriveCores(
    db,
    [HOME.lng - half, HOME.lat - half, HOME.lng + half, HOME.lat + half],
    DRIVE_CORES_VERSION,
    50,
    'loop',
  );
  console.log(
    `retrieved ${rows.length} rows (reach ${(reachM / 1000).toFixed(0)} km, version ${DRIVE_CORES_VERSION})`,
  );
  const nearestRingM = (r: (typeof rows)[number]): number => {
    let best = Infinity;
    for (const p of r.geom_simplified.coordinates as Array<[number, number]>) {
      const d = hav(HOME, { lat: p[1], lng: p[0] });
      if (d < best) best = d;
    }
    return best;
  };
  const commutePredS = (r: (typeof rows)[number]): number =>
    (2 * nearestRingM(r) * COMMUTE_DETOUR_FACTOR) / COMMUTE_SPEED_MPS;
  const fit = (r: (typeof rows)[number]): number => {
    const lo = r.duration_s * RING_ARC_MIN_FRAC + commutePredS(r);
    const hi = r.duration_s + commutePredS(r);
    if (TARGET_S < lo) return (lo - TARGET_S) / TARGET_S;
    if (TARGET_S > hi) return (TARGET_S - hi) / TARGET_S;
    return 0;
  };
  const list = rows
    .map((r) => ({ r, f: fit(r), near: nearestRingM(r) }))
    .sort((a, b) => a.f - b.f)
    .slice(0, 20);
  for (const x of list) {
    const passes = x.f <= TRIP_DURATION_TOL + 0.1 ? ' ' : 'X';
    console.log(
      `${passes} fit ${x.f.toFixed(3)} band ${Math.floor(x.f * 10)} · ${Math.round(x.r.duration_s / 60)}min · near ${(x.near / 1000).toFixed(1)}km · curv ${x.r.curviness.toFixed(2)} · ${x.r.id.slice(0, 60)}`,
    );
  }
  await db.end();
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
