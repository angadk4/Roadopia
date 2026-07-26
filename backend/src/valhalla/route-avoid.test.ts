import { describe, expect, it } from 'vitest';

import { realizeCostingOptions } from './route';

/**
 * R25-U2 — the avoid system was a routing NO-OP: `exclude_highways` (and its
 * siblings) are silently ignored by the pinned Valhalla 3.7.0 (probed
 * 2026-07-26: byte-identical route/time/shape to a bogus control key). These
 * tests pin the translation that makes the toggles real. If someone ever
 * "simplifies" this back to a pass-through, the toggle dies silently again.
 */
describe('realizeCostingOptions (R25-U2)', () => {
  it('a hard highway avoid emits use_highways: 0 AND drops shortest', () => {
    const out = realizeCostingOptions({
      shortest: true,
      use_living_streets: 0,
      exclude_highways: true,
    });
    expect(out.use_highways).toBe(0);
    expect('shortest' in out).toBe(false); // shortest bypasses use_* — must go
    expect(out.exclude_highways).toBe(true); // intent stays in the payload
    expect(out.use_living_streets).toBe(0);
  });

  it('tolls/ferries gain their soft levers alongside the exclude keys', () => {
    const out = realizeCostingOptions({ exclude_tolls: true, exclude_ferries: true });
    expect(out.use_tolls).toBe(0);
    expect(out.use_ferry).toBe(0);
  });

  it('no avoids → untouched (the fun profile keeps shortest)', () => {
    const opts = { shortest: true, use_living_streets: 0 };
    expect(realizeCostingOptions(opts)).toEqual(opts);
  });

  it('an explicit exclude_highways: false never triggers the translation', () => {
    const out = realizeCostingOptions({ shortest: true, exclude_highways: false });
    expect(out.use_highways).toBeUndefined();
    expect(out.shortest).toBe(true);
  });
});
