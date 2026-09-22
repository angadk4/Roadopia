/**
 * The bottom-tab inventory (Master Spec §16: "Map · Plan · Create/Record ·
 * Saved/Profile"). Pure data — node-testable without touching React Navigation.
 *
 * Each tab carries TWO glyph pairs (redesign — SPEC "Navigation & IA"):
 * `symbol` / `symbolFilled` are SF Symbol names, rendered on iOS through the
 * `Symbol` primitive (which looks the name up in its semantic table, so every
 * name here MUST be a glyph `SYMBOLS` knows — `tab_spec.test` pins it); `icon`
 * / `iconIdle` are the Ionicons twins, kept for Android and as the record of
 * which Ionicons glyph means the same thing. The filled form is ALWAYS the idle
 * name plus `.fill` — the focused/idle pair is one glyph in two weights, never
 * two glyphs.
 *
 * No name contains `down` (six suites use it as a raw-error tripwire) and none
 * matches the Hard-rule-D denylist, which includes `gauge`: a tab is a place,
 * never a speed or timing framing.
 */

export interface TabSpec {
  /** Route name + label. */
  name: 'Map' | 'Plan' | 'Create' | 'Saved';
  /** SF Symbol when idle (the outline form). iOS, via `Symbol`. */
  symbol: string;
  /** SF Symbol when focused — `symbol` + `.fill`, always. */
  symbolFilled: string;
  /** Ionicons glyph when the tab is focused. */
  icon: string;
  /** Ionicons glyph when idle (outline variant). */
  iconIdle: string;
}

// R23: Discover (a browse-forward surface) took the slot of the not-yet-built
// Create/Record tab (M9); R24-U10 made it the PRIMARY/home tab; M9 added
// Create. REDESIGN (SPEC "The tab bar — four tabs"): Discover and Map were two
// tabs on the same map — the same region, the same lines, two sets of chrome —
// so they are ONE. `MapHome` absorbed the scan (its shelf's Near-you mode), and
// Map takes the lead slot Discover held, keeping the map-first opening screen.
// The name stays "Map" (Master Spec §16's inventory), which also keeps
// `MapStack`, `tabBarHiddenFor('MapHome')` and the MapHome suites untouched.
// Create's Ionicons pair follows its SF glyph (a plus circle, the "make one"
// mark) rather than the old pencil-square.
export const TAB_SPEC: readonly TabSpec[] = [
  { name: 'Map', symbol: 'map', symbolFilled: 'map.fill', icon: 'map', iconIdle: 'map-outline' },
  {
    name: 'Plan',
    symbol: 'arrow.triangle.turn.up.right.diamond',
    symbolFilled: 'arrow.triangle.turn.up.right.diamond.fill',
    icon: 'compass',
    iconIdle: 'compass-outline',
  },
  {
    name: 'Create',
    symbol: 'plus.circle',
    symbolFilled: 'plus.circle.fill',
    icon: 'add-circle',
    iconIdle: 'add-circle-outline',
  },
  {
    name: 'Saved',
    symbol: 'bookmark',
    symbolFilled: 'bookmark.fill',
    icon: 'bookmark',
    iconIdle: 'bookmark-outline',
  },
] as const;

/**
 * Screens that OWN the phone while open — a live GPS stream and a wake-lock
 * (follow-mode, recording). The tab bar hides under them so the only ways out
 * (Exit, back) UNMOUNT them and release both. With the bar visible a tab
 * switch left the stream and the wake-lock running for hours (review finding,
 * 2026-09-07). Recording in particular must never be paused on blur: points
 * driven on another tab would be silently missing from the trace.
 */
export const OWNS_THE_PHONE: readonly string[] = ['Follow', 'Record'];

/** Whether the bottom tab bar hides for the nested screen currently focused. */
export function tabBarHiddenFor(nestedRouteName: string | undefined): boolean {
  return nestedRouteName !== undefined && OWNS_THE_PHONE.includes(nestedRouteName);
}
