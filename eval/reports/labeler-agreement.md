# Second-labeler agreement — M4-T03 (Protocol §7.3)

Sample: 13 examples (~19 % of DEV+VAL), deterministic rule recorded in the sheet.
Labelers: gold = agent-authored (M4-T02); second = owner, blind, plain-English
(eval/reports/second-labeler-sheet.md, filled 2026-07-11). Scoring: exact match on
hard fields, band overlap on durations, judgment-coded from the owner's prose.

## Agreement

| dimension                       | agreement         | notes                                                                                                                                   |
| ------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| duration (band overlap)         | **13/13 (100 %)** | incl. "any" ↔ null (dev-033) and "2–3 hrs" ↔ 3 h (val-013)                                                                              |
| stops (presence/type/count)     | **11/13 (85 %)**  | both disagreements adjudicated below                                                                                                    |
| avoid rules STATED in the brief | **13/13 (100 %)** | ferries (dev-038), tolls+paved (dev-043), 403 (val-003), paved (dev-003)                                                                |
| avoid flags overall (4 × 13)    | 40/52 (77 %)      | all misses are ONE systematic prior, not noise — see finding 1                                                                          |
| expected disposition            | 10/13 (77 %)      | 3 misses are §3.5 policy differences, not comprehension — finding 2                                                                     |
| shape (loop vs A→B)             | excluded          | sheet-design flaw: the field was read as "route character"; the owner's prose still implied the correct shape wherever it was inferable |

## Adjudications (rule: the brief TEXT decides; recorded per §7.3)

1. **dev-018 → OWNER wins (gold amended).** "String together a couple of the great
   driving roads" is route CHARACTER, not stop requests — gold's `great_road ×2`
   stops replaced with twisty/backroad character + twistiness 0.7.
2. **dev-033 → OWNER wins (gold amended).** "Waterdown to Cayuga **on backroads**"
   is a mode directive — `avoid.highways` now true + backroads preset (was
   inconsistently labeled vs the VAL convention for blanket backroads language).
3. **val-013 → gold stands.** "Old small towns along the route are a bonus" is a
   preference, not a stop (no small-town stop type exists); owner coded it as a stop.
4. **dev-008 / dev-033 dispositions → gold stands.** Owner wants a clarifying
   question ("what kind of stop", "where is the construction"); §3.5 reserves
   clarification for no-origin/shape-contradiction — everything else is best-effort
   - disclose. Recorded as a PRODUCT note, not a label error.
5. **val-018 disposition → gold stands (spec).** No origin stated → §3.5 clarify;
   owner expects "just plan it (from wherever I am)". In the app (M6+) the device
   location fills this, so the clarify case mainly exists for text-only contexts.
   Product note for M6/M7.

## Findings

1. **The owner's enthusiast prior:** "no highways, paved only" was implicitly added
   to ~70 % of briefs where the text says nothing. Adjudication keeps the PARSE
   text-grounded — and the finding VALIDATES the product's default costing (country
   bias `use_highways 0.2`, class-filtered retrieval, BD-21/22): the prior is
   honored by routing defaults, not by inventing parse fields.
2. **Clarification appetite:** the owner would ask more questions than §3.5 allows
   (2 cases) and fewer in the no-origin case (1). Net: the §3.5 rule holds for MVP;
   revisit at M7 UX with real users.
3. **The pass did its job:** 2/13 gold labels had real defects, both caught and
   fixed (changelog in the reqset manifest). Cohen's κ not computed — the
   plain-English sheet doesn't yield clean categorical pairs for all fields; the
   per-dimension table above is the honest equivalent at this sample size, and the
   limitation is published per §7.3.
