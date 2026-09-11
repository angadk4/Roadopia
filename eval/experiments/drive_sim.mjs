// Scripted drives through followStatus — the owner's "does it recognise the
// turns once I take them?" question, answered without a car.
//
// Sources: every route the owner has saved (PostgREST, owner token, the app's
// normalizeRouteRow) and, optionally, one live /plan loop (--plan).
// For each route: a noisy 1 Hz drive along the line; an off-route excursion
// and rejoin; a GPS jump; a sit-still at the origin. Reports what the screen
// would have shown and flags anything a driver would notice.
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const OWNER = 'bed59e27-bbcf-45a0-b2ce-11105e24fa91';
const b64url = (b) => Buffer.from(b).toString('base64url');
const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const p = b64url(
  JSON.stringify({
    sub: OWNER,
    aud: 'authenticated',
    iss: 'http://127.0.0.1:54321/auth/v1',
    role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 600,
  }),
);
const token = `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;

const follow = await import(pathToFileURL(path.resolve('app/src/lib/follow.ts')).href);
const { normalizeRouteRow } = await import(
  pathToFileURL(path.resolve('app/src/lib/library.ts')).href
);
const { RouteSchema } = await import(pathToFileURL(path.resolve('shared/src/types/route.ts')).href);

// deterministic noise
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
const LAT_M = 111_320;
const jitter = (pt, sigmaM) => ({
  lat: pt.lat + (rand() * sigmaM) / LAT_M,
  lng: pt.lng + (rand() * sigmaM) / (LAT_M * Math.cos((pt.lat * Math.PI) / 180)),
});
const offset = (pt, northM, eastM) => ({
  lat: pt.lat + northM / LAT_M,
  lng: pt.lng + eastM / (LAT_M * Math.cos((pt.lat * Math.PI) / 180)),
});

async function ownerRoutes() {
  const res = await fetch(
    `http://127.0.0.1:54321/rest/v1/routes?owner_id=eq.${OWNER}&select=*&order=created_at.desc`,
    { headers: { apikey: ANON, authorization: `Bearer ${token}` } },
  );
  const rows = await res.json();
  const out = [];
  for (const row of rows) {
    const parsed = RouteSchema.safeParse(normalizeRouteRow(row));
    if (!parsed.success) {
      console.log('SKIP unparseable', row.id, parsed.error.issues[0]);
      continue;
    }
    out.push({
      label: `${parsed.data.name ?? '?'} [${parsed.data.origin_type}] ${row.id.slice(0, 8)}`,
      route: parsed.data,
    });
  }
  return out;
}

async function plannedLoop() {
  const res = await fetch('http://127.0.0.1:8080/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': 'drive-sim' },
    body: JSON.stringify({
      brief: '',
      origin: { lat: 43.5312, lng: -79.8827 },
      shape: 'loop',
      preset: 'backroads',
      duration_target_s: 3600,
    }),
  });
  const text = await res.text();
  let route = null;
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find((l) => l.startsWith('data: '));
    if (!line) continue;
    try {
      const ev = JSON.parse(line.slice(6));
      if (ev.type === 'route') route = ev.route;
    } catch {}
  }
  if (!route) {
    console.log('PLAN: no route event; status', res.status, text.slice(0, 300));
    return [];
  }
  return [{ label: `planned loop (${(route.distance_m / 1000).toFixed(1)} km)`, route }];
}

/** Heading (° from north) of travel from a to b. */
function headingOf(a, b) {
  const lngM = LAT_M * Math.cos((a.lat * Math.PI) / 180);
  const dx = (b.lng - a.lng) * lngM;
  const dy = (b.lat - a.lat) * LAT_M;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

/** Drive the whole line at ~14 m/s (1 Hz), σ 4 m noise, with the car's course
 *  (as the phone reports it) handed to followStatus like the screen does. */
function driveAlong(track, { stepM = 14, sigma = 4, from = 0, to = null, lastAlong = null } = {}) {
  const end = to ?? track.totalM;
  const log = [];
  let last = lastAlong;
  let minAlong = lastAlong;
  let d = from;
  while (d <= end) {
    const here = follow.pointAtDistance(track, d);
    const ahead = follow.pointAtDistance(track, Math.min(track.totalM, d + 5));
    const fix = jitter(here, sigma);
    const t0 = process.hrtime.bigint();
    const st = follow.followStatus(track, fix, last, {
      course: { headingDeg: headingOf(here, ahead), speedMps: 14 },
      minAlongM: minAlong,
    });
    const us = Number(process.hrtime.bigint() - t0) / 1000;
    log.push({ d, st, us });
    if (!st.offRoute) {
      last = st.alongM;
      minAlong = minAlong === null ? st.alongM : Math.min(minAlong, st.alongM);
    }
    d += stepM;
  }
  return { log, last };
}

function report(label, track, route) {
  const anchors = track.anchors;
  console.log(`\n=== ${label}`);
  console.log(
    `  line ${(track.totalM / 1000).toFixed(1)} km, ${track.points.length} pts, loop=${route.is_loop}, engine ${(route.distance_m / 1000).toFixed(1)} km, maneuvers=${route.maneuvers?.length ?? 'null'} → anchors=${anchors.length}`,
  );
  if (anchors.length === 0) {
    console.log('  (no guidance — legacy/no maneuvers; position-only)');
  }

  // --- A: straight drive
  const A = driveAlong(track);
  const problems = [];
  let backJumps = 0;
  let maxBack = 0;
  let offRoute = 0;
  let doneAt = null;
  let earlyDone = null;
  let stuck = 0;
  let maxUs = 0;
  let sumUs = 0;
  let prevAlong = -1;
  const hintsSeen = new Set();
  const hintFirstSeenAtM = new Map();
  for (const { d, st, us } of A.log) {
    maxUs = Math.max(maxUs, us);
    sumUs += us;
    if (st.offRoute) offRoute++;
    if (prevAlong >= 0 && st.alongM < prevAlong - 5) {
      backJumps++;
      maxBack = Math.max(maxBack, prevAlong - st.alongM);
    }
    // progress should track true distance within noise
    if (Math.abs(st.alongM - d) > 60 && !st.offRoute) stuck++;
    if (st.hint) {
      const key = `${st.hint.instruction}@${Math.round(st.hint.inM + st.alongM)}`;
      if (!hintsSeen.has(key)) {
        hintsSeen.add(key);
        hintFirstSeenAtM.set(key, d);
      }
      // a hint whose distance is negative means we are past the turn but still told to take it
      if (st.hint.inM < -20)
        problems.push(
          `hint still shown ${Math.round(-st.hint.inM)} m PAST the turn at d=${Math.round(d)}: "${st.hint.instruction}"`,
        );
      void st.hint.instruction; // (was a debug hint tracker)
    }
    if (st.done && doneAt === null) doneAt = d;
    if (st.done && d < track.totalM * 0.7 && earlyDone === null) earlyDone = d;
    prevAlong = st.alongM;
  }
  // which anchors were ever announced?
  const announced = anchors.filter((a) =>
    [...hintFirstSeenAtM.keys()].some(
      (k) => k.startsWith(a.instruction + '@') && Math.abs(Number(k.split('@')[1]) - a.atM) < 15,
    ),
  );
  const missed = anchors.filter((a) => !announced.includes(a));
  console.log(
    `  A straight drive: fixes=${A.log.length}, offRoute=${offRoute}, backJumps(>5m)=${backJumps} (max ${Math.round(maxBack)} m), drift>60m=${stuck}, done@${doneAt === null ? 'NEVER' : Math.round(doneAt) + ' m of ' + Math.round(track.totalM)}, perFix avg ${(sumUs / A.log.length).toFixed(0)} µs max ${maxUs.toFixed(0)} µs`,
  );
  console.log(
    `  turns announced ${announced.length}/${anchors.length}${
      missed.length
        ? ' — MISSED: ' +
          missed
            .slice(0, 5)
            .map((m) => `"${m.instruction}"@${Math.round(m.atM)}`)
            .join('; ')
        : ''
    }`,
  );
  if (earlyDone !== null) problems.push(`done declared EARLY at ${Math.round(earlyDone)} m`);
  if (doneAt === null) problems.push('done NEVER declared at the end of the line');
  // hint advance: after passing each anchor by 40 m, the shown hint must not be that anchor
  for (const a of anchors) {
    const after = A.log.find((e) => e.d >= a.atM + 40 && e.d < a.atM + 200);
    if (
      after &&
      after.st.hint &&
      after.st.hint.instruction === a.instruction &&
      Math.abs(after.st.hint.inM + after.st.alongM - a.atM) < 15
    ) {
      problems.push(
        `hint did not advance after passing "${a.instruction}" at ${Math.round(a.atM)} m`,
      );
    }
  }
  // first-sight distance: how far before each turn is it first shown (should be the previous turn's spot, or route start)
  const lateFirst = anchors.filter((a, i) => {
    const prevAt = i === 0 ? 0 : anchors[i - 1].atM;
    const seen = [...hintFirstSeenAtM.entries()].find(
      ([k]) => k.startsWith(a.instruction + '@') && Math.abs(Number(k.split('@')[1]) - a.atM) < 15,
    );
    if (!seen) return false;
    // expected to be first seen right after the previous anchor (or at start)
    return seen[1] > prevAt + 60 && a.atM - seen[1] < 150;
  });
  if (lateFirst.length)
    problems.push(
      `${lateFirst.length} turns first shown < 150 m before them: ` +
        lateFirst
          .slice(0, 3)
          .map((a) => `"${a.instruction}"@${Math.round(a.atM)}`)
          .join('; '),
    );

  // --- B: off-route excursion at 40%, 250 m east for 30 fixes, then rejoin 400 m further
  const b0 = track.totalM * 0.4;
  const B1 = driveAlong(track, { to: b0 });
  const base = follow.pointAtDistance(track, b0);
  let last = B1.last;
  let offCount = 0;
  let remainingDuringOff = new Set();
  let hintDuringOff = 0;
  for (let i = 0; i < 30; i++) {
    const fix = jitter(offset(base, 0, 250), 4);
    const st = follow.followStatus(track, fix, last);
    if (st.offRoute) offCount++;
    if (st.hint) hintDuringOff++;
    remainingDuringOff.add(Math.round(st.remainingM / 10));
    last = st.alongM;
  }
  const B2 = driveAlong(track, { from: b0 + 400, to: b0 + 1200, lastAlong: last });
  const rejoinFixes = B2.log.findIndex((e) => !e.st.offRoute);
  const rejoinAlong = B2.log[Math.max(0, rejoinFixes)]?.st.alongM;
  console.log(
    `  B excursion@40%: offRoute ${offCount}/30, remaining held to ${remainingDuringOff.size} value(s), hints while off ${hintDuringOff}, rejoin recognised after ${rejoinFixes} fix(es) at along ${Math.round(rejoinAlong ?? -1)} (true ${Math.round(b0 + 400)})`,
  );
  if (offCount < 28) problems.push(`excursion 250 m east flagged off-route only ${offCount}/30`);
  if (hintDuringOff > 0) problems.push(`turn hints shown while off-route (${hintDuringOff})`);
  if (remainingDuringOff.size > 1) problems.push('remaining distance swung while off-route');
  if (rejoinFixes !== 0 || Math.abs((rejoinAlong ?? 0) - (b0 + 400)) > 80)
    problems.push(
      `rejoin: first on-route fix #${rejoinFixes}, along ${Math.round(rejoinAlong ?? -1)} vs true ${Math.round(b0 + 400)}`,
    );

  // --- C: GPS jump — drive to 20%, then a fix at 60% (tunnel/reacquire), then continue from 60%
  const c0 = track.totalM * 0.2;
  const C1 = driveAlong(track, { to: c0 });
  const jumpTo = track.totalM * 0.6;
  const jumpFix = jitter(follow.pointAtDistance(track, jumpTo), 4);
  const stJump = follow.followStatus(track, jumpFix, C1.last);
  const C2 = driveAlong(track, { from: jumpTo + 14, to: jumpTo + 700, lastAlong: stJump.alongM });
  const recovered = C2.log.filter((e) => Math.abs(e.st.alongM - e.d) < 60).length;
  console.log(
    `  C jump 20%→60%: jump fix along ${Math.round(stJump.alongM)} (true ${Math.round(jumpTo)}) offRoute=${stJump.offRoute}; then ${recovered}/${C2.log.length} fixes track truth`,
  );
  if (Math.abs(stJump.alongM - jumpTo) > 80 && !stJump.offRoute)
    problems.push(
      `GPS jump resolved to ${Math.round(stJump.alongM)} instead of ${Math.round(jumpTo)}`,
    );
  if (recovered < C2.log.length - 2)
    problems.push(`after the jump only ${recovered}/${C2.log.length} fixes tracked truth`);

  // --- D: sit at the origin for 40 fixes (loop: start == end)
  let lastD = null;
  const origin = track.points[0];
  let maxAlongAtOrigin = 0;
  let doneAtOrigin = false;
  for (let i = 0; i < 40; i++) {
    const st = follow.followStatus(track, jitter(origin, 6), lastD);
    maxAlongAtOrigin = Math.max(maxAlongAtOrigin, st.alongM);
    if (st.done) doneAtOrigin = true;
    lastD = st.alongM;
  }
  console.log(
    `  D sitting at origin: max along ${Math.round(maxAlongAtOrigin)} m, done=${doneAtOrigin}`,
  );
  if (maxAlongAtOrigin > 100)
    problems.push(`sitting at the origin drifted to ${Math.round(maxAlongAtOrigin)} m along`);
  if (doneAtOrigin) problems.push('done declared while sitting at the origin');

  // --- E: the first hint shown at the very first fix
  const first = A.log[0]?.st;
  console.log(
    `  E first fix: hint=${first?.hint ? `"${first.hint.instruction}" in ${Math.round(first.hint.inM)} m` : 'none'}, then=${first?.then ? `"${first.then.instruction}"` : 'none'}`,
  );

  if (problems.length) {
    console.log('  PROBLEMS:');
    for (const pr of problems) console.log('   - ' + pr);
  } else {
    console.log('  no problems');
  }
  return problems.length;
}

/** The screen's legacy path: /match the decimated line, anchor by position. */
async function legacyAnchors(route) {
  const trace = follow.decimateForMatch(route.geometry);
  const t0 = Date.now();
  const res = await fetch('http://127.0.0.1:8080/match', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-id': 'drive-sim' },
    body: JSON.stringify({ trace }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) {
    console.log(
      `  legacy /match FAILED ${res.status} in ${ms} ms:`,
      (await res.text()).slice(0, 200),
    );
    return null;
  }
  const matched = await res.json();
  const track = follow.buildFollowTrack(route.geometry, []);
  const derived = follow.anchorsFromMatched(track, matched.geometry, matched.maneuvers);
  const usable = follow.derivedGuidanceUsable(derived);
  console.log(
    `  legacy /match: ${ms} ms, trace ${trace.length} pts → matched ${(matched.distance_m / 1000).toFixed(1)} km, ${matched.maneuvers.length} maneuvers; kept ${derived.kept}/${derived.total} → ${usable ? 'READY' : 'UNAVAILABLE'}`,
  );
  return usable ? derived.anchors : null;
}

const sources = [
  ...(await ownerRoutes()),
  ...(process.argv.includes('--plan') ? await plannedLoop() : []),
];
let total = 0;
for (const { label, route } of sources) {
  let track = follow.buildFollowTrack(route.geometry, route.maneuvers ?? []);
  if (
    (route.maneuvers === null || route.maneuvers === undefined) &&
    process.argv.includes('--legacy')
  ) {
    console.log(`\n--- legacy derive for ${label}`);
    const anchors = await legacyAnchors(route);
    if (anchors) track = { ...track, anchors };
  }
  total += report(label, track, route);
}
console.log(`\n${sources.length} routes, ${total} problem(s)`);
