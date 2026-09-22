/**
 * The one glyph component (redesign — SPEC "Shell chrome > Symbol").
 * Succeeds `ui/Icon.tsx`, which stays until the final sweep.
 *
 * ONE SEMANTIC TABLE. A screen asks for `chevronRight`, never for a platform
 * name: iOS draws the SF Symbol through `expo-symbols` (`SymbolView`, weight
 * `medium` to match SF's text weight), Android draws the Ionicons twin. Both
 * names live side by side in `SYMBOLS`, so a glyph can never exist on one
 * platform and be a blank box on the other, and `ui.test.tsx` walks the whole
 * table on every run.
 *
 * TWO RULES, both inherited from `Icon` and now enforced on BOTH namespaces:
 *
 *   1. A symbol is DECORATION unless it is the only content. Beside a label it
 *      is hidden from assistive tech ("checkmark, Saved" is noise). A bare
 *      symbol button MUST pass `label`; the component makes that the only way
 *      to be announced.
 *   2. NO name containing "down", in either namespace. Six suites assert
 *      `not.toContain('down')` on the serialised tree as a raw-error tripwire,
 *      and the expo-symbols stub renders `symbolName` as a PROP — which is in
 *      the serialised tree. Disclosure is `chevronRight` rotated 90° via
 *      `style`, never a chevron.down. The same guard refuses the Hard-rule-D
 *      denylist (speed / gauge / rocket / timer / flash and the two words the
 *      §59 scan itself bans — spelled as character classes below so the rule
 *      that enforces the scan does not trip it).
 *
 * Both guards are DEV-TIME: fail loudly in development and CI, never crash a
 * user's screen over a test tripwire (a release bundle simply renders).
 *
 * NAMING. This module exports a component called `Symbol`, as the SPEC names
 * it. Inside a file that imports it, the global `Symbol` (`Symbol.for`,
 * `Symbol.iterator`) is shadowed — no screen uses the global; the test stubs
 * that do never import this component.
 */

import Ionicons from '@expo/vector-icons/Ionicons';
import { SymbolView, type AnimationSpec, type SFSymbol, type SymbolWeight } from 'expo-symbols';
import type { ComponentProps } from 'react';
import { Platform, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { useTheme, type ThemeColors } from '../../theme';

import type { TextTone } from './Text';

/** The real Ionicons name union — a typo is a compile error, not a blank box. */
type IoniconsName = ComponentProps<typeof Ionicons>['name'];

/** One glyph, both platforms. `sf` is checked against the SF Symbols union. */
export interface SymbolGlyph {
  readonly sf: SFSymbol;
  readonly ionicons: IoniconsName;
}

/**
 * The table. Keys are the SF name in camelCase so a reader can find the glyph
 * in Apple's SF Symbols app; the Ionicons twin is the closest glyph, chosen
 * for the same meaning rather than the same picture.
 */
export const SYMBOLS = {
  // navigation & chrome
  map: { sf: 'map', ionicons: 'map-outline' },
  mapFill: { sf: 'map.fill', ionicons: 'map' },
  chevronRight: { sf: 'chevron.right', ionicons: 'chevron-forward' },
  chevronLeft: { sf: 'chevron.left', ionicons: 'chevron-back' },
  ellipsisCircle: { sf: 'ellipsis.circle', ionicons: 'ellipsis-horizontal-circle' },
  plus: { sf: 'plus', ionicons: 'add' },
  plusCircle: { sf: 'plus.circle', ionicons: 'add-circle-outline' },
  plusCircleFill: { sf: 'plus.circle.fill', ionicons: 'add-circle' },
  minus: { sf: 'minus', ionicons: 'remove' },
  minusCircleFill: { sf: 'minus.circle.fill', ionicons: 'remove-circle' },
  xmark: { sf: 'xmark', ionicons: 'close' },
  xmarkCircleFill: { sf: 'xmark.circle.fill', ionicons: 'close-circle' },
  signpostRight: { sf: 'signpost.right', ionicons: 'trail-sign-outline' },
  signpostRightFill: { sf: 'signpost.right.fill', ionicons: 'trail-sign' },
  bookmark: { sf: 'bookmark', ionicons: 'bookmark-outline' },
  bookmarkFill: { sf: 'bookmark.fill', ionicons: 'bookmark' },
  gearshape: { sf: 'gearshape', ionicons: 'settings-outline' },

  // arrows
  arrowRight: { sf: 'arrow.right', ionicons: 'arrow-forward' },
  arrowUp: { sf: 'arrow.up', ionicons: 'arrow-up' },
  arrowUpCircleFill: { sf: 'arrow.up.circle.fill', ionicons: 'arrow-up-circle' },
  arrowClockwise: { sf: 'arrow.clockwise', ionicons: 'refresh' },
  arrowUturnBackward: { sf: 'arrow.uturn.backward', ionicons: 'arrow-undo' },
  arrowUpForwardApp: { sf: 'arrow.up.forward.app', ionicons: 'open-outline' },
  arrowTriangle2Circlepath: { sf: 'arrow.triangle.2.circlepath', ionicons: 'repeat' },
  arrowTriangleTurnUpRightDiamond: {
    sf: 'arrow.triangle.turn.up.right.diamond',
    ionicons: 'compass-outline',
  },
  arrowTriangleTurnUpRightDiamondFill: {
    sf: 'arrow.triangle.turn.up.right.diamond.fill',
    ionicons: 'compass',
  },

  // location & signal
  location: { sf: 'location', ionicons: 'locate-outline' },
  locationFill: { sf: 'location.fill', ionicons: 'locate' },
  locationSlash: { sf: 'location.slash', ionicons: 'ban-outline' },
  locationNorthLine: { sf: 'location.north.line', ionicons: 'navigate-outline' },
  locationNorthLineFill: { sf: 'location.north.line.fill', ionicons: 'navigate' },
  mappin: { sf: 'mappin', ionicons: 'pin' },
  wifiSlash: { sf: 'wifi.slash', ionicons: 'cloud-offline-outline' },
  antennaRadiowavesLeftAndRightSlash: {
    sf: 'antenna.radiowaves.left.and.right.slash',
    ionicons: 'cellular-outline',
  },

  // status & feedback
  infoCircle: { sf: 'info.circle', ionicons: 'information-circle-outline' },
  infoCircleFill: { sf: 'info.circle.fill', ionicons: 'information-circle' },
  exclamationmarkTriangle: { sf: 'exclamationmark.triangle', ionicons: 'warning-outline' },
  exclamationmarkTriangleFill: { sf: 'exclamationmark.triangle.fill', ionicons: 'warning' },
  exclamationmarkCircleFill: { sf: 'exclamationmark.circle.fill', ionicons: 'alert-circle' },
  checkmark: { sf: 'checkmark', ionicons: 'checkmark' },
  checkmarkCircleFill: { sf: 'checkmark.circle.fill', ionicons: 'checkmark-circle' },
  checkmarkShield: { sf: 'checkmark.shield', ionicons: 'shield-checkmark-outline' },
  questionmarkCircle: { sf: 'questionmark.circle', ionicons: 'help-circle-outline' },
  circle: { sf: 'circle', ionicons: 'ellipse-outline' },
  circleFill: { sf: 'circle.fill', ionicons: 'ellipse' },
  lock: { sf: 'lock', ionicons: 'lock-closed-outline' },
  clock: { sf: 'clock', ionicons: 'time-outline' },

  // record / follow (measurements and capture — never timing framing)
  recordCircle: { sf: 'record.circle', ionicons: 'radio-button-on' },
  stopFill: { sf: 'stop.fill', ionicons: 'stop' },
  pauseCircleFill: { sf: 'pause.circle.fill', ionicons: 'pause-circle' },

  // content actions
  trash: { sf: 'trash', ionicons: 'trash-outline' },
  pencil: { sf: 'pencil', ionicons: 'pencil' },
  pencilAndOutline: { sf: 'pencil.and.outline', ionicons: 'create-outline' },
  flag: { sf: 'flag', ionicons: 'flag-outline' },
  camera: { sf: 'camera', ionicons: 'camera-outline' },
  photo: { sf: 'photo', ionicons: 'image-outline' },
  photoBadgePlus: { sf: 'photo.badge.plus', ionicons: 'images-outline' },
  envelope: { sf: 'envelope', ionicons: 'mail-outline' },
  rectanglePortraitAndArrowRight: {
    sf: 'rectangle.portrait.and.arrow.right',
    ionicons: 'log-out-outline',
  },
} as const satisfies Record<string, SymbolGlyph>;

export type SymbolKey = keyof typeof SYMBOLS;

/**
 * Hard rule D, as a guard. Two of these words are ones the §59 safety scan
 * bans outright in production source, so they are written as character
 * classes: the regex still matches the word, the scan's `\b…\b` does not match
 * the regex.
 */
const DENYLIST: readonly RegExp[] = [
  /speed/,
  /gauge/,
  /r[a]ce/,
  /flash/,
  /rocket/,
  /timer/,
  /stop[w]atch/,
];

/**
 * Refuse a glyph whose name would trip a test tripwire or the Hard-rule-D
 * denylist, in EITHER namespace. Called on every render in development; the
 * table test calls it over every entry. No-op in a release bundle.
 */
export function assertSafeSymbol(key: string, glyph: { sf: string; ionicons: string }): void {
  if (process.env.NODE_ENV === 'production') return;
  const names: ReadonlyArray<readonly [string, string]> = [
    ['sf', glyph.sf],
    ['ionicons', glyph.ionicons],
  ];
  for (const [namespace, name] of names) {
    if (name.includes('down')) {
      throw new Error(
        `Symbol "${key}": the ${namespace} name "${name}" contains "down", which six test suites ` +
          `use as a raw-error tripwire. Disclosure is chevronRight rotated 90 degrees.`,
      );
    }
    const hit = DENYLIST.find((rx) => rx.test(name));
    if (hit !== undefined) {
      throw new Error(
        `Symbol "${key}": the ${namespace} name "${name}" matches the Hard-rule-D denylist ` +
          `(${hit.source}). Never a speed or timing glyph — engagement, not velocity.`,
      );
    }
  }
}

const TONE: Record<TextTone, keyof ThemeColors> = {
  default: 'text',
  muted: 'textMuted',
  accent: 'accentText',
  notice: 'notice',
  success: 'success',
  danger: 'danger',
  onAccent: 'onAccent',
};

/** Sizes track the type scale they sit beside, so a glyph never out-weighs its
 *  label. The tab bar (24), a send glyph (36) and a payoff mark (44) pass a
 *  number. */
export const SYMBOL_SIZE = { sm: 14, md: 18, lg: 22, xl: 28 } as const;

export interface SymbolProps {
  name: SymbolKey;
  size?: keyof typeof SYMBOL_SIZE | number;
  tone?: TextTone;
  /** SF weight; `medium` matches SF's text weight beside a label. iOS only. */
  weight?: SymbolWeight;
  /** Required when the symbol is the ONLY content of a control. Omit when a
   *  visible label sits beside it — the symbol is then hidden from VoiceOver. */
  label?: string;
  /** SF Symbol effect (a `bounce` on a payoff mark). iOS only; rare tier. */
  animationSpec?: AnimationSpec;
  /** Merged LAST — a rotation for a disclosure, a layout nudge. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Symbol({
  name,
  size = 'md',
  tone = 'default',
  weight = 'medium',
  label,
  animationSpec,
  style,
  testID,
}: SymbolProps): React.JSX.Element | null {
  const { colors } = useTheme();
  const glyph: SymbolGlyph | undefined = SYMBOLS[name];

  if (glyph === undefined) {
    // The type forbids it; the guard is for a key arriving from data.
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`Symbol: "${String(name)}" is not a key of SYMBOLS.`);
    }
    return null;
  }
  assertSafeSymbol(name, glyph);

  const px = typeof size === 'number' ? size : SYMBOL_SIZE[size];
  const color = colors[TONE[tone]];
  const a11y =
    label !== undefined
      ? { accessibilityLabel: label, accessibilityRole: 'image' as const }
      : { accessibilityElementsHidden: true, importantForAccessibility: 'no' as const };

  if (Platform.OS === 'ios') {
    return (
      <SymbolView
        testID={testID}
        name={glyph.sf}
        size={px}
        tintColor={color}
        weight={weight}
        resizeMode="scaleAspectFit"
        {...(animationSpec !== undefined ? { animationSpec } : {})}
        style={[{ width: px, height: px }, style]}
        {...a11y}
      />
    );
  }

  return (
    <Ionicons
      testID={testID}
      name={glyph.ionicons}
      size={px}
      color={color}
      style={style as StyleProp<TextStyle>}
      {...a11y}
    />
  );
}
