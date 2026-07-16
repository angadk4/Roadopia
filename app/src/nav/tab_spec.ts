/**
 * The bottom-tab inventory (Master Spec §16: "Map · Plan · Create/Record ·
 * Saved/Profile"). Pure data — node-testable without touching React Navigation.
 * Icon names are Ionicons glyphs (@expo/vector-icons ships inside `expo`).
 */

export interface TabSpec {
  /** Route name + label. */
  name: 'Map' | 'Plan' | 'Create' | 'Saved';
  /** Ionicons glyph when the tab is focused. */
  icon: string;
  /** Ionicons glyph when idle (outline variant). */
  iconIdle: string;
}

export const TAB_SPEC: readonly TabSpec[] = [
  { name: 'Map', icon: 'map', iconIdle: 'map-outline' },
  { name: 'Plan', icon: 'compass', iconIdle: 'compass-outline' },
  { name: 'Create', icon: 'add-circle', iconIdle: 'add-circle-outline' },
  { name: 'Saved', icon: 'bookmark', iconIdle: 'bookmark-outline' },
] as const;
