/**
 * Node-safe stand-in for 'expo-haptics' (vitest alias — BD-204 redesign).
 *
 * The real module resolves `ExpoHaptics` through `requireNativeModule` at
 * IMPORT time, so one haptic in a tested screen takes the suite down before an
 * assertion runs. Nothing vibrates in node; what the stub does instead is
 * RECORD. The design rule is one haptic per commit and never on scroll, and a
 * rule that cannot be counted cannot be enforced — so every call lands in
 * `__haptics` as `impact:Light` / `selection` / `notification:Success` /
 * `android:Confirm`, and a test asserts the count and the kind.
 *
 * Enum members carry the real string values ('light', 'success', 'confirm' …)
 * so production code that compares or stores them behaves as on device. The
 * recorded label uses the member NAME because that is what a test reads.
 * Not emulated: the native engine, the Android `Vibrator` fallback, and any
 * latency — each call resolves immediately.
 *
 * `__haptics` is module state shared by every test in a file: a test that
 * reads it calls `__resetHaptics()` in a finally/afterEach so the next test
 * starts from zero.
 */

/** Real member names AND values (expo-haptics 55.0.18, Haptics.types.d.ts). */
export enum ImpactFeedbackStyle {
  Light = 'light',
  Medium = 'medium',
  Heavy = 'heavy',
  Soft = 'soft',
  Rigid = 'rigid',
}

export enum NotificationFeedbackType {
  Success = 'success',
  Warning = 'warning',
  Error = 'error',
}

export enum AndroidHaptics {
  Confirm = 'confirm',
  Reject = 'reject',
  Gesture_Start = 'gesture-start',
  Gesture_End = 'gesture-end',
  Toggle_On = 'toggle-on',
  Toggle_Off = 'toggle-off',
  Clock_Tick = 'clock-tick',
  Context_Click = 'context-click',
  Drag_Start = 'drag-start',
  Keyboard_Tap = 'keyboard-tap',
  Keyboard_Press = 'keyboard-press',
  Keyboard_Release = 'keyboard-release',
  Long_Press = 'long-press',
  Virtual_Key = 'virtual-key',
  Virtual_Key_Release = 'virtual-key-release',
  No_Haptics = 'no-haptics',
  Segment_Tick = 'segment-tick',
  Segment_Frequent_Tick = 'segment-frequent-tick',
  Text_Handle_Move = 'text-handle-move',
}

/** Every haptic fired since the last `__resetHaptics()`, oldest first. The
 *  array is mutated in place (never reassigned) so an imported binding stays
 *  live. Restore with `__resetHaptics()` in afterEach. */
export const __haptics: string[] = [];

export function __resetHaptics(): void {
  __haptics.length = 0;
}

/** Member name for a string-enum value ('light' → 'Light'); string enums have
 *  no reverse mapping of their own. An unknown value is recorded verbatim so a
 *  bad argument is visible in the log rather than hidden. */
function memberName(members: Record<string, string>, value: string): string {
  for (const [name, v] of Object.entries(members)) {
    if (v === value) return name;
  }
  return value;
}

/** Defaults mirror the real signatures (Medium / Success) so a bare call is
 *  recorded as what the device would actually play. */
export function impactAsync(
  style: ImpactFeedbackStyle = ImpactFeedbackStyle.Medium,
): Promise<void> {
  __haptics.push(`impact:${memberName(ImpactFeedbackStyle, style)}`);
  return Promise.resolve();
}

export function notificationAsync(
  type: NotificationFeedbackType = NotificationFeedbackType.Success,
): Promise<void> {
  __haptics.push(`notification:${memberName(NotificationFeedbackType, type)}`);
  return Promise.resolve();
}

export function selectionAsync(): Promise<void> {
  __haptics.push('selection');
  return Promise.resolve();
}

export function performAndroidHapticsAsync(type: AndroidHaptics): Promise<void> {
  __haptics.push(`android:${memberName(AndroidHaptics, type)}`);
  return Promise.resolve();
}
