/**
 * M7-T04 device-free live verification: drive the app's REAL /plan transport
 * (src/lib/plan_stream.ts + sse.ts + the shared GenerationEventSchema) against
 * a RUNNING backend + Valhalla over real HTTP. Node's fetch is injected — the
 * same structural streaming interface as expo/fetch (the on-device transport;
 * SPK-03 confirms that half on hardware).
 *
 * Run (backend on :8080 + Valhalla + supabase local up):
 *   cd app && pnpm e2e:stream
 * Run 1 = full generation (spends ~1¢ of LLM budget through the cost guard);
 * run 2 = cancel after 3 events (server aborts the loop + spend).
 */

import { streamPlan, type StreamingFetchLike } from '../src/lib/plan_stream';

const BASE = process.env['API_URL'] ?? 'http://127.0.0.1:8080';
const fetchImpl = globalThis.fetch as unknown as StreamingFetchLike;

async function fullRun(): Promise<void> {
  const seen: string[] = [];
  let routeKm = 0;
  let routeMin = 0;
  let alternates = 0;
  let explanation = '';
  const t0 = Date.now();
  const result = await streamPlan(
    {
      brief: '90 minute twisty loop with a coffee stop',
      origin: { lat: 43.2557, lng: -79.8711 },
      preset: 'twisty',
    },
    {
      baseUrl: BASE,
      sessionId: 'e2e-full',
      fetchImpl,
      onEvent: (e) => {
        if (e.type === 'step')
          seen.push(`step:${e.step}:${e.status}${e.detail ? `(${e.detail})` : ''}`);
        else if (e.type === 'tool_result')
          seen.push(`tool:${e.tool}=${e.ok}${e.count !== undefined ? `#${e.count}` : ''}`);
        else if (e.type === 'route') {
          routeKm = e.route.distance_m / 1000;
          routeMin = e.route.duration_s / 60;
          seen.push('ROUTE');
        } else if (e.type === 'alternate') {
          alternates += 1;
        } else if (e.type === 'explanation') {
          explanation = e.explanation.text.slice(0, 110);
          seen.push('EXPLANATION');
        } else seen.push(e.type + (e.type === 'done' ? `:${e.status}` : ''));
      },
    },
  );
  console.log('--- FULL RUN ---');
  console.log('events:', seen.length, '| wall:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log('first 6:', seen.slice(0, 6).join(' | '));
  console.log('last 4 :', seen.slice(-4).join(' | '));
  console.log(
    'route  :',
    routeKm.toFixed(1) + ' km',
    '~' + Math.round(routeMin) + ' min',
    '| alternates:',
    alternates,
  );
  console.log('explain:', explanation);
  console.log('result :', JSON.stringify(result));
}

async function cancelRun(): Promise<void> {
  const aborter = new AbortController();
  let count = 0;
  const t0 = Date.now();
  const result = await streamPlan(
    { brief: 'a scenic two hour loop', origin: { lat: 44.3894, lng: -79.6903 } },
    {
      baseUrl: BASE,
      sessionId: 'e2e-cancel',
      fetchImpl,
      signal: aborter.signal,
      onEvent: () => {
        count += 1;
        if (count === 3) aborter.abort();
      },
    },
  );
  console.log('--- CANCEL RUN ---');
  console.log(
    'events before abort:',
    count,
    '| wall:',
    ((Date.now() - t0) / 1000).toFixed(1) + 's',
  );
  console.log('result:', JSON.stringify(result));
}

/** M7-T07: refine round-trip — hold `c` from a run, send a follow-up, compare. */
async function refineRun(): Promise<void> {
  let constraints: unknown = null;
  let firstDuration = 0;
  let firstCurv = 0;
  await streamPlan(
    { brief: '60 minute twisty loop', origin: { lat: 43.2557, lng: -79.8711 } },
    {
      baseUrl: BASE,
      sessionId: 'e2e-refine',
      fetchImpl,
      onEvent: (e) => {
        if (e.type === 'constraints') constraints = e.constraints;
        if (e.type === 'route') {
          firstDuration = e.route.duration_s;
          firstCurv = e.route.curviness;
        }
      },
    },
  );
  if (!constraints) throw new Error('no constraints event arrived');
  let secondDuration = 0;
  let secondCurv = 0;
  let preset = '';
  let parseDetail = '';
  const result = await streamPlan(
    { brief: 'more twisty more backroads', constraints, followUp: 'more twisty more backroads' },
    {
      baseUrl: BASE,
      sessionId: 'e2e-refine',
      fetchImpl,
      onEvent: (e) => {
        if (e.type === 'step' && e.step === 'parse' && e.status === 'completed')
          parseDetail = e.detail ?? '';
        if (e.type === 'constraints')
          preset = String((e.constraints as { preset?: string | null }).preset ?? 'null');
        if (e.type === 'route') {
          secondDuration = e.route.duration_s;
          secondCurv = e.route.curviness;
        }
      },
    },
  );
  console.log('--- REFINE RUN (more twisty more backroads) ---');
  console.log('parse:', parseDetail, '| done:', result.done, '| merged preset:', preset);
  console.log(
    'duration:',
    Math.round(firstDuration / 60) + ' min →',
    Math.round(secondDuration / 60) + ' min',
    '| twistiness:',
    firstCurv.toFixed(2),
    '→',
    secondCurv.toFixed(2),
  );
}

/** R16-6: multi-stop timed request via the STRUCTURED body (the Plan screen's
 *  stops builder shape) — stops must arrive as real named spots with monotonic
 *  measured arrivals; timing verdicts land in satisfied_constraints. */
async function stopsRun(): Promise<void> {
  let stops: Array<{
    name: string;
    type: string;
    arrival_s: number | null;
    at_fraction: number | null;
  }> = [];
  let verdicts: string[] = [];
  const t0 = Date.now();
  const result = await streamPlan(
    {
      brief: '2 hour loop on nice country roads',
      origin: { lat: 43.5448, lng: -80.2482 }, // Guelph
      stops: [
        { type: 'coffee', count: 1, importance: 'nice_to_have', at_fraction: 0.5 },
        { type: 'fuel', count: 1, importance: 'nice_to_have', at_fraction: 0.75 },
      ],
    },
    {
      baseUrl: BASE,
      sessionId: 'e2e-stops',
      fetchImpl,
      onEvent: (e) => {
        if (e.type === 'route') {
          stops = e.route.stops;
          verdicts = (e.route.satisfied_constraints ?? [])
            .filter((c) => c.constraint.startsWith('stop'))
            .map((c) => `${c.constraint}=${c.status}`);
        }
      },
    },
  );
  console.log('--- STOPS RUN (structured: coffee midway + gas late) ---');
  console.log('done:', result.done, '| wall:', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  for (const s of stops) {
    console.log(
      `stop: ${s.name} [${s.type}] at_fraction=${s.at_fraction} arrival=${
        s.arrival_s === null ? 'null' : Math.round(s.arrival_s / 60) + ' min'
      }`,
    );
  }
  console.log('verdicts:', verdicts.join(' | '));
  const arrivals = stops.map((s) => s.arrival_s).filter((a): a is number => a !== null);
  const monotonic = arrivals.every((a, i) => i === 0 || a > arrivals[i - 1]!);
  if (stops.length !== 2 || arrivals.length !== 2 || !monotonic) {
    throw new Error(
      `stops run failed honesty bars: n=${stops.length} measured=${arrivals.length} monotonic=${monotonic}`,
    );
  }
}

fullRun()
  .then(() => cancelRun())
  .then(() => refineRun())
  .then(() => stopsRun())
  .catch((e) => {
    console.error('E2E FAILED', e);
    process.exit(1);
  });
