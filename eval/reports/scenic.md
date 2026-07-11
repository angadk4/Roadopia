# [GATE-S] Scenicness — numeric scenic signal vs labels-only (M4-T07)

Pre-registered rule (fixed before results; see experiments/gate_s.ts header): a numeric
scenic term ships iff some cumulative variant reaches Spearman ρ ≥ 0.7 against the
owner's 40-road scenic ordinal (the [GATE-C] bar for numeric terms); smallest clearing
variant ships. Default: labels/signals only (S0/S1), scenic weight stays 0 (Hard rule C).

Ground truth: 40 owner-rated roads (blanks skipped, ranges → midpoints).
Signals from grounded data only (§32): scenic_features (water 77 028 / forest 111 768 / scenic_tag 0 — ZERO scenic=yes ways exist in the region extract, so S1 is no-data),
spots viewpoints (402), residential density + road class from curvy_segments.
S5 (elevation) EXCLUDED: no DEM in the data tier; spec §32 keeps elevation a displayed
profile, and the protocol hypothesis expects no incremental ρ from it.

## Single-input diagnostics (Spearman ρ vs scenic rating)

| input    | ρ      |
| -------- | ------ |
| view     | -0.008 |
| water    | 0.300  |
| forest   | 0.234  |
| urban(−) | 0.300  |
| class    | -0.074 |

## Cumulative variants (§13.1 ladder)

| variant | inputs                     | ρ               | incremental | ≥ 0.7 |
| ------- | -------------------------- | --------------- | ----------- | ----- |
| S1      | scenic=yes tags only       | — (no variance) | —           | no    |
| S2      | S1 + viewpoint proximity   | -0.008          | —           | no    |
| S3      | S2 + water proximity       | 0.288           | +0.296      | no    |
| S4      | S3 + forest proximity      | 0.371           | +0.082      | no    |
| S6      | S4 − urban-density penalty | 0.538           | +0.167      | no    |
| S7      | S6 + road-class awareness  | 0.462           | -0.076      | no    |

## DECISION ([GATE-S], per the pre-registered rule)

**NO variant clears τ_scenic = 0.7 → numeric scenic scoring is NOT adopted.** Roadopia ships S0/S1: scenic spots/labels are SHOWN (viewpoints on the map, concrete facts in explanations — "passes 2 viewpoints, ~6 km along water") but no numeric scenic score exists anywhere and the scoring weight stays 0 (Hard rule C, spec §32). Honest negative per §24.

Binding language rules regardless of outcome (§13.3): "likely scenic", "passes N
viewpoints", "has scenic signals" are allowed; "this IS a scenic route" and any
numeric scenic score presented as truth are forbidden.
