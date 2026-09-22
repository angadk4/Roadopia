/**
 * HeaderMenu — Android (SPEC "Shell chrome > Platform split").
 *
 * A 44pt `PressableScale` carrying the `ellipsisCircle` `Symbol` (Ionicons on
 * this platform) in the header tint, which opens an `Alert`-style action
 * list: `Alert.alert` with one button per action. RN's Android `Alert` holds
 * THREE buttons (`Alert.js` slices the rest), so: up to two actions get an
 * explicit Cancel in the first (leftmost) slot; three actions fill the three
 * slots and the sheet is dismissed by the back button or a tap outside
 * (`cancelable`) — SpotDetail's Edit · Report this · Delete. More than three
 * is a dev-time throw, not a silent drop. A `destructive` role is forwarded
 * as the button style so the intent survives; the Android dialog draws it
 * plain. No haptic (see the iOS file).
 */

import { Alert, type AlertButton } from 'react-native';

import { HIT_TARGET } from '../../../theme';
import { PressableScale } from '../PressableScale';
import { Symbol } from '../Symbol';

import type { HeaderMenuProps } from './index';

/** Android's three slots: neutral · negative · positive. */
const ANDROID_ALERT_BUTTONS = 3;

export function HeaderMenu({
  actions,
  accessibilityLabel = 'More actions',
  testID,
}: HeaderMenuProps): React.JSX.Element {
  const open = (): void => {
    const items: AlertButton[] = actions.map((action) => ({
      text: action.title,
      style: action.role ?? 'default',
      onPress: action.onPress,
    }));
    if (process.env.NODE_ENV !== 'production' && items.length > ANDROID_ALERT_BUTTONS) {
      throw new Error(
        `HeaderMenu: ${items.length} actions — Android's Alert holds ${ANDROID_ALERT_BUTTONS} ` +
          'buttons (RN drops the rest silently).',
      );
    }
    const buttons: AlertButton[] =
      items.length < ANDROID_ALERT_BUTTONS
        ? [{ text: 'Cancel', style: 'cancel' }, ...items]
        : items;
    Alert.alert(accessibilityLabel, undefined, buttons, { cancelable: true });
  };

  return (
    <PressableScale
      onPress={open}
      accessibilityLabel={accessibilityLabel}
      {...(testID !== undefined ? { testID } : {})}
      style={{
        width: HIT_TARGET,
        height: HIT_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
      }}
    >
      <Symbol name="ellipsisCircle" size="lg" tone="accent" />
    </PressableScale>
  );
}
