/**
 * HeaderMenu — iOS (SPEC "Shell chrome > Platform split"; SavedRoute and
 * Spot: `headerRight` `ellipsis.circle` menu).
 *
 * A SwiftUI `Menu` whose label is the `ellipsis.circle` glyph — a SwiftUI
 * `Image`, because a Menu's label must be SwiftUI content, drawn from the one
 * semantic table (`SYMBOLS.ellipsisCircle.sf`, so the "down" and denylist
 * guards still cover it) in the header's tint (`accentText`). The Menu is
 * framed to the owner's 44pt hit target; the `Host` matches it, so a bar
 * button is exactly one hit target wide. Each action is a native `Button`
 * with its `role` (`destructive` draws the item red) and, when given, its SF
 * glyph beside the title and an accessibilityLabel modifier.
 *
 * A menu has no Cancel — dismissing IS cancel — and no haptic: a menu item
 * that destroys something leads to a `ConfirmDialog`, which plays the one
 * Medium impact for the action that actually fires.
 *
 * Device-verify (SPEC "Risks"): a `Host` inside react-navigation's
 * `headerRight` — sizing on first render and touch delivery through the
 * native header.
 */

import { Button, Host, Image, Menu } from '@expo/ui/swift-ui';
import { accessibilityLabel, frame } from '@expo/ui/swift-ui/modifiers';

import { HIT_TARGET, useTheme } from '../../../theme';
import { SYMBOL_SIZE, SYMBOLS } from '../Symbol';

import type { HeaderMenuProps } from './index';

export function HeaderMenu({
  actions,
  accessibilityLabel: menuLabel = 'More actions',
  testID,
}: HeaderMenuProps): React.JSX.Element {
  const { name, colors } = useTheme();

  return (
    <Host matchContents colorScheme={name} {...(testID !== undefined ? { testID } : {})}>
      <Menu
        label={
          <Image
            systemName={SYMBOLS.ellipsisCircle.sf}
            size={SYMBOL_SIZE.lg}
            color={colors.accentText}
          />
        }
        modifiers={[
          accessibilityLabel(menuLabel),
          frame({ width: HIT_TARGET, height: HIT_TARGET }),
        ]}
      >
        {actions.map((action) => (
          <Button
            key={action.title}
            label={action.title}
            {...(action.role !== undefined ? { role: action.role } : {})}
            {...(action.symbol !== undefined ? { systemImage: SYMBOLS[action.symbol].sf } : {})}
            {...(action.accessibilityLabel !== undefined
              ? { modifiers: [accessibilityLabel(action.accessibilityLabel)] }
              : {})}
            onPress={action.onPress}
          />
        ))}
      </Menu>
    </Host>
  );
}
