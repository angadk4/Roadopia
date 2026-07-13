import { describe, expect, it } from 'vitest';

import { checkGrounded } from './validate_output';

/** M5-T02 — grounded vs hallucinated fixtures (backlog AC verbatim). */

const FACTS = {
  allowedNames: ['Forks of the Credit Road', 'Hockley Road', 'Belfountain', 'Higher Ground Café'],
  allowedNumbers: [94, 87, 2.1],
};

describe('checkGrounded (M5-T02)', () => {
  it('a grounded explanation passes', () => {
    const v = checkGrounded(
      'This 87 minute loop from Belfountain runs the length of Forks of the Credit Road, ' +
        'passes 2 viewpoints and stops at Higher Ground Café. About 94 km of paved backroads.',
      FACTS,
    );
    expect(v.novelEntities).toEqual([]);
    expect(v.novelNumbers).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it('an invented place name is rejected', () => {
    const v = checkGrounded(
      'A lovely run down Silverpine Ridge Parkway before the café stop.',
      FACTS,
    );
    expect(v.ok).toBe(false);
    expect(v.novelEntities.join(' ')).toContain('Silverpine');
  });

  it('an invented number is rejected', () => {
    const v = checkGrounded('Roughly 240 km of driving on Hockley Road.', FACTS);
    expect(v.ok).toBe(false);
    expect(v.novelNumbers).toContain(240);
  });

  it('small counts and generic capitalized sentence starts are not entities', () => {
    const v = checkGrounded('The route passes 3 viewpoints. North of the valley it gets twisty.', {
      allowedNames: [],
    });
    expect(v.ok).toBe(true);
  });

  it('rounding within 5% is tolerated for stats', () => {
    const v = checkGrounded('About 95 km all in.', FACTS); // real 94
    expect(v.ok).toBe(true);
  });
});
