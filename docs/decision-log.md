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
