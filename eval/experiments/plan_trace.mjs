// Full pipeline trace for one plan: every step's detail, so we can see exactly
// which cores/candidates were tried and why each was rejected.
//   node plan_trace.mjs <lat> <lng> <minutes> [preset]
const [lat, lng, minutes, preset = 'backroads'] = process.argv.slice(2);
const HOST = process.env['PLAN_HOST'] ?? '127.0.0.1'; // any local backend interface
const res = await fetch(`http://${HOST}:8080/plan`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-session-id': `trace-${Date.now()}` },
  body: JSON.stringify({
    brief: '',
    origin: { lat: Number(lat), lng: Number(lng) },
    shape: 'loop',
    preset,
    duration_target_s: Number(minutes) * 60,
  }),
});
const text = await res.text();
for (const block of text.split('\n\n')) {
  const line = block.split('\n').find((l) => l.startsWith('data: '));
  if (!line) continue;
  let e;
  try {
    e = JSON.parse(line.slice(6));
  } catch {
    continue;
  }
  if (e.type === 'step') {
    if (e.status === 'completed') console.log(`STEP ${e.step}: ${e.detail ?? ''}`);
  } else if (e.type === 'route') {
    console.log(
      `ROUTE ${(e.route.distance_m / 1000).toFixed(1)} km ${Math.round(e.route.duration_s / 60)} min curv ${e.route.curviness} art ${e.route.arterial_share} urban ${e.route.urban_share} tags ${e.route.character_tags}`,
    );
  } else if (e.type === 'alternate') {
    console.log(
      `ALT ${(e.route.distance_m / 1000).toFixed(1)} km ${Math.round(e.route.duration_s / 60)} min`,
    );
  } else if (e.type === 'done') console.log(`DONE ${e.status}`);
  else if (e.type === 'error') console.log(`ERROR ${e.message}`);
  else if (e.type === 'explanation')
    console.log(`EXPLAIN ${JSON.stringify(e.explanation).slice(0, 300)}`);
}
