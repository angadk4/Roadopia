/**
 * Rules-based brief parser — the deterministic baseline (M3-T02; Protocol §18-A).
 *
 * brief text (+ optional slider weights) → schema-validated `ParsedConstraints`.
 * Units + keyword maps + a small gazetteer; NO model, NO network, NO geography
 * invention (place-names either resolve via the gazetteer or stay strings for the
 * geocode step). Policy per §3.5: DEFAULT TO BEST-EFFORT + DISCLOSE — clarify only
 * for no-origin or an undecidable shape; flag unsafe / out-of-region / injection.
 * The LLM parser (M5-T03) is drop-in swappable behind the same output schema.
 */

import {
  validateParsedConstraints,
  type Contradiction,
  type Origin,
  type ParsedConstraints,
  type StopFraction,
  type StopRequest,
  type Weights,
} from '@shared/types';

import { isKnownOutOfRegion, lookupInRegion } from './gazetteer';

// --- keyword tables (Hard rule D: engagement/character words only, never speed) ---

const UNSAFE_PATTERNS: RegExp[] = [
  /\brac(?:e|ing)\b/i,
  /\bstreet\s*rac/i,
  /\btop\s+speed\b/i,
  /\bas\s+fast\s+as\s+possible\b/i,
  /\bfastest\s+(?:possible|run|time)\b/i,
  /\bbeat\s+(?:the|my)\s+time\b/i,
  /\bdrift(?:ing)?\b/i,
  /\bspeed\s*run\b/i,
  /\boutrun\b/i,
];

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+|any\s+)?(?:previous|prior|above)\s+instructions/i,
  /disregard\s+(?:the\s+)?(?:rules|instructions|system)/i,
  /system\s+prompt/i,
  /you\s+are\s+now\b/i,
  /\bjailbreak\b/i,
];

/** Stop-request keyword map — shared with the refinement merger (M5-T06). */
export const STOP_KEYWORDS: Array<{ re: RegExp; type: StopRequest['type'] }> = [
  { re: /\b(?:coffee|caf[eé]|espresso)\b/i, type: 'coffee' },
  { re: /\b(?:lunch|dinner|breakfast|food|eat|restaurant)\b/i, type: 'food' },
  { re: /\b(?:fuel|gas|petrol|fill\s*up)\b/i, type: 'fuel' },
  { re: /\b(?:viewpoint|lookout|view|scenic\s+stop|photo\s+spot)\b/i, type: 'viewpoint' },
  { re: /\b(?:rest\s*stop|break|stretch)\b/i, type: 'rest' },
];

const COUNT_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  couple: 2,
  few: 3,
};

// --- helpers ---

function matchDuration(brief: string): { seconds: number | null; ambiguous: string | null } {
  // "90 minute", "45-min", "1.5 hours", "2 hr", "an hour", "half an hour", "half day"
  const hourMin = brief.match(/(\d+(?:\.\d+)?)\s*(?:-|\s)?\s*(hours?|hrs?|h)\b/i);
  const minutes = brief.match(/(\d+(?:\.\d+)?)\s*(?:-|\s)?\s*(minutes?|mins?|m)\b/i);
  const range = brief.match(
    /(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)/i,
  );
  if (range) {
    const [, a, b, unit] = range;
    const mult = /h/i.test(unit!) ? 3600 : 60;
    const mid = ((Number(a) + Number(b)) / 2) * mult;
    return { seconds: Math.round(mid), ambiguous: `duration range "${range[0]}" → midpoint` };
  }
  if (hourMin) return { seconds: Math.round(Number(hourMin[1]) * 3600), ambiguous: null };
  if (minutes) return { seconds: Math.round(Number(minutes[1]) * 60), ambiguous: null };
  const wordHours = brief.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:-|\s)?\s*(?:hours?|hrs?)\b/i,
  );
  if (wordHours) {
    return { seconds: NUMBER_WORDS[wordHours[1]!.toLowerCase()]! * 3600, ambiguous: null };
  }
  if (/\bhalf\s+(?:a\s+)?day\b/i.test(brief))
    return { seconds: 4 * 3600, ambiguous: 'half day → 4 h' };
  if (/\bhalf\s+an?\s+hour\b/i.test(brief)) return { seconds: 1800, ambiguous: null };
  if (/\ban?\s+hour\b/i.test(brief)) return { seconds: 3600, ambiguous: null };
  return { seconds: null, ambiguous: null };
}

function matchDistance(brief: string): number | null {
  const km = brief.match(/(\d+(?:\.\d+)?)\s*(?:km|kilomet(?:re|er)s?)\b/i);
  if (km) return Math.round(Number(km[1]) * 1000);
  const mi = brief.match(/(\d+(?:\.\d+)?)\s*(?:miles?|mi)\b/i);
  if (mi) return Math.round(Number(mi[1]) * 1609.34);
  return null;
}

/** Extract a place-name after a preposition, stopping at common clause breaks. */
function placeAfter(brief: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = brief.match(re);
    if (m?.[1]) {
      // sentence periods break the capture, but abbreviation dots ("St.") survive
      const cut = m[1].split(
        /[,!?;]|(?<!\bSt)\.(?=\s|$)|\b(?:with|and|then|no|avoid|without|via|for|that|which|from|to|towards?|around|along|ending|end|finish(?:ing)?|near|by|in\s+about|through|past)\b/i,
      )[0]!;
      const name = cut.trim().replace(/\s+/g, ' ');
      if (name.length > 1) return name;
    }
  }
  return null;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** Stop-timing phrases (R16-3): "early on" 0.25 · "halfway" 0.5 · "toward the
 *  end" 0.75. Brief-scoped (single-stop briefs dominate; per-stop positional
 *  scoping is the LLM parser's job for nuanced multi-stop sentences). */
function matchStopFraction(brief: string): StopFraction | null {
  if (/\b(?:early on|early in|near the start|at the start)\b/i.test(brief)) return 0.25;
  if (/\b(?:half\s?way|mid-?way|in the middle|about half)\b/i.test(brief)) return 0.5;
  if (/\b(?:toward(?:s)? the end|near the end|at the end|late in)\b/i.test(brief)) return 0.75;
  return null;
}

function matchStops(brief: string): StopRequest[] {
  const stops: StopRequest[] = [];
  for (const { re, type } of STOP_KEYWORDS) {
    if (!re.test(brief)) continue;
    // count: "two coffee stops", "3 viewpoints", default 1
    const before = brief.match(
      new RegExp(`(\\d+|${Object.keys(COUNT_WORDS).join('|')})\\s+(?:\\w+\\s+)?${re.source}`, 'i'),
    );
    const raw = before?.[1]?.toLowerCase();
    const count = raw ? (COUNT_WORDS[raw] ?? (Number(raw) || 1)) : 1;
    const required = /\b(?:must|need|required|definitely|make sure)\b/i.test(brief);
    stops.push({
      type,
      count,
      importance: required ? 'required' : 'nice_to_have',
      at_fraction: matchStopFraction(brief),
    });
  }
  return stops;
}

// --- the parser ---

export function parseRules(brief: string, sliderWeights?: Weights): ParsedConstraints {
  const ambiguous: string[] = [];
  const missing: string[] = [];
  const contradictions: Contradiction[] = [];
  const fields: Record<string, number> = {};

  const unsafe = UNSAFE_PATTERNS.some((re) => re.test(brief));
  const injection = INJECTION_PATTERNS.some((re) => re.test(brief));

  // --- duration / distance ---
  const dur = matchDuration(brief);
  if (dur.ambiguous) ambiguous.push(dur.ambiguous);
  if (dur.seconds !== null) fields['duration_target_s'] = dur.ambiguous ? 0.6 : 0.9;
  const distance = matchDistance(brief);
  if (distance !== null) fields['distance_target_m'] = 0.9;

  // --- origin ---
  let origin: Origin | null = null;
  let outOfRegion = false;
  if (
    /\bfrom\s+(?:here|my\s+location|current\s+location)\b/i.test(brief) ||
    /\bnear\s+me\b/i.test(brief)
  ) {
    origin = 'current';
    fields['origin'] = 0.9;
  } else {
    const name = placeAfter(brief, [
      /\bfrom\s+([A-Za-z][\w.'\- ]+)/i,
      /\bstart(?:ing)?\s+(?:in|at|from)\s+([A-Za-z][\w.'\- ]+)/i,
      /\bout\s+of\s+([A-Za-z][\w.'\- ]+)/i,
    ]);
    if (name) {
      if (isKnownOutOfRegion(name)) {
        outOfRegion = true;
        origin = name; // echo what the user said; the redirect handles the rest
        fields['origin'] = 0.9;
      } else {
        const hit = lookupInRegion(name);
        origin = hit ? { lat: hit.lat, lng: hit.lng } : name;
        fields['origin'] = hit ? 0.95 : 0.6;
      }
    }
  }
  if (origin === null) missing.push('origin');

  // --- destination / shape ---
  const destName = placeAfter(brief, [
    /\b(?:to|towards?|ending\s+(?:in|at)|end\s+(?:in|at)|finish(?:ing)?\s+(?:in|at))\s+([A-Za-z][\w.'\- ]+)/i,
  ]);
  const loopWord = /\b(?:loop|circuit|round\s*trip|back\s+(?:home|to\s+(?:the\s+)?start))\b/i.test(
    brief,
  );
  let destination: ParsedConstraints['destination'] = null;
  let shape: ParsedConstraints['shape'] = 'loop';
  if (destName && isKnownOutOfRegion(destName)) outOfRegion = true;
  if (destName) {
    const hit = lookupInRegion(destName);
    destination = hit ? { lat: hit.lat, lng: hit.lng } : destName;
  }
  if (loopWord && destName) {
    // "a loop ending in another city" — undecidable (§3.5 case b)
    contradictions.push({
      kind: 'shape',
      description: `loop requested but destination "${destName}" given — loop vs A→B undecidable`,
    });
    shape = 'loop';
    fields['shape'] = 0.3;
  } else if (destName) {
    shape = 'a_to_b';
    fields['shape'] = 0.85;
  } else {
    shape = 'loop'; // default: no destination ⇒ loop (§3.4)
    fields['shape'] = loopWord ? 0.95 : 0.7;
  }

  // --- avoid / surface ---
  const avoidHighways =
    /\b(?:no|avoid|without|stay\s+off(?:\s+the)?|skip)\s+(?:the\s+)?(?:highways?|motorways?|qew|401|403|freeways?)\b/i.test(
      brief,
    );
  const avoidTolls = /\b(?:no|avoid|without)\s+(?:the\s+)?tolls?\b/i.test(brief);
  const avoidFerries = /\b(?:no|avoid|without)\s+(?:the\s+)?ferr(?:y|ies)\b/i.test(brief);
  const avoidUnpaved =
    /\b(?:no|avoid|without)\s+(?:the\s+)?(?:gravel|unpaved|dirt(?:\s+roads?)?)\b/i.test(brief);

  // --- character / prefs / intensity ---
  const character: ParsedConstraints['character'] = [];
  let twistiness: number | null = null;
  if (/\bvery\s+(?:twisty|curvy|winding)\b/i.test(brief)) twistiness = 0.9;
  else if (/\b(?:twisty|curvy|winding|switchbacks?|hairpins?)\b/i.test(brief)) twistiness = 0.7;
  else if (/\bgentle\s+(?:curves?|bends?)\b/i.test(brief)) twistiness = 0.4;
  if (twistiness !== null) character.push('twisty');

  let scenic: number | null = null;
  if (/\b(?:scenic|beautiful|pretty|views?|vistas?)\b/i.test(brief)) {
    scenic = 0.7;
    character.push('scenic');
  }
  if (/\bbackroads?\b/i.test(brief)) character.push('backroad');
  if (/\b(?:forest|woods|trees)\b/i.test(brief)) character.push('forest');
  if (/\b(?:lakeshore|coastal|waterfront|along\s+the\s+(?:lake|water|river))\b/i.test(brief))
    character.push('coastal');
  if (/\b(?:rural|countryside|country\s+roads?)\b/i.test(brief)) character.push('rural');
  if (/\bflowing|sweepers?\b/i.test(brief)) character.push('flowing');

  let intensity: ParsedConstraints['intensity'] = null;
  if (/\b(?:relax(?:ed|ing)?|chill|easy|cruisy|leisurely|calm)\b/i.test(brief)) intensity = 'chill';
  else if (/\b(?:spirited|engaging|lively)\b/i.test(brief)) intensity = 'spirited';

  // --- preset slot (R16-4): a minimal-turns ask steers the FROZEN 'simple'
  // vector (chill's exact numbers relabeled — presets.ts). Chill-family words
  // above set intensity only; this is the scoring lever. ---
  let preset: ParsedConstraints['preset'] = null;
  if (/\b(?:simple|easy|mostly\s+straight|minimal\s+turns?)\b/i.test(brief)) {
    preset = 'simple';
    fields['preset'] = 0.7;
  } else if (/\b(?:backroads?|country\s+roads?)\b/i.test(brief)) {
    // R18-4 mapping fix (found by the R18-3 A→B probe): "backroads" phrasing
    // previously set a DISPLAY TAG only — the ask never reached the adopted
    // BACKROADS costing profile or its preset weights. "I only want country
    // roads" now means something.
    preset = 'backroads';
    fields['preset'] = 0.7;
  }

  // "twisty but relaxing" — soft tension resolved by moderating the target (§3.5.5)
  if (twistiness !== null && intensity === 'chill') {
    twistiness = Math.min(twistiness, 0.5);
    ambiguous.push('twisty + relaxing → moderate curviness target');
  }

  // --- location constraints ("through <road>", "via/along/past X", "avoid
  // downtown", "near X" without origin semantics) — R18-4: these are REAL
  // routing intents now (resolve_locations.ts), extracted with the same
  // clause-break truncation as origins so "through Forks of the Credit with a
  // coffee stop" captures the road, not the sentence. ---
  const locationConstraints: ParsedConstraints['location_constraints'] = [];
  const seenIntents = new Set<string>();
  const CLAUSE_BREAK =
    /[,!?;]|(?<!\bSt)\.(?=\s|$)|\b(?:with|and|then|no|avoid|without|via|for|that|which|from|to|towards?|around|along|ending|end|finish(?:ing)?|near|by|in\s+about|through|past|loop|drive|route|stop)\b/i;
  const NON_PLACES =
    // pronouns/deixis + timing words + GENERIC scenery ("through the
    // countryside", "past the Mennonite farms" — character, not places; the
    // reqset gold agrees: location_constraints [] on all of them)
    /^(?:me|here|my(?:\s+location)?|the|start|end|middle|beginning|lake|water|river|town|city|way|it|countryside|country|forests?(?:\s+(?:roads?|tracts?))?|woods|vineyards?(?:\s+and\s+orchards?)?|orchards?|(?:mennonite\s+)?farms?|farmland|fields|hills|suburbs)$/i;
  const intentRe = /\b(through|via|along|past|near)\s+(?:the\s+)?([A-Za-z][\w.'\- ]+)/gi;
  for (const m of brief.matchAll(intentRe)) {
    const word = m[1]!.toLowerCase();
    const text = m[2]!.split(CLAUSE_BREAK)[0]!.trim().replace(/\s+/g, ' ');
    if (text.length <= 1 || NON_PLACES.test(text)) continue;
    const kind: 'through' | 'near' = word === 'past' || word === 'near' ? 'near' : 'through';
    const key = `${kind}:${text.toLowerCase()}`;
    if (seenIntents.has(key)) continue;
    seenIntents.add(key);
    locationConstraints.push({ kind, text });
  }
  if (locationConstraints.length > 0) fields['location_constraints'] = 0.7;
  const avoidPlace = brief.match(
    /\bavoid\s+(?:the\s+)?(downtown[\w ']*|city\s+cent(?:re|er)[\w ']*)/i,
  );
  if (avoidPlace?.[1]) locationConstraints.push({ kind: 'avoid', text: avoidPlace[1].trim() });

  // --- stops ---
  const stops = matchStops(brief);
  if (stops.length > 0) fields['stops'] = 0.85;

  // --- clarification (§3.5: ONLY no-origin or shape contradiction) ---
  const shapeContradiction = contradictions.some((c) => c.kind === 'shape');
  const needsClarify = !unsafe && !outOfRegion && (origin === null || shapeContradiction);
  const question = needsClarify
    ? origin === null
      ? 'Where should the drive start? (a town name or your current location)'
      : `Should this be a loop back to the start, or end in ${destName ?? 'the destination'}?`
    : null;

  const setConf = Object.values(fields);
  const overall = Math.max(
    0.1,
    Math.min(
      1,
      (setConf.length ? setConf.reduce((a, b) => a + b, 0) / setConf.length : 0.5) -
        0.05 * ambiguous.length,
    ),
  );

  return validateParsedConstraints({
    origin,
    destination,
    shape,
    duration_target_s: dur.seconds,
    distance_target_m: distance,
    stops,
    avoid: {
      highways: avoidHighways,
      tolls: avoidTolls,
      ferries: avoidFerries,
      unpaved: avoidUnpaved,
    },
    surface_pref: avoidUnpaved ? 'paved' : 'any',
    character,
    scenic_pref: scenic,
    twistiness_pref: twistiness,
    intensity,
    preset,
    weights: sliderWeights ?? null,
    location_constraints: locationConstraints,
    ambiguous_terms: ambiguous,
    missing,
    contradictions,
    confidence: { overall, fields },
    clarification: { needed: needsClarify, question },
    unsafe_flag: unsafe,
    out_of_region_flag: outOfRegion,
    prompt_injection_flag: injection,
  });
}
