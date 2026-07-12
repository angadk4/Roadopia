# M4-T12 — parameter calibration (DEV) → validation (VAL) → freeze (§21)

Pre-registered winner rules in experiments/calibrate.ts (fixed before any sweep ran).
DEV sweep briefs: dev-003, dev-011, dev-013, dev-001, dev-002, dev-004, dev-010, dev-008, dev-009, dev-043.

## Sweeps (10 DEV briefs; baseline = current defaults)

| config     | feas-rate | med \|err\| | mean kept | mean feasible | p90 wall |
| ---------- | --------- | ----------- | --------- | ------------- | -------- |
| baseline   | 80%       | 14.9%       | 2.0       | 2.0           | 3s       |
| alpha=0.45 | 90%       | 14.7%       | 2.5       | 2.5           | 1s       |
| alpha=0.65 | 80%       | 14.7%       | 2.1       | 2.1           | 2s       |
| speed=45   | 80%       | 14.9%       | 2.2       | 2.2           | 2s       |
| speed=65   | 80%       | 14.9%       | 1.9       | 1.9           | 2s       |
| sectors=4  | 80%       | 8.7%        | 2.5       | 2.5           | 2s       |
| sectors=6  | 80%       | 14.4%       | 2.0       | 2.0           | 2s       |
| cand=30    | 80%       | 14.9%       | 2.0       | 2.0           | 2s       |

Duration winner: **alpha=0.45** · pool winner: **sectors=4**.

## VAL validation (16 runnable briefs)

| config                              | feas-rate | med \|err\| | mean kept | mean feasible | p90 wall |
| ----------------------------------- | --------- | ----------- | --------- | ------------- | -------- |
| VAL baseline                        | 94%       | 17.0%       | 2.1       | 2.0           | 3s       |
| VAL combined(alpha=0.45,nSectors=4) | 94%       | 14.0%       | 2.7       | 2.6           | 2s       |

## TAU_OVERLAP re-finalize (frozen pools, presentation-only)

| τ   | mean kept |
| --- | --------- |
| 0.4 | 2.1       |
| 0.5 | 2.2       |
| 0.6 | 2.7       |
| 0.7 | 2.8       |

Pick: **0.6** (default holds unless strictly better — pre-registered).

## DURATION_TOLERANCE: p80 of frozen-config |err| = 16.5% → **0.2** (round-up to 0.05, clamp [0.10, 0.25]); misses beyond it disclose.

## FROZEN (eval/params-frozen.json, config frozen-m4t12-v1)

```json
{
  "ALPHA_LOOP": 0.45,
  "MAX_TAU_S": 6900,
  "base_speed_kmh": 55,
  "base_speed_no_highway_kmh": 42,
  "LOOP_LENGTH_FACTOR": 4.8,
  "N_SECTORS": 4,
  "K_CLUSTERS": 8,
  "N_CANDIDATES": 20,
  "CLUSTER_RADIUS_M": 2500,
  "K_PRESENT": 4,
  "TAU_OVERLAP": 0.6,
  "DURATION_PREFILTER": 0.35,
  "DURATION_TOLERANCE": 0.2,
  "EPSILON_CLOSURE_M": 300,
  "SELF_OVERLAP_SOFT": 0.15,
  "SELF_OVERLAP_HARD": 0.3,
  "RETRACE_RUN_SOFT_M": 1200,
  "THETA_CURVY": 0.6,
  "curvature_formula": "C7 (circum-curvature per km), BD-26",
  "scenic_weight": 0,
  "scoring_weights": {
    "dur": 0.3,
    "cur": 0.35,
    "stop": 0.1,
    "scenic": 0,
    "overlap": 0.25,
    "uturn": 0.1
  },
  "preset_weights": "PRESET_WEIGHTS frozen as-is (BD-30)",
  "iteration_cap": 3,
  "wall_clock_budget_ms": 25000,
  "detour_max": "DEFERRED — A→B ships at M6; calibrate then (new config id)",
  "slider_ranges": "N/A — W1 presets-only (BD-30)"
}
```
