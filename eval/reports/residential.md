# Round 7 — residential exposure: measurement gate + maneuver_penalty sweep

The fix has two parts. (1) MEASUREMENT GATE (always on, this config): every
otherwise-accepted candidate is traced (`/trace_attributes`, per-edge road class);
residential share outside the 2.5 km origin grace > 5 % ranks below every clean
route at presentation AND fails the AC; > 20 % is rejected at assembly. Valhalla 3.7
has NO residential costing knob (verified against source) — measuring is the only
exact control. (2) COSTING: use_living_streets pinned 0; maneuver_penalty swept below.

Pre-registered winner rule in experiments/rq7_residential.ts (fixed before any run).

## DEV sweep (10 briefs)

| maneuver_penalty | mean res share (presented) | above-soft share | best curv μ | med \|err\| | kept μ | feas |
| ---------------- | -------------------------- | ---------------- | ----------- | ----------- | ------ | ---- |
| 5                | 2.1%                       | 14%              | 1.51        | 5.7%        | 2.8    | 90%  |
| 15               | 2.4%                       | 11%              | 1.50        | 11.0%       | 2.8    | 90%  |
| 30               | 1.8%                       | 11%              | 1.43        | 6.0%        | 2.8    | 90%  |

Winner: **maneuver_penalty = 5** (engine default — no swept value cleared all three criteria; the measurement gate alone carries round 7).

## VAL validation (16 briefs)

| maneuver_penalty | mean res share | above-soft share | best curv μ | med \|err\| | kept μ | feas |
| ---------------- | -------------- | ---------------- | ----------- | ----------- | ------ | ---- |
| 5                | 2.6%           | 13%              | 1.45        | 14.0%       | 2.7    | 94%  |

## Config frozen-m4t12-v2 deltas: use_living_streets 0 · maneuver_penalty 5 · RESIDENTIAL_SOFT_SHARE 0.05 (presentation/AC) · RESIDENTIAL_HARD_SHARE 0.20 (assembly).
