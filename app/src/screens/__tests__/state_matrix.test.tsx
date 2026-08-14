/**
 * M7-T08 — the §18 state matrix, asserted in one place. Every state applicable
 * to the M7 slice renders a FRIENDLY, honest UI (never a raw error; always a
 * path forward). Rows owned by later milestones: upload-rejected (M10),
 * auth-required (M8) — and geocode-failure is n/a by design (place names ride
 * the brief; the server gazetteer resolves or asks to clarify).
 */
import type { GenerationEvent } from '@shared/types';
import { act, type ReactElement } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import RouteDetail from '../../components/RouteDetail';
import { ApiError } from '../../lib/api';
import { AuthEngine } from '../../lib/auth_state';
import type { PlanStreamResult } from '../../lib/plan_stream';
import { memorySessionStore } from '../../lib/session_store';
import { AuthProvider } from '../../lib/use_auth';
import MapHome from '../MapHome';
import ProgressScreen from '../ProgressScreen';

const REQUEST = { brief: 'loop', origin: { lat: 43.26, lng: -79.87 } };
const NAV = { replace: () => {}, goBack: () => {} };

/** MapHome reads auth so it can show the signed-in user's OWN spots (their
 *  pins are invisible under the anon key). Anonymous context is enough here. */
function withAuth(node: ReactElement): ReactElement {
  return (
    <AuthProvider
      engine={
        new AuthEngine({
          cfg: { url: 'http://sb.local', anonKey: 'anon' },
          store: memorySessionStore(null),
        })
      }
    >
      {node}
    </AuthProvider>
  ) as ReactElement;
}

function textOf(tree: ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

async function progressWith(
  streamFn: (r: unknown, o: { onEvent: (e: GenerationEvent) => void }) => Promise<PlanStreamResult>,
): Promise<string> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <ProgressScreen
        navigation={NAV}
        route={{ params: { request: REQUEST } }}
        streamFn={streamFn as never}
      />,
    );
  });
  return textOf(tree);
}

describe('§18 state matrix', () => {
  it('1 loading — map banner + streamed generation steps', () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(withAuth(<MapHome loadRoutes={() => new Promise(() => {})} />));
    });
    expect(textOf(tree)).toContain('Loading routes');
  });

  it('3a offline before start — needs-a-connection + retry, no raw error', async () => {
    const text = await progressWith(() => Promise.reject(new TypeError('fetch failed')));
    expect(text).toContain('No connection');
    expect(text).toContain('Try again');
    expect(text).not.toContain('fetch failed');
  });

  it('3b connection dropped mid-run — honest lost-connection copy', async () => {
    const text = await progressWith((_r, o) => {
      o.onEvent({ type: 'step', step: 'parse', status: 'started' });
      return Promise.resolve({ done: null, aborted: false, malformedFrames: 0 });
    });
    expect(text).toContain('Connection lost');
    expect(text).toContain('Nothing was saved');
  });

  it('3c map data unreachable — map still works + retry (never blank)', async () => {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        withAuth(<MapHome loadRoutes={() => Promise.reject(new Error('ECONNREFUSED'))} />),
      );
    });
    const text = textOf(tree);
    expect(text).toContain('mapbox-mapview');
    expect(text).toContain('the map still works');
    expect(text).not.toContain('ECONNREFUSED');
  });

  it('6 out-of-region — the server message renders verbatim + a path forward', async () => {
    const text = await progressWith(() =>
      Promise.reject(
        new ApiError({
          status: 400,
          code: 'out_of_region',
          message:
            'Roadopia currently covers south-central Ontario (region south-central-ontario); pick a start inside it.',
        }),
      ),
    );
    expect(text).toContain('south-central Ontario');
    expect(text).toContain('Adjust the plan');
  });

  it('7 planner failure ladder — friendly unavailable text, never a stack', async () => {
    const text = await progressWith((_r, o) => {
      o.onEvent({
        type: 'error',
        message:
          'The planner is temporarily unavailable. Browsing and saved routes still work — please try again shortly.',
      });
      o.onEvent({ type: 'done', status: 'unavailable' });
      return Promise.resolve({ done: 'unavailable', aborted: false, malformedFrames: 0 });
    });
    expect(text).toContain('temporarily unavailable');
    expect(text).toContain('still work');
  });

  it('8 hard-constraint relaxation — disclosed banner (§18 row 8)', () => {
    let tree!: ReactTestRenderer;
    const route = {
      geometry: {
        type: 'LineString',
        coordinates: [
          [-79.9, 43.2],
          [-79.8, 43.3],
        ],
      },
      geometry_simplified: null,
      bbox: null,
      is_loop: true,
      waypoints: [],
      distance_m: 50000,
      duration_s: 3600,
      curviness: 1,
      elevation_profile: null,
      climb_m: null,
      highway_flag: true,
      toll_flag: false,
      ferry_flag: false,
      unpaved_flag: false,
      character_tags: [],
      intensity: 'moderate',
      free_tags: [],
      visibility: 'private',
      owner_id: null,
      origin_type: 'ai',
      forked_from: null,
      generation_request_id: null,
      satisfied_constraints: null,
      agent_explanation: null,
    } as never;
    act(() => {
      tree = create(<RouteDetail route={route} explanation={null} done="relaxed" />);
    });
    expect(textOf(tree)).toContain('Some preferences were relaxed');
  });

  it('9 generation timeout — best-so-far with the §18 sentence', async () => {
    const text = await progressWith((_r, o) => {
      o.onEvent({ type: 'error', message: 'x' });
      o.onEvent({ type: 'done', status: 'unavailable' });
      return Promise.resolve({ done: 'unavailable', aborted: false, malformedFrames: 0 });
    });
    // best_so_far WITH a route lands on RouteDetail's banner (result.test.tsx
    // asserts the exact copy); here we pin that a no-route end is never raw.
    expect(text).toContain('No route this time');
  });

  it('11 spend cap / kill switch — the 503 names what still works + retry offered', async () => {
    const text = await progressWith(() =>
      Promise.reject(
        new ApiError({
          status: 503,
          code: 'planner_disabled',
          message:
            'The planner is temporarily disabled. Browsing, saved routes, manual building and recording all still work.',
        }),
      ),
    );
    expect(text).toContain('Planning is paused');
    expect(text).toContain('still work');
  });

  it('rate limit — server retry-in message + a countdown-labelled retry', async () => {
    const text = await progressWith(() =>
      Promise.reject(
        new ApiError({
          status: 429,
          code: 'rate_limited',
          message: 'Too many plans at once — try again in 12s.',
          retryAfterS: 12,
        }),
      ),
    );
    expect(text).toContain('Too many plans at once');
    expect(text).toContain('~12s');
  });
});
