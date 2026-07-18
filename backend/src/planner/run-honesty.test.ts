import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { parseRules } from './parse_rules';
import { runPlanner } from './run';

/**
 * R18-4 groundwork — unresolved place-NAME honesty. Both guards return before
 * any engine/db call, so fake deps suffice. Previously: an unknown origin got
 * a generic shrug and an unknown A→B destination THREW out of buildScope
 * (measured by eval/atob_quality: Peterborough→Bancroft raw error).
 */

const DEPS = { db: {} as unknown as Client, valhallaUrl: 'http://127.0.0.1:1' };

describe('runPlanner place-name honesty (R18-4)', () => {
  it("unknown origin name → honest 'I don't recognize' error, no throw", async () => {
    const constraints = parseRules('90 minute loop from Copetown');
    expect(constraints.origin).toBe('Copetown'); // gazetteer miss stays a string
    const result = await runPlanner(constraints, DEPS);
    expect(result.status).toBe('unavailable');
    expect(result.route).toBeNull();
    const err = result.events.find((e) => e.type === 'error');
    expect(err && 'message' in err ? err.message : '').toContain('"Copetown"');
    expect(err && 'message' in err ? err.message : '').toContain("don't recognize");
  });

  it('unknown A→B destination name → honest terminal result, no throw', async () => {
    const constraints = parseRules('drive from Hamilton to Bancroft');
    expect(typeof constraints.destination).toBe('string'); // unresolved name
    const result = await runPlanner(constraints, DEPS);
    expect(result.status).toBe('unavailable');
    expect(result.route).toBeNull();
    const err = result.events.find((e) => e.type === 'error');
    expect(err && 'message' in err ? err.message : '').toContain('"Bancroft"');
  });
});
