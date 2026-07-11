# [GATE-F] Correction — deterministic F1∪F2∪F5 vs F4 LLM-mapped repair (M4-T09)

Pre-registered rule (fixed before results; see experiments/gate_f.ts header): adopt F4 iff
efficacy ≥ deterministic + 10 pp AND new_violation_rate ≤ deterministic AND within
latency (all runs ≤ 25 s, mean ≤ 1.5× deterministic). Default: F1 + F2 + F5.

Seeds: 9 first-pass failures from DEV (31 runnable briefs scanned): dev-001, dev-002, dev-018, dev-024, dev-029, dev-031, dev-034, dev-036, dev-044

| metric                        | D (F1∪F2∪F5) | F4 (LLM, mean of 3)               |
| ----------------------------- | ------------ | --------------------------------- |
| self_correction_efficacy      | 11%          | 11% (per repeat: 11% / 11% / 11%) |
| new_violation_rate (repaired) | 0%           | 0%                                |
| mean arm latency              | 1025 ms      | 5488 ms                           |

Wall p90 (all runs): 7671 ms (budget 25000). Move-sequence flips across repeats: 0/9. Invalid outputs 0/75 calls; deterministic fallbacks 0.

## DECISION ([GATE-F], per the pre-registered rule)

| criterion                          | value                        | cleared |
| ---------------------------------- | ---------------------------- | ------- |
| efficacy(F4) ≥ efficacy(D) + 10 pp | 11% vs 11%                   | no      |
| new_violation_rate(F4) ≤ D         | 0% vs 0%                     | YES     |
| latency within budget              | p90 7671 ms; 5488 vs 1025 ms | no      |

**KEEP the deterministic correction stack (F1 deterministic repair + F2 generate-more + F5 relaxation/best-so-far)** — a pre-registered criterion was not cleared; M5-T08 LLM correction is NOT built.

Cost ledger: 75 calls · $0.0589 (budget $2).
