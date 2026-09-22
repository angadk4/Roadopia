/**
 * Contrast is MEASURED, not asserted in a comment (BD-204).
 *
 * The previous token file carried the line "contrast verified on BOTH themes".
 * It was true only of body text, and nothing checked it. Meanwhile the test
 * stub's `useColorScheme` returned 'dark' unconditionally, so no test in the
 * app's history had ever rendered `lightColors` — and under that cover, light
 * `surface` and `surfaceRaised` both shipped as #ffffff (an elevation ladder
 * with no rungs) and the light accent sat below contrast on primary buttons.
 *
 * This file computes WCAG 2.1 relative luminance over BOTH palettes on every
 * run, so a token can no longer claim a ratio it does not have.
 */

import { describe, expect, it } from 'vitest';

import {
  AMBER,
  colorsFor,
  darkColors,
  font,
  HIT_TARGET,
  lightColors,
  material,
  motion,
  radius,
  spacing,
  spotColor,
  spotColors,
  withAlpha,
  type ThemeColors,
  type ThemeName,
} from '../theme';

/** WCAG 2.1 relative luminance of a 6-digit hex. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channel = (i: number): number => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** WCAG contrast ratio, 1..21. */
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Body-text floor (WCAG AA). */
const TEXT_MIN = 4.5;
/** Large text and UI boundaries (WCAG AA non-text). */
const UI_MIN = 3;

const THEMES: Array<[ThemeName, ThemeColors]> = [
  ['dark', darkColors],
  ['light', lightColors],
];

describe.each(THEMES)('%s palette contrast', (name, c) => {
  const grounds: Array<[string, string]> = [
    ['bg', c.bg],
    ['fill', c.fill],
    ['surface', c.surface],
    ['surfaceRaised', c.surfaceRaised],
  ];

  it.each(grounds)(`primary text is legible on %s`, (_label, ground) => {
    expect(contrast(c.text, ground)).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it.each(grounds)(`secondary text is legible on %s`, (_label, ground) => {
    // textMuted carries honest status copy — the product's differentiator.
    // It is held to the BODY floor, not the large-text one.
    expect(contrast(c.textMuted, ground)).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it('the index rule can carry a control boundary on every ground', () => {
    for (const [, ground] of grounds) {
      expect(contrast(c.borderStrong, ground)).toBeGreaterThanOrEqual(UI_MIN);
    }
  });

  it('the contour line is decorative and is DOCUMENTED as sub-threshold', () => {
    // Not a failure — a declared exemption. `hairline` is a texture, never the
    // only thing drawing a control. If this ever rises above UI_MIN the comment
    // in theme.ts is wrong and the two-weight system has collapsed into one.
    expect(contrast(c.hairline, c.surface)).toBeLessThan(UI_MIN);
  });

  it('a label on an amber fill is legible', () => {
    expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(TEXT_MIN);
  });

  it('a destructive control is drawn in danger ON the ground, never as a fill', () => {
    // THE GAP THIS CLOSES. The test above measures `onAccent` on `accent` (6.39:1
    // light) and nothing measured `onAccent` on `danger` — which is how
    // Button variant="danger" shipped as a DANGER FILL with an `onAccent` label
    // at 2.19:1 in light (#2a1f06 on #a4231c), half the 4.5:1 body floor. It was
    // unused, so nothing shipped broken; it was a trap sitting in the library.
    //
    // `danger` is now the FOREGROUND of an outlined control: the label and the
    // 1px ring are both drawn in it, over whatever ground the caller used. So
    // the pairing is measured on EVERY ground, on both palettes — a destructive
    // button can land on a page, inside a panel, or on a card over the map.
    // The tightest is dark `surfaceRaised` at 5.02:1.
    //
    // A faint danger tint behind the label was measured too and rejected: at 12%
    // over dark `surfaceRaised` it drops the label to 4.15:1. A primitive has to
    // be legible on every surface it can be dropped onto, so the fill stays
    // transparent — asserted on the component in ui.test.tsx.
    // The label and the ring are the same two colours, so ONE measurement per
    // ground covers both roles — as long as the label's floor stays the tighter
    // of the two, which this pins.
    expect(TEXT_MIN).toBeGreaterThan(UI_MIN);
    for (const [, ground] of grounds) {
      expect(contrast(c.danger, ground)).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  it('every semantic foreground is legible on bg and on surface', () => {
    for (const token of ['accentText', 'notice', 'success', 'danger'] as const) {
      expect(contrast(c[token], c.bg)).toBeGreaterThanOrEqual(TEXT_MIN);
      expect(contrast(c[token], c.surface)).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  it('raw AMBER is never used as a foreground token', () => {
    // The bug this prevents: raw #f4a319 measures ~2.08:1 on white. Amber is
    // the FILL colour; `accentText` is the foreground one.
    if (name === 'light') {
      expect(c.accentText).not.toBe(AMBER);
      expect(contrast(AMBER, c.surfaceRaised)).toBeLessThan(TEXT_MIN);
    }
  });

  it('the elevation ladder has distinct rungs', () => {
    // The shipped bug: light surface === surfaceRaised === #ffffff, so a card
    // over a panel was the same object.
    const rungs = [c.fill, c.bg, c.surface, c.surfaceRaised];
    expect(new Set(rungs).size).toBe(rungs.length);
  });

  it('the ground is warm — the direction, encoded', () => {
    // R > B on both themes. The previous palette was cool blue-grey (#11151a,
    // #f6f7f9), which is the generated-app default the redesign refuses.
    const h = c.bg.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const b = parseInt(h.slice(4, 6), 16);
    expect(r).toBeGreaterThan(b);
  });
});

describe('token contract', () => {
  it('colorsFor resolves both themes and defaults dark', () => {
    expect(colorsFor('light')).toBe(lightColors);
    expect(colorsFor('dark')).toBe(darkColors);
  });

  it('legacy aliases still resolve (89 border + 16 warn call sites)', () => {
    for (const [, c] of THEMES) {
      expect(c.border).toBe(c.hairline);
      expect(c.warn).toBe(c.notice);
    }
  });

  it('the type scale has real hierarchy', () => {
    // The flatness that read as generic: the old scale spanned 12–22pt.
    expect(font.display.fontSize / font.legend.fontSize).toBeGreaterThanOrEqual(2.5);
    // Every role carries leading and tracking, not just a size.
    for (const role of Object.values(font)) {
      expect(role.lineHeight).toBeGreaterThan(role.fontSize);
      expect(typeof role.letterSpacing).toBe('number');
    }
  });

  it('spacing is a ladder with a single screen gutter', () => {
    const ladder = [
      spacing.xs,
      spacing.sm,
      spacing.md,
      spacing.lg,
      spacing.xl,
      spacing.xxl,
      spacing.xxxl,
    ];
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]!).toBeGreaterThan(ladder[i - 1]!);
    expect(spacing.gutter).toBe(20);
  });

  it('radius is semantic, with a real pill', () => {
    expect(radius.pill).toBeGreaterThan(100);
    expect(radius.xl).toBeGreaterThan(radius.lg);
  });

  it('the hit target keeps the owner-recorded floor', () => {
    expect(HIT_TARGET).toBeGreaterThanOrEqual(44);
  });

  it('withAlpha produces a valid 8-digit hex and clamps', () => {
    expect(withAlpha('#112233', 1)).toBe('#112233ff');
    expect(withAlpha('#112233', 0)).toBe('#11223300');
    expect(withAlpha('#112233', 0.5)).toMatch(/^#112233[0-9a-f]{2}$/);
    expect(withAlpha('#112233', 5)).toBe('#112233ff');
    expect(withAlpha('#112233', -1)).toBe('#11223300');
  });

  it('spot colours are one table, and an unknown type is neutral not amber', () => {
    // The shipped drift: MapHome carried 7 types, RouteDetail 6 — a `meetup`
    // stop on a saved drive drew with no colour at all.
    expect(Object.keys(spotColors)).toContain('meetup');
    expect(spotColor('coffee')).toBe(spotColors['coffee']);
    expect(spotColor('not_a_real_type')).not.toBe(AMBER);
    expect(spotColor('not_a_real_type')).toBe('#8a93a6');
  });
});

describe('motion tokens (Reanimated — SPEC "Shell chrome > Motion tokens")', () => {
  it("springs are Apple's two designer parameters — a finger may overshoot, a settle may not", () => {
    expect(motion.spring.sheet).toEqual({ duration: 300, dampingRatio: 0.8 });
    expect(motion.spring.settle).toEqual({ duration: 400, dampingRatio: 1 });
    // dampingRatio 1 is critical damping: no overshoot when nothing pushed it.
    expect(motion.spring.settle.dampingRatio).toBe(1);
    // The sheet is the ONE sub-critical spring, and it is handed the gesture's
    // velocity — bounce only when momentum was carried in.
    expect(motion.spring.sheet.dampingRatio).toBeLessThan(1);
    expect(motion.spring.sheet.duration).toBeLessThanOrEqual(300);
    expect(motion.spring.settle.duration).toBeLessThanOrEqual(400);
  });

  it('eases are four cubic-bezier control points, and none is an ease-in', () => {
    expect(motion.ease.out).toEqual([0.23, 1, 0.32, 1]);
    expect(motion.ease.inOut).toEqual([0.77, 0, 0.175, 1]);
    expect(motion.ease.sheet).toEqual([0.32, 0.72, 0, 1]);
    for (const pts of Object.values(motion.ease)) {
      expect(pts).toHaveLength(4);
      const [x1, y1, x2, y2] = pts;
      // x handles must stay inside the unit interval or the curve is not a function.
      expect(x1).toBeGreaterThanOrEqual(0);
      expect(x1).toBeLessThanOrEqual(1);
      expect(x2).toBeGreaterThanOrEqual(0);
      expect(x2).toBeLessThanOrEqual(1);
      expect(y1).toBeGreaterThanOrEqual(0);
      // Every curve ARRIVES flat (y2 = 1): nothing trails off into an ease-in tail.
      expect(y2).toBe(1);
    }
    // The two UI curves START fast — an ease-in delays the exact moment the
    // user is watching (expo-animation §5).
    expect(motion.ease.out[1]).toBeGreaterThan(motion.ease.out[0]);
    expect(motion.ease.sheet[1]).toBeGreaterThan(motion.ease.sheet[0]);
  });

  it('press feedback sits in the 100–150 ms band; Reduce Motion shortens, never removes', () => {
    expect(motion.press).toBeGreaterThanOrEqual(100);
    expect(motion.press).toBeLessThanOrEqual(150);
    expect(motion.pressScale).toBeLessThan(1);
    expect(motion.pressScaleReduced).toBeLessThan(1);
    expect(motion.pressScaleReduced).toBeGreaterThan(motion.pressScale);
  });

  it('exits are softer than entrances, and the stagger is capped', () => {
    expect(motion.exit).toBeLessThan(motion.enter);
    expect(motion.enterFade).toBeLessThan(motion.enter);
    // The last staggered sibling never waits longer than one entrance.
    expect(motion.stagger * motion.staggerCap).toBeLessThanOrEqual(motion.enter);
  });
});

describe('material tokens', () => {
  it('overlay alphas are alphas — non-contrast-bearing, because ink never sits on a material', () => {
    // A material's contents are opaque tiers (surface / fill / surfaceRaised),
    // whose contrast the palette suites above measure. The overlay only tunes
    // how much of the map shows through, so it has no floor to clear — but it
    // must be an ALPHA, or `withAlpha` would silently produce an invalid colour.
    for (const alpha of Object.values(material.overlay)) {
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(1);
    }
    // The dense band (Follow's status line) is heavier than the standard one.
    expect(material.overlay.dense).toBeGreaterThan(material.overlay.dark);
    // BlurView takes 1–100.
    expect(material.intensity).toBeGreaterThanOrEqual(1);
    expect(material.intensity).toBeLessThanOrEqual(100);
    // …and the composed overlay is a valid 8-digit colour on both palettes.
    for (const [, c] of THEMES) {
      expect(withAlpha(c.bg, material.overlay.dark)).toMatch(/^#[0-9a-f]{8}$/);
      expect(withAlpha(c.surface, material.overlay.light)).toMatch(/^#[0-9a-f]{8}$/);
      expect(withAlpha(c.bg, material.overlay.dense)).toMatch(/^#[0-9a-f]{8}$/);
    }
  });

  it('the header tints are alphas, and the no-blur one carries more paper', () => {
    // `nav/screen_options.ts` tints the native header with these (SPEC
    // "Headers": 0.55 over the chrome material; 0.85 where nothing blurs).
    // Without a blur under it a tint has to do the whole job of separating
    // the bar from scrolling content, so it must be the heavier of the two.
    for (const alpha of Object.values(material.header)) {
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(1);
    }
    expect(material.header.tintNoBlur).toBeGreaterThan(material.header.tint);
    for (const [, c] of THEMES) {
      expect(withAlpha(c.bg, material.header.tint)).toMatch(/^#[0-9a-f]{8}$/);
      expect(withAlpha(c.bg, material.header.tintNoBlur)).toMatch(/^#[0-9a-f]{8}$/);
    }
  });
});
