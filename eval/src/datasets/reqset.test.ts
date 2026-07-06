import { describe, expect, it } from 'vitest';

import { latestReqsetVersion, loadReqset, normalizeBrief, validateReqset } from './load';
import { SPLIT_TARGETS, type Reqset } from './schema';

/**
 * M4-T01 — dataset scaffold: fixtures load, version recorded, leakage rules
 * enforced. Content targets (§6.2 counts, gold labels) are M4-T02's AC — here
 * they surface as WARNINGS, not errors.
 */

describe('reqset scaffold (M4-T01)', () => {
  it('the latest reqset loads, is versioned, and validates cleanly', () => {
    const version = latestReqsetVersion();
    expect(version).toMatch(/^reqset-v\d+$/);
    const reqset = loadReqset(version);
    expect(reqset.manifest.version).toBe(version);
    expect(reqset.manifest.changelog.length).toBeGreaterThan(0);
    const { errors, warnings } = validateReqset(reqset);
    expect(errors).toEqual([]);
    // M4-T02 filled every split to its §6.2 target — no size warnings left
    expect(warnings.filter((w) => w.includes('below §6.2 target'))).toEqual([]);
  });

  it('pins ≥1 origin per §5 archetype with real coordinates', () => {
    const { origins } = loadReqset();
    const archetypes = new Set(origins.map((o) => o.archetype));
    expect(archetypes.size).toBe(6);
    for (const o of origins) {
      expect(o.lat).toBeGreaterThan(42.7);
      expect(o.lat).toBeLessThan(45.0);
      expect(o.lng).toBeGreaterThan(-81.2);
      expect(o.lng).toBeLessThan(-77.5);
    }
  });

  it('rejects (origin, brief) leakage across splits', () => {
    const reqset = loadReqset();
    const dup: Reqset = {
      ...reqset,
      // clone dev-001's (origin, brief) into TEST under a fresh id
      test: [
        ...reqset.test,
        {
          ...reqset.dev[0]!,
          id: 'test-999',
          split: 'test' as const,
        },
      ],
      manifest: {
        ...reqset.manifest,
        counts: { ...reqset.manifest.counts, test: reqset.manifest.counts.test + 1 },
      },
    };
    const { errors } = validateReqset(dup);
    expect(errors.some((e) => e.includes('leakage'))).toBe(true);
  });

  it('rejects duplicate ids, unknown origins, and count mismatches', () => {
    const reqset = loadReqset();
    const broken: Reqset = {
      ...reqset,
      val: [
        ...reqset.val,
        { ...reqset.val[0]! }, // duplicate id
        { ...reqset.val[0]!, id: 'val-998', brief: 'unique brief a', origin_id: 'org-nowhere' },
      ],
    };
    const { errors } = validateReqset(broken);
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true);
    expect(errors.some((e) => e.includes('unknown origin_id'))).toBe(true);
    expect(errors.some((e) => e.includes('count mismatch'))).toBe(true);
  });

  it('requireGold passes — every example is gold-labeled (M4-T02 complete)', () => {
    const reqset = loadReqset();
    const { errors } = validateReqset(reqset, { requireGold: true });
    expect(errors.filter((e) => e.includes('gold label missing'))).toEqual([]);
    // and the wiring still catches an ungolded example when one appears
    const stripped = {
      ...reqset,
      val: [{ ...reqset.val[0]!, gold: null }, ...reqset.val.slice(1)],
    };
    const check = validateReqset(stripped, { requireGold: true });
    expect(check.errors.some((e) => e.includes('gold label missing'))).toBe(true);
  });

  it('normalizeBrief treats punctuation/case variants as the same phrasing', () => {
    expect(normalizeBrief('90-Minute Twisty Loop, from Hockley!')).toBe(
      normalizeBrief('90 minute twisty loop from hockley'),
    );
  });

  it('§6.2 targets stay visible to the fill task', () => {
    expect(SPLIT_TARGETS.dev.min).toBe(40);
    expect(SPLIT_TARGETS.test.min).toBe(25);
  });
});
