# [GATE-C] Curvature experiment — road-level formulas vs owner ratings (M4-T06)

Pre-registered BEFORE computation: pass iff Spearman ρ ≥ 0.7 AND grid-FP ≤ 0.15
(grid-FP = share of rating-≤2 roads scoring above the median score of rating-≥4 roads).
Decision rule: simplest single formula clearing both; C8 only if none does; if nothing
passes → numeric fun-scoring NOT adopted; per-km curvature keeps its retrieval-filter role.

Ground truth: owner sheet (40 roads, filled 2026-07-11); 40 matched in the corpus.

| formula | description                             | Spearman ρ | grid-FP | passes |
| ------- | --------------------------------------- | ---------- | ------- | ------ |
| C2      | heading change per km (lw mean)         | 0.396      | 0.294   | no     |
| C4      | significant turns per km (lw mean)      | 0.404      | 0.118   | no     |
| C7      | circumcircle curvature per km (lw mean) | 0.398      | 0.294   | no     |
| C7·L    | total curvature budget (C7 × total km)  | 0.511      | 0.118   | no     |
| log C7  | log1p of C7 (density, damped)           | 0.398      | 0.294   | no     |
| C8      | composite: mean z(C2, C4, C7)           | 0.404      | 0.176   | no     |

## Retrieval-filter role check (θ = 0.6)

Fun roads (rating ≥ 4): 10. Surfaced by find_curvy_roads at θ=0.6 (≥1 segment with C7 ≥ 0.6): 10/10. Traversal-eligible (≥1 segment ≥ 1.2 km): 10/10.
No fun road is invisible to retrieval at θ=0.6.

## Per-road data

| road                        | rating | urban | segs | km   | C2    | C4    | C7   | maxSegC7 |
| --------------------------- | ------ | ----- | ---- | ---- | ----- | ----- | ---- | -------- |
| Forks of the Credit Road    | 5      |       | 12   | 5.9  | 168.8 | 5.40  | 2.78 | 8.55     |
| West River Road             | 5      |       | 5    | 8.3  | 83.0  | 3.38  | 1.42 | 4.75     |
| 4th Line East               | 5      |       | 3    | 10.0 | 96.8  | 4.48  | 1.66 | 3.31     |
| 15th Sideroad               | 4.5    |       | 6    | 7.4  | 75.6  | 3.40  | 1.31 | 2.87     |
| 2nd Line EHS                | 4.5    |       | 2    | 4.3  | 84.0  | 4.62  | 1.46 | 1.96     |
| Snake Road                  | 4      |       | 2    | 3.5  | 218.8 | 9.16  | 3.72 | 4.83     |
| King Road                   | 4      |       | 4    | 3.7  | 190.3 | 7.23  | 3.20 | 4.16     |
| Cedar Springs Road          | 4      |       | 4    | 7.5  | 70.1  | 2.39  | 1.16 | 2.16     |
| 25 Side Road                | 4      |       | 6    | 8.6  | 78.9  | 3.37  | 1.35 | 2.85     |
| 12th Line                   | 4      |       | 5    | 12.2 | 15.3  | 0.33  | 0.25 | 0.66     |
| Creditview Road             | 3.5    |       | 12   | 6.7  | 85.9  | 3.58  | 1.44 | 9.90     |
| Hockley Road                | 3      |       | 7    | 8.0  | 67.5  | 1.76  | 1.09 | 3.83     |
| River Road                  | 3      |       | 2    | 2.0  | 294.2 | 14.04 | 5.06 | 6.30     |
| Sydenham Road               | 3      |       | 6    | 3.3  | 57.9  | 2.11  | 0.95 | 6.22     |
| Kelso Road                  | 3      |       | 4    | 2.5  | 119.7 | 3.65  | 2.03 | 2.68     |
| Campbellville Road          | 3      |       | 8    | 9.5  | 36.1  | 0.84  | 0.58 | 3.33     |
| Doane Road                  | 3      |       | 7    | 7.9  | 40.2  | 1.14  | 0.63 | 1.94     |
| 10th Concession             | 3      |       | 6    | 10.2 | 27.8  | 1.18  | 0.42 | 0.95     |
| 15 Side Road                | 3      |       | 6    | 8.4  | 64.0  | 2.62  | 1.07 | 1.49     |
| 20 Sideroad                 | 3      |       | 1    | 9.5  | 33.1  | 0.63  | 0.53 | 0.53     |
| 5th Line                    | 3      |       | 2    | 5.1  | 37.9  | 1.37  | 0.64 | 0.94     |
| Mountainview Road           | 2.5    |       | 8    | 9.2  | 10.4  | 0.44  | 0.15 | 2.93     |
| Stonehaven Avenue           | 2.5    | Y     | 1    | 2.0  | 142.4 | 7.90  | 2.43 | 2.43     |
| Guelph Line                 | 2      |       | 8    | 11.5 | 65.2  | 2.69  | 1.07 | 12.05    |
| Mississauga Road            | 2      |       | 17   | 6.2  | 90.1  | 4.03  | 1.51 | 7.26     |
| Winston Churchill Boulevard | 2      |       | 9    | 9.8  | 27.8  | 0.81  | 0.44 | 10.40    |
| Escarpment Sideroad         | 2      |       | 6    | 4.9  | 37.8  | 1.02  | 0.60 | 2.01     |
| Heritage Road               | 2      |       | 10   | 4.2  | 21.7  | 0.48  | 0.30 | 4.04     |
| York Road                   | 2      |       | 4    | 6.2  | 106.0 | 3.85  | 1.75 | 2.78     |
| North Service Road West     | 2      | Y     | 10   | 5.1  | 164.6 | 7.87  | 2.79 | 7.47     |
| Bridge Road                 | 2      | Y     | 3    | 4.3  | 101.3 | 3.04  | 1.65 | 2.05     |
| 10 Side Road                | 2      |       | 4    | 7.4  | 72.8  | 2.85  | 1.21 | 10.88    |
| 20 Mile Road                | 2      |       | 12   | 8.0  | 43.7  | 0.50  | 0.68 | 2.47     |
| 10th Sideroad               | 2      |       | 1    | 18.0 | 8.9   | 0.06  | 0.13 | 0.13     |
| 20th Sideroad               | 2      |       | 2    | 6.9  | 18.0  | 0.43  | 0.28 | 0.46     |
| Safari Road                 | 1.5    |       | 2    | 8.1  | 6.9   | 0.37  | 0.11 | 0.16     |
| Huntsmill Boulevard         | 1      | Y     | 1    | 2.6  | 237.4 | 14.91 | 4.02 | 4.02     |
| 3rd Line EHS                | 1      |       | 2    | 6.4  | 20.4  | 1.09  | 0.35 | 0.54     |
| 3rd Line                    | 1      |       | 3    | 9.5  | 0.0   | 0.00  | 0.00 | 0.00     |
| 4th Line                    | 1      |       | 3    | 6.5  | 0.1   | 0.00  | 0.00 | 0.00     |

## DECISION ([GATE-C], per the pre-registered rule)

**No formula passes** (best ρ = 0.511, C7·L; bar 0.70). Therefore:

1. **Numeric road-level fun-scoring is NOT adopted.** No user-facing "twisty
   score"/"fun score" claims ship; curvature stays a labels/signals input
   (consistent with Hard rule C and the [GATE-S] labels-only default).
2. **C7 keeps its RETRIEVAL role, and it is validated there: 10/10 owner-rated
   fun roads are surfaced at θ = 0.6** (and 10/10 have a traversal-eligible
   ≥1.2 km segment). **THETA_CURVY freezes at 0.6**; C7 (circum_curvature_per_km)
   freezes as the retrieval/measurement metric (M3-T05 dependency resolved).
3. **Honest positive:** the best predictor of owner fun (C7 × length, ρ 0.511)
   is exactly the generator's cluster-ranking key (curviness × length × class,
   BD-21) — the ranking design is directionally validated by driven ground truth.
4. **Honest negative for the eval page:** per-km curvature density ranks short
   urban squiggles and busy escarpment climbs above flowing rural roads the
   owner rates 4–5. Road-level "fun" needs context (road class, sustained
   length, setting) — recorded as future work, not shipped as a score.
