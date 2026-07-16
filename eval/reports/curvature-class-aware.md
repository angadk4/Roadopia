# Class-aware route curviness — before/after (round 15, config v8 → v9)

**Date:** 2026-07-16 · **Trigger:** M7-T09 on-device owner finding — "it thinks highway
ramps count as twisty, which is wrong." · **Config:** `frozen-m4t12-v8` → `frozen-m4t12-v9`.

## What changed (and what did NOT)

The route-level twistiness measurement (`run.ts` scoring input) was TAG-BLIND: it measured
the whole routed LineString, so the ramp/turn-channel/roundabout geometry Valhalla stitches
between waypoints inflated `curviness` — and `cur = 0.35` (the largest scoring reward)
preferred it. The CORPUS builder always excluded exactly this geometry (Protocol §12.1,
`isJunctionGeometry`), so corpus and route measurements disagreed by construction; the
`curvature.ts` header had flagged the missing "maneuver-aware exclusion" since M3.

Now `measureCurvatureClassAware` drops edges with `use ∈ {ramp, turn_channel}`,
`roundabout: true`, or `road_class ∈ {motorway, trunk}` — using the `/trace_attributes`
result the residential gate (round 7) already fetches per scored candidate (**zero extra
Valhalla calls**) — and measures each contiguous kept run in isolation (no curvature triple
can span an excluded edge, so the corner where a road meets a ramp never counts as a turn;
verified by a synthetic that shows one such corner contributing as much curvature as an
entire 628 m R=300 arc). Tag-blind fallback on trace failure and for A→B (no trace yet) —
a measurement fallback is still a measurement.

**Frozen surface untouched:** formula C7, THETA_CURVY 0.6, all scoring weights, presets.
Only the measured geometry domain narrowed. Baselines (`baselines.ts`) stay deliberately
tag-blind (naive comparators). Product/eval parity: the same swap landed in `run.ts`,
`eval/loop_quality.ts`, and `eval/src/harness/pipeline.ts`.

## 48-brief VAL comparison (same corpus, same machine, same stack)

| metric                       | v8 (tag-blind) | v9 (class-aware)                                |
| ---------------------------- | -------------- | ----------------------------------------------- |
| briefs passing all AC        | **10/48**      | **10/48** (zero regression, zero verdict flips) |
| mean presented               | 3.0            | 3.0                                             |
| mean duration error of best  | 15 %           | 15 %                                            |
| mean wall time / brief       | 2441 ms        | 2437 ms                                         |
| best-route curviness, mean   | 1.069          | 1.036                                           |
| best-route curviness, median | 0.96           | 0.89                                            |

The AC bars (durErr, u-turns, spurs, retrace, residential, µloops) are mechanically
independent of curviness — identical pass sets confirm no ranking side-effects leaked into
quality gates.

## Bests that CHANGED (3/48) — the fix doing its job

| brief                            | v8 best                          | v9 best                              | reading                                                                                                                          |
| -------------------------------- | -------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 2 h twisty loop, **Collingwood** | 139 min · curv **0.45**          | 135 min · curv **0.87**              | the old winner rode fake ramp curvature; with honest measurement a genuinely twistier route wins — exactly the owner's complaint |
| 2 h loop, **Creemore**           | 118 min · curv 0.99 · 5 offences | 123 min · curv 0.76 · **0 offences** | ramp-inflated best dethroned; the new best is cleaner AND closer to target                                                       |
| 90 min forest loop, **Kilbride** | 92 min · curv 0.98               | 87 min · curv 1.07                   | re-ranked toward real curves                                                                                                     |

## Largest per-brief curviness corrections (junction wiggle removed from the READING)

Creemore 0.99→0.76 · Stratford 0.82→0.62 · Burlington 2.98→2.84 · Ancaster 2.09→1.96 ·
Pelham 1.51→1.39 · St. Catharines 1.14→1.02 · St. Jacobs 1.43→1.31 · Brantford 0.84→0.75.
(45/48 bests are unchanged routes whose displayed "twistiness" is now honest.)

## Governance

- Per the §21 discipline line in `params-frozen.json` ("any later change = new config id +
  fresh VAL pass"): config id bumped to **frozen-m4t12-v9**, provenance `round15` added,
  `CURVATURE_CLASS_AWARE: true` recorded with the exclusion list.
- Unit coverage: 10 synthetic cases (ramp/roundabout/motorway exclusion, gap-reset,
  fallback honesty incl. index-consistency guards, all-excluded, length-weighted
  aggregation) + `_link` hardening tests in `candidates`/`residential` (vocabulary armor —
  inert on current data). Backend suite 214 green.
- **Owner ratification requested** (this report = the evidence).
