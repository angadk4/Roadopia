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
