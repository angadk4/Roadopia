import { describe, it, expect } from 'vitest';

describe('backend smoke', () => {
  it('runs the backend test harness', () => {
    expect(1 + 1).toBe(2);
  });
});
