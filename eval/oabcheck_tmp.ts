import { routeThrough } from '../backend/src/valhalla/route';
import { outAndBack } from '../eval/audit_v13';
const V = 'http://127.0.0.1:8002';
async function main(): Promise<void> {
  const A: [number, number] = [-79.9089, 44.0378]; // Hockley
  const B: [number, number] = [-80.0943, 43.9199]; // Orangeville
  // 1. plain A->B: should have ~zero doubling
  const plain = await routeThrough(V, { waypoints: [A, B], costingOptions: {} });
  const p = outAndBack(plain.geometry);
  console.log(
    `plain A->B      : ${(plain.distance_m / 1000).toFixed(1)}km  OAB total=${p.totalM}m longest=${p.longestM}m  (expect ~0)`,
  );
  // 2. deliberate out-and-back A->B->A: should double nearly everything
  const oab = await routeThrough(V, { waypoints: [A, B, A], costingOptions: {} });
  const o = outAndBack(oab.geometry);
  console.log(
    `A->B->A         : ${(oab.distance_m / 1000).toFixed(1)}km  OAB total=${o.totalM}m longest=${o.longestM}m  (expect ~half the distance)`,
  );
  console.log(
    `  => doubled fraction ${((o.totalM / oab.distance_m) * 100).toFixed(0)}%  (expect ~50%)`,
  );
}
void main();
