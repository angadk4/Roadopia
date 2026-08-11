# Roadopia Route Generation — Technical Reference

**What this document is.** A complete, honest description of how Roadopia builds every route it
serves: the data it builds them from, the engines and algorithms it runs, the gates that reject bad
output, and the exact numbers everything is tuned to. One section per surface — **Discover**, the
**Loop planner**, and **A→B** — plus a register of every issue raised and its current status.
Everything here is as-implemented (file paths and constants are real, from the code at
`frozen-r31-v1`, 2026-08-10), including the parts that failed and were refused.

**The one-paragraph version.** Roadopia is a *deterministic-first, measured-first* planner. Good
driving roads are found and scored **offline** by a sweep that builds and hard-judges thousands of
candidate loops and road stretches against quality bars, storing only the survivors in a measured
index. At request time, the planner prefers to **serve measured material** — picking a stored ring
that fits your ask and routing you to it and home in a single routed request — and only falls back to
live search when nothing measured fits. Every served result must pass hard "as-driven" gates derived
from the owner's own words (right length, loop-shaped, no doubled roads, no street stubs). The LLM
never emits geography: it parses briefs and narrates results, nothing else.

---

## 0. Shared foundations

Everything in the three surfaces is built from the same substrate.

### 0.1 The road data

- **Source:** OpenStreetMap Ontario extract (921 MB), filtered to a drivable-roads subset
  (~73,000 ways, 5.4 MB — SPK-08). A *routing* variant keeps motorway/trunk so the engine can route
  everywhere even though the planner avoids them.
- **`curvy_segments` corpus:** every road segment scored by a **curvature engine**
  (`@roadopia/data`, SPK-10): per-segment `circum_curvature_per_km` computed from circumcircle
  curvature of the polyline, validated against hand labels (ρ = 0.825 vs human ranking). The
  retrieval threshold θ = 0.6 (`THETA_CURVY_DEFAULT`, frozen at M4 [GATE-C]) marks a segment
  "curvy"; a **country tier** (θ = 0.35, `COUNTRY_THETA`, BD-98) admits straighter rural roads that
  make good connective tissue. PostGIS + a bbox prefilter serve `find_curvy_roads` at p90 ≈ 159 ms.
- **Urban index:** polygons classifying built-up areas; used to measure `urban_share` and to keep
  search waypoints out of subdivisions.
- **Spots:** POIs (coffee, viewpoints, fuel…) with types, used for stops — grounded rows only, never
  invented.

### 0.2 The routing engine

Self-hosted **Valhalla 3.7.0** (Docker, loopback-only). What we actually use, with the quirks we
measured:

- **`/route`** with up to **20 locations**. Middle locations are typed:
  - `through` — pass through without stopping or U-turning. This is the planner's default for search
    waypoints, with a `search_filter: { min_road_class: 'unclassified' }` so a waypoint can never
    snap onto a residential crescent or service road.
  - `break` middles were **measured to be a U-turn factory** (the engine full-stops and may turn
    around on whatever street the point snapped to). Two separate shipped bugs came from `break`
    vias (see §4).
- **Costing** (`backend/src/planner/costing.ts` → `realizeCostingOptions`):
  - `LEGACY` = `{ use_highways: 0.2, use_living_streets: 0 }` — mild highway aversion, the default.
  - `BACKROADS`/`FUN` = `shortest` (distance-optimal) with sizing speeds 50/38 km/h — the profile
    behind twisty/backroads asks. `shortest` bypasses *all* soft costing factors, which is why soft
    levers repeatedly measured as no-ops under it.
  - `exclude_highways: true` is a **verified no-op** on 3.7.0 (probed byte-identical); the
    translation layer converts the *intent* into `use_highways: 0` + dropping `shortest`, which is
    the lever that actually works.
  - Commutes (Discover get-there/home) use `{}` — engine-default fastest, nothing else (owner
    decision, BD-149).
- **`/sources_to_targets`** — travel-time matrix, ≤ 50×50; used by Discover's reachability prefilter.
- **`/trace_route`** — map-matching used *offline and in audits* to get road-class truth
  (backroad/main/residential/highway shares) for a geometry. Not called live (25 s budget).
- Measured quirks that shaped the code: two `through` locations on the same network point produce a
  zero-length leg and a **499 "leg_shape_index not set"**; adjacent waypoints get merged. Simplified
  geometry vertices may snap slightly off the real road, so anything concatenating stored geometry
  with routed geometry creates false seam defects (this killed an architecture; see §2.2).

### 0.3 The measured-core index (the heart of everything)

`drive_cores` table (Postgres/PostGIS, migrations 0016–0019), read through a `SECURITY DEFINER` RPC
(`discover_drive_cores($bbox, $version, $limit, $kind_filter)`) so the client role has no direct
table access. Two kinds of row:

- **`loop` cores** — closed rings (entry ≈ exit; verified: 100 % of rings close within metres),
  ~225 simplified vertices each. These are complete great drives.
- **`ribbon` cores** — open stretches of continuous backroad (avg ~9 min) with measured
  entry/exit. Chaining material; too short to be a trip alone.

**How the index is built** (`eval/build_drive_cores.ts` — the offline sweep):

1. The region is tiled into ~8 km cells (1,185 cells; scope half-width 12 km so cells overlap).
2. Per cell, curvy + country segments are retrieved; the best merged road pieces yield
   **pseudo-origins on the good roads themselves** (2 per cell in r34).
3. From each origin, loop candidates are generated at **three duration targets — 3600 / 5400 /
   8400 s** (r34; r33 generated only 5400 s, which is why 60-min and 2-h asks used to be starved),
   4 candidates per origin per size.
4. Each candidate is **assembled with the real engine** (`assembleLoopWithRepair`, BACKROADS
   costing + no-highway), then **traced** for road-class truth, then judged by `judgeCore`
   (`backend/src/planner/core_bars.ts`) — hard rejection, no soft scores:
   - `backroad_share ≥ 0.55` · `main_share ≤ 0.30` · `hood_share ≤ 0.05`
   - `turns_per_10min ≤ 5.0` (no turn-soup) · `uturns = 0` · `spurs = 0` · `microloops = 0`
   - loops: `loopiness ≥ 0.25` (isoperimetric — a real ring, not an out-and-back)
   - ribbons: `corridor_doubling ≤ 0.1` · endpoint separation ≥ 2 km · `self_overlap ≤ 0.05`
5. Survivors are **deduped per cell** by edge overlap (> 0.5 = same physical road) and capped
   (keep ≤ 10/cell). Every rejection increments a per-bar histogram that is printed with the run
   (r34: `assembly_rejected ×22,574 · main_share ×2,857 · backroad_share ×1,919 …`) — the binding
   bar is always named, never silently relaxed.
6. The sweep is **deterministic and resumable**: no RNG, no wall-clock in content, a config STAMP
   guards checkpoints, and the output artifact hashes byte-identical across runs.
7. `eval/load_drive_cores.ts` loads an artifact (delete-per-version + insert, transactional).

**Current index (`r34-rib`):** 403 loop cores / 91 distinct rings across three size bands, plus
1,652 measured ribbons (carried from r33 unchanged). Every row carries measured
`duration_s, distance_m, curviness, backroad_share, main_share, hood_share, turns_per_10min,
loopiness, entry, exit, geometry`.

### 0.4 The detector vocabulary (how "bad route" is measured)

All in `backend/src/planner/` (`outandback.ts`, `overlap.ts`, `revisit.ts`, `legs.ts`):

| Detector | Algorithm | Key constants |
|---|---|---|
| `outAndBack` | resample geometry, hash to cells, find **opposed-direction runs** on the same cells (driving the same road both ways) | run floor 250 m; reject bar 1,200 m |
| `spurPositions` | 20 m resample, 40 m cells; a doubled run of ≥ 3 steps within a 20/50-step window = an in-and-out **street stub** | origin grace (route-level 2.5 km; trip gates use 500 m) |
| `microloopPositions` | closed circuits of 150 m–3 km with ≥ 3,000 m² area — the "goes around a random crescent/box" shape | closure tolerance 30 m |
| `loopiness` | isoperimetric quotient 4πA/P² of the shape (1.0 = circle) | core bar ≥ 0.25 |
| `edgeOverlapRatio` | fraction of one line's 120 m cells present in another — the "same physical road" test | dedup > 0.5; same-way label ≥ 0.5 |
| `revisitCount` | distinct areas entered more than once ("in and out of Inglewood many times") | reject > 2 |
| `splitLoopLegs` | geometric three-way split of a trip at its waypoint vertices (there / drive / home) | min drive fraction 0.25 |
| `uturnCount` | Valhalla maneuvers whose type is a u-turn | any u-turn fails a core |

### 0.5 The AI boundary (hard rule)

The deterministic pipeline owns **all** geography. The LLM appears exactly twice:

- **Parse** (Haiku): free-text brief → structured constraints (duration, character preset, avoids,
  place names). Place names are resolved to coordinates by *our* gazetteer, never by the model. The
  app's buttons (Direct/Backroads chips, Drive time) override parsed fields; the text box owns
  places and intent. A deterministic rules parser (`parse_rules.ts`) is the no-AI fallback.
- **Explain** (Sonnet, prompt v2): receives a **RouteFacts JSON** (road names, numbers, stops, the
  "asked" fields, satisfied/relaxed constraints) and writes 2–4 honest sentences. It is structurally
  incapable of inventing geography (facts-only rule + grounding validation that rejects any output
  naming a road/place not in the facts, with template fallback). All calls ride a cost-guarded
  client (budget ledger, kill switch, caching).

---

## 1. How DISCOVER works

**Product shape:** "great drives near you" — a map of amber lines + a rail of ≤ 6 cards. Each card
is a *measured* drive plus honest get-there/get-home legs, e.g. **"the drive 42 min · getting there
18 · home 21."** Code: `backend/src/planner/discover_cores.ts` (v2), `discover.ts` (v1 fallback),
app `lib/discover.ts` + `screens/DiscoverHome.tsx`.

### 1.1 Pipeline, step by step

1. **Read the index.** `discover_drive_cores` RPC with the origin's bbox, `version = 'r34-rib'`,
   `kind = 'loop'`, quality-ordered (strict-bar rows first, then `backroad_share · curviness`).
   Loop cores only — ribbons re-created a "9-minute drive" swamp when admitted (BD-137; the 0019
   migration added the kind filter for exactly this).
2. **One travel-time matrix** (`/sources_to_targets`): `[origin, entry₁, exit₁, entry₂, exit₂, …]`
   (≤ 41 locations), priced on **engine-default fastest** — the same costing the connectors use, so
   the estimate matches the build.
3. **Prefilter before building anything:**
   - reach: drop cores whose get-there time > `DISCOVER_REACH_S` = 3,600 s;
   - commute share: drop cores where `(t_out + t_home)/(t_out + t_home + drive) > 0.6`
     (`CORE_CONNECTOR_SHARE_MAX`) — a card that is mostly commute is never shown.
4. **Dedup for a real menu** (BD-150): walking the quality order, a candidate is skipped if
   (a) its ring's `edgeOverlapRatio` with any kept ring > 0.5 — the same physical road stored under
   an overlapping sweep cell — or (b) it shares a **headline name** with a kept card (three distinct
   "Fallbrook Trail" rings are still monotony to a human). Keep ≤ `CORES_MENU_MAX` = 6.
5. **Build the two commute legs — with zero engineering** (BD-149, owner decision): one `/route`
   origin→entry, one exit→origin, engine-default fastest costing, **no retry ladders, no offset
   vias, no overlap steering**. (The R30-era anti-same-way retry ladder was itself the owner's
   "getting there is absolutely terrible" — deleted.) If the *built* share exceeds 0.6 the card is
   dropped (a via-free build can still come out longer than the matrix estimate).
6. **Label, never fix:** if home's overlap with out ≥ 0.5 the card carries `sameWayHome: true` and
   the UI says "you'll come home the way you went out" — an honest fact, not a defect.
7. **Serve the stored core geometry as-is** — the drive itself is *never re-routed*; its measured
   numbers (duration, curviness word, backroad share) describe exactly the stored ring the sweep
   validated. Per-leg times come from the two live connector builds.
8. **Fallback:** an empty v2 menu (supply desert) silently falls back to the v1 Discover
   (out-and-back suggestions from the corpus) so no origin loses its menu.

### 1.2 What the app does with it

`coreDriveToRoute` concatenates out + core + home into one `Route` **with `Route.legs` filled**
(there/drive/home percentages and metres, drive backroad share) — so the Result screen renders the
three-leg bar and the map colours the drive amber and the commutes grey
(`['match', ['get','leg'], 'core', AMBER, grey]` in `DriveLinesMap`/`RouteDetail`). Tapping "Let's
go" opens the pre-built route instantly — no `/plan` round trip.

### 1.3 Quality gate (eval)

`eval/discover_v2_quality.ts` runs the real `discoverCores` at 8 sample origins. Bars: ≥ 5 drives at
≥ 6/8 origins · every card ≤ 0.6 connector share · per-leg times present · same-session determinism.
Current verdict: **PASS** (7–8/8 full menus).

---

## 2. How the LOOP PLANNER works

**Product shape:** "90 minute backroads loop" → **one** loop from your door back to your door, no
commute framing ("that loop should be the full drive as the loop itself" — owner, BD-149). Code:
`backend/src/planner/run.ts` (orchestration), `drive_first_trip.ts` (the served path),
`trip_gates.ts` (the judge), plus the legacy pipeline for fallback.

### 2.1 Request intake

`POST /plan` (SSE stream). Brief → parse (Haiku or rules; chips override) → validated
`ParsedConstraints` (duration target, preset, avoids, resolved origin/destination, pinned places).
Everything downstream is deterministic. Wall budget: **25 s** (`WALL_CLOCK_BUDGET_MS`); the trace
streams every pipeline step with real details (never model reasoning).

### 2.2 The served path: the drive-first trip

The central idea (BD-141→BD-149, three architectures later): **don't search for a loop — serve a
measured one.** A stored ring is a complete, offline-validated great drive; the planner's job is to
fit one to your ask and route you through it cleanly.

**Step 1 — candidate selection** (`driveFirstTrip`):

- Read loop cores in a reach bbox: `max(12 km, ask × 0.3 × 55 km/h)` half-width.
- **The ask means the whole trip** (BD-146). Each ring's servable duration is an *interval*, because
  the ring is a **dial** (see step 2): `[0.6 × ring + commute, ring + commute]`, with commute
  predicted as `2 × crow-distance-to-nearest-ring-vertex × 1.3 / 55 km/h`. Fit = how far the ask
  falls outside that interval (0 if the dial can hit it exactly).
- Sort: fit in 0.1-wide bands → **nearer ring wins within a band** (less commute, better shape) →
  measured quality (`backroad_share`, then `curviness`) → id (determinism).
- **Geometric dedup** (BD-150): drop candidates whose ring overlaps a kept one > 0.5 — without
  this, all five build attempts could be spent on copies of one road stored under different sweep
  cells (the index is ~70 % duplicates by name). Keep ≤ `TRIP_BUILD_MAX` = 5.

**Step 2 — the ring arc** (`ringArc`): a loop core has entry ≈ exit, and serving it whole forces
both commute legs through **one junction** — measured consequence: shared approach roads (the
owner's u-turn stubs), lollipop shapes (trip loopiness 0.14), retraced commutes. The fix is
geometric: **a ring can be entered and left anywhere.**

- `J1` = the ring vertex nearest the origin.
- Walk the ring **the long way** toward a target arc length = `(ask − predicted commute)` converted
  to metres at the ring's own pace — the arc is a **duration dial**, never below
  `RING_ARC_MIN_FRAC` = 0.6 of the ring.
- `J2` = the landing vertex, required ≥ 1.5 km from J1 (different junctions ⇒ the two spokes get
  different roads); direction chosen so J2 lands nearer home.

**Step 3 — one routed request** (the seam-free build): earlier versions glued routed connectors
onto stored geometry; the seams *manufactured* fake spurs and doubles at the joins (dissected in
rq30c). Now the **whole trip is a single `/route` call**: origin → ≤ 15 `through` samples along the
arc (≥ 1.5 km spacing, `min_road_class` filter) → origin, on `LEGACY` costing plus the user's own
avoids. Real geometry end-to-end, real maneuvers, engine-priced duration, real `has_highway` flags.

- Bounded **home-via ladder**: if the direct build fails gates, retry with one perpendicular
  `through` via at ±4 km / ±7 km (never a `break` via — those full-stop on random streets).
- **Full-ring retry**: a partial arc that fails only the loop-shape bar gets one full-ring attempt
  (a chorded 0.6-arc of an elongated ring can score under the bar the whole ring passes).
- **Arc fidelity**: `edgeOverlapRatio(arc, routed drive section) ≥ 0.6` or the candidate is rejected
  as `arc_deviation` — the engine is not allowed to silently shortcut the measured ring and keep its
  advertised numbers.

**Step 4 — the gates** (`judgeTrip`, every bar an owner sentence; failures REJECT, they are never
disclosed-around):

| Gate | Bar | Owner's words |
|---|---|---|
| `trip_duration` | within ±25 % of the ask (engine-priced whole trip) | "1 hour means 1 hour" |
| `not_a_loop` | **drive-closed loopiness** (arc + chord) ≥ 0.25 — the ring on the map must be a real ring. The *whole-shape* isoperimetric score is deliberately NOT gated: it punishes elongation (a perfect ring 8:1-stretched by distance-to-supply fails 0.25), and lollipops are already structurally impossible via the next three gates | "loops should look like loops" |
| `doubling` | longest opposed run ≤ 1,200 m, **excluding runs within 1 km of the origin** (one road out of a subdivision is the owner's own "unless absolutely necessary") | "no same roads twice" |
| `spurs` / `microloops` | zero, at 500 m origin grace (the shipped 2.5 km grace used to hide his whole neighbourhood) | "into a random street, u-turn, back out / around a crescent" |
| `commute_majority` | commute ≤ 50 % of trip **time** — drive time priced at the ring's own measured pace, spokes split the engine remainder (uniform pacing over-priced arterial spokes ~30 %) | the drive is the point |
| `same_way_home` | out↔home overlap ≤ 0.2 | a loop, not an out-and-back |

**Step 5 — serve or fall through.** First candidate passing every gate is served: `result.legs =
null` (no commute framing — BD-149), waypoints [J1, mid, J2] kept only for the audit's geometric
split, disclosure *"Built a 90-minute loop around (most of) Fallbrook Trail — measured roads, honest
time."* The trace records every rejected candidate with the exact gates it broke. The attempt may
spend at most **40 % of the 25 s wall** (epoch-clock deadline — a `performance.now`-vs-`Date.now`
mix once silently killed an entire path); the legacy planner keeps the rest.

### 2.3 The legacy fallback pipeline (when nothing measured fits)

The original deterministic search — still the fallback for ~45 % of loop asks (supply-bound):

1. **Scope:** drivable-radius sizing from the ask (τ budgets; profile sizing speeds 55/42 or 50/38).
2. **Retrieve:** curvy segments (θ 0.6) + country tier (θ 0.35, ≤ 200/ring) + spots from PostGIS in
   concentric rings, with urban caps (`URBAN_SEGMENT_MAX_SHARE` 0.6, refill ≥ 150).
3. **Generate candidates:** cluster segments (radius 2.5 km, ≤ 8 clusters), pick waypoints across
   4 sectors, ~20 loop candidates with return-anchors at 0.6 of the distance budget; closed-ring
   cul-de-sac material is excluded at retrieval (it poisoned waypoints — BD-era fix).
4. **Assemble** (`assembleLoop` + repair): route origin → waypoints → origin (`through` middles,
   snap tolerance 1.5 km, closure ≤ 300 m), then hard gates: self-overlap ≤ 0.15 soft / 0.30 hard
   reject · retrace runs soft 1.2 km · **out-and-back reject at 1,200 m** · **area revisits ≤ 2** ·
   residential share/run bars · arterial run triggers; a bounded repair loop drops/replaces
   offending waypoints (value-aware, capped passes).
5. **Score & rank** (lexicographic, not weighted-sum): clean-before-dirty (dirtiness clauses:
   overlap, residential, trace-null…) → on-target duration (±15 % tolerance; **the real engine
   duration** — the drive-leg-only ruler is dead, BD-146) → country context tier → weighted quality
   (curviness, backroad share, u-turn penalty…).
6. **Validate & relax:** the constraint ladder re-checks every ask (duration, avoids, stops) against
   *measured* results; relaxation is stepwise and disclosed ("about 78 min — a bit over the 60 you
   asked"); on wall expiry the best-so-far ships with `status: best_so_far`.
7. Duration misses ≥ 15 % are always disclosed; ≥ 50 % say "well over/under". An out-and-back-ish
   shape below the disclosure floor says so plainly.

### 2.4 What the user sees

Progress screen streams the steps ("Trying measured drives near you" → …), Result shows one amber
loop, honest stats, grounded stops, the explanation, and constraint verdict chips
(satisfied/relaxed/failed) — the trace never exposes model reasoning (hard rule).

---

## 3. How A→B works

**Product shape:** "backroads drive from Hamilton to Guelph" — a point-to-point route that trades a
bounded detour for better roads. Code: `backend/src/planner/atob.ts`, `chain.ts` (corridor
machinery), same run.ts orchestration.

### 3.1 The corridor planner (the serving path)

1. **Direct baseline:** route A→B directly; its distance anchors the **detour cap**
   `DETOUR_MAX_DEFAULT = 1.8×` — a hard structural bar that never relaxes.
2. **Corridor retrieval:** curvy + country segments within a lateral band of the direct corridor.
3. **`buildCorridorChains`** (`chain.ts`): merge same-road pieces (`mergeRoadPieces`), project
   candidate spans onto the corridor axis, and **greedily insert spans in corridor order** using an
   insertion predictor (span self-cost priced by length; matrix-style gap pricing), keeping
   projected detour under the cap. Spans become pinned waypoint pairs.
4. **Assemble** with the A→B profile (`BACKROADS_ATOB` — the pre-BD-100 connector costing that its
   own A/B suite validated), then A→B gates v2: self-overlap ≤ 0.3, value-aware span drops (a low
   value span is dropped before a high-value one when repair must shed), bounded repair (≤ 2
   passes), assembly relax ladder.
5. **Rank & validate** as in §2.3 (duration ranking uses real durations; detour cap enforced again
   on the final geometry).

**Measured today** (10-corridor fixed suite, real `runPlanner`): routed 10/10, backroad mean
43.1 %, zero opposed runs > 1.2 km on 9/10, detour worst 1.92×.

### 3.2 The drive-first attempts — built, measured, refused (kept honest)

The loop breakthrough suggested serving measured ribbons on the way. Both attempts are in
`drive_first_atob.ts` behind `ATOB_DRIVE_FIRST` (default **off**), with the full account in the
module header:

- **Single ribbon** (BD-151): best corridor ribbon, oriented, one-shot through-routed. 27.4 %
  backroad (vanilla fill) / 30.0 % (profile fill) vs 43.1 % legacy — one ribbon cannot carry an
  hour-long corridor. (A clock bug — `performance.now` t0 vs `Date.now` deadline — initially
  rejected everything as `time_budget`; found via a standalone-vs-pipeline discrepancy and fixed
  *before* judging.)
- **Multi-ribbon chain** (BD-153): 1–3 distinct ribbons ordered by their projection on the A→B
  axis, greedy per-ribbon orientation, combo detour prediction under the cap, ≤ 15 through-samples
  across the chain, per-ribbon fidelity gates. Served 10/10 cleanly — and measured **41.0 %**,
  still under legacy's 43.1 % (bar was ≥ 51 %). Chains win weak corridors (Cobourg→Uxbridge
  29→71 %) and lose strong ones (Southfields→Hockley 68→53 %), and there is no in-budget signal to
  choose per corridor.

**Conclusion on record:** the legacy corridor planner is genuinely competitive at A→B; two serious
architectures failed to beat it on its own suite. It keeps the surface.

---

## 4. Issues register — everything raised, and where it stands

Every complaint the owner has made, mapped to root cause and current status. ✅ = fixed & measured,
⚠️ = improved / structurally bounded, ❌ = open.

### 4.1 Fixed, with the mechanism named

| Issue (owner's words) | Root cause found | Fix | Evidence |
|---|---|---|---|
| **"Random road entries and exits, u-turns, many times"** | (a) `break`-typed retry vias full-stopping on random streets; (b) fake seams from gluing routed connectors onto simplified stored geometry; (c) single-junction ring joins forcing shared approach roads | `through` vias everywhere; the whole trip as ONE routed request; ring-arc J1/J2 entry/exit | audit v20: **0 street stubs, 0 u-turns** on 33 served loops (was 3 stubs/trip) |
| **"Goes around a random crescent then continues on the same road"** | same as above + no microloop gate on served routes | microloop detector gated at 500 m origin grace; crescent-poison rings excluded from retrieval | v20: **0 crescents** served |
| **"Drives don't look like loops"** (lollipops) | trips judged on the drive leg only; entry≈exit forced a doubled stem; whole-trip loopiness averaged 0.14 | ring-arc + drive-closed loopiness ≥ 0.25 + stem structurally impossible (out≠home ≤ 0.2 overlap, doubling ≤ 1.2 km) | v20: **0 not-a-loop** served; typical drive-closed 0.40 |
| **"1 hour means 1 hour"** (60-min asks served 106 min) | the drive-only duration ruler (BD-135) — my framing error, approved without the cost visible | the ask = the whole trip; ring arc as a duration dial; hard ±25 % gate | v20: served duration **1.08× mean, 1.23× worst, 0 wrong-length** |
| **"No same roads twice unless absolutely necessary"** | commute retracing + in-drive doubling conflated; subdivision entrances punished | doubling gate ≤ 1.2 km *outside* a 1 km origin grace (the entrance IS the necessary case) | v20: 2/33 flagged at the stricter audit floor; 0 above the gate |
| **"Getting there and back is absolutely terrible"** (Discover) | my anti-same-way retry ladders + backroads costing on commutes (subdivision detours, 1.8× paths) | commutes = engine-default fastest, zero engineering; sameWayHome demoted to a label | owner decision BD-149; menus improved (share 60→54 % worst) |
| **"The loop should be the full drive"** (no commute framing) | three-leg presentation applied to Plan | `legs = null` for Plan loops; loop-native words; map shows one amber loop | shipped BD-149 |
| **Same ring / same name repeated in menus** ("8th Line ×2") | index ~70 % duplicates (overlapping sweep cells); one ring under many names | geometric dedup (> 0.5 overlap) in Plan + Discover; menus also name-distinct | live menu: 6 cards / 6 distinct rings |
| **Buttons vs AI text clash** | chips and parse fought over the same fields | buttons own constraints, text owns places/intent; explain prompt receives the ask (v2) and states relaxations plainly | R27–R29 |
| **Highway on "fun" routes** | fun profile had no hard avoid | no-highway imposed at ladder init for fun/backroads (working lever: `use_highways 0` + drop `shortest`) | R25-U3 |
| **Turn soup** ("a turn every minute") | unbounded waypoint density + no turn bar | cores hard-reject > 5 turns/10 min; audit `turn_soup` row | v20: 0 served |
| **Empty Discover menus** | supply + version bugs | r34 supply + v1 fallback | v20: **0 empty menus / 30 origins** |
| **Audits said PASS while the app felt broken** | five instrument failures: drive-only ruler, no spur/crescent/u-turn audit rows, 250 m doubling floor, loopiness never on the trip, 2.5 km grace hiding his subdivision | audit v18+ taxonomy: every complaint is a first-class defect row, judged at the gates' own rulers | BD-145/148 — the audit now finds what the driver feels |

### 4.2 Improved, structurally bounded

- **Monotony** — top ring served 41 % → 33 % of briefs (Fallbrook). Supply-bound: 91 distinct rings
  region-wide; r34's new rings already serve (Duffy's Lane ×5 on its first audit). More variety =
  more sweeps; the bars are the ceiling, and they are the product.
- **Serve rate** — his areas 22→26/36; region 33/60. The binding gate is now **doubling at funnel
  origins** (one arterial feeding an area ⇒ out/home must share it beyond the grace) — geography.
  Candidate lever on record: alternate-J1 retry rungs (different approach roads), unmeasured.
- **Latency** — served trips ~8 s; fallback-heavy worst ~27 s (the legacy search's own 25 s budget +
  streaming tail, pre-existing). The trip attempt is capped at 40 % of the wall.

### 4.3 Open, on the record

1. **The legacy fallback is still the legacy fallback** (~45 % of loop asks): 26–30 % backroad,
   duration tail worst 2.31×, 10/27 below the loop-shape bar on the last audit. Every miss is
   disclosed in words; nothing is hidden — but the *experience* on those briefs is the old planner.
   Options: more supply (the honest lever), or the open product decision below.
2. **Open product decision:** when nothing passes the gates at the asked duration, should the
   planner serve the **best clean trip at a different duration** ("nothing clean fits 2 h from
   here — here's a clean 90-min loop instead")? Converts most fallback briefs into clean trips with
   a disclosed mismatch; bends "1 hour means 1 hour." Owner's call, not taken unilaterally.
3. **Cobourg is a supply desert** — 2 cores under two different sweep configs (flat lakeshore
   grid). Discover falls back to v1 there by design. A targeted top-up sweep needs a loader merge
   path first (the loader is delete-per-version; a naive top-up would wipe the index).
4. **A→B backroad ceiling (~43 %)** — two refused architectures say this is the corridor's honest
   ceiling with current material; closed unless new evidence.
5. **Deferred by backlog** (not planner issues): route Save + AI title/summary/tags (built,
   gated behind the M8 auth tier), photos/EXIF (M10), hosted deploy migrations 0010–0019.

### 4.4 The refusal ledger (what was tried and did NOT ship)

The discipline: every lever is flag-gated, byte-identical off, judged on a pre-registered
adopt-or-refuse suite through the *real* planner entry. Refused (with the decision-log entry):
connector refinement ×6 (BD-93…) · ring seeding (BD-94) · connector maneuver penalties (BD-101) ·
diversify-maxset (BD-103) · `top_speed` on A→B (BD-99/111) · `CONNECTOR_TOPSPEED`/`COUNTRY_VALUE`
live (BD-119 — adopted on an eval blind to the wall budget, reverted when production truncated) ·
single-ribbon drive-first loops (BD-136 — vacuous) · ribbon chains for loops (BD-138/139) ·
whole-shape trip loopiness (BD-149 — punishes distance-to-supply, not badness) · A→B single ribbon
(BD-151) · A→B multi-ribbon chain (BD-153). The planner is the residue of ~60 measured decisions;
the losers are documented as carefully as the winners.

---

*Written 2026-08-10 against `frozen-r31-v1`. Verification lineage: audits v13–v20
(`eval/audit_v13.ts`, artifacts published per audit), probes rq18–rq31 (`eval/experiments/`),
decision log BD-1…BD-153 (`docs/decision-log.md`).*
