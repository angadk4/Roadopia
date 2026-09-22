/**
 * Roadopia design tokens — "Contour" (BD-204, 2026-09-11).
 *
 * WHY THIS EXISTS IN THIS FORM. The owner's verdict on the previous system was
 * that the app looked generic. An audit measured why, and the numbers were the
 * argument: a "card" sat 1.12:1 above the ground with a 1.49:1 border in dark
 * mode (1.07:1 and 1.35:1 in light), which is below what an eye resolves on
 * device — so the panels were not subtle, they were invisible, and the screens
 * read as floating text runs. The same `{borderWidth:1, radius.lg, padding.lg}`
 * object was copy-pasted into five files with no shared component. One amber
 * carried twelve unrelated meanings. The type scale spanned 12–22pt, which is
 * no hierarchy at all. And `useColorScheme` in the test stub returned 'dark'
 * unconditionally, so the light palette had NEVER been rendered by a test —
 * under that cover, light `surface` and `surfaceRaised` both shipped as
 * #ffffff (no elevation ladder) and the light accent sat below contrast on
 * every primary button.
 *
 * THE DIRECTION. The chrome behaves like the margin of a printed chart rather
 * than an app that happens to contain a map. Three moves carry it:
 *   1. A WARM ground — warm ink in dark, paper in light — instead of the cool
 *      blue-grey every generated RN app ships. The spot pins were already
 *      earthy (#b07b4f, #d1704f, #7f9a6b); the cool chrome was the thing out
 *      of family. This makes the SPK-01 amber the one saturated colour in the
 *      system, so the map stops competing with the chrome.
 *   2. TWO RULE WEIGHTS, borrowed from contour drawing: `hairline` is
 *      decorative and deliberately sub-3:1; `borderStrong` is the index rule
 *      and is the ONLY token allowed to carry a control boundary.
 *   3. Amber demoted to ONE job — the action colour. Disclosure moved to the
 *      teal family already on the map (`viewpoint` #4fb0a5), so "worth
 *      knowing" keeps meaning what it already meant to this product.
 *
 * CONTRAST IS MEASURED, NOT ASSERTED. Every ratio below is computed by
 * `theme.test.ts` over BOTH palettes on every run. Text ≥ 4.5:1, large text
 * and control boundaries ≥ 3:1. `hairline` is the one documented exemption.
 *
 * BACKWARD COMPATIBILITY IS DELIBERATE. `colors.border` (89 call sites),
 * `colors.warn` (16) and `font.{title,heading,body,caption,button}` (155) all
 * still resolve, so this lands without one unreviewable change; screens adopt
 * the new roles deliberately, with green tests at each step.
 *
 * The owner's recorded UI bar still governs: buttons must LOOK tappable, hit
 * targets ≥ HIT_TARGET, deliberate panel sizing and contrast.
 * Hard rule D: no speed/racing framing anywhere, including token names — the
 * record clock and the drive duration are `stat`/`statLg`, never timing words.
 */

import { useColorScheme } from 'react-native';

/** Route-line amber (SPK-01-verified against dark + light map styles). */
export const AMBER = '#f4a319';
/** High-curvature highlight — brighter/thicker treatment vs the base line (§663).
 *  Doubles as the 1px top edge on an amber fill: one hex, two jobs, both light. */
export const AMBER_BRIGHT = '#ffd54a';

/**
 * Append an alpha channel to a 6-digit hex.
 *
 * Retires the `colors.surfaceRaised + 'CC'` / `+ 'F2'` concatenations
 * (DriveLinesMap, MapHome): those silently produce an INVALID colour the
 * moment the token they are concatenated onto is not 6-digit hex, and the
 * failure is a transparent view rather than an error.
 */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/** Spot-marker colours by DB spot type — ONE table for the whole app.
 *  Previously duplicated and divergent: MapHome carried 7 types, RouteDetail
 *  6 (no `meetup`), so a meetup stop on a saved drive drew with no colour. */
export const spotColors: Readonly<Record<string, string>> = {
  coffee: '#b07b4f',
  food: '#d1704f', // restaurants + fast food (R16-1)
  viewpoint: '#4fb0a5',
  fuel: '#8a93a6',
  rest: '#7f9a6b',
  great_road: AMBER,
  meetup: '#a97fd1',
};

/** Fallback for a spot type the app does not know (honest neutral, never amber). */
export const SPOT_FALLBACK = '#8a93a6';

export function spotColor(type: string): string {
  return spotColors[type] ?? SPOT_FALLBACK;
}

export interface ThemeColors {
  /** The ground — "the paper". */
  bg: string;
  /** RECESSED tier, beneath `surface`: inputs, segmented tracks, secondary
   *  button grounds, the attribution pill. Without it an input sits at the
   *  same level as the panel containing it. */
  fill: string;
  /** Level-1 panel: grouped/inset content belonging to the page. */
  surface: string;
  /** Level-2/3: cards, and anything floating over the live map. */
  surfaceRaised: string;
  /** Primary ink, warmed to match the ground (deliberately not pure white). */
  text: string;
  /** Secondary copy, legend labels, honest status notes. ≥ 4.5:1 on all grounds. */
  textMuted: string;
  /** The CONTOUR line — decorative separation only. Sub-3:1 BY DESIGN: it is a
   *  texture, not a boundary, and must never be the only thing drawing a
   *  control. Use `borderStrong` for anything structural. */
  hairline: string;
  /** The INDEX RULE — every boundary doing structural work: control outlines,
   *  unselected chips, input borders, section rules. ≥ 3:1 on both themes. */
  borderStrong: string;
  /** Legacy alias for `hairline` (89 call sites). Prefer the explicit token. */
  border: string;
  /** Neutral DATA mark: the getting-there/home segments of the legs bar. */
  contour: string;
  /** The ONE action colour: the single filled primary per screen, selection,
   *  and the map line. Never a foreground colour — see `accentText`. */
  accent: string;
  /** The label on an amber fill. Warm ink in both themes. */
  onAccent: string;
  /** Amber as FOREGROUND (link, provenance, amber-on-ground text). Light needs
   *  a darker amber than the fill: raw AMBER measures 2.08:1 on white. */
  accentText: string;
  /** Tinted control fill — an outlined button that has to carry some weight. */
  accentTint: string;
  /** The GRATICULE — disclosure, relaxed constraints, "planned live instead".
   *  The teal family already on the map, so it does not invent a new hue. */
  notice: string;
  /** Legacy alias for `notice` (16 call sites). */
  warn: string;
  /** Satisfied constraint, "Saved to your drives", "Spot added". */
  success: string;
  /** Honest failure, violated constraint, destructive action. */
  danger: string;
  /** 1px top edge on an ELEVATED surface — light catching an edge. */
  topEdge: string;
  /** Modal dim behind the sign-in sheet. */
  scrim: string;
}

const darkBase = {
  bg: '#141311',
  fill: '#1e1c19',
  surface: '#292724',
  surfaceRaised: '#35322e',
  text: '#f5f2ec',
  textMuted: '#b6aea0',
  hairline: '#5a5348',
  borderStrong: '#8d8574',
  contour: '#7e7767',
  accent: AMBER,
  onAccent: '#231a05',
  accentText: AMBER,
  accentTint: 'rgba(244,163,25,0.14)',
  notice: '#6fc2c0',
  success: '#8fc98a',
  danger: '#ff7a70',
  topEdge: 'rgba(255,255,255,0.07)',
  scrim: 'rgba(8,7,5,0.55)',
} as const;

export const darkColors: ThemeColors = {
  ...darkBase,
  border: darkBase.hairline,
  warn: darkBase.notice,
};

const lightBase = {
  bg: '#ece7de',
  fill: '#e3ddd2',
  surface: '#f8f5ef',
  surfaceRaised: '#ffffff',
  text: '#1c1810',
  // Both of these are set by the RECESSED tier, not by the page ground: on
  // `fill` #e3ddd2 the first-pass values measured 4.44:1 and 2.84:1, under
  // both bars. Darkened until the tightest ground clears — 4.87:1 and 3.32:1.
  textMuted: '#655c4d',
  hairline: '#d2c9b8',
  borderStrong: '#7f7666',
  contour: '#877b64',
  accent: '#e0920f',
  onAccent: '#2a1f06',
  accentText: '#8a5200',
  accentTint: 'rgba(224,146,15,0.14)',
  notice: '#1f6f73',
  success: '#2e6b35',
  danger: '#a4231c',
  topEdge: 'rgba(255,255,255,0.90)',
  scrim: 'rgba(28,24,16,0.32)',
} as const;

export const lightColors: ThemeColors = {
  ...lightBase,
  border: lightBase.hairline,
  warn: lightBase.notice,
};

export type ThemeName = 'dark' | 'light';

export function colorsFor(theme: ThemeName): ThemeColors {
  return theme === 'light' ? lightColors : darkColors;
}

/** Resolve the active theme from the OS (dark when undecided — dark-first, §19). */
export function useTheme(): { name: ThemeName; colors: ThemeColors } {
  const scheme = useColorScheme();
  const name: ThemeName = scheme === 'light' ? 'light' : 'dark';
  return { name, colors: colorsFor(name) };
}

/** Minimum touch-target size in pt (the owner's M7 UI bar; Apple HIG floor). */
export const HIT_TARGET = 44;

/** Height of the Mapbox attribution strip. FR-014 forbids covering it, and the
 *  clearance was hardcoded as 40 / 44 / 104 / 132 at four sites with the reason
 *  in a comment; derive from this instead so the relationship survives edits. */
export const ATTRIBUTION_STRIP_H = 24;

/**
 * The 4pt scale, plus `gutter` — the ONE screen-edge padding for the whole app.
 * 20pt is the iOS reading margin; it ends the 24 → 24 → 16 drift across Plan →
 * Progress → Result, which on a native push is visible as the page sliding in
 * misaligned.
 *
 * Identical 16 everywhere is a named generic tell, so space carries meaning:
 * intra-row 4–8 < row 8–12 < group 16 < section 24 < chapter 48.
 */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  gutter: 20,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Radius is SEMANTIC, not uniform: a 44pt chip at radius 12 is a rounded box,
 *  not an iOS capsule, and one radius on a sheet, a card and a panel is why
 *  four different surfaces read as one object. */
export const radius = {
  /** Tags, inner elements of a padded panel (concentric: inner = outer − padding). */
  sm: 8,
  /** Inputs and standard buttons. */
  md: 12,
  /** Page-level panels. */
  lg: 16,
  /** Floating over the live map, and the sign-in sheet — visibly not a card. */
  xl: 22,
  /** Chips, badges, segmented thumbs. */
  pill: 999,
} as const;

/** iOS is continuous-curvature system-wide; circular arcs read web-ported on a
 *  3x display. Supported by RN 0.83 (StyleSheetTypes), ignored elsewhere.
 *  Spread onto every non-pill rounded surface. */
export const squircle = { borderCurve: 'continuous' } as const;

/**
 * Depth. The previous system had no shadow anywhere and signalled elevation
 * with a 12% luminance step, which is invisible on device. Fill step + shadow
 * + a 1px `topEdge` is three signals instead of one.
 *
 * RN 0.83 ships `boxShadow`, so this needs no dependency. Shadows are NOT
 * animatable on the native driver — animate transform/opacity instead.
 */
export const elevation = {
  /** Level 1: an inset group that belongs to the page. No shadow. */
  flat: {},
  /** Level 2: a card. Reads as lifted without a visible edge. */
  raised: {
    boxShadow: '0px 1px 2px rgba(0,0,0,0.24), 0px 6px 16px rgba(0,0,0,0.18)',
  },
} as const;

/**
 * The type scale. The previous five roles spanned 12–22pt with no lineHeight
 * or letterSpacing at all, which is the flatness the owner was reacting to.
 * System font only — on iOS that is SF, so weight, tracking and leading do the
 * work and no font package is needed.
 *
 * `stat`/`statLg` are for MEASURED VALUES (distance, duration, climb, the
 * record clock). Hard rule D: these are measurements, never timing framing.
 */
export const font = {
  /** The one title that owns a screen. */
  display: { fontSize: 32, fontWeight: '700', lineHeight: 36, letterSpacing: -0.6 } as const,
  /** A measured value given the weight of the screen's payoff. */
  statLg: { fontSize: 28, fontWeight: '700', lineHeight: 30, letterSpacing: -0.5 } as const,
  /** A measured value in a row of them. */
  stat: { fontSize: 22, fontWeight: '700', lineHeight: 26, letterSpacing: -0.4 } as const,
  /** Chapter headings inside a long scroll. */
  title: { fontSize: 24, fontWeight: '700', lineHeight: 29, letterSpacing: -0.4 } as const,
  /** Panel titles and row titles. */
  headline: { fontSize: 17, fontWeight: '600', lineHeight: 22, letterSpacing: -0.2 } as const,
  /** Primary reading copy. */
  body: { fontSize: 16, fontWeight: '400', lineHeight: 23, letterSpacing: 0 } as const,
  /** Emphasis INSIDE a body sentence — replaces reaching for the accent colour. */
  bodyStrong: { fontSize: 16, fontWeight: '600', lineHeight: 23, letterSpacing: 0 } as const,
  /** Every button, chip and segment label. */
  label: { fontSize: 15, fontWeight: '600', lineHeight: 20, letterSpacing: -0.1 } as const,
  /** HONEST STATUS COPY — the product's differentiator, promoted out of caption. */
  footnote: { fontSize: 13, fontWeight: '400', lineHeight: 18, letterSpacing: 0.1 } as const,
  /** The cartographic device: uppercase tracked map-legend labels. */
  legend: { fontSize: 11, fontWeight: '600', lineHeight: 14, letterSpacing: 0.8 } as const,
  /** The attribution pill. Weight 500 because it sits on unpredictable tiles. */
  micro: { fontSize: 11, fontWeight: '500', lineHeight: 14, letterSpacing: 0.2 } as const,

  // --- legacy aliases (155 call sites). Mapped to the NEAREST new role so
  // nothing reflows unexpectedly; prefer the explicit roles above.
  /** @deprecated use `headline`. */
  heading: { fontSize: 17, fontWeight: '600', lineHeight: 22, letterSpacing: -0.2 } as const,
  /** @deprecated use `footnote`. */
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 18, letterSpacing: 0.1 } as const,
  /** @deprecated use `label`. */
  button: { fontSize: 15, fontWeight: '600', lineHeight: 20, letterSpacing: -0.1 } as const,
} as const;

/**
 * Motion.
 *
 * Two generations of code read these numbers at once (redesign, shell phase).
 * The Reanimated builders in `ui/motion.ts` and the CSS-transition press in
 * `ui/PressableScale.tsx` are the target; the RN-`Animated` hooks in
 * `ui/press.ts` / `ui/Motion.tsx` are what every screen still imports until
 * the final sweep deletes them. Both read ONE table, so a duration cannot drift
 * between the two while they coexist.
 *
 * GLOBAL RULE: BOUNCE ONLY WHEN A FINGER CARRIED MOMENTUM IN. `spring.sheet`
 * is the one sub-critical spring, and it is handed the gesture's velocity; a
 * programmatic settle is `spring.settle` at dampingRatio 1 — no overshoot,
 * because nothing pushed it. A tap carries no momentum, so press feedback is a
 * timing curve, never a spring.
 *
 * `ease` holds cubic-bezier control points, not curves: `ui/motion.ts` builds
 * both the Reanimated `Easing.bezier` form (for `withTiming` and the layout
 * builders) and the `cubicBezier` form (for CSS transitions) from the same four
 * numbers. None is an ease-in — an ease-in delays the exact moment the user is
 * watching (expo-animation §5).
 *
 * Only `transform` and `opacity` are free; everything else is a layout pass.
 * The one exception is an absolutely positioned element with no children.
 */
export const motion = {
  /** Press-in must be faster than press-out or the control feels sticky
   *  (the legacy RN-`Animated` hooks; a CSS transition has one duration). */
  pressIn: 110,
  pressOut: 160,
  /** The CSS-transition press (`PressableScale`): one duration both ways,
   *  inside the 100–150 ms press band (expo-animation §5). */
  press: 120,
  /** A cross-fade between two states of one element. */
  crossFade: 140,
  /** An element entering: opacity + a short translate. */
  enter: 240,
  /** A screen's first-moment reveal, staggered. */
  reveal: 260,
  revealStagger: 80,
  /** A row arriving in a live stream. */
  streamRow: 240,
  /** A sheet or panel entering / leaving. */
  sheetIn: 300,
  sheetOut: 220,
  /** The legs bar drawing left to right. */
  draw: 520,
  drawStagger: 70,
  /** The in-flight pulse on the pipeline step, each direction (~0.45 Hz). */
  pulse: 1100,
  /** How far an entering element travels, in pt. */
  enterOffset: 12,
  sheetOffset: 24,
  /** Press feedback scale for a card or button. Full-width ROWS must not
   *  scale — a row that scales drags its own text; those animate their fill. */
  pressScale: 0.97,
  /** The press scale under Reduce Motion: shortened, never removed — a control
   *  with no feedback reads as broken. */
  pressScaleReduced: 0.99,

  // --- Reanimated layout builders (`ui/motion.ts`) -------------------------
  /** `ENTER_FADE`: opacity-only arrival for content swapping in the same slot. */
  enterFade: 200,
  /** `EXIT`: exits are softer and shorter than entrances. */
  exit: 160,
  /** `REFLOW`: a list closing the gap a row left. */
  reflow: 200,
  /** `stagger(i)`: the step between siblings, capped at `staggerCap` so a long
   *  list never makes the reader wait for the tail. */
  stagger: 40,
  staggerCap: 5,

  /**
   * Springs, in Apple's two designer parameters (expo-animation §5). Reanimated
   * takes `{ duration, dampingRatio }` directly; spread one and add `velocity`
   * from the gesture that caused it.
   */
  spring: {
    /** A sheet or drawer released by a finger: `{ ...sheet, velocity }`. */
    sheet: { duration: 300, dampingRatio: 0.8 },
    /** A programmatic settle — no finger, so no overshoot. */
    settle: { duration: 400, dampingRatio: 1 },
  },

  /** Cubic-bezier control points `[x1, y1, x2, y2]` (expo-animation §5). */
  ease: {
    /** Strong ease-out for UI: entering, exiting, press — the default. */
    out: [0.23, 1, 0.32, 1],
    /** On-screen movement and morphing. */
    inOut: [0.77, 0, 0.175, 1],
    /** The iOS sheet curve, for a programmatic detent change. */
    sheet: [0.32, 0.72, 0, 1],
  },
} as const;

/**
 * Material — the translucent chrome (`ui/Material.tsx`): a blur under a paper
 * tint. The numbers live here and not in the component (every non-map literal
 * lives in theme.ts) so the tab bar, the shelf and a pinned bar cannot drift.
 *
 * NOT CONTRAST-BEARING, by construction. Ink is never drawn on a material
 * directly: everything inside a `Material` is an opaque tier (`surface`,
 * `fill`, `surfaceRaised`), which `theme.test.ts` measures. The overlay alphas
 * therefore need no contrast floor — they tune how much of the content
 * beneath shows through, nothing else. `theme.test.ts` pins that they are
 * alphas in (0, 1), not colours.
 */
export const material = {
  /** `BlurView` intensity (1–100). A constant, never a prop, so it cannot be
   *  animated: on Android that re-renders the blur every frame
   *  (expo-animation §4). A material that must appear crossfades its opacity. */
  intensity: 60,
  /** The paper tint over the blur: `bg` in dark, `surface` in light; `dense`
   *  is the heavier band under Follow's status line, always over `bg`. */
  overlay: { dark: 0.62, light: 0.58, dense: 0.72 },
  /** The native header's paper tint (`nav/screen_options.ts`): `withAlpha(bg,
   *  tint)` over `systemChromeMaterial` on iOS; `tintNoBlur` where nothing
   *  blurs under it (Android; the iOS fallback if the tint does not compose
   *  with the effect — SPEC "Headers"). Heavier without a blur, because a
   *  55% tint over scrolling content with nothing softening it is a
   *  legibility problem, not a material. */
  header: { tint: 0.55, tintNoBlur: 0.85 },
} as const;
