# [GATE-W] Weight responsiveness & stability — sliders vs presets-only (M4-T10)

Pre-registered rule (fixed before results; see experiments/gate_w.ts header): ship W2
(presets + clamped sliders) iff every implemented slider is direction-correct (expected-
sign Spearman |ρ| ≥ 0.5 on ≥ half of measurable briefs), a clamp range containing the
default exists per slider, defaults are stable on every archetype brief, and every
preset moves its dominant axis correctly on ≥ half the briefs. Else W1 (presets only).
Sweeps re-finalize a FIXED pool per brief — weights touch scoring only (§15).

## Fixed (brief, origin) pairs — one per archetype (6)

- dev-003 [escarpment] target 30 min, default best 34 min / curv 1.31 / 4 kept
- dev-004 [suburban_edge] target 60 min, default best 85 min / curv 1.42 / 1 kept
- dev-008 [water_adjacent] target 180 min, default best 236 min / curv 0.47 / 2 kept
- dev-009 [sparse] target 150 min, default best 128 min / curv 0.46 / 2 kept
- dev-011 [dense_urban] target 40 min, default best 51 min / curv 1.97 / 1 kept
- dev-036 [rural_twisty_rich] target 90 min, default best 143 min / curv 0.54 / 1 kept

Archetypes without a usable brief: dev-001 (rural_twisty_rich): no feasible at defaults; dev-002 (water_adjacent): no feasible at defaults; dev-018 (rural_twisty_rich): no feasible at defaults; dev-029 (rural_twisty_rich): no feasible at defaults.

## 1–2. Slider responsiveness + clamp ranges

| slider                 | expected | per-brief ρ                             | pass share         | clamp range |
| ---------------------- | -------- | --------------------------------------- | ------------------ | ----------- |
| cur (default 0.35)     | +        | 003:— 004:— 008:— 009:— 011:— 036:—     | — (not measurable) | NONE        |
| dur (default 0.3)      | −        | 003:— 004:— 008:— 009:— 011:— 036:—     | — (not measurable) | NONE        |
| overlap (default 0.25) | −        | 003:— 004:— 008:— 009:-0.71 011:— 036:— | 100%               | NONE        |
| stop (default 0.1)     | +        | 004:— 008:— 009:— 036:—                 | — (not measurable) | NONE        |

## 3. Stability at defaults: NOT stable

## 4. Presets (dominant-axis check vs default vector)

| preset         | dominant axis | correct-direction | pass |
| -------------- | ------------- | ----------------- | ---- | ---------- | --- |
| scenic         | stops ≥       | 6/6 briefs        | YES  |
| twisty         | curviness ↑   | 6/6 briefs        | YES  |
| chill          |               | dur err           | ↓    | 6/6 briefs | YES |
| backroads      | curviness ↑   | 6/6 briefs        | YES  |
| coffee_stop    | stops ↑       | 4/4 briefs        | YES  |
| avoid_highways |               | dur err           | ↓    | 6/6 briefs | YES |

## DECISION ([GATE-W], per the pre-registered rule)

| criterion             | cleared |
| --------------------- | ------- |
| slider responsiveness | YES     |
| clamp ranges exist    | no      |
| defaults stable       | no      |
| presets in character  | YES     |

**FALL BACK TO W1 (presets only)** — a pre-registered criterion was not cleared; sliders are not shipped in the MVP.
