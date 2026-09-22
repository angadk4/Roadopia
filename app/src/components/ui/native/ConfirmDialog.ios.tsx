/**
 * ConfirmDialog — iOS (SPEC "Shell chrome > Platform split"; SPEC rule 15:
 * every "Tap again to …" arming becomes a native confirmation with a
 * destructive action, and the op runs ONLY from that action).
 *
 * A SwiftUI `confirmationDialog` — the action sheet with a red destructive
 * button and the platform's own Cancel — through `@expo/ui`'s
 * `ConfirmationDialog`. The tree stays MOUNTED whether or not it is presented:
 * the dialog modifier is attached to a view that must exist before
 * `isPresented` flips, and unmounting it while presented would drop the
 * presentation without an event. What changes with `isPresented` is what the
 * user sees, and — in node — what the `@expo/ui` stub renders (the message
 * and actions appear only while presented), which is what `dialogPresented`
 * and `confirmDialog` in `src/test/dialog.ts` read.
 *
 * THE TRIGGER. The Swift (`ConfirmationDialogView.triggerContent`) warns that
 * a dialog "requires a Trigger child to be visible" — an `EmptyView` with a
 * presentation modifier never presents. The in-page control that opens the
 * dialog is an RN `Button` (rule 15 keeps it, with its accessibilityLabel, for
 * bare renders), so the trigger slot here is an ANCHOR, not a button: a 1×1
 * clear `Rectangle`. The `Host` matches it and sits absolutely at the top-left
 * of whatever the screen mounts it in, taking no layout.
 *
 * ACTIONS. Each `Button` carries its `role` — `destructive` is what draws it
 * red — and its accessibilityLabel as a modifier ("Confirm delete drive"). One
 * press does three things in order: tells the screen the dialog closed
 * (`onIsPresentedChange(false)` — native emits the same after the binding
 * flips, and the screen's setter is idempotent), plays ONE `impactAsync(Medium)`
 * for a destructive role (SPEC haptics policy: a destructive confirmation
 * fires Medium — the frame the sheet leaves), then runs the action. A cancel
 * role plays nothing. When no action is `cancel`, SwiftUI adds its own Cancel
 * and reports the dismissal through `onIsPresentedChange`.
 *
 * `titleVisibility="visible"`: a confirmation dialog hides its title under
 * `automatic`, and the SPEC's titles ("Delete “My loop”?") are the question.
 */

import { Button, ConfirmationDialog, Host, Rectangle, Text } from '@expo/ui/swift-ui';
import { accessibilityLabel, foregroundStyle, frame } from '@expo/ui/swift-ui/modifiers';
import { ImpactFeedbackStyle, impactAsync } from 'expo-haptics';
import type { ViewStyle } from 'react-native';

import { useTheme } from '../../../theme';

import type { ConfirmDialogProps, DialogAction } from './index';

/** Out of flow, so the anchor never shifts the page it is mounted in. */
const ANCHOR: ViewStyle = { position: 'absolute', top: 0, left: 0 };

export function ConfirmDialog({
  isPresented,
  onIsPresentedChange,
  title,
  message,
  actions,
  testID,
}: ConfirmDialogProps): React.JSX.Element {
  const { name } = useTheme();

  const fire = (action: DialogAction): void => {
    onIsPresentedChange(false);
    if (action.role === 'destructive') void impactAsync(ImpactFeedbackStyle.Medium);
    action.onPress();
  };

  return (
    <Host
      matchContents
      colorScheme={name}
      {...(testID !== undefined ? { testID } : {})}
      style={ANCHOR}
    >
      <ConfirmationDialog
        title={title}
        isPresented={isPresented}
        onIsPresentedChange={onIsPresentedChange}
        titleVisibility="visible"
      >
        <ConfirmationDialog.Trigger>
          <Rectangle modifiers={[frame({ width: 1, height: 1 }), foregroundStyle('clear')]} />
        </ConfirmationDialog.Trigger>
        {message !== undefined ? (
          <ConfirmationDialog.Message>
            <Text>{message}</Text>
          </ConfirmationDialog.Message>
        ) : null}
        <ConfirmationDialog.Actions>
          {actions.map((action) => (
            <Button
              key={action.title}
              label={action.title}
              {...(action.role !== undefined ? { role: action.role } : {})}
              {...(action.accessibilityLabel !== undefined
                ? { modifiers: [accessibilityLabel(action.accessibilityLabel)] }
                : {})}
              onPress={() => fire(action)}
            />
          ))}
        </ConfirmationDialog.Actions>
      </ConfirmationDialog>
    </Host>
  );
}
