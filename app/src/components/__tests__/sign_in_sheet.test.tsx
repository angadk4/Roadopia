import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { AuthEngine } from '../../lib/auth_state';
import { memorySessionStore } from '../../lib/session_store';
import { AuthProvider } from '../../lib/use_auth';
import SignInSheet from '../SignInSheet';

/**
 * M8-T01 sign-in sheet. The auto-submit contract exists because iOS's number
 * pad has NO return key (owner device pass): with a bottom sheet the keyboard
 * covers the Verify button, so the 6th digit MUST submit by itself.
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
