import { describe, expect, it } from 'vitest';

import { _uuid4ForTests, sessionId } from '../session';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('session id', () => {
  it('is a v4-shaped uuid (const module binding = stable per runtime)', () => {
    expect(sessionId).toMatch(V4);
  });

  it('generator produces distinct v4-shaped ids', () => {
    const a = _uuid4ForTests();
    const b = _uuid4ForTests();
    expect(a).toMatch(V4);
    expect(b).toMatch(V4);
    expect(a).not.toBe(b);
  });
});
