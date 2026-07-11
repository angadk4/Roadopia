# [GATE-R] Ranking — R1 deterministic top-1 vs R4 LLM selection (M4-T08)

Pre-registered rule (fixed before results; see experiments/ranking.ts header): adopt R4
iff blind preference ≥60% of non-tie judgments with Wilson 95% lower bound >50%, AND
gold satisfaction ≥ R1, AND ≤3 s / ≤$0.03 per selection, AND <90% agreement (practical-
value floor). Default: R1 + R6 (LLM explanation only). Same pool both ways; shortlist =
feasible kept (K≤4); claude-sonnet-4-6, temperature 0, N=3, fact sheets carry no geography.

## Automated metrics (VAL, 15 briefs run, 1 excluded)

| metric                           | R1           | R4           |
| -------------------------------- | ------------ | ------------ |
| gold_constraint_satisfaction (P) | 1.000 (n=15) | 1.000 (n=15) |
| duration_pct_error_median        | 0.2          | 0.2          |

Agreement (R4 modal = R1) on briefs with a real choice: 50% of 8.
Stability: flip rate 50% of 8 (any pick change across 3 repeats).
Invalid model outputs: 0/24 calls; deterministic fallbacks: 0.
Mean selection latency 2546 ms · mean cost $0.0035/selection.
Excluded: val-021 (no feasible candidate (pool excluded)).

## DECISION: PENDING owner blind pairwise — 4 disagreement pair(s) in reports/ranking-pairwise-sheet.md

Cost ledger: 27 calls · $0.0961 (budget $2).

## DECISION ([GATE-R], judged sheet unsealed)

Blind pairwise: 4 judged (1 ties) — R4 preferred 2/3 non-tie (67%, Wilson 95% lower 21%). Criterion (≥60% and lower >50%): not cleared.
Gold satisfaction R4 ≥ R1: CLEARED · budget: CLEARED · practical-value floor (<90% agreement): CLEARED.

**KEEP R1 + R6 (deterministic top-1, LLM explanation only)** — a pre-registered criterion was not cleared; M5-T08 LLM selection is NOT built.
