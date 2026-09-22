/**
 * ConfirmDialog — Android (SPEC "Shell chrome > Platform split"; rule 15).
 *
 * `Alert.alert` — the platform dialog — shown from an effect the moment
 * `isPresented` turns true. It renders nothing of its own. The buttons carry
 * their `style` (`destructive` / `cancel` / `default`) as the SPEC asks; RN's
 * Android dialog does not colour a destructive button, but the role is still
 * forwarded so the intent survives a future RN that does. Cancel goes FIRST
 * in the array: RN maps the LAST button to Android's positive (rightmost)
 * slot, and the affirmative action belongs on the right. When no action is
 * `cancel`, a Cancel that only closes the dialog is added.
 *
 * ONE PRESS: tell the screen the dialog closed, play ONE `impactAsync(Medium)`
 * for a destructive role, run the action. Dismissal by the back button or a
 * tap outside (`cancelable`) reports `onIsPresentedChange(false)` too.
 *
 * TWO LIMITS, stated rather than hidden. (1) RN's Android `Alert` holds three
 * buttons (`Alert.js` slices the rest away), so a dialog gets at most two
 * actions plus Cancel — a dev-time throw says so; every SPEC dialog is one
 * action plus Cancel/Keep. (2) A native Alert cannot be dismissed from JS: if
 * the screen sets `isPresented` false while it is still showing (Record's
 * "Try again dismisses a presented dialog"), a late press is IGNORED — the
 * action never runs against a state that has moved on.
 */

import { ImpactFeedbackStyle, impactAsync } from 'expo-haptics';
import { useEffect, useRef } from 'react';
import { Alert, type AlertButton } from 'react-native';

import type { ConfirmDialogProps, DialogAction } from './index';

/** Android's three slots: neutral · negative · positive. */
const ANDROID_ALERT_BUTTONS = 3;

export function ConfirmDialog({
  isPresented,
  onIsPresentedChange,
  title,
  message,
  actions,
}: ConfirmDialogProps): null {
  // The effect keys on `isPresented` alone; everything else is read at press
  // time through this ref, so a re-render mid-dialog never opens a second one
  // and a press always sees the screen's current handlers.
  const latest = useRef({ isPresented, onIsPresentedChange, title, message, actions });
  latest.current = { isPresented, onIsPresentedChange, title, message, actions };

  useEffect(() => {
    if (!isPresented) return;
    const snapshot = latest.current;

    const close = (): void => latest.current.onIsPresentedChange(false);
    const fire = (action: DialogAction): void => {
      if (!latest.current.isPresented) return; // the screen moved on (limit 2)
      close();
      if (action.role === 'destructive') void impactAsync(ImpactFeedbackStyle.Medium);
      action.onPress();
    };

    const cancels = snapshot.actions.filter((a) => a.role === 'cancel');
    const others = snapshot.actions.filter((a) => a.role !== 'cancel');
    const toButton = (action: DialogAction): AlertButton => ({
      text: action.title,
      style: action.role ?? 'default',
      onPress: () => fire(action),
    });
    const buttons: AlertButton[] = [
      ...(cancels.length > 0
        ? cancels.map(toButton)
        : [{ text: 'Cancel', style: 'cancel' as const, onPress: close }]),
      ...others.map(toButton),
    ];

    if (process.env.NODE_ENV !== 'production' && buttons.length > ANDROID_ALERT_BUTTONS) {
      throw new Error(
        `ConfirmDialog: ${buttons.length} buttons — Android's Alert holds ${ANDROID_ALERT_BUTTONS} ` +
          '(RN drops the rest silently), so a dialog is at most two actions plus Cancel.',
      );
    }

    Alert.alert(snapshot.title, snapshot.message, buttons, { cancelable: true, onDismiss: close });
  }, [isPresented]);

  return null;
}
