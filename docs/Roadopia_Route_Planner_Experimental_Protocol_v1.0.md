# Roadopia — Route-Planner Experimental Protocol

**Version:** 1.0
**Companion to:** `Roadopia_Master_Specification_v2_0.md` (product/build contract) and `Roadopia_Dependency_and_Feasibility_Verification_v1.0.md` (dependency verification)
**Scope:** the route-**generation and -refinement methodology only** — proving, selecting, calibrating, and evaluating it. This is **not** a product spec; it specifies experiments, baselines, metrics, and decision gates.
**Governing principle:** start from the *simplest* deterministic method and add complexity — most of all, any LLM call inside the loop — **only where a metric measured against a baseline justifies it.** Sophistication is a cost to be paid for, never a default.

---

## How this document is organized

The protocol is an **ablation built outward from a deterministic core.** It first defines the problem honestly (heuristic constrained search, not optimization), then a layered set of variants and baselines, exact metrics with explicit denominators, a small-but-honest human-evaluation design, calibration and reproducibility rules, and finally **selection gates** that decide — from evidence — the simplest configuration that ships. Where this document and v2 disagree, **this document's evidence-gated method wins for the planner**; v2's parameter *names* and interfaces are preserved so the spec and the experiments share one vocabulary.

Convention: **[H]** marks a stated hypothesis (the reviewer's prior, to be confirmed or falsified); **[GATE]** marks a binding selection gate (§27); tunables use the v2 names (`THETA_CURVY`, `TAU_OVERLAP`, `N_SECTORS`, `K_CLUSTERS`, `N_CANDIDATES`, `K_PRESENT`, `DURATION_TOLERANCE`, iteration cap = 3, wall-clock budget = 25 s). Cross-references like "spec §29" point to the v2 master spec; "SPK-15" points to the verification doc's spikes.

---

## Table of contents

1. Purpose
2. Research questions
3. Formal problem definition (incl. request-parsing protocol)
4. Assumptions
5. Test geography
6. Request dataset design
7. Human-authored gold-label protocol
8. Baselines
9. Candidate-generation variants
10. Loop-generation variants
11. A→B generation variants
12. Curvature experiments
13. Scenicness experiments
14. Scoring & ranking experiments
15. User-adjustable-weight experiments
16. Correction experiments
17. Conversational-refinement experiments
18. LLM ablations
19. Metric definitions
20. Human-evaluation protocol
21. Calibration procedure
22. Reproducibility protocol
23. Public-evaluation-page provenance
24. Statistical & practical interpretation
25. Experiment sequence
26. Time & cost estimate
27. Selection gates
28. Recommended minimum methodology
29. Claims the final project may make
30. Claims the final project may not make

---

## 1. Purpose

Determine, **before implementation**, the simplest route-generation methodology that reliably turns a natural-language driving brief into a **valid, connected, road-following route** that (a) satisfies the explicit hard constraints or honestly discloses relaxation, (b) responds to user preferences, (c) is good enough to demonstrate publicly, and (d) can be built and evaluated by one developer using AI coding agents within the project schedule — while supporting only claims the evidence backs.

Concretely, this protocol exists to answer one decision: **of the many algorithmic choices in v2 §27–§40, which are actually necessary?** It does that by:

1. Pinning a **deterministic baseline planner** (no LLM in the loop) as the thing every more-complex variant must beat.
2. Defining **falsifiable experiments** for each layer (candidate generation, loop construction, curvature, scenicness, ranking, correction, refinement) and each **LLM use** (parse, select, repair, merge, explain, title/summary/tags).
3. Defining **metrics with exact denominators** and a small, honest **human-evaluation** protocol.
4. Ending in **selection gates** that convert results into the shipped configuration and into the honest claims the portfolio may make.

The protocol's bias is explicit: **a smaller true result beats a larger unproven one.** If the deterministic core is "good enough to demonstrate," the LLM stays at the boundary (parse + explanation), where its value is least disputable.

---

## 2. Research questions

The protocol must answer all 27 questions below; each maps to the section(s) that resolve it.

| # | Question | Resolved in |
|---|---|---|
| 1 | How is a request parsed into structured constraints? | §3.4, §18-A |
| 2 | How are ambiguous/contradictory requests handled? | §3.5 |
| 3 | How do user weights influence scoring? | §14, §15 |
| 4 | How is the search region constructed? | §3.3, §9 |
| 5 | How are candidate roads identified? | §9, §12 |
| 6 | How are candidate POIs/spots retrieved? | §3.3, §9 |
| 7 | How are candidate waypoints selected? | §9, §10 |
| 8 | How is waypoint order determined? | §10, §11 |
| 9 | How are loop routes constructed? | §10 |
| 10 | How are A→B routes constructed? | §11 |
| 11 | How is duration controlled? | §10, §11, §21 |
| 12 | How is retracing measured & reduced? | §10, §19 (`retrace_ratio`) |
| 13 | How is candidate diversity enforced? | §9, §10, §19 (`diversity`) |
| 14 | How is twistiness calculated? | §12 |
| 15 | How is scenicness represented without overclaiming? | §13 |
| 16 | How are candidates scored? | §14 |
| 17 | How are constraints validated? | §3.6, §19 |
| 18 | What counts as a feasible route? | §3.6 |
| 19 | What happens when no feasible route exists? | §3.7 |
| 20 | Which decisions genuinely benefit from an LLM? | §18, §28 |
| 21 | Does LLM selection beat deterministic ranking? | §14, §18-B, §27 |
| 22 | Does LLM correction beat deterministic repair / more candidates? | §16, §18-C, §27 |
| 23 | How does refinement merge old & new constraints? | §17 |
| 24 | How is route comparison computed? | §17 |
| 25 | How are auto-title/summary/tags generated safely? | §18-F |
| 26 | How is subjective quality evaluated? | §20 |
| 27 | Which approach is sufficient for the MVP? | §28 |

---

## 3. Formal problem definition

Roadopia solves a **heuristic constrained-search** problem, **not** an exact optimal-routing problem. No optimizer with an optimality guarantee is implemented; therefore **no optimality claim is made** (§30). The system searches a bounded candidate space and returns the best *found* route under a time budget.

### 3.1 The four goals, kept distinct

The protocol never conflates these, and measures/claims only the first three (the third by sampling):

1. **Feasible route** — routable, connected, closes (if a loop), satisfies all inviolable constraints, and satisfies every hard-relaxable constraint **or** discloses its relaxation. *(Measured objectively; the core promise.)*
2. **High-scoring route** — among generated candidates, maximizes the deterministic objective (§14). *(Measured objectively; relative, not absolute.)*
3. **Subjectively enjoyable route** — a human finds it a good drive. *(Sampled via small human eval, §20; never asserted from metrics alone.)*
4. **Optimal route** — provably the best possible route. **Not pursued, not claimed.**

### 3.2 Inputs, outputs, decision variables

- **Inputs:** brief `b` (text, ≤ `MAX_BRIEF_CHARS`); origin `o ∈ R` (region polygon); shape `s ∈ {loop, A→B}`; optional destination `d ∈ R`; optional weight vector `w` (from a preset or advanced sliders).
- **Parsed constraints** `c = Parse(b, w)` — the structured object of §3.4.
- **Output:** a route `ρ = (geometry, distance_m, duration_s, maneuvers, flags, waypoints)`, plus `satisfied/relaxed` constraint annotations and a grounded explanation; or a **failure outcome** (§3.7).
- **Decision variables (what the search chooses):** which curvy clusters to visit; which waypoints (curvy anchors + stops) to include; their **order**; for loops, the **return corridor/sector**; which soft targets to trade off under pressure.

### 3.3 Search region, candidate roads, candidate spots

- **Search region** `Ω`: an **isochrone** from `o` for an outbound time budget `τ_out` under the routing profile. For loops, `τ_out = α · T*` with `α ≈ 0.55` (out-and-back share of the budget); for A→B, `Ω` bounds a corridor around the `o→d` reachable set. Isochrone-bounding is preferred to a guessed radius because the reachable area already scales with the requested duration (spec §29; calibrate `α` in §21).
- **Candidate roads** `C_road = { g ∈ curvy_segments : g ⊂ Ω ∧ curviness(g) ≥ THETA_CURVY }` (PostGIS, GiST-indexed).
- **Candidate spots** `C_spot = find_spots(o, Ω, requested_types)` over community + OSM spots (real spots only; the planner never invents a stop).

### 3.4 Request-parsing protocol — the structured schema

`Parse(b, w)` produces a **schema-validated** `ParsedConstraints` object. Every field is typed; unknown/missing fields take explicit nulls (not guesses). The schema:

| Field | Type | Notes |
|---|---|---|
| `origin` | point \| "current" \| place-name | resolved to coords within `R` (geocode if name) |
| `destination` | point \| place-name \| null | null ⇒ loop |
| `shape` | `loop` \| `a_to_b` | contradiction check vs destination (§3.5) |
| `duration_target_s` | int \| null | from "90-minute"; null ⇒ default by intensity/preset |
| `distance_target_m` | int \| null | if explicitly supplied; else derived/ignored |
| `stops` | list of `{type, count, importance}` | types ∈ {coffee, food, fuel, viewpoint, rest, great_road}; importance ∈ {nice_to_have, required} |
| `avoid` | `{highways, tolls, ferries, unpaved}` booleans | map to hard-relaxable constraints |
| `surface_pref` | `paved` \| `any` | |
| `character` | subset of enumerated tags | twisty, flowing, scenic, backroad… (never speed) |
| `scenic_pref` | 0–1 \| null | maps to scenic weight |
| `twistiness_pref` | 0–1 \| null | maps to curviness weight + target |
| `intensity` | chill \| moderate \| spirited \| null | *engagement*, never velocity (spec §59) |
| `preset` | enum \| null | Scenic/Twisty/Chill/Backroads/Coffee-stop/Avoid-highways |
| `weights` | vector \| null | advanced sliders; overrides preset where set |
| `location_constraints` | list (e.g., "near Hamilton", "avoid downtown") | resolved to geometry; "avoid X" → `exclude_polygons` |
| `ambiguous_terms` | list | flags for low-confidence fields |
| `missing` | list | required-but-absent fields (e.g., no origin) |
| `contradictions` | list | detected conflicts (§3.5) |
| `confidence` | 0–1 per parsed field + overall | drives clarify-vs-best-effort (§3.5) |
| `clarification_needed` | bool + question | true only under §3.5 rule |
| `unsafe_flag` | bool | speed/racing/illegal intent |
| `out_of_region_flag` | bool | origin/destination outside `R` |
| `prompt_injection_flag` | bool | instruction-like content in the brief |

Parsing is the **first** LLM-candidate use (§18-A); the deterministic baseline is a rules+grammar parser (units, keyword maps, a small gazetteer). The schema is identical regardless of which parser wins, so the rest of the pipeline is parser-agnostic.

### 3.5 Ambiguity & contradiction handling — the clarify-vs-best-effort rule

**Default: produce a best-effort route with an honest note; ask a clarification question only when the search is otherwise ill-defined.** This protects the anonymous hero-flow user from being interrogated and leans on the constraint hierarchy to resolve most tension.

Decision rule (evaluated after parsing):

1. **Unsafe intent** (`unsafe_flag`) → **refuse the unsafe framing**, offer a safe reframing ("I can plan an engaging drive, not a timed/▒speed run"). Never a clarification, never compliance.
2. **Prompt injection** (`prompt_injection_flag`) → **ignore the injected instruction**, treat surrounding text as a normal brief, proceed. (Tool results are data, not instructions — spec §37.)
3. **Out of region** (`out_of_region_flag`) → **friendly redirect** ("Roadopia currently covers the Western Golden Horseshoe / Niagara region; pick a start inside it"). Not a clarification.
4. **Hard ambiguity that makes the search ill-defined** → **one** clarification question. Only two cases qualify: (a) **no resolvable origin** (no coords, no usable place-name, no current location); (b) a **shape contradiction** that changes the search fundamentally and cannot be auto-resolved (e.g., "a loop **ending in another city**" — loop vs A→B is undecidable from intent).
5. **Everything else (soft contradictions)** → **best-effort + disclose**, resolved by the hierarchy:
   - *"No highways but get me there quickly"* → honor **no-highways** (hard-relaxable), optimize duration as a soft target, disclose any trade-off.
   - *"30-minute route with three distant stops"* → satisfy as many stops as fit the budget by importance; report which were dropped and why (budget) — no clarification.
   - *"Twisty but relaxing"* → both are soft; set a moderate curviness target (lower than "spirited"); the scoring blend handles it.
   - *Impossible combination* (e.g., a long all-backroad loop where none exists) → relax per hierarchy (§3.7), disclose.

**Why this rule is correct for Roadopia:** clarification questions add a turn, hurt the no-login demo, and are usually unnecessary because the hierarchy + honest disclosure already encode the right behaviour. Reserving questions for *ill-defined* searches (no origin / shape undecidable) keeps the system responsive and honest. *(This rule is itself tested — §18-A measures how often the LLM parser over-asks vs the deterministic one; [GATE] penalizes spurious clarifications.)*

### 3.6 Constraints, objective, feasibility

- **Inviolable (Tier 1):** routable + connected; loop closes (endpoint within `ε` of `o`); legal public roads (**biased**, not guaranteed — verification §11/§18).
- **Hard-relaxable (Tier 2):** `avoid` set (no highways/tolls/ferries/unpaved). Enforced via Valhalla hard exclusion (`allow_hard_exclusions`); if no route exists, **fall back to soft penalty + disclose** (`status = relaxed`). Requested **required** stop included **or its absence reported**.
- **Soft (Tier 3):** duration (±`DURATION_TOLERANCE`), curviness target, stop count, scenic signal.
- **Objective (deterministic scalar, spec §30):**
  `score(ρ) = w_dur·dur_fit + w_cur·curv_fit + w_stop·stop_cover + w_scenic·scenic_signal − w_overlap·self_overlap − w_uturn·uturn_penalty`.
- **Feasible route (definition):** satisfies all Tier-1 **and** every Tier-2 constraint is either satisfied or explicitly disclosed-relaxed. Feasibility is **binary**; score ranks among feasible candidates.
- **Limits:** `N_CANDIDATES` generated/iteration; `K_PRESENT` distinct presented after dedup; tool-call budget per generation; **wall-clock budget = 25 s**; **iteration cap = 3**.
- **Stopping condition:** return the highest-scoring feasible candidate once at least one feasible candidate exists and either (a) soft targets are within tolerance, or (b) the iteration cap / wall-clock budget is hit → return **best-so-far** with honest annotation.

### 3.7 Relaxation hierarchy & failure

Applied in order until a feasible candidate exists:
1. **Widen** the isochrone budget (increase `τ_out`).
2. **Lower** `THETA_CURVY` (admit gentler roads).
3. **Relax soft targets** (duration band, curviness target, stop count) — disclose.
4. **Relax a Tier-2 hard constraint** to soft penalty — disclose prominently (`status=relaxed`).
5. **Friendly redirect** (no feasible route from this origin/brief within budget).

**Failure (definition):** no routable, connected route after the hierarchy within the wall-clock budget, **or** an unsafe/out-of-region/un-parseable request. Failure is a **first-class, honest outcome** (best-effort note → redirect → "temporarily unavailable"), never a fabricated or broken route.

### 3.8 Reproducibility requirement (problem-level)

Every generation is a function of (brief, origin, shape, weights, **prompt version, model id+params, routing-data/OSM-extract version, region id, scoring config, seed**). All are logged (§22) so any result — benchmark, demo, or production — is attributable and replayable. Because the LLM is nondeterministic, "reproducible" means *same inputs + same versions → same distribution of outcomes*, with seeds fixed where the SDK allows and N-run averaging where it does not (§24).

---

## 4. Assumptions

1. **Verified foundations hold** (verification doc, 18 Jun 2026): Valhalla provides `/route`, `/isochrone`, `/trace_route`, `/optimized_route` (TSP, ≥4 pts), elevation, costing, and hard exclusions behind `allow_hard_exclusions` (warn-and-ignore if disabled; can return no-route if enabled). Anthropic Haiku 4.5 / Sonnet 4.6 exist at the stated prices with caching + batch. These are inputs to the experiments, not under test here.
2. **Valhalla provides no native scenic/twisty/loop primitive** — Roadopia's heuristics own that. This is the central thing the experiments must prove "good enough."
3. **Only curviness is genuinely computable**; scenicness is a labeled heuristic signal (tested for *correlation*, never asserted as truth).
4. **Region is fixed for experiments** to the seeded corridor (§5); results are claimed only for that region.
5. **One developer + AI agents + a few enthusiast friends** is the entire research team; experiments must be cheap, mostly offline (eval harness), and runnable in days, with human eval deliberately small (§20, §26).
6. **The eval harness and fixtures exist as repo artifacts** (spec §39); experiments are runs of that harness over versioned datasets.
7. **Latency/cost targets** (p50 < 15 s, p90 < 25 s, ~1–3¢/gen p50) are the operating envelope (verification §12/§16); any method that cannot meet them is out, regardless of quality.
8. **Honesty constraint is binding:** no claim may exceed what a stated metric on a stated dataset supports (§29–§30).

---

## 5. Test geography

All experiments run on the **seeded Western Golden Horseshoe / Niagara corridor** (London/Kitchener → Caledon/Orangeville → Burlington/Hamilton → Niagara), defined by the production `.poly` (spec §46). This is deliberate: results are claimed **only** for the region the planner is tuned and demoed on; generalization is explicitly **not** claimed (§30).

To exercise the variants across the conditions that actually stress the algorithms, fix a set of **origin archetypes** within the corridor and reuse them across experiments (so candidate-generation and loop variants are compared on the same starts):

| Archetype | Example locale | Why it stresses the method |
|---|---|---|
| **Dense urban** | downtown Hamilton / Kitchener core | urban-grid curvature false positives; few twisty roads in reach |
| **Suburban edge** | Burlington / Waterloo fringe | mix of grid + emerging rural; isochrone spans both |
| **Rural twisty-rich** | Niagara Escarpment / Forks of the Credit area | the "good" case; tests diversity + retracing, not feasibility |
| **Sparse** | farmland between towns | few curvy roads / few spots → relaxation + redirect behaviour |
| **Water-adjacent** | Lake Ontario / Niagara River shoreline | scenic-signal (water proximity) test bed |
| **Escarpment/elevation** | Niagara Escarpment climbs | elevation-variation signal; not used as scenic driver |

Each experiment that depends on geography reports results **broken down by archetype**, because aggregate numbers hide the failure cases (a method can ace rural-twisty and fail sparse/urban). At least **6 fixed origins** (one per archetype) are pinned and versioned with the dataset (§6). The same corridor `.poly` + OSM extract date is recorded for every run (§22).

---

## 6. Request dataset design

The dataset is the experimental substrate. It is **versioned, leakage-controlled, human-gold-labeled**, and grows from production failures.

### 6.1 Taxonomy (every request is tagged with these dimensions)

- **Shape:** loop · A→B.
- **Duration:** short (≤45 min) · medium (45–120) · long (>120).
- **Origin archetype:** the six in §5.
- **Constraints present:** no-highway · stop(s) {coffee/food/fuel/viewpoint/rest} · twistiness · scenic · intensity {chill/moderate/spirited} · surface · location ("near X" / "avoid X").
- **Preferences:** preset-driven · advanced-weights-driven · none.
- **Composition:** single-constraint · combined-constraints.
- **Tractability:** clearly-feasible · borderline · impossible.
- **Special:** conversational-refinement · contradictory · unsupported-region · unsafe · prompt-injection.

### 6.2 Splits, sizes, and purpose

Sizes are scaled to a one-developer budget (gold-labeling is the bottleneck) while giving each cell enough examples to see a signal. **Totals are modest by design; §24 forbids over-reading small samples.**

| Split | Size | Purpose | Tuning allowed? |
|---|---|---|---|
| **Development (DEV)** | 40–50 | iterate algorithms + tune all parameters (§21) | Yes — all tuning here |
| **Validation (VAL)** | 20–25 | check generalization while iterating; pick between finalists | Read often, don't tune on it |
| **Held-out test (TEST)** | 25–30 | **final reporting only**; touched once per major config | **No** — locked until final |
| **Adversarial (ADV)** | 15–20 | unsafe / injection / impossible / out-of-region / contradictory | regression guard |
| **Conversational-refinement (REF)** | 15–20 multi-turn | merge semantics + comparison (§17) | DEV-like for refinement work |
| **Production-failure regression (PFR)** | grows | every real failure becomes a fixed case | append-only |

Total initial human-labeled load ≈ **115–145 single-turn + ~15–20 multi-turn** — large enough to compare variants per dimension, small enough for one person to label and maintain.

### 6.3 Geographic distribution & difficulty

Within each split, **stratify by origin archetype and duration** so no method is flattered by an easy-origin-heavy sample; tag each example **easy/medium/hard** by expected tractability (sparse + long + many-constraints = hard). Report metrics **stratified**, not just pooled (§24).

### 6.4 Leakage controls

- DEV/VAL/TEST use **disjoint origins where possible** and disjoint brief phrasings; the same (origin, brief) never appears in two splits.
- **TEST is locked**: it is not inspected during development and is run only to produce final numbers for a frozen config; re-running TEST after any change to chase a number invalidates it (note the violation if it happens).
- Parameters are tuned **only** on DEV (§21); VAL gates finalist selection; TEST reports.

### 6.5 Growth & versioning

- The dataset has a **semantic version** (e.g., `reqset-v3`) recorded with every experiment (§22).
- **Production/demo failures** (a bad route, a wrong parse, a timeout, an injection that slipped) are triaged, gold-labeled, and appended to **PFR** (and ADV if adversarial); they become permanent regression cases — the dataset only grows, and a fixed bug cannot silently regress.
- New cells are added when a real gap appears (e.g., a new stop type); additions bump the version and are noted in a changelog.

---

## 7. Human-authored gold-label protocol

Gold labels make the headline metrics **non-circular**: parse accuracy and constraint satisfaction are measured against **human** labels, never against the model's own parse (spec §39, fixing v2's earlier circular metric).

### 7.1 What gets labeled

For each request, a human (the developer, plus a second labeler on a subset for agreement, §7.3) authors a **gold constraints object** in the §3.4 schema, capturing what a reasonable enthusiast would understand the brief to require:

- The **hard set** (shape, avoid-flags, required stops) — unambiguous.
- The **soft targets** (duration target + a *reasonable tolerance band*, curviness level, stop counts, scenic preference) — recorded as ranges where natural.
- The **expected disposition**: should this request be answered best-effort, redirected (out-of-region), refused (unsafe), or asked-to-clarify (ill-defined)? — this is the gold for the §3.5 rule.
- For **impossible** requests: which relaxation is acceptable (e.g., "ok to use minimal highway and disclose").
- For **contradictory** requests: the intended resolution.

### 7.2 Labeling rules

- Labels encode **intent**, not a specific route (there is no single correct route; §3.1). A duration label is a band, not a point.
- Ambiguity is recorded as **ambiguous** with the labeler's best reading, not forced to false precision.
- Labels are authored **before** seeing any model output for that example (no post-hoc rationalization).
- Each label carries a one-line **rationale** for auditability.

### 7.3 Inter-rater agreement

- A **second labeler** (an enthusiast friend) independently labels a **random ~20%** of DEV+VAL.
- Report agreement: **exact agreement** on hard fields (shape, avoid-flags, required stops) and **Cohen's κ** (or percentage agreement with CI) on categorical soft fields; for duration bands, report overlap rate.
- **Disagreements are adjudicated** and the adjudication rule recorded; if hard-field agreement is low, the brief is ambiguous and is re-tagged as such (and may move to the clarification-gold set).
- Agreement numbers are published as a **limitation** on the eval page (small labeler pool).

### 7.4 Gold for parsing vs gold for outcomes

Two distinct gold uses, kept separate:
- **Parse gold** (the schema fields) → scores `parse_accuracy` and `clarification_appropriateness`.
- **Outcome gold** (hard set + acceptable relaxations + expected disposition) → scores `gold_constraint_satisfaction`, `hard_relaxable_disclosure`, and disposition correctness.

---

## 8. Baselines

**No claim that the LLM or any added complexity improves routes may be made without beating a baseline (§30).** Baselines are cheap to build (mostly Valhalla calls + simple heuristics) and are run through the **same harness and metrics** as the full planner.

| ID | Baseline | Construction | What it isolates |
|---|---|---|---|
| **B0** | **Fastest route** | Valhalla `auto`, default costing, `o→d` (or nearest loop hack) | the "do nothing clever" floor; a scenic planner must beat it on character, not speed |
| **B1** | **Avoid-highways route** | Valhalla `auto` + highway penalty / exclusion | tests whether avoidance alone yields acceptable drives |
| **B2** | **Random feasible** | random bearings + random reachable waypoints → route → keep if feasible | the "any feasible route" floor for diversity/quality |
| **B3** | **Deterministic POI route** | route through the nearest requested-type spot(s), ordered by `optimized_route` | stop-coverage floor without curvature logic |
| **B4** | **Deterministic high-curvature route** | greedily route through top-curvature segments in `Ω` (no sectors/dedup) | curvature-only; exposes out-and-back/retracing problems |
| **B5** | **Router-native round trip** | Valhalla round-trip/loop if usable, else N/A | tests whether the engine alone makes loops (it largely doesn't — confirm) |
| **B6** | **Roadopia deterministic core (no LLM)** | full §9/§10/§14 deterministic pipeline: isochrone + sectors + curvy-waypoint + dedup + weighted scoring; **deterministic top-1**; **rules parser**; **deterministic repair** | **the primary baseline** — the simplest Roadopia that could ship |
| **B7** | **B6 + LLM parse only** | B6 with LLM parser, deterministic everything else | isolates parsing value |
| **B8** | **B6 + LLM selection** | B6 with LLM choosing among `K_PRESENT` | isolates selection value (RQ 21) |
| **B9** | **B6 + LLM correction** | B6 with LLM-chosen repair action | isolates correction value (RQ 22) |
| **B10** | **B6, weights disabled** (fixed defaults) | no preset/sliders | isolates user-weight value |
| **B11** | **B6, weights enabled** | presets + sliders active | the weight-responsive variant |

**B6 is the spine of the whole protocol.** Every LLM-in-the-loop and every fancier-generation variant must beat B6 by a pre-registered margin on a pre-registered metric to be adopted (§27). If B6 is "good enough to demonstrate" (it plausibly is — [H]), the shipped planner is B6 plus only the LLM uses that clear their gates (realistically: parse + explanation + title/summary/tags, i.e., the boundary uses).

---

## 9. Candidate-generation variants

**Question:** what is the simplest generator that yields **diverse, feasible, brief-satisfying** candidates within the latency budget? All variants feed the *same* routing + scoring + validation, so differences are attributable to generation alone. All run on the §5 origins; report by archetype.

| ID | Variant | One-line construction | Hypothesis |
|---|---|---|---|
| G1 | **Random bearings** | pick random compass bearings, place reachable waypoints | weak diversity control, many out-and-back; the floor (≈B2) |
| G2 | **Sector-based** | partition compass into `N_SECTORS`; one candidate per sector | cheap diversity; [H] big gain over G1 |
| G3 | **Highest-curvature segments** | route through top-`k` curvy segments in `Ω` | high curviness, poor diversity + retracing (≈B4) |
| G4 | **Curvature clusters** | spatially cluster curvy segments (`K_CLUSTERS`); one candidate per cluster | diversity + curviness; [H] strong |
| G5 | **POI-anchored** | anchor waypoints on requested spots, route through | needed when stops are required; weak on curviness alone |
| G6 | **Isochrone-bounded retrieval** | restrict all of the above to the isochrone `Ω` (vs a guessed radius) | [H] improves duration fit + reduces wasted candidates |
| G7 | **Directional-sector circuits** (v2 default) | for loops, outbound sector ≠ return sector around a cluster | [H] best out-and-back avoidance |
| G8 | **Hybrid (curvature cluster + POI + scenic signal)** | G4 ∪ G5 with scenic-weighted cluster choice, isochrone-bounded, sector-spread | the v2 §29 method; richest, most code |

**Procedure.** For each variant, generate up to `N_CANDIDATES`, route them (parallel), score, validate, and **diversify** (overlap dedup, §below) to `K_PRESENT`. Hold routing/scoring fixed.
**Metrics (per §19):** `first_pass_feasibility`, `diversity` (pairwise `edge_overlap`), `retrace_ratio` (`self_overlap`), `curvature_score`, `duration_pct_error`, `stop_coverage`, candidate-`route_engine_calls`, generation time. Plus a small **human blind-preference** (§20) on the top candidate for the finalists only.
**Diversity enforcement (shared):** sort routed candidates by score; greedily keep a candidate only if its `edge_overlap` with every kept candidate ≤ `TAU_OVERLAP`; stop at `K_PRESENT`. This guarantees presented candidates are genuinely different (spec §29).

**[GATE-G]** Adopt the **simplest generator** whose feasibility, diversity, and retracing clear the §27 thresholds on VAL. Predicted winner: **G7 for loops / G6+G5 for A→B**, i.e., a sector-bounded curvy+POI generator — *not necessarily the full G8 hybrid*. Add scenic-weighted cluster choice (the extra bit in G8) only if §13 shows the scenic signal is worth it **[GATE-S]**. Adopt `optimized_route` (TSP) for ordering only where it beats angular ordering (§10).

## 10. Loop-generation variants

Loops are the hard case (Valhalla has no native loop; verification §11) and the headline demo. **Question:** simplest construction that closes, avoids retracing, hits duration, and looks like a real drive.

| ID | Variant | Construction | Hypothesis |
|---|---|---|---|
| L1 | **2-waypoint triangle** | `o` → W1 → W2 → `o`, W1/W2 from a cluster | minimal; risk of thin triangles |
| L2 | **3-waypoint polygon** | `o` + 3 waypoints, angularly spread | [H] good shape with low complexity |
| L3 | **Radial-sector loop** | outbound in sector S, return in sector S′ (S′≠S) | core anti-retrace device (part of G7) |
| L4 | **Angular ordering** | order waypoints by bearing around `o` | cheap ordering; [H] competitive with TSP for loops |
| L5 | **Greedy ordered** | nearest-unvisited insertion | simple, can zig-zag |
| L6 | **Nearest-neighbour** | NN tour of waypoints | simple baseline |
| L7 | **Limited beam search** | keep top-`b` partial loops by partial score | more compute; [H] marginal over L3+L4 |
| L8 | **Generate-many-then-rank** | over-generate, score, dedup, take best `K_PRESENT` | the workhorse; pairs with any of the above |
| L9 | **Iterative repair** | start feasible, apply repair moves to improve | tested in §16 |
| L10 | **Directional-sector circuit + overlap dedup** (v2) | L3 + angular order + dedup | the v2 method |

**Procedure & metrics:** as §9, with emphasis on `loop_closure_distance` (≤ `ε`), `retrace_ratio`, `duration_pct_error`, `diversity`, and human "route coherence / excessive retracing" (§20).
**[GATE-L]** Ship the **simplest loop builder** that closes reliably and keeps `retrace_ratio` below the §27 threshold while meeting duration on DEV/VAL. Predicted winner: **L3 + L2/L4 + L8 dedup** (radial-sector, angular order, over-generate-then-dedup). **Beam search (L7) is adopted only if it beats that by the §27 margin** — [H] it will not justify its latency.

## 11. A→B generation variants

A→B is easier (the destination anchors the search) but must still inject character and stops without absurd detours.

| ID | Variant | Construction |
|---|---|---|
| A1 | **Direct avoid-highway** | Valhalla `o→d` with highway penalty (≈B1) |
| A2 | **Curvy-corridor** | bias waypoints onto curvy segments within the `o→d` corridor isochrone |
| A3 | **POI-on-the-way** | insert requested stops; order via `optimized_route` (TSP, ≥4 pts) else manual |
| A4 | **Hybrid corridor (curvy + POI + scenic), detour-capped** | A2 ∪ A3 with a **detour cap** vs the direct route |

**Key control — detour cap:** candidate rejected if `distance/direct_distance > detour_max` (a tunable, §21), preventing scenic-but-ridiculous routes. **Order:** use `optimize_waypoint_order` only with ≥4 locations (verification §11), else order by progress along `o→d`.
**Metrics:** `duration_pct_error`, `stop_coverage`, `curvature_score`, `detour_ratio`, `diversity`.
**[GATE-A]** Ship **A4 with a calibrated detour cap**; drop scenic weighting if §13 fails.

## 12. Curvature experiments

Curvature is the **one signal Roadopia can compute honestly**, so it must be right. **Question:** simplest formulation that ranks known twisty roads above urban grids and is robust to OSM geometry noise. (Pairs with SPK-10.)

### 12.1 Preprocessing (fixed across formula variants, then ablated)
Resample geometry to fixed spacing (tunable); drop degenerate point-triples (near-collinear/coincident); set a **minimum segment length**; **exclude roundabout/intersection/ramp geometry** (OSM tags) so junction wiggle isn't read as "twisty"; split long numbered highways into sections; record road class. **Ablation:** with vs without each preprocessing step, measured on the urban-grid false-positive rate.

### 12.2 Formula variants (compared on a hand-labeled known-roads set)

| ID | Metric | Definition (per segment, length-weighted to route) |
|---|---|---|
| C1 | **Total absolute heading change** | Σ|Δheading| over the polyline |
| C2 | **Heading change per km** | C1 / length_km (normalizes for length) |
| C3 | **Sinuosity** | path length / straight-line distance |
| C4 | **Curve density** | count of significant turns (> `turn_threshold`) per km |
| C5 | **Mean significant-turn angle** | mean of turn angles above threshold |
| C6 | **Max significant-turn angle** | max turn angle (hairpin detector) |
| C7 | **Circumcircle-radius method** (v2) | per point-triple corner radius → small radius = high curvature, length-weighted |
| C8 | **Composite normalized** | normalized blend of {C2, C4, C7} clipped to [0,1] |

**Evaluation.** Build a **hand-labeled curvature set**: ~30–40 local road segments the developer *knows* (clearly twisty escarpment roads, clearly straight rural concessions, urban grids, a hairpin or two), each rated on a simple ordinal scale. Score each formula by **rank correlation (Spearman ρ)** with the human ordinal and by **urban-grid false-positive rate** (fraction of grid segments scored above `THETA_CURVY`).
**Metrics:** Spearman ρ vs human; grid FP rate; sinuosity-vs-heading disagreement on hairpins (C3 underrates hairpins — expose this); `find_curvy_roads` latency; `curvy_segments` table size (SPK-10).
**[GATE-C]** Use the **simplest formula** with ρ above the §27 threshold and grid FP below it. Predicted: **C2 or C7**; **C8 composite only if a single formula cannot clear both** thresholds. (Sinuosity C3 alone is likely insufficient — it misses hairpins; document this as a finding.) Set `THETA_CURVY`, `turn_threshold`, and resample spacing here (§21).

## 13. Scenicness experiments

**Question:** should the MVP carry a numeric scenic score at all — and if so, the smallest set of grounded inputs that *correlates* with human "looks scenic," **without claiming objective beauty**. (Pairs with SPK-11.)

### 13.1 Variants (escalating; stop at the first that earns its place)

| ID | Variant |
|---|---|
| S0 | **No numeric scenic score** (curviness + stops only; scenic spots shown but unweighted) |
| S1 | **Community/OSM tags only** (route passes `tourism=viewpoint`, scenic-tagged ways) |
| S2 | **+ Viewpoint-spot proximity** (count viewpoint spots within buffer) |
| S3 | **+ Water proximity** (distance to `natural=water`/coastline) |
| S4 | **+ Forest/green proximity** (`landuse=forest`/`natural=wood`) |
| S5 | **+ Elevation variation** (climb/relief along route) |
| S6 | **+ Urban-density penalty** (down-weight dense built-up segments) |
| S7 | **Composite heuristic** (normalized blend of S1–S6, road-class-aware) |

### 13.2 Evaluation
Hand-label a **scenic set** (~20–30 routes/segments the developer knows as scenic vs dull, water-adjacent vs inland, escarpment vs flat). Score each variant by **Spearman ρ** with the human ordinal and by **incremental ρ** (does adding water/forest/elevation actually move the correlation?).
**[GATE-S]** **Drop numeric scenic scoring entirely (ship S0/S1) if no variant clears the §27 correlation threshold.** If a variant clears it, ship the **smallest** one that does (likely S1+S2, possibly +S3). Elevation (S5) is included **only** if it adds incremental ρ — [H] it will not, and elevation stays a *displayed* profile, not a scenic driver (spec §32).

### 13.3 Language (binding, regardless of which variant ships)
**Allowed:** "likely scenic," "matches your scenic preference," "passes N scenic community spots," "has scenic signals (water/viewpoints along the route)." **Forbidden:** "this is a scenic route" / any unqualified objective-beauty claim, and any numeric "scenic score X/10" presented as truth. The explanation cites **concrete grounded facts** ("~6 km along the lake, passes 2 viewpoints"), never a verdict.

---

## 14. Scoring & ranking experiments

**Question:** does anything beat **deterministic weighted scoring** for choosing the route to present? This is the pivotal cost/complexity question (RQ 16, 21).

| ID | Variant | Description |
|---|---|---|
| R1 | **Deterministic weighted sum** (v2 §30) | scalar `score(ρ)`; present top-1, others as alternates |
| R2 | **Rule-based lexicographic** | sort by hard satisfaction, then duration fit, then curviness, then retracing (no weights) |
| R3 | **Pareto filtering** | keep the non-dominated set over {duration fit, curviness, scenic, low-retrace}; present the knee |
| R4 | **Deterministic shortlist → LLM selection** | R1 to `K_PRESENT`, LLM picks the "best fit to the brief" + reason |
| R5 | **LLM selection over raw candidates** | LLM ranks candidates directly (no deterministic shortlist) — *expected weak + costly* |
| R6 | **LLM explanation only** | R1 chooses; LLM only writes the "why" |

**Procedure.** Same candidate pool for all; vary only selection. Compare R1's top-1 against R4's pick via **blind human pairwise preference** (§20) and against gold via `gold_constraint_satisfaction`. R5 is included to demonstrate (likely) that letting the LLM rank raw candidates is worse and dearer than scoring + shortlist.
**Metrics:** blind preference rate (R4/R5 vs R1), `gold_constraint_satisfaction`, latency, cost/attempt, `invalid_model_output_rate` (R4/R5).
**[GATE-R] (RQ 21):** **Default to R1 (deterministic) + R6 (LLM explanation only).** Adopt **R4 (LLM selection)** *only if* it beats R1's top-1 by **≥ a pre-registered blind-preference margin** (§27) at the agreed CI, after accounting for its added latency/cost. [H] R1 ties or wins once the scoring weights are calibrated (§15, §21); the LLM's value is in **parsing and explaining**, not ranking pre-scored, validated candidates.

## 15. User-adjustable-weight experiments

**Question:** do presets + sliders produce **stable, responsive** routes, and do defaults work with zero tuning? (RQ 3.) **No learning is tested or claimed** (spec §35).

| ID | Variant | Description |
|---|---|---|
| W0 | **Fixed defaults** (B10) | one default weight vector |
| W1 | **Presets** | Scenic/Twisty/Chill/Backroads/Coffee-stop/Avoid-highways → fixed weight vectors |
| W2 | **Presets + advanced sliders** (B11) | sliders for curviness, scenic, road-class, elevation, stop importance, duration strictness, overlap |

**Two properties to establish:**
1. **Responsiveness** — moving a slider must *measurably* change the presented route in the expected direction. Metric: `user_weight_responsiveness` (§19) — e.g., raising the curviness weight increases the chosen route's `curvature_score` monotonically across a sweep, on a fixed brief/origin.
2. **Stability** — defaults (W0/preset) must produce feasible, sensible routes with **no tuning** across all archetypes (no degenerate routes at default settings). Metric: feasibility + human "coherence" at defaults.

**Procedure.** Weight **sweeps** on fixed (brief, origin) pairs across archetypes; verify monotonic, non-degenerate response; verify presets map to sensible weight vectors (calibrated in §21).
**[GATE-W]:** Ship **W2 (presets + sliders)** only if (a) defaults/presets are stable everywhere and (b) sliders are demonstrably responsive **without** producing degenerate routes at slider extremes. If extremes break routes, **clamp slider ranges** (§21) or fall back to **W1 (presets only)**. [H] presets + clamped sliders pass.

## 16. Correction experiments

**Question:** when the first route misses, what is the simplest fix — and does an LLM-chosen repair beat deterministic repair or simply generating more candidates? (RQ 22.)

| ID | Variant | Description |
|---|---|---|
| F0 | **No correction** | take best first-pass feasible; else fail |
| F1 | **Deterministic repair rules** | fixed moves: drop worst waypoint, relocate to nearer curvy cluster, swap return sector, relax a soft target (disclose) |
| F2 | **Generate-more** | on miss, generate a fresh candidate batch (more `N_CANDIDATES`), re-dedup, re-rank |
| F3 | **LLM-selected repair action** | LLM picks among the F1 move set (bounded, schema-validated) |
| F4 | **Hybrid: deterministic repair + LLM interpretation** | LLM maps the *failure reason* to a move; deterministic executes |
| F5 | **Relaxation hierarchy + best-so-far** (§3.7) | the disclosure-driven fallback, with or without F1/F2 |

**Procedure.** Seed first-pass **failures** (borderline/impossible cases from DEV) and measure each strategy's recovery. The **iteration cap = 3** and **wall-clock budget = 25 s** bound all variants.
**Metrics:** `repair_success`, `self_correction_efficacy`, `new_violation_rate_after_correction` (did the fix break something else?), added latency, added cost, added `route_engine_calls`.
**[GATE-F] (RQ 22):** **Default to F2 (generate-more) + F1 (deterministic repair) + F5 (relaxation/best-so-far).** Adopt **F3/F4 (LLM repair)** *only if* it beats F1∪F2 on `self_correction_efficacy` by the §27 margin **without** raising `new_violation_rate` or breaking the latency budget. [H] **generating more candidates is competitive with LLM-chosen repair and far simpler/cheaper** — often the cheapest correction is more diversity, not cleverer repair.

## 17. Conversational-refinement experiments

**Question:** the simplest, *consistent* way to merge a follow-up ("make it longer," "add a viewpoint," "avoid that town," "less highway") with the original brief, keeping hard constraints. (RQ 23–24.) Tested on the **REF** split.

### 17.1 Constraint-merging semantics (precise)
A refinement turn produces a **constraint delta** `Δc`; the new constraints are `c' = merge(c, Δc)` under fixed rules:
- **Hard constraints persist** unless the user explicitly removes one ("actually highways are fine" → clear `avoid.highways`).
- **"Make longer/shorter"** → adjust `duration_target_s` by a step (or to a stated value); tolerance unchanged.
- **"Add a stop"** → append a stop as **hard-relaxable** (include or report absence).
- **"Avoid that town/road"** → add to `location_constraints` as an `exclude_polygons`/`exclude_locations` geometry penalty (verification §11 confirms Valhalla support).
- **"More/less twisty/scenic"** → adjust the corresponding weight + soft target.
- **Conflicts** in `Δc` vs `c` resolve by **the new turn winning for the changed field**, the hierarchy governing the rest, with disclosure.
- Memory is **session-scoped** (the running `c` + prior turns), not long-term (spec §34).

### 17.2 Variants

| ID | Variant | Description |
|---|---|---|
| RF1 | **Re-run from scratch with merged `c'`** | recompute `Ω`, candidates, etc. from `c'` |
| RF2 | **Reuse previous candidate pool** | re-score/filter the existing pool under `c'` (cheaper, may be stale) |
| RF3 | **Penalize overlap with the rejected route** | add a penalty against the prior presented route's geometry (encourage a visibly different result) |
| RF4 | **"Avoid this road" as geometry penalty** | `exclude_polygons`/`exclude_locations` |
| RF5 | **Merge via LLM** | LLM produces `Δc` from the follow-up text |
| RF6 | **Merge via deterministic rules** | keyword/grammar maps the follow-up to `Δc` |

### 17.3 Route comparison (RQ 24)
Compute a **deterministic diff** between original `ρ` and refined `ρ'`: Δduration, Δdistance, Δcurvature_score, Δscenic_signal, set-difference of stops, and **geometry overlap** (`edge_overlap(ρ, ρ')`) to show "how much changed." Present as a compact factual comparison; the LLM may *phrase* it (grounded), but the **numbers are computed** (§18-E uses the same boundary as §14-R6).
**Metrics:** `conversational_refinement_success` (does `ρ'` satisfy both the original hard set and `Δc`?), consistency (hard constraints retained), `edge_overlap(ρ,ρ')` (did it actually change?), human "preference vs original after refinement" (§20).
**[GATE-RF]:** Ship **RF1 (re-run merged) + RF4 (avoid-as-penalty)**; merge via **RF6 (deterministic)** unless §18-D shows the LLM merger is needed for messy phrasing. **Keep conversational refinement only if one-shot generation is stable first** (§27 ordering): refinement is built on top of a working B6.

## 18. LLM ablations

The **spine** of the protocol. For each candidate LLM use, the deterministic baseline is the default and the LLM must **earn its place** on evidence. Each ablation reports: deterministic baseline, LLM variant, the deciding metric, expected value [H], cost, latency, failure modes, and the **selection rule** (formalized in §27).

| Use | Deterministic baseline | LLM variant | Deciding metric | Expected [H] | Cost/latency | Key failure mode | Selection rule (→§27) |
|---|---|---|---|---|---|---|---|
| **A. Parsing** | rules + units + keyword maps + gazetteer | Haiku structured-output parse | `parse_accuracy` vs gold; `clarification_appropriateness` | **LLM wins** on messy/natural briefs; rules competitive on templated | low / ~1 s | LLM over-asks or hallucinates a field; rules miss paraphrases | Adopt LLM if `parse_accuracy` ≥ rules **and** it doesn't over-ask beyond gold by margin |
| **B. Selection** | weighted-score top-1 (R1) | LLM picks from shortlist (R4) | blind preference vs R1; `gold_constraint_satisfaction` | **Deterministic ties/wins** | adds Sonnet turn / latency | LLM picks a worse-scoring route; nondeterministic flip-flops | Adopt LLM **only** if blind-pref margin ≥ threshold at CI |
| **C. Correction** | F1 repair + F2 generate-more | LLM repair action (F3/F4) | `self_correction_efficacy`; `new_violation_rate` | **Deterministic/generate-more competitive** | adds turn(s) | LLM repair introduces a new violation | Adopt LLM only if efficacy margin ≥ threshold **and** no new-violation increase |
| **D. Refinement merge** | RF6 rules | RF5 LLM `Δc` | `conversational_refinement_success` | **LLM modestly helps** on free-form phrasing | low / ~1 s | LLM drops a persisted hard constraint | Adopt LLM if success ≥ rules **and** hard-constraint retention = 100% |
| **E. Explanation** | template from computed facts | Sonnet prose from tool facts | factuality (no invented facts); human readability | **LLM wins on readability**, template wins on guaranteed factuality | adds ~1 Sonnet call | LLM invents a place/road | Adopt LLM **with strict grounding**: facts come from tool results; validate no novel entities; else template |
| **F. Title/summary/tags** | template + tag rules | Haiku structured output | `auto_title_factuality`, `auto_summary_factuality`, `suggested_tag_precision` | **LLM wins on phrasing**, gated on factuality | low / ~1 s; can be async | LLM invents a place in the title | Adopt LLM if factuality ≥ threshold (≈1.0 for "no invented place") **and** user edits before save |

**Two cross-cutting rules for every LLM use:**
- **Grounding/validation:** every LLM output is schema-validated and **fact-checked against tool results** before use; outputs that introduce a road/place/number not in the grounded data are rejected (regenerate once, then fall back to deterministic). This is what lets §29 claim "no hallucinated geography."
- **Nondeterminism budget:** for B/C especially, run **N=3** repeats per example and report variance; a use that flip-flops its choice across identical inputs is penalized (instability is a cost).

**Predicted production design from these ablations** (to be confirmed): **LLM for A (parse), E (explanation), F (title/summary/tags)**; **deterministic for B (selection), C (correction), and the core of D (merge)**. That is the *boundary-only* LLM design — the strongest honest portfolio story (the AI does language understanding + language generation; the route math is deterministic and grounded), and the cheapest/fastest. **§27 gates can overturn this** if B/C/D-LLM clear their margins.

---

## 19. Metric definitions

Every metric below has an **exact definition, denominator, and failure-handling rule**. The single most important convention, stated once and applied everywhere:

> **Denominator convention.** Let **A** = all attempted generations, **P** = attempts that produced *any* returned route (feasible or relaxed), **F** = attempts that produced a *feasible* route (§3.6). **Robustness/availability metrics use A.** **Quality-of-output metrics use P or F as stated.** A metric is **never** silently computed over only the successes when it is meant to measure reliability — failures count against A-based metrics. Every reported metric names its denominator and the date range, dataset version, and config (§22–§23).

### 19.1 Parsing
- **parse_accuracy** = (fields matching gold) / (total gold fields), micro-averaged over examples; also report **per-field** exact-match (hard fields) and tolerance-match (duration band overlap). Denominator: parse-gold fields over **A** (a failed parse scores 0 for its fields).
- **parse_confidence_calibration** = reliability curve / ECE between the parser's stated per-field confidence and its empirical correctness; report ECE + a calibration plot. Denominator: confident predictions binned over **A**.
- **clarification_appropriateness** = correctly-asked / (asked + should-have-asked-but-didn't), where "should" comes from disposition gold (§7.4); penalizes both over-asking and under-asking. Denominator: examples whose gold disposition is decidable, over **A**.

### 19.2 Constraint satisfaction
- **gold_constraint_satisfaction** = fraction of **gold hard constraints** satisfied by the returned route, averaged over examples. Denominator: **P** (a returned route is required to score it); **A**-level reliability is captured separately by `route_validity_rate`. Report **both** the P-based satisfaction and an A-based "satisfied-and-returned" (= P/A × satisfaction) so a high satisfaction on few returns can't masquerade as success.
- **hard_constraint_satisfaction** = fraction of returns with **zero** Tier-2 violations *that were not disclosed*. Denominator: **P**. (A silent highway on a no-highway request = violation; a disclosed relaxation = not a violation but counts in the next metric.)
- **hard_relaxable_disclosure_rate** = (relaxations correctly disclosed) / (total relaxations). Denominator: returns that relaxed a Tier-2 constraint. **Target ≈ 1.0** (the honesty guarantee).
- **soft_constraint_satisfaction** = fraction of soft targets met within tolerance, averaged. Denominator: **P**.

### 19.3 Route validity & shape
- **route_validity_rate** = **F / A** (feasible routes per attempt). The headline reliability number. Failures count.
- **connected_route_rate** = (returns with no gaps) / **P**.
- **loop_closure_distance** = endpoint-to-origin distance for loops; report median + p90; **loop_closure_rate** = (loops with closure ≤ `ε`) / (loop returns in **P**).
- **duration_abs_error** = |duration − target| (seconds); **duration_pct_error** = that / target. Report median + p90 over **P** (returns that had a duration target). 
- **retrace_ratio** = `self_overlap(ρ)` = (length traversed >1×) / total length. Report median + p90 over **P**; **excessive_retrace_rate** = fraction above the §27 cap.
- **requested_stop_coverage** = (required stop types present) / (required stop types requested), averaged over **P** examples that requested stops.
- **stop_relevance** (human, §20) = rated suitability of inserted stops.

### 19.4 Character signals
- **curvature_score** = the chosen formula's route value (§12), reported as a distribution; for "twisty" requests, **twistiness_hit_rate** = fraction with `curvature_score ≥ THETA_CURVY` over **P**.
- **scenic_signal_score** = the chosen heuristic's value (§13), reported as a distribution; **never** presented as truth. Correlation with human is the only validation (§13).

### 19.5 Diversity
- **diversity** = mean pairwise (1 − `edge_overlap`) over the `K_PRESENT` presented candidates; report per generation, averaged. Denominator: generations that presented ≥2 candidates.
- **route_overlap_ratio** = `edge_overlap(a,b)` = shared-edge length / min(len a, len b); the dedup primitive (`> TAU_OVERLAP` ⇒ near-duplicate).

### 19.6 Feasibility, correction, fallback
- **first_pass_feasibility** = (attempts feasible on iteration 1) / **A**.
- **repair_success** = (failed-first-pass attempts made feasible by correction) / (failed-first-pass attempts). Denominator: first-pass failures.
- **self_correction_efficacy** = same as repair_success but counting only corrections that improved the *score* without new violations; pairs with **new_violation_rate_after_correction** = (corrections introducing a new Tier-1/Tier-2 violation) / (corrections applied). **Target: low.**
- **fallback_rate** = (attempts ending in best-so-far or redirect) / **A**.
- **timeout_rate** = (attempts hitting the 25 s budget) / **A**.

### 19.7 Conversational refinement
- **conversational_refinement_success** = (refined routes satisfying both the original hard set **and** the turn's `Δc`) / (refinement turns that returned a route). Also report **hard_constraint_retention** = fraction of turns preserving persisted hard constraints (**target 1.0**).
- **user_weight_responsiveness** = monotonicity score of the chosen route's target signal across a weight sweep (e.g., Spearman ρ between curviness-weight and chosen `curvature_score`), averaged over sweep fixtures. Denominator: sweep fixtures.

### 19.8 Generative-text safety
- **auto_title_factuality** / **auto_summary_factuality** = (titles/summaries containing **no** entity/number absent from the route's tool facts) / (titles/summaries generated). **Target ≈ 1.0** (any invented place is a failure). Denominator: generated titles/summaries over **P**.
- **suggested_tag_precision** = (suggested tags a human deems correct) / (suggested tags); optionally recall vs a small tag-gold.

### 19.9 Latency & cost
- **generation_time** mean + **p90/p99** over **A** (failures and timeouts included — they are part of the user-felt latency). 
- **route_engine_calls** mean + **p90** over **A** (Valhalla load proxy).
- **invalid_model_output_rate** = (LLM outputs failing schema/grounding validation) / (LLM calls). Denominator: LLM calls.
- **cost_per_attempt** = total token cost / **A**. **cost_per_successful_route** = total token cost / **F** (the honest unit cost — failures still cost tokens). Report both; `cost_per_successful_route ≥ cost_per_attempt` always, and the gap reveals waste.

### 19.10 Human
- **human_preference_rate** = (pairwise wins) / (non-tie comparisons), with ties reported separately (§20); always with a CI and the sample size.

**Failure-handling summary (the rule the prompt asks for, made explicit):** *reliability metrics (`route_validity_rate`, `first_pass_feasibility`, `fallback_rate`, `timeout_rate`, latency p90/p99, `cost_per_attempt`) are over **A** — failed/timed-out generations are counted, not dropped.* *Quality metrics (`gold_constraint_satisfaction`, `soft_constraint_satisfaction`, `retrace_ratio`, `duration_pct_error`, factuality) are over **P** or **F** as named, because you cannot score the quality of a route that doesn't exist — but every such metric is paired with its A-based availability so quality-on-survivors can never be mistaken for end-to-end success.*

## 20. Human-evaluation protocol

Subjective quality (goal #3, §3.1) is **sampled honestly at small scale**, never inferred from offline metrics. The design is built for **one developer + a few enthusiast friends** and is explicit about its limits.

### 20.1 Design
- **Evaluators:** the developer + **2–4 enthusiast friends** (people who drive for fun). Small, non-expert; this is a **sanity signal, not a study**.
- **Routes:** **20–40** routes per comparison campaign, drawn from VAL (never TEST until final), stratified by archetype + shape.
- **Method:** **blind pairwise comparison** (A vs B), **randomized left/right order**, **provenance hidden** (evaluator can't tell Roadopia from baseline, or original from refined). Pairwise is chosen over Likert because it is far more reliable at small N.
- **Primary comparisons:** (i) Roadopia (B6/finalist) **vs** B1 avoid-highways and B4 curvature-only; (ii) **LLM-selection (R4) vs deterministic (R1)** — the §27 gate input; (iii) **refined vs original** after a refinement turn.
- **Map-only by default:** evaluators judge from the rendered route + stats (no driving required). This is the honest basis for "appears…" claims.
- **Optional physical drive:** the developer may drive a **handful** of routes to sanity-check that map-good ⇒ road-good. **Safety rules:** obey all traffic law; no phone interaction while driving; passenger or post-drive rating only; never rate speed/timing; abort if conditions are unsafe. Physical-drive results are anecdotal and labeled as such.

### 20.2 Rating dimensions (per route or per pair)
Appears enjoyable · appears scenic · appears appropriately twisty · route coherence · excessive retracing (yes/no) · stop relevance · agreement with the request · preference vs baseline · preference vs original (refinement). Each is a simple choice or 1–5; **the headline is the pairwise preference**, the rest are diagnostic.

### 20.3 Agreement & uncertainty
- Report **inter-rater agreement** (percentage agreement + Cohen's/Fleiss' κ across evaluators on the same pairs).
- Report every preference as a **rate with a 95% CI** (Wilson interval for proportions; bootstrap where needed) **and the n**.
- **Explicitly state the limits:** small, non-random, possibly-biased evaluator pool; region-specific; map-only; not powered for significance. Conclusions are **directional**.

### 20.4 What human eval can and cannot conclude
- **Can:** "evaluators preferred Roadopia routes over the avoid-highways baseline in X/Y blind comparisons (95% CI …)"; "no evaluator flagged excessive retracing in Z%." 
- **Cannot:** "Roadopia produces objectively better/scenic routes"; any significance claim from n≈30; anything about regions not tested (§24, §30).

---

## 21. Calibration procedure

All parameters are tuned **only on DEV**, validated on VAL, and **never tuned on TEST** (§6.4). Each parameter has a tuning method, a metric it trades against, and where it is set. Final reported numbers use the **frozen** parameter set.

| Parameter (v2 name) | Tuned against | Method | Set in |
|---|---|---|---|
| Search-radius / **isochrone budget** (`α`, `τ_out`) | `duration_pct_error` vs feasibility | sweep `α` ∈ [0.45, 0.65] on DEV loops; pick min duration error with feasibility ≥ target | §9, SPK-16 |
| **`N_CANDIDATES`** | `diversity` & feasibility vs generation_time | increase until diversity/feasibility plateau; stop where p90 latency nears budget | §9, SPK-19 |
| **`K_CLUSTERS`** | diversity vs retrace | sweep on DEV; balance distinct clusters against thin routes | §9 |
| **`N_SECTORS`** | diversity vs feasibility | sweep {4,6,8}; pick best diversity without starving sparse origins | §9/§10 |
| **`K_PRESENT`** | human choice load vs selection quality | small (3–5); enough alternates without overwhelming | §9/§14 |
| **`DURATION_TOLERANCE`** | `soft_constraint_satisfaction` vs honesty | set to the band where most feasible routes land; disclose beyond it | §3.6/§19 |
| **`THETA_CURVY`** | twistiness_hit_rate vs feasibility | from the curvature hand-label set (§12); the knee between "twisty" and "too strict" | §12, SPK-10 |
| **`turn_threshold`** (significant turn) | curvature ρ vs grid FP | from §12 ablation | §12 |
| **`TAU_OVERLAP`** | diversity vs candidate starvation | sweep [0.4, 0.7]; default ~0.6; lower if duplicates persist | §9, SPK-15 |
| self-overlap cap | excessive_retrace_rate | set at the human "excessive retracing" boundary | §10/§19 |
| **detour_max** (A→B) | detour_ratio vs character | cap where routes stay sane; sweep on DEV A→B | §11 |
| **scoring weights** `w_*` | blind preference + gold satisfaction | coordinate-style search on DEV; validate on VAL; **freeze** | §14, §21 |
| **preset weight vectors** | per-preset intent match | hand-set then DEV-validate each preset produces its character | §15 |
| **POI detour penalty** | stop_relevance vs detour | sweep so a stop is added only when reasonably on-the-way | §9/§11 |
| **max iterations** | self_correction_efficacy vs latency | fixed at **3**; confirm diminishing returns past 2–3 on DEV | §16 |
| **wall-clock timeout** | timeout_rate vs completeness | fixed at **25 s**; confirm p90 < 25 s achievable (else cut `N_CANDIDATES`) | §16, SPK-19 |
| **relaxation order** | disclosure rate vs satisfaction | the §3.7 order; validate it relaxes the *least-costly* soft target first on DEV | §3.7 |
| **scenic-signal weights** | scenic ρ vs human | only if §13 [GATE-S] passes; else weight = 0 | §13, SPK-11 |
| **slider ranges** | responsiveness vs degeneracy | clamp extremes that break routes (§15) | §15 |

**Two calibration disciplines:** (1) **tune-on-DEV-only** — any parameter touched while looking at VAL/TEST taints those splits; (2) **freeze-then-report** — once frozen for a config, the same values run on VAL (finalist pick) and TEST (final numbers); a later change forces a new config id (§22) and a fresh VAL pass.

## 22. Reproducibility protocol

Every experimental run (offline benchmark, demo, or production sample) records a complete manifest so any number is attributable and replayable. Manifests are stored with the run outputs (the eval harness writes them; spec §39).

**Per-run manifest (required fields):** experiment id · code commit (git SHA) · prompt version(s) · model id + params (temperature, max tokens, etc.) · routing-data version + **OSM extract date** · region id + `.poly` hash · scoring config id (+ weight vector) · user-weight config · random seed · dataset (split + semantic version) · timestamp · environment (Valhalla image tag, VPS or hosted) · cost ledger.

**Per-example record (required):** the brief + parsed constraints · gold label id · **all candidate routes** (geometry + stats) · the **selected** route · **failed** candidates + reasons · full **tool-call trace** (inputs/outputs, timings) · LLM raw outputs (+ which passed validation) · computed metrics · per-example cost + latency.

**Nondeterminism handling:** fix seeds where the SDK allows; for LLM-in-the-loop variants, run **N=3** and store all repeats + variance; report distributions, not single points (§24). A "reproduced" result means the **same manifest reproduces the same distribution**, not a bit-identical route.

**Storage:** raw outputs + manifests retained for the project's life (cheap text/JSON); the dataset and gold labels are versioned in the repo; production-failure cases are appended to PFR with the manifest that produced them.

## 23. Public-evaluation-page provenance

The public eval page is a credibility artifact; it must **never blend incommensurable runs**. (Spec §39, verification SPK-21.)

**Hard separation.** The page partitions every metric by its source and never pools across:
- **Benchmark** (offline, gold-labeled, frozen config on TEST/VAL) — the rigorous numbers.
- **Production/anonymous-demo** (real user/demo traffic) — real-world numbers, no gold labels (so only objective metrics: validity, latency, cost, disclosure, fallback — **not** gold-satisfaction).
- These are shown in **separate sections**, never averaged together.

**Every published metric is annotated with:** metric name · **sample size (n)** · **eval-set version** · **prompt + model version** · **map-data/OSM-extract version** · **date range** · a **caveat/limitation** · and a **tag: benchmark | production | demo**. A metric whose provenance is mixed or whose config changed mid-window is **not shown** until re-run cleanly.

**Anti-mixing rules.** (1) A model/prompt/scoring/data version change **starts a new measurement window**; old and new are not concatenated. (2) Human-preference numbers always carry n + CI + the §20 limitations. (3) Gold-based metrics appear **only** under Benchmark (production has no gold). (4) The page links to the methodology (this protocol) and states plainly that results are **region-specific** and **not** claims of general superiority.

## 24. Statistical & practical interpretation

The dataset and evaluator pool are **small by design**; the protocol's credibility depends on **not over-reading** them.

- **Report uncertainty, always.** Proportions get **95% CIs** (Wilson); differences between variants get a **CI on the difference** (or a bootstrap); never a bare point estimate.
- **Practical > statistical.** With n≈30 human comparisons and ~100 offline cases, most differences will **not** reach conventional significance. The protocol therefore uses **pre-registered practical margins** in the gates (§27) — e.g., "LLM selection must win ≥ X percentage points blind preference" — and treats sub-margin differences as **"no evidence of improvement," adopting the simpler option.**
- **Stratify.** Always report by archetype + shape; a pooled win that is driven entirely by easy rural origins is **not** a general win and is described as such.
- **Multiplicity.** Many variants are compared; treat per-comparison CIs as descriptive, avoid cherry-picking the one "significant" cell, and prefer **consistent directional effects across strata** over isolated wins.
- **Nondeterminism.** LLM metrics are distributions over N=3; report mean + spread; a high-variance choice is penalized even if its mean is good (instability is a real cost in production).
- **Honest negative results are first-class.** "Scenic heuristic showed no correlation, so it ships as labels only" and "LLM selection did not beat deterministic, so it was cut" are **wins for the project's credibility** and are reported as such (§29).
- **What the numbers cannot do.** They cannot establish optimality, general-region performance, or "objective" enjoyment/scenicness. Those are out of scope and out of claims (§30).

---

## 25. Experiment sequence

Ordered so each stage **gates** the next and the cheapest, most decisive experiments come first. Stages map to the v2 build phases (P0/P3/P4) and the verification spikes.

**Stage 0 — Substrate (must exist before any experiment).** Build the eval harness, the §6 dataset (DEV/VAL/ADV/REF first; TEST authored and **locked**), gold labels (§7), and the deterministic core **B6**. *Depends on SPK-04/08/10 (tiles + extract + curvature data).* **Exit:** B6 runs end-to-end on DEV and the harness emits manifests + metrics.

**Stage 1 — Curvature & feasibility (cheapest, foundational).** §12 curvature formula selection on the hand-label set; confirm B6 `route_validity_rate`, `loop_closure_rate`, `retrace_ratio`, `duration_pct_error` on DEV. **Gate:** [GATE-C] picks the curvature formula; if B6 can't reliably make feasible, closing, non-retracing loops, **stop and fix generation before anything else** (this is the project's make-or-break, SPK-15).

**Stage 2 — Generation & loop variants.** §9/§10/§11 — find the simplest generator/loop builder clearing diversity/retrace/duration on VAL ([GATE-G/L/A]). Uses offline metrics + a small blind-preference check on finalists.

**Stage 3 — Scoring, weights, scenicness.** §14 ranking (R1 vs R4 blind preference) [GATE-R]; §15 weight responsiveness/stability [GATE-W]; §13 scenic correlation [GATE-S]. These decide deterministic-vs-LLM **selection** and whether scenic scoring ships at all.

**Stage 4 — Correction.** §16 — F1/F2 vs F3/F4 on seeded failures [GATE-F]; decides deterministic-vs-LLM **repair**.

**Stage 5 — LLM ablations (parse, explain, title/summary/tags, merge).** §18-A/E/F/D — decide the **boundary** LLM uses. Parsing/explanation/generative-text are likely adopted; merge likely deterministic.

**Stage 6 — End-to-end latency & cost.** §19.9 over the chosen config; confirm p50 < 15 s, p90 < 25 s, ~1–3¢/gen (SPK-19). If missed, cut `N_CANDIDATES`/iterations or push more to Haiku, then re-confirm.

**Stage 7 — Conversational refinement.** §17 [GATE-RF] — **only after one-shot is stable** (Stages 1–6 green).

**Stage 8 — Human-eval campaign + TEST.** §20 blind comparisons on VAL finalists; then run the **frozen** config **once** on TEST for final numbers; author the eval-page provenance (§23).

**Stage 9 — Lock & regression.** Freeze the config; wire the eval set as the CI gate (spec §74); begin appending production/demo failures to PFR (§6.5).

## 26. Time & cost estimate

For **one developer + AI coding agents**, assuming the substrate spikes (SPK-04/08/10) are done in P0.

| Stage | Effort (developer-days) | Compute/$$ |
|---|---|---|
| 0 — harness + dataset + gold + B6 | 5–8 (gold-labeling is the long pole) | ~$0 (deterministic) |
| 1 — curvature + feasibility | 2–3 | ~$0 |
| 2 — generation/loop/A→B variants | 3–5 | ~$0 (deterministic) + tiny routing |
| 3 — scoring/weights/scenic | 2–3 + human-pref mini-campaign | LLM-selection runs: a few $ (Batch) |
| 4 — correction | 1–2 | a few $ (LLM repair runs, Batch) |
| 5 — LLM ablations (parse/explain/title/merge) | 2–3 | low $ (Haiku-heavy, cached, Batch) |
| 6 — end-to-end latency/cost | 1–2 | the real-call run; **single-digit $** |
| 7 — refinement | 2–3 | low $ |
| 8 — human-eval + TEST | 2–3 (campaign + scheduling friends) | low $ |
| 9 — lock + CI gate | 1 | recurring eval = cents/run with Batch+cache |
| **Total** | **~21–33 dev-days** (spread over the 4–10 week project, overlapping the build) | **~$20–60 of API across all experiments** if eval uses **Batch (50% off) + prompt caching** and full runs are gated (not per-push) |

**Cost discipline (from verification §12):** run the full eval set on merges/nightly (a smoke subset per push); use Batch + caching for all offline runs; track experiment spend **separately** from the production $30 cap. The dominant *cost* is developer time on gold-labeling and human-eval scheduling, not API tokens.

## 27. Selection gates

Binding, pre-registered decisions. Each names the metric, the **practical margin**, the denominator/dataset, and the default if the margin is not met. **All margins are evaluated on VAL with 95% CIs (§24); ties or sub-margin results adopt the simpler option.** (Exact numeric thresholds are set after the Stage-1 baseline establishes what B6 achieves; the *rules* are fixed now.)

| Gate | Decision | Adopt-the-complex-option only if… | Default (simpler) |
|---|---|---|---|
| **[GATE-C]** curvature formula | which §12 metric | simplest formula reaches Spearman ρ ≥ τ_ρ **and** grid-FP ≤ τ_fp | the simplest passing formula (likely C2/C7); composite only if none single passes |
| **[GATE-S]** scenic scoring | numeric scenic vs labels-only | some variant's incremental ρ ≥ τ_scenic | **labels/signals only (S0/S1); drop numeric scenic** |
| **[GATE-G/L/A]** generation | which generator/loop/A→B | a richer variant beats the simplest **feasible+diverse+low-retrace** one by ≥ τ_gen on VAL (+ blind pref on finalists) | sector-bounded curvy+POI + dedup (G6/G7, L3+L4+L8, A4) |
| **[GATE-R]** ranking (RQ 21) | LLM selection vs deterministic | LLM (R4) wins blind preference over R1 by ≥ τ_sel pp at CI **and** ≥ gold-satisfaction **and** within latency | **deterministic R1 + LLM explanation only (R6)** |
| **[GATE-W]** weights | sliders vs presets-only | sliders are responsive **and** non-degenerate at extremes | presets + **clamped** sliders; fall back to presets-only if extremes break |
| **[GATE-F]** correction (RQ 22) | LLM repair vs deterministic | LLM (F3/F4) beats F1∪F2 on self_correction_efficacy by ≥ τ_fix **and** no rise in new_violation_rate **and** within latency | **deterministic repair F1 + generate-more F2 + relaxation F5** |
| **[GATE-D]** refinement merge | LLM vs rules | LLM (RF5) beats RF6 on refinement_success **and** retains 100% hard constraints | **deterministic RF6**, LLM only if phrasing demands |
| **[GATE-E]** explanation | LLM prose vs template | LLM readability preferred **and** factuality ≥ τ_fact (no invented entities) | template if LLM factuality < τ_fact |
| **[GATE-F2]** title/summary/tags | LLM vs template | factuality ≥ τ_fact (≈1.0 for invented places) **and** user edits before save | template if factuality fails |
| **[GATE-RF]** ship refinement at all | keep vs cut | one-shot generation is stable (Stages 1–6 green) | cut refinement from MVP if one-shot is unstable |
| **[GATE-LAT]** scope | full region vs reduced | p90 ≤ 25 s **and** cost ≤ target at full region | **reduce region / cut `N_CANDIDATES`** until budgets met |
| **[GATE-HANDOFF]** external nav language | what to promise | (settled by verification) external maps cannot preserve loop geometry | **best-effort language only; follow-mode primary** |

**Meta-gate (the protocol's thesis):** *adopt the deterministic option at every gate unless the LLM/complex option clears its margin.* The expected outcome is a planner that is **deterministic in the loop and LLM-only at the boundary** — and if the data overturns that, the gates make the upgrade evidence-based and defensible.

## 28. Recommended minimum methodology

Pending the experiments, the recommended target — the simplest design expected to be "good enough to demonstrate" and to pass its gates — is:

1. **Parse:** **LLM (Haiku)** structured-output parse → the §3.4 schema, with a rules fallback; clarify only under the §3.5 ill-defined rule. *(Boundary LLM use — adopt per [GATE-A].)*
2. **Search region:** **isochrone-bounded** `Ω` (calibrated `α`), not a guessed radius.
3. **Generation:** **sector-bounded curvy-cluster + POI-anchored** candidates (G6/G7), **isochrone-scoped**, **over-generated** then **overlap-deduped** to `K_PRESENT` (G8's scenic weighting only if [GATE-S] passes).
4. **Loops:** **radial-sector circuits** (outbound ≠ return sector) + **angular ordering** + **generate-many-then-dedup** (L3+L4+L8). **A→B:** curvy-corridor + POI with `optimized_route` ordering (≥4 pts) under a **detour cap** (A4).
5. **Curvature:** the **simplest formula** passing [GATE-C] (likely heading-change-per-km or circumcircle), with full junction/roundabout preprocessing.
6. **Scenicness:** **labels/signals only unless** [GATE-S] proves correlation; never an objective claim.
7. **Scoring/selection:** **deterministic weighted scoring**, present **top-1 + alternates** (R1). **LLM selection only if** [GATE-R] clears.
8. **Weights:** **presets + clamped advanced sliders** (W2), defaults stable everywhere; **no learning**.
9. **Correction:** **generate-more + deterministic repair + relaxation/best-so-far** (F2+F1+F5). **LLM repair only if** [GATE-F] clears.
10. **Validation/feasibility/failure:** the §3.6/§3.7 hierarchy with **honest disclosure** and best-so-far/redirect; never a fake route.
11. **Explanation + title/summary/tags:** **LLM (grounded, validated)** — boundary uses, gated on factuality ([GATE-E/F2]).
12. **Refinement:** **re-run with merged constraints** + avoid-as-geometry-penalty; **deterministic merge** (RF1+RF4+RF6); shipped **only if one-shot is stable** ([GATE-RF]).
13. **Budgets:** `N_CANDIDATES`/iterations/timeout tuned so **p50 < 15 s, p90 < 25 s, ~1–3¢/gen**.

**In one sentence:** *a deterministic, isochrone-bounded, sector-diversified, curvature-driven candidate-search with deterministic weighted scoring and honest relaxation, wrapped by an LLM that parses the request and explains the result* — the smallest design that produces usable routes, supports refinement, reports honestly, evaluates against gold, fits the latency/cost budget, is buildable by one developer, and tells a true AI-product story.

## 29. Claims the final project may make

Only claims a stated metric on a stated dataset/region supports (with n, version, date, CI):

- "Turns a natural-language brief into a **real, road-following, connected** route on the [region], satisfying explicit hard constraints or **honestly disclosing** relaxation." *(route_validity_rate, hard_constraint_satisfaction, disclosure_rate.)*
- "Achieves **X% gold-constraint satisfaction** and **Y% parse accuracy** against **human** gold labels on a held-out set (n=…, reqset-v…, model …, date …)."
- "**Generates diverse candidates** (mean pairwise overlap ≤ `TAU_OVERLAP`) and **avoids out-and-back** (retrace_ratio p90 = …)."
- "Generation **p50 = … / p90 = …**, **cost ≈ …/route**, within the stated budget."
- "**Grounded:** the planner returns no road, stop, or geometry absent from the underlying OSM/spot data; LLM outputs are schema-validated and fact-checked, with **0 invented-place** rate on the sampled set." *(invalid_model_output_rate, factuality.)*
- Evidence-based design claims, **whichever way the gates fell**: e.g., "deterministic ranking matched LLM selection in blind preference (Δ within CI), so the simpler design ships," or "the scenic heuristic showed no human correlation, so scenicness ships as labels only." *(These honest negatives are a strength.)*
- "Supports **conversational refinement** with measured consistency (refinement_success = …, hard-constraint retention = …)." *(If [GATE-RF] kept it.)*
- "In **small blind human comparisons** (n=…, 95% CI …), evaluators preferred Roadopia routes over the [baseline] — a **directional** result, region-specific, not a significance claim."
- "**Honest, versioned public metrics**, partitioned into benchmark vs production, each annotated with sample size, versions, and caveats."

## 30. Claims the final project may not make

Forbidden because no implemented method or sample supports them:

- ❌ **Optimality** — "the best/most scenic/twistiest possible route." No optimizer is implemented; the search is heuristic (§3.1).
- ❌ **Objective scenicness/enjoyment** — "this is a scenic route," "this is a fun drive," any numeric scenic "score/10" as truth. Only signals/labels + sampled human *preference* (§13.3, §20.4).
- ❌ **General-region performance** — any claim beyond the tested corridor; results are region-specific (§5, §24).
- ❌ **Statistical significance from the human eval** — n≈30, non-random pool; results are directional with CIs only (§24).
- ❌ **"The AI plans/decides the route"** in a way implying the LLM computes geography — the route math is deterministic and grounded; the LLM parses + explains (+ selects/repairs only if a gate proved it) (§28).
- ❌ **"Learns your taste"** — preferences are explicit weights; no personalization model (§15, spec §35).
- ❌ **Faithful external-app navigation of loops** — Apple/Google URL hand-off cannot carry a loop; in-app follow-mode is primary, hand-off best-effort (verification §17, [GATE-HANDOFF]).
- ❌ **Guaranteed public-road-only / closure-free routing** — Valhalla biases toward legal public roads but cannot guarantee it or know most closures (verification §11/§18); the safe-driving disclaimer stands.
- ❌ **Any speed/timing/racing capability or quality** — permanent non-goal (spec §59); the planner never optimizes for or describes speed.
- ❌ **Improvement attributable to the LLM without a baseline** — every "AI helps" claim requires beating the relevant baseline by its pre-registered margin (§8, §27).

---

*End of Roadopia Route-Planner Experimental Protocol v1.0.*
