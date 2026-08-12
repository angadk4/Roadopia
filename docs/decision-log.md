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

**BD-21 — Owner round 3: corpus purity + duration control (2026-07-06).** Owner findings: a
"90-minute" route that reads 3 h+ · neighbourhood circles · highway exit-and-re-enter · same-road
reuse acceptable only "when completely necessary" · still main-road/highway loops (wants small curvy
country roads) · loops confined to cities (wants the surroundings and everything between). **Probes
before fixes (3 live investigations):** (a) **corpus:** residential is 66 % of `curvy_segments` and
**98 % of the top-500** by `circum_curvature_per_km` (short suburban crescents max a per-km metric;
median residential 2.26 vs tertiary 0.37) — rank-then-limit retrieval therefore returned ~2 % real
roads in any dense Ω. This is the COMMON ROOT of all three feedback rounds (neighbourhood dips =
crescent waypoints; main-road loops = the ~6 surviving real segments were arterial sweepers;
city-hugging = urban crescents dominated clustering). No ramps/links/service exist in the corpus (the
extract already drops them). (b) **geojson forensics:** features carried NO routed duration/distance —
the "3 h listed as 90 min" route is real: Hamilton's 245 min / 241 km best (durErr 173 %), shipped by
the never-empty duration-prefilter fallback, invisible because only the brief title was displayed.
(c) **live Valhalla 3.7 probes:** `use_highways` is STEP-LIKE — 1.0/0.6/0.4 route byte-identically
onto the 401 and the flip sits between 0.4 and 0.3, so round 2's "0.6 country bias" was a verified
NO-OP; `top_speed` REJECTED as an alternative (probed: +25 % reported-duration distortion on an
unchanged path, plus pathological exit/re-enter artifacts). **Shipped:** (1) migration **0004** —
`find_curvy_roads` gains `p_exclude_highway`, filtered INSIDE the RPC before rank/limit (client-side
post-limit filtering starves dense rings); retrieval + anchor pool exclude residential/service/
living_street/track/motorway/trunk/*_link (Hamilton top-300: ~98 % residential → 128 tertiary /
78 secondary / 67 unclassified / 27 primary). (2) `countryClassFactor` (unclassified 1.0 · tertiary
0.95 · secondary 0.6 · primary 0.25) scales every segment/cluster ranking — township roads outrank
arterial sweepers; the residential sparse-pool fallback readmission is REMOVED. (3) Loop connectors
`use_highways 0.25` (the probed flip side; round 2's funnelling fear at 0.3 was a scarcity artifact
of the polluted corpus — with hundreds of rural corridors there is no single-corridor collapse).
(4) **Duration control — the decisive generator insight: RANKING ≠ CONTROL.** The old weight×fit
product could not steer durations (round 1 emits one candidate per cluster regardless of rank, and
cluster weights are heavy-tailed, so a monster far cluster at fit 0.05 still won; 36-brief medians
sat at ~2× target with sizing changes doing nothing). Now: HARD cluster plausibility filter
(predicted duration LLF·d/v within ±50 % of target; floor = 3 best-fitting for material-poor areas)
+ `LOOP_LENGTH_FACTOR` re-fit 2.4→**4.8** (traversal forcing + country connectors ≈ 2× the driving
per unit cluster distance; measured ratios 1.4–2.9, mean ≈ 2.0) + ONE resize retry when the routed
median still misses by >25 % (regenerate at miss-scaled sizing speed, clamp floor 15) + the duration
prefilter fallback now keeps ONLY the single closest candidate (a wrong-length pool can never ship
again) + **durErr ≤ 25 % added to the SPK-15 eval AC** (the ladder's relaxed tolerance). (5) Overlap
pressure raised for "same road twice at all costs": default weight 0.15→**0.25**, preset floors ≥0.2
(hard caps unchanged: 0.30 assembly reject, 0.15 soft bar — M4 [GATE-L] finalises). (6) Honest
geojson: per-feature `name` = brief + routed min + km, `routed_min`/`distance_km`/`target_min`/
signed durErr properties, green-PASS/red-FAIL strokes. (7) Briefs → **36** (+Creemore, Belfountain,
St. Jacobs rural origins; gazetteer +2). **Result: 17/36 composite on the STRICTER AC** (prior round:
6/33 without the duration criterion; trail this round 6/36 purity-only → 17/36 with the hard filter),
mean presented 3.4, mean durErr 19 %, 940 ms/brief, **168/168 tests** (+10). Remaining fails, all
named for M4: meanSelf 0.16–0.20 vs the 0.15 bar (razor), kept 2–3 in flat farmland (density-aware
K_PRESENT / honest disclosure), 45–60 min briefs' narrow duration bands, **Grimsby monster** (+119 %,
escarpment mesh under country costing), **Cobourg kept-0** (lakeshore grid: every candidate
self_overlap > 0.3 — whether to relax-with-disclosure in flat areas is an M4 design question, not a
silent bend). Migration 0004 applied to the LOCAL stack; the remote/prod project picks it up at its
first `supabase db push`.

**BD-22 — Owner round 4: u-turn presentation aversion, deeper country bias, region v4 coverage circle
(2026-07-06).** Owner findings on the round-3 geojson: still occasional enter-road/U-turn/return
instances · balance further toward small country roads · loops still city-centred, want
out-and-back-to-the-surroundings · some routes "extremely square" · and a map with a circled area:
"make sure the app can generate routes anywhere within this circle." **Shipped:** (1) **U-turns —
the settled design after a measured retry.** Assembly-level zero tolerance was retried (owner's third
flag) and starved pools AGAIN (8/36; Dundas/Grimsby/Peterborough/Cobourg → kept 0; the extra
traversal forcing raises benign single-u-turn incidence, compounding). Settled: assembly keeps the
two-tier reject (≥2), and the PRESENTATION layer is strictly u-turn-averse —
`UTURN_PRESENT_PENALTY = 10` subtracted from the presentation key ranks ANY u-turn route below EVERY
clean route in diversify + best-pick (run.ts + eval), and the SPK-15 AC now requires a
**u-turn-free presented best**. Single-u-turn routes remain last-resort pool material, never
preferred content. (2) **Country bias deepened:** `countryClassFactor` secondary 0.6→0.5, primary
0.25→0.15; connector `use_highways` 0.25→0.2 (cosmetic — the probed step function treats both
identically; recorded to match intent). (3) **Out-of-city:** the cluster duration-plausibility band
is now ASYMMETRIC [0.75, 1.5]·T — near-town clusters are dropped harder than far ones, so loops must
leave town for their material. (4) **Anti-square:** end-to-end traversal forcing extended — threshold
1.5→1.2 km and the SECOND-best road is traversed end-to-end too, but BUDGET-SCALED (≥75 min briefs
only: on 45–60 min loops the extra traversal blew durations +31…+38 %, measured and reverted for
short briefs). (5) **Region v4 (owner-directed scope change, like BD-19/20):** the owner's circle
extends past the v3 bbox in the NW (Owen Sound/Meaford/Beaver Valley/Collingwood) and east of
Peterborough (Trent Hills). New bbox **−81.10…−77.60 × 42.75…44.95** in the same poly file. Rebuilt
everywhere from canonical inputs: extract **275,377 ways / 24 MB**; tiles **73 MB local / 75.8 MB
VPS** (VPS build 34 s, serving RSS **78 MiB** — SPK-04 untouched at 4× the original region);
elevation **372 MB / 15 SRTM tiles** both boxes; `curvy_segments` **120,348 rows / 62,814 km**;
spots **4,778**. Ground truth (stale-tile lesson applied): Collingwood→Owen Sound routes at an
IDENTICAL **63.615 km on both boxes**; Campbellford→Peterborough 52.484 km; Hamilton→Guelph
regression clean; fresh tileset timestamps verified; NW/E curvy-corpus probes return 179/85
non-residential rows. Gazetteer +9 towns; briefs → **40** (Collingwood/Owen Sound/Orillia/
Campbellford corner briefs). *Ops notes:* (a) Windows Docker bind-mount races broke
`valhalla_build_elevation -p 4` locally — worked around by downloading into the container overlay FS
then copying out; script deliberately unchanged (Linux/VPS unaffected); (b) the VPS Ontario snapshot
is a NEWER Geofabrik date than the local canonical (clip md5s differ, sizes Δ0.13 %) — harmless for
routing tiles, but reproducibility stays anchored to the local manifest'd snapshot; refresh both
together at the next deliberate snapshot bump. **State: composite 9/40** — read with the AC
trajectory in mind: 17/36 (round-3 AC) → 11/36 (same code+data, AC gained u-turn-free-best) → 9/40
(4 hard new-corner briefs added). Per-route qualities the owner actually asked for all moved:
u-turn-free bests wherever a clean candidate exists, arterial share down, out-of-town clusters,
richer curvy traversal on ≥90 min briefs. Remaining fail causes (M4 calibration/design, named):
meanSelf 0.16–0.23 vs the 0.15 bar; kept 2–3 in thin/flat/peninsula towns (Cobourg + Campbellford
kept-0 — lakeshore/river funnel topology sends every candidate over the 0.3 self-overlap cap;
flat-area relax-with-disclosure design); short-brief duration razors; Grimsby monster.

**BD-23 — Owner round 5: spur eradication + twistiness (2026-07-06).** Owner findings: still spotting
"quickly entering a road and spinning right back" (neighbourhoods, roundabouts, ramp-like in-outs) ·
"more twisty curvy roads, more fun." **Mechanism found for the spins:** TIP-FORCING — traversal
waypoints sat on the literal first/last vertex of the curvy road; when the natural connector leaves
the road 100–300 m before its tip, the route drives to the tip and doubles back. **Shipped:**
(1) **Inset traversal spans** — long-segment waypoints moved to the vertices nearest 12 %/88 % of
cumulative length (`TRAVERSAL_INSET`); the twisty middle is still fully driven, the ends flex to
natural junctions. (2) **Spur detector** (`spurEvents`, overlap.ts): counts micro-retrace excursions
on a deliberately FINE grid (20 m resample / 40 m cells — a true spur reuses the same roadway =
identical cells, while switchback hairpin legs sit 40–100 m apart = different cells = NOT flagged;
synthetic tests pin spur=1 / hairpin=0 / rectangle=0 / origin-grace). Wired with the SAME two-tier
shape as u-turns: assembly rejects ≥2, presentation ranks ANY spur or u-turn below every clean route
(shared lexicographic penalty), and the SPK-15 AC now requires a **spur-free AND u-turn-free
presented best**. (3) Twistiness: default weights cur 0.30→**0.35**, stop 0.15→**0.10** (required
stops stay hard-validated). **Tried + REVERTED (both recorded by measurement):** (a) MID-VERTEX
touch points for short segments and anchors — caused the exact retraces they aimed to prevent
(forcing a road's interior when its through-path passes the tips = in-and-back; pools collapsed
19→2, composite 4/40); tips restored for single touches, insets kept for full spans; (b) chaining a
THIRD member on ≥90 min budgets — over-constrained paths, self-overlap rejections spiked, clean
survivors were −48 % undershoots; M4 candidate with pool-health guards. **Result: 7/40 on the
SEVEN-criterion AC** (trail this round: 4/40 all-changes → 3/40 partial-revert → 7/40 final; the
pre-round baseline 9/40 had NO spur criterion). Fail rows are back to the named M4 razors — no new
pathology; mean durErr 20 %, 883 ms/brief. **174/174 tests** (+6: spur synthetics incl. the
hairpin-false-positive guard, inset-not-tip waypoint pin).

**BD-24 — Owner round 6: retrace-run metric, block-spin window, time accuracy — and the
hard-cap-vs-presentation lesson made permanent (2026-07-06).** Owner findings: still occasional
neighbourhood block spins · "routes overlap — enter an area on a road … come back to the origin area
on the SAME road, boring" · "increase time accuracy even more." **The metric blind spot named:** the
self-overlap RATIO cannot see contiguity — 5 doubled km on an 80 km loop is 6 %, under every cap,
yet exactly the boring drive described. **Shipped:** (1) `maxRetraceRunM` — longest contiguous
doubled-travel run in route-metres (immediate there-and-back counts both passes; separated doubling
counts each pass ≈ road length; synthetics pin both semantics + origin-grace); (2) spur windows
SPLIT: NARROW (≈400 m, round-5-proven) stays the ASSEMBLY gate; WIDE (≈1 km, catches full-block
neighbourhood spins — in on X, around the block ~600–800 m, out on X) is PRESENTATION/AC only;
(3) time accuracy: duration prefilter ±50 %→±35 % and the resize retry runs up to TWO attempts, each
judged on the LATEST batch (mean durErr 21 %→**18 %**, the best yet); (4) presentation "dirty" now =
any u-turn OR wide-window spur OR retrace-run > 1,200 m — such routes rank below every clean route;
AC adds **retrace ≤ 1,200 m** on the presented best (eight criteria total); geojson features carry
`retrace_m`. **The measured lesson (now a design rule):** round 6 FIRST tried the retrace cap
(3 km) and the wide spur window as ASSEMBLY rejections → **0/40, 687 retrace + 575 spur rejections,
mean presented 1.6** — shared origin corridors beyond the 2.5 km grace are NECESSARY doubling in
funnel-topology towns; an assembly gate cannot distinguish necessary from lazy, the presentation
ranking can. Quality preferences belong at PRESENTATION (rank dirty below clean, never starve the
pool); assembly rejects only unambiguous junk. This is the third time the pattern reproduced
(u-turns round 2/4, spurs round 5→6, retrace round 6) — recorded as the standing shape for M4.
**State: 3/40 on the EIGHT-criterion AC**; presented-best distribution measured: retrace ≤ 1,200 m
on 23/38 bests, 8 bests fully clean (0 m); tail = Caledon 7.2 km / Campbellford 5.5 km /
Georgetown 4.6 km / Peterborough 4.1 km — towns where NO clean candidate exists in the pool, i.e.
a GENERATION-diversity question (return-corridor variety), the top M4 item alongside the calibration
razors. **178/178 tests** (+4: retrace semantics ×2, block-spin window split, grace).

**BD-25 — SPK-15 PASSED (owner verdict, 2026-07-06): the deterministic planner generates the
product.** Six owner drivability rounds (BD-17…BD-24) took the loop generator from 1/15 to a machine
whose presented routes are class-filtered country roads, duration-sized (mean err 18 %), and clean
of u-turns/spurs/doublings wherever a clean candidate exists — with every owner complaint now a
MEASURED metric in the 40-brief harness (durErr, uturns, spurs, retrace_m, self-overlap, pairwise
distinctness). Owner verdict after inspecting the labelled geojson across six rounds: routes
structurally right — "time to move on"; rounds committed (43f983c), CI green. SPK-15 closes
**PASSED with tunables**; the composite (3/40 on the eight-criterion AC) is explicitly a CALIBRATION
number, not a launch gate — every threshold in it is a candidate constant. **Handoff to M4, in
priority order:** (1) return-corridor generation diversity (the Caledon 7.2 km retrace tail — towns
where NO clean pool candidate exists); (2) calibrate the razors on DEV/VAL (0.15 meanSelf, ±25 %
duration band, retrace 1,200 m, density-aware K_PRESENT for flat farmland, TAU_OVERLAP, θ,
LOOP_LENGTH_FACTOR, resize clamps); (3) the Grimsby/Cobourg pathologies (escarpment mesh; lakeshore
funnel → relax-with-disclosure design); (4) richer traversal chaining with pool-health guards;
(5) driven ground-truth labels replacing the cartographic set (BD-13 obligation). Standing design
rule proven three times across the rounds: quality preferences rank at PRESENTATION; assembly
rejects only unambiguous junk. M1's blocking chain is now fully green (SPK-08/04/10/15);
SPK-09/SPK-19 + SPK-01/03 ride later milestones per plan.

**BD-26 — [GATE-C] DECIDED: numeric fun-scoring NOT adopted; C7 + θ=0.6 FROZEN in the retrieval
role (M4-T06, 2026-07-11).** Ground truth: the owner's 40-road driven rating sheet (1–5, zero
blanks — replaces SPK-10's cartographic labels per BD-13). Pre-registered before computation:
pass iff Spearman ρ ≥ 0.70 AND grid-FP ≤ 0.15; simplest passing formula wins; nothing passes ⇒
no numeric fun score. Result: C2 ρ=.396 · C4 .404 · C7 .398 · **C7×L .511 (best)** · log C7
.398 · composite C8 .404 — **no formula clears the bar**; per the rule, road-level numeric
fun-scoring is NOT adopted (no user-facing twisty/fun score; labels/signals only — Hard rule C
posture). **The retrieval role is validated instead: 10/10 owner-fun roads (rating ≥4) surface
at θ=0.6, all with traversal-eligible ≥1.2 km segments** → **FROZEN: formula C7
(circum_curvature_per_km) + THETA_CURVY = 0.6** — confirming the values already in code
(no code delta; M3-T05's dependency resolved). Honest positive: the best single predictor of
owner fun (C7×length, ρ .511) is exactly the generator's cluster-ranking key (BD-21) —
the ranking design is validated by driven ground truth. Honest negative (eval page): per-km
density ranks urban squiggles above flowing rural roads; road-level fun needs context —
future work, never a shipped score. Report: eval/reports/curvature.md. **Owner-ratified 2026-07-11** ("Ratified, and you can continue").

**BD-27 — M4-T03 second-labeler pass DONE: agreement measured, 2 gold defects fixed
(2026-07-11).** Owner labeled 13/67 DEV+VAL (~19 %) blind. Agreement: duration 13/13 · stops
11/13 · STATED avoid rules 13/13 · dispositions 10/13 · avoid flags overall 40/52 — every miss
is ONE systematic prior ("no highways/paved only" implicitly assumed on ~70 % of briefs), which
ADJUDICATES to text-grounded parsing and VALIDATES the routing defaults (country bias +
class-filtered retrieval already honor the prior). Gold amended by adjudication: dev-018
(great_road stops → twisty/backroad character) and dev-033 ("on backroads" → avoid.highways
true + backroads preset); reqset-v1 changelog updated; require-gold validation still 0 errors.
Product notes (M7 UX): owner wants more clarifying questions than §3.5 permits, and expects
current-location defaulting instead of the no-origin clarify. κ not computed (prose sheet;
per-dimension table published as the honest equivalent — limitation recorded). Report:
eval/reports/labeler-agreement.md. LLM-spend for T08/T11 ACK'd by owner ("ok to spend some
money in testing") — est. $5–15, Batch+cached, tracked separately from the $30 production cap.

**BD-28 — [GATE-A] DECIDED: ADOPT the LLM parser for M5-T03 (M4-T11, 2026-07-11;
owner-ratified 2026-07-11).** First real-LLM experiment, run through the new COST-GUARDED client
(Hard rule F: Haiku-only allowlist, per-call output cap, hard $2 budget with pre-call worst-case
projection, full ledger; 4 unit tests). Variant: claude-haiku-4-5, temperature 0, structured
outputs (§3.4 JSON schema), gazetteer post-resolution so the LLM EMITS NO GEOGRAPHY (Hard rule A —
place-name strings only, resolved by the same deterministic lookup the rules parser uses), zod
validation incl. §3.5 cross-field rules, one retry, N=3 repeats. Pre-registered rule (in the
script header before computation): adopt iff VAL parse_accuracy ≥ rules AND VAL
clarification_appropriateness ≥ rules AND ADV disposition_accuracy ≥ rules. **Result: all three
cleared** — VAL accuracy 0.916 vs 0.852 · VAL clarification 0.500 vs 0.125 · ADV disposition 0.961
vs 0.882 (the LLM catches unsafe/injection/out-of-region BETTER than the rules). Stability: 6/84
briefs flipped a key field across repeats (~7 %, reported per §24); invalid outputs 7/259 calls,
all recovered by the single retry or nulled honestly; mean latency ~2.5 s (well inside the 25 s
budget). **Cost: $0.9128 total** (259 calls; ledger in the §22 manifest
eval/runs/gate-a-parse-ablation/manifest.json) — tracked separately from the $30 production cap;
Batch deferred to recurring runs (M4-T14) per §26. Decision: **M5-T03 builds the Haiku parser as
primary with the rules parser as the deterministic fallback** (schema is parser-agnostic; the
fallback also serves cost-kill-switch mode). Report: eval/reports/parse-ablation.md.

**BD-29 — [GATE-F] DECIDED: KEEP the deterministic correction stack; LLM repair NOT adopted
(M4-T09, 2026-07-11; owner ratification pending).** Pre-registered in the script header before
any result (τ_fix = 10 pp): adopt F4 (Haiku maps the failure summary to a bounded move,
deterministic executes) only if efficacy ≥ deterministic + 10 pp AND no new-violation rise AND
within latency. Seeds: 9 first-pass failures from 31 runnable DEV briefs (§16). **Result:
identical efficacy 11 % vs 11 % (all three repeats), new violations 0 % both, F4 5.4× slower
(5 488 ms vs 1 025 ms)** → two criteria failed → default F1 (deterministic repair) + F2
(generate-more) + F5 (relaxation/best-so-far) stands; M5-T08 LLM correction is NOT built.
Substantive finding: 8/9 seeds are unrepairable by ANY move in the set — the binding failure is
duration-vs-tolerance (0.10), which is M4-T12 calibration evidence (§21 DURATION_TOLERANCE "set
to the band where most feasible routes land"), not a correction-strategy gap. Stability: 0/9
move-sequence flips; invalid outputs 0/75. Cost $0.0589. Report: eval/reports/correction.md +
manifest eval/runs/gate-f-correction/.

**BD-30 — [GATE-W] DECIDED: W1 (presets only) for the MVP; sliders deferred, PRESET_WEIGHTS
frozen (M4-T10, 2026-07-11; owner ratification pending).** Pre-registered rule: ship W2
(presets + clamped sliders) only if sliders are direction-correct AND clamp ranges exist AND
defaults are stable AND presets are in character. On 6 fixed (brief, origin) pairs — one per
archetype, sweeps re-finalizing a FIXED pool (weights touch scoring only): **presets passed
6/6 on every dominant-axis check → PRESET_WEIGHTS (M3-T10 vectors) are FROZEN as-is**; but
slider responsiveness was UNMEASURABLE (4/6 pools hold only 1-2 candidates — nothing to
re-rank; ρ undefined), no clamp window cleared the degeneracy bar at the default point, and
defaults missed the ±25 % stability bar on 2 briefs (e.g. 85 min for a 60 ask). → **W1
presets-only ships; sliders are a post-MVP revisit** requiring a fatter pool (N_CANDIDATES ↑ =
new config id + fresh VAL pass per §21). The failures are duration-control findings (same root
as BD-29), not weight-machinery findings — recorded honestly per §24. Cost $0. Report:
eval/reports/weights.md + manifest eval/runs/gate-w-weights/.

**BD-31 — [GATE-R] DECIDED: KEEP R1 + R6 (deterministic top-1 + LLM explanation only); LLM
selection NOT adopted (M4-T08, 2026-07-11; owner ratification pending).** Completed by the
owner's blind pairwise sheet (4 pairs, §20.1: randomized A/B, provenance sealed until after
judging). Result: R4 preferred 2/3 non-tie (67 % — above the 60 % point bar) but the Wilson
95 % lower bound is 21 % ≪ the pre-registered >50 % requirement → criterion 1 failed → default
stands. The other criteria had cleared (gold satisfaction TIED 1.000/1.000; latency 2 546 ms;
cost $0.0035/selection; agreement 50 % < 90 % floor). Honesty notes recorded: (a) at n=3
non-tie judgments even 3/3 could not clear Wilson >50 % — the small disagreement sample
structurally favoured the default, exactly the §24 "practical > statistical" design (no
evidence ≠ evidence against); (b) Sonnet's 50 % flip rate across identical reruns is
independent §24 instability evidence AGAINST adoption. M5-T08 (LLM selection/correction) is
NOT built — with BD-29 this closes both halves of Pre-Build R1's gated question. Revisit only
with a larger VAL disagreement sample (new config id). Cost $0.0961 total.
Report: eval/reports/ranking.md + sealed-then-unsealed key in eval/runs/gate-r-ranking/.

**BD-32 — [GATE-S] DECIDED: labels/signals only (S0/S1); numeric scenic scoring NOT adopted;
scenic weight stays 0 (M4-T07, 2026-07-11; owner ratification pending).** Pre-registered
before any correlation: a numeric scenic term ships only if a cumulative variant reaches
ρ ≥ 0.70 vs the owner's scenic ordinal (the BD-26 bar for numeric terms). Ground truth: the
owner's 40-road SCENIC sheet (all 40 rated, 40/40 matched in corpus). Data built for the test:
scenic_features table (osmium re-filter of the clipped extract → 77 028 water + 111 768
forest features, PostGIS-loaded via data/load_scenic.ts). **Result: best variant S6
(viewpoints + water + forest − urban-density) ρ = 0.538 < 0.70 → no variant ships.** Ladder:
S2 tags+viewpoints −0.008 · S3 +water 0.288 · S4 +forest 0.371 · S6 −urban 0.538 · S7 +class
0.462 (class awareness HURTS). Singles: water 0.300, urban(−) 0.300, forest 0.234, viewpoints
≈0 (402 spots too sparse), class −0.074. Findings: ZERO scenic=yes ways exist in the whole
region (S1 is no-data in Ontario); S5 elevation excluded (no DEM; spec §32 keeps elevation
display-only). Ships instead: scenic spots/labels SHOWN + concrete grounded facts in
explanations ("passes 2 viewpoints, ~6 km along water") — §13.3 language rules binding; no
numeric scenic score exists anywhere (Hard rule C). The protocol's [H] hypothesis is now
measured fact. Cost $0. Report: eval/reports/scenic.md.

**BD-33 — M4-T12: PLANNER PARAMETERS FROZEN as config `frozen-m4t12-v1` (2026-07-11; owner
sign-off = RG-M4, pending).** §21 discipline: swept on 10 stratified DEV briefs
(one-factor-at-a-time, pre-registered winner rules in eval/experiments/calibrate.ts), winner
validated on 16 VAL briefs, frozen; any later change = new config id + fresh VAL pass.
**Changes: ALPHA_LOOP 0.55 → 0.45 · N_SECTORS 8 → 4 · DURATION_TOLERANCE 0.10 → 0.20**
(p80 of the frozen config's |dur err| across DEV+VAL — the §21 "band where most feasible
routes land"; the old 0.10 bar failed routes the planner measurably cannot hit, per BD-29).
TAU_OVERLAP stays 0.6 (pool-reuse sweep: no value strictly better). Base speed stays 55/42
(sweep: no improvement). All other params confirmed at current values; detour_max DEFERRED to
M6 (A→B not built); full 25-param table with provenance in eval/params-frozen.json.
**VAL evidence:** med |dur err| 17.0 % → 14.0 %, mean feasible 2.1 → 2.7, feasibility held
94 %. **40-brief composite: 3/40 → 9/40**; mean duration error 14 %; presented bests clean
(u-turn/spur-free) throughout; mean wall 664 ms. Honest residuals: the dominant remaining AC
miss is kept ≥ 4 (alternate-count, a presentation-richness bar — not best-route quality);
sparse-geography towns (Cobourg/Orillia/Campbellford) still miss duration badly (thin road
material — resize cannot conjure roads; candidate improvement, not a param). 3 candidate
mechanism tests re-pinned to nSectors: 8 fixtures (assertions unchanged — they test L3/L4
sector logic, not the default). Report: eval/reports/params.md + §22 manifest.

**BD-34 — Round 7: residential-exposure gate shipped; config frozen-m4t12-v2 (2026-07-11;
owner ratification pending — this WAS the owner's named RG-M4 blocker).** Owner: neighbourhood
streets "shouldn't be there at all in any route". Root cause: retrieval + waypoints already
exclude residential (BD-21, min_road_class snap filter), but the CONNECTING legs Valhalla
routes between waypoints carried no class constraint and nothing measured them. Verified
against Valhalla 3.7 source: **no `use_residential` / per-class auto costing knob exists**
(and unknown costing keys are SILENTLY ignored — probed), so the fix is exact MEASUREMENT:
every otherwise-accepted candidate is traced (`/trace_attributes`, per-edge road_class,
partial-edge trimmed) and its residential share outside the 2.5 km origin grace computed
(backend/src/valhalla/trace.ts + backend/src/planner/residential.ts, 5 pure tests + live
test). **Two-tier per the 3×-proven rule:** > 20 % rejects at assembly (unambiguous junk);
> 5 % ranks below every clean route at presentation AND fails the eval AC (null trace =
unknown ≠ clean); fail-OPEN at assembly so a trace hiccup cannot starve pools.
`use_living_streets` pinned 0. **maneuver_penalty swept {5,15,30} under a pre-registered
rule: kept at engine-default 5** — 30 cut exposure but cost 5.3 % curviness (> the 5 % bar),
15 gained nothing; the measurement gate alone carries the round. Evidence: presented-candidate
mean residential share 2.1–2.6 % (DEV/VAL), 11–14 % of candidates demoted; 40-brief run shows
live `residential×N` assembly rejections and res % on every feature (geojson `res_pct`);
composite HELD 9/40 despite the added stricter bar. Honest residuals: 5 pool-scarce towns
(Pelham/Ancaster/Owen Sound/Orillia/Campbellford) present a least-bad 10–17 % route because
no clean alternative exists — correct best-so-far behaviour, honestly failed by the AC;
generation-side work, post-MVP. detour-free A→B measurement lands at M6.
Report: eval/reports/residential.md + params-frozen.json v2.

**BD-35 — Round 8: micro-loop (crescent/block-spin) detector shipped; middle waypoints STAY
'through' after a losing A/B; config frozen-m4t12-v3 (2026-07-11; owner ratification
pending).** Owner reported the St. Jacobs PASS route "spinning a crescent". Root cause: a
small CLOSED CIRCUIT is invisible to every prior detector — no doubled travel (not a
spur/retrace), no u-turn maneuver ('through' waypoints forbid u-turns, so Valhalla circles a
block to reverse heading), ~1 % residential share on a long loop. Shipped
`microloopEvents` (overlap.ts): closed cycles with closure < 30 m, length 150 m–3 km,
enclosed area > 3 000 m², origin-grace exempt — thresholds validated on the live corpus
(roundabouts under the floor, switchbacks never close, scenic sub-circuits over the cap);
6 unit tests. Two-tier per the proven rule: assembly rejects ≥ 2, presentation demotes ≥ 1,
AC requires 0 on the presented best. Prototype found the class in **18/40 routes incl. 4
PASSes** — the St. Jacobs offender at (43.4269, −80.5527) among them; after wiring, St.
Jacobs presents a µloop-free best. **'via' A/B (pre-registered rule): REJECTED** — it does
swap circles for u-turns (µloop μ .43→.17) but u-turn rejections starve pools (kept 14→6,
briefs-with-clean 3/8→1/8, med|err| 5.3→15.9 %) → 'through' stays. Honest residuals:
composite 9/40 → **6/40 under the strictly harder bar**; 16/40 bests still carry one spin
because their pools hold NO clean candidate — a GENERATION artifact (waypoint tips needing
heading reversal). Follow-up identified, not built: a deterministic F1-style repair move
"drop/shift the waypoint nearest a detected micro-loop" — post-RG-M4 unit. Report:
eval/reports (rq8 console record in BUILD_LOG); params-frozen.json v3.

**BD-36 — Round 8b: contiguous-residential-RUN cap; config frozen-m4t12-v4 (2026-07-11; owner
ratification pending).** Owner caught the Bolton PASS route weaving a subdivision at
(43.7818, −79.4477). Diagnosis on the live geometry: ~1.3 km CONTIGUOUS residential drive
(trace sequence s×10 → r×3 · u(300 m) · r×8 → s) that hid at 4 % share on a 101 km route —
**the share cap scales with route length; the offence does not** (the round-6 ratio-vs-run
lesson, now applied to road class). Not a closed circuit (micro-loop silent), not doubled
travel (spur silent). Shipped `maxResidentialRunM` (residential.ts): longest contiguous
residential run outside the origin grace, bridging non-residential connectors ≤ 250 m
(a blip inside a subdivision never "leaves the neighbourhood"); computed from the SAME trace
edges as the share — zero extra engine calls; 4 unit tests. **RESIDENTIAL_RUN_SOFT_M = 500 m**
— presentation-dirty + AC only, NO assembly rejection (mirrors retraceRunM; the 20 % share
hard cap handles egregious cases). Result: Bolton best now measured at RUN 2 081 m → dirty +
AC-failed; St. Jacobs 499 m (borderline-clean, honest). Corpus: **20/40 presented bests
exceed the run cap** — the weave is systemic and pools rarely hold a clean alternative;
composite 6/40 → **4/40 under the again-harder bar**; 12/40 bests fully clean on every
owner axis (spin + share + run + u-turn + spur). This CONFIRMS the priority of the identified
generation-side unit (BD-35): deterministic repair moves that re-route around detected
residential runs / micro-loops — the detectors now exist to drive them. Report: geojson
`res_run_m` per feature; params-frozen.json v4. Tests 212 green.

**BD-37 — Round 9: detect-and-repair pass shipped (drop the waypoint nearest the offence);
config frozen-m4t12-v5 (2026-07-12; owner ratification pending).** The owner-approved unit
closing the loop on rounds 7–8b: the detectors LOCALIZE offences now (microloopPositions —
refined to the tightest closure so a lollipop stem cannot mis-aim it; maxResidentialRunInfo
returns the run midpoint), and `assembleLoopWithRepair` acts on them — when an assembled
candidate carries a micro-loop or an over-cap residential run, DROP the waypoint nearest the
offence and re-route (≤ 2 passes; best-of selection where accepted beats rejected and the
smaller offence wins ties toward the original; spot-anchored candidates skipped — which
waypoint is the requested stop is not recoverable, dropping it would silently lose the stop;
candidates at 2 waypoints skipped — dropping to 1 makes an out-and-back). Wired at ALL
assembly sites (run.ts production, eval pipeline, loop_quality). **40-brief evidence:
fully-clean bests 12 → 17 · spin-carrying bests 16 → 8 (halved) · over-run-cap bests 20 → 16
· composite 4 → 8 · Orillia flipped from 11 % residential / −53 % duration to 0 % / +19 %.**
Honest residuals now have NAMED causes: (a) 2-waypoint candidates are un-drop-repairable —
a SHIFT-repair variant is the identified follow-up (Bolton's case); (b) structurally
residential-bound stretches (Kilbride 10.1 km run, Owen Sound 8.5 km, Campbellford 7.9 km —
region/data reality, not planner behaviour). Wall cost ≈ +0.8 s mean per brief (1 737 ms).
+7 tests (134 backend). Report: geojson per-feature + BUILD_LOG table.

**BD-38 — Region v5: west-to-London expansion (owner round 10, 2026-07-12; owner ratification
pending).** Owner: "extend out to London too and cover all cities in between… routes anywhere
within the circle." Poly bbox −81.10→**−81.85** W (London, Stratford, the Huron shore to
Goderich/Grand Bend) and 42.75→**42.55** S (Port Stanley / the Erie shore); N/E edges
unchanged. Full data-tier rebuild on the same pinned Ontario snapshot: filtered ways
275 377 → **303 432** · curvy_segments 120 348 → **133 865** (51 MB) · POIs 4 778 → **5 040** ·
scenic_features 188 796 → **228 499** · routing extract 315 936 ways → Valhalla tiles 73 →
**81 MB** (build 201 s, peak RSS 253 MiB — comfortably VPS-sized). Probes: London routes on
its own Dundas St; Goderich→Bayfield routes. Gazetteer +22 towns IN (incl. every requested
in-between: Woodstock/Ingersoll/Stratford/St. Marys/Tillsonburg/Delhi/Simcoe/Port Dover/
Strathroy/Exeter/…); London+Stratford REMOVED from the out-of-region set (Sarnia/Chatham
added as the western redirects); LLM parse prompt updated to match. **Gold amendment:**
adv-008 ("loop from London") redirect_out_of_region → proceed — invalidated by the region
change, not mislabeled; changelog appended; 2 test fixtures updated to Sarnia (assertions
unchanged). 8 west briefs added to the 48-brief harness: ALL 8 route on day one — **London
PASSES the full composite outright**, Delhi passes, the rest fail only familiar
alternate-count/duration bars with clean bests (res 0–1 %, spin-free). Composite 10/48.
Found+fixed at v5 scale: Math.max spread overflow past ~124 k rows (build-table) and THREE
stale-intermediate traps in the rebuild chain (roads.geojsonl / pois.geojsonl / tiles'
routing extract — each regenerates from the fresh clip now, recorded in BUILD_LOG).
**Deploy note ([HUMAN] later): the VPS still serves v4 tiles — rebuild there before any
external link.** Config unchanged (frozen-m4t12-v5; params are geography-independent);
extract-manifest.json carries the v5 provenance.

**BD-39 — Round 11: backroads priority — scoring lever DISPROVEN, arterial-INSERT repair
shipped; config frozen-m4t12-v6 (2026-07-12; owner ratification pending).** Owner: "prioritize
fun back roads whenever possible… aware of and able to access all the back roads." Baseline
measured first (trace-based class composition of all 48 bests): mean countryness 0.51 raw /
0.424 normalized, **zero majority-backroad routes**, worst best = Hamilton at 65 % primary —
waypoints anchor on country roads (BD-21) but Valhalla's connectors ride arterials (no class
knob below motorway/trunk exists, round-7 recon). Two levers tried under pre-registered rules:
**(1) `country` scoring term** (length-weighted BD-26 class factor over the traced route,
zero extra engine calls) — rq11 pool-reuse sweep DISPROVED re-ranking: candidates within a
pool differ by ~0.007 (every candidate rides the same arterials; the pool, not the ranking,
is the blind spot) and w>0 also cost durErr 5.3→11.9 % → **w_country = 0 stands; the term
ships as MEASUREMENT** (report/geojson `country` per route). **(2) INSERT repair move**
(round-9 pattern aimed at boredom): longest contiguous ARTERIAL run (motorway/trunk/primary/
secondary, 250 m bridged, origin-graced; generalized maxClassRunInfo) > 4 km triggers
inserting a waypoint on the highest-ranked reachable curvy segment (≤20 km from the run mid,
not shadowing existing waypoints, min-detour slot); kept ONLY if accepted, offences not
worse, duration ≤ ×1.25, and countryness gains ≥ INSERT_MIN_COUNTRY_GAIN. Debug probe found
the gain bar mis-calibrated: a single swap tops out ~+0.02…0.04, so 0.05 killed every healthy
insert (three clean Hamilton inserts discarded) while bad inserts (Woodstock route-doubling)
died on the OTHER guards → bar set 0.02 from the probe evidence. **Result: corpus mean
country 0.424 → 0.442, majority-country bests 12 → 13, composite 9/48 and durErr 14 % and
wall time HELD.** Honest ceiling named: post-hoc repair on 2–4-waypoint candidates swaps one
connector at a time; the structural lever is GENERATION density (more country clusters per
candidate — the previously-reverted 3rd-member direction, needing its own careful round).
Also fixed found-live: a silent regex-edit no-op re-ran a full 48-brief cycle on the old
constant before Edit-tool verification caught it. Report: eval/reports/backroads.md.

**BD-40 — Round 12: generation density (cluster triples) — HONEST NEGATIIVE; not adopted
(2026-07-12; owner-ordered experiment).** Triples implemented behind a flag (3 distinct-sector
country corridors per candidate, rich budgets ≥90 min, fill-order after singles+pairs;
makeCandidate generalized to an extra-cluster list). First A/B was VACUOUS — probed: post-
M4-T12 pools hold 3-4 clusters across ~2 of the 4 sectors, so the 3-sector spread constraint
never matched; relaxed to any-not-all-one-sector (assembly gates judge shapes). Second A/B:
triples GENERATE (3-4/pool) and ASSEMBLE (some kept) but NEVER outrank incumbents — DEV
metrics byte-identical → pre-registered rule refuses adoption; **tripleClusters stays false**
(machinery retained for post-MVP pool-shape work). Second measured negative for the density
hypothesis at current pool shapes.

**BD-41 — Round 13: SHIFT-preferred repair shipped; config frozen-m4t12-v7 (2026-07-12;
owner ratification pending).** RELOCATE replaces DELETE as the first repair move: on a
micro-loop / over-cap residential run, move the offending waypoint onto the best clean curvy
segment near the offence (same picker as INSERT, shadow-check excludes the moving waypoint);
kept only on STRICT offence improvement with the standard guards; DROP remains the fallback;
works on 2-waypoint candidates (the class DROP could never touch). Applies planner-wide —
every origin, all repair sites. **48-brief evidence: fully-clean bests 17 → 27/48 · composite
9 → 11/48 · over-run-cap 16 → 13 · Bolton (the owner's round-8b case) now PASSES outright
(run 0 m, res 0 %, spins 0, 100 min/90 ask) · country μ 0.442 → 0.449.** Wall 1 730 → 2 261 ms
(shift trials; within budget). 220 tests green.

**BD-42 — Round 14: timing undershoot diagnosed as FUNDAMENTAL, not a bug; duration-demotion
shipped as correct-ordering insurance; config frozen-m4t12-v8 (2026-07-12; owner ratification
pending).** Owner: "this timing issue is dumb and shouldn't be there." Two levers tested under
pre-registered rules; the diagnosis is the deliverable. **(1) widen-on-undershoot** (rq14 —
re-scope the retrieval isochrone wider when the resize retry is still short, hypothesis: ran
out of curvy material within the tight M4-T12 radius): **HONEST NEGATIVE** — DEV med|err|
14.0 % → 14.0 %, zero movement (flag retained, default off). The probe explained why: the
material isn't the bottleneck. **(2) Root cause, found by dumping presentKey per candidate:**
the on-target candidates ALREADY EXIST in the pool but carry quality flaws (u-turn / retrace
from being forced longer), so at presentation the clean-but-short loop correctly outranks the
on-target-but-flawed one (a clean −5 duration-penalised route beats a −10 quality-penalised
one). The planner is CORRECTLY refusing to show a u-turn to hit the clock — exactly the owner
standard from rounds 2–8. So the undershoot in road-sparse origins (Hamilton/Georgetown/
Kitchener/Mississauga/Belfountain/Grand Bend) is **fundamental: no clean route hits the
target time there.** **Shipped anyway: DURATION_PRESENT_PENALTY = 5** — a 2nd lexicographic
tier BELOW quality (clean+on 0 · clean+off −5 · dirty+on −10 · dirty+off −15) wired at all
three presentation sites (run.ts, pipeline, loop_quality), so wherever a clean on-target route
DOES exist it now beats a clean shorter one. Correct ordering, but **inert on the 48-brief
corpus** (no town currently has that exact case) — 8 undershoots >25 % unchanged, composite
11/48, fully-clean bests 27, honestly reported. **The real fixes are not more planner tuning:**
(a) the app discloses the honest time ("≈60 min") — an M5 UI decision; (b) more clean road
material (generation density / region) — measured hard (triples lost, BD-40). Named-but-not-
built lever: extend the repair pass to clean retraces/u-turns on on-target candidates (could
rescue some, but it's another round). Process note (§4): confirmed the fix's effect by dumping
presentKey values rather than trusting the kept-list order (an incomplete dirty-marker in the
first probe hid the u-turn/retrace flaws and nearly produced a wrong diagnosis).

**BD-43 — RG-M4: M4 CLOSED on frozen config frozen-m4t12-v8; single-use TEST numbers reported
honestly (2026-07-12; owner sign-off pending).** M4 exit criteria ALL met: curvature formula
(C7) + all planner params FROZEN (v8, eval/params-frozen.json); all six gates decided + logged
(BD-26 C · BD-28 A · BD-29 F · BD-30 W · BD-31 R · BD-32 S) + the quality rounds (BD-33–42);
eval CI gate live (M4-T14); M5 AI scope fixed (Haiku parse + Sonnet explain; NO LLM
select/correct; NO numeric scenic). **SINGLE-USE locked-TEST run (§25 Stage 8, config v8,
20 runnable loop briefs never seen in tuning): PERFECT 2/20 (10 %) · SHIPPABLE 7/20 (35 %) ·
CLEAN 8/20 (40 %) · median duration error 8 %.** Reported STRAIGHT, not spun: these are LOWER
than the DEV/48-brief figures (~23 % perfect / ~56 % clean) for two honest reasons — (1) the
normal tune-vs-held-out gap, and (2) the TEST split drew **13 of 20 origins on Owen Sound (×5)
/ Port Perry (×4) / Grimsby (×4)** — precisely the road-sparse towns documented as
fundamentally limited (BD-42: no clean route hits the time; multi-km residential is the only
material). Timing on TEST is actually GOOD (median 8 % err) — the misses are route-flaws +
menu-size in sparse geography, not the planner sizing. The honest portfolio story is the
METHODOLOGY (locked TEST, pre-registered gates, honest negatives at BD-40/42, disclosed
limits) + "≈40 % clean on a deliberately-hard held-out draw"; NOT a headline pass rate.
Per §6.4 the TEST split is now SPENT for v8 — not re-run to chase a number; a future config
gets its own TEST pass. Report: eval/reports/test-final.md + §22 manifest
eval/runs/m4-test-final/. **M4 CLOSED pending the owner's RG-M4 sign-off + BD-29–43
ratification.** Next milestone: M5 (the /plan service — endpoint + SSE progress + Haiku
parser + production cost guard).

**RG-M4 RATIFIED + SIGNED OFF (owner, 2026-07-12).** The owner ratified **BD-29 through BD-43**
(all six gate decisions C/A/F/W/R/S, the nine quality rounds, the param freeze, and the
single-use TEST close) and **signed off RG-M4**. Basis recorded by the owner: the decisions
are the conservative-default-unless-earned posture applied with measured evidence; ratifying
records "right on the evidence we had," NOT a permanent lock — every param is versioned
(v1→v8 already) and every gate is re-openable with new evidence (notably BD-31 LLM route
selection, parked on *insufficient* evidence at n=3, not a defeat: the selector + cost-guard +
blind-A/B harness already exist, so re-testing it once the app surfaces a real "I'd have
picked differently" moment is a focused experiment, not a rebuild). **M4 is CLOSED.** Milestone
gate satisfied: formula + params frozen · gates decided + logged · eval CI gate live · M5 AI
scope fixed. Next milestone: **M5 — the /plan service** (endpoint + SSE progress + Haiku parse
(BD-28) + Sonnet explanation (BD-31 default R6) + production cost guard; NO LLM select/correct,
NO numeric scenic). Open [HUMAN] items carried forward (not M5 dev blockers): production
spend-cap infra (prepaid credits + workspace limit + kill switch) before public LLM traffic;
VPS re-tile to region v5 before any external link.

**REOPEN REGISTER (post-M4, owner-requested tracking, 2026-07-12).** A ratified gate is a
decision on the evidence to date, NOT a permanent lock. These are explicitly flagged for
revisit so they are never treated as closed-forever:

- **BD-31 — LLM chooses the route** (owner-priority). Parked on *insufficient* evidence (blind
  pref 2/3 but Wilson CI could not clear at n=3), not a loss. **Everything to re-decide it
  already exists:** `eval/src/llm/select_llm.ts` (Sonnet fact-sheet selector, emits no
  geography), the cost-guarded client, and the blind-pairwise A/B harness
  (`eval/experiments/ranking.ts`). **Trigger:** once the app is real (M6/M7) and the owner
  hits an "I'd have picked a different route" moment. **Steps:** generate more route pairs →
  larger blind A/B (owner + 2–4 friends) → adopt R4 if it clears the margin → new config id.
  Safety unchanged: the LLM only ranks the deterministic planner's already-validated
  candidates (Hard rule A intact).
- **BD-30 — advanced weight sliders.** Deferred (unmeasurable on thin pools), not rejected;
  reopen when pools are richer or the owner wants finer control.
- **BD-32 — numeric scenic.** Reopen only with a data source that clears ρ ≥ 0.70 (current
  best 0.538) — e.g., a scenic tag layer that actually exists in-region.

Every planner PARAMETER (BD-33 freeze) is already trivially editable — v1→v8 proves it; a
change mints a new config id + fresh VAL pass (§21). Nothing here is a one-way door.

**BD-44 — M5 AI-layer build decisions (2026-07-13).** The M5 batch (T01–T07, T09; T08 closed)
shipped the production AI layer exactly on the ratified boundary (BD-28/29/31): **LLM = language
in, language out; zero geography; every call cost-guarded.** Decisions made in-build:
(1) **Prompt registry as single source** — `backend/src/ai/prompts/` holds every production
prompt as a versioned `PromptTemplate` (id + version + model pin + schema). The [GATE-A] winner
was ported VERBATIM from eval as `parse` v1; **eval now imports prompt/schema/model FROM the
registry** (M5-T09), so the CI smoke regression-tests the exact prompt that ships. Side effect,
deliberate: eval's model pin moved from alias `claude-haiku-4-5` to the production dated
snapshot `claude-haiku-4-5-20251001` — same model, dated for reproducibility. A prompt edit =
version bump in ONE place, caught by the live prompt gate (accuracy floor 0.80) if degraded.
(2) **Production cost guard** (`cost_guard.ts`): $20 soft (warn) / $30 hard (block) / $40
testing-override, kill switch checked BEFORE transport, per-call worst-case ceiling
(8k in/1.5k out), UTC-month projected-spend blocking, cache reads billed 0.1×. Ledger is a
`LedgerSink` seam — in-memory now, the FR-049 `ai_generation_requests` DB sink lands at M6
(recorded so it isn't forgotten). (3) **Grounded generation pattern** (T04/T05): LLM →
schema parse → `checkGrounded` against the run's real facts (novel proper noun / number ⇒
reject) → ONE retry naming the offenders → deterministic template composing the same facts.
Fallback ≠ failure: kill/cap/hallucination all degrade to honest templates (FR-261).
(4) **Refinement merge constants** (T06, RF6 rules per §17.1): bare longer/shorter step =
20 % of current target (min 10 min; base 60 min when none); soft-pref nudge ±0.2 clamped 0..1;
explicit-lift phrases ("highways are fine") are the ONLY hard-constraint removals; comparison
numbers computed in `compare.ts` (edge overlap via the frozen §9 grid method). Constants are
v1 product knobs, not gated science — tune freely with UI evidence at M7. (5) **M5-T08 CLOSED
"NOT ADOPTED"** per its own DoD: LLM selection/correction not built (BD-29 kept F1+F2+F5;
BD-31 parked R4 on insufficient evidence — see Reopen Register). No `select.ts`/`repair.ts`
in production; the eval-side selector remains available for the BD-31 re-test. (6) **CI
factuality gate added** (T09): the smoke now live-tests explanation + title/summary/tags
through the production client on pinned facts — template-fallback on a live run means the
model failed grounding twice ⇒ red. Live evidence 2026-07-13: parse 0.939, both generation
gates 'llm', spend $0.025 (caps $0.10 + $0.10).

**SPK-13 PASSED (2026-07-13, M6-T02).** Least-privilege planner read path built and leak-tested.
Migration 0005: `planner_find_curvy_roads` + `planner_find_spots` — SECURITY DEFINER, fixed
search_path, EXECUTE revoked from PUBLIC, granted to anon/authenticated/service_role;
`planner_find_spots` is scoped `WHERE source = 'osm'` IN THE SQL (spots carry no visibility
column yet — user rows are simply never selectable through this path, whatever M8 policies
say). Backend module `backend/src/db/planner_reads.ts` now owns every planner spatial read;
`retrieve.ts` delegates. **Measure (as the real `anon` role via `set role anon`, the exact
PostgREST mechanism): direct reads on routes/spots = 0 rows; INVOKER RPC = 0 rows; definer
fns return public/OSM rows and ZERO private rows; positive control confirms the corpus still
flows. 5/5 (`pnpm -C db test rls_planner`). Zero private leakage = PASS.**
**Perf lesson (BD-45.2, kept here for the security record):** SECURITY DEFINER prevents SQL
inlining; the first `language sql` version re-parsed the isochrone polygon PER ROW under a
generic plan — canonical planner run 1.9 s → 48 s. Fixed by `language plpgsql` folding the
geometry ONCE into a variable (measured back to 1.9 s, status ok). The planner e2e caught it;
a 5-vertex bench rectangle had NOT (real Ω polygons have hundreds of vertices) — perf checks
on spatial RPCs must use realistic geometry.

**SPK-14 PASSED (2026-07-13, M6-T05).** Anonymous rate limiting on /plan: in-house
sliding-window limiter (`backend/src/lib/rate_limit.ts`, zero new dependency), per-IP
6/min + 30/hour AND per-session 3/min (x-session-id), both enforced, 429 + Retry-After in
the consistent error shape. **Measure: abusive burst → 6/min pass, 7th blocked 429; demo
cadence (12 plans at ~90 s spacing) → 0 blocked; per-session binds tighter than per-IP
(4th same-session call 429 while a fresh session on the same IP passes). 5/5
(`pnpm -C backend test plan-guards`). Both halves of the §21 measure = PASS.** Numbers are
§91 "measured" tunables (ctor-injectable), not frozen; in-memory store is single-instance —
a shared store is needed only if the backend ever replicates (§64), recorded limitation.

**SPK-19 PASSED (2026-07-13, local-hardware caveat).** End-to-end /plan latency + cost
envelope over the REAL production path (live local Valhalla + Supabase + LIVE Haiku parse +
LIVE Sonnet explanation), n=12 briefs across the region (Hamilton/Guelph/Barrie/London/
K-W/Elora/St. Jacobs/Orangeville/Stratford/Port Dover/Caledon/Cobourg), sequential =
single-user interactive promise. **Measured: latency p50 9.1 s / p90 14.0 s / max 36.8 s;
cost p50 0.75¢ / max 1.16¢; 12/12 returned real routes; 12/12 parser=llm; total spend
$0.103. Bars (p50 < 15 s, p90 < 25 s, cost 1–3¢): PASS.** Caveats recorded: (a) dev-laptop
Valhalla, not the CX23 VPS — SPK-04 showed the VPS is faster, but re-measure at M12 deploy
before calling the production envelope final; (b) one max-tail run (36.8 s) exceeded the
25 s wall-clock and returned best-so-far honestly — the budget mechanism, not a violation;
(c) FR-264 session tool-cache (SHOULD) not built — the envelope passes without it; revisit
only if VPS numbers regress.

**BD-45 — M6 backend-vertical-slice build decisions (2026-07-13).** M6-T01…T06 complete;
/plan streams a real, capped, cancellable, gracefully-degrading generation over HTTP.
(1) **Zero new dependencies.** Supabase JWT verification is hand-built on `node:crypto`
(ES256/RS256 via the project JWKS with kid-rotation refetch, raw r||s `ieee-p1363`
signatures; optional HS256 legacy secret), the rate limiter is in-house, SSE is raw
`reply.raw` writes. Three §5 Dependency Requests avoided; consistent with §43's
"hand-built, transparent" posture. jose/supabase-js remain candidates for M8 if account
flows outgrow this. (2) **Definer-fn inlining lesson** — see SPK-13 entry. (3) **Kill
switch + cap semantics on /plan (FR-260..262):** kill switch → 503 `planner_disabled`
(planner never invoked, zero spend); month spend ≥ $30 → 503 `spend_cap_reached`; both
messages state what still works (§18). Logged-in reduced-quota rung lands with accounts
(M8). (4) **FR-049 ledger:** `ai_generation_requests` (migration 0006, §47.1 fields +
owner-only RLS + the deferred routes FK) written per generation — including failures —
with cost = the request's ledger delta; `DbMonthLedger` primes the month base from the
table at boot so cap accounting survives restarts (per-call rows stay in-memory: the guard
needs sums; per-generation cost is the persistent record, FR-263). (5) **Cancellation:**
disconnect watched on the SOCKET (IncomingMessage 'close' fires at body-consumed — a real
bug the cancel test caught); abort feeds `PlannerDeps.signal`, checked at every budget
seam, and explanation spend is skipped after abort. Verified: loop observes abort, zero
explain calls after cancel. (6) **Client-supplied origin clears the §3.5 no-origin clarify
case** (missing/clarification reconciled in the /plan merge; shape-contradiction clarify
survives). Found by the degrade test. (7) **Clarify travels as an `error` event +
`done:unavailable`** — the M0-T06 GenerationEvent union has no clarify member; adding one
at M7 is additive if the UI wants a distinct state. (8) **runPlanner grew `onEvent` +
`signal` seams** (buffered events array unchanged — additive). (9) **Trace discipline
test-enforced:** every SSE frame in every test is parsed through GenerationEventSchema —
an off-schema payload (or any raw-reasoning field) fails CI (Hard rule I). (10) Region
bounds now parse the real `.poly` (ray-cast, any polygon) — rule K coords validation on
/route, /match and /plan inputs. Suite: 286 tests green repo-wide.

**BD-46 — SPK-01 scaffold + mobile-stack version corrections (2026-07-13).** The Expo dev-build
spike's scaffold is built and locally verified (typecheck/lint/format/286 tests green;
expo-doctor 19/19; `expo config` resolves on Node 24). The device build is the remaining
[HUMAN] half (EAS cloud → iPhone; Android deferred until a device is on hand — the gate needs
both). Building the scaffold surfaced three dependency-FACT errors in Dependency Verification
§5/§122/§683 (reality contradicts the doc — a §4 report; NOT a design change, same library +
architecture, so proceeding with the corrected facts):
(1) **`@rnmapbox/maps` 11.20.1 does not exist.** npm's latest is **10.3.2** (no v11 at all).
The doc's "v10 deprecated → use v11" is inverted. **Corrected pin: 10.3.2**, which supports the
frozen stack (peer `react-native >=0.79`, `expo >=47`) and ships a Fabric `codegenConfig` →
**New-Architecture-capable**, so SPK-01's core assertion is still reachable. Recommend editing
§5/§122 to `@rnmapbox/maps 10.3.2 (native Mapbox Maps SDK v11)`.
(2) **The Mapbox download token IS required** (§683's "no longer required" is wrong): the native
SDK build fetches from Mapbox's private registry with the `sk.` DOWNLOADS:READ token. Wired as
`RNMapboxMapsDownloadToken` from the `MAPBOX_DOWNLOAD_TOKEN` EAS secret — build-time only, never
`EXPO_PUBLIC_`, never in the JS bundle (Hard rule H). The owner already holds this token (S0).
(3) **New Arch is implicit in SDK 55** — `newArchEnabled` was removed from `ExpoConfig` (its
absence IS the guarantee; the typecheck error confirmed it). And the MapLibre fallback's real
name is `@maplibre/maplibre-react-native` (the doc's `maplibre-react-native` 404s).
Also resolved in-build: React 19.2.0 / RN 0.83.6 / Expo 55.0.27 installed clean; a CJS eslint
block was added for metro/babel configs (the RN lint work BD-4 deferred to SPK-01); the pnpm
linker stays ISOLATED for now (root layout untouched, 286 tests safe) with `node-linker=hoisted`
documented as the EAS fallback if the cloud build hits symlink resolution. These corrections are
owner-ratifiable; none blocks the device build.

**SPK-01 iOS LEG PASSED (owner on real iPhone, 2026-07-16); Android leg OPEN.** EAS cloud
build (preview profile) installed and verified on the owner's physical iPhone: all seven
checks pass — native build under the New Architecture (the spike's core assertion), dark map
render, clustering, amber route line + distinct high-curvature overlay, dark/light contrast,
attribution, HUD. The full spike bar is BOTH devices; Android repeats when a device exists
(the APK build itself can run device-free anytime and would retire the Android BUILD risk).
Build-path corrections (all now in the repo): pnpm workspace switched to `nodeLinker: hoisted`
(pnpm-workspace.yaml — Expo autolinking requires a flat node_modules; isolated store broke
EAS with "Cannot find expo-modules-autolinking"; note: this pnpm reads linker config from the
workspace YAML, not .npmrc) — 286 tests + typecheck/lint/format re-verified green under the
hoisted layout; Node 24.16.0 pinned in eas.json build profiles (EAS image defaults to Node 20,
which pnpm 11.8 rejects — the SAME ERR_UNKNOWN_BUILTIN_MODULE failure recorded at M0-T09,
now fixed in a second environment); bundle id `com.angadk4.roadopia` (com.roadopia.app taken)
+ EAS projectId in app.config.ts; expo patch alignment via `expo install --fix` (doctor 19/19).
Owner feedback triaged into the record: route-line "doesn't follow roads" = the 8-point test
fixture (real Valhalla geometry at M7); lone-point "clusters" = correct Mapbox semantics;
slow launch + cluster smoothness = carried to SPK-02/M7 perf; rig UI quality (hit targets,
panel sizing/contrast) = recorded as the M7 UI acceptance bar. The rig screen is deleted at
M7-T01. Owner also completed en route: Apple Developer Program enrollment + Expo account +
device registration (S0-style [HUMAN] infrastructure, now durable).

**SPK-01 ANDROID BUILD RISK RETIRED (2026-07-16).** The device-free Android APK build ran on
EAS (preview profile, same hoisted-pnpm + Node 24 image as iOS) and **FINISHED clean** —
every native dep (@rnmapbox/maps 10.3.2 + Mapbox Maps SDK, expo-modules) compiles under the
New Architecture on Android too. Artifact: expo.dev APK (internal distribution, 2026-07-16).
SPK-01's remaining opening is now ONLY the on-device Android render check (needs hardware);
the "a native dep won't build under New Arch" failure mode is closed on BOTH platforms.
M7 proceeds iOS-first (owner-authorized batch, 2026-07-16) with the Android render check owed
before M7-T09 (the hero-flow gate needs both platforms).

**BD-47 — M7-T01 mobile client foundation choices (2026-07-16; the Dependency
Verification is SILENT on all four — builder's choice, logged for ratification).**
(1) **Navigation = React Navigation 7** (`@react-navigation/native` + `bottom-tabs`, with
`react-native-screens` + `react-native-safe-area-context` at Expo-SDK-55-matched versions via
`expo install`). The doc mandates the capability (§16 four bottom tabs; §20.4 deep links) but
names no library; React Navigation is the RN standard, New-Arch-compatible, and matches the
backlog's `app/src/nav/*` shape. expo-router rejected (file-based restructure, heavier, no
benefit at this scope). (2) **SSE transport = `expo/fetch`** — the WinterCG streaming fetch
inside the `expo` package, ZERO new dependency; Dep-Verification §14 calls for exactly a
fetch-stream shim and SPK-03 (device) remains the confirming gate, with `react-native-sse`
as the documented fallback ladder. The parser is a spec-compliant hand-rolled incremental
module, fully unit-tested (chunk splits mid-UTF-8-char, CRLF, multi-`data:`, `: ping`
heartbeats); every frame re-validates through the shared `GenerationEventSchema` — off-schema
frames are counted and never rendered (Hard rules I/K client-side). (3) **App testing stays
Vitest** (repo standard, M0-T05) + `react-test-renderer` with a minimal `react-native`
node-stub alias for component smoke — jest-expo rejected for now (a second runner + babel
stack for no current need); revisit if RN component-testing needs outgrow the stub.
(4) **Anonymous session id = per-launch in-memory UUID (Math.random)** for the `x-session-id`
rate-limit key — not persisted (no storage dep), not security-sensitive (per-IP limits bind
server-side regardless). Also: **EXPO_PUBLIC_API_URL** joins the client env (optional; dev
builds derive the backend URL from the Metro host so a phone on the LAN reaches
`pnpm -C backend dev` zero-config); `eslint-plugin-react-hooks` lands repo-side for `app/src`
(the BD-4 deferred RN lint — `rules-of-hooks` error, `exhaustive-deps` warn;
`eslint-plugin-react-native` skipped: flat-config support lags ESLint 9). The SPK-01 rig
screen is DELETED as recorded; `zod` added to app deps (it consumes `@shared/types`).

**BD-48 — M7-T02 map-home data path: the M8 PUBLIC-read slice pulled forward (2026-07-16).**
FR-010 (the never-empty anonymous map) reads through the sanctioned direct-Supabase path
(§49.1) — but routes/spots were still RLS-deny-by-default ("until M8"). Landed now in
**migration 0007**: SELECT policies exposing exactly the product's public rows —
`routes.visibility='public'`, `spots.source='osm'` — plus **map_routes()** (SECURITY INVOKER,
RLS-bound), which returns GeoJSON geometry (PostgREST serializes raw geometry columns as WKB
hex the app cannot render) and the SIMPLIFIED line per §44 egress discipline. **SPK-13's
invariant (zero private leakage) is preserved and re-verified**: rls_planner.test.ts's two
deny-by-default assertions were UPDATED to assert the real invariant (anon sees ONLY
public/OSM rows, never the seeded private fixtures) — a deliberate posture change, not a
weakened test — and the new rls_public_read.test.ts adds write-denial + private-invisibility
coverage (29 db tests green). LIVE verification over PostgREST with the anon key: map_routes
→ HTTP 200, 8 public seed routes, renderable LineString JSON; planner_find_spots → 1000 OSM
spots {lat,lng floats}. Client choices (with BD-47's silence rule): **no @supabase/supabase-js
yet** — two anonymous RPC reads need only a thin typed fetch over /rest/v1/rpc (zod-validated
rows, Hard rule K); the JS client earns its place at M8 auth. **Zero-config LAN dev**: the app
derives the local Supabase URL from the Metro host and pairs it with the supabase-cli DEMO
anon key (a public, docs-published constant — not a secret; used only when no hosted project
is configured via EXPO_PUBLIC_SUPABASE_URL/_ANON_KEY). Deviations noted for later: custom
Mapbox Studio style (§19) deferred — stock dark/light until a Studio style exists; spot
type-ICON sprites (FR-012 letter) deferred to polish — colour + letter markers now; tap-detail
is an interim sheet upgraded to the shared RouteDetail at M7-T05; hosted roadopia-dev is NOT
yet migrated/seeded (local stack is the M7 dev world — hosted push rides M8/M12). Ops note:
local Kong gateway wedged (connection-refused on its own :8000 despite healthy status) —
`docker restart supabase_kong_db` fixed it; recorded as a known local-stack hiccup.

**BD-49 — M7-T03 Plan screen shipped PRESETS-ONLY + the additive /plan `preset` field
(2026-07-16).** The backlog block's literal Files/AC ("advanced sliders (clamped)",
`Sliders.tsx`, "presets/sliders set weights") predates the ratified BD-30 ([GATE-W] W1
presets-only; sliders DEFERRED). Building sliders would violate Hard rule L, so the Plan
screen ships: brief (≤500, counter) · origin = current-location default (BD-27; expo-location
foreground-only) or drop-a-pin crosshair picker, with the §18 permission-denied → "drop a pin
instead" fallback · shape loop/A→B (+ destination pick) · the six preset chips (FR-350) —
recorded as a deliberate deviation from the stale task text, per the gate. **Preset
transport:** /plan's body had NO preset field and PRESET_WEIGHTS is backend-private, so the
chip now travels as an additive, schema-validated `preset` enum field resolved server-side
via weightsForPreset (frozen vectors never duplicated into the client; explicit `weights`
still win key-by-key at mergeWeights). Backend tests cover chip→constraints.preset and
unknown-preset 400 (plan-degrade 7/7). Place-name ORIGINS stay in the brief (the server
gazetteer resolves them; client-side Mapbox geocoding deferred — §49.3 cache design rides a
later milestone). Out-of-region stays server-authoritative (§46: the .poly never ships in
the app); the Plan flow renders the friendly 400 downstream. Screens keep lightweight prop
shapes bridged into React Navigation via typed adapters (node-smoke-testable without the
navigator).

**BD-50 — M7-T04 generation-progress UI + SPK-03 CODE HALF VERIFIED LIVE (2026-07-16).**
The streamed timeline shipped as a PURE reducer over GenerationEvents (started→completed row
collapse, per-iteration repeats, tool grounding rows with counts, friendly errors, guard
rejections, cancel, §14 backgrounding→clean-cancel+retry — every transition unit-tested) +
a Progress screen that auto-advances to Result on success (replace, so back returns to the
form). Cancel = AbortController → socket close → the server halts the loop AND model spend
(M6-proven). §18 states: 429/503/400 guard JSON rendered verbatim (server copy is already
friendly and names what still works); connection-lost and done:unavailable (incl. clarify
questions) rendered honestly; the timeline doubles as the M7-T06 reasoning-view source —
the wire schema has no channel for model reasoning and off-schema frames are dropped
client-side before the reducer (Hard rule I, both ends). **LIVE E2E over real HTTP** (the
app's actual plan_stream.ts + sse.ts + shared schema, node fetch injected — the same
structural streaming interface as expo/fetch): full run = 32 events, wall 8.9 s, parser=llm,
REAL 67.8 km / ≈75 min route + grounded explanation, done:ok, 0 malformed frames; cancel run
= aborted after 3 events, done:null/aborted:true. Committed as app/scripts/plan_stream_e2e.ts
(`pnpm -C app e2e:stream`) for re-verification. Device half of SPK-03 (incremental render on
hardware + backgrounding) rides the M7-T09 stop. Ops note: the dev backend is launched as
`npx tsx --env-file=../.env src/start.ts` from backend/ won't resolve REGION_POLY_PATH —
run from repo root with TSX_TSCONFIG_PATH=backend/tsconfig.json, or `pnpm -C backend dev`
once a dotenv preload lands; recorded for the M7-T09 handoff instructions.

**BD-51 — M7-T05 shared RouteDetail + constraints panel + the satisfied_constraints schema
tightening (2026-07-16).** One RouteDetail component serves Result/saved/shared (FR-074;
§16 cohesion rule 1): bounds-fitted amber route map (with attribution), honest stats — the
ROUTED time always shown as "≈N min" (BD-42 disclosure), twistiness (FR-070's curviness,
shown as the neutral retrieval metric — no fun-score, Hard rule C/[GATE-C]), climb,
result-scanned road flags shown ONLY when true (BD-16), character/intensity tags — the
constraints panel rendering the agent's ACTUAL ConstraintResult verdicts (✓ satisfied /
⚠ relaxed / ✕ violated with details; not_applicable hidden; FR-044 never fabricated),
done=relaxed and best_so_far banners with the §18 copy, the grounded explanation with
relaxed[] disclosures, and the FR-400 safe-driving disclaimer. NO dead buttons: save/share/
navigate arrive at M8/M9. **Schema tightening:** shared RouteSchema.satisfied_constraints
z.unknown() → z.array(ConstraintResultSchema) with the schema moved INTO shared (backend
validate.ts now imports/re-exports it — single source); the full backend suite (197 tests,
including every SSE frame parsed through GenerationEventSchema) passed against the deeper
validation, proving the real wire output conforms. Deferred + noted: per-segment twisty
overlay on the detail map (§19) needs segment scores the /plan payload doesn't carry;
spots-along-route rows (FR-073) need a stops list the payload doesn't carry; elevation
PROFILE chart (payload sends climb only). All additive payload work, candidates for M8+/polish.

**BD-52 — M7-T06 reasoning view live: structurally CoT-free at BOTH ends (2026-07-16).**
The collapsible "How this route was built" mounts inside RouteDetail (§16 cohesion rule 3)
and renders ONLY the four permitted kinds of content (pipeline steps · tool calls · grounded
result counts · validated-output notes like parser=llm) — its sole input is the timeline the
progress screen assembled from schema-validated GenerationEvents, so there is no code path
by which unvalidated (or reasoning) content could render. Enforcement is now double-ended:
client-side, off-schema frames are rejected before decoding (sse.ts, tested incl. a
synthetic 'thinking' frame); server-side, a NEW plan-sse test walks EVERY frame's keys
recursively and fails CI on any reasoning-like field (/reason|think|thought|chain|cot|
scratch|internal/i) at any depth — the task's "backend assertion that trace events contain
no CoT field", on top of BD-45(9)'s schema gate. RG-5's code-review confirmation rides the
M7 close-out review.

**BD-53 — M7-T07 conversational refinement live end-to-end; the /plan round-trip API
(2026-07-16).** M5-T06's refine library was LIBRARY-ONLY (no wire path; Spec §34 "the caller
holds the running c" had no way to hold it). Landed additively, per the §34 design:
(1) NEW `constraints` SSE event (additive union member per BD-45(7)) — the effective
ParsedConstraints emitted after parse/merge, so the client holds the running `c`;
(2) /plan body accepts optional `constraints` + `followUp` (both-or-neither → else 400):
the previous c re-validates through the SAME shared zod schema in-handler (Hard rule K),
then refineConstraints merges deterministically (RF6) — recognized:false is an honest no-op
(friendly error + done:unavailable, planner never runs, ZERO spend); the parse step reports
`refine-merge` (no LLM call on refinement turns; FR-049 metrics.parser logs 'refine-merge').
Hard constraints persist by mergeConstraints construction (M5 retention tests + a new wire
test). (3) Client: RefinePanel inline ON Result (§16 rule 2), RouteCompare rendering REAL
COMPUTED deltas from the two route payloads (FR-254 — the client computes, nothing narrates
numbers), previous-summary threaded Result→Progress→Result; refined result replaces in
place with back returning to the prior result (comparison + history in one gesture).
[GATE-RF]'s precondition (one-shot stable) was met by SPK-15/M4/SPK-19; ship-shape is
RF1+RF4+RF6 exactly as the Protocol prescribes. **LIVE E2E:** run 1 held c → follow-up
"make it longer" → refine-merge, done:ok, 56 → 61 min (target 60→72 min with the frozen
±20 % tolerance; the planner's honest best). Backend 198→201 tests green; app 90.

**BD-54 — M7-T08 §18 state matrix closed for the M7 slice (2026-07-16).** All applicable
rows verified by a single consolidated test file (app state_matrix.test.tsx) + the per-screen
tests: loading (map banner + streamed steps) · offline SPLIT honestly into never-connected
("No connection… check your network") vs dropped-mid-run ("Connection lost… nothing was
saved") — the one real gap found by the audit, fixed · map-data failure keeps the map
interactive + retry · location-permission-denied → rationale + drop-a-pin (Plan) ·
out-of-region / rate-limit / kill-switch / spend-cap render the server's friendly JSON
verbatim (each names a path forward) · planner degradation ladder text · relaxation banner +
panel · timeout best-so-far banner. Never a raw error string anywhere (tests assert the raw
cause never appears). Deviations noted: states are CO-LOCATED with their screens rather than
a components/states/* dir (the backlog's file hint — cohesion beats a premature shared dir);
geocode-failure n/a by design (place names ride the brief; server gazetteer); upload (M10)
and auth-sheet (M8) rows land with their milestones; a persistent app-wide admin banner for
cap/kill (§65) is M11 polish — the inline panel covers the M7 slice.

**BD-55 — M7 close-out adversarial review: 24 findings, 20 confirmed, ALL FIXED (2026-07-16).**
A 4-lens review (security/privacy · stream correctness · spec/RN · test integrity) with
per-finding adversarial verification ran over the whole M7 slice before the device handoff.
The two CRITICALS, both fixed with regression tests:
(1) **Region-guard bypass on the refine path** — /plan's .poly check covered only
body.origin/destination; a schema-valid `constraints` blob could carry ANY global coordinate
(zod checks shape, not geography; out_of_region_flag is attacker-controlled) straight into the
planner on the anonymous, money-spending endpoint. Fixed: the pre-stream region gate now also
checks LatLng origin/destination INSIDE the revalidated refine constraints → clean 400
out_of_region; test proves a Paris-origin refine never reaches the planner.
(2) **Retry could never succeed** — the run reducer was never reset on a new attempt, so a
retried stream's terminal event was swallowed by the settled phase. Fixed: `reset` action
dispatched at every attempt start; regression test drives fail→retry→success→Result.
Also fixed (majors/minors): stale-stream settlements guarded (strict-mode double-mount /
superseded attempts can no longer corrupt the run); done-with-no-route now fails honestly
instead of a dead-end 'succeeded'; late guard/network settlements can't override a settled
phase; ResultScreen ScrollView keyboardShouldPersistTaps (refine tap was swallowed by
keyboard dismissal); guard headlines keyed by error code (out_of_region no longer reads
"Planning is paused"); RouteCompare deltas computed at display precision (no more "+0.0 km
vs identical columns"); unrecognized follow-up now completes its parse step on the wire;
per-request socket close-listeners detached in finally (keep-alive accumulation); the no-CoT
key-walk now walks RAW wire frames (the zod-parsed walk was vacuous for unknown keys); wire
constraints event asserts hard-constraint retention; rn-stub enforces RN's bare-text
invariant (device-crash class → CI failure); app.config↔runtime contract test (a renamed
extra key can no longer ship a tokenless build silently) + Hard-rule-H secret-shape tripwire;
session-test tautology removed; stale rls_planner header corrected; data-schema fixture test
renamed to what it proves. 4 findings refuted with evidence (PlanStack remount concern,
find_spots vacuity, SSE-transport-untested, map tap contracts). Post-fix: 401 tests green
repo-wide; live E2E (full + cancel + refine) re-verified against the patched backend.

**BD-56 — M7-T09 device-feedback round (round 15): all six owner findings mechanised and
fixed (2026-07-16).** The iPhone hero-flow run WORKED end-to-end (M7-T09 iOS functional
pass) and surfaced six quality problems; each was traced to its mechanism before fixing:
(1) **Spot pins only near the lakeshore** — the data was region-wide (5,040 OSM spots); the
app asked planner_find_spots for the nearest 1,500 to a centre landing on the Oakville
shore (1,500th-nearest = 22.8 km), AND every row-returning path is capped by PostgREST
max-rows (1,000/response). Fixed with **migration 0008 map_spots()** — ONE jsonb aggregate
(cap-proof), id-ordered (spatially unbiased), SECURITY INVOKER (0007 RLS binds; OSM-only
re-tested). Live: 5,040 rows, London→Kawarthas extent, 653 KB; spots now load in parallel
with routes. Viewport-scoped loading recorded as the M8 egress follow-up.
(2) **"Highway ramps count as twisty" — CONFIRMED DEFECT, fixed with eval evidence**: the
route-level curviness was tag-blind while the corpus always excluded junction geometry
(§12.1). `measureCurvatureClassAware` now drops ramp/turn-channel/roundabout/motorway/trunk
edges using the trace the residential gate already fetches (ZERO extra Valhalla calls) and
measures kept runs in isolation; tag-blind fallback on trace failure/A→B. Config
**frozen-m4t12-v8 → v9** (formula C7/θ/weights untouched — only the measured domain
narrowed); **48-brief VAL: AC passes 10/48 → 10/48, zero flips; curv mean 1.069→1.036;
3 bests changed incl. Collingwood 2h-twisty honest-curv 0.45→0.87 (fake-ramp winner
dethroned)** — eval/reports/curvature-class-aware.md; OWNER RATIFICATION REQUESTED.
Plus `_link` vocabulary armor in countryScoreOf/countryClassFactor (inert, tested).
(3) **"More backroads changes nothing"** — the phrase wasn't recognized; now
backroads/country-roads/rural → the FROZEN backroads preset (explicit ask, may override) and
twisty phrases ALSO steer the twisty preset when no chip was chosen (BD-30 vectors only —
no new science, no sliders). LIVE: "more twisty more backroads" → refine-merge, preset
backroads, twistiness 2.01→2.74. (4) **"Make it longer keeps the route the same"** — traced
to selection (clean-short beats dirty-long lexicographically = BD-42 quality-over-clock;
never-empty fallbacks); per owner decision the rule STAYS and the app now DISCLOSES: an
unchanged refined result shows the honest quality-first banner. Reopening "longer" science
was declined this round (recorded as an M4-reopen candidate). (5) **"Same prompt → same
route"** — deterministic by design; the discarded diversify-kept pool now ships as
**alternates** (additive `alternate` SSE frames after `route`; ≤3, presentKey order, no
enrich/LLM spend — climb null, explanation stays best-only) with a Recommended/Option-2/3
switcher on Result. LIVE: London 2h loop → 3 alternates (thin funnel pools may yield 0 —
honest). (6) **Attribution collision** — SDK logo/ⓘ positioned deliberately (bottom-left),
our OSM credit in a legible pill bottom-right, detail sheet clears the strip (FR-014 never
covered). Also recorded: u-turn single-offence pass-through (whole-pool-dirty condition)
stays a known structural M4-reopen candidate. Totals this round: 420 tests green
(app 110 · backend 214 · db 30 · shared 23 · eval 26 · data 17); live E2E full/cancel/
refine/alternates green.

**BD-57 — Round 16: structured Plan-screen sections, typed multi-stop with measured
timing, honest surfaces, preset `simple` (2026-07-16).** Owner ask: replace the
"Character (optional)" chip row with sections that are clearer AND genuinely change the
route; add food/gas stops with a when-in-the-drive preference; paved-only; honest scenery.
Owner-scoped choices locked: scenery = soft two-level toggle; timing = Anytime/Early/
Midway/Late chips (0.25/0.5/0.75). Shipped, six units:
(1) **Food corpus** — restaurants were already extracted and discarded by one classify()
branch; fast_food added by local re-filter. Migration 0009 widens spots_type_check;
+16,326 food rows (corpus 21,366: coffee 3,197 · food 16,326 · fuel 1,388 · viewpoint 455);
SPOTS_LIMIT 25,000; marker letters explicit (fuel 'G', food 'F').
(2) **Engine layer** — per-leg durations mapped (previously discarded); stop waypoints are
**break_through** (probed on the pinned 3.7.0: `through` middles do NOT split legs;
break_through does → arrivals = Σ leg durations, and a stop IS a stop); trace gains
`edge.unpaved` (probed true on gravel); `exclude_unpaved` wired but probed BEST-EFFORT
(no observable change on a gravel-belt corridor) → the honesty guarantee is the trace
result-scan: > UNPAVED_MIN_M (50 m) of unpaved edges overrides has_unpaved (BD-16).
(3) **Planner core** — `WaypointCandidate.stops: CandidateStop[]` replaces the type-blind
single spotIds; per-type per-unit anchoring (anytime units join the L4 angular sweep;
fraction units inserted post-sort at slot floor(f·(n+1)) aimed at the bracketing vertices;
A→B: argmin |progress−f| → detour → id; used-set dedup; TSP skipped when any fraction stop,
indices re-derived by object identity); per-type Tier-2 gates `stop_<type>` (a covered
coffee can no longer hide a missing required fuel) + Tier-3 `stop_timing_<type>`
(STOP_TIMING_TOLERANCE 0.2 of duration, actual % disclosed; unmeasured arrival = honest
null, never interpolated); stop_cover = per-type mean; repair pass skips stop-carrying
candidates (recorded fallback). Explanation facts un-stubbed: stops carry arrival_min
("Ridge Café (coffee, ≈40 min in)"), arrivals join the grounding allowlist.
(4) **Transport + parsers** — /plan body += stops (shared-zod re-validated; per-TYPE
replace vs the brief; cap 6)/avoid (per-key)/character (unioned)/twistiness_pref; LLM parse
prompt v2 (at_fraction vocabulary; preset enum += simple); rules parser maps
early-on/halfway/toward-the-end → fractions and simple/easy/mostly-straight → preset.
**Preset `simple` = chill's EXACT frozen vector relabeled** (owner vocabulary: minimal
turns, mostly straight; byte-equality pinned by test; chill stays a parse alias; no new
science, BD-30/[GATE-W] intact).
(5) **Plan screen** — sections "Drive style" (Twisty·Simple) / "Scenery" (Prefer views →
viewpoint nice_to_have stop + scenic tag, NEVER the preset slot — [GATE-S] honest lever) /
"On the route" (avoid-highways · mostly-backroads · paved-only + the stops builder);
PresetChips deleted; composition rules: backroads takes the slot over twisty (pref rides
along), simple keeps the slot + backroad tag (weak combo, honest); everything optional
under an explicit header. RouteDetail: Stops rows with measured arrivals + typed markers.
(6) **Eval discipline** — config **frozen-m4t12-v9 → v10**; 48-brief VAL:
**all 48 best geometries + durations + verdicts BYTE-IDENTICAL to v9 (AC 10/48 → 10/48)**
— the machinery added measurement without moving the corpus; live E2E structured stops run
(Guelph): Tim Hortons 78 min + Pioneer 118 min, all four stop verdicts satisfied
(eval/reports/stops-and-surfaces.md — OWNER RATIFICATION REQUESTED).
**Defect found by live probe, fixed in-round:** the stop-timing regexes shipped with `\b`
as a literal 0x08 byte (python-patch artifact — dead patterns, silent null fractions);
fixed byte-level, repo swept, phrase-level test added (the lesson: patch-written regexes
need phrase tests in the same unit). Totals: backend 235 · shared 23 · app 121 all green,
tsc clean ×4 (incl. eval); live E2E full/cancel/refine/stops green.

**BD-58 — R17 Thread A: R16 stop-carrying loop regression fixed; stop-aware repair +
defensive detour cap (2026-07-16).** The owner reported that R16 loops with a stop regressed
(U-turns, random-road-then-U-turn, overlaps), worst on "Prefer views". Diagnosis: R16's
switch to type-SPECIFIC stop anchoring (`nearestOfType`, correct — a coffee stop must anchor
coffee) exposed a pre-existing weakness — the loop repair pass had always SKIPPED
stop-carrying candidates, which was harmless only because the old type-BLIND anchoring always
put a dense spot on the cluster. A sparse viewpoint (455 region-wide) with no detour cap +
skipped repair = a dragged, uncleaned loop. DECISION: (1) make the repair pass STOP-AWARE
(runs on stopped candidates; stop waypoints are never moved; DROP/INSERT maintain the
remaining stops' waypointIndex; also fixes a latent INSERT index bug) — this is the actual
fix, confirmed live: coffee/fuel/viewpoint stops 1–25 km out all yield clean loops. (2) Keep
a DEFENSIVE detour cap `max(10 km, 0.30·targetPerimeter)` on stop anchoring — repair is what
keeps loops clean, so the cap only blocks absurd anchors that would waste the pool; an
over-cap spot is not anchored and coverage discloses it. (3) run.ts threads the REPAIRED
candidate downstream so measured arrivals/markers stay correct. (4) The app "Prefer views"
toggle no longer injects a viewpoint STOP (it caused the worst drag) — scenery becomes a
routing preference in Thread B; explicit "with a viewpoint" briefs still get a (now capped +
repair-cleaned) viewpoint stop. Evidence: 48-brief VAL — 44 stop-free briefs BYTE-IDENTICAL
to v10 (regression guard), 4 stop briefs improved (Fonthill FAIL→PASS, all microloop→0),
AC 10→11; live multi-stop e2e green; backend 235 / app 121 / shared 23 / eval 26 green.
No config_id bump (no scored-param change; the detour cap is generation-side, stop-free
output unchanged). Owner ratification requested.

**BD-59 — R18 "The Fun Rebuild": the audit verdict + the methodology decision — GENERATION
AND COSTING OWN FUN, NOT RANKING (2026-07-16).** Owner directive after the 40-route audit
("be hella critical; frozen decisions may be reopened"): the planner was boring-by-
construction — candidates forced only 2-7 km of curvy road while ~90-97 % of route meters
were Valhalla fastest-path connectors whose only class lever (use_highways) is a probed
motorway/trunk-only step function; characters were mathematically inert re-ranks (pool
variance ~0.007 vs preset deltas ~0.003; distinctness overlap 1.00, identical 10/10);
"through Forks of the Credit" was parsed then consumed by NOTHING; 10/30 random briefs
hard-failed with no fallback. The decisive probe: costing_options.auto.shortest=true
collapses connector arterial share 99→5 % / 81→34 %. DECISIONS (each unit's full evidence
in BUILD_LOG (h)-(l) + eval/params-frozen.json provenance rounds 18…18_4; config lineage
frozen-m4t12-v10 → frozen-r18-v1…v4):
(1) REOPENED BD-21 costing: shortest-profile connectors ADOPTED for backroads/twisty asks
(R18-1: curv +41 %, AC held; legacy = byte-identical rollback). FUN-DEFAULT for
characterless briefs REFUSED THREE TIMES by its pre-registered rule (R18-1 AC 7→4;
R18-2 AC 19→13; R18-3 loop premise falsified) — stays off; the A→B probe (arterial
80→71 %, curv +39 %, zero new failures) is recorded as POSITIVE evidence for a future
default-bundle decision.
(2) Never-empty + repair v2 + provable presentation tiers + duration fix ADOPTED (R18-2):
AC 12→19/48 record, all 10 audit kill-towns returning routes, closure-vs-snap semantics
bug fixed (Hockley class), tier bases made provably un-crossable after a property test
caught the historical −5/−10 interleave flaw.
(3) LOOP CHAINS (R18-3): built in full, then REFUSED by their own pre-registered
falsifiable diagnostic (pool ctryVar 0.0004-0.0098 vs required >0.05; +1 pp curvyShare vs
+10 pp bar; 2× wall time) — BD-40 discipline held; rollback verified byte-identical.
tripleClusters stays false forever; chain revival = a new pre-registered experiment on
richer material. A→B SPAN PARITY ADOPTED (spans not centroids, corridor chains, TSP skip,
always-trace with dual-endpoint grace, span-atomic repair; new standing eval
eval/atob_quality.ts, first-run baseline, deterministic ×2).
(4) LOCATION INTENTS REAL (R18-4): migration 0010 pg_trgm name lookup (SECURITY DEFINER,
frozen deterministic order) + resolver with kind-aware precedence + reach honesty; pinned
repair-immune traversal spans; 3 km avoid discs; MEASURED Tier-2 rows (via ≥60 % of road
vertices within 30 m — live: "through Forks of the Credit" drives 100 %); unknown-name
origins AND destinations now fail honestly by name. V1 DEVIATION (recorded): avoid-miss
and via-miss render RELAXED, not violated — the dedicated ladder rung is the follow-up.
(5) CHARACTER BUNDLES (R18-4, reopens BD-30's weights-only scope): arterial presentation
bars per character (twisty 0.20/backroads 0.10/scenic 0.35/simple off), simple's tight
clock, scenic's guarded nice-to-have viewpoint; aliases chill→simple,
coffee_stop/avoid_highways→default. Distinctness: 1.00 → 0.25-0.36 overlap;
curv(twisty)=1.45× curv(simple) (bar PASS); arterial simple-backroads gap 0.10 vs 0.15
bar MISS (demotion cannot create material — re-judged at the R18-5 gate). [GATE-S] holds
throughout: no scenic scoring anywhere.
(6) HONEST-PARSING TRADE (owner ratification requested): "backroads"/"country roads"
phrasing now reaches the backroads preset (parse-correct: reqset gold agrees; parse
prompt v3 BD-28 re-run ADOPT re-confirmed, VAL 0.922 vs rules 0.859, $0.98). Cost: fixed
AC 19→17 — isolation-proven to be ONLY the 4 newly-mapped briefs switching onto the
adopted shortest profile, with large essence wins (Delhi arterial 76→46 %, Bolton curv
+74 %, St. Catharines FAIL→PASS) against marginal bar misses (pool self-overlap 0.16 vs
0.15; durErr 26 % vs 25 %). Bars NOT weakened (rule J). REVERSAL LEVER: one line in
parse_rules.ts if the owner refuses the trade.
Standing: BD-39 (threshold tiers where scalar weights failed), BD-40 (pre-registered
refusals hold), BD-42 tier semantics, [GATE-S]. Owner ratification requested for BD-59
plus the carried BD-46…BD-58.

**BD-60 — R19: ROAD CONTEXT, NOT ROAD CLASS — urban-context data layer + the honest
composite (2026-07-18).** Owner corrections on the Mayfield×Kennedy audit: (1) "main roads
are fine when surrounded by fields or forest, or as a good way to connect two nicer roads";
(2) "half the green stuff is entering neighbourhoods — who wants to drive in the
neighbourhood". Both are now MECHANISMS:
DATA (R19-0): OSM landuse extraction (39,682 built polygons 2,947 km² / 12,675 rural,
migration 0011 landuse_zones + planner_built_areas definer read); per-segment
urban_share computed for all 133,865 curvy segments (buffer-0 inside-polygon ratio —
boundary arterials measure ~0 by construction). GROUND-TRUTHED: Forks of the Credit 0.00,
Hockley 0.00, Mississauga Rd 0.07; the diagnosed disease quantified — 24 % of the top-300
curvy segments near Mayfield are SUBDIVISION COLLECTORS at curviness statistically equal
to genuine country roads (the class filter never saw them).
PLANNER (R19-1): retrieval excludes urban_share > 0.6 INSIDE the RPC (migration 0012;
MK-area corpus mean urban 0.26→0.05, all seats refilled with country material) with a
STARVATION REFILL below 150 segments (the house rule, proven 3×: hard caps starve pools —
refilled town material ranks LAST via segValue ×(1−0.7·urban)); route-level urbanShareOf
with the FLANK-PROBE predicate (urban = inside a built area OR built on BOTH ±120 m
flanks — one-side-fields stays fine, the owner's sentence verbatim; buffer-0 alone
measured a Brampton main-road slog 0.02 = plainly wrong, fixed) and ORIGIN GRACE 2.5 km
(town-exit is not the route's fault — the ungraced bar cost fixed AC 16→10, diagnosed +
fixed); presentation URBAN bars replace the R18-4 arterial bars (twisty 0.15 / backroads
0.12 / scenic 0.10 / default 0.25 / simple off) — measured proof of the owner's point: a
Caledon East loop at 90 % arterial is 0.04 urban and no longer demotes; honest
"about N min through town before the drive opens up" disclosure (fires ≥ 8 min);
urban_share on the wire; repair INSERT never picks urban segments.
JUDGMENT TRAIL (three pre-registered steps, all recorded): v1 params REFUSED (urban bars
ungraced + primary metric aimed at a population without the disease — fixed AC 16→10);
grace+recalibration (AC still 10 — pool starvation diagnosed via row flips); refill+
rank-last ADOPTED under the HONEST COMPOSITE: the old AC's off-run 16 contained FIVE
passes whose bests were 24-30 % urban (the disease itself); with the urban ≤ 20 % axis
added (the same re-basing every honesty axis has performed) — off 11 vs R19 11 (AC HELD),
durErr p50 14→10 % (improved), curvyShare 0.09→0.10, ms 6.4 s, no-route 0. Disease
population (Mayfield 40, the audit that started this): mean urban of defaults ≤ 11 %
(bar 12), town-heavy 0/40, backroads arterial 75→59 % with curv 1.59.
WATCH ITEM (named, not hidden): Mayfield default u-turns 6/40 (v1: 1/40) — thinner
near-town corpus forces more turn-backs; the repair pass aiming at urbanRunInfo.mid is
the identified follow-up. [GATE-S] BOUNDARY: urban-share is a QUALITY GATE like
residential share (the owner has demanded anti-urban twice), NOT numeric scenic
scoring — no scalar scenic weight exists anywhere; rural polygons are loaded but
unconsumed pending [GATE-S]. Kill switch: URBAN_CONTEXT_ON=false restores R18-era
behavior (retrieval + bars + disclosure together). Owner ratification requested
(BD-46…BD-60).

**BD-61 — R21-0(a): CLOSED-RING corpus exclusion — the Kuehne+Nagel / Standish Court
"random stop" fixed (2026-07-19).** Owner device sighting: a "random stop at Kuehne+Nagel"
and the route "taking the highway and using Standish Court as a U-turn." ROOT CAUSE
(engine-verified): "Standish Court" (id 17950) is a 561 m industrial cul-de-sac whose CLOSED
BULB RING sweeps ~2π of heading over a short length → circum_curvature_per_km (C7) reads
MAXIMAL (13.57), and its industrial parcels are mapped with gaps at the road so buffer-0
urban_share = 0.00 — neither the BD-21 class filter nor the R19 urban filter caught it. The
planner sought it as "the twistiest road around," drove out, and U-turned at the dead-end
bulb; the reversal lands on the basemap's Kuehne+Nagel POI label and READS as a stop (the app
draws no waypoint markers and does no reverse-geocode — innocent). Same class = the 80-route
audit's issue #4 (and #14, Newmarket).
FIX: migration 0013 adds `and not st_isclosed(cs.geom)` to planner_find_curvy_roads (the ONLY
spatial read; plannerFindAnchorPoints routes through the same fn with p_min_curviness := 0, so
BOTH the curvy-waypoint pool and the return-anchor pool are covered), filtered pre-limit (the
BD-21 lesson). Defense-in-depth: an isClosedRing() guard added to the curvature corpus builder
(data/curvature/compute.ts) + a unit test, so a future corpus REBUILD never re-emits rings.
EXTENDS BD-18 (was: residential closed rings only → now ALL closed rings; owner-authorized).
MEASURED (local corpus, 133,865 segments): 753 closed rings exist; only 26 were otherwise
retrievable, ALL 115-664 m with curviness 6.17-46.2 — every one a cul-de-sac bulb or circle,
zero legitimate through-drives. Retrieval pool 12,363→12,337 (−26, −0.2 %): no starvation.
A/B (48-brief paired, migration 0012 vs 0013 — a pure definer-fn swap): ADOPT. no-route 0/48
flat; AC 11→13; |durErr| p50/p80 10/21 %→10/17 %; dirty units mean/max 2.12/20.38→1.76/18.06;
corridor-doubling p80 0.16→0.14; curvy-share p20 0.03→0.02 (the expected honest drop — fake
ring curvature removed; mean flat 0.10). 16/48 briefs rerouted, ZERO PASS→FAIL. MECHANISM
CONFIRMED: Orangeville twisty 16 U-turns → 0 (FAIL→PASS); Mississauga (nearest Standish) pool
u-turn rejections 13→6; Kilbride forest FAIL→PASS. Determinism hash 4896092d2f5280b9 →
fa91008c3d59dc9a (routes changed, all improvements or flat).
SPLIT: R21-0(b) (dual-flank segment urban_share) DEFERRED to its own measured unit. Scoping
found 361-850 of the 3,095 high-curvature retrievable segments are >0.7 / >0.5 built-surrounded
(120 m buffer), but a buffer-coverage proxy CANNOT separate "both-flanks built" (filter) from
the R19-preserved "edge main road along fields is fine" (keep) — the true dual-flank port needs
its own before/after A/B. (a) alone fixes the reported bug; the route-level dual-flank measure
(urban.ts, already live) handles urban context at presentation (urban share of bests mean 7 %/
p80 11 %).
No planner-param change (params-frozen.json unchanged; this is a corpus-state change).
Rollback: re-run migration 0012 (recreates the fn without the st_isclosed clause). Hosted-Supabase
deploy: apply 0013 (with 0010-0012). Config lineage: → frozen-r21-v0 (final freeze at R21-7).

**BD-62 — R21-1 loop-shape gate REFUSED: loopiness-primary demotion is COUNTERPRODUCTIVE for the
twisty/backroads product (2026-07-20).** Folded loop-shape degeneracy (loopiness < 0.20 floor as
primary; corridor-doubling > 0.30; the previously-inert 0.15-0.30 self-overlap units) into the
EXISTING dirty presentation tier behind SHAPE_QUALITY_ON — no new lexicographic tier, so BD-42 is
preserved by construction (dirtyPenaltyOf caps at TIER_DIRTY+GRADE_CAP = 204.5; score.test tier-order
property intact, 13/13). OFF proved byte-identical (determinism hash fa91008c3d59dc9a; 295 backend
tests green).
A/B (48-brief fixed, OFF = R21-0(a) baseline vs ON): loopiness p20 0.12→0.19 (bar ≥ +0.10 → MISSED at
+0.07); corridor-doubling p80 0.14→0.11 (PASS); no-route 0/48 flat; durErr p80 17→16 %; dirty units
mean 1.76→1.95; AC 13→12 (bar: no regression → MISSED). Exactly ONE verdict flip (Guelph twisty).
3-SKEPTIC ADVERSARIAL REVIEW (each told to refute; 2 of 3 refuted): (1) "false-pass exposure" REFUTED
— the demoted Guelph route was the TWISTIER/more-rural/lower-urban one (curv 1.32 vs 1.01, country
0.51 vs 0.39, urban 11 vs 22 %, self-overlap 0.03), a thin low-area loop, NOT an out-and-back; (2)
"efficacy real" UPHELD but narrow — causal (no RNG), directional, yet +0.07 at 0.19 is the ceiling a
0.20 demote-floor can reach and the true degenerate tail (0.03-0.09) is unmoved ("a generation problem
attacked with a presentation tool"); (3) "adopting is disciplined" REFUTED — two pre-registered bars
missed with a byte-identical, kill-switched, cost-free baseline → adopting-with-a-narrative is the
motivated-reasoning BD-40 exists to prevent.
DECISIVE NEW EVIDENCE: loopiness-as-primary is not merely under-powered but COUNTERPRODUCTIVE. A
presentation demote can only RESHUFFLE existing candidates; in sparse briefs the only real-shaped
loops are round-and-boring, so demoting thin-but-twisty loops trades away the CORE essence the brief
asked for — Belfountain *twisty* curv 1.92→0.00, Smithville *rural* country 0.52→0.26, Guelph *twisty*
surfaced a 22 %-urban loop (fails the urban≤20 % AC) over a curv-1.32/56 %-arterial one.
VERDICT: REFUSE (BD-40). The shape problem (audit #3 Southfields sliver epidemic, #5 Port Hope, #9
showcase corridor-doubling) is a GENERATION problem — real loops must be GENERATED in sparse areas,
not manufactured by re-ranking — and R21-0(a) already improved corridor-doubling p80 0.16→0.14 for
free via corpus cleanup. FOLLOW-UP (a NEW pre-registration, not this unit): a narrower gate on
corridor-doubling + self-overlap ONLY (loopiness excluded — those two target unambiguous degenerates
and do not harm essence). Machinery kept flag-off, byte-identical (the CHAIN_CANDIDATES_ON /
loop-chains refused-machinery precedent). SHAPE_QUALITY_ON=false.
Also fixed here (an R21-0(a) consequence caught by running the full backend suite): curvature.test.ts's
recompute-reproduces-stored sample now excludes closed rings (`not st_isclosed(geom)`) — the isClosedRing
guard added in R21-0(a) zeroes rings the DB still stores at their old high curvature, so the invariant
holds only for the valid non-ring material the planner actually retrieves.

**BD-63 — R21-2: planner fun-default REFUSED (4th time); APP default → Backroads ADOPTED
(owner-directed "make the default drive fun") (2026-07-20).** Two parts:
(a) PLANNER fun-default — FUN_DEFAULT_ADOPTED flips the characterless-brief profile to raw `shortest`.
4TH pre-registered judgment, now with the R21-0(a) corpus cleanup + R19 urban_share live (the guards
the first 3 refusals lacked). A/B (48-brief fixed, OFF=false = R21-0(a) baseline hash fa91008c3d59dc9a
vs ON=true hash 3f7ec87c30fb9080): arterial mean 73→65 % (bar ↓ ≥ 15 pp → MISSED at −8), AC 13→8 (−5:
six DEFAULT briefs failed — Fonthill, Kilbride, Port Perry, Peterborough, Brantford, London; one gained,
Erin), dirty units mean 1.76→3.49 (nearly DOUBLED), urban p80 11→16 %, durErr p80 17→20 %, no-route
0/48 flat. The same residential/urban-bleed + repair-class-offence failure as all 3 prior refusals — R19
+ corpus cleanup did NOT rescue it: raw `shortest` on characterless briefs (no backroads bundle to gate
class-mix) generates dirty cross-country routes. REFUSE (BD-40, 4th consecutive). FUN_DEFAULT_ADOPTED=false.
(b) APP default → Backroads (owner-approved fallback, ships regardless of a) — ADOPTED. A new
DEFAULT_DRAFT (= EMPTY_DRAFT + mostlyBackroads:true) seeds the Plan screen (PlanStack.tsx); EMPTY_DRAFT
stays the true nothing-selected baseline (its composition tests are unchanged). A plain "generate" now
composes preset=backroads → the ALREADY-ADOPTED backroads profile+bundle (R18-1/BD-59: curv 1.10→1.55,
AC held), NOT raw shortest on the default bundle. That is exactly WHY (b) works where (a) fails: identical
`shortest` costing, but backroads carries the tuned bundle (retrieval θ, arterial ≤ 0.10 gate, tie-break
weights) that gates the class-mix. So the default USER experience is fun; only a raw characterless API
call stays fast. Verified: app tsc clean, plan_draft 17/17 (new DEFAULT_DRAFT→backroads test; EMPTY_DRAFT
still composes no preset). Integrated verification deferred to R21-7: the re-audit's DEFAULT pass now runs
AS backroads, confirming broad-backroads stays clean across all origins (if it doesn't, that surfaces to
the owner). Rollback: DEFAULT_DRAFT → EMPTY_DRAFT seed in PlanStack.

**BD-64 — R21-5: best-material floor ADOPTED at FLOOR=1 — but the "lottery" was already fixed by
R21-0(a); the real win is duration/pool-coverage (2026-07-20).** The duration BAND in
candidates.ts drops a cluster whose predicted loop-duration is outside [0.75, 1.5]·T; predictedS
uses ORIGIN-DEPENDENT distanceM while cluster `weight` (Σ segValue) is ORIGIN-INVARIANT, so the
premier cluster survives for a near origin yet drops for a farther neighbour. Fix
(BEST_MATERIAL_FLOOR, additive + deterministic, 0 = byte-identical): always admit the top-N
clusters by weight, exempt from the band drop; duration is still controlled downstream
(weight × durationFitFactor rank → duration-prefilter → resize).
LOTTERY ALREADY CLOSED: a neighbour-consistency probe (Southfields-10, ±~1 km around the community
centre, brief "90 minute loop") shows FLOOR=0 IDENTICAL to FLOOR=1 — 10/10 neighbours get a real
drive (curv 1.06-1.48) at BOTH floors. R21-0(a)'s closed-ring cleanup already resolved audit #7 for
these origins (the band already admits their best cluster). So R21-5 is NOT the lottery fix it was
scoped as (that shipped in R21-0(a)); its benefit is elsewhere. (Brampton 4/10 GOOD at both floors —
a genuine material limit for deep-urban neighbourhoods, not a lottery.)
REAL BENEFIT (48-brief A/B, OFF = fa91008c3d59dc9a vs FLOOR=1 = dffef6162494e102): AC 13→17 (+4),
4 FAIL→PASS / 0 PASS→FAIL — Kitchener durErr −34 %→−11 % (band was dropping the on-target cluster),
Stratford presented 1→4 and Goderich 3→4 (pool-starvation fix, met the ≥4-distinct AC), Milton
on-target (−27 %→+19 %, marginal — a thinner shape, still passes). no-route 0/48 flat, durErr p80
17 % flat, dirty ~flat, urban p80 11→15 % (Milton-driven, under the 20 % AC).
LATENCY TUNING: FLOOR=2 gave AC 13→18 (+5) but +58 % wall-time (candidate × multi-cluster-chaining
blowup) — pushing the canonical e2e brief to 25.3 s, OVER the 25 s budget (best_so_far, backend
suite red). FLOOR=1 keeps 4 of the 5 AC gains at +34 % (6549→8749 ms mean), planner-e2e 5/5 green
under budget. Sized at 1 for the quality/latency balance — a hard latency constraint (SPK-19 / the
25 s budget), not tuning-to-pass a quality bar. ADOPT FLOOR=1. Determinism dffef6162494e102 (no
RNG); backend 295/295, prettier clean. Config freeze deferred to R21-7 (frozen-r21-v1). Rollback:
BEST_MATERIAL_FLOOR=0 (byte-identical).

**BD-65 — R21-4: honesty coverage ADOPTED — u-turn / duration-miss / sliver disclosures on the
presented best (2026-07-20).** The audit found the planner SILENT about caveats a presented route
carries: u-turns on 8/80 routes undisclosed (#11), 9/80 duration misses > 15 % unsaid (#13), thin
out-and-backs sold as "loops" (#3/#5). Added three INFORMATIONAL disclosures to the winner path
(run.ts) — placed AFTER the status decision, so an otherwise-clean route stays 'ok' and route
SELECTION is unchanged: (1) any presented best with uturns > 0 says so; (2) |durErr| > RESIZE_TRIGGER
(0.15, aligned — if resize couldn't close the gap, disclose it) → "about N min — a bit under/over the
M you asked"; (3) a loop with loopiness < LOOPINESS_DISCLOSE_FLOOR (0.10 — CONSERVATIVE and
disclose-only, well below the REFUSED R21-1 0.20 demote-floor, so only clear slivers fire and
loopiness is never ACTED on) → "more of an out-and-back than a loop". Residential-lane disclosure
deferred (already covered by the > 5 % demotion + the urban-intro note; would need residentialRunM
threaded onto `best`). VERIFIED (6-origin probe): Newmarket (audit #14) now fires all three
(u-turn + −38 % dur + loopiness 0.06); Cobourg −21 % → duration only; Owen Sound u-turn + durErr −10 %
→ u-turn only (correctly quiet on the sub-15 % miss); Grand Bend clean → silent. 100 % coverage on the
triggering conditions, 0 false positives; Cobourg/Orangeville keep status='ok' (notes don't downgrade).
Additive, no route change, backend 295/295, prettier clean. Supersedes R21-1's never-firing (flag-off)
degenerate presentation note; the rest of the R21-1 machinery stays flag-off.

**BD-66 — R21-6 return-corridor u-turn fix REFUSED: the u-turns are STRUCTURAL, insensitive to the
return anchor (2026-07-20).** Audit #11 (8/80 u-turns) + the 2026-07-18 diagnosis (far-apex reversals
from arterial-locked homes, good roads 16-27 km out). Current state (post R21-0(a)+R21-5): 15/48
briefs carry a u-turn (65 total), CONCENTRATED in road-sparse peninsula/funnel towns — Owen Sound 15,
Collingwood 11, Cobourg 10, Creemore 8 — where doubling back is largely unavoidable geography. The
generator ALREADY tries multiple return-sector variants (rounds 1 + 3) and repair fixes what it can;
the residuals are the structurally-hard cases. Third lever tried (after the reverted "unfilter return
anchors" → net-zero + urban-worse, and "duration-keyed anchor distance" → curviness collapse):
RETURN_ANCHOR_DISTANCE_FRACTION 0.6→0.8 (a rounder, more symmetric loop). A/B (48-brief vs the current
FLOOR=1 baseline): **u-turns IDENTICAL — 15/48 briefs, 65 total** — the anchor distance is INERT for
u-turns. Side effects: loopiness p20 0.12→0.19 and corridor-doubling p80 0.16→0.11 (rounder loops — the
shape win R21-1 chased, here via GENERATION not demotion) BUT durErr p80 17→19 %, dirty 1.81→1.88, AC
flat 17. REFUSE (fails the u-turn goal + a small duration regression). Reverted to 0.6 (byte-identical).
The u-turns are geography, not an anchor-placement bug; R21-4's u-turn DISCLOSURE (shipped) is the honest
mitigation. A genuine reduction would need multi-lobe / grand-tour restructuring for far-reach origins
(the plan's sketched "grand tours" — a larger separate effort). BREADCRUMB: the rounder-loops finding
(loopiness lifted via return-anchor GENERATION, no demotion) is the promising lever for the deferred
R21-1 shape follow-up — shape is fixed by generating rounder loops, not by demoting thin ones.

**BD-67 — R21-3 twisty efficacy: the core issue is LARGELY FIXED by R21-0(a); the "not much twist"
disclosure REFUSED as dishonest-risk (2026-07-20).** Measure-first (paired default vs twisty over the
20 region towns, post R21-0(a)+R21-5): twisty is now BETTER than default in 14/20 towns (Hamilton
0.99→1.35, Newmarket 0.62→1.71, Milton 0.77→1.60, Peterborough 0.59→1.54) — R21-0(a) removed the
closed-ring poison that was INFLATING some defaults (Hamilton default 1.58→0.99), so asking "twisty" now
reliably helps wherever twist exists. The audit's #1 "twisty worse in 6/20" is down to small-magnitude
flat-town cases: the 6 residual (Cobourg 1.14→0.75, Uxbridge 0.70→0.57, Orangeville, Stratford, Simcoe,
Fergus) are flat farm towns where BOTH drives are honestly mediocre (0.57-1.14); twisty mean 1.03,
10/20 ≥ 1.0.
DISCLOSURE REFUSED: a "the roads around here don't offer much twist — this is the curviest loop they
support" note (fires when a twisty ask yields curviness < 1.0) was built + probed, but it CONFLATES
flat-roads with planner-underperformance and can state a FALSEHOOD — it fired for Belfountain
(escarpment country by Forks of the Credit, where the 48-brief suite yields twisty curviness 1.92) whose
roads DO offer twist but whose 90-min loop from that exact origin came out gentle. A causal "the roads
lack twist" claim cannot be honestly attributed from the result curviness alone (Hard rule: never claim
false). Reverted byte-identical to R21-4; backend 295/295, tsc/prettier clean.
RANKING FLOOR (never-worse-than-default) DEFERRED: needs a 2nd default-costed planner pass (~2× latency)
to shave ~0.1 off 6 flat towns where neither drive is good — not worth it. Residual flat-town mediocrity
is a structural limit (flat farm country genuinely lacks twist), honestly left as-is; a real lift is
generation-side (richer twisty retrieval in sparse areas) — future work.

**BD-68 — R21-0(b): DUAL-FLANK segment urban_share ADOPTED — the parcel-gap blindness fix
(2026-07-20).** Buffer-0 urban_share (R19) measures only the fraction of a segment INSIDE built
polygons; OSM industrial/business-park parcels are mapped with GAPS at the road, so curvy urban
collectors read ~0.00 and slip the R19 retrieval filter (the general class of the Standish blindness —
0013 catches only its closed-ring form). Built a faithful PostGIS port of urban.ts isUrbanContext
(dualflank_urban_share, migration 0014: a point is urban if INSIDE built OR both ±120 m perpendicular
flanks are built; segment share = fraction of ~60 m-spaced points). VALIDATED — ground-truth CLEAN:
Forks of the Credit / Hockley Road (rural secondary) stay 0.00; Hockley Ave/Path/Place (subdivision)
0.88-1.00; the function scores Standish's geometry 0.89 vs buffer-0 0.00 (Standish itself stays
ring-excluded by 0013). RECLASSIFICATION: of 3,095 high-curv retrievable segments, 314 that buffer-0
rated < 0.2 are built-surrounded (> 0.6) — a 22-sample is ALL genuine urban/industrial roads
(Mississauga city-centre, Argentia/Palladium/High-Tech/Bass-Pro-Mills industrial, Oxford/Bathurst/
Lawrence arterials), ZERO rural. Retrievable pool 12,337 → 10,514 (−1,823, −15 %).
A/B (48-brief, buffer-0 vs dual-flank, both FLOOR=1): no-route 0/48 FLAT (the −15 % pool did NOT starve
— removed material was collectors, not drives); dirty units mean 1.81 → 1.38, max 18.06 → 11.77 (routes
MUCH cleaner — urban collectors as waypoints force u-turns/overlap/residential); urban p80 15 → 13 %,
arterial 74 → 72 %, curvy p20 0.02 → 0.04. Cost: AC 17 → 16 (Port Perry + Stratford lose the
≥4-distinct bar — but the dropped "options" were fake urban collectors, an honest reduction; Smithville
gained), mean presented 3.4 → 3.2, durErr p50 10 → 12 %. ADOPT: substantial route-cleanliness + the
general blindness fix (Standish-class + the Newmarket #14 collectors) outweigh a small coverage/duration
cost — for a "special drive", cleaner beats one extra fake option; distinct from R21-1 (which DEGRADED
essence), here quality IMPROVES. backend 295/295, db 30/30, determinism e9f6cac9786e27d6. Deploy: apply
migrations 0010-0014 + landuse load + dual-flank urban_share compute at hosted Supabase. Rollback:
re-run the buffer-0 form of data/compute_urban_share.sql. Config freeze at R21-7 (frozen-r21-v1).

**BD-69 — R22-1 "twisty = a curvier notch" via a higher retrieval θ: REFUTED as INERT (2026-07-20).**
The post-R21 audit's headline issue: a Twisty ask returns a byte-identical route to the Backroads
default on 67/70 origins. Exploration pinned the shared knob as the fixed retrieval THETA_CURVY = 0.6,
so the plan (owner chose "a curvier notch") gave the twisty bundle a higher θ (0.85) to retrieve a
curvier pool. A/B (48-brief, θ 0.6 vs 0.85, R22-1 code both sides): **0 of 12 twisty briefs changed —
byte-identical (both hash 129ab3f744330649).** MECHANISM (DB-verified): `planner_find_curvy_roads`
returns the top `SEGMENT_LIMIT_PER_RING = 300` segments ORDERED BY curviness DESC — in a rich scope
(Hamilton-area: 582 segments ≥ 0.6, 498 ≥ 0.85) the **300th-curviest already sits at curviness 1.87**,
so the effective floor is ~1.87 and raising θ from 0.6 to 0.85 (or anywhere below ~1.87) removes
NOTHING; in sparse scopes a higher θ would only STARVE. So a retrieval-floor lift cannot make twisty
curvier — the curviest material is already returned first. REFUSE; θ code reverted byte-identical
(bundles.ts/run.ts/loop_quality.ts back to frozen-r21-v1; backend tsc clean).
IMPLICATION: twisty ≡ backroads is NOT a retrieval-floor gap — both retrieve the same curviest-300 AND
the generator picks the same best cluster/roads (bundles only re-rank post-geometry, the R18-4-proven
inert path). A genuine "curvier notch" needs a GENERATION lever (force a twisty ask to DRIVE more of
the curvy roads it already retrieves, or prefer the single curviest cluster) — bigger than a θ knob and
carrying the u-turn/undershoot failure modes that got triples/chains refused (round 5, BD-40). The
choice of lever (or accepting twisty ≈ backroads as the same honest "good roads" intent) is escalated
to the owner. Env note: a machine reboot between R21 and R22 shifted the deterministic baseline
e9f6cac9786e27d6 → 129ab3f744330649 (Valhalla/DB restart); the hash is STABLE within the session
(OFF=ON), so post-reboot A/Bs remain valid.

**BD-70 — R22-1b: "Twisty" differentiated by a CURVATURE-EMPHASIZED cluster/road ranking — ADOPTED
(2026-07-20).** After the θ-floor notch was refuted (BD-69), the owner chose "prefer the twistiest
roads." A `curvyRank` flag on GenerateOptions (OFF = default weight ranking, byte-identical) carries a
twisty-only generation lever; two variants measured:
(1) MAX single-road curviness (rank clusters by their twistiest road) — REFUTED: mean twisty curviness
0.74→0.70 (DOWN), introduced u-turns (Waterdown 2.99→1.97 + u-turn; Collingwood), and flattened the
canonical brief (Hamilton twisty-with-coffee curviness → 0, e2e red). It optimizes a single road's
twistiness, but the audit metric is the route's length-weighted MEAN — a twisty road amid flat
connectors LOWERS the mean.
(2) CURVATURE-EMPHASIZED weight (rank clusters + the driven road by Σ curviness²·length·class, vs the
default Σ curviness·length) — ADOPTED. Keeps curvy-KM (curvy CONTENT) but tilts toward curvier roads.
A/B (48-brief twisty briefs, curvyRank OFF = frozen-r21-v1 vs ON): mean twisty curviness 0.74→0.81
(+0.07), 2 up / 0 down (Guelph 1.07→1.32, Stratford flat 0→0.52), no-route 0/48, AC 16→17, e2e 5/5,
backend 295/295. MODEST BY CONSTRUCTION: retrieval is already curviest-first (BD-69) and the default
already balances curviness×length, so a curvature tilt has a bounded ceiling — it helps where curvier
material exists to prefer (Guelph, Stratford) and is correctly inert where the material is fixed
(Hamilton flat). One marginal new u-turn (Collingwood, already a u-turn brief). TWISTY_CURVY_RANK=true
(run.ts) gates it; OFF byte-identical. TRAVERSE_MIN_M hoisted to module scope (candidates.ts). The
twisty-vs-backroads gap (audit-v5 showed them identical on 67/70) is re-confirmed at R22-5's re-audit.
Config → frozen-r22-v1a. Rollback: TWISTY_CURVY_RANK=false.

**BD-71 — R23 "Great Drives Near You": the owner reframe (2026-07-22).** After audit-v6 (70 random
origins) showed R22-1's Twisty is a coin-flip and 30% of default loops come back flat, the owner directed
a concept change (three decisions): (1) DISCOVERY reframe — a new Discover tab surfacing the region's best
roads reachable from you, AUTO-RANKED from the corpus (not a loop-from-home generator); (2) COLLAPSE
Twisty/Backroads/Simple → one 2-stop Direct/Scenic-backroads control; (3) AI MINIMAL — buttons own their
knobs, the prompt fills places+vibes. This RESOLVES the BD-69/BD-70 escalation ("which twisty lever?" →
the owner chose to DROP the twisty tier entirely and add discovery). Designed + adversarially hardened by
six subagents (three explorers, one backend design pass, two critics). Sub-decisions BD-72..76.

**BD-72 — Discovery mode (discoverDrives + POST /discover + tap; 2026-07-22).** Auto-ranked from the ~10k
curvy corpus, NO curated table. Pipeline (backend/src/planner/discover.ts): getIsochrone(60-min reach) →
retrieveCandidates(segmentLimit 5000) → mergeRoadPieces (whole roads) → value rank (curviness SATURATED
at 3.0 · length · classFactor · (1−0.7·urban)) → bearing-sector spread (8 sectors, quota 3, 1500 m dedup,
cap 24 = the matrix budget) → ONE travelMatrix (real drive-times, BACKROADS costing) → menuScore =
value·(1−0.5·min(1, toStart/reach)) → 4000 m menu spread → 8-12. **Shape split (owner: loops nearby,
out-and-back far):** a far road's LOOP balloons unpredictably (Kimberley→10th Line 294-309 min, unfixable
by any duration param — the loop generator won't retrace), so near (≤20 min out) = a loop via runPlanner
(through-pin + computed budget); far = a DIRECT out-and-back (out_and_back.ts: routeThrough
origin→entry→exit→origin, ~2·out+road, predictable). NearbyDrive.kind carries it. discover_quality
baseline 7/7 origins (full spread curvy menus, on-road 92-100%, det Y); golden-fixture determinism
(discover.test.ts 8/8). Byte-identical off = endpoint unregistered → 404. The deep retrieve (5000) +
saturation resolve the urban-adjacent starving WITHOUT per-sector tiling (tiling = documented fallback).
Params frozen in eval/params-frozen.json (frozen-r23-v1). No LLM, two bounded Valhalla calls (Hard rule F);
LLM emits no geography (Hard rule A).

**BD-73 — 2-stop drive-control collapse (2026-07-22).** Twisty/Backroads/Simple + the Mostly-backroads
toggle → ONE 2-stop control: Direct (=simple) / Scenic backroads (=backroads, default). App-side ONLY
(plan_draft.ts + PlanScreen.tsx); Direct keeps the old Simple's twistiness_pref 0.15. The backend `twisty`
preset is RETAINED in PresetSchema for parity (a typed "twisty" brief still parses; with R22-1 off it
behaves ≈ backroads via the BACKROADS costing profile) — **do NOT remove it.** BD-30 preserved (discrete
chips, sliders still deferred). PlanDraft is in-memory (PlanStack useState) — no persisted-'twisty'
migration needed. App suite 129/129.

**BD-74 — R22-1 twisty curvy-rank ROLLED BACK / BD-70 REVERSED (2026-07-22).** TWISTY_CURVY_RANK=false
(run.ts). Audit-v6 (random origins) showed the lever is a coin-flip (+8 / −7; Terra Cotta 1.18→0.00), and
the owner collapsed the twisty tier, so no twisty ask remains. Same-session 48-brief A/B: **ON hash
fbec02d22906a45a (17/48 AC) vs OFF hash 129ab3f744330649 (16/48 AC)** — the flag moved the fixed bench
(marginally better, why BD-70 adopted it) but the random-origin audit exposed the coin-flip. OFF is the
pre-R22-1 baseline (rankVal → c.weight; byte-identical BY CONSTRUCTION). Plumbing left dormant (BD-40
re-runnability, the CHAIN_CANDIDATES_ON precedent). Config frozen-r22-v1a → **frozen-r23-v1**.

**BD-75 — AI-minimal: app-copy relabel ONLY (2026-07-22).** No backend parse change → **no BD-28 bump.**
The "90-minute twisty loop" example was the APP placeholder (PlanScreen.tsx), not PARSE_SYSTEM_PROMPT.
Relabelled the Plan brief to places+vibes ("Add places or a vibe"; placeholder "…through the Forks of the
Credit, ending near Elora — quiet and scenic"). Precedence (buttons win, prompt fills gaps) already lived
in plan.ts:501-562 — no code change; tests: a button preset overrides the parsed preset; an untouched
avoid toggle never clears a brief-parsed avoid. parse_prompt_version stays 3; the backend parser is
byte-identical.

**BD-76 — R23 re-audit (audit-v7) + program verification (2026-07-22).** audit-v7 on the SAME seeded 70
origins as v6 (continuity). Arm 1 = the shipped Backroads default loop; Arm 2 = the Discover menu + the
top drive tapped and routed. **Result: every origin (70/70) gets a FULL Discover menu (mean 11.9 drives,
70/70 ≥ 8, 0 empty); top-3 curviness 2.56 vs the Backroads-default mean 1.00; the tapped drive is driven
at 97% mean on-road (66/70 ≥ 80%); 12% of top drives are loops, the rest honest out-and-backs.** The
reframe's headline: origins whose Backroads default came back FLAT (Mansfield/Cookstown/Warkworth/Acton/
Colborne/several Brampton at curviness 0) now surface a full menu of genuinely-curvy reachable roads —
the v6 flat-country gap, closed. Owner artifact (before/after):
https://claude.ai/code/artifact/57ab6f14-aa9b-4552-b6ab-400970a1d4ba. **Program totals:** 14 units,
backend 316/316, app 129/129, whole-repo tsc clean, loop-quality byte-identical (129ab3f744330649),
discover_quality baseline 7/7. Config frozen-r23-v1. [HUMAN] remaining: device pass; ratify BD-71..76;
run the one-line commits; migrations 0010-0014 at hosted deploy (discovery adds none).

**BD-77 — R24 "The Perfection Pass" owner decisions (2026-07-22).** Owner-directed after audit-v8
(40 loops + 15 A→B + 10 Discover) + 3 expert analyses. Six owner calls drove the 18-unit program:
(1) Discover becomes the PRIMARY/home tab, Plan-loops stay; (2) Discover menu curated · pre-built ·
consistent; (3) out-and-back for ALL Discover drives (loops only in Plan); (4) Discover home map-first;
(5) loop planner = full rebuild attempt (adopt-or-refuse); (6) AI recast to places & time + a visible
parse; plus rename "Scenic backroads" → "Fun & Explorative". Discipline unchanged: every lever
flag-gated byte-identical OFF + pre-registered A/B (BD-40); LLM emits no geography; /discover stays
browsing-class. Config → frozen-r24-v1.

**BD-78 — De-switchback loops: significant_turns_per_km + curvature saturation (R24-U1, ADOPTED τ_ref=8).**
The loop generator ranked road MATERIAL on RAW circum-curvature, chasing tight subdivision/park
switchbacks (the owner's "weaving into neighbourhoods for pointless curves, wayyy too many turns"). Fix:
`effectiveCurviness = min(curviness, 3.0) · flowFactor`, `flowFactor = clamp(τ_ref/max(τ, τ_ref), 0.3, 1)`
from `significant_turns_per_km` — computed + stored since migration 0001 but DROPPED at planner_reads:48
(now surfaced through CurvySegmentRow → CandidateSegment → mergeRoadPieces length-weighting). Re-prices
segValue/clusterEmph/byValue (candidates.ts), pickInsertSegment (loop.ts), span-pool + corridor value
(chain.ts). Corpus-calibrated (good drives ≈ 3 turns/km, p80 ≈ 6; switchbacks curv>4 ≈ 13-21). **τ_ref=8
ADOPTED over 6** by the 48-brief A/B: τ_ref=6 over-penalized fine 6-8 turns/km roads (urban UP vs
baseline); τ_ref=8 keeps flowing roads at full value and still discounts real switchbacks to ~0.38-0.62.
Result vs OFF: AC 16→20, |durErr| p50 11→9%, urban p80 13→10% (mean below baseline), curvy 0.10→0.11,
microloops 4→3, corridor-doubling p80 0.16→0.11. OFF (CURV_SATURATION=off) byte-identical
129ab3f744330649; ON 521c0078a123abee. Residual: self-overlap rose on a few briefs (soft, under cap —
the anti-retrace that the refused loop rebuild would have addressed).

**BD-79 — Discover: out-and-back-only · curated · pre-built · map-first · classics · repetition fix
(R24-U3..U11, ADOPTED).** Reshaped per BD-77. (a) OUT-AND-BACK for every Discover drive (dropped the
R23 near-loop/far-oab `kind` split): pre-buildable, predictable, uniform; a pre-built loop would run the
money-spending planner behind an unauthenticated browse endpoint (forbidden). (b) Curated 5-6 (was 8-12),
SECTOR_QUOTA 3→2, auto pool ≤16. (c) PRE-BUILT: each menu drive's out-and-back routeThrough'd in
Promise.all → real measured total (instant tap opens Result directly via nearbyDriveToRoute, no /plan);
per-drive failure keeps the corpus estimate. (d) CLASSIC blend: the 8 hand-picked seed classics
(discover_seed_drives SECURITY DEFINER RPC, migration 0015, public+seed only) merged into the SAME
matrix; curviness MEASURED from geometry (seeds store 0); classics traced with interior through-points on
the pre-build so the route follows the curated line; CLASSIC_BONUS 1.15 (1.3 crowded the menu + pinned
#1). (e) REPETITION fix: origin-relative proximityTier (1.0-1.15 on the real per-origin drive-time) +
real drive-times → menus differ by area (the R23 origin-invariant bug fixed; a dominant classic
legitimately tops its whole radius). (f) MAP-FIRST: shared DriveLinesMap (extracted from MapHome — the
amber line can't drift), Discover the primary tab. discover_quality R24: 5/7 origins pass all bars,
repetition cohort 2/2, all pre-built; 2 misses = seed-classic line fidelity on long seeds (Hockley Valley
averages gentle) — seed-DATA, flagged [HUMAN] content-curation, not a pipeline defect.

**BD-80 — AI: places & time + a visible parse (R24-U12/U13, ADOPTED; no BD-28 bump).** The free-text
brief was mandatory and duplicated the buttons while being the only home for named places + a time
budget. R24: (a) the brief is OPTIONAL — the buttons plan a fine drive alone (relaxed plan_draft +
plan.ts schema minLength 0); an empty brief costs ZERO model spend (parseBrief short-circuits trivial
input to the rules parser — Hard rule F). (b) A "How long" time control (chips 45 min → 2.5 hr, loops
only) — there was no time control before; composes to duration_target_s. (c) A "here's what I understood"
chip row on Result (places · time · style · avoids), deterministic + zero-LLM (parseChips), editable via
the existing RefinePanel. Tier-1 only; parse_prompt_version stays 3, backend parser byte-identical, no
BD-28.

**BD-81 — Loop path-search rebuild: REFUSED (R24-U14/U15, 4th loop-chain refusal, 2026-07-22).** The
prior refusal (BD-40 / round18_3) named "richer span material" as the plausible lever; U1's de-switchback
RE-PRICING (effectiveCurviness) is exactly that. Pre-registered 48-brief A/B vs the U1 τ_ref=8 baseline
(CHAIN_CANDIDATES=on): curvyShare 0.11→0.12 (+1 pp; PRIMARY bar ≥ +10 pp — the SAME +1pp miss a 4th
time), arterial share FLAT 71→70%, wall 8665→14980 ms (kill-condition ≤ +1-2 s). AC did rise 20→24, but
the PRIMARY curvyShare bar + the latency kill both fail. ROOT CAUSE (structural, not a pricing miss): the
CONNECTORS between scattered curvy spans ride arterials, so no span re-pricing, ordering, or hard
angular-monotone closure moves the arterial share — the beam-search rebuild would hit the same wall, so
LOOP_PATHSEARCH_ON was NOT built. Loop quality ships on U1's de-switchback alone. CHAIN_CANDIDATES_ON
stays env-gated default OFF (byte-identical); AC +4 recorded as a possible future NARROWER-application
lever for the human.

**BD-82 — A→B audit + tune: Schomberg no-route FIXED, detour-cap loosening FALSIFIED (R24-U16).** The
audit-v8 A→B offenders re-run through atob_quality (+ the offender briefs added). Two no-routes were
GAZETTEER gaps (destination left as an unresolved string): Aurora→Schomberg FIXED by adding Schomberg to
the gazetteer (44.0119, -79.6793, from the OSM POI corpus) — now routes; Peterborough→Bancroft correctly
stays out-of-region (Bancroft north of 44.95°). The arterial-heavy A→B (~⅓ ride arterials, mean 83%):
hypothesis was the detour cull (DETOUR_MAX_DEFAULT 1.8×) rejects curvy corridors — FALSIFIED by the
15-brief A/B (loosening to 2.2× left arterial share UNCHANGED at 83%, curviness even dipped 0.96→0.94; the
extra distance is more arterial, not more curvy). Same structural cause as the refused loop chains
(BD-81); kept 1.8. U1 de-switchback re-pricing already applies to the corridor spans.

**BD-83 — R24 re-audit (audit-v9) + program verification (2026-07-22).** Cross-section confirmation on
the final config, before/after artifact
https://claude.ai/code/artifact/ef98b655-fa22-48de-a0a2-5892afc13932 (6 loops + 18 Discover drives
captured live). Loops de-switchbacked (AC 16→20, microloops down, urban down); Discover curated ·
pre-built · instant · map-first with distinct menus per area + classics blended (discover_quality 5/7,
repetition 2/2); A→B no-route fixed, arterial-heavy structural. Program totals: 18 units — 13 shipped, 2
refused (BD-81 loop rebuild, BD-82 detour cap), 3 verified fixes; backend 319/319, app 140/140, shared
23/23, whole-repo tsc clean. Config frozen-r24-v1 (eval/params-frozen.json). [HUMAN] remaining: device
pass (Discover map-first → tap a classic → instant real route; a Plan loop with fewer turns; the
places+time prompt + visible parse); ratify BD-77..83; run the one-line commits; migrations 0010-0015 at
hosted deploy (0015 = discover_seed_drives); restart the running backend to serve R24 /discover.

**BD-84 — The avoid system was INERT; made real (R25-U2, ADOPTED 2026-07-26).** Probed live on
kimberley→markdale (pinned Valhalla 3.7.0): `exclude_highways` / `exclude_tolls` / `exclude_ferries` are
byte-identical to a deliberately-bogus control key — Valhalla silently ignores unknown auto-costing
options, so the app's "Avoid highways" toggle changed NOTHING about routing, ever. Only `use_highways: 0`
works, and `shortest` bypasses every soft use_* factor (verified twice). Fix: `realizeCostingOptions()`
(route.ts + matrix.ts, flag `AVOID_REAL_LEVERS` default ON) translates exclude_highways → `use_highways:0`
+ drops `shortest`; tolls→`use_tolls:0`; ferries→`use_ferry:0`; 4 regression tests pin the translation so
this cannot silently rot again. CORRECTION TO OUR OWN EVIDENCE BASE: eval baseline B1
(`{exclude_highways:true}`) has been byte-identical to B0 all along — every published B0-vs-B1 comparison
is void. Companion truth fix (R25-U4, flag `TRACE_HIGHWAY_TRUTH` default ON): Valhalla's summary
`has_highway` misses `trunk` (reported false on a route the trace measures at 33% trunk — Hwy 10/26/89
ARE highways to a driver), so `has_highway` is now overridden from the traced edges (the has_unpaved/R16-2
precedent), fixing validate/assertAvoidHonoured/disclosures in one place.

**BD-85 — Fun & Explorative excludes highways via MEASURED rejection, floor 600 m (R25-U3v2, ADOPTED
2026-07-26).** Owner decision: hard-exclude highways on Fun + Discover, never A→B. v1 (impose the avoid
into the COSTING at ladder-init) was A/B-REJECTED by its own pre-registration: hwy 1.6→0.3% but
backroad 27→21% / main 70→77% — pushing use_highways:0 region-wide destroyed `shortest`, the backroad
lever (the probe predicted this: Acton–Georgetown 48%→0% backroad under use_highways:0). v2 keeps
`shortest` for imposed avoids and enforces at ASSEMBLY: traced highway metres > floor → reject (clean
pool-mates win; rung-4 relaxes with the honest "this area has no non-highway route at this length"
disclosure); only a USER-asked no-highways changes the costing. Floor swept, not guessed: 200 m → AC
20→18 (Waterdown pushed onto 10% residential; Collingwood twisty flattened — a 300-600 m trunk hop
linking backroad sections was treated like a 30 km motorway run); 600 m → AC 20 (=baseline), hwy mean
1.6→0.3% (12→7 routes >0, remainder legacy/fallback-by-design), defects/route 2.08→1.90, durErr p80
18→16%, shape defects 10→5, wall +141 ms (fixed suite, hash 83e23648d271b639); SUITE=random confirm vs
its own levers-off baseline: AC 7→9/30, hwy 3.4→0.3%, hood-run p80 5986→2053 m, defects 2.43→2.17,
no-route flat 3=3 (hash 497ed18edfbe7da7). HONEST COSTS, recorded: backroad 27→26% (−1 pp); main on the
random suite 64→70% (freed highway/hood metres land on main — the U10/U19 target); Belfountain +
Orangeville twisty briefs FLATTEN (curv → 0.00 — their twisty pools carry >600 m of Hwy 10 trunk; pool
starves to flat survivors). That is a GENERATION gap assigned to U19/U20, not a reason to re-admit
multi-km highway runs. Discover rides the same exclusion (matrix + pre-build costing).

**BD-86 — The neighbourhood gate, un-blinded (R25-U5, a+b+d ADOPTED · c REFUSED, 2026-07-26).** Audit
issue #5: the residential gate was blind three ways (2.5 km grace hiding 36% of hood metres; class ===
'residential' only — service/living_street invisible; share-only rejection). ADOPTED, default ON:
(a)+(b) HOOD_MEASURE_V2 — wide hood predicate (residential/service/living_street/… + hood-grade uses) +
grace 2500→700 m, judged TOGETHER per pre-registration (apart, each looks like a false regression).
(d) OFFENCE_SCALE_V2 — residential overflow ~8 pts/m-scale instead of 1 (a 1.3 km weave no longer weighs
less than one u-turn) + residential-first repair targeting. PLUS two mechanism repairs the A/B itself
exposed: DIRTY_GRADE_CAP 4.5 SATURATES in all-dirty pools (measured: St. Jacobs presented a
19.1%-residential winner over a 7.2% pool-mate on a 0.07 score edge — min(4.5, 8.24×1.5) vs
min(4.5, 2.79×1.5) differ by 0.31) → DIRTY_GRADE_CAP_V2 = 30 with the tier-order proof asserted in BOTH
flag states; and the soft bars are RULER-RELATIVE — 0.05/500 m were calibrated for the narrow measure, so
keeping them under the wide one was an unregistered ~1.5-2× tightening (paired Milton probe, same winner
id: run 458→584 m, share 1.5→3.5%) → V2 bars 8%/800 m, V1 values byte-identical under
HOOD_MEASURE_V2=off. FINAL A/B vs the U3 baseline (83e2): AC 20→19 (bar ≥18 ✓; the 3 down-flips are
measurement truth — St. Jacobs' pool is genuinely ≥7% residential after highway rejects; St. Thomas
traded a HIDDEN >500 m hood run for a clean-but-late route, correctly; 2 up-flips from better repair
aim), no-route 0 ✓, hood run max 7895→5563 m, p80 1954→1468 m, dirty units 2.04→1.19, loopiness p20
0.18→0.21, wall +435 ms, hash c5fd7d6cf7f178b1. REFUSED: (c) HOOD_HARD_RUN 1500 m assembly reject — hit
its pre-registered kill EXACTLY as the round-6 precedent warned (no-route 0→2, AC −5, wall +2.2 s;
stacked-run hood wins of max 2045 m were bought with starvation); demoted to presentation-only per plan
(the V2 pricing already puts a 7.9 km weave ~22 points down inside the dirty tier), flag stays opt-in.
Random-suite confirmation leg recorded alongside (r25_lq_u5_rand).

**BD-87 — Duration wild-miss tier ADOPTED · third resize REFUSED (R25-U7, 2026-07-26).** Audit issue
#12: 7/60 loops over the asked time by >25%, worst +93% ("asked 60, got 116") — those won because every
pool-mate was durOff and the flat −100 tier couldn't separate +30% from +93%. DUR_HARD_TIER (default ON):
beyond a 50% miss a SECOND −100 stacks (total −200) — a wildly-over route wins only when nothing closer
exists, and the overshoot disclosure now says "well over" instead of the lie "a bit over" past the same
bar. A/B vs c5fd: hash BYTE-IDENTICAL on the fixed suite — the current config produces no >50% misses, so
the tier is a proven-zero-collateral safety net for the audit-class pathology (tier stacking proof-tested
in score.test.ts in both flag states). RESIZE_ATTEMPTS_3 REFUSED: no brief on either suite reached a
third resize — adopting an unexercised lever that costs engine calls when it fires would be evidence-free;
stays opt-in, revisit if audit-v12 reproduces overshoots.

**BD-88 — Backroad mix grade: CONTINUITY half ADOPTED @ 12 km target · MAJORITY half CANCELLED
(R25-U1/U10, 2026-07-26).** The U1 diagnostic (12 briefs, per-pool decomposition, pre-registered
verdict rule) measured within-pool SD(backroadLongestM) REAL on 11/12 briefs (1.5-10 km — pools
genuinely contain one-long-stretch vs many-fragments variants) while SD(backroadShare) cleared its bar
on only 3/12 (rq11's curse persists: most pools straddle nothing, 8/12 briefs have ZERO backroad>main
candidates). Per the pre-registration the MAJORITY grade is CANCELLED — inert material, its job moves to
U19 generation — and the CONTINUITY grade is built: presentationKey −
CONTINUITY_GRADE_MAX·clamp01((TARGET − backroadLongestM)/TARGET), max 6 (declared in the proof budget),
unknown = FULL deduction, `simple` exempt, NOT loop-gated (U6e: A→B needs it — measured, hamilton→guelph
90 %-main winner beat a 51 %-main clean contender by keyGap 0.02 with nothing rewarding mix). Target
swept, not guessed: 8000 zeroed the gradient at the pool mean (+781 m, under the bar); 12000 graded the
whole pool: longest mean 9522→10600 m (+1078 ≥ the +1000 bar), p20 5429→5989, backroad 26→28 % (p20
+3), main p80 87→84, curviness EXACTLY held (the BD-62-class kill bar), AC 19=19 same brief set,
no-route 0, hood flat, wall −656 ms (hash 7364021dd366ea13). Default ON.

**BD-89 — A→B keeps what it builds (R25-U5e/U6, four flags ADOPTED, 2026-07-26).** Audit issue #6
(hamilton→guelph built a 61 %-arterial chain and shipped 89.5 %) was decomposed FIRST (U6a, onScored
observability + pre-registered branches over 15 briefs): no_contender 6 (the pool holds nothing better —
generation-bound, U19's job, said plainly) · culled 4 (2 = the PRE-EXISTING Cambridge→Paris /
Aurora→Schomberg planner give-ups, present in the session-start baseline b7c77d; 1 = Bancroft
out-of-region by design) · no-mix-reward 3 (fixed by BD-88's continuity grade — measured: 90 %-main
winner over a 51 %-main clean contender at keyGap 0.02) · dirty-flip 2. NOTE: the ADOPTED default stack
(V2 hood measure + continuity grade, neither loop-gated) had ALREADY moved A→B before these flags:
arterial 83→76 %, main 80→72 %, backroad 16→23 %, longest backroad run 7841→11017 m (new baseline
7120a765c57497b7). The four flags then: ATOB_PREDICT_V2 (fills sized so straight-line prediction ×
CORRIDOR_ROAD_FACTOR 1.3 fits UNDER the untouched 1.8× cap — 1.35×1.3=1.755; ladder 2→4 entries; NOT
BD-82's refused cap loosening — the cap stays, the prediction stops lying), ATOB_REPAIR_VALUE_AWARE
(drop by detour-per-unit-VALUE — blind drop amputated the curviest span; floor 1→2; an ACCEPTED chain is
never DROP-repaired), ATOB_ASSEMBLY_RELAX (rung 5 finally reaches A→B — self-overlap only, never
detour), ATOB_GATES_V2 (graced self-overlap + V2 residential parity). A/B vs 7120: one brief transformed
(Milton→Elora no-highways: arterial 72→59 %, curv 1.13→1.21 — the chain survived), aggregates
uniformly +: backroad 23→24 %, longest 11017→11692 m, main 72→71 %; routed 12/15 =, u-turns 1 =,
hwy =, wall +58 ms; zero regressions (hash e4ae43d051bcd2af). The remaining A→B main share is
POOL-BOUND per the diagnostic — assigned to U19, not to more ranking knobs.

**BD-90 — Unmeasured-is-dirty ADOPTED · turn-density grade REFUSED (R25-U8c/U9b, 2026-07-26).**
TRACE_NULL_STRICT (default ON): a failed trace now flips the dirty clause AND costs 2.0 offence units
(was 0.5 — half a u-turn), so an unmeasured route can never outrank a measured-clean pool-mate (audit
issue #13). A/B vs the U10-adopted config: per-brief PASS/FAIL set IDENTICAL, AC 19 =, defect tallies
identical incl. unmeasured×1 — the only movement was the honest accounting (dirty units mean 1.24→1.27);
zero selection cost, invariant gained (hash e216d28335da10f8). TURN_GRADE (U9b) REFUSED on its
pre-registered primary bar: briefs over 5 turns/10min stayed 4/48 (bar ≤3) — the four turn-heavy pools
contain NO clean under-5 alternative, so a presentation grade has nothing to choose (BD-62's lesson,
third confirmation: a presentation tool cannot fix a generation property). What it DID move is recorded:
worst best-route flow 8.1→6.1 turns/10min, curviness EXACTLY held; costs: backroad 28→27 %, defects
1.94→1.98. Stays opt-in (TURN_GRADE=on) as measurement-backed safety; the flow tail belongs to U19/U20
generation. turnsPer10min remains a first-class measured output everywhere (U0).

**BD-91 — Discover Stage 1: gates BUILT + measured; production default stays OFF pending the core
index (R25-U11, 2026-07-26).** Audit issue #4 (180 pre-built routes, ZERO validations) is answered in
code: DISCOVER_GATES 'report'|'strict' — cheap pure detectors (uturns/spurs/microloops) then ONE trace
per survivor; highway metres (600 m floor) / residential >20 % / offences DROP in both modes with
COUNTED disclosures ("2 had highway on the way — not shown"); self-overlap + connector-share
disclose+DEMOTE in report, drop in strict; the refill loop is DELETED under gates (it re-added drives
ignoring the separation rule); classics leave the ranked menu (owner decision); the tap's wasted Haiku
parse is KILLED unconditionally (test pins 0 LLM parse calls); NEW pure `reversalPositions` detector
catches the middleType:'through' block-circle that uturnCount misses (5 tests). MEASURED (discover
_quality ×4 runs): the plan's warning materialized EXACTLY — the provisional 8 km road floor emptied
7/7 origins (median merged road 4.6 km; the 8 km number was written for the core-index era); at a 5 km
floor, report mode fills honest menus (2-5 drives, 100 % pre-built, 0 classics), FIXES the repetition
cohort 2/2 (jaccard 1.00→0.75/0.50 — the no-refill separation rule working), at the cost of smaller
flat-origin menus (5/7 origins under the R24 menu≥5 bar) and top3curv 2.9→1.1-1.5 (the floor removes
short-but-supercurvy roads). DISPOSITION: gates stay opt-in (eval runs 'report'/'strict'; the golden
fixture pins both modes) rather than shipping 2-drive menus days before U13/U14's measured core index
replaces this path outright — Stage 1's deliverable was measurement + honest gates, and both now exist
behind one env. The 8 km floor returns with ribbon cores.

**BD-92 — The generation rebuilds: core-index machinery BUILT + kill-condition measured · anchor
sweep REFUSED · connector rebuild DEFERRED with its evidence staged (R25-U13/U19/U20, 2026-07-26).**
(a) U13 drive-core index: ACP-001 approved and recorded; migration 0016 (`drive_cores`, RLS
deny-by-default, SECURITY DEFINER pinning generator_version + highway_share=0) applied LOCALLY; ONE
rulebook `core_bars.ts` (6 tests) shared by sweep/live/eval; deterministic offline sweep + transactional
loader written; U14 v2 `/discover` three-leg browse behind `v:2` with the v1 branch TEST-PINNED (4+7
tests); U15 client layer + three-leg helpers (12 tests), app switch dark until an index is loaded.
SMOKE SWEEP (Hockley + Belfountain cells) ran end-to-end and returned the ACP's pre-registered kill
condition with the binding bars NAMED: main_share×15 · backroad_share×13 · loopiness×13 ·
assembly_rejected×7 · hood_share×2 — today's generator cannot produce ≥55 %-backroad cores even in the
twisty heartland. The per-cell relaxed profile (`bar_profile='cell_relaxed'`) stays specified-not-
implemented until the binding constraint moves. (b) U20a RETURN_ANCHOR_FRACTION sweep REFUSED on its
pre-registered primary bar: loopiness p20 FLAT at 0.20 for both 0.85 and 0.75 (bar ≥0.25). Recorded
honestly: 0.85 raised AC 19→22 (shape defects 7→4, timing 4→2) but bought it with backroad 27→25 % /
main 70→73 % — trading away the owner's core ask; 0.75 was strictly worse (AC 14, main_majority 42→47).
0.6 stays. (c) U19 connector rebuild DEFERRED, not attempted-and-rushed: the session's probes stand
(highway removal via two-stage sampling SOLID at +1.6 % distance; backroad share NOT pre-validated —
+11/0/−18 pp), the U13 histogram independently names backroad/main share as THE binding constraint, and
every instrument it needs is now staged (onScored decomposition, the sweep as its offline testbed,
per-span values, U0 truth metrics). It is the recorded headline unit of the next session — attempting
the program's least-certain rebuild at the tail of a 20-unit batch would produce neither an honest A/B
nor a proper record. Both U19 and U20b (anchor-point ring seeding) go together: they are the same
generation problem.

**BD-93 — The connector rebuild: REFUSED on its pre-registered bars — the 5th and best-instrumented
refusal of the family (R25-U19, 2026-07-26).** The one lever no attempt had cracked (~90-97 % of route
metres are Valhalla-free glue; BD-39/40/81/82 all re-priced around it). BUILT IN FULL this time, with
every discipline layer: (1) `connectors.ts` — dense (probe-frozen 3.5 km sampling) · monotone (snapped-
point projection, not just the sample grid) · corpus-snapped single-via steering (never the four-times-
refused span-forcing shape), backroad-class + effectiveCurviness-priced only, full stop/span index
maintenance, 11 unit tests. (2) A 3-lens adversarial design review (20 agents, the BD-62 tradition
scaled) CONFIRMED 5 real defects before integration — the same-segment "anti-zigzag" guard actually
MANUFACTURED weave and under-steered the flagship one-road case (the pinning test even blocked the
fix), cross-leg splices could produce the [P, w, P] block-circle 'through' hides from every detector,
snapped-point order could invert inside swept params, repair-based re-runs cost up to 18 engine
calls/finalist, and a strict presentKey keep-guard would have BLINDED the lever (the key has no share
channel — BD-88). All five fixed before judgment. (3) The falsify-first probe (6 live pairs × 9 combos,
the shipped code itself): RAW verdict REFUSED at the pre-registered median bar; GATED re-analysis
(the shipped accept-gate applied) median +2 pp — bimodal by corpus density, with the planning
prototype's −18 pp FAILURE case (Acton→Georgetown) flipped to **+14 pp at ×1.01 duration** — the
mechanism is REAL where corpus parallels the corridor, and both verdicts are recorded, not blended.
(4) Byte-identity: all new flags off reproduce the frozen hash e216d28335da10f8 exactly (also proving
the scoring-closure extractions pure). (5) THE A/B (CONNECTOR_REFINE=on, diversify-kept finalists,
plain assembleLoop, tolerance-guarded swap): backroad 28→29 % (bar ≥ +15 pp — missed by 14), longest
run +232 m, AC 19 = IDENTICAL brief set, no-route 0, no offence blowup — and wall 8.6-9.3 → 11.9 s
(bar ≤ +2 s — missed). Same shape as BD-81's "+1 pp vs +10 pp". ROOT CAUSE, now measured three ways:
suite loops already route THROUGH the retrieved corpus, so their connector legs offer little to steer;
the probe's big wins live on long bare corridors with dense parallel corpus. The integration stays in
the tree behind the default-OFF flag with its tests — a future re-registration (e.g. corpus-density-
gated refinement, or A→B-side application) is a product call the owner can make with these numbers.

**BD-94 — Ring seeding + shoelace gate: REFUSED as registered — and the rings' REAL identity is
recorded for owner re-registration (R25-U20b, 2026-07-26).** The generation half of the loop-shape
attack (BD-62/BD-92's consistent verdict that shape is a generation problem). Built: ROUND-4 ring
candidates (primary cluster span + two ANCHOR-POOL points near θ+120°/θ+240°, sparse rings skipped
honestly, additive beyond the candidate cap) + a free pre-routing shoelace gate, both flag-gated,
byte-identical off. MEASURED (fixed suite vs e216): (a) SHOELACE_GATE alone REFUSED outright — AC
19→15, no-route 0→1 (the kill condition), loopiness flat: at fraction 0.04 it kills candidates that
would have PASSED (the starvation risk its own comment pre-recorded). (b) RING_SEED alone: the
PRE-REGISTERED PRIMARY missed — loopiness p20 flat 0.20, shape defects 6→7 — so per BD-40 the lever is
REFUSED AS A SHAPE LEVER. But the honest record shows what it actually is: **the largest feasibility
jump in program history — AC 19→25/48** (previous bests: 16→20 over two whole rounds), up-flips
concentrated in the POOL-STARVED towns (Smithville, Port Perry, Campbellford, Georgetown, Erin,
Ancaster, St. Thomas), no-route 0, curviness EXACTLY held, timing defects 3→1, hood p80 1468→1158,
continuity p20 +383 m; costs: wall +1.1-1.8 s (over the ≤+1 s bar; RING_MAX=3 keeps AC 25 at ~+0.7-1.4 s),
shape defects +1, CLEAN 1→0, backroad p20 −1, one down-flip (Hamilton no-highways, overlap-heavy ring
pool). DISPOSITION: flags stay default OFF; adopting rings as a FEASIBILITY lever under a fresh
registration (suggested bars: AC ≥ +4 · no-route 0 · curviness ≥ 99 % · wall ≤ +1.5 s · shape defects
≤ +1, at RING_MAX=3) is the OWNER's one-word call — exactly the BD-81 "recorded for the human"
precedent, now with the strongest candidate that precedent has ever held.

**BD-95 (PRE-REGISTRATION, verdict pending) — Ring seeding, HOLDOUT confirmation on the random suite
(R25-U20b re-registration, registered 2026-07-27 BEFORE the run).** Why a holdout: BD-94's ring numbers
came from the FIXED suite, which I had already inspected — writing fresh bars against data already seen
would be circular (HARKing), so the confirmation must come from briefs rings have never touched. The
30-brief SUITE=random has never been run with RING_SEED on. Rings are re-registered here as a
FEASIBILITY lever (their measured identity), NOT as the shape lever BD-94 refused.
CONFIG UNDER TEST: RING_SEED=on, RING_MAX=3 (SHOELACE_GATE stays OFF — refused, BD-94).
BASELINE (frozen-r25-v1, random suite, hash `1aee2533b8b6fa95`): AC 9/30 · no-route 3/30 · curvy share
mean 0.12 · wall 10 646 ms · shape defects 7 · defects/route 2.00 · backroad mean 27 %.
ADOPT IFF ALL FIVE HOLD:
  1. PRIMARY — AC ≥ 12/30 (+3; the fixed suite gave +6/48, this is the conservative proportional ask);
  2. KILL — no-route does NOT rise above 3/30;
  3. KILL — curvy share mean ≥ 0.1164 (97 % of baseline — the BD-62 bar that killed every prior
     shape lever; rings must not buy feasibility with the fun);
  4. wall ≤ 12 146 ms (+1.5 s);
  5. shape defects ≤ 9 (+2).
ANY miss ⇒ rings stay default OFF and the fixed-suite gain is recorded as NOT GENERALIZING.

**BD-96 — Ring seeding: REFUSED on the holdout; the fixed-suite gain did NOT generalize — and the
mechanism is now understood (R25-U20b verdict + diagnosis, 2026-07-27).**

**VERDICT against BD-95's pre-registered bars (random suite, 30 briefs, hash `5c6462e3b1cfba1f`):**
1. PRIMARY AC ≥12/30 → **9/30. MISSED — literally zero gain** (the per-brief PASS/FAIL vector is
   element-wise IDENTICAL to baseline: 30 rows, 9 PASS in both, not one brief changed status);
2. no-route ≤3/30 → 3/30 ✓ (kill held);
3. curvy share ≥0.1164 → 0.13 ✓ (kill held, improved);
4. wall ≤12 146 ms → **12 755 ms. MISSED** (10 646 → 12 755, +20 %);
5. shape defects ≤9 → 6 ✓ (improved from 7).
Primary + wall missed ⇒ **RINGS STAY DEFAULT OFF.** Config unchanged; `frozen-r25-v1` untouched.
This is exactly what the holdout existed to catch: adopting on BD-94's fixed-suite AC 19→25 would have
shipped +2.1 s of latency for zero feasibility on unseen briefs.

**DIAGNOSIS (26-agent investigation, findings adversarially verified; 5 confirmed):**
- **The naive explanation is FALSIFIED.** Rings did not "fail to fire" on the holdout — they fired
  MORE: mean gen delta +3.9 (random) vs +2.9 (fixed), mean survivors +3.2 vs +1.9; 77 % of briefs
  perturbed on BOTH suites (23/30 random, 37/48 fixed rows byte-changed). The cost was paid in full;
  the metric simply did not move.
- **The real cause is THRESHOLD GEOMETRY, not suite bias.** The SPK-15 AC is a 13-clause conjunction
  including `kept.length >= K_PRESENT_DEFAULT` (=4, diversify.ts:17). EVERY passing row in all six
  reports has kept=4 — zero exceptions. Margin histograms: FIXED `{1:1, 2:4, 3:15, 4:28}` → **31 %
  sit exactly ONE candidate below the bar**; RANDOM `{0:3, 1:3, 2:9, 3:3, 4:12}` → **10 % one-away,
  50 % at kept ≤2**. **3.1× more one-away briefs on fixed.** An additive lever worth ~+2 distinct
  survivors converts shallow deficits and cannot touch deep ones. Same mechanism, different distance
  to the bar.
- **NOT a systemic fixed-suite bias — the opposite, measured.** Across all of R25 the FIXED suite LOST
  AC (20→19) while the RANDOM suite GAINED (7→9). And no adopted lever used AC-gain as its adoption
  criterion (BD-85 = highway share · BD-86 = hood runs · BD-87 = byte-identical · BD-88 = continuity
  metres · BD-90 = an invariant), so the ring failure mode cannot have contaminated them.
- **Honest caveat, recorded:** three default-ON levers rest on fixed-suite-only evidence — BD-87
  (a safety net proven not to fire on either suite), BD-90 (an identical-verdict invariant), and
  **BD-88 (continuity), the only one with a real measured effect and no dedicated random leg**.
  Post-hoc mitigation found in existing data: the random lineage `876cd5`→`1aee25` shows longest
  backroad run 7 937→8 973 m (+1 036) and p20 3 533→4 142 (+609) — the continuity gain DOES reproduce
  on random, it was simply never run as a labelled A/B leg.
- **CORRECTION TO BD-94 (my own earlier characterization was wrong):** I described the fixed-suite
  up-flips as "pool-starved towns". REFUTED — every flipped brief had SATURATED retrieval (segs=300).
  They were not corpus-starved; they were sitting one candidate below the diversity bar. The correct
  description of rings is: **a +1-distinct-corridor lever**, which pays only where a brief is exactly
  one corridor short.
- **Instrument limitation found (fix before any future re-registration):** the harness prints funnel /
  resize / ladder notes ONLY on FAIL rows (loop_quality.ts:970), so the 7 fixed up-flips carry no
  observable funnel data — every firing-rate figure above is computed on the FAIL∩FAIL subpopulation
  or by byte-diffing rows. Emitting the funnel line unconditionally + a per-brief ring-emitted count
  would turn this from inference into a printed number. NOT done now: notes participate in the
  determinism hash, so it re-baselines `e216d28335da10f8` — an instrument change to make deliberately,
  not as a side effect.
- Minor, real: ring geometry is unbuildable at Great-Lakes shore origins (Goderich ×2, Cobourg ×2 —
  half the bearing circle is water, `pickRingAnchor` returns null and skips honestly), ~25 % of the
  holdout; and rings perturb the harness's resize/ladder retry triggers, which is where the +2.1 s
  actually comes from.

**PRODUCT FINDING worth more than the lever: 50 % of random-suite origins cannot produce 4 distinct
drives at all (kept ≤2), and 3 produce none.** That — not loop shape — is the real "we couldn't find
you options" failure, and it is a CORPUS/retrieval question, not a ranking or seeding one.

**BD-97 — R26-A1 country-road census: BUILD, unanimously (2026-07-27).** The build-or-cancel gate for
the R26 backlog. For all 78 origins BOTH suites are judged on (48 fixed + 30 random fixture), using the
REAL planner reach (buildScope isochrone, not a straight-line proxy), measured inside the polygon:
rural country road (tertiary+unclassified, urban_share <0.3) per origin **mean 1 828 km / median
1 360 km**, of which retrieval can see **363 km — 20 %**; **INVISIBLE mean 1 465 km / median 1 071 km**.
For contrast, reachable MAIN road averages 1 788 km — there is as much rural country road in reach as
main road, and today's gates show the planner a fifth of it. **78/78 origins (100 %) clear the 25 km
bar; the pre-registered BUILD threshold was 40 %.** The ceiling is NOT the corpus or the SPK-08
extract — it is the three retrieval gates (curvature floor · `order by curviness desc limit N` ·
multiplicative `segValue`). Phase A proceeds.
HONEST CAVEAT THAT SETS AN A2 PARAMETER: the invisible set is **80 % dead-flat** (curvature <0.15),
11 % gentle (0.15-0.35), 8 % moderate (0.35-0.6). Admitting everything would hand the planner mostly
straight concession grid — "country roads not main roads" ✓ but "twisty" ✗. The country-tier floor is
therefore a SWEEP PARAMETER {0.35, 0.15, 0.05}, not a fiat: at 0.35 the rural material grows ~1.3×,
at 0.15 ~1.8×, at 0.05 ~5× but grid-dominated. The curviness KILL condition decides how far is too far.

**BD-98 — The country-road tier + value reform: the pre-registered bars were MISSED, the effect
REPRODUCED on three independent suites, and the adoption call is the owner's (R26-A2/A3, 2026-07-27).**

**WHAT WAS BUILT.** Migration 0017 `planner_find_country_roads` (class-selected tertiary/unclassified,
own low curvature floor, ordered by class-weighted LENGTH — the gate-2 fix, since ordering by curviness
is what made this material unreachable even at a zero floor) + a per-caller retrieval union
(`COUNTRY_TIER`) + `segValue` reformed from MULTIPLICATIVE to BASE+BONUS (`COUNTRY_VALUE`): class ×
length × rural carries the base, curviness adds a bounded ≤3× multiplier. All three BD-97 gates
addressed together, because any one alone is inert.

**PRE-A/B ADVERSARIAL REVIEW (23 agents) — 4 confirmed findings, all fixed before judgment:**
(1) BLOCKING — 0017 omitted `not st_isclosed(cs.geom)`, silently voiding migration 0013's closed-ring
(cul-de-sac/Standish Court) guarantee through the new door; verified on the live corpus (753 rings
stored; 20 qualified at EVERY sweep floor — a ring is maximal-curvature by construction, so the floor
never protects); fixed, RPC now returns 0 rings of 3 075, cost 0.23 % of the pool. (2) The lever was a
module-scope flag reaching Discover and the offline core sweep, neither of which the loop A/B measures
— added a per-caller override. (3) Hard rule J — no tests landed with the code; added 9 (country tier
admits only country class below the floor · curvy tier preserved · zero rings · determinism · the
value shape's OFF-identity, boundedness and class order), and pinned `retrieve.test.ts`'s θ assertion
which passed only by an undeclared append-order accident. (4) MEASUREMENT TRAP: the harness's
"curvy share" is computed against the RETRIEVED POOL, so it moves with a lever that changes retrieval —
judging the curviness KILL on it would have been meaningless. All curviness figures below are the
ABSOLUTE per-brief measure.

**THE SWEEP (fixed suite, vs `e216d28335da10f8`).** θ=0.35 won and the shape matches BD-97's prediction
exactly — the moderate band carries the value, the dead-flat 80 % is bulk:
| θ | AC | backroad | main | clean | contP20 | curviness |
|---|----|----|----|----|----|----|
| baseline | 19 | 28 % | 69 % | 1 | 5 989 m | 100 % |
| **0.35** | **22** | **35 %** | **63 %** | **4** | **8 411 m** | **101.4 %** |
| 0.15 | 22 | 34 % | 63 % | 3 | 7 415 m | 99.5 % |
| 0.05 | 23 | 33 % | 64 % | 3 | 7 415 m | 98.6 % |

**IT REPRODUCED — the BD-96 test this time passes.** Rings gained on fixed and delivered literally zero
on the holdout; this moves the same amount everywhere:
| suite | backroad | main | curviness | feasible | no-route | wall |
|---|---|---|---|---|---|---|
| fixed 48 | 28→35 (+7) | 69→63 (−6) | 101.4 % | AC 19→22 | 0=0 | +122 ms |
| random 30 (HOLDOUT) | 27→33 (+6) | 69→63 (−6) | 97.2 % | AC 9=9 | 3=3 | −15 ms |
| A→B 15 | 24→31 (+7) | 71→68 (−3) | 0.95→0.97 | routed **12→14** | 3→1 | — |
Plus: fixed clean drives 1→**4** (the metric stuck at 0-1 all project); continuity p20 +2 422 m fixed /
+3 702 m random / longest +2 911 m A→B; A→B highway 3.4 %→**0.1 %**; random main p80 90→79; hood down
on both. OFF state re-verified byte-identical AFTER every review fix: `e216d28335da10f8`.

**VERDICT AGAINST THE PRE-REGISTRATION — the primary bars MISSED.** backroad +10 pp asked, +6/+7 pp
delivered; main −8 pp asked, −6/−3 pp delivered. Every KILL passed (curviness ≥95 % — it went UP on
fixed and A→B), AC/no-route/wall all fine. Per BD-40 discipline I do NOT self-adopt on a missed bar —
that is exactly the exception I refused to make for rings four hours ago, and consistency is the
discipline's entire value. **RECORDED FOR THE OWNER** (the BD-81/BD-94 precedent): the bars were
written before any data existed and were aspirational; the lever is the first thing in this project's
history to move main-road share at all, it reproduced across three independent suites, it costs
nothing (faster on two of three), and it improves rather than trades away the fun. Adoption is a
one-word owner decision. Flags stay default OFF until then; nothing downstream (A4 re-baseline, Phases
B-D) can proceed honestly until the material question is settled.

**BD-99 — R26-B1 connector costing probe: REFUSED on A→B as registered; `top_speed` found to be a
very large road-class lever, re-registered for the LOOP surface (2026-07-27).** ~90-97 % of route
metres are Valhalla glue and no lever has ever moved them. Probed 8 live pairs × 7 arms, verdict rule
written first. RESULT — no combo qualified, so B1 REFUSES and B2 does not run **as an A→B change**.
But the measurement is emphatic and must not be buried: dropping `shortest` and setting
**`top_speed: 50` gives median +39 pp backroad, worst case 0 pp (it never regressed a single pair),
zero highway metres, zero hood change.** The sole blocker was duration: median ×1.42, worst ×1.68
against bars of ≤1.15/≤1.30. Mechanism: `shortest` bypasses every soft factor (BD-21/R18-1 documents
this), so today's fun profile cannot honour ANY use_*/penalty knob; dropping it re-arms them, and a
speed ceiling then prices fast roads out without a hard exclusion. Sweep shape: ts70 inert, ts60
+22 pp, **ts50 +39 pp**, ts40 +19 pp with hood +7 pp (too far — it starts buying neighbourhood).
`use_tracks`/`use_living_streets` were inert on top of ts50 (identical cells) — no guard needed.
WHY A→B'S BAR IS THE WRONG BAR FOR LOOPS, and why this is a re-registration rather than goalpost-
moving: an A→B route must cover fixed ground, so slower costing = a longer drive the user pays for.
A LOOP is sized to a duration TARGET by the sizing speed + resize ladder — slower costing yields a
geographically smaller loop of the SAME duration, not a longer one. Different product surface,
different failure mode, therefore its own pre-registration:
**BD-99-L (registered BEFORE the loop run), flag `CONNECTOR_TOPSPEED`, fun+backroads profiles,
`{top_speed: 50, use_living_streets: 0}` replacing `{shortest: true, ...}`, sizing speeds derived from
the probe's own ×1.42 (50→35, 38→27 km/h) rather than guessed:**
ADOPT IFF — backroad share **+10 pp** (from 35 % fixed / 33 % random) · main **−8 pp** ·
KILL curviness (ABSOLUTE measure) ≥95 % of baseline · KILL no-route not up (0 fixed / 3 random) ·
|durErr| p80 ≤ +3 pp (from 19 %) · AC not down >2 · wall ≤ +2 s. Confirmed on BOTH suites or refused.

**BD-100 — R26-B2 `top_speed` connector costing: ADOPTED (2026-07-27).** The first lever ever to move
the ~90-97 % of route metres that are Valhalla glue. Replaces `{shortest: true}` with
`{top_speed: 50}` on the fun + backroads profiles; sizing speeds 50→35 / 38→27 km/h DERIVED from the
B1 probe's own ×1.42 duration ratio (not guessed — the rq18 convention).
MEASURED, both suites, vs the A4 baselines (`eb5ee5dd61d5a565` / `56ca2adc571a6a9a`):
| | fixed 48 | random 30 (holdout) |
|---|---|---|
| backroad | 35→**40 %** (+5) | 33→**38 %** (+5) |
| main | 63→**58 %** (−5) | 63→**58 %** (−5) |
| curviness (ABSOLUTE) | **104.6 %** | 98.7 % |
| clean drives | 4→**6** | 0→**1** |
| defects/route | 1.88→**1.73** | 2.03→2.07 |
| durErr p80 | 19=19 | 18=18 |
| no-route | 0=0 | 3=3 |
| wall | −271 ms | +141 ms |
VERDICT AGAINST BD-99-L: the +10 pp / −8 pp magnitude bars were MISSED (+5/−5), every KILL PASSED
(curviness UP on fixed), and the effect REPRODUCED to the point identically on both suites. Adopted on
the basis the owner endorsed for BD-98: when a lever moves THE REGISTERED METRIC in THE REGISTERED
DIRECTION, reproducibly across a holdout, with every kill and cost bar satisfied, a missed aspirational
magnitude is not grounds to discard it. Stated explicitly, not silently — the standing rule remains
that a lever which misses its metric, fails a kill, or does not reproduce is REFUSED (BD-93/96/99).
THE HONEST TRADE, diagnosed rather than assumed: AC fell 2 on BOTH suites, and the per-brief diff shows
it is the DIVERSITY clause, not quality — 4 of 5 lost briefs dropped their distinct-candidate count
(kept 4→3, 4→1, 4→2, 4→3) while clean drives ROSE and defects FELL. A speed ceiling funnels candidates
onto the same slow-road network, so more of them dedup away. Better individual drives, fewer distinct
options. This makes the `kept >= 4` starvation (BD-96's finding: 50 % of random origins already sit at
kept ≤2) the binding constraint on the AC metric, and promotes R26-C3 from a follow-up to the next
structural unit.
CUMULATIVE R26 SO FAR (pre-R26 `e216d28335da10f8` → now): main **69→58 %**, backroad **28→40 %**,
clean drives **1→6**, curviness **+6.2 %**, A→B routed 12→14, highway 0.3→0.4 % (flat).

**BD-101 (PRE-REGISTRATION) — R26-C1 `maneuver_penalty`, the turn-density lever that only became
possible today (registered 2026-07-27 BEFORE the run).** The owner's verbatim complaint — "way too many
goddam turns… stop signs and lights every 2 minutes" — has been unattackable for the whole project for
a documented mechanical reason: `shortest` bypasses every soft factor, and R25-U9b's own note recorded
that a turn penalty "cannot be attacked at the router while `shortest` is the fun mechanism" (BD-90
then REFUSED the presentation-side TURN_GRADE because the turn-heavy pools contained no clean
alternative). BD-100 removed `shortest`. `maneuver_penalty` (seconds added at transitions between
unlike-named roads) is now live for the first time.
CONFIG UNDER TEST: `CONNECTOR_MANEUVER_PENALTY` seconds ∈ {15, 30, 60} on the fun/backroads connector
(Valhalla default 5).
BASELINE (post-BD-100, fixed `25895a0544443f2f` / random `b6d7168438c45b3c`): turns/10min mean 3.3 ·
p80 3.9 · max 8.1 · briefs over 5/10min 5/48 · backroad 40 % · curviness 0.816 · AC 20 · clean 6.
ADOPT IFF (both suites): briefs over 5 turns/10min **≤3/48** · p80 **≤3.5** · KILL curviness ≥95 % ·
KILL backroad share not down >2 pp · KILL no-route not up · AC not down >2 · wall ≤ +1.5 s.
Any miss ⇒ refused and recorded; the tail belongs to generation, not the router.

**BD-101 (BASELINE CORRECTION, logged before the verdict).** The baseline quoted in the
pre-registration above (turns mean 3.3 · p80 3.9 · max 8.1 · >5 5/48) is the **pre-B2** baseline —
I copied it from the R26 A-phase run, not from the post-BD-100 run the A/B actually compares against.
The TRUE post-BD-100 fixed-suite baseline is **mean 3.0 · p80 3.8 · max 5.4 · >5 2/48**.
Consequence, stated plainly: the registered primary bar "≤3/48" **was already satisfied by the
baseline**, so it is vacuous and cannot be claimed as a win. The only non-vacuous registered bar is
**p80 ≤3.5**. The verdict below is judged on that bar and the kill bars only.
This is itself the finding: **removing `shortest` (BD-100) already fixed most of the turn density** —
max 8.1→5.4, >5 5/48→2/48 — because `shortest` adds turns by design, exactly as R25-U9b predicted.
The owner's "a turn every 2 minutes" was mean 3.6/10min at audit-v11 (a manoeuvre every 2.8 min) and
is now 3.0/10min (every 3.3 min) with no turn lever adopted at all.

**BD-101 — VERDICT: REFUSED. `maneuver_penalty` buys turn-tail improvement by trading away backroad
share, monotonically. The turn problem was already solved by BD-100.** Fixed suite, three doses vs the
true post-BD-100 baseline (AC 20 · clean 6 · backroad 40 % p20 22 · main 58 % · abs curviness 1.004 ·
turns mean 3.0 p80 3.8 max 5.4 >5 2/48 · wall 10 049 ms):

| dose | turns p80 | >5 | backroad | main | clean | AC | abs curv | verdict |
|---|---|---|---|---|---|---|---|---|
| 15 s | 3.8 (=) | 2 | **40 %** | 58 % | 6 | 21 | 1.031 | INERT on the registered metric |
| 30 s | **3.4** ✔ | 1 | 38 % (−2) | 60 % | 5 | 19 | 0.989 | passes literally, refused on trade |
| 60 s | **3.3** ✔ | 1 | **37 % (−3)** | 60 % | 4 | 21 | 1.011 | **KILLED** (backroad −3 pp > −2 bar) |

THE MECHANISM, confirmed by dose-response rather than argued: the penalty is monotone in BOTH
directions — every second of turn penalty buys turn-tail and pays for it in backroad share
(15 s: 0/40 · 30 s: −0.4 p80/−2 pp · 60 s: −0.5 p80/−3 pp), and main road rises by exactly what
backroad loses. That is causal, not noise: a country road network is a grid of concession junctions, so
penalising manoeuvres steers the router back onto long continuous arterials **by construction**. This is
BD-62's refusal in a new coat — a taste lever fighting the thing the owner actually asked for — except
it now reproduces at the ROUTER, which is where R25-U9b predicted the fix would have to live. Both
places have now been tried and both refuse; the finding is that turn density and backroad share are
genuinely coupled in this corpus, not that the lever was wrongly built.
NOT ADOPTED. `CONNECTOR_MANEUVER_PENALTY` ships at 0 (knob absent from the payload, byte-identical);
CURVINESS WAS NEVER THE COST (0.989–1.031, all ≥98 % of baseline) — so this refusal is on road class
alone, and I am not hiding behind the twistiness kill bar.
**What actually fixed the owner's complaint:** BD-100. Turn density went mean 3.6→3.0 /10 min
(a manoeuvre every 2.8 min → every 3.3 min), max 8.1→5.4, briefs over the bar 5/48→2/48 — by REMOVING
`shortest`, with no turn lever at all. The remaining tail is generation, not routing, and C1 closes.

**BD-102 — R26-C2 loop shape, RE-MEASURED on post-BD-100 material (measurement, no lever).** The
owner's "it barely ever looks like a loop, sometimes just a bunch of lines" is the one complaint R26
did NOT move, and this records that plainly rather than letting the road-class wins imply it did.
Fixed suite: loopiness mean **0.431 → 0.434**, briefs under 0.15 **9/49 → 7/49**, under 0.25 20→19.
R26 changed WHICH ROADS the drive is built from; it did not change SHAPE, and there was no reason to
expect it to.
NO NEW LEVER IS PROPOSED, because shape now has four recorded refusals: BD-62 (ranking demote —
"a generation problem attacked with a presentation tool"), BD-92 (`RETURN_ANCHOR_DISTANCE_FRACTION`
sweep — p20 flat at 0.75/0.85, and 0.85 traded backroad −2 pp for AC +3), BD-94/95/96 (ring seeding
+ shoelace gate — zero AC gain on a pre-registered holdout, verdicts element-wise identical, wall
+20 %). A fifth attempt with no new mechanism would be a fifth refusal, and I would rather say so than
spend the engine time. Shape stays a KNOWN OPEN ITEM at mean 0.434 with 7/49 poor loops; the honest
next move is the one the D-phase drive-core index does by construction (generate many offline, keep
only what MEASURES round) — not another live-planner ranking or seeding tweak.

**BD-103 (PRE-REGISTRATION) — R26-C3 max-dispersion diversify. Registered BEFORE the run.**
E1's attribution (new this session, console-only, hash-preserving) makes the AC ceiling legible for the
first time: of 28 failing briefs, **diversity(kept<4)×22**, and **8 briefs fail on that clause and
NOTHING ELSE** — so AC 20/48 has a ceiling of **28/48** behind one clause.
DIAGNOSIS (measured, not assumed): of the 22 briefs with kept<4, **22 are τ-collapse and 0 are
starvation** — mean **25.0 accepted** candidates per brief collapse to **2.3 kept**. The planner is not
short of routes; its routes are near-duplicates of each other (pairwise overlap > τ=0.6). This kills the
"pool-starved" reading I have twice reached for (and BD-96's diagnostic already corrected once).
MECHANISM: `diversify()` is greedy by score, and greedy is suboptimal for max-dispersion subset
selection — one high-scoring CENTRAL route blocks every route near it, so a set of 4 mutually-distinct
routes can exist while greedy finds 2. Greedy is already maximal (it admits every compatible candidate
it meets), so the ONLY way to keep more is to change composition. Exact search, rank-1 pinned.
CONFIG: `DIVERSIFY_MAXSET_ON` (default OFF, byte-identical). Runs ONLY when greedy under-delivers, so
the 26 briefs that already reach k=4 are untouched by construction.
HONEST CAVEAT, registered up front: pinning rank-1 preserves "the best-scoring route is always
presented", but the eval's `best` is the top presentKey among **feasible** kept — so where rank-1 is
INFEASIBLE the best can change. I am NOT claiming this lever is quality-free; the A/B must show it.
ADOPT IFF (fixed AND random): AC **+4** or better · briefs with kept<4 **22 → ≤12** ·
KILL best-route curviness ≥95 % · KILL backroad not down >2 pp · KILL no-route not up ·
KILL maxPairOverlap still ≤ τ on every brief · wall ≤ +1.5 s.

**BD-103 — VERDICT: REFUSED, and the DIAGNOSIS I registered it on was itself WRONG. Correcting both.**
Result vs the pre-registered bars (AC +4 · kept<4 ≤12):
· fixed suite AC **20 → 21** (+1, bar +4) · kept<4 **22 → 20** (bar ≤12) · hash a44a22e7683d8faa
· random holdout AC **7/30 → 7/30 (ZERO)** · every quality metric byte-identical (backroad 38 %, main
  58 %, hood 2.7 %, clean 1, defects 2.07, hwy 0.6 %) · hash cf9d6248346c7853
· no kill bar tripped: backroad 40 %/38 % unchanged, clean 6/1 unchanged, no-route unchanged,
  wall 10 049→9 929 ms (faster). The lever is HARMLESS and very nearly INERT.
The quality metrics being byte-identical is the design working exactly as specified — rank-1 pinning
means the presented best cannot move — so this is a clean refusal on effect size, not a trade.

**THE CORRECTION (this is the actual finding).** BD-103's registration claimed "22/22 τ-collapse,
0 starvation, mean 25.0 accepted → 2.3 kept". That measured the pool at the WRONG STAGE: 25.0 is the
count of ASSEMBLY-ACCEPTED candidates, but `prefilterByDuration` runs BEFORE `diversify`. Re-measured
at the correct stage:
  accepted **25.7** → duration prefilter drops **15.9 (62 %)** → pool entering diversify **9.8** → kept 2.6
and among the 22 kept<4 briefs, **6 enter diversify with fewer than 4 candidates** — they CANNOT reach
k=4 by any selection algorithm. So it was never "0 starvation": it is ~6 starved + ~16 genuinely
over-similar, and of those 16 the exact max-clique search recovered only 2. That is now the third time
in this program I have reached for a pool-starvation story and had to correct it against measurement
(BD-94's "pool-starved towns", corrected by BD-96; and now this) — recording the pattern, not just the
instance.
WHAT THE CORRECTED NUMBERS SAY: with a mutually-clean bar of τ=0.6 (i.e. two routes may share 60 % of
their edges and still count as DIFFERENT), a pool of ~10 survivors still cannot yield 4 distinct drives.
**The planner is generating one drive about ten times.** That is the same defect the owner reports from
the other end — a menu that all looks the same — and no selection-side lever can fix it, which is
precisely what this refusal demonstrates rather than assumes.
NOT ADOPTED. `DIVERSIFY_MAXSET` ships OFF. The code and its 8 tests stay (they encode the measured
failure shape and the known limit — when rank-1 is itself the blocker, pinning it makes the set
unrecoverable by construction, which is a deliberate product choice: never show the user worse routes
than the one we ranked best).
**PROMOTED to the next structural unit — and it is the OWNER'S CALL, not mine:** the duration prefilter
at 0.35 discards 62 % of the pool before diversity is even attempted. That constant is 0.5→0.35 by an
explicit owner decision ("increase time accuracy", round 6). Loosening it trades TIME ACCURACY for MENU
DIVERSITY in exactly the proportion above. I am not flipping an owner decision on my own reading; the
measurement goes to him with both numbers.

**BD-104 (PRE-REGISTRATION) — R26-B3: re-test the U19 connector refinement on post-A/B material.**
WHY THIS IS A PRINCIPLED RETEST AND NOT A SECOND ROLL OF THE DICE: BD-93 refused U19 and recorded its
own root cause — *"suite loops already route THROUGH the retrieved corpus, so their connector legs
offer little to steer; the probe's big wins live on long bare corridors with DENSE PARALLEL CORPUS."*
Phase A (BD-98) changed precisely that variable: `planner_find_country_roads` adds up to 200
tertiary/unclassified roads per ring — the exact class U19 snaps to — so corridors that were bare when
U19 was judged now have parallel corpus. The refused lever is unchanged; the input it operates on is
not. If it still refuses, that is a stronger result than the first refusal, because the stated cause
will have been removed and the lever will still not have moved.
BAR, and it is DERIVED not softened: BD-93's "+15 pp" targeted the owner's decision #1 — backroad must
be the MAJORITY of a fun drive (backroad % > main %) — from a 28 % base. The post-BD-100 base is
**backroad 40 % vs main 58 %**, so the same product criterion now needs **+10 pp**. That is the bar.
ADOPT IFF (fixed, then confirmed on random): backroad **+10 pp** · KILL curviness ≥95 % · KILL no-route
not up · KILL hood not up >1 pp · AC not down >2 · wall **≤ +2.5 s** (BD-93 used ≤ +2 s and measured
+3 s; refinement costs engine calls by construction, and a lever that cannot fit the latency budget
cannot ship however good its road mix).

**BD-105 — R26-C3b: the duration-prefilter tradeoff, MEASURED and handed to the owner undecided.**
BD-103's correction showed `prefilterByDuration` discards 62 % of the assembled pool before diversity
is attempted, leaving 6 of 22 failing briefs structurally unable to reach k=4. The constant is 0.35 by
an explicit owner decision (0.5→0.35, round 6, "increase time accuracy"). Measured both ways on the
fixed suite, everything else frozen:

| | prefilter 0.35 (today) | prefilter 0.5 (pre-round-6) |
|---|---|---|
| briefs with a full 4-drive menu | 26/48 | **32/48** (kept<4: 22 → 16) |
| briefs passing all AC | 20/48 | **21/48** |
| briefs missing requested time by >25 % | **6** | 8 |
| clean drives · defects/route | 6 · 1.73 | 6 · **1.71** |
| backroad / main / hood | 40 / 58 / 2.0 % | 40 / 58 / 2.0 % (identical) |
| no-route | 0 | 0 |

Exactly the 6 structurally-starved briefs are recovered, and the price is exactly what the owner bought
in round 6: **+6 briefs get four distinct drives to choose from; +2 briefs return a drive more than
25 % off the requested time.** Road quality does not move at all either way.
NOT ADOPTED, DELIBERATELY. This reverses a decision the owner made explicitly and for a stated reason,
and the eval cannot rank "a fuller menu" against "the time I asked for" on his behalf. `DURATION_PREFILTER`
is now env-overridable (default 0.35, byte-identical — hash 25895a0544443f2f re-verified) so the choice
is a one-line change whenever he makes it.

**BD-104 — VERDICT: REFUSED. The 6th refusal of the connector family, and the most conclusive.**
Fixed suite, `CONNECTOR_REFINE=on`, vs the post-BD-100 base (backroad 40 % p20 22 · main 58 · AC 20 ·
clean 6 · hood 2.0 · no-route 0 · wall 10 049 ms):
backroad **40 % → 40 % (+0 pp against a +10 pp bar)** · main 58 → 57 · AC 20 → 20 · clean 6 → 6 ·
hood 2.0 → 2.0 · no-route 0 → 0 · wall 10 049 → **9 860 ms** (no latency cost this time, unlike BD-93's
+3 s) · hash 8f8e96b8abc3aea9.
WHY THIS REFUSAL IS WORTH MORE THAN THE FIRST: BD-93 refused U19 and attributed it to a property of the
input — "suite loops already route THROUGH the retrieved corpus; the big wins live on long bare
corridors with dense parallel corpus." Phase A then put up to 200 tertiary/unclassified roads per ring
into that corpus, changing exactly that property, and the lever moved backroad share by **zero**. The
stated cause has been removed and the effect did not appear, so the explanation is now the mechanism
itself, not the material: on LOOP suites the connector legs are short and already corpus-adjacent, and
via-steering has nothing left to buy. The probe's genuine wins (BD-93 recorded +14 pp at ×1.01 on
Acton→Georgetown) live on long point-to-point corridors — which is an **A→B** shape, not a loop shape.
`CONNECTOR_REFINE` stays OFF with its 11 tests. If it is ever re-registered it should be on the A→B
path, where the geometry that made it work in the probe actually occurs — and that is a product call,
not something to keep re-rolling on loops.

**BD-106 — R26-D1: the drive-core sweep re-run on the new corpus. The kill condition fires AGAIN —
but the BINDING BAR HAS CHANGED, and that is the result.** 12 representative cells spanning the region
(a sample, not the ~250-cell full sweep — stated so this is not read as complete coverage),
`GENERATOR_VERSION=r26-d1`:
cores kept **10** (9 loops, 1 ribbon) · cells with ≥3 cores **2/12** · **KILL: <3 cores in 10/12 (>40 %)**.
Per-bar rejection histogram, in order:
**loopiness×64** · main_share×51 · assembly_rejected×47 · backroad_share×38 · hood_share×37 ·
turns×13 · microloops×8 · spurs×7 · uturns×1 · route_failed×1.
THE CHANGE: the previous sweep's binding bars were **`main_share×15 · backroad_share×13`** — road class.
After Phases A and B, road class has fallen behind **loopiness**, which is now the single largest
rejection cause by a wide margin (64 vs 51). Phase A/B did what they were built to do and the
constraint moved. It did not disappear.
CROSS-VALIDATION, from an instrument that shares no code path with this one: BD-102 measured the live
eval suite and found R26 moved road class (backroad 28→40 %) and left shape flat (loopiness 0.431→0.434,
7/49 under 0.15). The offline sweep now independently names shape as its top blocker. Two instruments,
one conclusion: **shape is the remaining product defect, and it is a GENERATION problem** — which is
exactly what BD-62's own adversarial review concluded before four subsequent shape levers refused.
CONSEQUENCE FOR THE PHASE: D2 (ship the written-and-waiting Discover v2 index) is NOT unblocked — 2/12
cells filled cannot stock a regional menu. The pre-registered fallback is D3 `bar_profile='cell_relaxed'`
per ACP-001: relax the ONE named binding bar (now **loopiness**, not road class) to each cell's own
measured p75, sort those cores below every strict core, and state the number on the card. That path was
pre-approved in the plan for exactly this outcome, but WHICH bar it relaxes is a product question the
owner should answer knowing it is now shape — "this is the best drive around here, and it's more of a
long ribbon than a loop" is a different promise from the road-class version he approved.

**BD-105 — CLOSED BY OWNER (2026-07-29): duration prefilter STAYS at 0.35.** Presented the measured
tradeoff (+6 briefs get a full 4-drive menu and +1 AC, against +2 briefs landing >25 % off the requested
time; road quality identical). Owner chose **time accuracy**. Rationale on the record: "menu size" is the
eval's own instrument, not something the owner ever complained about, whereas a 2-hour ask returning
~30 minutes long is a promise broken to the user's face. `DURATION_PREFILTER` remains 0.35; the env
override stays so the decision is reversible in one line, and the AC ceiling of 28/48 is understood to be
partly self-imposed BY THIS CHOICE rather than a planner defect.

**BD-107 — R26-D1-full: the full sweep was AUTHORIZED, and pre-launch verification found FOUR defects
in the path it depends on — three of them mine.** The owner chose "run the full sweep before deciding
cell_relaxed" over shipping on a 12-cell sample. Because that commits ~20 unattended hours, the path was
verified before launch rather than after, and the checks paid for themselves:
1. **PRE-EXISTING, BLOCKING: the full-sweep code path had never once executed and would have crashed
   instantly.** `build_drive_cores.ts` derived the region grid with `st_extent(geometry::geometry)`, but
   the column is `geom`. Every prior sweep (including D1/BD-106) passed `CELLS=`, so the
   derive-from-extent branch was dead code carrying a fatal typo.
2. **MINE: the live-cell prefilter was ANISOTROPICALLY WRONG and would have silently REDUCED coverage.**
   `squareScope` takes its longitude half-width as `halfM / (111 320 · cos(lat))` — at 44 °N that is
   0.150 ° against 0.108 ° in latitude. My probe expanded equally in both axes, making it NARROWER than
   the scope it stood in for, so a cell whose only corpus sat in that longitude margin would be dropped
   as dead — shrinking both coverage and the kill-condition denominator with no error. Found by reading
   `squareScope` rather than by trusting the comment I had just written. Fixed by taking the longitude
   half-width at the region's highest latitude, making the probe a provable superset.
3. **MINE: binding EWKT strings as `geometry[]` does not parse** (Postgres `ReadArrayToken`) — it would
   have crashed at the prefilter. Coordinates now cross as two `double precision[]` and the point is
   built in SQL. Measured, not assumed.
4. **MINE: resume would have reported a FALSE kill condition.** `liveCells`, `filledCells` and the
   rejection histogram only incremented inside the loop, so a resumed run would have computed its
   >40 % kill over only the newly-processed cells and silently discarded every earlier rejection —
   i.e. produced a confident, wrong headline. Now each checkpoint record carries its cell's filled flag
   and histogram delta, and resume rebuilds all three (every record is provably a live cell: both
   `continue` paths precede `liveCells++`).
VERIFICATION, all real output: refactor **behaviour-preserving** — the 12-cell D1 sweep re-run reproduces
`de00aa5b78e89121` exactly · **resume validated end-to-end** — 6 cells (`f7f250711c7a281f`) then resumed
to 12 reproduces `de00aa5b78e89121` with `live cells: 12`, `filled: 2` and a histogram identical to the
single run · **prefilter superset proven empirically** — 1 528 grid cells, probe live 1 185, exact-scope
live 1 184, **exact-but-missed-by-probe = 0**.
SCOPE CORRECTION: the plan estimated "~250 live cells, 6-9 h". The measured region is **1 184 live
cells**, so the full sweep is **~20 h**, not 6-9. Running detached with `RESUME=on` so it survives an
interruption; a resumed run is now proven to produce the byte-identical artifact.

**BD-108 — PROCESS FAILURE, caught after the fact and recorded as such: BD-100 changed SHARED costing
helpers and I judged it on LOOP suites only. A→B and Discover inherited it unmeasured.**
`FUN_OPTIONS()` / `FUN_SIZING()` (costing.ts:104-109) back BOTH the `FUN` and `BACKROADS` profiles.
`profileForRequest` (costing.ts:176-183) is shared by loops and A→B, and only the highway avoid at
run.ts:550 is `isLoop`-gated — `profile.options` reaches the A→B routing at run.ts:998 ungated. Discover
uses `BACKROADS` directly (discover.ts:353, 475). So adopting `top_speed:50` on loop evidence silently
re-costed two other products, one of which (**A→B**) had the SAME change explicitly REFUSED by BD-99 on
a ×1.42 median duration-growth blocker. BD-100 should have carried the A→B suite the moment it touched a
shared helper. It did not. That is my error, not a surprise about the world.

**MEASURED NOW** (atob-quality, vs the pre-BD-100 baseline `ee07cc6c2cd1fc77`; new `777f2154a6f4e0fa`.
Wall-clock is NOT judged — the 20 h core sweep was running concurrently and contaminates it. Every
metric below is deterministic and unaffected):
· routed 14/15 → **14/15** (unchanged) · arterial 68 % → **61 %** · main 68 % → **60 %** ·
  backroad 31 % → **38 %** · curviness 0.97 → **1.07** · highway routes **1 → 0** ·
  backroad longest 14 603 → **18 574 m** · turns/10 min 3.4 → 3.4
· **hood run max 1 260 → 3 498 m — a REGRESSION**, and on one of the owner's named complaints
  ("random deviations into neighbourhoods").
· duration: **median per-route growth ×1.000**, total ×1.112 — so **BD-99's ×1.42 median does NOT
  reproduce** in the shipped combination (the isolated probe lacked Phase A's country tier and the A→B
  detour cap). But there is a TAIL: Barrie→Collingwood **76 → 129 min (×1.70)**, Hamilton→Simcoe ×1.34,
  Guelph→Orangeville ×1.32.
**THE MECHANISM behind the tail, and it is a real defect worth its own unit:** Barrie→Collingwood grew
**+8 % in DISTANCE but +70 % in DURATION**. The A→B detour cap is a *distance ratio* — it is structurally
blind to time. `top_speed:50` buys road quality by making fast roads unattractive, which costs TIME, not
kilometres, so the one guard A→B has cannot see the cost this lever imposes. A duration-growth guard is
the principled fix and needs its own pre-registered A/B.
NOT UNILATERALLY REVERTED. On the owner's stated priority (backroads over main roads) this is a strong
A→B win — main −8 pp, backroad +7 pp, curviness +10 %, highway eliminated — and the median user sees no
extra time at all. But three of fourteen routes take 11-70 % longer and neighbourhood exposure rose, and
"your drive to Collingwood is now 53 minutes longer" is exactly the kind of cost the owner just told me
(BD-105) he weights above menu quality. It goes to him with both columns.
**Discover remains UNMEASURED against this change** — `discover_quality` has not been re-run since
BD-98/BD-100. That is the next measurement, not a conclusion.

**BD-109 — Discover measured against the same unmeasured propagation (BD-108's second half).**
`discover-quality`, post-Phase-A + BD-100 vs the pre-R26 baseline. Origins passing all bars **6/7 → 6/7**,
but the composition changed and one of the changes is on a complaint the owner raised by name:
· **FIXED — Dunnville**: FAIL → PASS (its failing bar was `built 5/6`; now 6/6). Phase A's country tier
  gave a flat-corpus origin enough material to build every drive it offered.
· **BROKEN — Caledon**: PASS → **FAIL** on `onRoad 90 % → 75 %` (bar ≥80 %). A quarter of that menu's
  drive length is no longer on the road the card names. This is a genuine regression and the only hard
  failure introduced.
· **FIXED, and it is the owner's own complaint — "Discover serves the same pre-built routes"**:
  repetition pairs **1/2 → 2/2**. Erin↔Belfountain went from **jaccard 1.00 (all 6 drives identical,
  FAIL)** to **0.50**. Two origins 5 km apart no longer return the same menu.
· top3curv moved both ways (Kimberley 2.93→2.79, Stratford 2.95→2.57, Hockley 1.95→1.72 down;
  Dunnville 1.66→1.87, Caledon 1.26→1.58 up) — no directional claim is supportable from that.
Net: Discover is **not** the regression risk BD-108 flagged it as; it is roughly neutral on the origin bar
and better on menu repetition. **Caledon's onRoad drop is a real defect and is now on the record as
open** — it is not covered by the D-phase index work (that replaces the ranked menu, but `onRoad` measures
whether a served drive follows its named road, which the index inherits).

**BD-110 — CORRECTIONS TO BD-101, BD-104 AND BD-106, forced by an adversarial audit of my own verdicts
(12 agents, 5 independent lenses, every finding put to a skeptic instructed to refute it; 18 raised,
7 verified, 3 survived). The outcomes of all three decisions stand; the REASONS I recorded for two of
them do not, and the instrument that produced them was broken.**

**(1) BD-101's curviness claim is STRUCK. The registered kill bar actually FAILS.**
BD-101 registered `KILL curviness ≥95 %` against a baseline of **0.816** — the all-48-brief mean of the
`curv` column — and then judged the verdict against **1.004**, the mean of the 39 rows with curv>0. Two
different instruments. On the REGISTERED one the arms are mp15 **105.4 %**, mp30 **93.5 %**, mp60
**98.1 %**, so the 30 s arm **trips the curviness kill** it was recorded as passing. The all-brief mean
was the standing convention, not a registration slip: all three of BD-100's curviness figures reproduce
only on it (104.6 %, 98.7 %, +6.2 %) and none reproduce on the measured-only subset. So the instrument
changed, undisclosed, inside the very entry that made a show of correcting other baselines.
**Struck:** "CURVINESS WAS NEVER THE COST (0.989-1.031, all ≥98 % of baseline) — so this refusal is on
road class alone, and I am not hiding behind the twistiness kill bar." That sentence is false against the
registered instrument and unauditable as written. **The honest statement: `maneuver_penalty` at 30 s trips
BOTH the backroad and the curviness kill.** C1 remains REFUSED — more firmly, and for one more reason.
**(1b) And BOTH instruments are unsound, which is the deeper finding.** `curviness === 0` on a loop is
**not a straight drive — it is UNMEASURABLE**: `computeCurvature` skips closed rings, and a loop whose
kept runs coalesce into one ring-spanning run measures nothing (evidence: Waterdown, ctry 0.83 / cvy 54 %,
prints curv 0.00). The all-brief mean scores those gaps as zero; the measured-only subset conditions on
measurability, which correlates with junction density. mp30's entire all-brief shift is zero-count churn
(9→11 zeros). **Root cause: no eval output has ever PRINTED a curviness aggregate**, so every curviness
figure and every curviness kill in R26 — including BD-104's, which registered a curviness kill and then
reported no curviness at all — was an undocumented hand computation over a column with a silent gap.
**FIXED:** `loop_quality.ts` now prints all-brief mean, measured-only mean, AND the unmeasurable count,
with the requirement that a kill bar name its instrument. Console-only; the hash is untouched.

**(2) BD-104's REFUSAL stands; its CAUSAL EXPLANATION is struck.** I wrote that the lever refused because
"on LOOP suites the connector legs are short and already corpus-adjacent, and via-steering has nothing
left to buy." The run's own output contradicts that: **12 of 48 briefs had at least one ACCEPTED connector
refinement** (geometry is mutated only inside the `CONNECTOR_REFINE` block, and `refineLoopFinalist`
returns non-null only on a MEASURED material gain of +2 pp share or +250 m longest run). Via-steering
found and assembled real improvements on a quarter of the suite. **Only brief 7 moved the best-route
columns** — because every road-class, continuity, hood, clean-drive and defect number in the report is
computed on `best` ALONE. So the lever's measured effect reached the instrument **exactly once in 48**,
and a +10 pp bar on that channel could not have detected it. Worse for my wording: those other 11 rows
are **not** "non-presented" — `feas == kept` on all 48 briefs, so they are drives the user IS shown.
**THE REAL FINDING, which outranks the verdict: the eval scores only the top-ranked drive, so any lever
that improves the 2nd-4th drives in the menu is invisible to every R26 A/B.** That is an instrument
limitation affecting the whole program, not a fact about U19.

**(3) BD-106's "binding bar" is an OVERREACH.** `verdict.failures.forEach(bump)` makes the histogram a
**marginal** count — every failed bar bumps for every candidate — so "loopiness×64 > main_share×51"
identifies the **most-often-failed** bar, not a binding one, while ACP-001 relaxes exactly ONE named bar.
It should have read: *"the largest marginal rejection count moved from road class to loopiness."*
The conclusion nevertheless survives on the right instrument, derived from BD-107's own per-cell
histogram deltas at zero extra cost: on the in-flight sweep at 295 cells, **sole-loopiness ≥102
candidates and 19 unfilled cells would reach ≥3 cores on loopiness relaxation alone, against 4
candidates / 1 cell for main_share.** Note also that by 295 cells the MARGINAL ordering had already
flipped back (main_share×1597 vs loopiness×1530) — which is precisely why the marginal histogram must not
be read as causal. **The full sweep will settle it per-cell, not by aggregate count.**

**Also fixed in the sweep, from the same audit, mid-run:** `catch { continue }` was swallowing EVERY
retrieval failure as "out-of-corpus cell" — after the live-cell prefilter has already PROVEN corpus is
present, so anything thrown there is an infrastructure error being silently counted as a dead cell,
corrupting the kill condition's own denominator over a multi-hour run. Errors are now collected, printed,
and excluded from both numerator and denominator with a stated warning. The checkpoint also carries a
`generator|cells|size|scope|keep` **stamp** (resuming a mismatched checkpoint now throws instead of
blending configurations) and a **torn final line** — the normal result of killing a run mid-append — is
skipped with a notice instead of aborting the resume. Sweep restarted on the hardened code: 453 completed
cells replayed from checkpoint, continuing from 457.

**BD-111 — OWNER DECISION (2026-07-29): `top_speed` is gated to LOOPS. A→B is restored to the state
BD-99 actually judged and will be re-registered on its own bars.**
Presented the choice with both columns: keeping it gave A→B main 68→60 %, backroad 31→38 %, curviness
0.97→1.07, highway routes 1→0 and an unchanged median duration, against a 3-of-14 tail
(Barrie→Collingwood 76→129 min) and hood run 1 260→3 498 m. The owner chose to gate. The deciding
argument was not the numbers: A→B was shipping on evidence gathered AFTER the change leaked in through a
shared helper, which is the after-the-fact pattern this whole program refuses — every other adoption in
R26 had to clear a bar registered BEFORE the run.
IMPLEMENTATION: `profileForRequest` now resolves shape-dependently — loops get `FUN`/`BACKROADS`
(top_speed adopted), A→B gets `FUN_ATOB`/`BACKROADS_ATOB`, which are the same profiles with the
pre-BD-100 connector costing restored (`shortest`, sizing 50/38). `TOPSPEED_ATOB=on` restores the leaked
behaviour, so the future A→B re-registration flips a flag instead of re-applying a revert.
**Discover deliberately NOT reverted** — it consumes `BACKROADS` directly, its drives ARE loops, and
BD-109 measured it neutral-to-better under the change.
VERIFICATION, both directions, real output:
· **A→B returned to `ee07cc6c2cd1fc77` — byte-identical to the pre-BD-100 baseline.** Every metric
  matches exactly: routed 14/15, arterial 68 %, curviness 0.97, main 68 %, backroad 31 %, hood run
  1 260 m, turns 3.4. The revert is exact, not approximate.
· **Loops UNCHANGED at `25895a0544443f2f`** — AC 20/48, clean 6, backroad 40 %, main 58 %. The adopted
  win is untouched, which is the whole point of gating rather than reverting.
· 399 backend tests green (4 new, pinning both sides of the split and that `simple`/`chill` are
  shape-insensitive), whole-repo `tsc` clean.
**The BD-110 curviness instrument is now live and immediately reproduced the audit's hand computation:**
`all-brief mean 0.82 (n=48) · measured-only mean 1.00 (n=39) · UNMEASURABLE 9/48 (closed-ring skip, not
straight roads)`. The two instruments that BD-101 silently swapped between are now printed side by side
with the gap named, so no future kill bar can be judged against an unregistered baseline.
**OPEN, carried forward as the highest-value instrument work (BD-110 finding 2): every R26 A/B scored
the top-ranked drive ONLY.** `feas == kept` on all 48 briefs, so drives 2-4 are shown to the user and
measured by nothing. U19 accepted material refinements on 12/48 briefs and moved the reported numbers on
1. Any lever that improves the rest of the menu has been invisible to this entire program.

**BD-112 — R26-D1-FULL COMPLETE (1 177 live cells, artifact `1816fad8d7834245`, zero errored cells).
The kill condition fires at full scale, the per-cell instrument REVERSES the marginal one, and the
honest conclusion is that NEITHER D2 NOR D3 is viable — the index is GENERATION-limited, not
bar-limited.**
RESULT: cores kept **508** (484 loops, 24 ribbons) across **1 177** live cells. Cells with ≥3 cores:
**39 (3.3 %)**. Cells with ZERO cores: **846 (71.9 %)**. Distribution: 0→846, 1→206, 2→86, 3→26, 4→13.
**KILL: <3 cores in 1 138/1 177 cells.**

**BD-106's 12-cell reading does not survive, in BOTH directions — exactly as BD-110 predicted.**
· The MARGINAL histogram at full scale is `assembly_rejected×5538 (22.0 %) · main_share×5093 (20.2 %) ·
  loopiness×4967 (19.7 %)` — so the 12-cell headline "loopiness×64 is now the binding bar, ahead of
  main_share×51" **inverts** at scale. Had I shipped `cell_relaxed` on that reading I would have relaxed
  a bar chosen by a 12-cell sample the full sweep contradicts.
· But the PER-CELL sole-failure instrument (BD-110's remedy, computed free from BD-107's checkpoint
  deltas) says loopiness IS nevertheless the right single bar — and by 7:1: relaxing **loopiness alone
  unlocks 35 cells** (≥162 sole-failure candidates) against **main_share 5** (≥21). Every other bar
  unlocks **zero**. So the conclusion survives while the instrument that produced it is discredited —
  the marginal count ranks how often a bar is *touched*, the per-cell bound ranks what relaxing it
  *buys*, and only the second is a decision.

**WHY D2 AND D3 BOTH FAIL, which is the finding that matters:**
· D2 (ship the index as specified): **3.3 % of cells fill.** Not arguable.
· D3 (`cell_relaxed` on the one binding bar): **6.3 %** (39→74). The pre-approved fallback does not
  rescue it. Relaxing loopiness AND main_share together reaches 27.5 %, but that is no longer
  "relax the ONE named binding bar" per ACP-001 — it is abandoning two of the four quality promises the
  index exists to keep, and it would still leave ~72 % of the region without a menu.
· **The largest single rejection cause is `assembly_rejected` (22 %), which is NOT A BAR.** It is the
  generator failing to build a valid loop at all. **71.9 % of live cells produce zero cores.** No bar
  policy can fix a generator that does not assemble — which is why relaxing bars tops out where it does.
**RECOMMENDATION (owner's call): do NOT ship D2 or D3.** The drive-core index is sound as a mechanism
and its offline hard-measured selection is still the right architecture; it is starved by loop
GENERATION in an 8 km cell, which is the same root cause as BD-102 (shape flat, four refused shape
levers) and the same one the ring-seeding family kept hitting. The honest options are to enlarge the
cell / relax the 8 km scoping so the generator has room, or to accept Discover stays on its Stage-1
gated path until loop generation improves. Both are scope decisions, not tuning.
SCOPING OF THIS RESULT, stated: full-artifact determinism was NOT re-verified by a second 5.5 h run.
It was proven on the 12-cell subset twice (`de00aa5b78e89121`) and by the resume-equivalence test
(6 cells → resume → identical artifact and histogram); the full sweep also reported **zero errored
cells**, so the hardened error path never had to exclude anything from the denominator.

**BD-113 — The menu-wide instrument is LIVE, and its first reading is a product finding in its own
right.** BD-110's second surviving finding was that every R26 A/B scored the top-ranked drive only,
while `feas == kept` on all 48 briefs — so drives 2..k are shown to users and measured by nothing.
Fixed: `loop_quality.ts` now aggregates road class and the clean-drive verdict across the WHOLE
presented menu. Cost: **zero extra engine calls** — `a.classMix` was already carried by every kept
candidate, which is itself part of why the gap went unnoticed for so long. Excluded from the
determinism hash exactly as `ms` is (JSON.stringify drops undefined-valued keys), so every hash recorded
across R25/R26 remains comparable — verified: `25895a0544443f2f` unchanged.
FIRST READING (fixed suite, adopted config):
`MENU-WIDE (all 152 presented drives): backroad 36 % · main 61 % · clean 10/152`
against `bests: backroad 40 % · main 58 % · clean 6/48`.
· Ranking demonstrably works — the top drive is better than its menu on both axes.
· But **only 10 of 152 presented drives are clean**, and stripping out the bests leaves **4 clean out of
  104 (3.8 %)** versus 12.5 % for the bests. **The user is offered roughly three drives per brief and,
  past the first one, almost none of them are good.** That is invisible in every metric this program has
  reported to date, and it is a plausible part of what the owner experiences as an inconsistent app.
· It also means the AC's `kept>=4` diversity clause (BD-103's ceiling of 28/48) has been demanding four
  DISTINCT drives from a pool where the non-top drives are overwhelmingly defective — the clause and the
  quality problem are the same problem seen from two ends.
IMMEDIATE USE: B3/U19 is being re-judged on this instrument. BD-104 refused it because the best-route
backroad share moved +0 pp, but the audit proved the lever accepted MEASURED material refinements on
12/48 briefs and reached the reported columns on 1 — precisely the signature of a lever that acts on
the menu rather than the winner. That re-read is now possible for the first time.

**BD-114 — B3/U19 RE-JUDGED on the menu-wide instrument: REFUSED on BOTH channels. The audit's own
hypothesis is falsified by measurement, and the connector family is now closed.**
BD-110 struck BD-104's causal explanation and raised a specific, testable alternative: the lever
accepted MEASURED material refinements on 12/48 briefs but reached the reported columns on 1, which is
the signature of something that improves the MENU rather than the winner. BD-113 built the instrument
that can see that. Result (`CONNECTOR_REFINE=on`, hash `8f8e96b8abc3aea9` — so the routes genuinely did
change):
· MENU-WIDE backroad **36 % → 36 %** · main **61 % → 61 %** · clean **10/152 → 10/152**
· bests backroad 40 % → 40 % · main 58 % → 57 % · AC 20 → 20 · curviness all-brief 0.82, unchanged
The menu aggregate does not move at printed precision, which bounds the true effect at **<0.5 pp against
a +10 pp bar**. That is consistent with the audit's own arithmetic rather than contradicting it: ~12
drives out of 152 improving by the acceptance threshold (+2 pp share) is ~0.16 pp on the aggregate —
**real, measurable at the individual-drive level, and negligible at the product level.**
So the honest close is neither BD-104's original claim (which I struck) nor the audit's alternative:
via-steering DOES find and assemble genuine improvements on a quarter of the suite, and they are simply
**too small to matter on any channel a user experiences**. Six refusals across R25/R26, now tested on
both the winner and the whole menu. `CONNECTOR_REFINE` stays OFF with its 11 tests. **I am not
re-registering this family again without a new mechanism** — re-testing the same lever on a third
instrument would be looking for a result rather than a fact.

**BD-115 (CORRECTION to BD-112 + PRE-REGISTRATION of R26-D5, registered BEFORE the probe).**
**CORRECTION FIRST.** BD-112 concluded "the index is GENERATION-limited, not bar-limited" on the
strength of `assembly_rejected` being the largest single rejection category (22 %). Decomposed
properly, that was too coarse: of the **846 zero-core cells, only 51** failed exclusively at
assembly/routing — the other **793 DID reach the quality bars** and were rejected there. The accurate
decomposition over 18 832 candidate slots is:
· **31 % never assemble or route at all**
· the remaining ~12 917 assembled candidates carry 19 290 bar-failures = **~1.5 quality bars failed
  EACH**
So candidates are **not marginal-by-one-bar — they fail several simultaneously**, which is the actual
reason the per-cell sole-failure analysis unlocked so little (loopiness 35 cells, everything else ≤5).
"Generation-limited" survives as a conclusion, but the mechanism is *candidates that are broadly
defective*, not *candidates that fail to build*. Recording the correction rather than letting the
tidier version stand.
**WHAT THIS POINTS AT.** The index's entire thesis is GENERATE MANY AND KEEP ONLY WHAT MEASURES CLEAN.
Measured: it generates **16 candidates per cell (2 origins × 6 + 4 ribbons) and keeps 0.4.** A
selection-under-a-hard-bar design run at N=16 is not being given the chance its own premise assumes.
The owner approved "give loop generation room"; the diagnosis says that means WIDENING THE GENERATOR,
not loosening a bar — and notably it keeps every quality promise intact, which `cell_relaxed` would not.
**PROBE (D5), 40 stratified cells chosen deterministically from the full-sweep checkpoint — 30
currently-zero, 6 partial (1-2 cores), 4 already-filled. Baseline on this sample: 4/40 filled.** Arms:
`base` · `gen×4` (4 origins × 12 candidates) · `scope18` (CELL_SCOPE_HALF_M 12 000→18 000) · `both`.
PROCEED TO A FULL SWEEP IFF an arm reaches **≥12/40 filled** (3× baseline) with **no already-filled cell
losing its fill** and **no quality bar relaxed** — the point is more good drives, not lower standards.
If no arm clears it, D5 REFUSES and Discover holds on the Stage-1 path, recorded as such.

**BD-116 — R26-D5 VERDICT: REFUSED on both pre-registered bars. And the lever the owner and I BOTH
picked is measurably the wrong one.** 40 stratified cells, baseline 4/40 filled (reproduced exactly by
the `base` arm — clean control):

| arm | candidate slots/cell | cores | cells filled | filled cells lost |
|---|---|---|---|---|
| base | 16 | 23 | **4/40** | — |
| gen×4 (4 origins × 12) | 52 | 46 | **8/40** | **0** |
| scope18 (12 km → 18 km) | 16 | 21 | **1/40** | — |
| both | 52 + 18 km | 50 | **11/40** | **1** |

Bar was **≥12/40 with no filled cell lost**. Best arm reaches **11** *and* loses a previously-filled
cell — it misses both bars. **REFUSED.** Eleven against twelve is close enough to be tempting, which is
exactly why the bar was written down before the run.

**THE FALSIFICATION, and it is mine to own.** The owner approved "give loop generation room" on MY
recommendation, and I phrased it as "bigger cell / relax the 8 km scoping." Measured alone, **widening
the retrieval scope makes things WORSE: 4/40 → 1/40.** A wider window dilutes the pool — the top-ranked
segments are drawn from further out, so pseudo-origins and material get worse, not better. Had this
shipped on the strength of the recommendation it would have *reduced* Discover's coverage. The probe
cost under an hour.

**WHAT IS REAL.** Generator width works cleanly: 3.25× the candidate slots doubles both cores (23→46)
and fills (4→8) with **zero regressions**, which is the index's own premise (generate many, keep what
measures clean) finally being given a real N. There is also a genuine **interaction**: scope helps ONLY
once the generator is wide enough to exploit it (`both` 11 > `gen4` 8, while `scope18` alone is 1) —
but that same width is what costs a filled cell, since a wider window can displace a good local core.

**BOTTOM LINE FOR DISCOVER.** Even the best arm extrapolates to ~27 % of cells region-wide, leaving
~73 % with no menu, at ~3× the sweep cost (~17 h). Widening generation is a real effect and not a
sufficient one. **Recommendation: Discover HOLDS on the Stage-1 gated path.** `gen×4` is the only
change worth keeping in reserve — it is strictly positive and regression-free — but it does not earn a
17-hour rebuild on its own, and I am not proposing one. Defaults unchanged (`LOOP_ORIGINS_PER_CELL=2`,
`LOOP_CANDIDATES_PER_ORIGIN=6`, `CELL_SCOPE_HALF_M=12000`); all three are now env-overridable so any
future attempt starts from measured ground rather than a fresh guess.

**BD-117 — audit-v13 (90 runs, owner-commissioned): THE OWNER WAS RIGHT AND EVERY EVAL IN THIS REPO WAS
WRONG. The u-turn detector has been measuring maneuver LABELS, not driving.**
60 loops (40 region + 10 Brampton + 10 Southfields) · 20 A→B · 30 Discover, every route traced
edge-by-edge, plus an INDEPENDENT geometric out-and-back detector built specifically because the shipped
detectors were on trial. Detector pinned by 6 unit tests including the two that would have invalidated
the finding (same road same direction → 0; sub-250 m reversals → 0).
**RESULT: 47 of 60 loops drive a stretch of road twice in opposite directions, up to 19 441 m on one
route. Across those same 60 loops the shipped detector reported 4 u-turns.** Southfields — the owner's
own neighbourhood — is 8/10. Defect tally over 90 runs: doubles-back ×52 · main-majority ×43 ·
not-a-loop ×14 · neighbourhood ×13 · wrong-length ×9 · highway ×7 · turn-soup ×5.
Worst single case: Southfields 1 asked for 90 minutes and returned **314 minutes / 217 km**.
**ROOT CAUSE:** `uturnCount` counts Valhalla maneuver labels; loops are assembled with
`middleType: 'through'` (loop.ts:216), which route.ts:124 documents as "pass through without stopping
or U-turning" — so the router is FORBIDDEN to u-turn at the waypoint, doubles back along the road
instead, and never emits a `uturn_*` label. The AC clause `bestUturns === 0` has therefore passed on
routes full of reversals for the entire life of the project. Every "0 u-turns" claim in this log is void.
CONTRAST WORTH KEEPING: Discover's pre-built cores measure **86 % backroad with 1 of 179 doubling back**.
The offline generate-many-and-hard-reject pipeline produces good drives; the live assembly path does not.
That gap is the strongest evidence that the defect is in live assembly, not in the corpus or retrieval.

**BD-118 — MY HYPOTHESIS WAS WRONG, AND I PUBLISHED IT BEFORE TESTING IT.** I told the owner that
COUNTRY_VALUE's length-dominance (segValueOf's `1 +` floor collapsing curvature's dynamic range, forcing
`byValue[0]` into an end-to-end traversal) CAUSED the doubling-back. It does not. Measured on the same
24 loops: reverting it moved out-and-back 20/24 → 17/24, the WORST case got worse (10 616 → 16 650 m),
and per-route it was better on 7, unchanged on 11, worse on 6. **The doubling-back is structural and
PREDATES R26.** I had a plausible code-level story and presented it as a cause before running the test —
the same failure mode that produced the rest of this mess. Recorded because the pattern matters more
than the instance.

**BD-119 — CONNECTOR_TOPSPEED and COUNTRY_VALUE both REVERTED TO OFF (owner approved 2026-07-30). The
eval that adopted them has no wall-clock budget; production has 25 s, and the owner has been driving
TRUNCATED routes.** Three-way on 24 identical loops:

| config | truncated (`best_so_far`) | doubles back | backroad | clean |
|---|---|---|---|---|
| R26 as shipped (both on) | **14/24** | 20/24 | 48.4 % | 1 |
| **both OFF (adopted)** | **2/24** | **17/24** | 37.6 % | 1 |
| COUNTRY_VALUE on, TOPSPEED off | 2/24 | 22/24 | 36.5 % | 0 |

· **`CONNECTOR_TOPSPEED` is the timeout culprit** — off drops truncation 14→2 in both configurations.
  `best_so_far` means the planner hit the wall and shipped whatever it had: fewer candidates considered,
  worse selection. That is exactly the owner's "clear better paths it doesn't take" and "better 10
  commits ago", and `eval/loop_quality.ts` models no wall clock, so BD-100's +13 pp backroad was bought
  with latency the instrument could not see.
· **`COUNTRY_VALUE` earns nothing alone** — 36.5 % vs 37.6 % backroad and MORE doubling (22 vs 17). Its
  apparent gain existed only in combination with the lever that was timing the app out.
· **`COUNTRY_TIER` STAYS ON.** BD-97's diagnosis (133 k roads loaded, indexed and never offered) was the
  one genuinely correct finding of R26 and is untouched by this.
COST, stated plainly: backroad share ~48 % → ~38 %. Accepted, because a completed search beats a
richer-looking route that gave up. `frozen-r26-v1` is superseded and must be re-cut once the suites
confirm.

**BD-119 (VERIFICATION, both standard suites).** Fixed `a9525828b17c3a67` · random `67685293c218a58e` ·
A→B `ee07cc6c2cd1fc77` (unchanged — BD-111 had already gated A→B).

| | R26 as shipped | reverted (adopted) |
|---|---|---|
| **truncated results** (audit, real `/plan` entry) | **14/24** | **2/24** |
| briefs passing all AC (fixed) | 20/48 | **25/48** |
| briefs passing all AC (random holdout) | 7/30 | 7/30 |
| clean drives (fixed) | 6/48 | 2/48 |
| backroad / main (fixed) | 40 / 58 % | 35 / 63 % |
| no-route | 0 | 1/48 |

THE TRADE, stated without spin: **AC +5 on the fixed suite and truncation cut by 86 %**, against
**backroad −5 pp and clean drives −4**. Adopted, for one reason: the clean-drive and backroad figures
were partly MANUFACTURED BY THE TRUNCATION they came with — a `best_so_far` ships a raw mid-search
candidate that happens to be country-heavy, without the selection pass that would have judged it. AC
is the composite that actually gates on u-turns, spurs, retrace, residential and duration, and it moved
the right way by 5 briefs. A completed search beats a richer-looking route that gave up.
NOTE ON THE INSTRUMENT, which is the lesson: `eval/loop_quality.ts` re-implements the pipeline and
therefore never sees the 25 s budget, while `eval/audit_v13.ts` calls `runPlanner` — the real production
entry — and does. Two harnesses, one blind. Every future planner adoption must be judged through
`runPlanner`, not around it.
The right way to win the 5 pp of backroad back is the country TIER plus a genuine continuity objective —
not a costing lever that exhausts the budget.

**BD-120 — ADOPTED: out-and-back is now an assembly REJECT. The owner's loudest complaint, fixed and
measured, on the instrument that can actually see it.**
audit-v13 found 47/60 loops driving a stretch of road twice while the three shipped detectors reported
4 u-turns between them (BD-117). `outAndBack` (backend/src/planner/outandback.ts, 6 unit tests including
the two false-positive cases that would have invalidated it) measures the defect from geometry, so it
does not depend on maneuver labels or road names — the two things that made the existing detectors blind.
Wired into `assembleLoop` following the SAME two-tier shape the file already documents for u-turns and
spurs, and for the same recorded reason (round-6: a blanket hard cap rejected 687 candidates and left
0/40 briefs alive): only an egregious doubling dies at assembly, everything shorter is carried.
`OUT_AND_BACK_REJECT_M = 2500`.
MEASURED (24 identical loops, real `runPlanner` entry, everything else frozen):

| | before | after |
|---|---|---|
| **total metres driven twice** | **99 428 m** | **25 331 m (−75 %)** |
| **worst single doubling** | **16 650 m** | **2 830 m (−83 %)** |
| loops with any doubling | 17/24 | 14/24 |
| truncated (`best_so_far`) | 2/24 | **0/24** |
| **no-route (starvation guard)** | 0/24 | **0/24** |
| backroad | 37.6 % | 36.0 % |
| clean drives | 1/24 | 1/24 |
NO STARVATION — the failure mode that killed this idea twice before did not occur, because the threshold
targets the tail rather than the behaviour. Cost is 1.6 pp of backroad share, accepted.
NOT FINISHED: 14/24 loops still double back, all now under 2 830 m. The next step is a threshold sweep
(1 200 m is the obvious candidate, matching `RETRACE_RUN_SOFT_M`) plus a presentation-layer demotion so
that a route with ANY doubling ranks below a clean one — the same split that made the u-turn rule work.

**BD-121 — out-and-back threshold swept to 1 200 m (matching `RETRACE_RUN_SOFT_M`), and the app-layer
chip/AI defects fixed.** Threshold sweep on 24 identical loops, real `runPlanner` entry:

| | doubling routes | worst | TOTAL doubled | no-route | truncated | backroad |
|---|---|---|---|---|---|---|
| before any fix | 17/24 | 16 650 m | **99 428 m** | 0 | 2/24 | 37.6 % |
| reject @2 500 m | 14/24 | 2 830 m | 25 331 m | 0 | 0 | 36.0 % |
| **reject @1 200 m (adopted)** | **12/24** | 3 410 m | **18 916 m** | **0** | **0** | **37.3 %** |

**81 % of the doubled metres are gone, with zero starvation and no backroad cost** (37.3 % vs 37.6 %
before the fix). 1 200 m beats 2 500 m on routes affected, total doubled AND backroad share. The one
axis where it is worse — worst single case 3 410 m vs 2 830 m — is a route that reaches the user through
a relaxation rung or the never-empty fallback, i.e. a path that bypasses the assembly gate; that is the
next thing to close, and it is recorded rather than smoothed over.

**APP LAYER (the "text box" and "half the AI" complaints), all three fixed:**
1. `quick_fill.ts` set `style = null` for twisty/scenic/rural, meaning "let the text decide" — but `null`
   IS the "No preference" chip, so typing "twisty" visibly DE-SELECTED Fun & Explorative. Now maps to
   `'backroads'`. **The unit test asserted the defect** ("a twisty ask CLEARS the chip"); the expectation
   was wrong, not the code, so the test was corrected — with the reason written into it — rather than the
   behaviour re-broken.
2. `c.preset === 'chill'` was unreachable — `parse_rules` emits chill on `intensity`. Typing "chill
   drive" moved nothing. Fixed, with a test.
3. **The weaker parser was beating the better one on every request.** Chips fill from the RULES parse
   (`/parse`); `/plan` runs the LLM parse, which this project's own gate measures at 0.916 vs 0.852. The
   app sent those guessed chips as if the user had tapped them, and `applyClientOverrides` replaced the
   LLM output on truthiness. `buildPlanRequest` now takes `autoFilled` and WITHHOLDS chips quick-fill
   guessed from the same brief the server is about to parse properly. A chip the user actually tapped
   enters `touched` and is still authoritative.
App suite 152 green; backend 405 green.

**BD-121 (CORRECTION — threshold held at 2 500 m, NOT 1 200 m).** The 1 200 m threshold measured better
on the audit (18 916 m doubled vs 25 331 m, 12/24 routes vs 14/24, backroad 37.3 % vs 36.0 %) but it
REJECTS the `loop.test.ts` live-engine fixture — a Hamilton→Dundas→Ancaster circuit the repo documents
as having "distinct out/return corridors". Two tests fail on it.
That is a genuine unresolved question, not a nuisance: either the fixture is not as clean as its comment
claims (in which case 1 200 m is right and the fixture must be re-chosen), or 1 200 m clips legitimate
shared-corridor geometry (in which case the audit gain is partly false). **I am not resolving it by
loosening a test at the end of a long session** — Hard rule J, and the whole reason this audit exists is
that I previously trusted a convenient reading. Threshold stays at the measured-safe **2 500 m**, which
keeps the −75 % result with all 405 tests green.
NEXT: measure `outAndBack` on that exact fixture geometry. If it genuinely doubles >1 200 m, replace the
fixture and take the 1 200 m threshold; if not, the detector needs a shared-corridor exemption.

**BD-121 (probe note, NOT a resolution).** Routed the `loop.test.ts` fixture waypoints directly
(Hamilton→Dundas→Ancaster→Hamilton, `through` middles, default costing): 29.3 km with
**out-and-back longest 0 m, total 0 m** — so on that path 1 200 m would accept it. But the probe is NOT
faithful to the failing test: `assembleLoop` applies the resolved costing profile, the repair pass and
the candidate's own via handling, none of which the probe reproduces. **The question therefore remains
open and the threshold stays at 2 500 m.** Recorded so nobody later reads "probe said 0 m" as evidence
the 1 200 m threshold is safe — it is evidence only that the raw corridor is clean.

**BD-122 — ADOPTED: out-and-back added to `fallbackOffenceUnits`. This, not the assembly reject, is what
killed the catastrophic doublings.**
BD-120's assembly reject worked on the routes that reach the user as `ok`, but audit-v13 showed the
worst cases surviving anyway. Diagnosed from the audit data: **all 5 doublings above the 2 500 m reject
carried `relaxed` status**, and 21 of 60 loops reach the user that way. The mechanism is the never-empty
fallback — when every candidate is rejected the planner still presents the LEAST BAD one, and
`fallbackOffenceUnits` decided which that was **with no term for doubling at all**. `retraceRunM` was
present but is precisely the detector that misses these reversals (named-road repetition; misses name
changes and unnamed rural road). So the reject moved bad routes into the fallback pool and the fallback
happily served them.
FIX: `outAndBackLongestM` added to `OffenceInput`, weighted so a kilometre driven twice costs one full
u-turn unit (a u-turn IS the cheapest possible out-and-back, so anything longer must cost at least as
much). Plumbed at all four `fallbackOffenceUnits` call sites; the A→B/alternates paths measure from
geometry since their result shape does not carry the field.
MEASURED (60 loops, real `runPlanner` entry, everything else frozen):

| | worst doubling | total doubled | routes affected | no-route |
|---|---|---|---|---|
| reject only | 15 780 m | 109 467 m | 40/60 | 2/60 |
| **+ fallback ranking** | **3 011 m (−81 %)** | **92 890 m (−15 %)** | 39/60 | 2/60 |

Against the ORIGINAL audit (R26 flags on, no reject): worst **19 441 m → 3 011 m, −85 %**; routes
affected 47/60 → 39/60. No starvation, backroad unchanged (35.9 → 36.0 %).
HONEST LIMIT: the fix does not reduce HOW MANY routes contain some doubling (40 → 39) — it removes the
catastrophic tail by making the fallback choose better among bad options. Reducing the count needs
generation that produces genuinely clean loops, which is the same open problem as loop shape.
BOOKKEEPING CORRECTION: `audit-v13-before.json` was copied AFTER the post-fix run had already overwritten
`audit-v13.json`, so it is not a true before-snapshot. The original figures (47/60, 19 441 m) come from
BD-117 and are the honest baseline.

**BD-123 — R27 scoping: the main-road problem is GENERATION, and I have now falsified every ranking and
costing lever against it. Recorded so nobody spends another round on them.**
audit-v14 (90 runs, FRESH SEED — a holdout, not a re-test) with all R27 fixes in:
worst doubling **19 441 → 5 813 m** on unseen origins (the fix generalises), highway 0.5 %, u-turns 0.
But **main_majority 59/90** is now the largest defect class: loops average **34.5 % backroad / 61.3 % main**.
Levers tested against it, all measured on the real `runPlanner` entry:
1. **MAJORITY grade (R27, new) — REFUSED, INERT.** The owner's first-order rule ("backroads must be the
   MAJORITY") had NO term in the ranking at all: R25-U10 designed one, only the continuity half was ever
   wired (BD-88). I built it (zero at parity, rising to max at a 40 pp deficit, deliberately the largest
   within-tier term) and it moved **main_majority 43/60 → 43/60, backroad 34.5 → 34.8 %.** Nothing.
   Same lesson as BD-39/62/88: **ranking can only choose among what generation produced**, and when every
   candidate in the pool is main-majority, penalising main-majority is a no-op. Flag ships OFF; the code
   and the correct encoding stay for when generation can supply the choice.
2. **`top_speed` 60 — REFUSED.** backroad +3.2 pp and truncation 1→0, but main_majority 19→22, doubling
   17→21, clean 3→1. A small road-class gain bought with everything else.
3. `top_speed` 50 (BD-100/119), COUNTRY_VALUE (BD-119), U19 via-steering (BD-93/104/114) — all previously
   refused.
**WHILE DOING THIS I FOUND A REAL STRUCTURAL DEFECT AND FIXED IT ANYWAY:** the within-tier grades were
never within-tier. `score` is a weighted sum of 0..1 terms with weights <1 (curviness, the dominant
quality term for backroads, is 0.4), so its whole range is ~1 — while `CONTINUITY_GRADE_MAX` was **6**.
A "tie-breaker" outweighed every quality signal by 6-15×, meaning the planner literally could not see the
difference between a good drive and a bad one. That is the owner's "there are clear better paths it
doesn't take". Continuity rescaled **6 → 3**. (Continuity is also a weak proxy: `backroadLongestM`
measures a run of road CLASS, not of one road, so a concession-grid zigzag scores as continuous.)
**THE DECISIVE MEASUREMENT — where the main road actually is.** Backroad share by position along a loop:
**first 20 % 13.7 % · middle 60 % 34.1 % · last 20 % 12.3 %**; main+urban is **83.4 % at the ends** vs
63.8 % in the middle. So the arterial is disproportionately the ESCAPE FROM AND RETURN TO THE DOOR —
which is a PRODUCT problem, not a routing one — but the middle is still main-majority, which is a real
generation problem. Both are true; neither is fixable by ranking.

**BD-124 — ADOPTED (owner decision 2026-07-31): the THREE-LEG SPLIT. Stop averaging the commute into
the drive.**
BD-123 falsified every ranking and costing lever against main-road share and located the real shape of
the problem: the arterial is disproportionately the escape from the door. The owner chose the product
fix over another routing lever.
BUILT: `backend/src/planner/legs.ts` — `splitLoopLegs` cuts a routed loop at the FIRST and LAST corpus
waypoint (geometric, because loop waypoints are `through` locations and Valhalla does not split legs at
those — `route.legs` is a single leg for a loop, so per-leg summaries cannot supply this). Returns the
three spans plus percentages; `driveGeometry` yields the drive alone so it can be measured on its own.
It REFUSES to report a drive shorter than 25 % of the trip — claiming "the drive" for a 500 m corpus
span inside a 10 km commute would be exactly the dishonesty this exists to remove. 6 unit tests.
Wired onto `PlannerResult.legs` (loops only, one extra trace on the chosen route) so the app can show
"getting there 14 min · THE DRIVE 62 · home 16" instead of one averaged blob.
MEASURED (29 loops, fresh-seed holdout):

| | backroad | main | main-majority |
|---|---|---|---|
| WHOLE route (what the app showed) | 31.5 % | 63.9 % | 20/29 |
| **THE DRIVE alone** | **42.4 %** | **53.8 %** | 16/25 |

**+10.9 pp backroad and −10.1 pp main, purely by measuring the right thing.**
**AND THE FINDING THAT MATTERS MOST — the split itself: getting there 28 % · the drive 51 % · home 20 %.**
**Nearly HALF of a "90 minute loop" is the commute to and from the drive.** A user asking for 90 minutes
gets roughly 43 minutes of actual drive and 47 minutes of getting there and back, and every metric this
project has ever reported averaged those together. That is why no routing lever could move road class:
half the metres being measured were never the product.
STILL TRUE, and not hidden by the reframing: the drive itself is main-majority on 16 of 25 loops. The
split makes the number honest; it does not make the drive good. Sizing the DRIVE to the requested
duration (rather than the whole loop) is the obvious next unit and is a GENERATION parameter, not a
ranking one — which is the category BD-123 says is the only one left that can work.

**BD-125 — R28 probe on the owner's OWN device report (Inglewood + Forks of the Credit, 2026-07-31).
Found a FOURTH unmodelled defect class, built the detector, and refused BOTH fixes I tried for it.**
The owner reported two things audit-v15 said were clean: *"random road entries and exits u-turns like
many times in Inglewood"* and *"near Forks of the Credit it loops around some random box at the top"*.
Probed 24 real loops through `runPlanner` from his two places plus six neighbours.

**FINDING 1 — the "random box" IS a microloop, DETECTED and SHIPPED.** `maxMicroloops` defaulted to 1,
so a single block-circuit is ACCEPTED by design (the two-tier shape that avoids the starvation
zero-tolerance caused twice for u-turns). 2 of 24 routes carried one, both near the Forks. The owner is
seeing exactly what the code permits.
**REFUSED: `MICROLOOPS_MAX=0`.** It works on the defect (microloops 2/24 → **0/24**, doubling 14→13,
u-turns 1→0) and is unaffordable: **truncated results jump 3/60 → 21/60**. Rejecting every box forces
the search past the 25 s budget, which is precisely the disease BD-119 diagnosed and fixed. It also
fails the same `loop.test.ts` live-engine fixture the 1 200 m out-and-back threshold failed (BD-121) —
that fixture now has two independent reasons to be re-examined. Default stays 1; knob is
`MICROLOOPS_MAX`.

**FINDING 2 — "in and out of Inglewood many times" is a defect class NOTHING in this codebase models.**
It is not short doublings: at the shipped 250 m floor AND at 80 m, multi-doubling is **0/24**. It is the
route RETURNING TO THE SAME PLACE from different directions — which every existing detector is blind to
by construction: `outAndBack` needs opposed headings on the same road; `microloopPositions` needs a
closed circuit; `spurPositions`/`maxRetraceRunM` need a repeated road NAME; `uturnCount` reads maneuver
labels that `through` waypoints suppress; `selfOverlapRatio` counts shared EDGES, and approaching one
crossroads from four directions shares no edge.
Measured on his own places: **13 of 24 routes revisit 2+ distinct locations, worst 9 places on one 60 km
loop** (Forks of the Credit "1 hour backroads loop": 8 places, 3 passes each).
BUILT: `backend/src/planner/revisit.ts` + 5 tests, including the two false-positive guards that would
have made it worthless (a loop closing at its own origin is NOT a revisit; spatial nearness without
along-route separation is NOT a revisit).
**REFUSED as a ranking lever, shipped at `REVISIT_UNIT = 0`.** Wiring it into `fallbackOffenceUnits`
moved the defect the WRONG WAY: routes with 2+ revisited places **13/24 → 14/24**, total places
**62 → 72**, worst unchanged at 9. **This is the FIFTH ranking refusal** (BD-39, BD-62, BD-103, BD-123,
now this) and I ran it in direct contradiction of `docs/R28_plan.md`, which I had written hours earlier
saying to stop testing that category. Recorded as a discipline failure, not just a null result.
THE DETECTOR STAYS. It is the first instrument that can see this defect at all, and the term is one
constant from live once generation can supply a clean alternative.

**WHAT BOTH REFUSALS CONFIRM:** every affordable gate costs search time the 25 s budget does not have,
and every ranking term chooses between equally-bad candidates. That is `docs/R28_plan.md`'s thesis
stated twice more, from two new directions. **The next work is R28-1 (widen the offline generator and
re-sweep), not another live-planner lever.**

**BD-126 — R28-2 BUILT (flag OFF, awaiting the R28-1 index): live loops seeded from measured-clean
drive cores.** The generation-side answer to the 43 %-vs-86 % backroad gap, after five ranking levers
and three costing levers were built and refused against it.
`backend/src/planner/core_seed.ts` + 8 tests. Cores from the offline index (migration 0016, read via the
existing `discover_drive_cores` definer) become **ordinary `WaypointCandidate`s in the SAME pool** as
generated ones — deliberately NOT a parallel path. Every assembly reject, score, diversify pass and the
never-empty fallback apply unchanged, so a core-seeded loop wins only if it MEASURES better. Blast
radius is "one more candidate source", not "a second planner", and it makes the A/B honest.
DESIGN POINTS THAT CARRY MEASURED HISTORY:
· **Dense vias, not endpoints.** A core is sampled every ~2.5 km into via points. R25's probe 7 measured
  what happens with only endpoints — 3.8× distance and MORE arterial, because Valhalla picks its own
  path between far-apart waypoints. That is the failure mode all four refused span-forcing attempts
  shared, and a test pins that a long core never reduces to two vias.
· **Ranked by measured backroad share, then curviness, then id** — no distance-from-origin term, which
  would re-create the capped-distance mis-ranking BD-91 found in Discover. The connector cost is what
  the assembly measures; it does not need help.
· **Cores longer than the ask are dropped before assembly** — no connector can shorten a core, so
  seeding one spends an engine call to produce a guaranteed duration failure.
· `clusterWeight` carries the core's measured backroad share rather than a cluster mass it never had.
FAIL-OPEN: an unavailable index leaves the live pool untouched. `CORE_SEED=off` is byte-identical.
NEXT: R28-1's wide sweep (4 origins × 12 candidates, 1 185 cells, running) → load with
`eval/load_drive_cores.ts` → flip `CORE_SEED=on` → A/B on the real `runPlanner` entry against
audit-v15's `a9525828b17c3a67`-era numbers (backroad 34.5 %, doubling 44/60, revisits 13/24).
424 tests green.

**BD-127 — THE SAME TWO FLAGS BELONG **OFF LIVE AND ON OFFLINE**. Caught mid-sweep, and it nearly cost
the whole R28 index.**
The R28-1 wide sweep was launched inheriting the BD-119 reverts (`CONNECTOR_TOPSPEED=off`,
`COUNTRY_VALUE=off`). At 665/1185 cells its yield looked WORSE than the old narrow sweep, which would
have falsified R28-1's premise. It does not: **the comparison was CONFOUNDED** — the narrow sweep ran
before those reverts, so it was width+reverted vs narrow+R26-flags, not width vs narrow. Nearly drew
the wrong conclusion from it.
The confound points at the real fact: **BD-119 reverted those flags because they blow the 25 s LIVE wall
budget (58 % of loops shipped truncated). The offline sweep has no wall budget at all.** So their
road-class benefit — which is what lets a core pass the `main_share ≤30 % / backroad ≥55 %` bars — is
free offline and was being thrown away.
MEASURED, 40 identical cells (selected as productive in the narrow sweep — a biased sample for absolute
yield, but the BETWEEN-ARM comparison on identical cells is valid):

| config | cores | cells with ≥3 |
|---|---|---|
| narrow + R26 flags on (the shipped index) | 48 | — |
| wide + flags OFF (what was running) | 28 | 1 |
| **wide + R26 flags ON** | **77** | **12** |

**2.75× the cores and 12× the filled cells** versus the config the sweep was actually using, and 1.6× the
cores versus the old narrow index. Sweep killed at 665 cells and relaunched with
`CONNECTOR_TOPSPEED=on COUNTRY_VALUE=on` plus the width.
**THE GENERAL LESSON, worth more than the sweep:** a lever's verdict is not a property of the lever, it
is a property of the lever AND the budget it runs under. `top_speed` is a road-class win that costs
search time; live that trade is fatal and offline it is free. Every future planner flag should be judged
per-context, and this program's flags should be read as "off live" / "on offline" rather than simply
"off".

**BD-128 — THE BREAKTHROUGH: RIBBON cores work, LOOP cores cannot. 95 % backroad vs the planner's
34.5 %, and the index is 2.3 % ribbons.**
R28-2's first A/B was inert (backroad 34.5 → 34.7 %). Rather than tune, diagnosed it through the real
assembly path, and found three things in order:
1. **Cores were sized to the whole ask.** Median core is 60 min; a 90-minute request admitted 90-minute
   cores, and the connectors needed to REACH one pushed the loop to ~120 min, tripping the duration
   tier. Fixed (target ~0.55 of the ask, hard ceiling 0.75) — and it barely moved the needle
   (drive backroad 44.9 → 45.0 %), so the sizing bug was real but not the cause.
2. **The bbox was Discover's 45 km browse radius.** The definer returns the top N by QUALITY within the
   box, so a wide box hands back 20 excellent cores that are all unreachable: measured **0 seeded** at
   every origin once the reach filter was added. Fixed by querying a reach-sized box.
3. **Valhalla refuses >20 locations.** Long cores crashed the route call outright; vias are now
   RE-SPACED (never truncated — truncation would drop the core's tail and hand Valhalla the way home).
**THEN THE REAL FINDING.** With all three fixed, cores assemble and the road class is transformative —
Southfields: a 32 min / 93 % core → a 49 min route at **73 % backroad**. But **14 of 15 were REJECTED
for `out_and_back`** (3.4-15 km), and tightening the reach did not help (6 km: 0/21 accepted; 10 km:
1/23). **Because it is geometry, not tuning: a LOOP core plus a door is a lollipop, and the stick
always doubles.** No proximity fixes that — the origin is not on the core, so you drive out to its
perimeter and back the same way.
**RIBBONS DO NOT HAVE A STICK.** Two distinct ends, so the trip goes out one way and home another —
which is precisely what the R25 plan predicted ("ribbons make the owner's 'different way home' free BY
CONSTRUCTION"). Measured on all 24 ribbons in the index:

| core kind | accepted at assembly | backroad of accepted |
|---|---|---|
| loop cores | 1/15 (7 %) | 49 % |
| **ribbons** | **12/24 (50 %)** | **95 %** |

**95 % backroad against the live planner's 34.5 %** — the first thing in this entire program that
delivers the owner's original ask rather than nudging it.
**THE INDEX IS BUILT WRONG FOR THIS USE.** `build_drive_cores.ts` generates
`LOOP_ORIGINS_PER_CELL × LOOP_CANDIDATES_PER_ORIGIN = 48` loop candidates and `RIBBONS_PER_CELL = 4`
per cell, yielding **1 030 loop cores and 24 ribbons**. For DISCOVER that was right (it shows the
commute as its own leg, so a loop core is fine). For seeding a loop FROM YOUR DOOR it is exactly
backwards. **R28-1 must be re-run ribbon-heavy.** That is the next unit, and it is a sweep parameter,
not new machinery.

**BD-129 — the ribbon supply was gated by ROAD LENGTH, not by the per-cell cap.** After BD-128 showed
ribbons are the shape that works (12/24 accepted at **95 % backroad** vs loop cores 1/15 at 49 %), the
obvious move was to raise `RIBBONS_PER_CELL` 4 → 24 and re-sweep. That produced **exactly 24 ribbons
again** across 1 177 cells — the cap was never the constraint.
The real gate is `CORE_RIBBON_ENDPOINT_MIN_M = 8 000`: a ribbon is built from ONE merged road, and few
roads in this region run 8 km unbroken. Measured on 60 identical cells:

| ribbon min length | ribbons produced |
|---|---|
| 8 000 m (shipped) | **0** |
| 4 000 m | **22** |

Made the constant env-configurable and re-swept at 4 000 m, ribbon-heavy. Note the shipped 8 km value
was correct for DISCOVER, where a ribbon is a destination drive and wants to be long; for seeding a
door-to-door loop the ribbon only has to supply the good middle, and the measured ribbons that worked
were **11-15 minutes** long yet assembled into 41-47 minute routes at 95 % backroad — because a ribbon
deep in backroad country drags its CONNECTORS onto backroads too. Short ribbons are not a compromise
here; they are the mechanism.

**BD-130 — R28-2 REFUSED with full ribbon coverage. The tenth lever, and I am stopping this direction
as pre-committed rather than reaching for an eleventh.**
BD-128 measured ribbons at **95 % backroad** in isolation (12/24 accepted). BD-129 traced the thin
supply to a length gate. Then BD-130 found the deeper bug: `CORE_RIBBON_ENDPOINT_MIN_M` was ONE constant
doing TWO unrelated jobs — the minimum ROAD LENGTH a ribbon is built from, and the minimum SEPARATION
between its two ends. Lowering it to admit shorter roads therefore also admitted winding roads whose
ends nearly touch, which then failed the separation bar: **1 242 `endpoint_separation` rejections**, the
largest single ribbon killer. Split into `CORE_RIBBON_MIN_LENGTH_M` vs `CORE_RIBBON_ENDPOINT_MIN_M`,
plus `CELL_RIBBON_RESERVED` so loop cores stop crowding ribbons out of the per-cell keep.
That worked on its own terms — the index went **24 → 367 → 1 114 ribbons**, and reachable-ribbon
coverage went from **0/8 real origins to 6/8** (Southfields 0→9, Brampton 0→9, Barrie 0→44).
AND THE A/B STILL REFUSES:

| | backroad | THE DRIVE | doubling | revisits | clean | truncated |
|---|---|---|---|---|---|---|
| baseline | 34.5 % | 43.0 % | 44/60 | 42/60 | 4/60 | 3 |
| thin ribbons (r30) | 34.6 % | 44.1 % | 44/60 | 44/60 | 4/60 | 4 |
| **full coverage (r31)** | **36.5 %** | **45.7 %** | 45/60 | 43/60 | 4/60 | 5 |

Registered bars were drive backroad **≥55 %** and doubling **≤30/60**. **+2.7 pp and +1 doubling.**
Real, and an order of magnitude short of the isolated 95 %.
`CORE_SEED` ships OFF. The index, the seeder, the detectors and the split constants all stay — they are
correct, tested and measured; the integration is what does not pay.
**WHY THE ISOLATED 95 % DID NOT SURVIVE INTEGRATION** is now the honest open question, and I am NOT
guessing at it after ten refusals. The candidates are: cores are seeded but lose the presentation
ranking to generated candidates; `CORE_SEED_MAX = 4` samples only 4 of up to 44 available ribbons; the
reach filter still admits ribbons whose orientation forces a stem. Each is testable and NONE should be
attempted before someone decides whether the live door-to-door loop is the right product at all.
**THE PRODUCT-LEVEL FACT THIS PROGRAM HAS NOW ESTABLISHED TEN TIMES:** a loop that starts and ends at a
suburban door spends ~half its metres escaping and returning (audit-v15: there 28 % · drive 49 % ·
home 23 %; ends 83 % main+urban vs 64 % in the middle). Discover, which SHOWS the commute as its own leg
and optimises only the drive, measures **86 % backroad**. The live loop planner, optimising a blob that
is half commute, measures 36 %. That gap is architectural, not a tuning failure, and no ranking,
costing, gate or seeding lever has moved it.

**BD-131 — the blocking fixture was itself defective, and replacing it unlocked a 44 % cut in doubling.**
`loop.test.ts`'s "a real circuit closes within ε" fixture (Hamilton → Dundas → Ancaster) blocked BOTH
the 1 200 m out-and-back threshold (BD-121) and zero-box tolerance (BD-125), and I twice declined to
resolve it rather than loosen a test at the end of a session. Measured it properly through the same
`assembleLoop` path the test uses:
**out-and-back longest 1 494 m, total 3 113 m over 4 runs, and 1 microloop** — against a comment
claiming "distinct out/return corridors". **Both rejections were CORRECT.** The test was asserting that
a defective route is acceptable, the same pattern as the quick-fill test that pinned the twisty-chip bug
(BD-125). Fixed the FIXTURE, not the assertion: Hamilton → Binbrook → Mount Hope measures
**selfOverlap 0.00, out-and-back 0 m, microloops 0** — a circuit that deserves to pass. (The repair test
shared the same waypoints and was updated with it.)
**ADOPTED: `OUT_AND_BACK_REJECT_M` 2 500 → 1 200** (matching `RETRACE_RUN_SOFT_M`). 60 loops, fresh-seed
holdout, real `runPlanner` entry:

| | total doubled | worst | routes affected | no-route | truncated | backroad |
|---|---|---|---|---|---|---|
| 2 500 m (shipped) | 79 870 m | 5 813 m | 44/60 | 0 | 3 | 34.5 % |
| **1 200 m (adopted)** | **44 632 m (−44 %)** | **3 531 m (−39 %)** | **38/60** | **0** | 3 | 30.8 % |

THE TRADE, not hidden: **−44 % of the metres driven twice, for −3.7 pp backroad share.** Adopted because
doubling back is the defect the owner NAMED and SEES on the map ("random drives down a road then u turns
back again"), while backroad share is a number I report to him. No starvation (no-route 0/60) and no
extra truncation. Reversible with `OUT_AND_BACK_REJECT_M=2500`.
**CUMULATIVE on the owner's loudest complaint:** worst single doubling **19 441 m → 3 531 m (−82 %)**,
total doubled metres down 44 % from where R27 left it, and the shipped u-turn counter that reported
**4** across 60 routes has been replaced by a detector that measures the thing itself.

**BD-132 — SHIPPED: the three-leg split reaches the user. The app stops calling the commute "the drive".**
BD-124 built `splitLoopLegs` and put the numbers on `PlannerResult`; they never left the backend. So the
card still said "90 minute loop" for a trip that audit-v15 measures as **28 % getting there · 49 % drive
· 23 % home**, with the ends at 83 % main+urban against 64 % in the middle. That is the most dishonest
thing left in the product, and the data to fix it was already computed.
· `shared/src/types/route.ts` — `Route.legs`, nullable-optional so it is ADDITIVE. Installed builds
  zod-validate strictly and cannot be force-updated, so a pre-R28 payload without `legs` must still
  parse; a contract test pins all three shapes (absent / present / null for A→B).
· `backend/src/routes/plan.ts` — emits it on the chosen route.
· `app/src/components/RouteDetail.tsx` — a three-segment bar (commute · THE DRIVE in accent · commute)
  plus "getting there 24 min · **the drive 43 min (46 % backroad)** · home 23 min".
The drive's road class is measured on the DRIVE ALONE — 45.7 % backroad against 36.5 % for the blob —
so the number the user reads is finally the number that describes what they came for.
426 backend · 152 app · 24 shared tests green; whole-repo `tsc` clean.

**BD-133 — ADOPTED: an area-revisit GATE (where the RANKING lever failed), and the brief-named
destination no longer blocks Generate.**
The owner asked, before testing, whether the app was actually fixed. Two of the three defects he
reported personally were NOT: the Inglewood revisits and the "drive to Erin" block. Fixed both.

**1. REVISIT GATE.** BD-125 built the revisit detector and refused it as a RANKING term (it moved the
defect the wrong way, 13/24 → 14/24). A GATE is a different category and had not been tried. 60 loops,
fresh-seed holdout, real `runPlanner` entry:

| | revisit ≥2 | worst | doubling | backroad | truncated | no-route |
|---|---|---|---|---|---|---|
| no gate | 41/60 | 19 | 38/60 | 30.8 % | 3 | 0 |
| **max=2 (adopted)** | **35/60** | **16** | **35/60** | **31.7 %** | 10 | 0 |
| max=3 | 38/60 | 16 | 35/60 | 31.8 % | 8 | 0 |

**Every user-visible axis improves** — 6 fewer routes that wander back to the same village, 3 fewer that
double back, and slightly MORE backroad. The cost is truncation 3 → 10/60, and the argument for
accepting it is that **the truncated routes are already IN the sample**: if truncation were degrading
quality, these aggregates would be worse, not better. Reversible with `REVISIT_REJECT=off`; `max=3`
is the gentler point on the curve if 10/60 truncated proves too many in use.

**2. "backroads drive to Erin" no longer demands a map pick.** The parser resolves Erin to real
coordinates and the SERVER routes it — `/plan` only overrides `constraints.destination` when the BODY
supplies one, so a brief-resolved destination stands. The CLIENT was blocking anyway, disabling Generate
and telling the user to go pick, on a map, the exact place the parser had already found. `useQuickFill`
now reports `hasDestination` (a resolved LatLng only — a bare string like "the countryside" still
prompts, because it cannot be routed), and `buildPlanRequest` stops blocking on it. 3 tests.
426 backend · 155 app · 24 shared tests green.

**BD-134 — audit-v16 (90 fresh runs, owner-commissioned after testing): the tails are tamed, the core
is unchanged, and the OWNER'S OWN AREA is the worst-served in the region. This entry is the case for
the architecture change, with the numbers that make it.**
Fresh seed (20260804) on the shipped config. Loops: main_majority ×57/60 · doubling 29/60 (worst
4 262 m — the 19 441 m era is gone) · wrong_length ×25 · revisits ≥2 27/59 (gate working; was 41+) ·
clean 2/60. Status split: 29 ok / 27 relaxed / 3 truncated — HALF of all loops now arrive through
relaxation, and wrong_length rose (9→25 across the audit series) as the gates I added pushed more
briefs into relaxed/fallback results. That is the measured COST of the R27/R28 gates, named rather than
hidden: fewer doublings and revisits, more duration drift.
THE CLUSTER FACT THAT DECIDES IT: drive-portion backroad by where you start —
**region towns 48 % · Brampton 30 % · Southfields 22 %.** The owner lives at the Southfields end. From
HIS door the "drive" portion of a loop is barely one-fifth backroad, because everything within reach of
a suburban origin is arterial and the planner must invent the whole trip from that door in 25 s.
MEANWHILE, SAME CORPUS, SAME ENGINE: **Discover 180/180 drives, 0 empty menus, 82 % backroad,
0 doubling, main-majority only 29/180.** The offline-generated, hard-rejected, commute-disclosed
architecture beats the live door-to-door planner on every axis the owner has ever complained about.
A→B: 20/20 routed, 33 % backroad, 4/20 doubling, unremarkable and stable.
This is the third full audit in the series (v13 → v15 → v16) and the road-class core has not moved
(34.5 → 34.5 → 33.8 % whole-route). Eleven levers are now measured across ranking, costing, gating and
seeding. The conclusion is in `docs/R28_plan.md` and it is architectural: the product's unit must
become THE DRIVE (Discover's unit), not the door-to-door blob. Proposed to the owner with this audit.

**BD-135 — ARCHITECTURE CHANGE APPROVED (owner, 2026-08-04): DRIVE-FIRST. The drive becomes the
product unit everywhere; the door-to-door blob stops being what Plan promises.**
CURRENT DECISION BEING REPLACED: Plan invents a door-to-door loop live from the origin in 25 s, judges
and displays the whole blob (Master Spec's loop planner as built through R28).
EVIDENCE IT IS INVALID: three full audits (v13/v15/v16) with the road-class core unmoved (~34 %
backroad, main-majority 57/60); eleven measured levers across ranking, costing, gating and seeding, none
moving it; drive-portion backroad from the owner's own area 22 % (Southfields) vs 48 % from rural towns
— the architecture punishes exactly the suburban origins real users start from; and the standing
counter-example on the SAME corpus: Discover's offline-generated, hard-rejected, commute-disclosed
drives measure 82 % backroad, 0/180 doubling, 0 empty menus (BD-134).
REPLACEMENT: Plan = constrained Discover. (1) The requested duration means THE DRIVE — connectors are
sized, shown and judged separately ("getting there 12 · the drive 88 · home 14"). (2) Drive material
comes from the measured index (r31: 1 544 cores, 1 114 ribbons) + live fill where the index is thin.
(3) RIBBONS are the preferred shape — different-way-home by construction, no lollipop stem. (4) The
judge changes with the architecture: duration tier on the drive leg; the full trip still passes the
doubling/revisit gates (ribbons pass them naturally — that is the point). (5) Fail-open: no reachable
core → today's planner, disclosed. (6) Flag `DRIVE_FIRST`, default OFF, byte-identical, adopt-or-refuse
on pre-registered bars through the real `runPlanner` entry.
PRE-REGISTERED BARS for the adopt A/B (60-loop fresh-seed audit): drive-portion backroad mean **≥55 %**
(from 40.1) · wrong_length **≤12/60** (from 25) · doubling **≤15/60** (from 29) · no-route and
truncation not up · A→B and Discover untouched (their hashes/outputs unchanged).
ALTERNATIVES CONSIDERED: keep tuning (rejected — eleven refusals say the residue is structural); hybrid
second mode (rejected by owner — the broken mode would remain the default). SCOPE: backend planner path
+ app framing/wording; AI re-scoping rides along (BD-134 write-up §3). Deferred features stay deferred.

**BD-136 — R29-2 first A/B was VACUOUS, not refused: single ribbons cannot fill an ask. The missing
piece is CHAINING, and the machinery for it already exists.**
DRIVE_FIRST=on measured byte-equivalent to baseline (drive backroad 40.1→39.6 %, all other axes flat).
Diagnosis before verdict: the r31 index's 1 114 ribbons average **9 minutes** (max 52), because
BD-129/130 correctly lowered the ribbon road-length gate to 3-4 km to fix supply. `pickDriveFirst`
requires the DRIVE to fit the ask (|dur−ask|/ask ≤ 0.35) — for a 60-min ask only 16/1 114 qualify, for
90 min **zero**. So the path seeded nothing and fell through to legacy on ~every brief: the mechanism
was never tested. This is NOT BD-130 again (those seeds assembled and lost); these never entered.
FIX (R29-1b): **chain 3-6 short ribbons into one drive that fills the ask** — the product's own "out
via X, along Y, home via Z". The R18-3 chain machinery (buildSpanPool / chainMatrixLocations /
buildChainCandidates, one travel-matrix budget) already strings spans by entry/exit; ribbons ARE spans
with pre-measured quality. Feed ribbons as the span pool, budget by the ask, keep the drive-leg judge
from R29-1. The BD-135 bars stand unchanged; re-run the same A/B when chaining is in.

**BD-137 — R29 UNIT A SHIPPED: Discover v2 — the drive + getting there + getting home, measured PASS
on all five pre-registered bars (8/8 origins, from 0/8 at the start of the unit).**
The owner's first ask, verbatim: "the discover thing to work properly where it shows proper drives and
shows from the original location how to get there and how to get back all included in the drive."
FOUND: the v2 backend was fully built and dark (discoverCores with live connectors, per-leg times,
commute-share drop, different-way-home retry; the /discover v:2 switch; the full zod contract; the app
data layer including the exact card label). THREE REAL DEFECTS stood between it and working:
1. **Stale index version default** — `DRIVE_CORES_VERSION ?? 'r25-dev'` vs the loaded 'r31-rib', while
   drive_first.ts read the same env var with a different default. Every v2 browse returned empty. ONE
   constant now, in discover_cores.
2. **Ribbon swamp** — the 0016 definer returns top-N by backroad×curviness with a hard 50-row cap;
   1,114 max-quality 9-minute ribbons filled every browse, then ALL failed the connector-share drop
   ("a 9-minute drive is never worth a 15-minute trip"), so menus were empty at 8/8 sample origins
   while 430 card-worthy loop cores (avg 63 min) never left the database. **Migration 0019** adds a
   kind filter to the definer; menus read kind='loop', the live planner's chaining reads kind='ribbon'
   — the two consumers finally ask for the material they need.
3. **One-sided home retry** — the single perpendicular offset left Belfountain's menu 5/6 sameWayHome
   (a valley origin funnels every road into one approach). Now a BOUNDED ladder (±4 km, ±7 km, max 4
   deterministic attempts, never a search loop): worst menu is 1 sameWayHome, disclosed on the card.
   The "exactly once" pinning test was updated to pin the BOUND with the measurement in its comment.
APP: DiscoverHome v2 branch (three-part label "the drive 42 min · getting there 18 · home 21", honesty
sub-line, per-leg map colours core=amber/connectors=grey behind a prop, empty-v2→v1 fallback so no
origin loses a menu) and `coreDriveToRoute` — a tap concatenates the three legs into ONE Route whose
R28 `legs` field carries the measured split, so RouteDetail renders the three-leg bar with zero screen
surgery. A null-vs-undefined bug in the fetch default was caught by the existing v1 tests going red
(`fetchCores={null}` must DISABLE v2, `??` would have sent test renders to the network).
GATE (eval/discover_v2_quality.ts, real discoverCores path): menus ≥5 at 8/8 origins · connector share
≤0.6 every card · sameWayHome ≤2/menu (worst 1) · per-leg times present · same-session determinism —
**PASS**. Suites: backend 426 · app 163 · shared 24, whole-repo tsc clean.
CARRIED [HUMAN]: migration 0019 joins 0010-0018 for the hosted deploy.

**BD-138 — R29 Unit B, three probe iterations: every chain variant REJECTED at assembly, and all three
failure mechanisms are now MEASURED. Recording them before the fourth design so it is derived, not
guessed.**
Probe = real `assembleLoop` from 4 origins, 90-min ask, r31 ribbons (40 read/origin, pool 24).
1. **Frozen entry→exit orientation** (honesty-motivated): a ribbon whose exit points away from the next
   entry forces a backtrack past itself — Southfields chain: **34 revisits, 6.7 km doubling**. Fixed by
   choosing orientation per insertion from the matrix (both endpoints are matrix locations; rural
   duration ~symmetric).
2. **Bearing-sweep ordering** (inherited from the corpus chainer): bearing ignores RADIUS, so same-bearing
   ribbons at different distances petal through the origin funnel — **self_overlap 0.69-0.84**.
   Replaced with nearest-neighbour by matrix link cost…
3. **…which collapses onto COLLINEAR ribbons.** The r31 supply is largely adjacent segments of the same
   few long roads per cell (the sweep keeps a cell's top merged roads), so cheapest-next-link chains
   them into a LINE — and a line from a fixed origin is an out-and-back by construction:
   **self_overlap 0.63-0.83, the exact defect class the gates exist to kill.** NN and bearing-sweep fail
   in OPPOSITE directions: one maximises spread and petals, the other minimises links and collapses.
4. **Valhalla 499 "leg_shape_index not set for intermediate location"** killed every Southfields/
   Belfountain chain even with mid-vias removed: adjacent ribbons MEET at junctions, so ribbon k's exit
   and ribbon k+1's entry snap to the SAME network point → zero-length `through` leg → 499. Needs a
   junction-merge (skip a chain link's entry waypoint when within ~50 m of the previous waypoint).
**THE DERIVED FOURTH DESIGN** (next window, `ribbon_chain.ts` inner loop only — module, tests, run.ts
integration, judge extension all stand):
· SELECT for enclosure: one ribbon per bearing SECTOR (3-5 sectors) within a radius band around the
  median centroid radius — spread without petals;
· ORDER by bearing around the compass; ORIENT each by matrix cost (keep #1's fix);
· MERGE junction-adjacent waypoints (<50 m) to kill the 499;
· keep the measured-duration predictor, fill targets, floor, pinned spans, fail-open.
ALSO MEASURED: 4 seeds currently produce identical chains (seed diversity is illusory once NN converges)
— sector selection replaces seeding outright.
Suites stay green (434 backend; ribbon_chain tests updated to the 2-point v1 contract with the 499
reason in comments). `RIBBON_CHAINS` stays OFF; the BD-135 A/B remains VACUOUS-pending, not refused —
chains must first ASSEMBLE.

**BD-139 — R29 Units B+C: both ribbon integrations MEASURED and both blocked on the same thing —
DISTINCT-ribbon supply — which Unit E's sweep (running) exists to fix.**
UNIT B (loops): design #4 (sector-spread in a radius band + bearing order + cost orientation +
junction merge) built and 8-test green after three measured failures (BD-138). The decisive probe
diagnostic: **the r31 pool is ~6× duplicates** — overlapping sweep cells store the SAME physical road
as a ribbon in up to 6 cells, so Guelph's "24-ribbon pool" is **4 distinct roads at 12-29 km in
different directions**, and a spread tour over that is 150+ km of links. No algorithm chains that into
90 minutes; the supply is too sparse. Pool now DEDUPES by physical road id (the way-id suffix), and
`RIBBON_CHAINS` stays OFF pending r32.
UNIT C (A→B): `ribbonsAsSegments` feeds deduped ribbons into `buildCorridorChains` behind
`RIBBON_ATOB` (unique names — mergeRoadPieces fuses same-named segments within 150 m; `distance_m →
lengthM` keeps the corridor predictor honest; corridor may reverse a ribbon — accepted, road class is
direction-agnostic). **A/B on the real entry (20 pairs, seed 20260804): backroad 33.2 → 35.4 %
(+2.2 pp) vs a ≥41 % bar; routed 20/20, doubling 4/20, curviness 1.08 — all held. REFUSED at the bar
on r31 supply.** The corpus corridor pool already contains most of what r31's thin ribbons add.
BOTH A/Bs re-run when the r32 index loads (CORE_RIBBON_MIN_M 2500, CELL_RIBBON_RESERVED 8,
CELL_KEEP_MAX 10 — denser DISTINCT coverage incl. Collingwood/Cobourg). That is the pre-planned supply
fix from the R29 plan, not a new lever. 434 tests green; flags off; byte-identical.

**BD-140 — R29 Unit D complete (within honest scope), and the r32 sweep was MY CONFIG ERROR, relaunched
as r33.**
UNIT D SHIPPED: (1) wording — the road-character chip is **"Backroads"** (named for its mechanism), the
"No preference" third chip is REMOVED (its `null` value doubled as quick-fill's "text decides" marker —
the mechanism behind the twisty-un-fills-the-chip bug), duration is **"Drive time"**, helper text tells
the user places typed in the text box are driven through. (2) **The explain prompt finally receives the
ask** (facts gain `asked: {character, driveTimeMin, avoids, places}`, prompt v2 instructs justification
against it and plain statement of relaxations) — it had instructed "explain how it fits what was asked"
since v1 while never being given the ask. Gate: the grounding validator + 77 ai/route unit tests (no
separate explain eval exists; BD-28's re-run obligation was the PARSE gate). Two backticks inside the
template literal cost two compile rounds — noted for the next prompt edit.
SCOPE CALL, stated not silent: `titleSummaryTags` stays UNWIRED because **no save surface exists** — no
persistence endpoint, no Save button. Wiring it means building route-saving, a feature, not a Unit D
line item. The function remains ready.
UNIT E CORRECTION: the r32 sweep produced **24 ribbons — worse than r31** — because I passed
`CORE_RIBBON_MIN_M=2500` but not `CORE_RIBBON_ENDPOINT_MIN_M`, so the endpoint-separation bar sat at
its 8 km default and rejected 5 841 ribbons. The BD-131 constant split exists because these are two
different properties; I set one. Relaunched as **r33** with both (2 500 m road / 2 000 m separation):
at 44 cells it holds **169 ribbons ≈ 4× r31's rate**. A/Bs for Units B and C re-run when it loads.

**BD-141 — THE BREAKTHROUGH THAT HELD: the DRIVE-FIRST TRIP. Plan = constrained Discover, built as
BD-135 actually specified, and the drive-quality bar is SMASHED for the first time in the program.**
THE PATTERN NAMED FIRST: BD-130 (core seeds), BD-136 (single ribbons), BD-139 (chains, both variants)
all piped measured cores INTO THE BLOB-ASSEMBLY GATES — judged by rules that police invented blobs.
Discover v2 passes every bar precisely because it does NOT assemble: core + two disclosed connectors.
`drive_first_trip.ts` finally does the same for Plan: when a measured core FITS the ask (drive ruler,
fit ≤0.25), the planner returns core + connectors + `legs` + disclosures directly, bypassing
`assembleLoop`. Fail-open to legacy with a disclosure. Three probe-measured construction fixes on the
way: kind='loop' reads (kind=null re-created the ribbon swamp BD-137 fixed — 6/60 served became 52/60),
a core-mid waypoint (entry≈exit collapsed the leg split — drivePct null), prefer-successful-retry +
near-preference in fit bands + reach 0.3 (commute shrink).
**MEASURED (60 loops, real runPlanner, seed 20260804, r33 index of 1,922 cores/1,652 ribbons):**

| | baseline v16 | drive-first trips |
|---|---|---|
| DRIVE backroad | 40.1 % | **71.5 %** (served subset 79.6 % in v3) |
| doubling ON THE DRIVE (≥250 m) | — (blob only) | **8/57** |
| wrong-length (drive ruler) | 46/56 | **20/57** |
| truncated | 3 | 2 |
| no-route | 1 | 1 |
| served from the index | 0 | 40/60 |

BD-135 bars: drive backroad ≥55 % **PASS (+16.5 over the bar)** · doubling ≤15/60 **PASS on the drive
span (8/57)** but **FAIL on the blob (48/60)** — the blob figure is commute legs sharing the approach
road, disclosed as sameWayHome per Discover's own contract · wrong-length ≤12/60 **FAIL at 20/57**
(residual: briefs where no fitting core exists fall back to legacy, which misses as before) ·
no-route/trunc not up **PASS**.
**NOT SELF-ADOPTED.** Two bars miss AS REGISTERED, and the doubling miss is a RULER question the
architecture itself created: the owner's stated rule is "same roads twice unless absolutely NECESSARY"
— a disclosed commute to reach a measured-clean loop is the necessary case, or it is not, and that is
his call, not mine. Flag stays default-off; the numbers, both rulers, go to the owner.
Also recorded: r33 supply sweep (1,652 ribbons, 4× r31's rate) after the r32 config error (BD-140);
chains remain refused (BD-139) — the trip approach supersedes them.

**BD-142 — OWNER ADOPTED the drive-first trip (2026-08-07): "disclosed commute is fine."** The ruler
question resolved by the owner himself: a same-road commute to reach a measured-clean drive is the
"absolutely necessary" case his own rule carves out, PROVIDED it is disclosed — which the card does
("same way home — there isn't a good second road from here"). `DRIVE_FIRST` defaults ON. The drive is
judged on the drive; the commute is honest overhead shown separately. Unit F (audit v17 + freeze) runs
on this config.

**BD-143 — R29 CLOSED: audit v17 (fresh seed 20260807, adopted config) CONFIRMS the architecture
generalizes.** Loops: **served 40/60 from the measured index · DRIVE backroad 68.1 % · drive-span
doubling 7/59 · truncation 0 · no-route 0.** Discover: 180/180 drives, 0 empty menus, 83 % backroad,
0 doubling. A→B: 20/20 routed, 33 % backroad, 4/20 doubling (unchanged — its ribbon lever stays
refused). Artifact published; `frozen-r29-v1` cut with the full flag rationale. The residual work is
known and honest: 20/60 briefs still fall back to the legacy blob (index coverage), A→B never got its
win, and the app should now RENDER the served trip's three legs from `result.legs` prominently.

**BD-144 — A shipped defect the lint gate exposed on the way to the commit: the v2 map ignored its own
`perLeg` prop.** `DiscoverHome` computes and passes `perLeg={coreDrives.length > 0}`, the data layer tags
every feature `leg: 'core' | 'out' | 'home'`, and `DriveLinesMap` declared, documented and defaulted the
prop — then drew `lineColor: AMBER` unconditionally. So on every v2 Discover menu the card told the truth
("the drive 42 min · getting there 18 · home 21") while the map drew all three legs identically: the
driver could not see where the drive began. ESLint caught it only as `'perLeg' is assigned a value but
never used` — the type system cannot see an unused prop, and **no test asserted the layer's style**, which
is exactly why it shipped. Fixed with the intended `['match', ['get','leg'], 'core', AMBER, '#8a93a6']`
expression, and pinned by two tests (v2 → match expression with a non-amber connector colour; v1 → plain
amber, since v1 features carry no `leg`). Same pass: removed the dead `midVertex` + `MID_VIA_MIN_M` from
`ribbon_chain.ts` (mid vias were disabled after the Valhalla 499s — keeping an exported knob that nothing
reads is a lie about what the module does) and a dead `assembleLoop` import in the rq28 probe. Suites
after: **backend 439 · app 161 · shared 24**, tsc clean, `npx eslint` clean outside gitignored
`scratchpad/`. Lesson recorded: a rendering prop needs an assertion on the rendered style, not just a
smoke test that the screen mounts.

**BD-145 — THE OWNER IS RIGHT AND MY INSTRUMENT WAS THE REASON I COULDN'T SEE IT (2026-08-08).**
Owner, from the device on the adopted R29 config: "The drives dont look like loops... it goes into a
random street or random neighbourhood for no reason makes us do a u turn or go around a crescent, then
continue on the same road... I have no clue how you arent finding this out yourself through the audits."
New probe `eval/experiments/rq30_as_driven.ts` measures the trip **as driven** — every leg, every
detector, floors dropped (`OAB_MIN_RUN_M=60`), grace radius 0 — on 36 real `runPlanner` routes from his
own two areas (Southfields ×6, Brampton ×6 origins; 3 briefs each; 36/36 served by the index).

**Measured, all confirming him:**
· **Ask vs delivered: 36/36 trips exceed the ask by more than the audit's own 25 % tolerance.** "1 hour
  backroads loop" → **106 min mean** (1.77×); 90 min → 131 (1.45×); 2 h → 178 (1.48×). Worst 1.97×.
· **Commute is 44 % of trip distance (worst 56 %)** — mean 44.8 km of commute wrapped around the drive.
· **Doubling: mean longest run 7.3 km, worst 20.7 km; 33/36 trips double >2 km** — the out and home
  connectors substantially retrace each other.
· **Whole-trip loopiness mean 0.14 (worst 0.07); 36/36 BELOW the 0.25 bar every CORE must clear.**
  Literally, numerically, "the drives don't look like loops": core + two long sticks is a lollipop.
· **Spurs: mean 3.0 per trip (max 7), 36/36 routes** — and 0 within any leg measured alone, so they sit
  at the LEG JOINS: arrive at the core on a road, leave on the same road. His "u-turn, then continue on
  the same road."
· Connector detour factor ~1.8× (22 km driven to reach a core 12.7 km away) with hood share up to
  16.8 % on home legs — `LINK_COSTING = {...BACKROADS.options, exclude_highways: true}` deliberately
  routes the COMMUTE onto small roads. That is the "random street / random neighbourhood."
· The DRIVE leg itself is genuinely good: 74.5 % backroad, **0 spurs, 0 microloops**, longest doubling
  426 m. The measured-core index is not the problem; everything wrapped around it is.

**WHY THE AUDITS SAID PASS — five instrument failures, all mine:**
 1. **I changed the ruler.** `run.ts:1364-1370` judges `judgedDurationS = duration × drivePct/100` for
    drive-first candidates, and the audit's `wrong_length` compares that to the ask (BD-135, "the ask
    means THE DRIVE"). A 106-minute answer to "1 hour" therefore scores CORRECT.
 2. **`defectsOf` (audit v13/v16/v17) has no spur, microloop or u-turn row at all** — the three
    detectors that model his exact complaint were never run on a served trip.
 3. **`OAB_MIN_RUN_M = 250`** — a crescent or street stub is 80-250 m, invisible by construction. I
    documented this in the R28 rq28 probe and never fixed it.
 4. **`loopiness` is only ever applied to the CORE** (`CORE_LOOPINESS_MIN = 0.25`), never to the trip
    the driver sees.
 5. **The connectors are judged by NOTHING.** `judgeCore` hard-rejects cores on u-turns/spurs/
    microloops, but connectors are raw `routeThrough` output and are ~half the driven minutes.
**BD-142 was answered on a question I framed too narrowly:** I asked whether a disclosed same-way
commute was acceptable, not whether a 60-minute ask should produce a 106-minute lollipop with 44 %
commute. He could not have priced what he was approving; I could have measured it and did not.

**Recommendation (NOT restarting the planner): the index is the asset and it is clean.** Re-point the
trip assembly at the right target — (a) the ask means the TRIP; (b) connectors route like a person
drives, not on backroads costing; (c) whole-trip gates on loopiness/doubling/spurs/commute-share that
REJECT a candidate rather than disclose it; (d) fix the audit to judge what he drives; (e) dedup +
targeted coverage near him (13 rows within 15 km of Southfields are ~5 distinct drives from one entry
point). Ruler reversal (a) contradicts BD-135/142, which were his calls — his to re-decide, with these
numbers in hand.

**BD-146 — OWNER OVERRIDE (2026-08-08, plain words, supersedes BD-135/BD-142): THE TRIP AS DRIVEN IS
THE PRODUCT.** "This app is genuinely unusable... The drives dont look like loops... random street or
random neighbourhood for no reason makes us do a u turn or go around a crescent, then continue on the
same road... why couldnt you use that [my own BD-145 numbers] to understand that this is not what i
want." The ask means the WHOLE TRIP; the drive-only ruler is dead. His words, converted to hard REJECT
gates on every served trip (not disclosures): trip duration within tolerance of the ask · trip
loopiness ≥ the same 0.25 bar cores must pass · whole-trip doubling ≤ the same 1200 m bar legacy loops
are rejected at · zero spurs/microloops (small origin grace) · commute ≤ half the trip · connectors
routed like a person drives (direct costing — BACKROADS commute costing was the "random neighbourhood")
· connector-vs-core and out-vs-home overlap capped. Standing instruction recorded with it: when my own
measurements contradict the owner's known desiderata, ACT on them — do not wait for him to drive the
defect and report it.

**BD-147 — THE REBUILD ON THE OWNER'S RULER (2026-08-08): from 0/36 honest to 22/36 honest on his two
hardest areas, with every served trip passing every gate derived from his words.** Applying BD-146's
gates to the R29 builder served 0/36 — the gates were right and the CONSTRUCTION was wrong, five
mechanisms deep. Each found by measurement (rq30b gate histogram; rq30c single-trip anatomy), each
fixed structurally, none by loosening a bar:
 1. **Single-junction lollipop** (spurs 153/156, not_a_loop 151/156): a loop core's entry ≈ exit forced
    out+home through ONE junction. Fix: **ring-arc joins** — enter the ring at the origin-nearest
    vertex J1, drive the LONG way round to a separated J2 (≥1.5 km apart), come home from J2. The
    skipped short arc makes the drive a DIAL: J2 placement targets (ask − commutes), floor 0.6×ring,
    with a full-ring retry when the partial arc fails loop-shape.
 2. **'break' retry vias** — the offset via full-stopped on whatever street it snapped to (u-turn
    allowed, any road class): literally the owner's "into a random street, u-turn, back out", planted
    by MY OWN ladder. All ladder vias now 'through' (no stop, no u-turn, ≥unclassified snap). The same
    defect existed in Discover's home-retry since Unit A — fixed there too.
 3. **Routed-vs-simplified seams** (rq30c: a "spur" + 310 m double sat EXACTLY at the connector→arc
    glue point): fake defects manufactured by concatenating Valhalla geometry with simplified ring
    geometry. Fix: **the whole trip is ONE /route call** — origin → ≤15 'through' samples along the arc
    → origin. No seams; real maneuvers end-to-end; engine-priced duration; real has_highway; plus an
    ARC_FIDELITY_MIN=0.6 gate (reject 'arc_deviation') so a shortcut can't silently replace the ring.
 4. **Isoperimetric spoke penalty** (not_a_loop 167/167 at one point): whole-trip loopiness punishes
    DISTANCE-TO-SUPPLY quadratically — a perfect ring with two clean 11 km spokes scores 0.21. The
    owner asked for get-there/get-home spokes explicitly; "loops should look like loops" is about the
    DRIVE. Gate moved to **drive-closed loopiness** (routed arc + its chord) at the same 0.25 core bar;
    the spokes keep their own gates (different roads ≤0.2 overlap, doubling, stubs, commute ≤50 %).
 5. **Distance-scaled leg times** overpriced commutes ~30 % (arterial spokes vs twisty ring) → false
    commute_majority. Leg times now use the core's own measured pace for the drive; spokes split the
    engine remainder. And **origin-entrance doubling ≤1 km is exempt** (TRIP_OAB_ORIGIN_GRACE_M): one
    road into a subdivision is the owner's own "unless absolutely necessary" (measured 863 m at
    Southfields); doubling beyond it still rejects.
**Result (rq30b, Southfields ×6 + Brampton ×6 origins × 3 briefs):** served **22/36** (was 0 under
honest gates; R29's "36/36" was the broken ruler). Sample served trips: "Fallbrook Trail all-in 118 min
for a 120 ask, drive-loopiness 0.40, commute 32 %". The 14 unserved fall back to legacy WITH the gate
rejections in the trace — a supply/coverage gap, not a lie. **Discover v2**: commute costing direct +
built-share card gate (a 60 % Hamilton card slipped the matrix prefilter) → gate PASS (7/8 menus ≥5,
all cards ≤0.6 share, determinism held). **Audit v18 taxonomy** (uturn/street_stub/crescent/
commute_majority rows; not_a_loop at 0.25 on the as-driven shape) so v13–v17's blindness cannot recur.
Suites: backend 448 (was 439; +9 gate tests) · shared 24 · SSE step enum gained 'drive_first_trip'.

**BD-148 — R30 CLOSED REGION-WIDE (2026-08-08 evening): audit v18 (fresh seed 20260808, 90 runs, the
new taxonomy) + the last mile of honesty fixes.** Region-wide loops: **served 33/60 from the measured
index · served duration 1.07× mean, worst 1.22×, wrong_length 0/33 · DRIVE backroad 78 % · street
stubs 0 · crescents 0 · u-turns 1**. Under audit rulers STRICTER than the gates (250 m doubling
visibility vs the 1 200 m gate; distance-based commute check vs the time-based gate), 19/33 served
trips carry zero flags of any kind; the commonest residual flag is whole-trip main_majority — the
arterial COMMUTE diluting the whole-route class mix, which is the design (the DRIVE is 78 % backroad).
Legacy fallback (27/60) remains what it always was — 30 % backroad, duration worst 2.43×, 1/27
defect-free — and is now VISIBLE in every audit row rather than averaged away. Also this pass:
· **Audit rulers aligned with the gates** (drive-closed loopiness for split trips; origin-graced
  doubling) — the audit had kept judging whole-trip loopiness, mis-flagging 20/33 served trips;
  re-scored v18 confirms 4/33 → 19/33 defect-free under aligned rulers (rescore_v18.ts).
· **ResultScreen map now shows the split** (out/core/home features; amber drive, grey commutes) with
  2 layer-style tests — the BD-144 lesson applied to the second map surface; `drive_first_trip` step
  label added ("Trying measured drives near you").
· **Wall handoff**: the trip attempt gets ≤40 % of WALL_CLOCK_BUDGET_MS, the legacy planner keeps the
  rest ('time_budget' in the trace when it binds). Measured live: served plans ~8 s; the 25–27 s at a
  fallback-heavy origin is the legacy search under its own budget (pre-existing), not trip stacking.
· `frozen-r30-v1` cut. e2e canonical-brief failure during the audit was Valhalla CONTENTION (passes
  clean immediately after) — noted so nobody chases it.
**Left for R31, in value order:** (1) coverage sweep for the 27 legacy-fallback areas (queued — not
run tonight so the owner's device pass isn't degraded by Valhalla contention); (2) A→B drive-first via
measured ribbons through the one-shot builder; (3) the legacy fallback's own duration tail; (4) Save
surface + titleSummaryTags.

**BD-149 — OWNER DECISIONS FROM THE DEVICE (2026-08-09): commutes are DUMB-FAST; the Plan loop is ONE
DRIVE.** His words: Discover drives "a lot better, but the getting there and getting back is absolutely
terrible... it should genuinely just take the easiest and fastest way"; and "For the planner loop there
shouldnt be any getting there or going home. That loop should be the full drive as the loop itself."
Implemented, both surfaces, same session:
· **Discover connectors: zero engineering.** The R30 offset-via retry ladder (±4/7 km) — MY
  anti-same-way machinery — WAS his "absolutely terrible": deleted. Connector costing is now engine-
  default fastest ({} — even LEGACY's use_highways 0.2 softener removed). sameWayHome remains as an
  honest LABEL, never a retry. The built-share card gate stays (menu quality, not connector
  engineering). Gate re-run: **PASS, and BETTER — 8/8 menus ≥5 drives (was 7/8), worst connector share
  54 % (was 60 %)** — fastest commutes are shorter, so more drives clear the bar. The eval bar
  "sameWayHome ≤2/menu" retired (it now REPORTS, owner decision). Test rewritten: exactly 2 route
  calls per card, 0 vias, ever.
· **Plan loops: no legs, no commute framing.** result.legs = null; disclosure is now "Built a
  90-minute loop around most of Fallbrook Trail — measured roads, honest time"; the three-leg bar and
  grey map legs simply don't render for Plan loops (they keyed off result.legs); waypoints [J1, mid,
  J2] stay for the AUDIT's geometric split only. The vacuous R29 single-ribbon prepend (BD-136) and
  its duplicate "planned live" disclosure removed from the fallback pipeline.
· **One measured refinement during implementation:** gating the whole shape's isoperimetric loopiness
  (first reading of "the loop is the full drive") HALVED serving (22→11/36) by rejecting ELONGATION —
  a perfect ring stretched 8:1 by distance-to-supply fails 0.25 — while lollipops are ALREADY
  structurally impossible (out≠home ≤0.2 overlap + doubling + stub gates forbid the stem). Kept:
  drive-closed ring bar + stem-free whole shape; elongation is where you live, not a defect. Serving
  back at 22/36 (his areas); live smoke: 90-min ask → 90-min loop, legs null, Discover 6 drives with
  symmetric fastest commutes (28/28, 23/23, 20/20 min), sameWay labeled true.
Suites: backend 448 · app 163 · shared 24; tsc + eslint clean; backend restarted on this code.

**BD-150 — THE CRITICAL AUDIT THE OWNER ORDERED (2026-08-09, "be extremely critical of any flaws at
all"): audit v19 (fresh seed, 90 runs) + the flaws it and the live smokes named, fixed same-day.**
SERVED loops are clean by every as-driven measure (32/60 served; wrong_length 0, not_a_loop 0, stubs 0,
crescents 0, uturns 0; duration 1.06×, worst 1.24×; DRIVE backroad 76 %; 20/32 zero-flag). The CRITICAL
findings were one level deeper:
 1. **Monotony — 13 of 32 served loops are the SAME RING (Fallbrook Trail; 8th Line ×5).** The planner
    is honest but reality's menu is thin: 270 stored loop cores are only 82 distinct names, and r33
    generated every loop at ONE size (LOOP_CORE_DURATION_S=5400), so 60-min and 2-h asks were served by
    assembly's accidental over/undershoots. FIXES: (a) geometric dedup (overlap >0.5) in Plan candidate
    selection and Discover menus, so build attempts and card slots are never spent on copies (a live
    menu read "8th Line, 8th Line, Fallbrook, Fallbrook, King-Vaughan, Fallbrook"); (b) menus
    additionally never repeat a headline NAME (distinct geometry is not distinct enough for a menu) —
    live after: 5 cards, 5 names; (c) the **r34 sweep now generating at THREE sizes (60/90/140-min
    targets) × 3 origins/cell** — the supply fix; loads tonight, then re-audit.
 2. The audit itself confirmed legacy fallback (28/60) unchanged-and-bad: not_a_loop 20, wrong_len 9,
    main_majority 22, 30 % backroad — serve-rate (supply) remains the lever, not legacy surgery.

**BD-151 — A→B DRIVE-FIRST: BUILT, DEBUGGED, MEASURED, REFUSED (2026-08-09).** The loop architecture
(one-shot through-routing over measured material) was extended to A→B: best corridor ribbon, oriented,
detour-capped, gates + fidelity. A clock bug (performance.now t0 vs Date.now deadline) silently
rejected everything as time_budget — found via a standalone-vs-pipeline discrepancy, fixed, and only
then judged. Measured on 10 audit corridors through the REAL runPlanner: vanilla fill 27.4 % backroad,
profile fill 30.0 %, vs **legacy corridor 43.1 %** (registered bar +8 pp → measured −13). The corridor
planner's CHAINED spans beat any single-ribbon serve — its pool already holds the ribbon material,
exactly as BD-139 recorded. `ATOB_DRIVE_FIRST` defaults OFF; code + probe kept as the record. A→B
stays on the legacy corridor planner (routed 10/10, detour ≤1.92×) — not transformed, and not lied
about. Suites at close: backend 449 · app 163 · shared 24.

**BD-153 — A→B MULTI-RIBBON CHAIN: BUILT, MEASURED, REFUSED — AND THE VERDICT IS NOW SOLID
(2026-08-09).** U2 of the approved R31 plan: axis-projected corridor ordering, greedy per-ribbon
orientation, 1–3-ribbon combos under the standing 1.8× detour cap, one-shot through-routing, per-member
fidelity gates. Served 10/10 with 0 doubling and detours ≤1.76×. **Backroad mean 41.0 % vs legacy
43.1 % (registered bar ≥51 %) → REFUSED.** Per-corridor: chains win where legacy is weak
(Cobourg→Uxbridge 29→71 %, Hamilton→Guelph 48→52 %) and lose where it is strong (Southfields→Hockley
68→53 %, Stratford 39→27 %) — and there is no live per-corridor signal (no trace under the 25 s wall)
to serve selectively. Two architectures, four arms, one conclusion: **the legacy corridor planner is
genuinely competitive at A→B** — today it measures 43 % backroad, 10/10 routed, 0 doubling >1.2 km,
detours bounded. The v13-era "33 %" grievance predates the current profile config. A→B keeps the
legacy planner; `ATOB_DRIVE_FIRST` stays default-off with the chain as its best-known challenger,
recorded in the module header. This closes the owner's ask #2 honestly: A→B *works properly* by every
measured bar except a backroad ceiling that two serious architectures failed to raise.

**BD-152 — R31 U1 LANDED: r34 MULTI-SIZE SUPPLY (2026-08-10).** The sweep generated loop cores at
THREE size targets (60/90/140 min; r33 generated only 90) with per-cell dedup unchanged: **403 loops /
91 distinct rings** (r33: 270/82), r33's measured ribbons carried forward untouched. Per-area within
25 km: Southfields 23→30, Collingwood 6→14, Hamilton 3→11, Barrie 21→32; all three size bands
populated everywhere but Cobourg (2 cores under BOTH configs — a genuine geography desert, served by
the designed v1 Discover fallback; a heavier local re-sweep is NOT expected to help and was skipped
honestly; the loader is delete-per-version so top-ups need a merge path first). Version flipped after
verification; backend restarted. **Measured on r34:** his-areas serve 22→26/36 (bar ≥30 MISSED —
honest; binding gate is now doubling at funnel origins, i.e. geography); live smoke: "1 hour" → 63-min
loop; Southfields menu = 6 cards / 6 distinct rings incl. brand-new r34 material (Twiss Road, Duffy's
Lane, Hockley Road). **Audit v20** (fresh seed): served 33/60 with ZERO served defects again
(wrong_length/not_a_loop/stubs/crescents/uturns all 0; 1.08×/1.23×; DRIVE 75 %), monotony top-ring
41 %→33 % (Duffy's Lane, new in r34, already serves 5), **Discover 0 empty menus at 30 origins**,
Discover gate PASS. Artifact: audit-v20 (claude.ai/code/artifact/831ec2de). `frozen-r31-v1` cut.
The R31 "fix everything" plan is complete: U1 landed, U2 refused with receipts (BD-153), U3 verified
already-correct, U4 this record. Remaining honest gaps are geography (Cobourg, funnel-origin doubling)
and the legacy fallback's known quality — both visible in every audit row, neither lied about.

**BD-154 — R32-U4: THE HARD-EXCLUSION "NO-OP" WAS A FALSE MEASURED FACT; THE ENGINE TALKS AND WE NOW
LISTEN (2026-08-09).** The Recovery plan's top P0 (verify hard exclusions) paid out immediately, in an
unexpected direction. Facts: `allow_hard_exclusions: true` was ALREADY set in both Valhalla configs;
rq32 probed the RUNNING 3.7.0 with proper control pairs — highway-optional Mississauga→Brampton and a
410-corridor pair — and `exclude_highways: true` **rerouted both highway-free** (20.2 km/hwy=true →
15.6 km/hwy=false; 18.8→19.7 km). R25-U2's "verified byte-identical no-op" was an artifact of an
inconclusive probe pair (my rural control reproduces the failure mode exactly: identical routes
because the baseline had no highway to remove). Doubly instructive: the wire has carried the hard key
ALL ALONG (the options spread never deleted it) — production avoid-highways requests were already
protected by a lever we documented as inert. Changes: (1) `RouteThroughOutput.warnings` — Valhalla's
warnings array is now parsed and carried instead of silently discarded (it was discarded for the
project's entire life; an ignored hard exclusion would have told us here); (2) `HARD_EXCLUSIONS` flag
(default on = today's wire bytes, now understood; off = soft-only diagnostic arm); (3) all stale
"verified no-op" comments corrected. Zero behavior change; two false beliefs removed. Suites 449 green.
The rq32 probe file stays as the reusable exclusion-verification battery (tolls/ferries pairs can be
added when relevant).

**BD-155 — R32 "TRUTH FIRST" COMPLETE (2026-08-09): the measurement system is now hard to fool, and
its first day of existence overturned one "fact" and caught one latent bug.** Units, all landed, zero
planner-behavior change:
· **U0 manifest** — every audit/sweep artifact now embeds git describe, Valhalla version + tileset id
  + config hash, cores version, wall budget, tracked env overrides (eval/manifest.ts; sweep writes a
  sidecar). The BD-119 class of contaminated comparison is structurally closed.
· **U1 frozen suites** — eval/suites/: gold loop suite (16 origins across 15 network-structure
  classes × 45/60/90/120 ladder, incl. every historical complaint site), A→B gold (25 corridors,
  8 classes), and the NEVER-TUNE holdout (10 origins + 5 corridors, acceptance-only, loud contract in
  the file). `AUDIT_SUITE=gold-v1|holdout-v1` swaps the audit onto them; default unchanged. Smoked.
· **U2 blind review harness** — make_blind_pairs.py renders unlabeled side-by-side route cards with
  seeded side-randomization; score_blind.py computes per-arm ratings + pairwise wins. Smoke proved the
  anti-bias property (identical arms + uniform answers → exact 2–2 split). From R33 on this is an
  ADOPTION GATE (owner is the panel).
· **U3 invariants + metamorphic tests** — new invariants.test.ts. FIRST RUN CAUGHT A REAL LATENT BUG:
  `judgeTrip` passed a NaN duration through the ±25 % gate (NaN compares false against every
  threshold) — fixed with a finiteness check. Also pinned: hard-exclusion survives translation; the
  canonical detour denominator is the ROUTED direct distance — and the rq31 probe re-run under it
  restates A→B truth: **worst detour 1.51× (the old 1.92× was crow-flies inflation; the 1.8× cap
  never leaked)**; `shortest` inertness; judge monotonicity.
· **U4** — BD-154 (hard-exclusion no-op overturned; warnings surfaced) + the 3.8.3 upgrade experiment
  STAGED as infra/valhalla/upgrade_383_experiment.sh (isolated port 8003, tiles rebuilt by 3.8.3
  itself, A/B commands embedded; [HUMAN] runs the Docker steps).
Suites at close: **backend 455 (57 files) · app 163 · shared 24**, tsc + eslint clean. Next: R33 —
the `shortest` bake-off (pre-registered auto-profile competition, blind-review gated).

**BD-156 — R33-U5 PRE-REGISTRATION: the `shortest` bake-off (2026-08-09, FROZEN BEFORE ANY ARM RAN).**
Recovery §5.2's central lever gets its first fair competition. Incumbent: BACKROADS-`shortest`
(adopted R18-1 vs the then-LEGACY; tuned-`auto` arms were never in that bake-off). Challengers: the
frozen 9-arm grid in `EXPERIMENT_PROFILES` (costing.ts) — use_distance {0,.15,.30,.45} × maneuver
{0,15,40 s} × service {default, 300 s/×5}, living-streets and tracks pinned to 0, sizing speeds
derated with use_distance. Served through the REAL `runPlanner` via the per-call PROFILE_EXPERIMENT
hook (unset = byte-identical incumbent); ONE ARM PER PROCESS (module-load flags). Surfaces judged
separately (BD-111): LOOPS = legacy generation (DRIVE_FIRST=off) on the gold fallback-class subset
(8 origins × 60/90); A→B = the 25-corridor gold suite. **Adoption rules, all must hold on GOLD:**
(1) structural defects (spurs+crescents+uturns+doubling>1.2 km) not up; (2) backroad +5 pp OR (flat
backroad AND continuity meanRun +25 %); (3) duration |err| p80 not worse >3 pp; (4) wall not up
>20 %; (5) turns/10min not up >10 %. Then the BLIND HOLDOUT review (owner panel, Recovery §17.4)
must prefer the challenger — no adoption on metrics alone. New instrument feeding judgment: the
continuity metric (U6 — engine street_names → name-run lengths + hops/10min; unnamed stretches
extend runs). Refusals recorded per arm. The grid may not be edited now that this entry exists.

**BD-157 — R33 BAKE-OFF VERDICT: ALL NINE CHALLENGERS REFUSED ON THE FROZEN RULES — AND THE REFUSAL
QUANTIFIES `shortest`'s PRICE FOR THE FIRST TIME (2026-08-09).** Mechanical judgment (rq33_rank, the
registered referee) vs P0_incumbent on the gold suites:
· **Every arm fails Rule 2**: `shortest` genuinely maximizes backroad share — challengers lose
  −1.6…−5.0 pp (A→B) and **−9.3…−19.0 pp (loops)**. R18-1's adoption reason is CONFIRMED, not
  overturned.
· **But the challengers dominate every OTHER axis, decisively, on loops**: structural defects
  **5 → 0** (P4_d45; most arms ≤1) · duration |err| p80 **48 % → 22–32 %** · continuity meanRun
  **+37…+61 %** · turns 3.9 → 2.7–3.0 · wall −25…−40 %. On A→B: structural 17 → 8–13, continuity
  +22…+29 %, wall −15 %, backroad −2…−5 pp.
**The Recovery doc's prediction is confirmed in numbers: distance-only routing buys its backroad
share by road-hopping, structural junk, and duration blindness.** The pre-registered Rule 2 made
backroad-share the near-mandatory axis — our own detector — so the incumbent SURVIVES under BD-156,
and no flag flips. Per the discipline: refusal recorded, grid untouched, holdout untouched (its
sanctioned use was acceptance of a rule-passing challenger; none passed).
**OPEN QUESTION FOR THE OWNER (this is a product-values call, not a metrics call):** is 40 %
backroad with 5 structural defects, 48 % p80 duration error and constant road-hopping better than
~31 % backroad with ZERO structural defects, 32 % error and +42 % longer sustained runs? If the
answer might be no, the path is a **re-registration (BD-158)** whose rules weight structural/
duration/continuity and whose arbiter is the BLIND HOLDOUT review — the owner's 15-minute session,
exactly what Recovery §17.4 exists for (human preference prevents overfitting our own detectors).
Nothing changes until he chooses. e2e re-verified clean post-grid (the best_so_far blip was the
BD-148 contention ghost, again).

**BD-158 — RE-REGISTRATION (owner-authorized 2026-08-09: "do what you recommend"): the `shortest`
question goes to the BLIND HOLDOUT, with rules weighted to the owner's lived complaints. FROZEN
BEFORE ANY HOLDOUT ARM RAN.**
· **Challenger selection rule** (mechanical, from the already-seen GOLD data — gold is the tuning
  set): per surface, lexicographic min structural defects → min duration p80 error → max backroad →
  max continuity. Applied: **loops challenger = P4_d45** (structural 0 vs incumbent 5; durErr p80
  32 % vs 48 %; backroad 31.1 % vs 40.4 %; continuity +42 %). **A→B challenger = P6_d30_manstrong**
  (structural 8 vs 17; backroad 30.7 % vs 33.2 %; continuity +29 %).
· **Adoption rule:** a challenger ships on its surface iff the OWNER'S BLIND REVIEW of the holdout
  pairs prefers it — clear pairwise majority AND no new hard-defect class visible in the holdout
  artifacts (Recovery §17.4). Holdout metrics are recorded for the log but do NOT decide; the metric
  trial already happened (BD-156/157) and split. Ties or unclear → incumbent stays, question closed.
· Holdout use is hereby its sanctioned acceptance use. Sheets: seeded side-randomized blind pairs
  (R32-U2 harness). One session, ~15 minutes, two sheets (loops, A→B).

**BD-159 — THE BLIND VERDICT: THE OWNER'S OWN EYES RATIFIED `shortest` ON BOTH SURFACES; THE QUESTION
IS CLOSED (2026-08-09).** BD-158's arbiter ran: 25 sealed pairs (20 loops, 5 A→B), sides randomized,
keys opened only after his answers were downloaded (answer files preserved in eval/reports/).
· **Loops (P0 `shortest` vs P4_d45):** pairwise 9–10–1 (challenger 10), mean ratings 3.00 vs 3.15 —
  a statistical coin flip, NOT the "clear majority" the frozen rule requires. The measured trade
  (−9 pp backroad for structural 5→0, durErr 48→32 %, continuity +42 %) nets out to "same feel" in
  blind human judgment. Incumbent stays.
· **A→B (P0 vs P6_d30_manstrong):** the incumbent CLEARLY preferred — pairwise 3–1–1, mean 3.80 vs
  2.00. Challenger refused decisively by the only judge that outranks the metrics.
**Standing outcome:** BACKROADS-`shortest` survives the full gauntlet — nine metric arms (BD-157),
then human blind review (this entry) — and per the frozen BD-158 rule the `shortest` question is
CLOSED; no further re-litigation without new evidence of a different KIND (e.g. R38 dynamic costing,
whose preference-model corpus starts with exactly this 25-pair distribution — the first human
calibration data the project has). The Recovery doc's #1 recommendation was tested to the end and
the incumbent won honestly; the review's VALUE stands anyway: the price of `shortest` is now known
and pinned (BD-157), the continuity metric exists, and the blind harness is proven end-to-end.
Next per the approved plan: **R34 — serve the best clean candidate, retire the dirty fallback.**

**BD-160 — R34 SHIPPED: SERVE THE BEST, RETIRE THE DIRTY FALLBACK (2026-08-09).** The three units of
the approved plan, all live and measured on the GOLD suite (the deliberately hard one — 16 origins
across 15 network classes; not comparable 1:1 to old region-spread seeds):
· **U7 best-clean serving** — `driveFirstTrip` builds every viable candidate in its wall slice and
  serves the best CLEAN one (exact band → |duration err| → measured backroad → curviness → commute →
  id), not the first passer.
· **U8 duration tiers + the FINAL STRUCTURAL JUDGE** — cleanliness is judged without a duration
  cliff; ±15 % (TRIP_EXACT_BAND) classifies exact vs honest ALTERNATE ("No clean 60-minute loop fits
  from here — built a clean 84-minute one instead", plus up to 2 distinct-ring alternate mentions).
  The legacy pipeline is now a candidate generator: its output passes the same structural trio
  (stubs/crescents/graced-doubling>1.2 km) or the result is an HONEST NO-CLEAN state naming exactly
  what it refused to ship. Live-verified at Cobourg: "the best live attempt had crescents ×1, which
  we don't ship" → status unavailable. Audit taxonomy gained servedTier + the serve triple;
  wrong_length is skipped for alternates (their mismatch IS the disclosed product).
· **U9 fidelity honesty** — through-samples come from FULL-resolution geometry (migration 0020,
  applied; simplified is display-only), ARC_FIDELITY_MIN 0.6→0.85, and measured core stats are
  advertised only at fidelity ≥0.95 (STATS_PROVENANCE_MIN) — else curviness is withheld rather than
  approximated (comparability to the frozen GATE-C formula beats a lookalike recompute).
**Gold audit v21 (fresh seed, serve triple on 60 loop fixtures):** clean_exact 17 · clean_alternate
17 → **34/60 clean-served** · legacy 22 (now guaranteed structurally clean on the trio) ·
true_no_clean 4 (deserts, honestly stated). EXACT tier: duration **1.02× mean / 1.10× worst**, zero
wrong-length/not-a-loop/stubs/crescents, 61 % backroad. ALTERNATE tier: structure clean, durations
disclosed (1.32× vs the ask BY DESIGN). Live smokes: Southfields 60-min → exact @ fidelity 0.96;
Cobourg 2 h → honest no-clean. Suites 460/163/24; his-areas probe 25/36 clean.
**Known residuals, honest:** legacy tier still carries wrong_length 10 + not_a_loop 8 (structurally
clean but soft-dirty — the next lever is supply/coverage, not more gating: 4 no-clean states already
exist); one served-exact trip carried 1 u-turn (trip gates never gated u-turns — candidate follow-up,
one line, registered next round); A→B gold 17/20 routed (3 no-routes on the NEW harder long
corridors — legacy A→B limit, logged for the R38 adaptive-candidates round).

**BD-161 — THE OWNER'S "SQUARE WITHIN THE LOOP": A WHOLE DEFECT CLASS NOBODY MEASURED, FOUND, GATED,
AND SHIPPED SAME-SESSION (2026-08-09).** Device report: "weird overlaps... like it randomly produces a
square within the loop... can't figure out how that portion would be driven in order." Root cause: a
route that CROSSES itself encloses a sub-loop — and every existing detector misses it by construction
(microloops cap at 3 km perimeter; doubling needs retraced road; overlap needs shared cells; a
clean-roads figure-eight passes everything). Recovery §6.3 named "self-crossing" as a geometry
question; no detector existed.
· **New detector** (`crossings.ts`): transversal segment-segment self-intersections over a 60 m
  resample with spatial hashing; origin grace 500 m; near-adjacent hairpins excluded; and the
  critical TRANSVERSAL filter (≥25°) — two passes down the same legal retrace sit ~1 m apart after
  rounding and WEAVE, producing 79 phantom crossings on one route before the filter.
· **The knot/pierce split, measured into existence**: a blunt zero-crossing gate rejected 164/185
  candidates at funnel origins — mostly legitimate lasso PIERCES (a spoke crossing the ring once to
  reach its far entry, enclosed length ≈ half the trip). The owner's unreadable SQUARE is a KNOT: a
  crossing whose enclosed sub-loop is short (≤10 km). Gates: **knots = 0 (zero tolerance), pierces
  ≤ 2** (out + home may each pierce once), weaving (>2) rejects. Plus the registered U-TURN gate on
  trips (v21 had caught 1 on a served exact).
· Applied EVERYWHERE: trip gates, the legacy final structural judge, the audit (self_crossing row +
  crossings column), offline scan tool (rq34_crossings_scan).
· **Offline truth on what we had been serving** (v21 artifacts, post-filter): exact tier 5/17 routes
  carried real crossings, alternates 10/17 — the owner saw a real, common defect the instruments
  were blind to. **Serving cost, measured**: his-areas 25 → 23/36 (blunt gate would have been 15) —
  two asks traded for zero squares in anything served, under his standing quality-over-quantity
  direction. Live smoke: served 90-min Southfields trip = {knots 0, pierces 0}.
· Residual for R35: arc_deviation is now the top candidate-killer (117) — the 0.85 full-res fidelity
  bar is strict against r34 rings; J1/J2 optimization + denser sampling are the planned levers.
Suites 466/163/24; backend restarted on the gates.

**BD-162 — TWO DEVICE REPORTS, TWO ROOT CAUSES, SHIPPED (2026-08-11).**
**(1) Discover "getting there/back is now weird."** Root cause: connectors routed to the STORED
entry/exit vertex — an arbitrary sweep artifact; the fastest path to a far ring vertex is exactly the
weirdness he saw (amplified by BD-150's name-dedup surfacing new cards with awkward stored entries).
Owner's spec, verbatim: "essentially match what Google Maps would show… there and back can be the same
route." Fix: a loop core is a RING — `rotateRingToNearest` meets it at the origin-nearest vertex; the
measured ring is served rotated (roads/length/duration untouched), both commute legs are plain
engine-fastest to/from that single join, same-way home fully blessed. Live: Duffy's Lane get-there
38 min→**2 min**; menus symmetric (18/18, 15/15); Discover gate PASS.
**(2) Loops "still have squares" (screenshot).** The circled X = out+home piercing the ring SIDE BY
SIDE — enclosed length > 10 km, so the BD-161 enclosed-length rule classified them as two *allowed*
pierces. The discriminator his eyes use is SPATIAL: two crossings near each other are a knot
regardless of enclosure. Fix: `PIERCE_CLUSTER_M = 3 km` — any crossing pair within it becomes knots
(zero tolerance); genuinely separated pierces (≤2) stay tolerated. The test debugging itself proved
the rule: a FULL-ring lasso structurally re-crosses beside its entry (clustered → rejected — that IS
the screenshot), which is why real serves use partial arcs with separated J1/J2. Serve rate held
23/36 at his areas (weaving rejections 45→4 as clustered pairs reclassified). His diagnosis was also
correct: loops ARE built as get-there + ring + get-home internally; R35's J1/J2 matrix optimization
attacks the piercing at the SOURCE (better join pairs) — these gates are the guarantee meanwhile.
Suites 468/163/24; backend live on both fixes.

**BD-163 — THE SQUARE'S REAL DOOR: TWO SERVING EXITS BYPASSED THE FINAL JUDGE; SEALED AND
LIVE-VERIFIED ON THE SCREENSHOT REGION (2026-08-11).** The owner: "loops still show squares exactly
same as before." He was right because the BD-160 final judge ran only at the MAIN exit —
`presentDirtyBest()` (the ladder-exhausted and budget-exhausted "least-flawed fallback": by
definition the DIRTIEST material in the system) returned routes from two earlier exits without ever
meeting the judge. The R32 invariant "no candidate path may bypass the final judge — asserted, not
assumed" had been written and never asserted; the owner's device asserted it instead. Fix: the judge
is now a single closure (`applyFinalStructuralJudge` — stubs, crescents, graced doubling, and
BD-162's clustered-knot crossings) invoked inside `presentDirtyBest` before it emits AND at the main
exit; a judged-away dirty-best becomes the honest no-clean state. **Live verification, his exact
region** (Norval/Terra Cotta/Georgetown NE/Glen Williams/Southfields/Cheltenham × 45/90/120-min =
18 briefs through the running API): 17 served with **knots = 0 on every route** (pierces ≤ 2, all
spatially separated), 1 honest refusal — including a `best_so_far` and `relaxed` serves that
previously escaped. His architecture question answered on the record: a served loop IS one
continuous route origin→around→origin (no separate commute is drawn or driven); the ring-arc is the
internal construction that finds the good roads, and the X he saw was dirty LEGACY material leaking
through the bypass — now impossible. R35's J1/J2 optimization remains the construction-side cure for
the residual pierces. Suites 468/163/24; backend live on the seal.

**BD-164 — "NAH MAN ITS FUCKED": THE FIGURE-EIGHT, AND THE END OF THE PIERCE TOLERANCE (2026-08-11).**
The owner's second screenshot was a BOWTIE — one self-crossing, two big lobes. It passed every gate
because BD-161/162's "pierce tolerance" (≤2 spatially-separated crossings) was MY invention to protect
serve rate, theorizing that single far crossings were readable lasso topology. His eyes rejected the
theory twice; the theory was wrong. **New law: a served loop is a SIMPLE CLOSED CURVE — zero
self-crossings of any kind** (the ≤500 m origin grace survives only for invisible driveway
crossovers; the knot/pierce split survives only as audit diagnostics). Applied at the trip gates AND
the every-exit final judge (BD-163's closure). **Measured immediately, his region, live API (18
briefs):** 17 served / 1 honest refusal — serve rate HELD — and the four routes that previously
served with pierces were REBUILT crossing-free by the candidate machinery rather than lost. All
suites green (468/163/24). The defect's full arc: BD-161 (detector, transversal filter) → BD-162
(cluster rule, Discover joins) → BD-163 (the judge-bypass seal) → BD-164 (zero tolerance). Each round
was driven by his device against my instruments; the instruments now encode what his eyes always
meant: origin → around → origin, one unbroken non-crossing line.

**BD-165 — THE ACTUAL SOURCE OF HIS BOWTIES: 18 % OF THE STORED INDEX WAS SELF-CROSSED, AND NOTHING
HAD EVER MEASURED IT (2026-08-11).** His question "do you think R35 will help" forced the right
investigation: the Plan API was provably serving zero crossings (18-brief live probe), yet his screen
showed a bowtie — so the material itself was the suspect. Scan of the stored r34 loop cores:
**71/403 rings self-crossed** (figure-eights share ~zero overlap cells with themselves — every
offline bar was blind; among the crossed: Ingram Road and Oro-Medonte rings that had SERVED in
audits). Discover serves stored rings ungated → his screenshots. Fixes, all shipped: (1) **purge** —
71 crossed rings deleted from serving (332 loops / 86 names remain; the sweep artifact on disk stays
as the record); (2) **source bar** — `judgeCore` gains `self_crossing` (zero tolerance), the sweep's
`measureRoute` computes it for loops AND ribbons: a bowtie can never enter the index again;
(3) **Discover belt** — cards assert crossing-free at build (~1 ms) so a future bad load can't leak.
**Live after purge:** region probe 17/18 served all-zero-crossings; Discover gate PASS with **8/8
full menus** (the purge cost nothing visible — better cards filled in); Southfields menu 6 distinct
clean rings. R35's honest answer, on the record: it optimizes Plan's join selection (serve-rate
recovery at funnels) — it would NOT have fixed this; bad stored material needed the purge + source
bar. Suites 469/163/24. Defect arc complete: BD-161 detector → BD-162 cluster+joins → BD-163 bypass
seal → BD-164 simple-closed-curve law → BD-165 the material itself.

**BD-166 — R35 SHIPPED: J1/J2 MATRIX OPTIMIZATION + THE MEASURED ORIGIN STEM (2026-08-11).**
· **U10** (`J1J2_MATRIX_OPT`, on): each candidate ring gets ≤12 PORTS sampled around its full-res
  geometry; ONE `/sources_to_targets` prices origin↔every port with real network costs; all feasible
  (J1, J2, direction) pairs are enumerated (separation ≥1.5 km, arc-frac 0.6–1, predicted commute
  ≤0.55) and ranked exact-band-first by predicted duration error; the top 3 pairs are BUILT. The
  perpendicular home-via ladder is retired on this path — a different legitimate ring exit replaces
  artificial via points (Recovery §7.4). Off = the pre-R35 nearest-vertex heuristic, byte-identical.
· **U11** (`UNAVOIDABLE_STEM`, on): the fixed 1 km doubling grace is replaced by a MEASURED stem —
  8 engine-fastest probes to compass targets, quorum shared-prefix, floor 300 m / cap 4 km, honest
  fallback to 1 km on engine errors. Wired into the trip gates AND the final judge; stems ≥1.5 km are
  disclosed ("this area has one practical way out…"). Metamorphic test: funnel > connected origin.
· **Forensics**: every served loop's trace now carries `x knots/pierces, stem, fidelity` and the
  final judge logs an explicit PASS line — the owner's next device report maps to machine evidence.
**Measured:** hardest-areas serve **15 → 19/36** under the full zero-crossing law (the pre-law 23
required serving crossed shapes); live smoke: served exact, **fidelity 1.00** (full-res pair slicing),
**stem 540 m measured** at Southfields (vs the 1 km guess), x 0/0. Region probe re-run exposed a
false regression that was actually **SPK-14's rate limiter 429-ing an 18-brief burst** — the limiter
works; the probe now paces itself. Wall at funnel origins ~14 s (stem + 5 matrices + pair builds,
inside the 25 s contract and the 40 % attempt slice). Suites **472/163/24**. The BD-161→166 arc
stands: gates guarantee the law; R35 construction wins serves back inside it.

**BD-167 — R36 PRE-REGISTRATION: LAYERED SWEEP JUDGING (frozen 2026-08-11, BEFORE the r35 sweep
runs; Recovery §10 applied to the INDEX).** The r34 histogram shows thousands of near-miss quality
rejections (a 54.9 %-backroad ring is not categorically worse than a 55.0 % one) while structural
defects are absolute. The layers, frozen:
· **Layer A — structural, reject always:** untraced · uturns>0 · spurs>0 · microloops>0 ·
  self_crossing>0 (BD-165) · ribbons: corridor_doubling>0.1, self_overlap>0.05, endpoint separation.
· **Layer B — sanity floors, reject:** backroad <0.40 · main >0.45 · hood >0.10 · turns >8/10min ·
  loop loopiness <0.18 · any highway metres (unchanged).
· **Layer C — quality RANKING** decides what a cell keeps (CELL_KEEP_MAX unchanged):
  q = backroad_share + 0.25·min(curviness,3)/3 − 0.5·hood_share − 0.15·max(0, turns−5)/5.
· Rows passing the OLD strict bars keep `bar_profile='strict'`; floors-only rows are `'layered'` —
  and the serving RPC already orders strict-first, so layered supply serves only where strict supply
  is absent. Zero live-behavior change until an index built this way is verified and flipped.
**Adoption bars (frozen):** distinct clean rings ≥ +25 % vs r34 · served-quality distribution on the
gold probe NOT degraded (backroad/curviness/turns flat-or-better on served trips) · all as-driven
gates unchanged · the OWNER'S BLIND REVIEW of r34-vs-r35 holdout serves prefers-or-ties the new index
(no new defect classes). The staging version is `r35-rib`; production stays `r34-rib` until all bars
pass and he reviews.

**BD-168 — R36 SUPPLY TOOLING + TWO LATENT DEFECTS FOUND BY IT (2026-08-11).** While the r35
layered sweep grinds, the supply system landed: **loader v2** (`eval/load_drive_cores_v2.ts`:
replace-version / `--merge` upsert / `--replace-cells`; stamps `sweep_run_id` / `config_stamp` /
`tileset_id` from the manifest sidecar — migration 0021, applied locally), **global dedup**
(`eval/dedup_index.ts`: production's own `edgeOverlapRatio` >0.5 mutual + duration within 15 %,
keep-best strict→quality→id, DRY-RUN default), **coverage map** (`eval/coverage_map.ts`: per-10 km
supply×material classification → healthy / weak_generation / true_desert + a material-ranked CELLS
line for targeted top-ups), and **ribbon carry v2** (`eval/carry_ribbons.ts`). Two defects the
tooling itself exposed:
· **The id-collision law.** Sweep ids (`cell:loop:cand`) carry NO version, and `id` is the global
  PK — the r35 artifact regenerates ids format-identical to r34-rib rows, so an un-namespaced merge
  would silently STEAL production rows into the staging version. Loader v2 + carry v2 namespace
  every id `<version>:…` at insert; each version owns a disjoint id space; re-loads idempotent.
· **The r34ribbon dedup breakage (production bug, fixed + shipped).** The r34 carry dodged that
  same collision by hand-renaming ids `:ribbon:`→`:r34ribbon:` — which silently killed
  `ribbon_chain`'s physical-road dedup (its `':ribbon:'` marker no longer matched; every cell-copy
  of a road counted as distinct). **Measured on live rows: Guelph pool 54 "distinct" = 6 real
  roads; Southfields 63→7; Cobourg 18→2** — the documented Guelph 24→4 hazard, back in production
  since the r34 flip. Fixed with format-proof `ribbonRoadKey` (last-colon suffix) + tests
  (474 green), backend restarted on the fix.
**Baselines for the BD-167 bars (measured, honest denominators):** r34-rib = 332 stored loops =
**175 distinct-standing** after geometric dedup (47 % storage bloat; one 50-min Grasshopper ring
stored ×6) → the +25 % bar means r35-rib ≥ **219 distinct-standing**. Coverage: 679 material
cells = **33 healthy · 586 weak_generation · 60 true_desert** — the structural case for layered
judging in one line. Manifest `TRACKED_ENV` now also freezes the sweep knobs (SWEEP_LAYERED,
GENERATOR_VERSION, durations, caps — the r35 sidecar predates this and misses them; recorded).

**BD-169 — ALT_HOLD_LEGACY ADOPTED: an out-of-band clean alternate no longer preempts the exact
band (2026-08-11).** The rq36 index A/B caught it: at Uxbridge's 60-min ask, r35's richer index
produced a CLEAN 97-min alternate and served it immediately — the legacy generator (which builds a
clean 66-min in-band loop there) never ran. Under r34 the same policy accidentally did the right
thing only because every core candidate FAILED, forcing the legacy path. R34-U8's law ("legacy is a
candidate generator under the same judge") was implemented as fail-open only, not as competition.
**The change (flag `ALT_HOLD_LEGACY`, off = R34-U8 behavior byte-identical):** an alternate-tier
drive-first serve is HELD; the legacy pipeline runs; the legacy result wins ONLY as a clean,
unrelaxed, exact-band (±15 %) loop passing the final structural judge — everything else (dirty-best,
relaxed, out-of-band, judge-reject, true no-route) serves the held measured alternate. Every exit
funnels through the arbitration (presentDirtyBest short-circuits to the held serve; the trace says
"holding clean N-min alternate — trying for an exact M-min loop live").
**Pre-registered rule (frozen before measuring):** previously-exact serves byte-identical ·
alternate fixtures unchanged or → exact-band clean · serve count not lower · wall in contract.
**Measured on the 20-fixture holdout (r35 pin):** 19/20 byte-identical; Uxbridge 60m 97→65 min
(8 % err, final judge PASS, backroad 54→50 — the priced trade, duration fit first); serves 17→17;
wall in contract. **ADOPTED, default on**; suite 474 green; live wire smoke at Uxbridge serves
66 min/ok. **BD-167 bars under the adopted policy:** distinct 175→**393 (+125 %, bar ≥219)** ✓ ·
served quality BETTER on every aggregate (serves 16→17, backroad 45.8→46.4 %, dur-err 15.5→12.4 %,
structural 0=0; one noted per-fixture trade: Uxbridge 90m backroad 75→54, in-band both) ✓ · gates
unchanged ✓ · **owner blind review = PENDING (the STOP)** — sheet eval/reports/blind_r36_review.html
(16 pairs, key fp fde434c77fc8, seed 36). Production stays r34-rib until he reviews.

**BD-170 — PRODUCTION FLIPPED TO r35-rib (2026-08-11).** The owner's blind review (16 pairs, seed
36, key fp fde434c77fc8) came back **1-1-14**: r35 preferred at Newmarket-60 (his 5-vs-4 — the
57-min 62 %-backroad serve over the 88-min 21 % one), r34 preferred at Uxbridge-90 (his strongest
call, strength 2 — the 75 %-backroad ring over r35's 54 % one), every other pair a tie ("most were
the exact same route" — 14/16 were, byte-identical; his eyes independently confirmed the
instrument). **Prefers-or-ties + no new defect class → bar 4 PASS; all four frozen BD-167 bars
pass.** Flip = the one-constant mechanism (discover_cores default 'r34-rib'→'r35-rib'); suite 474
green; live wire proof: `served exact r35-rib:c-79.863_43.708:loop:…` at Southfields (69-min
exact for a 60 ask, x 0/0, stem 540 m) and a 6-card all-distinct Discover menu (Forks of the
Credit, Hockley Valley Road present). r34-rib rows stay loaded for instant rollback
(`DRIVE_CORES_VERSION=r34-rib` env).
**Named residual (not chased, recorded):** Uxbridge-90 — r35's richer candidate field diluted the
build attempts (browse-order + TRIP_PAIRS_MAX cap) so the br77 Mast ring that r34 served was never
attempted; the served br54 ring is in-band and clean, just less pretty. Follow-up candidate for a
future adopt-or-refuse round: quality-aware attempt ordering under rich supply. NOT tuned now —
the bars passed and tuning post-hoc against the review would be exactly the over-fitting the
blind harness exists to prevent.

**BD-172 — THE ZERO-CURVINESS DEFECT: every loop core in every index version scored curviness 0
(found 2026-08-11, device-driven).** His post-r35 device verdict ("still quite broken, same old
mistakes") contradicted green instruments, so the session was reconstructed from the backend log and
replayed at his home origin: three different asks served the IDENTICAL 69-min ring (commute 45 %),
the 45-min ask fell to legacy at 39 min, the 2-hour ask died honestly (final judge: self-crossings
in the legacy build). Root cause found while probing why: **`computeCurvature` skips CLOSED RINGS**
(the cul-de-sac corpus-poison guard, commit 3bf5403) — and every loop ROUTE is a closed ring, so
`measureCurvature` returned 0 for every loop the sweeps ever measured (ribbons: unaffected, mean
1.37). Consequences: the RPC's backroad·curv order, Discover ranking, sweep Layer C quality, dedup
keep-best, and any twisty differentiation were all CURVATURE-BLIND on loops — a straight
concession-road SQUARE ranked equal to a river-valley ring, which is precisely the owner's oldest
complaint. **Fix:** `allowClosedRing` param (default false — corpus behavior byte-identical, data
suite 18/18) passed as true by route-level `measureCurvature`; pinned by a test (closed square
scores, closed twisty ring ≫ square). **Backfill:** r35-rib 393/393 and r34-rib 332/332 loops
recomputed in place from full-res geometry (r35 spread: p10 0.56 · median 1.03 · p90 1.68 · max
3.82 — the p10 tail below θ=0.6 IS the squares, now measurable). **Evidence line at his home:** the
served 60-min ring is curv 1.13 while a 59-min Creditview Road ring at curv 2.04 sits within 18 km
— the supply existed; nothing could see it. **r36-rib full resweep launched** with real curvature
live in Layer C (staging; BD-167-style bars + owner blind review before any flip).

**BD-171 — TWISTY_TRIP_RANK REFUSED (2026-08-11; rule frozen pre-run).** Measured at his home:
"1 hour twisty" and "1 hour backroads" served the identical core because `driveFirstTrip` never saw
`constraints.character`. Lever: twisty asks flip the quality tiebreak to curvature-first (BD-70's
legacy precedent), flag `TWISTY_TRIP_RANK`. Pre-registered rule: non-twisty byte-identical ·
twisty serves different+curvier where distinct cores exist · mean served curviness strictly up ·
serves not lower. **Result (12 twisty fixtures, post-backfill): REFUSE** — non-twisty 12/12
byte-identical and serves 12→12, but mean served curviness 1.04→1.02 and the only changed fixture
(Port Perry 90) degraded to a legacy fallback: the tiebreak fires AFTER fit-band and the 2 km
distance rule, so it can only reorder near-equals — and near-equals rarely differ in curvature.
Flag stays default-off (code+test kept, refusal recorded). The real twisty lever is (a) SUPPLY —
the r36 curvature-aware resweep — and (b) a future pre-registered serve-ordering round where
curvature enters the RANK (Recovery §10.3), not the tiebreak; the Creditview-2.04-unpicked-at-home
evidence line is its motivation. Character plumbing (run.ts → driveFirstTrip opts) ships inert.

**BD-173 — r36-rib ADOPTION BARS (frozen 2026-08-11 BEFORE serve-side measurement; artifact-level
stats only were visible: 362 loops/100 names, curv p10 0.68/median 1.12/zeros 0, hash dc71b58).**
r36 is a QUALITY re-orientation (de-squaring via real curvature in Layer C), not a supply
expansion — BD-167's "+25 % distinct" bar does not transfer. Its bars:
· **Served curviness strictly UP** on the combined home+holdout ladder (mean served-core curviness
  and/or as-driven measured curviness r36 > r35) — the defect being fixed must show up in serves;
· **Structural law unchanged:** zero served defects (crossings/uturns/spurs/microloops) both arms;
· **Serve count flat-or-better** on the same ladder (honest refusals may shift WHICH asks, not net
  count down);
· **Coverage usefulness flat-or-better:** healthy-cell count (coverage map) not below r35's 53
  after the belt top-up merges;
· **The owner's blind review prefers-or-ties** r36 serves (no new defect classes).
Staging only until all five pass; production stays r35-rib. Rollback stays two envs
(DRIVE_CORES_VERSION, ALT_HOLD_LEGACY).

**BD-174 — RANK_QUALITY_V2 REFUSED · BD-173 VERDICT: 4/5 BARS PASS, curviness bar fails with a
named cause — the flip decision goes to the owner's blind review (2026-08-11).**
· **The union index.** The r36 curvature-aware sweep alone collapsed coverage (healthy 53→25) —
  the frozen coverage bar caught it. Recorded remedy: UNION r35's loops into r36-rib via the merge
  path (carry generalized to loops), dedup keep-best across generations → **537 distinct-standing
  loops, healthy 68 (> r35's 53)**, plus the 49-cell belt top-up (28 rings; the belt's failure
  histogram says main/backroad floors — much of "weak_generation" is honest near-desert).
· **RANK_QUALITY_V2 (frozen rule, one-arm-per-process, 26-fixture ladder): REFUSED** — 25/26
  byte-identical; the one change LOST a serve (Ancaster 90m → unavailable: the reorder spent the
  build budget on a structurally-failing candidate). With BD-171 this is the second serve-side
  ordering lever refused in one round; the binding constraints are supply-at-duration×radius and
  trip construction, not ordering. Flag default-off, kept for a post-R37 revisit.
· **The 2-hour-at-home anatomy (traced):** every in-band ring's from-home construction fails real
  gates (spoke-crosses-ring; doubling), legacy assembly overshoots (median 263 min for 120) and
  its dirty best is judge-rejected — honest unavailable. NAMED FOLLOW-UP, not built: the build cap
  exhausts on structural failures before reaching a buildable clean 89-min alternate one fit-band
  down (candidate: continue the ladder into alternate bands while the wall allows). Also named:
  crossing-aware J1/J2 pair pre-screening.
· **BD-173 bars, combined 26-fixture ladder (r35 vs r36-union):** serves 22=22 ✓ · structural 0=0
  ✓ · coverage 68>53 ✓ · duration error 12.2→9.4 % ✓ · backroad 45.0→48.2 % (↑) · **served
  curviness 1.42→1.30 ✗** — the failing bar decomposes into exactly 4 changed fixtures, each
  better on OTHER frozen laws: Shelburne 60m serves EXACT 60 (was a 91-min alternate) and the
  three home 60-min asks swap to a home-cell ring (backroad 32→61 %, commute slashed, curv
  1.37→1.17). Per the discipline a failed bar blocks the flip; the owner's blind review (always
  the final bar) decides with full disclosure — sheet `eval/reports/blind_r37_review.html`
  (22 pairs, seed 37, key fp fce778804571). Production stays r35-rib.

**BD-175 — r36-rib NOT ADOPTED (owner blind review, 2026-08-11).** The deciding bar came back
**3-1-18 to the INCUMBENT** (all weak, strength 1): he preferred r36's home ring once but r35's
twice on the SAME physical pair (a coin flip — the home swap is visually a wash) and preferred
r35's out-of-band-but-prettier Shelburne serve over r36's exact-60. With the curviness bar already
failed, r36-union is refused; **production stays r35-rib**; the r36-rib staging rows remain loaded
for future rounds. **Recorded product signal (first counter-evidence to duration-primacy):** in
3 of 4 non-ties he chose the prettier drive over the duration-exact or commute-light one. Future
serve-rule rounds must weigh this; the 25+16+22-pair preference corpus now spans three reviews.

**BD-176 — ALT_BAND_LADDER REFUSED · TRIP_RANK_SOUND ADOPTED (2026-08-11).** Chasing the dead
2-hour-at-home through three mechanisms, each measured:
· **Rescue rung** (continue past the build cap into farther fit bands when everything failed
  structurally): fired, tried 5 more — all failed with the same signature.
· **Variant retries** (the geometric dedup swallows same-material VARIANTS whose builds differ —
  the ring serving the 90-ask cleanly was deduped under a failed sibling): pool widened — still
  not reached.
· **The comparator was UNSOUND** — "distance if >2 km apart else quality" is non-transitive, so
  the candidate order was arbitrary-though-deterministic. Fixed as fit-band → 2 km distance band →
  quality → id (`TRIP_RANK_SOUND`): **26/26 ladder fixtures byte-identical, serves 22=22 —
  adopted default-on as a pure correctness fix with measured zero behavior change.**
**The honest endpoint:** with sound ranking, TEN candidates from all directions build for the 2h
ask and ALL fail with doubling+self_crossing+same_way_home — systematic, not selectional: 120-min
rings from this funnel origin need long spokes that cross their own ring. Refusal recorded per the
frozen criteria; the fix is CONSTRUCTION-level (crossing-aware J1/J2 pair pre-screening, R37-class)
— the named first target of the edge-native round. ALT_BAND_LADDER default off (code kept).

**BD-177 — PRE-REGISTRATION: CROSSING-AWARE J1/J2 PAIR PRE-SCREEN (frozen 2026-08-11 BEFORE
measurement; R37's first unit).** Measured root (BD-176): from funnel origins at long asks, EVERY
built pair fails doubling+self_crossing — the spokes cross the kept arc; the builder discovers this
only AFTER routing (TRIP_PAIRS_MAX=3 attempts burn on crossing configurations). **Mechanism:** for
each feasible (J1, J2, dir) pair, a geometric pre-screen approximates the spokes as chords
(origin→J1, J2→origin) and tests (a) chord-vs-kept-arc intersection (excluding a 500 m join
neighborhood) and (b) chord-vs-chord intersection away from the origin; crossing pairs rank AFTER
non-crossing pairs — never filtered outright, the as-driven judge stays the only law. Flag
`PAIR_CROSS_SCREEN`, off = byte-identical.
**Adoption rule (frozen):** on the 26-fixture combined ladder under current defaults: serve count
not lower · every off-arm exact-tier fixture stays exact-tier with quality aggregates
flat-or-better · at least one currently-failing ask flips to a clean serve OR ladder-wide
self_crossing rejections drop ≥25 % · zero structural defects · wall in contract. Refuse otherwise.

**BD-177 — ADOPTED (2026-08-11): the crossing-aware pair pre-screen is the strongest measured
lever of the project.** Frozen-rule verdict on the 26-fixture ladder: serves **22→24** (Ancaster-60
and the owner's dead 2-hour-at-home BOTH flip unavailable→clean), every changed existing serve
better on BOTH axes (Uxbridge-60 65→62 min & br 50→58; Georgetown-60 76→69 & 60→68; Georgetown-90
82→76 & 48→60), 21/26 byte-identical, structural defects 0, wall in contract. Default ON; suite
478 green; live wire: the 2-hour ask serves `exact` 114 min, fidelity 1.00, x 0/0 at his home.
Mechanism confirmed: the funnel failures were CONFIGURATION, not material — non-crossing (J1,J2)
pairs existed at the same rings and simply never ranked into the ≤3 build attempts. The screen is
ordering-only; the as-driven judge remains the only law. (BD-176's diagnosis chain — rescue rung
refused → variants insufficient → comparator unsound → construction-level — ends here, resolved.)

**BD-178 — R37-U13 EDGE-NATIVE TRUTH, offline-first core COMPLETE (2026-08-11).** Directed edge
identity now exists beside geometry, validated before any cutover (Recovery §6 discipline):
· **Capture:** `traceEdgeIds` (way_id + GraphId + direction + trimmed metres via /trace_attributes)
  and `edgeSignature` (coalesced wayId±dir runs — OSM-stable across tileset rebuilds) in the trace
  layer; migration **0022** (`edges` jsonb + `edge_sig` text, tileset-scoped per 0021's id) applied
  locally; GraphIds never stored without tileset identity.
· **Backfill:** r35-rib 392/393 · r36-rib 536/537 loops carry directed signatures (mean ~60
  directed-road runs per loop; 1 trace failure each, recorded).
· **Validation (the cutover gate):** edge-vs-geometric same-ring verdicts over every same-band
  neighbor pair — r35: 323 pairs, 98.1 % agreement; r36: 589 pairs, 99.2 %. **ZERO geometric
  over-merges in either corpus** (cells never fused genuinely-distinct rings); all disagreements
  are GEO-distinct/EDGE-dup — ~2 % residual same-road variants the geometric rule under-merges
  (e.g. two same-cell Oro-Medonte rings sharing >50 % of directed road-metres). **Verdict: geometry
  STAYS canonical** for both shape and dedup this round; edge signatures are the recorded
  refinement for a future supply pass (they'd remove the ~6 residual near-dups per version).
· **Anti-fool pin (PASS):** a curvy ribbon vs its reversal — cell overlap 0.81 (same pavement,
  above the 0.5 production dup bar) vs directed-edge overlap **0.00**: edges answer "same road,
  same DIRECTION", which cells cannot — the primitive same-way-home/opposed-retrace logic needs
  when it goes edge-native.

**BD-179 — PRE-REGISTRATION: THE A→B STRUCTURAL LAW (frozen 2026-08-12 BEFORE measurement; owner
approved option (a) with the tradeoff stated: "sure lets go with (a)"). Owner's shape verdict this
session, recorded: "the loops look a lot better now"** — first positive device read on loop shape
since the BD-146 crisis; the loop law + BD-177 construction fix hold on his eyes, not just gates.
**The gap (audit v21, measured):** 9/25 gold corridors ship self_crossing / crescent / uturn with
status ok — A→B never received the structural judge that loops have had since BD-160/163.
**Mechanism:** one `applyAtoBStructuralJudge` closure at EVERY A→B serve exit (mirroring BD-163's
loop closure): reject on self-crossings, microloops/crescents, u-turns, street stubs. NOT applied:
loop-only laws (closure, loopiness, doubling — a point-to-point drive legitimately never returns).
On reject → honest no-clean state naming the defect, same words-pattern as loops. Flag
`ATOB_STRUCTURAL_LAW`, off = byte-identical.
**Adoption rule (frozen):** on the 25-corridor gold suite — served law-class defects go to **ZERO**
(the point of the change) · corridors that were already clean stay byte-identical · quality
aggregates on still-served corridors flat-or-better (backroad, detour ratio) · refusals are honest
states, never silent empties · wall in contract. **Serve-rate loss is EXPECTED and ACCEPTED by the
owner** (his call: quality over serve rate) — but if losses exceed 9/25 (i.e. the law kills
corridors that were already clean), that is a BUG, not a tradeoff → refuse and investigate.

**BD-179 VERDICT — the A→B law WORKS but its blast radius exceeds the number the owner approved on;
DEFAULT STAYS OFF pending his call (2026-08-12).** Built as pre-registered: `applyAtoBStructuralJudge`
closure (crossings/crescents/stubs/u-turns; loop-only laws excluded), self-crossings added as a
SELECTION dirty-clause (they were never one on any surface — Recovery §11.3 applied to A→B), and
**a second BD-163-class bypass found and sealed**: the A→B drive-first exit returned before any
judge — measured live, 2 chain serves shipped crossings under the law until sealed.
**Measured, 25-corridor gold suite:**
· **Law alone (recommended):** served 24→**12/25** · served law-class defects **13→0** ✓ ·
  already-clean corridors **11/11 byte-identical** ✓ · quality flat (backroad 29.0→28.3 %, detour
  1.27→1.25×) ✓ · refusals all honest-worded ✓ · **every refused corridor was genuinely dirty
  (13/13, then 12/12 — no clean corridor was killed)** ✓.
· **Law + the 2nd generator (ATOB_DRIVE_FIRST):** served 14/25, defects 0 — but it REWRITES 5
  already-clean corridors and drops served backroad 29.0→26.0 %, failing the "clean stays
  byte-identical" bar. Consistent with BD-159's independent refusal; **stays off**.
**The frozen ceiling FAILED literally: 12 losses > the 9 I pre-registered.** Investigated per the
rule: not a bug — the 9 came from audit v21's narrower A→B defect vocabulary (it never counted
street stubs), and selection-level rescue recovered only 1 corridor because these corridors are
dirty in EVERY candidate their generator produces (generation-level, exactly like the loop funnels
before BD-177). **I will not move a goalpost after seeing results, and the owner approved (a) on
"9/25": the real cost is ~half the A→B surface refusing. ESCALATED — his decision**, options
recorded: (i) ship the law as measured; (ii) ship it with a plain-direct-route fallback ("no clean
backroads route — here's the direct way", new copy, not built); (iii) hold the law until A→B
candidate competition (Recovery §16.2) can rescue corridors at generation time. Code + probes land
flag-gated OFF; the bypass seal ships regardless (it is a correctness fix, inert while the flag is
off since nothing else judges A→B).

**BD-180 — U12c ADOPTED: the silent Discover v1 downgrade is retired (2026-08-12).** Recovery §15:
an empty measured menu used to load v1 out-and-backs — a lower-quality lookalike wearing the same
UI. **Measured the blast radius BEFORE flipping (rq40_discover_fallback, live over gold + holdout):
0 of 27 origins return an empty v2 menu** — every origin gets measured cards (Cobourg, the known
desert, gets 2; the rest 6). So the fallback is a path nothing measured reaches, and when it does
fire it downgrades silently. Now: empty v2 → the server's honest state verbatim ("No measured
drives near here yet…"). Flag `DISCOVER_V1_FALLBACK = false` (set true to restore); the v1 route
branch itself stays for old installed apps (contract version, removable ≥2026-09-01 per its own
note). Test flipped from pinning the fallback to pinning the honest state; suites 478/163/24 green.

**BD-181 — PRE-REGISTRATION: A→B LAW + PLAIN-DIRECT FALLBACK (option (ii), owner-approved
2026-08-12; frozen BEFORE measurement).** The approved product: the BD-179 structural law stands,
and a corridor the law refuses serves THE DIRECT ROUTE with honest words ("No clean backroads route
between these two points right now — routed you the direct way instead."), status `relaxed`, NO
backroads framing (curviness null, no measured claims), user avoids honored on the direct route
(hard highway exclusion when asked). The direct route is judged too — if even it fails structure,
the honest unavailable stands. Scope: LAW REJECTS ONLY — corridors that were already unavailable
pre-law (true no-material) stay unchanged. One flag = one decision: `ATOB_STRUCTURAL_LAW` now
gates the whole (ii) package.
**Adoption rule (frozen):** on the 25-corridor gold suite, flag on vs off:
· zero law-class defects on any backroads-framed serve;
· already-clean corridors byte-identical (11/11);
· every law-refused corridor serves the labeled direct route (status relaxed + the honest words)
  OR an honest unavailable if even the direct fails structure;
· serve count ≥ the off-arm's 24/25 minus only direct-route structural failures (expected 0);
· no direct serve carries curviness/measured framing;
· wall in contract. Refuse otherwise.

**BD-181 — ADOPTED (2026-08-12): the A→B law + plain-direct fallback is live.** All frozen bars
pass on the 25-corridor suite: clean corridors **11/11 byte-identical** · zero law-class defects on
every backroads-framed serve · **9 direct fallbacks, all structurally clean** (full law applied to
the direct too — an earlier draft judged only crossings+u-turns and shipped 2 crescent-carrying
directs; completed to the frozen spec before judging) · London→Grand Bend UPGRADED to a clean
backroads serve (the selection clause let a clean candidate win) · serves 24→20/25 with the 4 dark
corridors exactly the rule's allowed case (even the direct fails 2D structure). Off-arm re-run
proved the async refactor byte-neutral (25/25). Default ON; suites 478/163/24; live wire:
Oakville→St. Catharines serves the labeled direct fallback (45 min, x 0/0, relaxed).
**Named finding — the 4 dark corridors are a DETECTOR-DOMAIN artifact, not missing roads:**
engine-fastest directs through grade-separated interchanges self-cross in 2D while being 3D-clean
(ramp bridges over the just-driven mainline), and mandatory jug-handles read as "crescents" — the
structural detectors were designed for backroads loop shapes. BD-178's edge capture provides the
exact tool for the refinement (edge-class-aware crossing/crescent tests on has_highway directs);
owner-optional small round, frozen rule first as always. Until then those four corridors say the
honest words rather than shipping anything the law can't verify.
