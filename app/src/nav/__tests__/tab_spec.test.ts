import { describe, expect, it } from 'vitest';

import { TAB_SPEC } from '../tab_spec';

describe('bottom-tab spec (Master Spec §16; R24 Discover-primary)', () => {
  it('has exactly the five tabs, in order (M9 adds Create — Master Spec §16)', () => {
    expect(TAB_SPEC.map((t) => t.name)).toEqual(['Discover', 'Plan', 'Create', 'Map', 'Saved']);
  });

  it('every tab has focused + idle icon glyphs', () => {
    for (const t of TAB_SPEC) {
      expect(t.icon.length).toBeGreaterThan(0);
      expect(t.iconIdle).toContain('outline');
    }
  });

  it('no tab icon uses speed/racing framing (Hard rule D)', () => {
    const denylist = ['speed', 'speedometer', 'race', 'flash', 'rocket', 'timer', 'stopwatch'];
    for (const t of TAB_SPEC) {
      for (const w of denylist) {
        expect(t.icon).not.toContain(w);
        expect(t.iconIdle).not.toContain(w);
      }
    }
  });
});
