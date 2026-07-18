# R18 "The Fun Rebuild" — paired-delta program report (2026-07-16)

Owner directive: _"fix the essence — I don't care if we have to change major stuff or go
back on frozen decisions."_ Program: R18-0…R18-5 (BUILD_LOG (h)–(l); BD-59; config lineage
frozen-m4t12-v10 → frozen-r18-v4). All numbers below are REAL harness output; artifacts in
`eval/runs/r18-rebaseline/`.

## The audit that started it (v10, 2026-07-16)

- ~90–97 % of route meters were fastest-path connectors (`use_highways` is a probed
  motorway/trunk-only step function — arterials cost nothing).
- Characters were inert re-ranks: **distinctness overlap 1.00, identical routes 10/10
  origins**, every character ~87 % arterial.
- "through Forks of the Credit" parsed → consumed by NOTHING. `distance_target_m` dropped.
  Unknown place names died behind "planner temporarily unavailable".
- 10/30 random briefs → hard no-route with no fallback.

## Program scoreboard (v10 → post-R18-4/5)

| Metric                                             | v10                         | now                                                                                | Δ                                                                                                        |
| -------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Fixed 48: AC composite                             | 11/48                       | **17/48**                                                                          | +6 (peak 19 at R18-2; −2 = the backroads-mapping essence trade, below)                                   |
| Fixed 48: twisty-ask curviness                     | 1.10                        | **1.55**                                                                           | +41 % (R18-1 backroads profile)                                                                          |
| Fixed 48: \|durErr\| p50/p80                       | 11 %/23 %                   | **10 %/19 %**                                                                      | duration dead-band closed (Cobourg 150/150, Fort Erie 180/180, Grimsby 120/120 exact)                    |
| Fixed 48: no-route                                 | 0 (never-empty n/a)         | **0** + all 10 audit kill-towns return routes                                      | R18-2                                                                                                    |
| Random 30: harness no-route                        | 6/30                        | **3/30** (product-level 0 — never-empty ladder)                                    | R18-2                                                                                                    |
| Random 30: arterial share of bests                 | 79 %                        | **73 %**                                                                           |                                                                                                          |
| Random 30: dirty units of bests                    | 3.20                        | **2.19**                                                                           |                                                                                                          |
| Random 30: AC composite                            | 7/30                        | 5/30                                                                               | same mapping trade as fixed (below)                                                                      |
| Distinctness: pairwise overlap                     | **1.00, identical 10/10**   | twisty~scenic 0.25 · twisty~simple 0.28 · scenic~simple 0.36                       | the indictment broken                                                                                    |
| Distinctness: curv(twisty)/curv(simple)            | 1.0 (identical)             | **1.45×**                                                                          | bar 1.3× → **PASS**                                                                                      |
| Distinctness: arterial(simple)−arterial(backroads) | 0                           | 0.10                                                                               | bar 0.15 → **MISS** (demotion can't create material; next lever is corpus/[GATE-S] land-use, not tuning) |
| A→B (new eval, 12 corridor briefs)                 | no forced material at all   | 11/12 routed · corridor chains 8–10/12 · measured arterial/country on the wire     | eval/atob_quality.ts, deterministic ×2                                                                   |
| "through Forks of the Credit"                      | ignored                     | **drives 100 % of the road** (measured Tier-2 row, live)                           | R18-4                                                                                                    |
| Unknown place name                                 | dishonest outage copy       | "I don't recognize 'X' — try a nearby town or drop a pin" (origin AND destination) | R18-4                                                                                                    |
| Parse (BD-28 re-run, prompt v3)                    | LLM .916 / rules .852 (VAL) | **LLM .922 / rules .859**, 0/22 flips, ADOPT re-confirmed                          | $0.98 of $2                                                                                              |
| Determinism                                        | —                           | fixed-suite hash `12b643ed341cc625` identical across runs                          |                                                                                                          |
| Wall time / brief (fixed)                          | 2.4 s (v10)                 | 6.3 s                                                                              | the honest cost of repair v2 + profiles; ≤ 25 s budget                                                   |

## Honest refusals (pre-registered rules did their job)

1. **Fun-default costing** (characterless briefs): refused **three times** (AC 7→4, 19→13,
   premise falsified). The A→B probe (arterial 80→71 %, curv +39 %, zero new failures) is
   recorded as positive evidence for the R18-4+ default-bundle decision — not adopted.
2. **Loop chains** (R18-3): built in full, refused by their own falsifiable diagnostic
   (pool ctryVar 0.0004–0.0098 vs required >0.05; +1 pp curvyShare vs +10 pp bar; 2× wall
   time). Rollback verified byte-identical. Machinery lives on in A→B parity.

## The open trade for the owner (BD-59 §6)

"backroads"/"country roads" phrasing now actually selects the backroads preset+profile
(it previously set a display tag ONLY — your exact complaint). The 4 fixed-suite briefs
that switched: St. Catharines FAIL→PASS (curv 1.53) · Bolton curv 0.77→**1.34** (pool
self-overlap 0.16 vs 0.15 bar) · St. Jacobs curv 1.31→**1.68** (durErr 26 % vs 25 %) ·
Delhi arterial **76→46 %** (offence flag). Net AC 19→17 on marginal bar misses; bars were
NOT weakened. **Reversal = one line in parse_rules.ts** if you refuse the trade.

## Deviations + follow-ups (recorded, not hidden)

- avoid-area / via misses render **relaxed** (disclosed) rather than violated — the
  dedicated ladder rung is the follow-up.
- Route-inspector before/after artifact rides the device-pass session.
- The arterial-gap distinctness bar (0.10 vs 0.15) needs material, not tuning:
  [GATE-S] land-use experiment (authorized, eval-only) and richer span corpus are the
  named levers.
- Backend dev process still runs pre-R18 code — restart before the device pass.

## Device pass checklist (owner, [HUMAN])

1. Same origin × {Twisty, Backroads (type "backroads loop"), Scenic (Prefer views), Simple}
   → four visibly different drives.
2. "2 hour loop from Caledon East through Forks of the Credit" → the route DRIVES it; the
   constraints panel shows the measured `via` row.
3. "drive from Peterborough to Bancroft" → honest "I don't recognize…" (not an outage).
4. A Kilbride 2-hour brief → an honest disclosed route, never a dead end.
