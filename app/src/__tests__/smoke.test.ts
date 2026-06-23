import { describe, it, expect } from 'vitest';

import { APP_NAME } from '../index';

describe('app smoke', () => {
  it('exposes the app name', () => {
    expect(APP_NAME).toBe('roadopia');
  });
});
