/**
 * Grounding fact-check wrapper (M5-T02; Spec §36/§37, Protocol §18
 * cross-cutting: "every LLM output is schema-validated and fact-checked
 * against tool results before use; outputs that introduce a road/place/number
 * not in the grounded data are rejected").
 *
 * Prose outputs (explanation, title/summary) pass through checkGrounded()
 * with the run's REAL facts: the road/spot/town names the tools returned and
 * the numbers the pipeline computed. Anything that looks like a proper noun
 * and matches none of them is a NOVEL ENTITY → reject (regenerate once, then
 * the deterministic template fallback). This is the mechanism behind the
 * "no hallucinated geography" claim — not a hope, a check.
 */

export interface GroundingFacts {
  /** Names that may appear: road names, spot names, origin/destination towns. */
  allowedNames: readonly string[];
  /** Numbers that may appear (route stats); small counts ≤ 12 are always ok. */
  allowedNumbers?: readonly number[];
}

export interface GroundingVerdict {
  ok: boolean;
  novelEntities: string[];
  novelNumbers: number[];
}

/** Generic words that capitalize without being entities (sentence starts,
 *  road-type nouns, region words the product itself uses). */
const GENERIC_WORDS = new Set(
  (
    'the a an this that it your you drive route loop road roads street avenue boulevard ' +
    'line lane trail highway hwy county regional concession sideroad side rd st ave blvd ' +
    'north south east west ontario canada km min minutes hours starts ends passes head ' +
    'turn left right stop stops coffee food restaurant fuel gas viewpoint rest gravel paved twisty curvy ' +
    'scenic rural backroad backroads country countryside escarpment valley river lake ' +
    'creek falls point bay beach mount along toward through around begins takes'
  ).split(/\s+/),
);

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Candidate proper-noun phrases: runs of Capitalized words. A SINGLE
 *  capitalized word at a sentence start is ordinary prose, not an entity —
 *  multi-word phrases and mid-sentence capitals still count. */
function properNounPhrases(text: string): string[] {
  const phrases: string[] = [];
  // connectors (of/the/on/de) join two capitalized words only when another
  // capital actually follows — "Forks of the Credit" binds, "North of the
  // valley" does not
  const re = /\b([A-Z][a-zA-Z'.-]+(?:(?:\s+(?:of|the|on|de))*\s+[A-Z][a-zA-Z'.-]+)*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const phrase = m[1]!;
    const isSingleWord = !/\s/.test(phrase.trim());
    const before = text.slice(0, m.index).trimEnd();
    const atSentenceStart = before === '' || /[.!?:;]$/.test(before);
    if (isSingleWord && atSentenceStart) continue;
    phrases.push(phrase);
  }
  return phrases;
}

export function checkGrounded(text: string, facts: GroundingFacts): GroundingVerdict {
  const allowed = facts.allowedNames.map(norm).filter((n) => n.length > 0);
  const allowedWords = new Set(allowed.flatMap((n) => n.split(' ')));

  const novelEntities: string[] = [];
  for (const phrase of properNounPhrases(text)) {
    const words = norm(phrase)
      .split(' ')
      .filter((w) => w.length > 1 && !GENERIC_WORDS.has(w));
    if (words.length === 0) continue; // all generic — sentence start etc.
    const p = words.join(' ');
    const matches =
      allowed.some((a) => a.includes(p) || p.includes(a)) ||
      words.every((w) => allowedWords.has(w));
    if (!matches) novelEntities.push(phrase.trim());
  }

  const novelNumbers: number[] = [];
  if (facts.allowedNumbers) {
    const nums = [...text.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((x) => Number(x[0]));
    for (const n of nums) {
      if (n <= 12) continue; // small counts/ordinals ("2 viewpoints") always fine
      const ok = facts.allowedNumbers.some(
        (a) => Math.abs(n - a) <= Math.max(1, Math.abs(a) * 0.05),
      );
      if (!ok) novelNumbers.push(n);
    }
  }

  return {
    ok: novelEntities.length === 0 && novelNumbers.length === 0,
    novelEntities,
    novelNumbers,
  };
}
