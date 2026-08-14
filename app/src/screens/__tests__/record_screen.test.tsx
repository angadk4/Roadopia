import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import RecordScreen from '../RecordScreen';

/**
 * M9-T03..T05 — the lifecycle contract, which no test covered while three
 * resources (a GPS subscription, the wake-lock and a 1 Hz timer) were being
 * installed asynchronously after a permission dialog.
 */

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
