# R26 — Planner backlog: give it the roads

**Status:** proposed 2026-07-27, awaiting owner go. Built on the R25 measurement stack
(audit-v12, BD-84..96). Execution discipline unchanged: every lever flag-gated with a
byte-identical OFF, pre-registered adopt-or-refuse A/B on both suites, refusal is honourable.

---

## The finding this backlog exists to act on

The owner's ask has been constant: **"maximizes backroads, twisty roads, country roads —
not main roads."** R25 fixed highways (8.9% → 0.6%), the neighbourhood gate, A→B route
retention, and every honesty defect. Main-road share did not move. Six levers were refused
attacking it (BD-39, BD-62, BD-81, BD-82, BD-93, BD-96).

The reason, measured 2026-07-27:

**The planner cannot see three quarters of the region's country roads.**

`curvy_segments` is not a curvy-roads table — it is the **whole road network** (133,865 rows,
curvature computed per segment, min 0.000). Country roads are present and indexed. They are
excluded at *retrieval* by **three independent gates**, and all three must change together or
the fix is inert:

| # | Gate | Where | Effect |
|---|---|---|---|
| 1 | `circum_curvature_per_km >= 0.6` | every retrieval RPC (0001/0003/0004/0005) | straight country roads (avg curvature ~0.10) fail the floor |
| 2 | `order by circum_curvature_per_km desc limit N` | `find_curvy_roads` | even at θ=0 they sort LAST — the limit never reaches them |
| 3 | `segValue = curviness × length × classFactor` | `candidates.ts` | even if retrieved, a straight road scores ~0 and never becomes a waypoint |

Measured material, tertiary + unclassified ("country road"):

| θ | visible km | of total | |
|---|---|---|---|
| 0.6 (default) | 5,550 | 21,548 | **26%** |
| 0.4 (relax rung) | 6,532 | | 30% |
| 0.2 | 8,128 | | 38% |

**~16,000 km of country road is loaded, indexed, and never offered as drive material.**
The invisible set is clean and identifiable: unclassified 10,130 km + tertiary 5,868 km,
average curvature ~0.10. (Residential 15,299 km stays excluded — correct, that's the
neighbourhood defect. Secondary/primary 13,785 km stays excluded — correct, that's "main
roads".)

Note the asymmetry that proves the point: `retrieveAnchorPoints` already queries with
`p_min_curviness := 0` — the anchor pool sees everything. Only the material you actually
**drive on** is gated.

**Every prior refusal re-priced, re-ranked, re-seeded or re-steered a pool drawn from a
quarter of the available backroad.** The U1 diagnostic's "8 of 12 pools contain ZERO
backroad-majority candidates" is not a ranking failure — it is arithmetic.

---

## Ordering law

1. **A1 before anything.** If the material isn't reachable from real origins either, we learn
   it in an hour instead of a month — and this whole backlog changes shape.
2. **A2 + A3 land together.** Retrieval without the value function is inert (gate 3);
   the value function without retrieval has nothing to price (gates 1–2). Judge them as one
   lever, then bisect if mixed — the BD-86 precedent (a/b judged together for exactly this
   reason).
3. **A4 re-baselines everything.** Every later A/B compares against post-A4 hashes.
4. **Phase B after A.** U19's own probe showed steering works where dense parallel corpus
   exists; A2 is what creates that condition. Re-testing it on different input is legitimate,
   not re-litigation.
5. **C1 after B2.** A turn penalty cannot work while `shortest` is the fun mechanism —
   `shortest` bypasses `maneuver_penalty` along with every soft factor.
6. **D1 after A4.** The core sweep's bars (backroad ≥55%) were unreachable with 26% of the
   backroad; they may simply clear.
7. **E1 (instrument fix) at a phase boundary only** — notes feed the determinism hash, so it
   is a deliberate re-baseline, never a drive-by.

---

## Phase A — Give the planner the roads

### A1 — Country-road census *(diagnostic; can cancel or reshape this backlog)*
Per-origin, region-wide: how much tertiary/unclassified road-km sits within a 45/60/90-minute
reach of real origins, at what curvature and urban share, and how much is genuinely drivable
(not driveway/track/seasonal). Reuse the sweep's cell grid.
**Output:** the fraction of live origins that could support a backroad-majority drive *at all*.
**Verdict rule (pre-registered):** if <40% of origins have ≥25 km of reachable country road,
the ceiling is the corpus itself and this backlog is replaced by a corpus/extract program
(SPK-08's filter, `data/extract.sh`) — said publicly, not quietly.

### A2 — Class-aware retrieval tier *(migration 0017)*
A second retrieval path beside the curvy one: tertiary + unclassified, **low** curvature floor,
urban-excluded, **ordered by class-weighted length, not curviness** (gate 2 is the one everyone
would miss). Retrieval returns `curvy ∪ country`, deduped by id, with a per-tier limit so the
curvy pool cannot be crowded out.
**Flag** `COUNTRY_TIER`; OFF ⇒ byte-identical retrieval.
**Watch:** retrieval latency (Discover's scan is already 2–4 s), pool size 4×.

### A3 — A value function that can choose a country road
`segValue` today is `curviness × length × classFactor` — multiplicative, so curvature ~0.10
zeroes everything. Reform to a **base + bonus** shape: class × length carries the base,
curviness adds a bounded bonus. Keep the R24 de-switchback flow factor.
**Flag** `COUNTRY_VALUE`. Judged together with A2 per the ordering law.
**PRE-REGISTERED BARS (both suites):** backroad share of bests **+10 pp**; main share **−8 pp**;
**KILL — curviness ≥95% of baseline** (the bar that killed BD-62/92/94: we are not trading the
fun away for class); AC not down >1; no-route not up; wall ≤ +1.5 s.
**Kill → bisect:** retrieval-only (does the pool change but selection not?) vs value-only.

### A4 — Re-baseline and re-diagnose
Fixed + random + atob at the adopted config; re-run the **U1 pool diagnostic** (does "8/12 pools
have zero backroad-majority candidates" flip?) and re-measure the `kept ≥ 4` histogram (today:
50% of random origins sit at kept ≤2). New frozen hashes; everything downstream compares here.

---

## Phase B — The connectors, with something to steer toward

### B1 — Connector costing probe *(never done; ~40 engine calls)*
Sweep on live pairs: **`top_speed`** (a low ceiling makes fast roads unattractive — a road-class
proxy nobody has probed), `use_tracks`, `use_living_streets`, and bicycle-costing as a corridor
*sampler* (not a wholesale replacement — that was measured and rejected in R25 planning).
Same falsify-first shape as the U19 probe: the probed code is the shipped code, verdict rule
written before the run.

### B2 — Adopt the winning connector costing for fun/backroads profiles
Only if B1 produces a qualifying combo. This is the ~90% of route metres nothing has moved.

### B3 — U19 re-test on the new corpus
`CONNECTOR_REFINE` is already built, adversarially reviewed (5 confirmed defects fixed), unit
tested, and flag-gated. Its probe measured +14 to +45 pp where dense parallel corpus exists.
A2 creates that condition. Re-register bars; it may refuse again, and that is fine.

---

## Phase C — The felt complaints that survive the material fix

### C1 — Turn density ("a stop sign every two minutes")
Re-test `TURN_GRADE` (refused in BD-90 because the turn-heavy pools contained no clean
alternative — new material may supply one) **and** `maneuver_penalty`, which only becomes usable
once B2 moves connectors off `shortest`.
**Bars:** briefs over 5 turns/10 min → ≤3; worst ≤6; curviness kill unchanged.

### C2 — Loop shape, re-measured not re-attacked
Measure loopiness after A4 before touching anything. Rings were refused (BD-96) because only
10% of random briefs sat one candidate below the diversity bar — 4× material may move that on
its own. Re-test rings **only** if loopiness is still short and `kept ≥ 4` is still binding.

### C3 — The `kept ≥ 4` starvation
Today 50% of random origins cannot produce four distinct drives and three produce none — the
real "no options here" failure. If A4 doesn't fix it, it becomes its own retrieval-diversity
unit (per-sector quotas at retrieval, not at candidate generation).

---

## Phase D — Discover: the product shape the owner asked for

### D1 — Re-run the drive-core sweep on the new corpus
The kill condition fired on `main_share×15 · backroad_share×13` — bars that were unreachable
with 26% of the backroad. Re-run and read the histogram.

### D2 — If it clears: ship the rebuild that is already written
Load the index, serve `/discover` **v2** (three legs: the drive + fresh get-there/get-home),
flip the app's dark switch. Backend, contract, client and UI all exist behind flags.

### D3 — If it does not clear: the honest fallback
`bar_profile='cell_relaxed'` per ACP-001 — best-around-here cards that state their own numbers
("44% backroad, not the 60% we aim for"), sorted below strict cores.

### D4 — Settle the Stage-1 gates
`DISCOVER_GATES` is opt-in pending the index (BD-91). D1/D2 decide it.

---

## Phase E — Prove it, freeze it, ship it

- **E1 — Instrument fix:** emit the funnel line on PASS rows + a per-brief tier/ring count
  (today the harness censors notes on passing briefs, so wins are unobservable). Deliberate
  re-baseline at a phase boundary.
- **E2 — audit-v13:** same 110 routes, same seed. Headline: main-road share, and clean drives
  0/60 → ?
- **E3 — Freeze `frozen-r26-v1`**, decision log BD-97+, BUILD_LOG, one-line commits.
- **E4 — [HUMAN] device pass:** a Fun loop that is mostly country road, few interruptions,
  and looks like a loop.

---

## Honest expectations

- **Near-certain:** the planner will finally *see* the country roads (A2/A3 is plumbing over
  material we have already measured as present).
- **Likely:** main-road share moves for the first time in the project's history — this is the
  first lever that changes what is *in the pool* rather than how the pool is sorted.
- **Genuinely uncertain:** whether it moves *enough*, and whether curviness survives it. A
  straight concession road is a backroad but it is not twisty; the owner wants both. The
  curviness kill condition is there precisely because that trade is the one way this goes wrong.
- **Expected to refuse:** at least one of B2/B3/C1. That is the discipline working.
- **Not promised:** clean drives 0/60 → high. The clean bar is a 9-clause conjunction; material
  fixes the road-class clauses, not all of them.
