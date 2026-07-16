import { describe, expect, it } from 'vitest';

import { TAB_SPEC } from '../tab_spec';

describe('bottom-tab spec (Master Spec §16)', () => {
  it('has exactly the four tabs, in order: Map · Plan · Create · Saved', () => {
    expect(TAB_SPEC.map((t) => t.name)).toEqual(['Map', 'Plan', 'Create', 'Saved']);
  });

  it('every tab has focused + idle icon glyphs', () => {
    for (const t of TAB_SPEC) {
      expect(t.icon.length).toBeGreaterThan(0);
      expect(t.iconIdle).toContain('outline');
    }
  });
});
