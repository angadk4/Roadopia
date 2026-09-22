import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FetchLike } from '../../lib/api';
import { AuthEngine } from '../../lib/auth_state';
import { memorySessionStore } from '../../lib/session_store';
import { AuthProvider } from '../../lib/use_auth';
import SignInScreen from '../../screens/SignInScreen';
import { __haptics, __resetHaptics } from '../../test/expo-haptics-stub';
import SignInSheet from '../SignInSheet';

/**
 * M8-T01 sign-in sheet. The auto-submit contract exists because iOS's number
 * pad has NO return key (owner device pass): with a bottom sheet the keyboard
 * covers the Verify button, so the 6th digit MUST submit by itself.
 *
 * Redesign shell: the sheet is a root-stack formSheet route whose body is the
 * same form. The default export still renders that body inline while the
 * engine says the sheet is open, so these tests drive the form the route
 * mounts; the route's own contract (a platform dismissal drops the parked
 * action exactly once) is pinned at the bottom.
 */

const CFG = { url: 'http://sb.local', anonKey: 'anon' };

function fieldNamed(tree: ReactTestRenderer, label: string) {
  return tree.root.findAll(
    (n) => n.props['accessibilityLabel'] === label && !!n.props['onChangeText'],
  )[0]!;
}

async function openSheet(engine: AuthEngine): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      (
        <AuthProvider engine={engine}>
          <SignInSheet />
        </AuthProvider>
      ) as ReactElement,
    );
  });
  await act(async () => {
    engine.gate(() => undefined); // the FR-201 path that opens the sheet
  });
  return tree;
}

describe('SignInSheet keyboard behaviour (M8-T01)', () => {
  it('the 6th digit submits automatically — no button press needed', async () => {
    const engine = new AuthEngine({ cfg: CFG, store: memorySessionStore(null) });
    const verify = vi.spyOn(engine, 'verifyCode').mockResolvedValue(undefined);
    vi.spyOn(engine, 'sendCode').mockResolvedValue(undefined);
    const tree = await openSheet(engine);

    // step 1: email → code step
    await act(async () => {
      (fieldNamed(tree, 'Email address').props['onChangeText'] as (t: string) => void)(
        'driver@roadopia.dev',
      );
    });
    await act(async () => {
      tree.root
        .findAll((n) => n.props['accessibilityLabel'] === 'Send code' && !!n.props['onPress'])[0]!
        .props['onPress']();
    });

    // step 2: five digits do nothing; the sixth fires
    const code = fieldNamed(tree, '6-digit code');
    await act(async () => {
      (code.props['onChangeText'] as (t: string) => void)('12345');
    });
    expect(verify).not.toHaveBeenCalled();
    await act(async () => {
      (code.props['onChangeText'] as (t: string) => void)('123456');
    });
    expect(verify).toHaveBeenCalledWith('driver@roadopia.dev', '123456');
  });

  it('non-digits are stripped and length is capped at 6', async () => {
    const engine = new AuthEngine({ cfg: CFG, store: memorySessionStore(null) });
    const verify = vi.spyOn(engine, 'verifyCode').mockResolvedValue(undefined);
    vi.spyOn(engine, 'sendCode').mockResolvedValue(undefined);
    const tree = await openSheet(engine);
    await act(async () => {
      (fieldNamed(tree, 'Email address').props['onChangeText'] as (t: string) => void)('a@b.co');
    });
    await act(async () => {
      tree.root
        .findAll((n) => n.props['accessibilityLabel'] === 'Send code' && !!n.props['onPress'])[0]!
        .props['onPress']();
    });
    await act(async () => {
      // a paste with spaces/letters still resolves to exactly six digits
      (fieldNamed(tree, '6-digit code').props['onChangeText'] as (t: string) => void)(
        '9 1 1 3 1 4x',
      );
    });
    expect(verify).toHaveBeenCalledWith('a@b.co', '911314');
  });

  it('offers a keyboard-dismiss target above the sheet', async () => {
    const engine = new AuthEngine({ cfg: CFG, store: memorySessionStore(null) });
    const tree = await openSheet(engine);
    const dismiss = tree.root.findAll(
      (n) => n.props['accessibilityLabel'] === 'Dismiss keyboard' && !!n.props['onPress'],
    );
    // (>0 not ==1: the RN stub surfaces both the component and its host node)
    expect(dismiss.length).toBeGreaterThan(0);
  });
});

describe('SignInSheet resend (device pass, 2026-09-04)', () => {
  it('offers "Resend code" after the cooldown and sends again to the same address', async () => {
    vi.useFakeTimers();
    try {
      const engine = new AuthEngine({ cfg: CFG, store: memorySessionStore(null) });
      const send = vi.spyOn(engine, 'sendCode').mockResolvedValue(undefined);
      const tree = await openSheet(engine);
      await act(async () => {
        (fieldNamed(tree, 'Email address').props['onChangeText'] as (t: string) => void)('a@b.co');
      });
      await act(async () => {
        tree.root
          .findAll((n) => n.props['accessibilityLabel'] === 'Send code' && !!n.props['onPress'])[0]!
          .props['onPress']();
      });
      expect(send).toHaveBeenCalledTimes(1);

      // during the cooldown the button is disabled and says how long
      const resend = () =>
        tree.root.findAll(
          (n) => n.props['accessibilityLabel'] === 'Resend code' && !!n.props['onPress'],
        )[0]!;
      expect(JSON.stringify(tree.toJSON())).toContain('Resend code in 30 s');
      await act(async () => {
        resend().props['onPress']();
      });
      expect(send).toHaveBeenCalledTimes(1); // ignored while cooling down

      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      expect(JSON.stringify(tree.toJSON())).not.toContain('Resend code in');
      await act(async () => {
        resend().props['onPress']();
      });
      expect(send).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenLastCalledWith('a@b.co');
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Redesign shell: the form is honest about a refused code and quiet about
 * everything else. One haptic per user action, same moment as the visual
 * (SPEC "Haptics policy"): Success when the parked action resumes, Error when
 * the code is refused — and nothing while typing or sending.
 */
describe('SignInSheet haptics (SPEC "SignInSheet" motion gate)', () => {
  // The recorder is module state shared by every test in this file — the
  // verify runs above have already fired — so it is cleared on both sides.
  beforeEach(() => __resetHaptics());
  afterEach(() => __resetHaptics());

  async function toCodeStep(engine: AuthEngine): Promise<ReactTestRenderer> {
    vi.spyOn(engine, 'sendCode').mockResolvedValue(undefined);
    const tree = await openSheet(engine);
    await act(async () => {
      (fieldNamed(tree, 'Email address').props['onChangeText'] as (t: string) => void)('a@b.co');
    });
    await act(async () => {
      tree.root
        .findAll((n) => n.props['accessibilityLabel'] === 'Send code' && !!n.props['onPress'])[0]!
        .props['onPress']();
    });
    return tree;
  }

  it('a verified code fires exactly one Success, and nothing before it', async () => {
    const engine = new AuthEngine({ cfg: CFG, store: memorySessionStore(null) });
    vi.spyOn(engine, 'verifyCode').mockResolvedValue(undefined);
    const tree = await toCodeStep(engine);
    expect(__haptics).toEqual([]); // typing an email and sending are silent
    await act(async () => {
      (fieldNamed(tree, '6-digit code').props['onChangeText'] as (t: string) => void)('123456');
    });
    expect(__haptics).toEqual(['notification:Success']);
  });

  it('a refused code fires exactly one Error and shows the friendly line, never the raw one', async () => {
    const engine = new AuthEngine({ cfg: CFG, store: memorySessionStore(null) });
    vi.spyOn(engine, 'verifyCode').mockRejectedValue(new Error('ECONNRESET'));
    const tree = await toCodeStep(engine);
    await act(async () => {
      (fieldNamed(tree, '6-digit code').props['onChangeText'] as (t: string) => void)('000000');
    });
    expect(__haptics).toEqual(['notification:Error']);
    const text = JSON.stringify(tree.toJSON());
    expect(text).toContain('Something went wrong — try again.');
    expect(text).not.toContain('ECONNRESET');
  });
});

/**
 * The formSheet ROUTE. The platform can dismiss it without asking the engine
 * (a swipe down), so the route's unmount drops the parked action — but ONLY
 * while the engine still thinks the sheet is open. After a successful verify
 * the engine has closed the sheet and run the action; a second `dismissSheet`
 * there would fire the host's "Not saved" under a drive that was just saved.
 */
describe('SignInScreen (the formSheet route)', () => {
  /** A fake GoTrue: `/otp` accepts, `/verify` returns a session. */
  const gotrue: FetchLike = async (url) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () =>
      url.endsWith('/verify')
        ? JSON.stringify({
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
            user: { id: 'u1', email: 'a@b.co' },
          })
        : '{}',
  });

  async function mountRoute(engine: AuthEngine): Promise<ReactTestRenderer> {
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        (
          <AuthProvider engine={engine}>
            <SignInScreen />
          </AuthProvider>
        ) as ReactElement,
      );
    });
    return tree;
  }

  it('unmounting while the sheet is open drops the parked action exactly once', async () => {
    const engine = new AuthEngine({ cfg: CFG, store: memorySessionStore(null) });
    const dismiss = vi.spyOn(engine, 'dismissSheet');
    const onDismiss = vi.fn();
    const tree = await mountRoute(engine);
    await act(async () => {
      engine.gate(() => undefined, { onDismiss });
    });
    expect(engine.getState().sheetOpen).toBe(true);
    expect(dismiss).not.toHaveBeenCalled();

    await act(async () => {
      tree.unmount(); // the platform's swipe-down: the route goes, the engine did not
    });
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1); // the host hears "not saved" once
    expect(engine.getState().sheetOpen).toBe(false);
  });

  it('after a successful verify the unmount does not dismiss again', async () => {
    const engine = new AuthEngine({
      cfg: CFG,
      store: memorySessionStore(null),
      fetchImpl: gotrue,
      now: () => 1000,
    });
    const dismiss = vi.spyOn(engine, 'dismissSheet');
    const parked = vi.fn();
    const onDismiss = vi.fn();
    const tree = await mountRoute(engine);
    await act(async () => {
      engine.gate(parked, { onDismiss });
    });

    await act(async () => {
      (fieldNamed(tree, 'Email address').props['onChangeText'] as (t: string) => void)('a@b.co');
    });
    await act(async () => {
      tree.root
        .findAll((n) => n.props['accessibilityLabel'] === 'Send code' && !!n.props['onPress'])[0]!
        .props['onPress']();
    });
    await act(async () => {
      (fieldNamed(tree, '6-digit code').props['onChangeText'] as (t: string) => void)('123456');
    });
    // the engine closed the sheet itself and ran the parked action once
    expect(engine.getState().sheetOpen).toBe(false);
    expect(parked).toHaveBeenCalledTimes(1);

    await act(async () => {
      tree.unmount(); // the pop the engine's own state change caused
    });
    expect(dismiss).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled(); // never "Not saved" over a save
  });
});
