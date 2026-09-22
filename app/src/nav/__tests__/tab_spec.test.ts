import { describe, expect, it } from 'vitest';

import { SYMBOLS } from '../../components/ui/Symbol';
import { TAB_SPEC, tabBarHiddenFor } from '../tab_spec';

describe('bottom-tab spec (Master Spec §16; redesign — the four-tab bar)', () => {
  /** IA (SPEC "The tab bar — four tabs"): Discover and Map were two tabs on
   *  the same map, so they merged into one — Map, in the lead slot Discover
   *  held. The bar is four; nothing else about it moved. */
  it('has exactly the four tabs, in order, Map leading', () => {
    expect(TAB_SPEC.map((t) => t.name)).toEqual(['Map', 'Plan', 'Create', 'Saved']);
  });

  it('every tab has focused + idle icon glyphs', () => {
    for (const t of TAB_SPEC) {
      expect(t.icon.length).toBeGreaterThan(0);
      expect(t.iconIdle).toContain('outline');
    }
  });

  /** Redesign shell: the bar draws SF Symbols through `Symbol`. The focused
   *  form is the idle glyph in its filled weight — one glyph, never two — and
   *  no name may contain `down` (six suites use it as a raw-error tripwire;
   *  the expo-symbols stub renders the name as a prop, so it WOULD trip). */
  it('every tab has an SF Symbol pair: filled === idle + ".fill", never a "down" glyph', () => {
    for (const t of TAB_SPEC) {
      expect(t.symbol.length).toBeGreaterThan(0);
      expect(t.symbolFilled).toBe(`${t.symbol}.fill`);
      expect(t.symbol).not.toContain('down');
      expect(t.symbolFilled).not.toContain('down');
    }
  });

  /** tabs.tsx resolves each SF name to a `SymbolKey` at module load and
   *  throws on a miss; pinning it on the DATA makes the miss a failed test
   *  rather than a screen that will not mount. */
  it('every tab symbol is a glyph the Symbol table knows', () => {
    const known = new Set<string>(Object.values(SYMBOLS).map((g) => g.sf));
    for (const t of TAB_SPEC) {
      expect(known.has(t.symbol), `${t.name}: ${t.symbol}`).toBe(true);
      expect(known.has(t.symbolFilled), `${t.name}: ${t.symbolFilled}`).toBe(true);
    }
  });

  it('the tab bar hides only under the screens that own the phone (review, 2026-09-07)', () => {
    expect(tabBarHiddenFor('Follow')).toBe(true);
    expect(tabBarHiddenFor('Record')).toBe(true);
    for (const visible of ['Builder', 'Result', 'MapHome', 'SavedHome', 'Spot', undefined]) {
      expect(tabBarHiddenFor(visible)).toBe(false);
    }
  });

  it('no tab glyph uses speed/racing framing, in either namespace (Hard rule D)', () => {
    const denylist = [
      'speed',
      'speedometer',
      'gauge',
      'race',
      'flash',
      'rocket',
      'timer',
      'stopwatch',
    ];
    for (const t of TAB_SPEC) {
      for (const w of denylist) {
        expect(t.icon).not.toContain(w);
        expect(t.iconIdle).not.toContain(w);
        expect(t.symbol).not.toContain(w);
        expect(t.symbolFilled).not.toContain(w);
      }
    }
  });
});
