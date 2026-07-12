# Round 11 — countryness weight sweep (backroads priority)

Pre-registered rule in experiments/rq11_backroads.ts (fixed before any run). Baseline
finding: mean best countryScore 0.51, ZERO majority-backroad bests in 48 — connectors
ride arterials because no Valhalla class knob exists below motorway/trunk (round-7
recon) and scoring never rewarded small roads. The `country` term (length-weighted
BD-26 class factor over the traced route) closes the loop; pools re-finalized per
weight (weights touch scoring only).

## DEV sweep (10 pools)

| w_country | mean best country | med \|err\| | mean best curv | mean kept |
| --------- | ----------------- | ----------- | -------------- | --------- |
| 0         | 0.414             | 5.3%        | 1.21           | 2.3       |
| 0.1       | 0.421             | 11.9%       | 1.16           | 2.2       |
| 0.2       | 0.421             | 11.9%       | 1.16           | 2.2       |
| 0.3       | 0.421             | 11.9%       | 1.16           | 2.2       |
| 0.4       | 0.421             | 11.9%       | 1.16           | 2.2       |

Winner: **w_country = 0** (no weight cleared the guards — term stays off).

Config frozen-m4t12-v6: DEFAULT_WEIGHTS.country = 0; preset vectors receive the
same uniform term (additive — preserves the GATE-W-validated relative character).
