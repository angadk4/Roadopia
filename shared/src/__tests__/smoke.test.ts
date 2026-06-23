import { describe, it, expect } from 'vitest';

import { isWithinTolerance } from '../test-utils';

describe('shared smoke', () => {
  it('runs the shared test harness and shared utils', () => {
    expect(isWithinTolerance(105, 100, 0.1)).toBe(true);
    expect(isWithinTolerance(120, 100, 0.1)).toBe(false);
  });
});
