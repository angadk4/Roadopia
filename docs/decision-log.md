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
