/**
 * Driving a `ConfirmDialog` from a node test (redesign — SPEC "Shell chrome >
 * Test helper"; SPEC rule 15).
 *
 * Every "Tap again to …" arming became a native confirmation, and the
 * guarantee the old two-step tests carried — the op is NOT called until the
 * second, deliberate step — now reads as: the op is not called until the
 * dialog's destructive action is pressed. These two helpers are that second
 * step, against what the `@expo/ui` stub renders: an
 * `expo-ui-confirmationdialog` host with `isPresented`, whose
 * `expo-ui-button` children exist ONLY while presented.
 *
 *   dialogPresented(tree)          true when a ConfirmDialog is presented
 *   await confirmDialog(tree, t)   press the presented action titled `t`
 *
 * `confirmDialog` matches the button's visible `label` first and its
 * accessibilityLabel modifier second ("Delete" or "Confirm delete drive" both
 * find the same button), and it insists on exactly one match: two presented
 * dialogs with the same action is a screen bug, not something to press
 * through. It is async — the press runs inside `act` and the microtasks the
 * action kicks off (a delete, a `goBack`) are flushed before it resolves —
 * so `await` it.
 */

import { act } from 'react';
import type { ReactTestInstance, ReactTestRenderer } from 'react-test-renderer';

// Typed `string`, not literal: `ReactTestInstance.type` is React's
// `ElementType`, and strict TS rejects a comparison against a literal it can
// never equal (DOM tag names only). A widened string is what makes the stub's
// own tag names comparable — the same reason the proof tests type `ofTag(tag:
// string)`.
const DIALOG: string = 'expo-ui-confirmationdialog';
const BUTTON: string = 'expo-ui-button';

function presentedDialogs(tree: ReactTestRenderer): ReactTestInstance[] {
  return tree.root.findAll((n) => n.type === DIALOG && n.props['isPresented'] === true);
}

/** The accessibilityLabel a `@expo/ui` button carries, if any — a plain
 *  `{ $type: 'accessibilityLabel', label }` descriptor in `modifiers`. */
function a11yLabelOf(button: ReactTestInstance): string | undefined {
  const modifiers = button.props['modifiers'];
  if (!Array.isArray(modifiers)) return undefined;
  for (const m of modifiers) {
    if (
      typeof m === 'object' &&
      m !== null &&
      (m as { $type?: unknown }).$type === 'accessibilityLabel' &&
      typeof (m as { label?: unknown }).label === 'string'
    ) {
      return (m as { label: string }).label;
    }
  }
  return undefined;
}

/** True when a `ConfirmDialog` is presented anywhere in the tree. */
export function dialogPresented(tree: ReactTestRenderer): boolean {
  return presentedDialogs(tree).length > 0;
}

/**
 * Press the presented dialog's action titled `actionTitle` (its visible
 * label, or its accessibilityLabel). Throws when no dialog is presented or the
 * match is not exactly one — a failed precondition, not a silent no-op.
 */
export async function confirmDialog(tree: ReactTestRenderer, actionTitle: string): Promise<void> {
  const dialogs = presentedDialogs(tree);
  if (dialogs.length === 0) {
    throw new Error(`confirmDialog: no ConfirmDialog is presented (looking for "${actionTitle}")`);
  }
  const byLabel = dialogs.flatMap((d) =>
    d.findAll((n) => n.type === BUTTON && n.props['label'] === actionTitle),
  );
  const matches =
    byLabel.length > 0
      ? byLabel
      : dialogs.flatMap((d) =>
          d.findAll((n) => n.type === BUTTON && a11yLabelOf(n) === actionTitle),
        );
  if (matches.length !== 1) {
    throw new Error(
      `confirmDialog: expected exactly one presented action "${actionTitle}", found ${matches.length}`,
    );
  }
  const onPress = matches[0]?.props['onPress'] as (() => void) | undefined;
  if (typeof onPress !== 'function') {
    throw new Error(`confirmDialog: the action "${actionTitle}" has no onPress`);
  }
  await act(async () => {
    onPress();
  });
}
