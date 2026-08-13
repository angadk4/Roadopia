import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * M11-T06 — safe-driving UX verification (spec §59; Hard rule D, permanent):
 * NO speed / racing / timing / leaderboard framing anywhere a user (or the
 * model) can see: app strings, backend prompts, identifiers. This scan walks
 * the real source trees so a regression FAILS CI, not a review.
 *
 * Lexicon notes: "speed limits" appears ONLY inside the safety disclaimer
 * ("obey all speed limits") — allowed by exact phrase. "fastest" appears in
 * engine-comparison internals (Valhalla's fastest route as the honesty
 * baseline, per BD-149) — allowed in backend planner code, banned in app
 * copy. Duration/time-of-day words are fine (planning), stopwatch words are
 * not.
 */

const BANNED = [
  /\brace\b/i,
  /\bracing\b/i,
  /\bleaderboard\b/i,
  /\blap time\b/i,
  /\bstopwatch\b/i,
  /\btop speed\b/i,
  /\bmax speed\b/i,
  /\bpersonal best\b/i,
  /\bbeat (?:the|your) time\b/i,
  /\bhow fast\b/i,
] as const;

/** Exact phrases carved out (each must contain its banned word legitimately). */
const ALLOWED_PHRASES = [
  'obey all speed limits', // the §59 disclaimer itself
  'no speed / racing / timing', // rule text quoted in comments
  'no speed/racing', // rule text quoted in comments
  'racing-framed', // refusal-path tests naming what they refuse
  'speed/racing', // rule references
  'not how fast you drive', // PlanScreen's anti-speed clarifier (the point IS the negation)
  'never use speed, racing', // the explain prompt's own §59 rule
  'no speed, racing or timing', // the explain prompt's own §59 rule
  'racing / beat-my-time / top-speed framing', // the parse prompt's unsafe_flag definition
] as const;

function walk(dir: string, exts: string[], acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, acc);
    else if (exts.some((e) => name.endsWith(e)) && !name.includes('.test.')) acc.push(p);
  }
  return acc;
}

function violations(files: string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const scrubbed = ALLOWED_PHRASES.reduce((l, ok) => l.split(ok).join(''), line.toLowerCase());
      for (const rx of BANNED) {
        if (rx.test(scrubbed)) hits.push(`${file}:${i + 1} ${line.trim().slice(0, 80)}`);
      }
    });
  }
  return hits;
}

describe('no precise location in DATA urls (M11-T05; spec §58, Hard rule E)', () => {
  it('app data-layer URLs are id-shaped, never coordinate-shaped', () => {
    // The one sanctioned coordinate URL surface is handoff.ts (external nav,
    // user-initiated, documented). Every Supabase/backend data URL must be
    // built from ids — a share link carrying lat/lng would leak location.
    const libDir = join(__dirname, '../../../app/src/lib');
    const files = walk(libDir, ['.ts']).filter((f) => !f.endsWith('handoff.ts'));
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (
          /rest\/v1|\/routes\/|\/spots\/|\/photos\//.test(line) &&
          /\$\{[^}]*(lat|lng)[^}]*\}/.test(line)
        ) {
          offenders.push(`${file}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('no speed/racing/timing framing anywhere (§59, Hard rule D)', () => {
  it('app source is clean', () => {
    const files = walk(join(__dirname, '../../../app/src'), ['.ts', '.tsx']);
    expect(files.length).toBeGreaterThan(50); // the scan actually scanned
    expect(violations(files)).toEqual([]);
  });

  it('backend source (prompts, identifiers, copy) is clean', () => {
    const files = walk(join(__dirname, '..'), ['.ts']);
    expect(files.length).toBeGreaterThan(50);
    expect(violations(files)).toEqual([]);
  });
});
