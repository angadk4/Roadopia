/**
 * Roadopia design tokens (M7-T01).
 *
 * Dark-first with a full light palette (§19 — "dark-first with a light option";
 * §663/§667 contrast verified on BOTH themes). Amber is the accent AND the
 * route-line colour; the palette here matches the SPK-01-verified line colours
 * so the map and the chrome stay one family.
 *
 * The owner's M7 UI acceptance bar (recorded 2026-07-16, decision log):
 *   - real buttons that LOOK tappable,
 *   - hit targets ≥ 44 pt (HIT_TARGET below — use it, don't hard-code),
 *   - deliberate panel sizing/contrast.
 * Hard rule D: no speed/racing framing anywhere, including token names.
 */

import { useColorScheme } from 'react-native';

/** Route-line amber (SPK-01-verified against dark + light map styles). */
export const AMBER = '#f4a319';
/** High-curvature highlight — brighter/thicker treatment vs the base line (§663). */
export const AMBER_BRIGHT = '#ffd54a';

export interface ThemeColors {
  /** Screen background. */
  bg: string;
  /** Panel / card background, one step above bg. */
  surface: string;
  /** Raised elements (sheets, tab bar) — highest surface. */
  surfaceRaised: string;
  /** Primary text. */
  text: string;
  /** Secondary text — still ≥ 4.5:1 on `surface`. */
  textMuted: string;
  /** Hairline borders / dividers. */
  border: string;
  /** The accent (amber) — buttons, active tab, links. */
  accent: string;
  /** Text ON an accent-filled control (contrast against amber). */
  onAccent: string;
  /** Honest-failure text (errors, violated constraints). */
  danger: string;
  /** Satisfied / success. */
  success: string;
  /** Relaxed-constraint / disclosure notes. */
  warn: string;
}

export const darkColors: ThemeColors = {
  bg: '#11151a',
  surface: '#1a2027',
  surfaceRaised: '#222a33',
  text: '#f4f6f8',
  textMuted: '#a9b4c0',
  border: '#333d48',
  accent: AMBER,
  onAccent: '#231a05',
  danger: '#ff7a70',
  success: '#63d68f',
  warn: '#ffd54a',
};

export const lightColors: ThemeColors = {
  bg: '#f6f7f9',
  surface: '#ffffff',
  surfaceRaised: '#ffffff',
  text: '#171c22',
  textMuted: '#5a6672',
  border: '#d9dee5',
  accent: '#c07d0a', // darker amber so text/icons keep contrast on light ground
  onAccent: '#ffffff',
  danger: '#c23934',
  success: '#1e8e4e',
  warn: '#8a6a00',
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

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16 } as const;

export const font = {
  /** Screen titles. */
  title: { fontSize: 22, fontWeight: '700' } as const,
  /** Section headings inside panels. */
  heading: { fontSize: 16, fontWeight: '600' } as const,
  /** Body copy. */
  body: { fontSize: 15, fontWeight: '400' } as const,
  /** Captions, footnotes, attribution. */
  caption: { fontSize: 12, fontWeight: '400' } as const,
  /** Button labels — weighty enough to read as tappable. */
  button: { fontSize: 16, fontWeight: '600' } as const,
} as const;
