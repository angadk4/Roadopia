import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthEngine } from '../../lib/auth_state';
import { memorySessionStore } from '../../lib/session_store';
import { AuthProvider } from '../../lib/use_auth';
import { confirmDialog, dialogPresented } from '../../test/dialog';
import { __haptics, __resetHaptics } from '../../test/expo-haptics-stub';
import RecordScreen from '../RecordScreen';

/**
 * M9-T03..T05 — the lifecycle contract, which no test covered while three
 * resources (a GPS subscription, the wake-lock and a 1 Hz timer) were being
 * installed asynchronously after a permission dialog.
 *
 * Redesign (SPEC "Record"; rule 15): the two-tap "Tap again to discard" arming
 * became a native `ConfirmDialog`. The guarantee the old assertions carried —
 * the capture is NOT wiped until a second, deliberate step — now reads as: the
 * op is not called until the dialog's destructive action is pressed, and a
 * dialog is actually presented in between (`src/test/dialog.ts`).
 */

// The haptics log is module state shared by every test in this file.
afterEach(() => {
  __resetHaptics();
});

/** A watcher whose resolution we control, so we can leave the screen while the
 *  OS permission dialog is still "open" — the real-world race. */
function deferredWatch() {
  let release!: () => void;
  const opened = new Promise<void>((r) => {
    release = r;
  });
  const stops: number[] = [];
  let started = 0;
  const watchFn = async () => {
    started += 1;
    await opened;
    return {
      status: 'ok' as const,
      stop: () => {
        stops.push(1);
      },
    };
  };
  return {
    watchFn,
    release,
    stops,
    startedCount: () => started,
  };
}

function render(props: Record<string, unknown>): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      (
        <RecordScreen
          navigation={{ goBack: () => undefined }}
          matchFn={vi.fn()}
          now={() => 1_000}
          {...props}
        />
      ) as ReactElement,
    );
  });
  return tree;
}

function tap(tree: ReactTestRenderer, label: string): void {
  const node = tree.root.findAll((n) => n.props['accessibilityLabel'] === label)[0]!;
  act(() => {
    (node.props['onPress'] as () => void)();
  });
}

describe('RecordScreen lifecycle', () => {
  it('leaving while the permission dialog is open STOPS the watcher it was granted', async () => {
    const w = deferredWatch();
    const tree = render({ watchFn: w.watchFn });
    tap(tree, 'Start recording');

    // the user backs out before the OS dialog resolves
    act(() => {
      tree.unmount();
    });
    await act(async () => {
      w.release(); // permission granted — to a screen that no longer exists
    });

    // without the live-flag the subscription would install onto a dead screen
    // and run for the rest of the app session (foreground-only, §20.3)
    expect(w.stops).toHaveLength(1);
  });

  it('a second tap while the dialog is open does not start a second watcher', async () => {
    const w = deferredWatch();
    const tree = render({ watchFn: w.watchFn });
    tap(tree, 'Start recording');
    tap(tree, 'Start recording');
    expect(w.startedCount()).toBe(1);
    await act(async () => {
      w.release();
    });
    act(() => {
      tree.unmount();
    });
  });

  it('a denied permission is said plainly, with the build-by-hand way out', async () => {
    const tree = render({ watchFn: async () => ({ status: 'denied' as const }) });
    tap(tree, 'Start recording');
    await act(async () => {});
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Location permission is off');
    expect(text).toContain('build the route by hand');
  });
});

describe('RecordScreen keeps the capture (device pass, 2026-09-04)', () => {
  const MATCHED = {
    geometry: {
      type: 'LineString',
      coordinates: [
        [-79.9, 43],
        [-79.9, 43.01],
      ],
    },
    distance_m: 1100,
    duration_s: 90,
    legs: [],
    maneuvers: [],
    has_highway: false,
    has_toll: false,
    has_ferry: false,
    has_unpaved: false,
  };

  /** A watcher the test drives: hands out the fix callback. */
  function drivingWatch() {
    let emit: ((f: Record<string, unknown>) => void) | null = null;
    const watchFn = async (onFix: (f: Record<string, unknown>) => void) => {
      emit = onFix;
      return { status: 'ok' as const, stop: () => undefined };
    };
    return {
      watchFn,
      fix: (lat: number, lng: number): void =>
        emit?.({ lat, lng, accuracyM: 5, headingDeg: null, speedMps: null }),
    };
  }

  async function recordAKilometre(
    matchFn: unknown,
    clock: { t: number },
    navigate?: (screen: string, params?: Record<string, unknown>) => void,
  ): Promise<ReactTestRenderer> {
    const w = drivingWatch();
    // the review step hosts the gated Save button, which needs the auth context
    const engine = new AuthEngine({
      cfg: { url: 'http://sb.local', anonKey: 'anon' },
      store: memorySessionStore(null),
    });
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        (
          <AuthProvider engine={engine}>
            <RecordScreen
              navigation={{ goBack: () => undefined, ...(navigate ? { navigate } : {}) }}
              watchFn={w.watchFn as never}
              matchFn={matchFn as never}
              now={() => clock.t}
            />
          </AuthProvider>
        ) as ReactElement,
      );
    });
    tap(tree, 'Start recording');
    await act(async () => {});
    for (let i = 0; i < 10; i++) {
      act(() => {
        w.fix(43 + i * 0.001, -79.9); // ~111 m apart → ~1 km, 10 points
      });
    }
    clock.t = 60_000;
    tap(tree, 'Stop recording');
    await act(async () => {});
    return tree;
  }

  it('a failed snap KEEPS the recording and offers Try again — which works', async () => {
    let calls = 0;
    const matchFn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('down');
      return MATCHED;
    });
    const tree = await recordAKilometre(matchFn, { t: 1_000 });
    let text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Could not snap that drive');
    expect(text).not.toContain('down');
    expect(text).toContain('0:59'); // the clock holds its final value
    expect(text).toContain('Try snapping again');
    expect(text).not.toContain('Start recording'); // nothing can wipe the capture by accident
    tap(tree, 'Try snapping again');
    await act(async () => {});
    expect(matchFn).toHaveBeenCalledTimes(2);
    text = JSON.stringify(tree.toJSON());
    expect(text).toContain('as driven');
  });

  it('a snapped drive can be followed straight from the review (device pass, 2026-09-07)', async () => {
    const navigate = vi.fn();
    const matched = {
      ...MATCHED,
      maneuvers: [
        { type: 'start', instruction: 'Drive north.', distance_m: 600 },
        { type: 'right', instruction: 'Turn right.', distance_m: 500 },
      ],
    };
    const tree = await recordAKilometre(
      vi.fn(async () => matched),
      { t: 1_000 },
      navigate,
    );
    expect(JSON.stringify(tree.toJSON())).toContain('Follow this drive');
    tap(tree, 'Follow this drive');
    expect(navigate).toHaveBeenCalledTimes(1);
    const [screen, params] = navigate.mock.calls[0] as [string, { route: Record<string, unknown> }];
    expect(screen).toBe('Follow');
    expect(params.route['origin_type']).toBe('recorded');
    expect(params.route['maneuvers']).toHaveLength(2);
  });

  it('without a navigate adapter the review has no Follow button', async () => {
    const tree = await recordAKilometre(
      vi.fn(async () => MATCHED),
      { t: 1_000 },
    );
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('as driven');
    expect(text).not.toContain('Follow this drive');
  });

  it('Discard asks through a native dialog on the review AND on the failed-snap panel (review, 2026-09-07; redesign)', async () => {
    const tree = await recordAKilometre(
      vi.fn(async () => MATCHED),
      { t: 1_000 },
    );
    tap(tree, 'Discard recording');
    let text = JSON.stringify(tree.toJSON());
    expect(text).toContain('as driven'); // still the review — the in-page control only asks
    expect(text).not.toContain('Start recording'); // nothing was wiped by the first tap
    expect(dialogPresented(tree)).toBe(true);
    __resetHaptics();
    await confirmDialog(tree, 'Discard');
    // the destructive confirmation is ONE Medium — nothing else buzzes for a reset
    expect(__haptics).toEqual(['impact:Medium']);
    text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Start recording');
    expect(text).not.toContain('as driven');
    expect(dialogPresented(tree)).toBe(false);

    let calls = 0;
    const failing = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('down');
      return MATCHED;
    });
    const failed = await recordAKilometre(failing, { t: 1_000 });
    tap(failed, 'Discard recording');
    text = JSON.stringify(failed.toJSON());
    expect(text).toContain('Try snapping again'); // the capture is still here
    expect(dialogPresented(failed)).toBe(true);
    // Try again dismisses: a Discard asked here must not carry into the review
    tap(failed, 'Try snapping again');
    await act(async () => {});
    text = JSON.stringify(failed.toJSON());
    expect(text).toContain('as driven');
    expect(dialogPresented(failed)).toBe(false);
  });

  it('Cancel during snapping keeps the recording too', async () => {
    const matchFn = vi.fn(
      (_o: unknown, _b: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }),
    );
    const tree = await recordAKilometre(matchFn, { t: 1_000 });
    expect(JSON.stringify(tree.toJSON())).toContain('Snapping to roads');
    tap(tree, 'Cancel snapping');
    await act(async () => {});
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Snapping was cancelled');
    expect(text).toContain('Try snapping again');
    expect(text).toContain('10 points');
  });

  it('thirty seconds without a fix is said out loud', async () => {
    vi.useFakeTimers();
    try {
      const w = drivingWatch();
      const clock = { t: 1_000 };
      const tree = render({ watchFn: w.watchFn as never, now: () => clock.t });
      tap(tree, 'Start recording');
      await act(async () => {});
      act(() => {
        w.fix(43, -79.9);
      });
      expect(JSON.stringify(tree.toJSON())).not.toContain('No GPS fix');
      clock.t = 45_000; // 44 s later, nothing arrived
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000); // the HUD's 1 Hz tick
      });
      expect(JSON.stringify(tree.toJSON())).toContain('No GPS fix for 30 s');
      act(() => {
        tree.unmount();
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('RecordScreen wake-lock failure (review, 2026-09-04)', () => {
  it('a wake-lock that fails after the watcher installed stops the watcher and says so', async () => {
    const { KEEP_AWAKE_MOCK } = await import('../../test/expo-keep-awake-stub');
    KEEP_AWAKE_MOCK.rejectActivate = true;
    try {
      const w = deferredWatch();
      const tree = render({ watchFn: w.watchFn });
      tap(tree, 'Start recording');
      await act(async () => {
        w.release();
      });
      await act(async () => {});
      expect(w.stops).toHaveLength(1); // the granted watcher is NOT left running
      expect(JSON.stringify(tree.toJSON())).toContain('Could not read the GPS');
      KEEP_AWAKE_MOCK.rejectActivate = false;
      tap(tree, 'Start recording'); // and Start works again
      await act(async () => {});
      expect(w.startedCount()).toBe(2);
      act(() => {
        tree.unmount();
      });
    } finally {
      KEEP_AWAKE_MOCK.rejectActivate = false;
    }
  });
});
