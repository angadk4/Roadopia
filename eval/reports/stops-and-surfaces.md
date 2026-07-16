# Typed multi-stop + fraction timing + honest surfaces — config v9 → v10 (R16)

**Date:** 2026-07-16 · **Config:** `frozen-m4t12-v9` → `frozen-m4t12-v10` · **Discipline:** §21
(capability change ⇒ new config id + fresh 48-brief VAL pass) · **Owner ask:** Round 16 —
restructure the Plan screen into sections that are _actually wired_ (multi-stop builder with
timing, paved-only, honest scenery).

## What changed (capability, not tuning)

| Area                | v9                                                               | v10                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stop representation | ≤ 1 spot per candidate, **type-blind** nearest, scalar count     | `CandidateStop[]` — per-type, per-unit anchoring; fraction-timed units placed at the asked point of the drive                                                                                        |
| Stop waypoints      | `through` pass-throughs (no leg splits)                          | **`break_through`** (probed: the only leg-splitting non-terminal type) → **measured arrivals** = Σ leg durations                                                                                     |
| Stop validation     | one scalar `stops` gate                                          | per-type Tier-2 `stop_<type>` (a covered coffee can't hide a missing required fuel) + Tier-3 `stop_timing_<type>` (tol **0.2** of duration, actual % disclosed)                                      |
| Stop scoring        | count ratio                                                      | `stop_cover` = per-type mean of min(1, included/requested)                                                                                                                                           |
| Surfaces            | `has_unpaved` hardcoded false ("paved only" was a paper promise) | `exclude_unpaved` costing wired (probed **best-effort** — steering only) + trace `edge.unpaved` result-scan > **UNPAVED_MIN_M = 50 m** overrides the flag honestly (BD-16: result-scan is the truth) |
| Corpus              | no food spots                                                    | +16,326 food rows (restaurants + fast food) — corpus 21,366                                                                                                                                          |
| Presets             | —                                                                | `simple` = chill's **exact** frozen vector relabeled (owner vocabulary; no new science; byte-equality pinned by test)                                                                                |

Frozen numbers (weights, C7, THETA, ladder, caps) untouched.

## Regression guard — 44 stop-free briefs (and, it turned out, all 48)

Full 48-brief loop-quality run against the live tier + engine, diffed feature-by-feature
against the v9 run's best-route artifact:

- **48/48 best geometries byte-identical** (coordinates arrays compared exact)
- **0 diffs** in routed_min, distance_km, or pass/fail verdicts
- Headline: **AC 10/48 → 10/48** · mean presented 3.0 · mean |dur err| 15 % · mean wall 2.6 s

Even the 4 stop briefs (Dundas coffee, Erin coffee, Fonthill fuel, Niagara viewpoint) kept
their v9 shapes: retrieval already fed only requested-type spots, so the v9 type-blind pick
and the v10 typed pick choose the same spot there; `break_through` split legs without moving
the path. **The new machinery added measurement and coverage semantics while changing nothing
the corpus already measured.**

## Live proof (new capability, real wire)

`plan_stream_e2e.ts` stops run — structured body (the Plan screen's builder shape),
Guelph origin, "coffee midway + gas late":

```
stop: Tim Hortons [coffee] at_fraction=0.5  arrival=78 min
stop: Pioneer     [fuel]   at_fraction=0.75 arrival=118 min
verdicts: stop_coffee=satisfied | stop_fuel=satisfied |
          stop_timing_coffee=satisfied | stop_timing_fuel=satisfied
```

Arrivals measured (not estimated), monotonic, inside the asked windows. Earlier direct-planner
probe (parse path, "coffee stop halfway and a gas stop"): Rumbletum 37 % + Transit Fuel 41 %
of a 126-min drive — timing verdicts disclose the actual percentage either way.

## Defect found by the live probe (fixed in-round)

The rules parser's stop-timing regexes shipped with `\b` written as a literal **0x08 byte**
(python-patch artifact) — dead patterns, silently `null` fractions. Fixed byte-level; repo
swept clean; `parse_rules` test 11 now pins the phrase vocabulary so a dead pattern of this
class fails the suite.

## Verdict

**ADOPT v10.** Zero corpus regression (byte-identical), new capability live-proven, honesty
gates (per-type coverage, measured-or-null arrivals, result-scanned surfaces) in place.
Owner ratification requested alongside BD-57.
