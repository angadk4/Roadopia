# R28 — Serve live loops from measured-clean cores

**Status: PLANNED, owner-briefed 2026-07-31. Not started.**
Read this with `docs/decision-log.md` BD-117 → BD-124, which contain the measurements it rests on.

---

## The one fact this plan exists for

Same corpus, same region, same engine, measured in audit-v14/v15:

| | backroad | doubling back |
|---|---|---|
| live loop planner (the drive portion) | **43 %** | 44/60 have some |
| Discover's offline drive-cores | **86 %** | **1/179** |

The only difference is METHOD. Discover generates candidates in bulk offline and
**hard-rejects on measured road class**, keeping survivors. The live planner generates ~16 candidates
per request inside a 25 s budget and keeps whatever survives — usually nothing clean.

## Why nothing else is left to try

Every non-generation lever has been built, measured and refused. This is not pessimism, it is the
record:

- **Ranking** — 4 refusals. BD-39 (country weight), BD-62 (shape demote), BD-103 (max-dispersion
  diversify), and BD-123, which built the owner's OWN first-order rule ("backroads must be the
  majority") correctly and moved **main_majority 43/60 → 43/60. Inert.**
- **Connector costing** — 3 refusals. `top_speed:50` (BD-100/119: +13 pp backroad but blew the 25 s
  budget, 58 % of loops shipped truncated), `top_speed:60` (BD-123: +3 pp backroad, everything else
  worse), U19 via-steering (BD-93/104/114, six attempts across two instruments).

**Selection cannot fix what generation did not produce.** The evidence is now overwhelming enough to
stop re-testing that category.

## The plan

### R28-1 — Widen the offline generator, re-sweep the region
The index is thin: **39 of 1177 live cells** hold ≥3 cores (BD-112). D5 (BD-116) measured the fix:
**3.25× the candidate slots doubles cores and fills, with ZERO regressions** (4/40 → 8/40 filled, no
cell lost). Raise `LOOP_ORIGINS_PER_CELL` / `LOOP_CANDIDATES_PER_ORIGIN` (both env-overridable since
BD-116) and re-run the full sweep.
The sweep is now safe to run unattended (BD-107): resumable with a stamped checkpoint, torn-line
tolerant, and infrastructure errors are reported rather than silently counted as dead cells. ~5.5 h,
offline, one-time. **The 25 s budget stops being the binding constraint** — this is the whole point.
DO NOT relax the quality bars to fill cells (BD-112 measured that path: relaxing the single binding bar
reaches only 6.3 % of cells). Widen generation, keep the bars.

### R28-2 — Live loops build FROM cores
The planner's job becomes *pick the best drive near you and connect to it honestly*, instead of
*invent a loop from scratch in 25 s*. This is where the 86 % and the near-zero doubling arrive.
Reuse the three-leg machinery already built (`backend/src/planner/legs.ts`, BD-124): core = THE DRIVE,
connectors = getting there / getting home.
**Product consequence, already flagged to the owner:** drives come from a curated regional index rather
than being invented per request. Discover already works this way and it is the part that measures well.

### R28-3 — Size THE DRIVE to the requested duration
audit-v15: the split is **there 28 % · drive 49 % · home 23 %** — nearly half of a "90 minute loop" is
the commute to and from it. A user asking for 90 minutes gets ~43 minutes of actual drive.
Once cores are the unit, target the requested duration at the CORE, and disclose the connectors
separately (the card already has the data: `PlannerResult.legs`).

### R28-4 — Shape, only after the above, and only with a NEW mechanism
Loopiness is 0.28–0.31 with four recorded refusals (BD-62, BD-92, BD-94/95/96). **A hypothesis was
tested and FALSIFIED on 2026-07-31**: the drive is not a rounder loop than the whole trip (0.282 vs
0.307; MORE drives under 0.15, 14 vs 5), so shape is its own problem, not an artifact of the commute.
Cores are hard-rejected on loopiness at build time, so R28-1/2 may partly solve it. If they do not,
say so — do not run a fifth refusal.

---

## Carried open items (not part of R28's thesis, still true)

- **Out-and-back**: worst case fixed (19 441 → 5 813 m on a holdout) but **44/60 loops still contain
  some**, all small. The 1 200 m threshold measured better than the adopted 2 500 m but rejects the
  `loop.test.ts` live-engine fixture; that fixture must be measured before the threshold moves (BD-121).
- **The drive is main-majority on 16/25 loops** — the three-leg split made the number honest, it did not
  make the drive good.
- **`shortest` bypasses the highway avoid** — a known property, re-introduced by the BD-119 revert. Mean
  highway is 0.3–0.5 %, so it is not currently urgent, but it is a live trap for any future costing work.
- **Relaxation drops quality gates wholesale** — 21/60 loops arrive `relaxed`, and all 5 gate-bypassing
  doublings were `relaxed` (BD-122 fixed the ranking half of this; the ladder itself still surrenders
  constraints in no priority order).

## The rule this program keeps re-learning

Judge planner changes through **`runPlanner`** — the real production entry, which enforces the 25 s
budget — never through `eval/loop_quality.ts`, which re-implements the pipeline and cannot see it.
BD-100 was adopted on the blind instrument and shipped truncated routes to the owner for weeks.
