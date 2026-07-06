# Decision log

The committed, append-only record of **why** Roadopia is built the way it is — the portfolio's
"judgment" trail. Per **Build Contract §11**, an entry is added whenever a decision is made, an
assumption is confirmed/invalidated, a gate (M4) is decided, or an architecture/dependency change is
approved. **Each entry = decision + rationale (+ date / "Revisit when").**

Seeded at **M0-T11** from **Master Spec §89** (frozen v2.0 design decisions) and **Pre-Build Review §2**
(the two conflict reconciliations); Part C records build-session decisions as they are made. Per-task
evidence lives in the local-only `BUILD_LOG.md`.

Changing a **Part A** decision triggers the Build Contract §3 architecture-change protocol.

---

## Part A — Frozen design decisions (Master Spec §89, v2.0 design; pre-build)

### Carried from v1.0 (still in force)

1. **Grounded hybrid planner** (LLM orchestrates tools; deterministic engine computes) over a free-form LLM — accuracy + security + evaluability.
2. **LLM emits no geography / no side effects** — the core anti-hallucination invariant.
3. **Self-hosted Valhalla** over hosted routing APIs — cost control + capabilities (costing, map-match, isochrone, TSP).
4. **Supabase + RLS for most CRUD/spatial** — minimal hand-secured endpoints.
5. **Custom backend only for server-side secrets/logic** (Fastify + raw Anthropic SDK + hand-built loop) — transparency over a heavy agent framework.
6. **Road network in Valhalla tiles, not Postgres** — keeps Postgres small.
7. **Curvy-via-waypoint-selection**, not router internals — robust, engine-agnostic.
8. **React Native + Expo + TypeScript**, iOS-primary — one codebase, end-to-end types.
9. **Mapbox** for rendering + a custom style.
10. **Anonymous browse + plan; auth-gated contribute** — the evaluator runs the hero flow with no login wall.
11. **Eval set as a CI gate** — route quality can't silently regress.
12. **No LLM fine-tuning** — grounded base model + tools suffices.
13. **No vanity engagement metrics** — honesty over fabricated traction.
14. **Safe-driving pillar** — no speed/timing/racing, ever.
15. **Western Golden Horseshoe / Niagara launch region** — roads the owner knows; scenic + curvy; avoids Toronto core.

### New / changed in v2.0

16. **Runtime AI is pay-as-you-go API, separate from the Max plan; build-time AI is the Max plan.** Funds + caps the runtime ($30 hard cap + kill switch). *Why:* the Max subscription does not include API access (**fact**).
17. **Small always-on VPS is the default routing/agent host; hosted Valhalla is the emergency fallback; Railway only for prototyping.** *Why:* an always-on Valhalla holding tiles in RAM is cheaper/steadier at fixed VPS pricing than usage-billed Railway (**fact**).
18. **In-app follow-mode is the primary nav; external hand-off is best-effort.** *Why:* Apple Maps URLs carry no waypoints; Google's are capped — a loop can't be handed off faithfully (**fact**).
19. **Three-tier constraint hierarchy; "hard" = never violated without disclosure; hard→soft fallback is disclosed.** *Why:* Valhalla hard exclusion can yield no route; v1.0 self-contradicted.
20. **Scenicness is an honest, labeled grounded heuristic — never asserted as objective; only curviness is truly computed.** *Why:* "scenic" can't be ground-truthed; honesty is a strength.
21. **Eval uses human gold constraint labels (parse accuracy + satisfaction-vs-gold), with adversarial briefs + a diversity metric.** *Why:* measuring against the model's own parse is circular.
22. **Candidate generation is AOP-aware: isochrone scope + directional-sector circuits + overlap-based diversification.** *Why:* avoids out-and-back and near-duplicate candidates; scenic routing is NP-hard.
23. **Likes deferred; favourite/fork/save/share cover the value.** *Why:* likes add counting/abuse/moderation/UI cost without core benefit.
24. **Conversational refinement + reasoning view + public eval page promoted into MVP core.** *Why:* clearest proof Roadopia is an AI product, and feasible under AI-assisted build.
25. **Auto-title/summary/tags + user-adjustable weights (presets + advanced sliders) in MVP; no learning claimed.** *Why:* cheap, visible, ties to the scoring story; honest about no ML.
26. **Per-target favourite tables (real FKs) instead of polymorphic likes/favourites.** *Why:* enables the promised cascade deletes.
27. **Least-privilege `SECURITY DEFINER` planner read path over public/OSM data only.** *Why:* the open planner must never exfiltrate private rows.
28. **Record-a-drive is foreground-only (wake-lock); no background-location permission.** *Why:* avoids Android background-location review; matches mounted-phone use.
29. **Custom dev build required from day one; EAS Update OTA is JS-only.** *Why:* `@rnmapbox/maps` can't run in Expo Go.
30. **Moderation + image-EXIF-strip floor ships in MVP.** *Why:* UGC is live before the store; a takedown path + metadata stripping are the floor.
31. **Nightly pg_dump→object-storage backups + quarterly restore drill.** *Why:* the Supabase free tier has no managed backups.
32. **Region is a replaceable `.poly`/GeoJSON (`REGION_ID`/`REGION_POLY_PATH`); a volume/RAM/cost spike gates the architecture.** *Why:* portability + prove free-tier-fit before committing.
33. **Latency budget + parallel routing + warm tiles; report p50/p90/p99 + timeout rate.** *Why:* interactive feel needs an explicit tail strategy.
34. **Honest cost model (~$10–22/mo small scale, $30 AI cap), correcting v1.0's "$10–30 total."** *Why:* always-on routing + real inference cost money.
35. **Learned personalization rejected for V2.** *Why:* needs data maturity + careful evaluation; explicit weights instead.

---

## Part B — Conflict reconciliations (Pre-Build Review §2, 2026-06-18)

**R1 — The LLM's role in selection & correction.** Reconciled to the newest doc (experimental protocol):
build the **deterministic pipeline first**; LLM **selection (B)** and **correction (C)** are **gated
upgrades decided in M4** ([GATE-R]/[GATE-F]), behind a flag, default off — *not* baked into the MVP loop.
The **AI MVP boundary = parse + explanation + auto-title/summary/tags** (+ deterministic refinement
merge). *Why:* the newest explicitly-approved decision wins; defers two of the four LLM touchpoints to
evidence. Not a blocker.

**R2 — Scenicness as a numeric score.** Reconciled: the scenic *signal* is a **gated, optional** scoring
term, **labels/signals only by default**; numeric scenic weighting ships **only if [GATE-S] passes**.
*Why:* scenicness can't be ground-truthed. Not a blocker.

*Verification-driven required edits (folded into the backlog, not conflicts): Mapbox Nav-SDK prohibition;
Supabase Data-API grants + Storage-object cleanup on delete; cap mechanism = app-side accounting +
prepaid-credit/workspace backstop + kill switch; public-roads claim softened to "biases, not guarantees";
Apple unified-Maps-URL; Valhalla hard-exclusion warn-and-ignore detail; `optimized_route` ≥4 pts; eval
cost discipline.*

---

## Part C — Build-session decisions (toolchain + implementation)

Decisions made during the build — deviations from, or gaps filled in, the docs. None touch a Part A
decision or a hard rule. "Revisit when" marks a watch item tied to an external trigger.

**BD-1 — Node engine `>=22` (2026-06-24, M0-T01 → corrected M0-T09).** Root `engines.node` is `>=22`;
local + Docker image + CI all run Node 24. *Why:* **pnpm 11.8 fails on Node 20** (`ERR_UNKNOWN_BUILTIN_MODULE`,
found building the M0-T09 image). This **supersedes** the 2026-06-18 owner decision of `>=20` (whose
premise — "no concrete dependency pins above Node 20" — is now false). Consistent with Dependency
Verification §5 ("Node 20 LTS+"). **Owner-ratified 2026-06-24.** *Revisit:* none for the floor; one
watch-item — confirm **Expo SDK 55 tooling on Node 24** at SPK-01 (Expo supports Node 22 for certain; if
24 ever bites, run the app tooling on Node 22 — still ≥ floor, isolated to `app/`).

**BD-2 — `zod` pinned to v4 (`^4.4.3`) (2026-06-24, M0-T02).** *Why:* the docs name zod but pin no
version; v4 is current GA and our code is its primary consumer. *Revisit:* if a runtime dep ever requires
a zod v3 peer (low odds; isolated to `shared`).

**BD-3 — TypeScript pinned to 5.x (`^5.9.3`); `@shared/*` via `paths` without `baseUrl` (2026-06-24,
M0-T03).** *Why:* the registry-latest TS 6.0 makes `baseUrl` a hard error and isn't yet supported by
`typescript-eslint` / Expo; 5.x is the ecosystem-supported line. `paths`-without-`baseUrl` is
forward-compatible (works at TS 6/7). *Revisit:* pin to 6.x once `typescript-eslint` + Expo support it.

**BD-4 — ESLint pinned to 9.x; flat config (`eslint.config.mjs`), not `.eslintrc.cjs` (2026-06-24,
M0-T04).** *Why:* registry-latest ESLint 10 violates `eslint-plugin-import`'s peer range; eslintrc is no
longer ESLint's default (flat config is). RN-specific `app/` lint rules deferred to **SPK-01 / M7** (no
RN code exists yet). *Revisit:* ESLint 10 once `eslint-plugin-import` supports it.

**BD-5 — Vitest convention (2026-06-24, M0-T02/M0-T05).** Per-package `vitest.config.ts` re-export a
root base; the root base is a **plain object** (not `defineConfig`) to avoid a spurious
`UNRESOLVED_IMPORT 'vitest/config'` in the per-package config bundle. *Why:* the literal Verify is
`pnpm -r test` (per-package), which needs deterministically-scoped configs.

**BD-6 — Shared domain types layout (2026-06-24, M0-T06).** Geo primitives live in `route.ts` (no
separate `geo.ts`) to honor the 5-file `Files` list; an `index.ts` barrel was added (not in `Files`) so
`@shared/types` resolves. `CharacterTag` enum seeded from §94's examples + safe terrain/scenery
descriptors (extensible; strictly non-speed per Hard rule D). `GenerationEvent` shape designed from §27.3
+ FR-041 + Hard rule I (no chain-of-thought in the trace), as the spec names the concept but pins no
schema. `Weights` is an open record (pending the M3/M4 scoring freeze, [GATE-W]); `osm_way_id` is a
string (OSM ids exceed safe-int range).

**BD-7 — Git verification adapted to Hard rule G (2026-06-24, M0-T07/M0-T08).** The agent is denied
`git add`/`commit`/`push`, so commit-time/PR-time AC items are verified by their underlying gates: the
pre-commit hook's `lint-staged` + `tsc` gates were proven to reject a bad file directly; CI's commands
were proven green locally. The literal "bad commit blocked" and "PR green" are owner one-time checks.

**BD-8 — Docker dev Valhalla is a placeholder; esbuild build approved (2026-06-24, M0-T09).** The dev
`valhalla` service is a lightweight `alpine:3` keep-alive (the task is the "Valhalla *placeholder*"; no
tiles until M2; SPK-04 pins the real image, documented inline). `esbuild`'s build script is approved in
`pnpm-workspace.yaml` (`allowBuilds`) so tsx/esbuild work in the Linux image. Backend dev image is Node
24 (BD-1).

**BD-9 — Supabase migration layout (2026-06-24, M0-T10).** Migrations live at `db/supabase/migrations/`
(the CLI's standard layout) rather than the backlog's `db/migrations/`, so `supabase db reset` works;
config is at `db/supabase/config.toml` per spec. The CLI is run via `pnpm dlx supabase` (no global/dev
install). `0000_init.sql` enables PostGIS + pg_trgm (foundational infra; schema is M2/M8).

**BD-10 — Region: Western Golden Horseshoe / Niagara (carried, decision #15).** No build action yet; the
`.poly` lands in M2. (Listed for traceability when `REGION_POLY_PATH` is populated.)

**BD-11 — SPK-08 OSM road-class/POI filter (2026-06-24).** The extract keeps `highway = primary,
secondary, tertiary, unclassified, residential` (+ `_link`) and POIs `amenity=cafe,fuel,restaurant`,
`tourism=viewpoint`, `natural=peak`; it **drops motorway/trunk** (and service/parking/driveway/track/
path/footway). *Why:* the SPK-08 keep-list (Backlog) targets the **scenic/curvy dataset** that feeds
SPK-10 `curvy_segments` — dropping ~921 MB Ontario to a **5.4 MB** corridor extract with a sensible class
mix (verified: primary 4.2k / secondary 14.5k / tertiary 8.8k / residential 43k). **Finding / Revisit at
SPK-04:** the **Valhalla routing tiles** likely need a *broader* extract that re-includes **motorway/
trunk**, so highway-*avoidance* (the Tier-2 soft fallback, decision #19) has a connected network to fall
back onto; `extract.sh` is parameterized to add a `routing` variant. The region polygon is a provisional
bbox — M2-T01 replaces it with the proper `REGION_POLY_PATH`.

**BD-12 — `data/` became a workspace package (2026-06-24, SPK-10).** SPK-10's Backlog `Files`
(`data/curvature/compute.ts`) and `Verify` (`pnpm -C data test curvature`) require `data` to be a JS
package, so it was added to `pnpm-workspace.yaml` (members now app/backend/shared/eval/**data**) and the
CI test matrix. This **revises** the M0-T01 note that "`data` is intentionally NOT a workspace package."
*Why:* following the task's literal Files/Verify (the authority for what to build) beats the stale comment;
the OSM extracts/tiles `data` operates on stay gitignored, only the curvature **source** (`data/curvature/
*.ts`, `*.sh`) is tracked. No Part A decision or hard rule touched.

**BD-13 — SPK-10 curvature: candidate formula + parameters + findings (2026-06-24).** Built a deterministic
curvature engine (`data/curvature/`) computing two §12.2 candidates per way — **C2** heading-change/km and
**C7** length-weighted circumradius (1/km) — with §12.1 preprocessing (resample 20 m, min length 120 m,
max radius 1000 m, junction/`*_link`/roundabout exclusion, drop degenerate triples). Evaluated on a
**32-of-35-matched hand-label set** of known WGH/Niagara roads. **Results (real run):** both formulas rank
twisty>grid strongly — **Spearman ρ = 0.825 (C7) / 0.823 (C2)**, monotonic class means (grid 0.24 →
gentle 1.22 → curvy 1.71 → twisty 2.64 on C7); candidate **`THETA_CURVY` ≈ 0.60 1/km** gives **grid-FP
6.3 %** at **83 % twisty recall** (sweep shows θ 0.6–0.9 all ≤ 10 % FP). PostGIS `curvy_segments` (29,474
rows) = **11.4 MB total** (8.4 MB table + 2.7 MB indexes); `find_curvy_roads` (5 km, θ=0.6) **p90 159 ms**
(≪ 1 s). **All four AC PASS.** *Status:* **not frozen** — C2 vs C7 (both pass; C2 is simpler/cheaper, C7
truer to physical corner radius), `THETA_CURVY`, `turn_threshold` and resample spacing are **finalised at
M4 [GATE-C]**. **Findings/Revisit at M2/M4:** (a) the `find_curvy_roads` `::geography` cast bypasses the
GiST index (per-row distance after the curvature filter) — still 159 ms, but **M2-T08 should add a
geometry-bbox prefilter** to use the index; (b) 3 labels unmatched (Creek Road / Westbrook Road / Guelph
Line — name/centroid drift > 5 km) and the **hand-label set is from cartographic knowledge, not driven
ground truth** — **M4 must rebuild it with verified labels** before freezing; (c) 44,295 of 73,769 ways
were skipped (< 120 m / junction) — the table stores the 29 k scorable ways, a curvature floor can shrink
it further if needed.

**BD-14 — SPK-04: VPS size committed = CX23 4 GB, Falkenstein; Valhalla fits trivially (2026-07-05).**
S0 completed by the owner (2026-07-05): Hetzner **CX23** (2 vCPU / 4 GB / 40 GB, **Falkenstein eu-central**,
~$7/mo) — an owner cost decision replacing the docs' conservative CX32/8 GB guess, endorsed because the VPS
only *serves* (tiles build in seconds) and the EU location is immaterial next to the 15–25 s generation
budget (planner calls are backend-side; revisit only if that premise changes). **SPK-04 measurements
validate it:** routing extract (BD-11 keep-list: + motorway/trunk/links/living_street) = **5.5 MB /
76,940 ways**; tile build **9 s**; tiles **19 MB**; serving peak RSS **118 MiB** vs the 2,289 MiB 60%-of-box
AC limit (~5% used); `/route` **p95 30 ms** (100/100 ok), `/isochrone` 50–128 ms, `/trace_route` 37–98 ms —
all on-box. This satisfies the Dependency Verification's own "downsize only if RAM ≪ budget" rule.
*Deviations:* (a) tiles built from the **routing** extract, not the scenic-filtered one — that is BD-11
executed as designed (highway-avoidance needs the full drivable network); (b) the routing extract was
derived **on the VPS** (local Docker was down) using the same pinned container + filter as
`data/extract-routing.sh` — deterministic either way. *Posture:* Valhalla bound to **127.0.0.1 only**
(nothing public; backend colocates at M12); config is the generated default — **M2-T03 pins it and adds
`allow_hard_exclusions: true`** (spec §45/§28). *Fallback if ever tight:* 2-click resize to CX33/CX43.

**BD-15 — VPS 4 GB swapfile for batch clip jobs (2026-07-05, M2-T02).** `osmium extract
--strategy complete_ways` on the full 922 MB Ontario input was **OOM-killed on the bare 4 GB CX23**
(the clip's node index exceeds 3.7 GiB); added a persistent **4 GB swapfile** (`/swapfile`, fstab) and the
clip completes. This affects **batch acquisition only** — Valhalla *serving* stays at 118 MiB RSS with zero
swap pressure, so BD-14's box commitment stands. The dev machine also runs the clip fine natively (SPK-08).
*Process note:* run-1's failure was initially masked by piping to `tail` (exit code of the pipe tail);
remote verify commands now run under `set -o pipefail`.

**BD-16 — Valhalla pinned (v3.7.0 by digest) + `allow_hard_exclusions: true` + SPK-06 semantics
finding (2026-07-05, M2-T03).** The Valhalla image is pinned by digest
(`ghcr.io/valhalla/valhalla@sha256:8aebd555…` = **3.7.0-7e1ddb194**) in `data/build_tiles.sh` and
`infra/docker-compose.dev.yml`; the canonical **pinned config** is `infra/valhalla/valhalla.json`
(generated 3.7.0 defaults + **`allow_hard_exclusions: true`**, tile_dir `/data/tiles`, tile_extract
disabled) — `build_tiles.sh` uses a shipped config as-is and only generates one as bootstrap fallback.
Local dev serves tiles from a **bind mount** `data/valhalla/` (gitignored) on `127.0.0.1:8002`; the VPS
runs the same pinned config (synced + restarted). **SPK-06 (verification spike) settled with a
doc-deviating finding:** on 3.7.0, `exclude_highways` is **honored even with the flag false** (identical
compliant routes on both boxes: Hamilton→St. Catharines 38.3 min *with* highway default → 56.8 min
*without*, `has_highway:false`, no warnings) — the documented "warn-and-ignore when disabled" branch does
not manifest for this option. Posture: keep the flag **true** (harmless, explicit), and **M2-T04 keeps the
mandatory result-scan caveat** (verify returned road classes; never trust request flags blindly — spec
§11/§28). The "impossible exclusion → no-route" case wasn't force-constructed (dense corridor); M3's
relaxation-ladder tests exercise no-route handling naturally.

**BD-17 — SPK-15 iteration findings + planner parameter changes (2026-07-05, IN PROGRESS).** Six
instrumented runs of the loop-quality report (15 fixed briefs, real stack). Trajectory: **1/15 → 2/15 →
3/15 → 0/15 (regression, reverted) → 3/15 (current best)**; mean presented 1.1→2.7; mean duration error
33 %→23 %; ~280 ms/brief wall. **Parameter/design changes shipped:** (a) **duration-sized cluster
choice** — clusters ranked by weight × fit to `d* = T*·v/LOOP_LENGTH_FACTOR` (v=55 km/h, factor 2.4;
biggest durErr win); (b) **two-tier self-overlap** — 0.15 stays the soft scoring/validation line, assembly
hard-rejects only > 0.30 (`SELF_OVERLAP_HARD_REJECT`) — 0.15-as-hard-filter killed legitimate circuits;
(c) **origin-grace 2.5 km** in `selfOverlapRatio` — funnel-topology towns (Grimsby) force approach-road
reuse on every real loop; repeats near the origin are exempt, doubling back FAR from home still counts;
(d) return anchors = segment-first (widened to sectors ≥2 away) with synthetic bearing-point fallback —
**synthetic-ONLY was tried and REGRESSED** (returns left the curvy band, curviness −25 %; reverted).
**Open problems (the spike's remaining 2 days):** (1) **band-topology retrace** — where all curvy roads
form one band (escarpment), out/return legs collapse onto the same road; candidate ideas: parallel-road
return biasing via a second lower-θ retrieval for anchors, Valhalla `exclude_polygons` on the outbound
corridor, or multi-cluster chaining; (2) **presented < K_PRESENT (mean 2.7 vs 4)** — same-cluster
variants dedup to one; needs more distinct clusters per Ω (raise K_CLUSTERS, chain 2 clusters/loop) or
accept K_PRESENT=3 (an M4 [GATE] question); (3) durErr tail (49–79 %) on band briefs where the only
curvy cluster sits at a fixed distance. All tunables remain candidates — M4 freezes.

**BD-18 — SPK-15 sitting 2: the cul-de-sac diagnosis + 10/15 (2026-07-05).** Street-sequence inspection
of real routes found the TRUE root cause (not band topology): **waypoints were Valhalla `break`
locations landing on residential crescents** — the engine drove in, "arrived", U-turned and drove out;
every waypoint was a retrace spur (the best-shaped, most-curvy candidates were being generated and then
destroyed by spur artifacts). **Fixes shipped:** (a) middle waypoints are now **`type: 'through'`**
(pass-through, no stop/U-turn) in `routeThrough` — used by loop + A→B assembly; (b) **waypoint material
excludes residential fragments** (clustering + the anchor-point query) — residential still scores, it
just isn't steered through; (c) generation restructured to **three rounds** (one candidate per cluster →
cluster PAIRS in nearby sectors → return-sector variants) so distinct corridors survive dedup; (d) return
anchors from an **any-curviness anchor-point pool** (`retrieveAnchorPoints`, θ=0, non-residential) with
synthetic bearing-point fallback; (e) K_CLUSTERS 6→**8**, N_CANDIDATES 10→**14**; (f) the report's
ladder-assist now fires on **distinct-kept < K** and **merges** passes (replacing regressed).
**Result: 10/15 PASS** (trajectory 1→2→3→7→8→10), mean presented 3.8, mean durErr 19 %, ~575 ms/brief.
Remaining fails: Welland/Fonthill miss the meanSelf 0.15 bar by ≤0.01 (a §91 measure-and-set calibration
question — NOT bent mid-experiment), Pelham 0.19, Burlington kept=3/0.21, **Grimsby pathological**
(sparse non-residential mesh; 2 kept). **Verdict deferred to the [HUMAN] drivability inspection** (the
AC's subjective half; §20): `eval/spk15-routes.geojson` (regenerable artifact) → geojson.io. All 158
repo tests green throughout.

**BD-19 — REGION EXPANDED to south-central-ontario (OWNER-DIRECTED, 2026-07-06).** The owner's
drivability review requested Georgetown/Caledon/Erin/Bolton/Newmarket/Stouffville/Port Perry/Oshawa/
Cobourg/Peterborough — this supersedes the frozen WGH/Niagara scope (decision #15/BD-10; an owner scope
decision, not an agent one). New polygon `data/regions/south-central-ontario.poly` (bbox −80.45…−78.00 ×
42.80…44.40 — Niagara→Kawarthas incl. the GTA, Forks of the Credit and Hockley). **Rebuilt end-to-end
from the same canonical snapshot** (source md5 `1b781b…`): filtered extract 5.4→**19 MB / 222,194 ways**;
Valhalla tiles 19→**58 MB** (VPS build 28 s; probe re-run: `/route` p95 **33 ms**, serving RSS **174
MiB** — SPK-04 conclusions hold at 3× region); elevation 149→**223 MB** (both boxes); `curvy_segments`
29,499→**91,404 rows / 35 MB** (ρ=0.825 / θ=0.60 / grid-FP 6.3 % all UNCHANGED — the curvature engine
generalises); POIs 1,009→**4,281**; +2 northern seed drives (Forks of the Credit Run, Hockley Valley
Road); gazetteer +~30 towns (Toronto/GTA/Durham now IN-region; only genuinely-outside cities redirect —
stale Toronto fixtures updated). **Owner-feedback quality fixes shipped in the same round:** (a)
`search_filter.min_road_class=unclassified` on middle waypoints (no more neighbourhood dips at the snap
level); (b) duration prefilter ±50 % + report gating (mean durErr 23→**19 %**, best sitting 11 %);
(c) `MAX_TAU_S` 115 min clamp (Valhalla rejects isochrones > 120 min — a 3 h brief's widened τ crashed
at 129 min; found + fixed live); (d) report hardened: per-brief progress lines + per-brief try/catch
(the crash had been silently killing earlier runs behind output buffering). **Tried + reverted:**
budget-keyed return anchors (curviness −35 %). **State: 7/24 briefs pass** — northern escarpment country
PASSES (Georgetown/Caledon/Bolton); flat farmland (Port Perry/Peterborough/Cobourg, curv 0.5–0.6)
structurally cannot yield 4 distinct twisty loops → **M4 question: density-aware K_PRESENT or an honest
"limited twisty roads here" disclosure**; dense-core Hamilton keeps only off-duration candidates (all
>±50 %) → duration-vs-K tension is THE remaining calibration axis, with the 0.15 meanSelf bar.

**BD-20 — Owner round 2: drive-the-road generation + region v3 (2026-07-06).** Owner findings:
occasional timings off · routes too square/not fun · dead-end/U-turn-ish entries + one-block spins ·
same-street there-and-back · over-reliance on main roads vs country roads · more towns (Stouffville,
Barrie, Guelph, Kitchener, Brantford, Cayuga, Milton, Georgetown, Mississauga, Brampton, Caledon,
Orangeville). **Root cause found: CENTROID waypoints** — the centroid of a curved road lies OFF the
roadway (bad snaps → block-spins) and routing "through a centroid" never forces driving the curvy road
(fastest-path arterials between centroids = square). **Shipped:** (a) waypoints are now REAL segment
endpoint VERTICES with both-ends traversal forcing for segments ≥1.5 km (short spurs force turn-backs);
anchor points via `ST_PointN(geom,1)` (on-road); (b) `search_filter.min_road_class=unclassified` +
`through` middles (round-1) keep neighbourhoods un-snappable; (c) **U-turn two-tier**: hard-reject ≥2,
single scored down (uturn weight 0.05→0.1) — zero-tolerance was tried and starved the pool (3/33);
(d) **country-road bias** `use_highways 0.6` on loop connectors — 0.3 was tried and over-corrected
(every loop funnelled the same escarpment corridors → canonical redirect; reverted to 0.6);
(e) adaptive sizing speed 42 km/h for no-highway briefs (was 55 — clusters landed too far, loops ran
1.6–3× target); (f) **region v3**: bbox −80.80…−78.00 × 42.80…44.60 (Kitchener/Waterloo were 0.04°
outside; Barrie headroom) — extract **22 MB / 249,958 ways**, tiles **66 MB both boxes** (VPS p95
30 ms / RSS 177 MiB — SPK-04 STILL holds), curvy_segments **105,991 / 40 MB** (ρ stable), POIs
**4,607**, gazetteer +7 (Cayuga/K-W/Dunnville/Paris/Elora/Fergus), briefs → **33** covering every
owner-named town. *Ops note:* a stale-tile hazard was caught by ground-truth probing (local build had
silently used the v2 routing extract; Kitchener "routed" via edge-snap — explicit per-step rebuild
fixed it; lesson: verify tile inputs by md5/size, not by a route returning). **State: 6/33 composite**
(razor misses incl. Mississauga at meanSelf 0.153 vs 0.15); per-route quality axes (on-road waypoints,
forced curvy traversal, ≤1 u-turn, duration-gated best) all structurally improved — **owner geojson
verdict pending; the composite-K calibration formally moves to M4** (density-aware K_PRESENT, 0.15 bar,
duration-vs-K trade).
