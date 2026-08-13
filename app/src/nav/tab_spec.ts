/**
 * The bottom-tab inventory (Master Spec §16: "Map · Plan · Create/Record ·
 * Saved/Profile"). Pure data — node-testable without touching React Navigation.
 * Icon names are Ionicons glyphs (@expo/vector-icons ships inside `expo`).
 */

export interface TabSpec {
  /** Route name + label. */
  name: 'Map' | 'Discover' | 'Plan' | 'Create' | 'Saved';
  /** Ionicons glyph when the tab is focused. */
  icon: string;
  /** Ionicons glyph when idle (outline variant). */
  iconIdle: string;
}

// R23: Discover (a browse-forward surface) takes the slot of the not-yet-built
// Create/Record tab (M9). trail-sign = road/route signage — engagement, no
// speed/racing framing (Hard rule D).
// R24-U10: Discover becomes the PRIMARY/home tab (the map-first showpiece) — it
// leads the bar; Plan (and its loops) stays; Map + Saved follow.
// M9: the Create/Record tab (Master Spec §16) joins — Discover keeps the lead
// slot it earned at R24-U10; Create sits mid-bar between planning and library.
export const TAB_SPEC: readonly TabSpec[] = [
  { name: 'Discover', icon: 'trail-sign', iconIdle: 'trail-sign-outline' },
  { name: 'Plan', icon: 'compass', iconIdle: 'compass-outline' },
  { name: 'Create', icon: 'create', iconIdle: 'create-outline' },
  { name: 'Map', icon: 'map', iconIdle: 'map-outline' },
  { name: 'Saved', icon: 'bookmark', iconIdle: 'bookmark-outline' },
] as const;
