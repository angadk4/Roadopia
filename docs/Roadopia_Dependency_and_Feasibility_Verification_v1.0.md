# Roadopia — Dependency & Feasibility Verification

**Version:** 1.0
**Reviewed artifact:** `Roadopia_Master_Specification_v2_0.md` (v2.0, approved-for-build)
**Reviewer role:** principal architect / geospatial-infra / mobile-platform / AI-infra / security / technical due-diligence
**Verification date:** June 18, 2026 (all "**verified**" claims carry this access date unless stated)
**Method:** every volatile or high-stakes claim re-checked against the vendor's own current documentation, pricing page, or source repository — not against the spec's assertions. Facts are separated from engineering assumptions and from items that can only be settled by measurement (spikes).

---

## Table of contents

1. Executive verdict
2. Build-readiness status
3. Verified architecture summary
4. Dependency matrix
5. Version-compatibility matrix
6. Invalid or outdated assumptions
7. Verified limitations
8. Required changes to Roadopia v2
9. Hosting & resource analysis
10. VPS recommendation
11. Valhalla deployment analysis
12. Cost analysis
13. Licensing & attribution analysis
14. Mobile-platform limitations
15. App-distribution implications
16. Runtime AI verification
17. External navigation hand-off verification
18. OSM & geospatial-data verification
19. Supabase & RLS verification
20. Evaluation / CI feasibility verification
21. Required feasibility spikes
22. Blocking decisions
23. Recommended fallbacks
24. Go/No-Go checklist

---

## 1. Executive verdict

**CONDITIONAL GO.**

Roadopia v2 is buildable and deployable essentially as written. Every load-bearing external dependency — the Anthropic API (models, identifiers, pricing, caching, tool use, streaming), `@rnmapbox/maps`, Mapbox pricing, Supabase/PostGIS limits, Valhalla's routing/map-matching/isochrone/exclusion/TSP capabilities, the Apple/Google Maps hand-off limits, Expo/React Native, and small-VPS economics — was verified against the vendor's current primary source and **matches the spec's claims**. The spec's defining engineering judgments (grounded hybrid planner, deterministic/LLM split, in-app follow-mode as primary nav, three-tier constraints, the $30 AI cap, honest scenicness, gold-label eval) are all sound and implementable. There is **no NO-GO blocker** and **no open product decision** preventing the start of Phase P0.

The verdict is *conditional*, not unconditional, for one reason: a small number of claims are **measurement-dependent and cannot be settled from documentation** — chiefly (a) whether the regional Valhalla tiles run comfortably in a small-VPS RAM envelope, (b) whether the Supabase free tier's **5 GB egress** holds for the public demo, (c) end-to-end **AI generation latency and cost** under the real model mix, and (d) **loop/scenic route quality** (the one capability Valhalla does *not* provide natively — Roadopia's heuristics own it). These are exactly the unknowns the spec already routes to spikes; this review confirms the spikes are the right gate and sharpens their pass/fail thresholds (§21).

Verification also surfaced a handful of refinements the spec should absorb (§8) — none fatal, several genuinely useful:

- **The Mapbox Navigation SDK is a financial trap that Roadopia must continue to avoid.** Verified: the Maps SDK for mobile has a generous MAU free tier, but the *Navigation SDK* free tier is tiny (≈10 MAU unlimited / ≈100 MAU + 1,000 trips metered). Roadopia's "build follow-mode from Valhalla maneuvers" choice is therefore not only a product decision but a **cost necessity** — pulling in the Mapbox Nav SDK would blow the budget at a few hundred users.
- **Mapbox has no hard spend cap, only usage alerts** (vendor-confirmed). The spec already flags this; the asymmetry with Anthropic (whose spend *is* genuinely cappable) should be stated plainly.
- **Apple introduced a new "unified Maps URLs" schema in iOS 18.4**, and the legacy `daddr=lat,lng` behaviour regressed. Hand-off code must target the current schema and be device-tested — reinforcing "best-effort."
- **Expo SDK 55 runs only on the New Architecture** (legacy arch removed after SDK 54). Every native dependency must be New-Arch-compatible; versions must be pinned and validated in the dev-build spike.
- **Supabase's new-project Data-API grants requirement (after 30 May 2026) applies to Roadopia from day one**, not the October date (which is for pre-existing projects).
- **Valhalla's "public-roads-only" guarantee is directionally true but not absolute** — it routes the OSM network as tagged and cannot know most closures/seasonal restrictions or untagged private roads; §59's wording should be softened to "reduces, not guarantees."

**Bottom line:** proceed to P0 and run the named spikes. Treat SPK-04 (Valhalla tiles/RAM), SPK-09 (Supabase egress/free-tier-fit), SPK-19 (end-to-end AI latency+cost), and SPK-15 (loop quality) as the four that gate committing to the production topology and the public demo.

---

## 2. Build-readiness status

| Layer | Readiness | Note |
|---|---|---|
| Mobile client (Expo/RN + Mapbox) | **Ready, pin versions** | Dev build required from day one (verified); pin SDK 55 / RN 0.83 / rnmapbox v11 and confirm New-Arch compat (SPK-01). |
| Maps (Mapbox Maps SDK) | **Ready** | Free MAU tier ample at target scale; must avoid the Nav SDK; no hard cap → alert required. |
| Routing engine (Valhalla) | **Ready, capability-confirmed** | All claimed capabilities verified; tile RAM/latency on a small VPS is the open measurement (SPK-04/05). |
| Routing host (small VPS) | **Ready** | Hetzner CX32-class fits the cost envelope; sizing confirmed by SPK-04. |
| Backend (Fastify + Anthropic SDK) | **Ready** | SSE, tool use, structured output, caching all verified on the API side. |
| Data layer (Supabase/PostGIS/RLS) | **Ready, two setup gotchas** | New-project Data-API grants + Storage-blob cleanup on delete; egress is the binding free-tier limit (SPK-09). |
| AI planner quality | **Spike-gated** | Loop/scenic quality + duration accuracy + end-to-end latency/cost are measurement-dependent (SPK-15/16/19). |
| Data pipeline (OSM → tiles + curvature) | **Ready** | Tooling (osmium/osm2pgsql) and extract source verified; volumes measured in SPK-08/10. |
| Safety / moderation / privacy floor | **Ready** | sharp EXIF-strip, report→remove, foreground-only recording all feasible and standard. |
| Eval harness + CI gate | **Ready, budget eval cost** | Feasible; eval traffic is a real cost vector — gate frequency + use Batch (SPK-23). |
| Store readiness (P6) | **Ready, planned** | Account deletion, privacy labels, no-background-location, moderation UI all achievable. |

Overall: **green to start P0**; **four spikes gate the production-topology + public-demo commitment**; nothing requires architectural revision.

---

## 3. Verified architecture summary

The following topology is confirmed as coherent and implementable:

- A **React Native + Expo (custom dev build) + TypeScript** app renders maps via **`@rnmapbox/maps` v11** (Mapbox Maps SDK), captures GPS in the **foreground** (`expo-location` + `expo-keep-awake`), and consumes the planner via **SSE**.
- **Supabase** (Postgres + PostGIS + Auth + Storage + RLS) serves most CRUD and spatial RPC **directly from the app**, with a **`SECURITY DEFINER`** least-privilege function for the anonymous planner read path.
- A small **always-on VPS** runs **Docker Compose**: a **Fastify** backend (raw Anthropic SDK + the hybrid agent loop) colocated with a self-hosted **Valhalla** instance (costing, map-matching, isochrone, maneuvers, elevation, TSP), behind **Caddy/nginx** with health checks + restart policy.
- **Runtime inference** uses the **pay-as-you-go Anthropic API** (Haiku 4.5 + Sonnet 4.6), distinct from any Claude subscription, protected by an app-side **$30/month cap** + kill switch (with prepaid-credit / workspace-limit backstop).
- **OSM data** (Geofabrik Ontario, clipped to a configurable `.poly`, road-class-filtered) feeds Valhalla tiles and a compact PostGIS `curvy_segments` table; nightly `pg_dump` → object storage provides backups the free tier lacks.

Every arrow in that topology was checked against the relevant vendor doc and holds. The architecture's *risk* is concentrated not in any single dependency but in four measurements (tile RAM, egress, AI latency/cost, loop quality) — appropriate for a system whose hard part is the route quality, not the plumbing.

---

## 4. Dependency matrix

Status legend: **V** = verified & safe · **VL** = verified with limitations · **SP** = requires a spike · **FB** = requires a fallback plan · **X** = incorrect/unsuitable · **BD** = blocked by a decision. Costs are planning estimates at small scale; confirm live.

| Dependency | Purpose | Version / tier | Verification source (18 Jun 2026) | Verified capability | Limitation | Cost | Risk | Fallback | Status |
|---|---|---|---|---|---|---|---|---|---|
| Anthropic API | Runtime planner inference | Haiku 4.5 `claude-haiku-4-5-20251001`; Sonnet 4.6 `claude-sonnet-4-6` | anthropic.com pricing + model pages + Haiku 4.5 launch post | Tool use, structured output, streaming, prompt caching (90% off prefix), batch (50% off); Haiku $1/$5·200K, Sonnet $3/$15·1M (max out 128K) | Pay-as-you-go, **not** in Claude.ai/Max; nondeterministic outputs | ≤ $30/mo (capped) + dev/eval | Med (cost spikes on eval/abuse) | Cap + kill switch; model downgrade; queue | **V** |
| `@rnmapbox/maps` | Map rendering in RN | **11.20.1** (native SDK v11) | rnmapbox docs + npm + GitHub | Vector tiles, custom Studio style, clustering, line layers/gradients, camera/fit-bounds; config-plugin install | **Cannot run in Expo Go**; needs custom dev build; native change ⇒ rebuild | $0 (lib) | Low | maplibre-react-native (OSS) | **V** |
| Mapbox (Maps SDK + Geocoding + Studio) | Tiles, style, geocode | Pay-as-you-go free tier | mapbox.com/pricing + docs | Generous **Maps-SDK mobile MAU** free tier; hillshade/terrain; geocoding (cacheable per terms) | **No hard spend cap (alerts only)**; **Nav SDK** free tier tiny — must avoid | $0 at ≤ target MAU | Med (no hard cap) | MAU alert; MapLibre + self-host tiles | **VL** |
| Supabase (Postgres/PostGIS/Auth/Storage/RLS) | Data + auth + files | Free (→ Pro $25) | supabase.com/pricing + docs | PostGIS, RPC, `SECURITY DEFINER`, RLS+spatial, GiST/trigram, signed URLs, account deletion | 500 MB DB / **5 GB egress** / 1 GB storage / 50K MAU / 2 proj / **no backups** / **7-day pause** / 200 conns; new-project Data-API grants | $0 (→ $25) | Med (egress/pause/backups) | Pro $25; keep-alive cron; pg_dump→R2 | **VL** |
| Valhalla | Routing engine | Current master (Docker) | valhalla.github.io API ref + CHANGELOG | Ordered-waypoint route, shape, maneuvers, `trace_route` map-match, isochrone, elevation, costing, **hard exclusions** (`allow_hard_exclusions`) + soft penalties, `optimized_route` TSP, `exclude_locations/polygons` | **No native "twisty loop"** primitive; can't guarantee public-only/closures; TSP needs ≥4 pts | $0 (self-host) | Med (tile RAM; loop quality) | Stadia/hosted Valhalla | **V** |
| Small VPS (Hetzner-class) | Host Valhalla + backend | CX32 (4 vCPU/8 GB) baseline | hetzner.com + docs (price adj. 15 Jun 2026) | Docker Compose; 20 TB traffic incl.; predictable fixed price | Self-managed; tile RAM must fit | ~$7–18/mo | Med (RAM fit) | Size up (CX42); hosted Valhalla | **V/SP** |
| Expo / EAS | Build + OTA | **SDK 55 / RN 0.83** | docs.expo.dev + changelog | Dev build, EAS Build/Submit/Update/Workflows, deep links | **SDK 55 = New Arch only**; OTA = JS-only | $0 (free tier) | Low | SDK 54 (legacy arch) if a dep lags | **V** |
| Apple Maps hand-off | External nav (A→B) | iOS URL scheme | Apple *Map Links* + iOS 18.4 unified-URLs note | `saddr`/`daddr` + `dirflg` open Maps | **No documented waypoints**; schema changed iOS 18.4 | $0 | Low | In-app follow-mode (primary) | **VL** |
| Google Maps hand-off | External nav (multi-stop) | `dir/?api=1` URL | Google *Maps URLs* docs | origin/destination + **capped** `waypoints` | ~3 waypoints mobile, may be ignored; 2,048-char URL | $0 | Low | In-app follow-mode (primary) | **VL** |
| sharp | Server-side image processing | current (libvips) | sharp docs (standard practice) | EXIF/GPS dropped on re-encode by default; resize/thumbnail; format convert | Must validate MIME by magic bytes, not client | $0 | Low | jimp; Supabase image transform | **V** |
| OSM (Geofabrik) | Map data | Ontario extract | geofabrik.de + osmium/osm2pgsql docs | `.poly` clip, tag filter; ODbL | ODbL attribution + share-alike on derived DB | $0 | Low | Other extract mirrors | **V** |
| Sentry / Cloudflare R2 / cron | Observability / backups / schedule | free tiers / pg_cron | provider docs | Crash reporting; cheap object storage; pg_cron + pg_net or GH Actions | Verify free-tier headroom at integration | ~$0–1/mo | Low | Self-hosted equivalents | **V** |

---

## 5. Version-compatibility matrix

| Component | Pin / target (Jun 2026) | Compatibility notes |
|---|---|---|
| Expo SDK | **55** | Current; **New Architecture mandatory** (legacy removed after SDK 54). New projects start here. |
| React Native | **0.83** | Ships with SDK 55 (React 19.x; Hermes; New Arch). SDK 54 = RN 0.81 = last legacy-arch release if a dependency forces it. |
| `@rnmapbox/maps` | **11.20.1** (native Mapbox Maps SDK **v11**) | v10 deprecated. v11 supports the New Architecture — **confirm in SPK-01**. Set `RNMapboxMapsVersion` explicitly in the config plugin. |
| expo-location / expo-task-manager / expo-keep-awake | SDK-55-matched | Foreground location + wake-lock; confirm New-Arch compat (Expo modules are New-Arch by default). |
| expo-image-picker | SDK-55-matched | Spot photos. |
| Anthropic models | Haiku `claude-haiku-4-5-20251001`; Sonnet `claude-sonnet-4-6` | Both current & GA. Haiku context 200K; Sonnet 1M (128K max output). Use dated Haiku string for reproducibility; alias `claude-sonnet-4-6` acceptable. |
| Anthropic SDK (TS) | `@anthropic-ai/sdk` latest | Streaming + tool use + prompt caching supported. |
| Valhalla | current master (Docker image) | Hard-exclusion params + `optimized_route` + isochrone confirmed present. Pin a tagged image; rebuild tiles on data refresh. |
| Postgres / PostGIS | Supabase-managed (PG 15+/PostGIS 3.x) | PostGIS, `SECURITY DEFINER`, GiST, `pg_trgm`, `pg_cron`/`pg_net` available. |
| Node | 20 LTS+ | Fastify + Anthropic SDK + sharp (libvips) all fine. |

**Action:** the spec does not pin an Expo SDK; pin **SDK 55 / RN 0.83** and run SPK-01 to confirm every native dependency builds under the New Architecture before committing the mobile foundation.

---

## 6. Invalid or outdated assumptions

Verification found **no fatal/invalid assumptions**. The following are minor corrections or sharpenings:

1. **(Outdated risk, now moot) Mapbox download token.** Older rnmapbox docs required a secret `RNMapboxMapsDownloadToken` (DOWNLOADS:READ). The current install flow for v11 does not center on it; the spec's note that the deprecated download token "is no longer required for the SDK" is **broadly correct** but version-sensitive — confirm at integration (some setups still set it).
2. **(Sharpening) Apple Maps URL schema.** The spec correctly says Apple Maps takes only origin/destination. As of **iOS 18.4** Apple shipped a new **"unified Maps URLs"** schema and the legacy `daddr=lat,lng` form regressed. Not invalid — but hand-off code must target the **current** schema and be device-tested.
3. **(Sharpening) Supabase grants timing.** The spec dates the Data-API grants change generically. Verified specifics: **new projects created after 30 May 2026** must add explicit Postgres grants for PostgREST; existing free projects are affected **30 Oct 2026**. Roadopia's projects are new ⇒ **affected immediately** (a day-one setup step, not a future date).
4. **(Sharpening) Expo SDK version.** "React Native + Expo" understates a real constraint: **SDK 55 is New-Architecture-only**. This is an integration prerequisite, not a free choice.
5. **(Sharpening) "Public-roads-only routing" (spec §59).** Verified that Valhalla routes the OSM network *as tagged* and honors access/conditional tags where present, but cannot guarantee exclusion of untagged private roads or knowledge of most closures/seasonal restrictions. The claim should be reworded to **"strongly biases toward legal public roads but does not guarantee it"** (see §8, §11, §18).
6. **(Clarification) "$30/mo hard cap."** A true hard cap is achieved by **app-side accounting + a vendor-side backstop** (prepaid credits / Anthropic workspace spend limit), not by a single API setting. The spec's mechanism is right; the wording should acknowledge it is belt-and-braces (§16).

Everything else in the spec's fact base (model IDs/pricing, rnmapbox-not-in-Expo-Go, Supabase 500 MB/5 GB/7-day-pause/no-backups, Valhalla capabilities, Geofabrik ~888 MB, Railway-vs-VPS economics, Apple no-waypoints / Google capped-waypoints) **verified true**.

---

## 7. Verified limitations

Real constraints to design around (each confirmed against primary sources):

- **Mapbox: no hard spend cap.** Only usage alerts exist; runaway cost is the customer's risk. *Mitigation:* MAU alert at a fraction of the free tier; the Maps-SDK MAU free tier makes overage unlikely at ≤ 500 users, but the alert is mandatory.
- **Mapbox Navigation SDK ≠ Maps SDK pricing.** The Nav SDK's free tier is tiny; Roadopia must stay on the **Maps SDK** and implement follow-mode itself (it already does).
- **Supabase free tier:** 500 MB DB, **5 GB egress (binding limit)**, 1 GB storage, 50K MAU, 2 projects, **no managed backups**, **7-day inactivity pause**, 200 connections, 7-day log retention; ≥20%-of-limit email warnings then read-only/blocked after a one-time grace period. *Mitigations:* simplified geometry + CDN headers for egress; keep-alive cron for the pause; `pg_dump`→R2 for backups; PgBouncer pooling for connections.
- **Supabase Storage:** deleting a DB row does **not** delete the storage object — explicit cleanup (trigger/edge function/app logic) is required so removed/forked/deleted photos don't orphan in the bucket and consume storage.
- **Valhalla:** no native loop or "scenic/twisty" routing (Roadopia's heuristics own it); hard exclusions are **ignored-with-warning** unless `allow_hard_exclusions` is enabled in config, and when enabled can return **no route**; cannot guarantee public-only routing or know live/most-seasonal closures; `optimized_route` needs **≥4 locations**.
- **Apple Maps hand-off:** origin/destination only, no waypoints, evolving schema (iOS 18.4) → a scenic loop cannot be faithfully handed off.
- **Google Maps hand-off:** waypoints capped (~3 mobile, may be ignored), 2,048-char URL → only a decimated representation.
- **Expo:** `@rnmapbox/maps` forces a dev build (no Expo Go); EAS Update is **JS-only** (native changes need a rebuild); SDK 55 is New-Arch-only.
- **Foreground recording:** iOS location tasks don't run after app termination; Android background-location needs store review — hence foreground-only is the correct, lower-friction design (and a real accuracy/battery trade-off with the screen on).
- **Anthropic:** outputs are nondeterministic (eval must tolerate it); API spend is usage-based and must be capped app-side + backstopped.

None of these is a blocker; all are already reflected (or now recommended for reflection) in the spec.

---

## 8. Required changes to Roadopia v2

Verification implies the following edits. **None are architectural**; they are precision and one or two day-one setup steps. (M = should-do before/at integration; minor = wording.)

1. **[M] Pin the mobile stack and add a New-Arch gate.** Record **Expo SDK 55 / RN 0.83 / `@rnmapbox/maps` 11.20.1** in §20/§91 and make "all native deps build + run under the New Architecture" an explicit exit criterion of the dev-build spike (SPK-01).
2. **[M] Add the Mapbox-Nav-SDK prohibition to the agent rules.** §77 should explicitly forbid pulling in the Mapbox Navigation SDK (or rnmapbox nav extensions); follow-mode is built from Valhalla maneuvers. This is a cost guardrail, not just a design one.
3. **[M] State the Supabase day-one setup steps.** §73 should call out: (a) add explicit PostgREST/Data-API **grants** on every table for new projects; (b) implement **Storage-object cleanup** on photo delete/fork/account-deletion (the `photos` row cascade does not remove the blob).
4. **[M] Make the Mapbox MAU alert a named requirement.** §66 already implies it; promote to an explicit NFR/observability item, paired with the statement that Mapbox has **no hard cap** (contrast with the AI cap).
5. **[M] Clarify the cap mechanism.** §38/§65: "$30 hard cap" = app-side accounting **+** prepaid credits / Anthropic workspace spend limit as the true backstop, **+** the kill switch.
6. **[minor] Soften the public-roads claim.** §59: "Roadopia strongly biases toward legal public roads via costing + data scope but cannot guarantee it; the safe-driving disclaimer and user judgment remain necessary." (Honesty pillar — strengthens, not weakens, the spec.)
7. **[minor] Note the Apple unified-Maps-URL schema (iOS 18.4)** in §24 and the hand-off spike (SPK-17): target the current schema; device-test.
8. **[minor] Record the Valhalla hard-exclusion implementation detail** in §28/§45: the server **warns-and-ignores** excludes unless `allow_hard_exclusions: true`; therefore the app must (a) enable the flag, (b) **still scan results** for road class, and (c) catch the **no-route** error to trigger the soft-avoidance fallback. Also note `exclude_locations`/`exclude_polygons` as the clean mechanism for "avoid that town" refinement (an under-used capability).
9. **[minor] Add `optimize_waypoint_order` ≥4-location guard** in §50 (below 4 points, order deterministically).
10. **[minor] Budget eval cost separately** (§65/§39): eval traffic on every CI push can exceed user traffic; gate eval frequency, use the **Batch API (50% off)** + caching, and exclude eval spend from the user-facing cap accounting (track it as its own line).

All ten are cheap to apply and several should land before the first packet.

---

## 9. Hosting & resource analysis

The colocated **Fastify + Valhalla** stack on one small VPS is appropriate and verified as economical.

- **CPU.** Fastify is light. Valhalla routing/isochrone queries over a *regional* tile set are not CPU-bound at portfolio concurrency; the CPU spike is the **one-time tile build** (`valhalla_build_tiles`), which is parallel and benefits from cores but runs offline. **2–4 vCPU** suffices for serving; tile builds are faster on 4.
- **RAM (the binding resource).** Valhalla memory-maps its tiles; resident memory tracks the working set, not the full graph, but headroom matters for latency. A **road-class-filtered Western-GH/Niagara extract** should produce tiles well under ~1 GB (hypothesis — **measure in SPK-04**). Budget: tiles + OS + Fastify + Node + Caddy. **4 GB is plausibly enough but tight; 8 GB is the safe baseline.**
- **Storage.** OSM extract (clipped, hundreds of MB pre-filter), Valhalla tiles (sub-GB expected), Docker images, logs → **40–80 GB NVMe** is ample.
- **Startup / tile build.** Container start is seconds; **tile build is the long pole** (tens of minutes for a region on a small box — measure). Build tiles in a job and ship the tile directory as a persistent volume; do **not** rebuild on every deploy.
- **Persistence.** Tiles + Valhalla config on a persistent volume; backend is stateless. Server-side config (Compose files, Caddyfile, costing profile, env templates) lives in the repo (`infra/`), so the only non-repo artifact to protect is the **tile directory** — which is reproducible from the pipeline (so "backup" = keep the pipeline + the `.poly`, optionally snapshot the volume).
- **Bandwidth.** Hetzner includes **20 TB** traffic/instance — a non-issue. (App↔Supabase egress is the cost to watch, not VPS egress.)
- **One stack vs split.** For ≤ 500 users, **one Docker Compose stack** (valhalla + agent-api + caddy) on one VPS is simplest and cheapest, with localhost calls between backend and Valhalla. Split only if routing concurrency or independent scaling later demands it (the backend is stateless and can be replicated; Valhalla can move to its own box).
- **Monitoring/restart.** Docker `restart: unless-stopped` + container healthchecks + an uptime ping + Sentry; this matches the spec.
- **Security hardening (public VPS).** SSH keys only (no password), firewall to 80/443 (+ SSH), Caddy auto-TLS, Valhalla **not** exposed publicly (only the backend is; Valhalla bound to localhost/Compose network), unattended-upgrades, Fail2ban, non-root containers, secrets via env file with locked perms. (Add to §57/§73 as the VPS hardening checklist.)

## 10. VPS recommendation

**Recommended: Hetzner Cloud CX32 (4 vCPU / 8 GB / 80 GB NVMe, 20 TB traffic) as the baseline**, ~€6.80/mo (≈ $7–8) — verified pricing (Hetzner, price adjustment effective 15 Jun 2026; confirm live figure).

- **Why CX32 over CX22 (4 GB).** CX22 (~€3.79/€4.35) *may* hold a small region's tiles, but 4 GB leaves little headroom once OS + Node + Valhalla + Caddy are resident; the €3 delta to 8 GB buys comfort and removes a likely source of latency/OOM surprises. Start at CX32; SPK-04 may show CX22 is fine (then downsize) or that **CX42** (8 vCPU / 16 GB, ~€16.40) is warranted for bigger tiles / faster builds.
- **Provider choice.** Hetzner gives the best price/performance and predictable fixed pricing with generous traffic; it is the right default. **DigitalOcean/Vultr/Lightsail** are pricier for equivalent specs but offer more regions/hand-holding — acceptable alternatives if the builder prefers their UX. **Fly.io** is convenient but its usage-based model re-introduces the Railway-style unpredictability the spec deliberately avoided for an always-on engine. **AWS Lightsail's $5/1 GB** bundle is too little RAM for Valhalla — avoid.
- **Region.** Choose an EU or US-East Hetzner location; latency to a Canadian user base is fine for non-real-time route generation (tens of ms added; generation is seconds-scale anyway).
- **Hosted Valhalla as emergency fallback.** **Confirmed practical**: Stadia Maps (and other hosts) run standard Valhalla and expose the same `/route`, `/isochrone`, `/trace_route`, `/optimized_route` API surface this review verified — so the backend can fail over by swapping a base URL + key, with minimal code change. Keep it as the documented break-glass (cost/latency differ; fine for an outage).

**Net:** the spec's "small always-on VPS, ~$10–22/mo total" is **validated and slightly conservative** — the VPS line alone is ~$7–18/mo depending on size, leaving the rest of the envelope for domain + (optional) Supabase Pro + backups.

## 11. Valhalla deployment analysis

Every Valhalla capability the spec relies on was verified against the official API reference and CHANGELOG:

- **Routing through ordered waypoints, route shape, maneuvers** — `/route` (Odin maneuvers, encoded shape). **Verified.**
- **Map matching / trace route** — `/trace_route` + `/trace_attributes` (Meili), `shape_match` modes. **Verified** (powers record-a-drive).
- **Isochrones** — `/isochrone`, GeoJSON line/polygon contours (also GeoTIFF). **Verified** (powers candidate-search scoping).
- **Elevation** — Skadi `/height` + elevation along routes. **Verified** (powers the profile + climb).
- **Costing profiles + soft avoidance** — `auto` costing with **penalties/factors** (`use_highways`, `use_tolls`, etc.) for soft avoidance. **Verified.**
- **Hard exclusions** — `exclude_highways`, `exclude_tolls`, `exclude_ferries` (also `exclude_bridges`/`exclude_tunnels`), **gated by `service_limits.allow_hard_exclusions: true`**. **Critical verified behaviour:** if the flag is **not** enabled, the server returns a **warning and ignores** the excludes (you may silently get a highway route); if it **is** enabled and no compliant route exists, it can return **no route / error**. ⇒ the app must enable the flag, **still scan the result** for road class, and **catch the no-route error** to fall back to soft avoidance with disclosure (exactly the spec's three-tier model — the implementation detail belongs in §28/§45).
- **`exclude_locations` / `exclude_polygons`** — exclude specific roads/areas. **Verified** — a clean mechanism for "avoid that town" conversational refinement (currently under-used by the spec).
- **Optimized route (TSP)** — `/optimized_route`, auto/bike/ped, **≥4 locations**, return-to-origin or distinct end. **Verified** (powers A→B multi-stop ordering).
- **Road-class metadata** — available via `trace_attributes`/edge info and route flags (`has_highway`, etc.). **Verified** (powers curvature segmentation + result scanning).
- **Canadian OSM + Docker + tile building** — standard `osmium`/`valhalla_build_tiles` over a Geofabrik Ontario extract; official Docker images. **Verified.**
- **Incremental updates** — Valhalla has **no live incremental graph update**; the practical model is **periodic full (regional) tile rebuilds** from a fresh extract. **Verified** — matches the spec's "re-run the pipeline" stance; stale roads/POIs are handled by rebuild cadence, not real-time.

**What v2 does NOT incorrectly assume:** the spec never claims Valhalla provides loops or scenic/twisty routing — and it doesn't. Valhalla yields cost-optimal routing + the primitives above; **Roadopia's candidate-generation heuristics (isochrone scope + directional sectors + curvy-waypoint selection + TSP ordering + overlap diversification) do the work Valhalla lacks.** This is correctly owned in §29 and is the single biggest *quality* risk (hence SPK-15).

**Limitations to keep honest (feed §18/§59):** Valhalla routes the OSM network as tagged; it honors access/`access:conditional` tags where present but **cannot guarantee public-only routing, cannot know most closures/seasonal restrictions, and reflects the extract's vintage.** Public-road bias is strong but not a guarantee.

## 12. Cost analysis

All inputs verified (18 Jun 2026). Figures are planning estimates; confirm live.

**Per-generation runtime-AI cost (recomputed from verified rates).** Haiku $1/MTok in, $5/MTok out; Sonnet $3/$15; cached prefix ~90% off; eval via Batch 50% off.

A typical generation:
- **Parse** (Haiku): ~1–2K input (cached system+tools prefix ≈ free on hit) + ~200 output → fractions of a cent.
- **Select + self-correct** (1–3 turns; Haiku for correct, Sonnet for the final select): small structured outputs; the Sonnet select turn dominates → ~0.3–1.0¢.
- **Explanation** (Sonnet, ~150–250 out): ~0.3–0.5¢.
- **Amplifiers** (auto-title/summary/tags, Haiku): ~0.1–0.3¢.

**⇒ p50 ≈ 1–3¢/generation** with caching — the spec's estimate **verified as realistic**. **Worst case** (cache miss + max iterations + Sonnet-heavy + a retry on a malformed output) ≈ **5–10¢**. At the **$30 cap**, that is **~300 (worst-case) to ~3,000 (typical) generations/month** — ample for ≤ 500 users plus refinement, since most users run a handful of plans. *Refinement* re-runs the loop, so count each refinement as ~1 generation in budgeting.

**The sneaky cost is eval + dev traffic, not users.** 40–60 gold briefs × several iterations, run on **every CI push**, can dwarf user spend. *Mitigations (adopt):* run the full eval set on merges-to-main + nightly (not every push; a smaller smoke subset per push), use the **Batch API (50% off)** + prompt caching for eval, and **track eval/dev spend as a separate line** outside the $30 user-facing cap. With Batch + caching, a full 50-brief eval run is on the order of low tens of cents to ~$1 — cheap if not run hundreds of times/day.

**Total monthly cost by tier (verified inputs):**

| Tier | VPS (Hetzner) | Supabase | Mapbox | Anthropic (runtime) | Backups/misc | **Total/mo** |
|---|---|---|---|---|---|---|
| Dev / spikes | CX32 ~$7–8 | $0 | $0 | ~$5–15 (eval+dev) | R2 ~$0 | **~$12–23** |
| Personal / ≤50 users | CX32 ~$7–8 | $0 (watch egress) | $0 | ~$1–10 (capped) | ~$0 | **~$8–18** |
| ≤500 users (public demo) | CX32 ~$7–8 (or CX42 ~$18) | $0 or **Pro $25** (egress/pause/backups) | $0 (Maps-SDK MAU free) | ≤ $30 (hard cap) | R2 ~$1 | **~$8–55** |
| 5,000 users | CX42 ~$18 | Pro $25+ usage | possibly paid (watch MAU) | ≤ $30 (cap; degrade) | + monitoring | **~$70–150+** |
| Viral spike | scale/queue | grace→upgrade | **alert (no hard cap)** | **cap + kill switch hold** | — | **bounded by caps** |

**Verdict on the $10–22 target:** **achievable** for personal/≤50-user operation on the free Supabase tier. For the **public-demo project specifically**, strongly consider **Supabase Pro ($25)** from the start — the 7-day pause, absent backups, and egress ceiling are real demo-killers, and $25 is within budget; this pushes the demo tier to ~$33–55/mo, still modest. (See §22 — this is the one cost decision worth making up front.)

## 13. Licensing & attribution analysis

**Legal facts (verified against the licenses/terms):**
- **OpenStreetMap data is licensed ODbL 1.0.** Using it requires (a) **attribution** — "© OpenStreetMap contributors" visibly — and (b) **share-alike on the *derived database***: if Roadopia publicly distributes a derived *database* (e.g., the curvature DB or extract), that database must be offered under ODbL. **Produced *content* (an individual route image/description shown to a user) is "Produced Work" and is not itself forced open.** Roadopia displaying routes/maps = Produced Work + attribution; this is fine. *If* Roadopia ever publishes the `curvy_segments` dataset or tiles for download, that distribution carries ODbL obligations. (Engineering implication: keep the derived DB internal, or be ready to ODbL-license it if shared.)
- **Mapbox terms** require the Mapbox wordmark + attribution and the "Improve this map" / OSM attribution to remain visible; do not remove or obscure. Caching/storing **geocoding results** is permitted within Mapbox's terms for your app's use — confirm the current terms clause at integration, but standard caching of place→coordinate results is allowed.
- **Combining OSM-derived routing with user-generated content** is fine: UGC (spots, photos, notes, recorded routes) is Roadopia's/its users' content, stored alongside OSM-derived data; ODbL share-alike attaches to the *OSM-derived database*, not to user content or to the app. OSM-seeded café/viewpoint/fuel POIs are OSM-derived data and may be stored/displayed with attribution (and re-derived on refresh).
- **Valhalla** is open source under a permissive license (MIT-style); self-hosting/modifying is unrestricted with license retention.

**Engineering assumptions (not legal advice):** keep OSM-seeded POIs marked `source='osm'` and refreshable; show attribution on every map/route surface; don't ship the derived database publicly unless intentionally ODbL-licensing it. The spec's §61 is **correct**; the one addition is the explicit **derived-database share-alike** caveat above (relevant only if Roadopia ever distributes the dataset/tiles).

## 14. Mobile-platform limitations

Confirmed and design-relevant:

- **Dev build mandatory.** `@rnmapbox/maps` "cannot be used in the Expo Go app" (vendor-verified) → a custom dev build is required from the first map screen. EAS Build (cloud) or local prebuild.
- **New Architecture mandatory (SDK 55).** Legacy arch removed after SDK 54. All native deps must be New-Arch-compatible; rnmapbox v11 is — **confirm in SPK-01** (the chief residual mobile risk).
- **OTA scope.** EAS Update ships **JS/asset** changes only; any native change (Mapbox/location version bumps, new native module) requires a **store/dev rebuild**. Plan releases accordingly.
- **SSE/streaming on device.** RN's `fetch` does not expose a streaming body uniformly; reliable SSE on RN typically uses a library (e.g., an EventSource polyfill or `react-native-sse`) or a fetch-stream shim. **Treat streaming as a verified-with-care item — confirm on a real device (SPK-03)**, including reconnection and that the generation-progress timeline renders incrementally.
- **Request cancellation.** Use `AbortController` to cancel an in-flight `/plan` when the user navigates away/refines; ensure the backend also halts the loop + stops token spend on disconnect (cost + correctness). Verify on device.
- **App lifecycle during generation.** Backgrounding the app mid-generation (a call, a notification) can suspend JS; the SSE may drop. Design: server continues to completion and the result is fetchable on resume, or the client cleanly cancels + offers retry. (Matches the spec's graceful-degradation intent; make it explicit for `/plan`.)
- **Tokens.** Mapbox **public** token ships in the build (acceptable; it is URL-restrictable and rotatable); the Mapbox **secret** token (Studio uploads/downloads), the Anthropic key, and the Supabase **service** key stay **server-side only**. The app holds only the Supabase **anon** key + Mapbox public token. **Verified-correct** per the spec; restrict the public token by bundle ID / allowed URLs in the Mapbox dashboard.
- **Foreground GPS.** `expo-location` foreground + `expo-keep-awake`; permission strings per §20.3. iOS location does not run after app termination; Android background-location needs review — both reasons the foreground-only design is correct. Battery drain (screen on + GPS) is the honest trade-off; map-matching the trace via Valhalla `/trace_route` is feasible (verified).

## 15. App-distribution implications

Distinct requirement sets, verified against current Apple/Google policy norms (confirm exact wording at submission):

- **Private portfolio link / dev build:** an **EAS dev build** installed on the developer's own device(s). No store review; fastest path for the demo. Suitable for the hero video + live demonstration. No store policy obligations beyond honoring third-party terms (OSM/Mapbox attribution).
- **Internal testing:** **TestFlight (iOS, up to 100 internal / 10k external testers)** and **Google Play internal testing track**. Light review (TestFlight external needs a basic review). Good for sharing with a few enthusiast testers. Requires the **paid developer accounts** ([HUMAN]: Apple $99/yr, Google $25 once).
- **Public App Store / Google Play:** full review. Triggers the **hard requirements**: in-app **account + data deletion** (both stores), accurate **privacy labels / Data Safety** (declare **foreground** location + photos + account data; **declare no background location** because Roadopia doesn't use it), permission **rationale strings**, a **moderation** path for UGC (report→review→remove, plus user **blocking** is commonly expected once there's user-to-user content — add a block capability for store builds even though the MVP floor is report→remove), a **privacy policy** + **EULA/ToS**, **safe-driving** framing (no speed/racing — Apple/Google both scrutinize driving apps), and **OSM + Mapbox attribution**. Photo **EXIF/GPS stripping** supports the privacy posture.

**Implication for the plan:** the spec's P6 (store readiness) correctly separates from the MVP, and the MVP's moderation + EXIF + foreground-only + account-deletion floor is exactly what makes the **pre-store public link** safe. The one addition for *public store* builds: a **user-blocking** capability (not just content removal), which app-review commonly expects for UGC apps — fold into §60/§72 as a P6 item.

## 16. Runtime AI verification

Verified against Anthropic's current model pages, pricing, and docs (18 Jun 2026):

- **Models exist under the stated identifiers.** **Haiku 4.5** (`claude-haiku-4-5-20251001`, $1/$5, 200K context) and **Sonnet 4.6** (`claude-sonnet-4-6`, $3/$15, **1M** context, 128K max output) are current, GA, and priced as the spec states. (Opus 4.8 is the current flagship at $5/$25 — not needed by Roadopia; staying Haiku+Sonnet is the right cost call.)
- **Tool use, structured output, streaming, prompt caching** — all supported; the system-prompt + tool-schema **prefix is the cache target** (~90% off cached input). **Batch API** (50% off) for offline eval. **Node/TS SDK** (`@anthropic-ai/sdk`) supports streaming + tool use + caching.
- **Subscriptions ≠ API.** Verified explicitly: the API is usage-based with **no monthly subscription**, and **Claude.ai Pro/Max do not include API access**. The spec's build-time (Max) vs runtime (API) separation is **correct and important**.
- **Rate/token limits + retries.** The API enforces per-model/tier rate limits (RPM/TPM) and returns 429/overloaded with `retry-after`; standard guidance is exponential backoff + jitter and idempotent retries. Build this into the agent loop (it already plans bounded retries on malformed output; add transport-level backoff).
- **Spend cap — mechanism.** A true cap = **app-side accounting** (sum `token_cost_usd` per period; disable/limit at thresholds) **+ a vendor backstop**: Anthropic supports **prepaid credits** (spend can't exceed the balance) and **workspace/organization spend limits**. Use both, plus the **kill switch**. This makes "$30 hard cap" real, not aspirational. **Verified feasible.**
- **Cost estimates realistic.** See §12: p50 ~1–3¢/gen, worst case ~5–10¢, eval/dev budgeted separately. The spec's numbers hold.
- **Nondeterminism.** Outputs vary run-to-run; the eval harness must tolerate it (assert on *constraint satisfaction vs gold*, not on exact text/route equality) — the spec's gold-label design already does this; make "tolerate nondeterminism" an explicit eval principle (§20).

**Recomputed full-pipeline cost coverage** (parse, candidate selection, self-correction, explanation, conversational refinement, auto-title/summary/tags, invalid-output retries, cache misses, eval traffic, dev traffic): all fit within the capped envelope **provided** eval/dev spend is tracked separately and eval runs are gated + batched (§12). **Status: V.**

## 17. External navigation hand-off verification

Verified against Apple's *Map Links* reference, the iOS 18.4 unified-Maps-URLs note, and Google's *Maps URLs* docs:

| Capability | Apple Maps (URL) | Google Maps (URL) |
|---|---|---|
| Destination only | ✅ `daddr` (current location as origin) | ✅ `destination` |
| Origin + destination | ✅ `saddr` + `daddr` | ✅ `origin` + `destination` |
| Multiple stops / ordered waypoints | ❌ **not in the documented URL scheme** | ⚠️ `waypoints` **capped** (~3 mobile, may be ignored) |
| Complete custom route geometry | ❌ | ❌ (no geometry param; it re-routes) |
| Scenic **loop** | ❌ **cannot be faithfully represented** | ⚠️ only a **decimated** approximation, within the 2,048-char URL limit |
| GPX file | ❌ (not via URL) | ❌ (not via URL) |
| Deep links / universal links | ✅ (`maps.apple.com` universal links; `maps://`) | ✅ (`comgooglemaps://` + universal links) |

**The spec's redesigned position is accurate and verified:**
- In-app **follow-mode is correctly the primary** navigation experience (Roadopia owns the geometry + Valhalla maneuvers).
- **Apple Maps cannot faithfully receive a custom scenic loop** through URL parameters (no waypoints; single origin→destination only).
- **Google Maps can receive only a limited waypoint representation** (capped, possibly ignored).
- **Hand-off must be best-effort** — destination-only (A→B), leg-by-leg to the next waypoint/spot (works in both), or a decimated Google waypoint set within limits; never a faithful loop in Apple Maps.

**Added caveat:** target Apple's **current unified Maps URL schema** (post-iOS-18.4) and device-test, since the older `daddr=lat,lng` form regressed (SPK-17). **Status: VL — verified, redesign correct.**

---

## 18. OSM & geospatial-data verification

**Pipeline + licensing (verified):**
- **Extract provider:** **Geofabrik** publishes an Ontario `.osm.pbf` (full Ontario ≈ **888 MB** — verified order of magnitude); the Western-GH/Niagara corridor is a sub-region of it. BBBike is an alternative for custom bounding boxes. **Status: V.**
- **Region config:** clip with **`osmium extract --polygon REGION_POLY_PATH`** to a `.poly`/GeoJSON, driven by `REGION_ID`/`REGION_POLY_PATH`. Standard, verified.
- **Road-class + POI filtering:** **`osmium tags-filter`** to keep scenic-relevant highway classes (primary/secondary/tertiary/unclassified/residential through-roads) and to extract café/viewpoint/fuel POIs (`amenity=cafe`, `tourism=viewpoint`, `amenity=fuel`). Standard, verified.
- **Data for Valhalla vs curvature:** Valhalla consumes the filtered `.pbf` to build tiles; the **curvature table** is computed from way geometries (see §7 below). Two consumers, one extract.
- **`osm2pgsql` vs `osmium`:** **`osmium`** for clip/filter/format; **`osm2pgsql`** (or a custom loader) only if loading the road network into PostGIS for curvature precompute — note **`osm2pgsql` wants ≥2 GB RAM + SSD** (verified), so run the pipeline on the dev machine or the VPS, **not** the Supabase box. Verified.
- **Licensing (legal facts):** **ODbL** — attribution ("© OpenStreetMap contributors") + **share-alike on a publicly distributed derived database**. Displaying routes/maps is **Produced Work** (fine + attribution). OSM-seeded POIs are OSM-derived data (store with attribution, refreshable). UGC may be combined freely. Only **publishing the derived dataset/tiles** triggers ODbL distribution obligations. **Verified; see §13.**

**Update / staleness strategy (verified + honest):** Valhalla has **no live incremental update** — refresh = **periodic full regional rebuild** from a new extract; re-derive curvature + re-seed POIs on the same cadence. Stale POIs/roads are therefore bounded by rebuild frequency, not real-time. The app cannot know live or most seasonal closures; the safe-driving disclaimer + "best-effort, data may be out of date" framing is the honest posture (feed §59). **Status: V (engineering) / V (legal).**

## 19. Supabase & RLS verification

Verified against Supabase docs/pricing (18 Jun 2026):

- **Postgres + PostGIS, RPC, RLS, GiST, trigram (`pg_trgm`), signed URLs, account deletion** — all supported. **`SECURITY DEFINER`** functions are supported and are the correct mechanism for the **least-privilege planner read path** (a definer function owned by a role that can read only public/OSM rows; the anonymous caller invokes it and cannot reach private data). **RLS coexists with spatial queries** (policies are predicates; spatial functions run within them). **Direct client CRUD under RLS** is the intended Supabase pattern. **Status: V.**
- **Data model practicality.** The v2 schema is **RLS- and FK-friendly**: per-target favourite tables (`route_favourites`/`spot_favourites`) carry real FKs + cascade (the spec's fix for the polymorphic-likes problem is correct and necessary); `reports`/`moderation_actions` remaining polymorphic is acceptable (no cascade dependency); `ai_generation_requests` with nullable `user_id` supports anonymous logging; the **public eval page** reads **non-identifying aggregates** via a dedicated read path (a `SECURITY DEFINER` aggregate function or a view exposing only counts/percentiles — no briefs, no user IDs). **Status: V.**
- **Free-tier limits (verified):** 500 MB DB, **5 GB egress (binding)**, 1 GB storage, 50K MAU, 2 projects, **no backups**, **7-day inactivity pause**, 200 connections, 7-day logs; ≥20% warning emails, then read-only/blocked after a one-time grace. **Status: VL.**
- **Two day-one gotchas (verified):** (1) **new projects (after 30 May 2026) must add explicit Postgres grants** for the Data API/PostGREST — a setup step from day one; (2) **Storage objects are not auto-deleted** when a row is removed — add a trigger/edge-function/app cleanup so deleted/forked/account-deleted photos don't orphan in the bucket (storage + privacy). **Add both to §73/§56.**
- **Scheduled jobs:** **`pg_cron` + `pg_net`** are available in-DB (keep-alive ping, retention purge, orphan cleanup) — simpler than external cron; **GitHub Actions** is the verified path for the **`pg_dump` → Cloudflare R2** nightly backup (a documented zero-cost community pattern — matches §75). **Status: V.**
- **Backups (verified gap + fix):** the free tier has **no managed backups**; the spec's nightly `pg_dump`→R2 + quarterly restore drill is the correct mitigation; **Pro ($25)** adds managed daily backups + PITR when warranted. **Status: VL (gap real, mitigation verified).**

**Database-size estimate (engineering, for the 500 MB cap).** Dominated by route geometry and AI logs, not row counts:

| Data | Rough size driver | Estimate at small scale |
|---|---|---|
| Routes (precise + simplified geometry + bbox + metadata) | LineStrings dominate; simplified copy ~5–20% of precise | a few KB–tens of KB/route → low MB for thousands |
| Spots (Point + tags) | tiny | < 1 MB for thousands |
| Photos (rows only; blobs in Storage) | metadata only | negligible in DB; **blobs count against 1 GB Storage** |
| `ai_generation_requests` (brief + parsed + metrics jsonb) | ~1–5 KB/row | low MB for tens of thousands; **purge anon rows** (retention) |
| `curvy_segments` (regional, filtered) | geometry + scalar; **the support table to watch** | **measure (SPK-10)** — expected low-to-mid MB after road-class filter; could be larger pre-filter |
| reports / moderation | tiny | negligible |
| Eval fixtures | **in repo, not DB** | 0 in DB |

**Conclusion:** the DB comfortably fits 500 MB at small scale **if** `curvy_segments` is road-class-filtered and anon AI logs are purged; **egress (5 GB), not DB size, is the first wall** — mitigated by simplified geometry on map/list payloads + CDN cache headers + connection pooling. **SPK-09/10 measure both.** **Status: VL — practical, two measurements + two setup steps.**

## 20. Evaluation / CI feasibility verification

The spec's eval system is **practical and is the project's credibility centerpiece** — verification confirms each element is implementable, with cost + nondeterminism caveats:

- **Human-authored gold labels** (constraints per brief, independent of the model's parse) — feasible; live as **repo fixtures**. Enables the two non-circular headline numbers: **parse accuracy** (parsed vs gold) and **constraint-satisfaction-vs-gold** (route vs gold). **V.**
- **Programmatic per-result checks** (no-highway road-class scan, loop closure within ε, duration ±tolerance, stop presence, routable/connected/sane geometry, curviness ≥ threshold) — all computable deterministically from the route + tool data. **V.**
- **Candidate diversity** (pairwise `edge_overlap`, `self_overlap` out-and-back) — computable. **V.**
- **Latency p50/p90/p99 + timeout rate, cost/gen** — from logged generations. **V.**
- **Prompt-injection regression cases** (adversarial briefs + malicious spot-name content → expect rejected/relaxed, never an action/geography emission) — feasible as fixtures. **V.**
- **Public eval page** from **real** logged aggregates (not fabricated) — feasible via the non-identifying aggregate read path (§19). **V.**
- **CI gate** — run the set (or a smoke subset per push; full set on merge/nightly) and fail on regression below thresholds. **V — but see cost.**
- **Handling nondeterminism** — assert on constraint satisfaction vs gold (tolerant), not exact equality; report distributions; optionally average N runs for stability. **V.**
- **Handling external API failures in CI** — eval must distinguish a *model regression* from a *transient API/Valhalla outage* (retry/backoff; mark infra failures separately so they don't fail the quality gate spuriously). **Add this explicitly** — it's a real CI-reliability gap if unaddressed.
- **Eval cost controls** — **the key caveat:** gate full-eval frequency, use **Batch (50% off)** + prompt caching, track eval spend separately from the user cap (§12). **VL.**
- **Versioning** — version **prompts, model IDs, map-data/extract date, scoring config, and the eval set** together (e.g., a manifest), so a metric change is attributable. **Add a "versioned eval manifest"** to §39/§70 — important for interpreting metric movements across model updates (Anthropic ships frequent versions; a metric shift may be a model change, not your code).

**Status: V (feasible) with two additions — CI infra-vs-quality failure separation, and a versioned eval manifest — plus the eval-cost discipline from §12.**

---

## 21. Required feasibility spikes

Each spike is compact but complete. **Blocking?** = does it gate committing to the production topology / public demo (B = blocking, N = non-blocking but recommended). Time boxes are upper bounds. Run the four **B** spikes (SPK-01, SPK-04, SPK-09, SPK-19) and SPK-15 first.

> **SPK-01 — Expo + Mapbox custom dev build (New Architecture)**
> **Q:** Does a custom dev build on **SDK 55 / RN 0.83 / rnmapbox 11.20.1** render the custom Studio style + clustered pins + an amber route line with the twisty-highlight treatment on a **real iPhone and Android**, with all native deps building under the **New Architecture**?
> **Why:** rnmapbox can't run in Expo Go; SDK 55 is New-Arch-only; this is the mobile foundation.
> **Prototype:** minimal Expo app, config plugin, EAS dev build, one MapView with the style, a clustered source, and a sample line layer + a high-curvature overlay.
> **Time box:** 2 days. **Setup:** [HUMAN] Mapbox account + public token; EAS; a real iPhone + Android.
> **Measure:** builds succeed; map renders; clustering + line layers work; contrast OK on dark+light; New-Arch enabled.
> **Pass:** all of the above on both devices. **Fail:** a native dep won't build under New Arch, or rendering is broken.
> **If pass:** lock the version pins (§5). **If fail:** drop to **SDK 54 / RN 0.81 (legacy arch)** for the lagging dep, or swap to **maplibre-react-native**. **Fallback:** MapLibre. **Blocking? B.**

> **SPK-02 — Mapbox route rendering & twisty highlighting at scale**
> **Q:** Do line gradients / layered styling render a long route with distinct high-curvature segments performantly (60 fps pan/zoom)?
> **Why:** the twisty highlight is a core visual; amber-on-amber needs a distinct treatment.
> **Prototype:** render a few seeded routes with a curvature-driven secondary layer.
> **Time box:** 0.5 day. **Setup:** SPK-01 build + seeded geometry.
> **Measure:** fps; visual distinctness; contrast.
> **Pass:** 60 fps + clearly legible highlight. **Fail:** jank or indistinct highlight.
> **If fail:** simplify styling / use a second hue. **Fallback:** static width/colour step instead of gradient. **Blocking? N.**

> **SPK-03 — SSE streaming on a real device**
> **Q:** Does the `/plan` SSE stream render the generation-progress timeline incrementally on a real device, survive brief network blips, and cancel cleanly via `AbortController` (halting backend token spend)?
> **Why:** streamed steps are the hero UX; RN streaming needs care.
> **Prototype:** a stub `/plan` emitting timed step events; a client timeline; a cancel button; a backgrounding test.
> **Time box:** 1 day. **Setup:** backend stub on the VPS/dev; SPK-01 build.
> **Measure:** incremental render; reconnect/resume or clean cancel; backend stops on disconnect.
> **Pass:** steps stream + cancel stops spend + backgrounding degrades gracefully. **Fail:** no incremental render or spend continues after cancel.
> **If fail:** use `react-native-sse`/EventSource polyfill or chunked-fetch shim; if still unreliable, **poll a job status** endpoint instead of SSE. **Fallback:** polling. **Blocking? N (but fix before P4).**

> **SPK-04 — Valhalla VPS deployment + tile RAM (the host gate)**
> **Q:** Do the **road-class-filtered regional tiles** load and serve on a **CX32 (8 GB)** with comfortable RAM headroom and acceptable query latency?
> **Why:** the entire routing host decision + cost depend on tiles fitting a small VPS.
> **Prototype:** clip+filter the corridor `.poly`; `valhalla_build_tiles`; run sample `/route`, `/isochrone`, `/trace_route` on the VPS.
> **Time box:** 2 days. **Setup:** [HUMAN] a VPS; Geofabrik Ontario extract; the `.poly`.
> **Measure:** tile dir size; peak RSS while serving; route/isochrone latency; tile **build time**.
> **Pass:** peak RAM ≤ ~60% of box; route p95 < ~1 s; build time tolerable (offline). **Fail:** OOM/thrash or routes slow.
> **If pass:** **commit CX32**; (downsize to CX22 only if RAM ≪ budget). **If fail:** size up to **CX42 (16 GB)** or use **hosted Valhalla**. **Fallback:** Stadia/hosted Valhalla. **Blocking? B.**

> **SPK-05 — Valhalla route metadata & duration accuracy**
> **Q:** Do `/route` responses expose the road-class/flags + maneuvers Roadopia needs, and are duration estimates close enough to real drive time on known roads?
> **Why:** scoring, result-scanning, and the duration constraint depend on it.
> **Prototype:** route several known local loops; compare reported vs real duration; inspect maneuvers/flags.
> **Time box:** 0.5 day. **Setup:** SPK-04 tiles.
> **Measure:** flag/maneuver presence; |reported − real| duration.
> **Pass:** flags+maneuvers present; duration within ~±15% (tune `DURATION_TOLERANCE`). **Fail:** missing metadata or wild duration error.
> **If fail:** add costing tuning / a correction factor. **Fallback:** widen tolerance + disclose. **Blocking? N.**

> **SPK-06 — Valhalla hard/soft avoidance semantics**
> **Q:** With `allow_hard_exclusions: true`, does `exclude_highways` produce compliant routes, warn-and-ignore when disabled, and return no-route in genuinely impossible cases (so the soft fallback fires)?
> **Why:** the three-tier constraint model depends on the exact behaviour.
> **Prototype:** route the same OD with flag off/on; force an impossible exclusion in a sparse area.
> **Time box:** 0.5 day. **Setup:** SPK-04 tiles + config flag.
> **Measure:** result road classes; warning behaviour; no-route handling.
> **Pass:** off=ignored+warn, on=compliant-or-no-route as documented. **Fail:** unexpected behaviour.
> **If fail:** rely on **soft penalties + result-scan** only (still honest). **Fallback:** soft-avoid + disclose. **Blocking? N (but settles §28 detail).**

> **SPK-07 — Valhalla map matching (record-a-drive)**
> **Q:** Does `/trace_route` cleanly snap a real recorded foreground GPS trace to roads?
> **Why:** record-a-drive depends on it.
> **Prototype:** record a real drive (foreground), map-match it, review the snapped geometry.
> **Time box:** 0.5 day. **Setup:** SPK-04 tiles + SPK-01 build + [HUMAN] a drive.
> **Measure:** snap quality vs the actual roads.
> **Pass:** clean snap on a normal drive. **Fail:** garbage on normal GPS.
> **If fail:** tune `shape_match`/`gps_accuracy`. **Fallback:** store raw trace + light smoothing. **Blocking? N.**

> **SPK-08 — OSM extract size + filter**
> **Q:** What is the clipped+filtered corridor extract size, and does road-class filtering retain drive-worthy roads?
> **Why:** drives tile size, curvature-table size, build time.
> **Prototype:** `osmium extract`+`tags-filter`; inspect size + a sample of retained/dropped roads.
> **Time box:** 0.5 day. **Setup:** Geofabrik extract + `.poly`.
> **Measure:** filtered `.pbf` size; spot-check road retention.
> **Pass:** size reasonable; good roads retained. **Fail:** over/under-filtered.
> **If fail:** adjust the tag filter. **Fallback:** broader/narrower class set. **Blocking? N (feeds SPK-04/10).**

> **SPK-09 — Supabase free-tier fit (egress + DB) (the data gate)**
> **Q:** Do realistic map/list payloads (with **simplified geometry** + CDN headers) keep projected **egress under 5 GB/mo** at demo scale, and does the schema + `curvy_segments` fit **500 MB**?
> **Why:** egress is the binding free-tier limit; decides Free vs Pro for the demo.
> **Prototype:** seed representative data; measure payload sizes for map/browse/detail with precise vs simplified geometry; project egress at expected demo traffic; measure DB size.
> **Time box:** 1 day. **Setup:** a Supabase project + seeded data.
> **Measure:** per-view egress; monthly projection; DB size.
> **Pass:** projected egress < ~3 GB (headroom) + DB < ~350 MB. **Fail:** either near the cap.
> **If pass:** **Free for dev**; decide Free-vs-Pro for demo per §22. **If fail:** **Supabase Pro ($25)** + tighter simplification/caching. **Fallback:** Pro. **Blocking? B.**

> **SPK-10 — Curvature-support-table size + behaviour on known roads**
> **Q:** How big is `curvy_segments` for the region, and does the curvature metric rank **known** twisty roads above urban grids (few false positives)?
> **Why:** table must fit Supabase; the metric is the product's core signal.
> **Prototype:** compute curvature (circumcircle-radius of point-triples, with geometry resampling) over the filtered network; load to PostGIS; eyeball rankings on roads you personally know; check urban-grid behaviour.
> **Time box:** 2 days. **Setup:** SPK-08 extract + PostGIS.
> **Measure:** table size; ranking correctness on a hand-labelled set; urban-grid false-positive rate; `find_curvy_roads` query latency.
> **Pass:** table low-MB; known twisty roads rank high; grids suppressed; query < 1 s. **Fail:** bloated, or grids rank as twisty.
> **If pass:** set `THETA_CURVY` + resample spacing (§91). **If fail:** add segment-length/again-straight filters, min-segment-length, or grid suppression. **Fallback:** stricter thresholds. **Blocking? N (but core quality).**

> **SPK-11 — Scenicness heuristic inputs**
> **Q:** Do the grounded scenic inputs (water/forest proximity, viewpoint spots, protected areas, road class) yield a signal that *correlates* with locally-known scenic roads — without overclaiming?
> **Why:** scenicness must be an honest heuristic, not noise.
> **Prototype:** compute the blended signal on a hand-labelled set of known-scenic and known-dull roads.
> **Time box:** 1 day. **Setup:** SPK-10 data + OSM nature tags.
> **Measure:** rank correlation on the labelled set.
> **Pass:** meaningful positive correlation. **Fail:** no signal.
> **If pass:** set scenic weights. **If fail:** drop scenic weight toward 0 and rely on curviness (still honest). **Fallback:** curviness-only. **Blocking? N.**

> **SPK-12 — Supabase spatial RPC performance**
> **Q:** Do `find_spots`/`find_curvy_roads`/`search_routes` return < 1 s on seeded data with GiST/trigram indexes, under RLS?
> **Why:** browse + the planner's retrieval depend on it.
> **Prototype:** the RPCs + indexes on seeded data; time representative queries.
> **Time box:** 0.5 day. **Setup:** SPK-09 data.
> **Measure:** query latency with/without indexes.
> **Pass:** < 1 s. **Fail:** slow.
> **If fail:** add/tune indexes; bound result sets. **Fallback:** precompute/cluster. **Blocking? N.**

> **SPK-13 — Least-privilege planner read path**
> **Q:** Can an anonymous `/plan`-style call through the **`SECURITY DEFINER`** function read public/OSM data but **never** return a private route/spot?
> **Why:** the open planner must not exfiltrate private data.
> **Prototype:** the definer function + an RLS test attempting to reach private rows anonymously.
> **Time box:** 0.5 day. **Setup:** SPK-09 schema + RLS.
> **Measure:** the test cannot retrieve any private row.
> **Pass:** zero private leakage. **Fail:** any leakage.
> **If fail:** rework the function/role grants. **Fallback:** route all planner reads through the backend with explicit filtering. **Blocking? N (but security-critical — must pass before public link).**

> **SPK-14 — Anonymous rate limiting + abuse guard**
> **Q:** Do per-IP + per-session limits on `/plan` prevent budget burn while allowing the hero demo?
> **Why:** the planner is open (no login wall) and spends money.
> **Prototype:** rate-limit middleware; simulate abusive bursts + normal demo use.
> **Time box:** 0.5 day. **Setup:** backend.
> **Measure:** abusive bursts blocked; normal use unaffected.
> **Pass:** both. **Fail:** either fails.
> **If fail:** tune limits / add a lightweight challenge. **Fallback:** lower anon quota. **Blocking? N (must pass before public link).**

> **SPK-15 — Loop-generation quality (the core quality gate)**
> **Q:** Does the candidate pipeline (isochrone scope + directional sectors + curvy-waypoint selection + TSP ordering + overlap diversification) produce **diverse, drivable loops that avoid out-and-back** and satisfy briefs on the seeded region?
> **Why:** loops/scenic quality is the one thing Valhalla doesn't provide — it's the product's hardest, highest-value risk.
> **Prototype:** implement the deterministic candidate generator over SPK-04/10 data; run ~15 briefs; inspect diversity (`edge_overlap`), out-and-back (`self_overlap`), and drivability by eye.
> **Time box:** 3 days. **Setup:** SPK-04 tiles + SPK-10 curvature.
> **Measure:** pairwise overlap; self-overlap; subjective drivability; constraint satisfaction.
> **Pass:** ≥ K distinct candidates with overlap ≤ τ, low self-overlap, drivable, brief-satisfying. **Fail:** duplicates, out-and-back, or undrivable.
> **If pass:** lock the candidate-gen tunables (§91). **If fail:** iterate sectors/clustering/penalties; if intractable at latency, reduce scope (smaller region / fewer candidates) — **this is the spike most likely to need iteration.** **Fallback:** simpler "route through 1–2 curvy clusters + return via a different corridor" with relaxed diversity. **Blocking? B (gates the AI-product claim).**

> **SPK-16 — Route-duration accuracy (loop budgets)**
> **Q:** Do generated loops land within the duration tolerance often enough for the duration constraint to be meaningful?
> **Why:** "90-minute loop" is a headline promise.
> **Prototype:** generate loops for several duration targets; compare requested vs achieved (Valhalla estimate) and, on a few, vs real drive time.
> **Time box:** 0.5 day (rides on SPK-15). **Setup:** SPK-15.
> **Measure:** achieved-vs-target spread.
> **Pass:** majority within ±tolerance. **Fail:** systematically off.
> **If fail:** improve isochrone budgeting / iterate. **Fallback:** widen tolerance + disclose. **Blocking? N.**

> **SPK-17 — External navigation hand-off**
> **Q:** Do the Apple (current unified schema) and Google hand-off URLs open correctly on real devices for A→B, leg-by-leg, and a decimated Google loop — within documented limits?
> **Why:** verify the best-effort hand-off behaves on-device (Apple schema changed in 18.4).
> **Prototype:** build the URLs; open on a real iPhone + Android; test loop legs + Google waypoint cap.
> **Time box:** 0.5 day. **Setup:** SPK-01 build + real devices.
> **Measure:** correct app opens; waypoint behaviour; URL-length guard.
> **Pass:** A→B + leg-by-leg work both; Google decimated within limits; no faithful-loop claim on Apple. **Fail:** URLs don't open / exceed limits.
> **If fail:** fall back to destination-only + in-app follow-mode (primary anyway). **Fallback:** follow-mode only. **Blocking? N.**

> **SPK-18 — Server-side EXIF stripping + image re-encode**
> **Q:** Does the upload→process pipeline (sharp) strip EXIF/GPS, re-encode safely, validate MIME by magic bytes, generate thumbnails, and replace the original — with Storage cleanup on delete?
> **Why:** privacy + safety floor for UGC photos.
> **Prototype:** Supabase Storage upload trigger → sharp re-encode (metadata dropped by default) + `file-type` magic-byte check + thumbnail → replace; a delete path that removes the blob.
> **Time box:** 1 day. **Setup:** Supabase Storage + an edge function / small backend endpoint.
> **Measure:** EXIF gone; format normalized; bad types rejected; thumbnail served via signed URL/CDN; blob removed on delete.
> **Pass:** all. **Fail:** metadata remains or bad types pass.
> **If fail:** adjust sharp/validation. **Fallback:** Supabase image transformations / reject-by-default. **Blocking? N (must pass before public UGC).**

> **SPK-19 — End-to-end AI generation latency + cost (the AI gate)**
> **Q:** Under the real model mix (Haiku parse/correct + Sonnet select/explain) with prompt caching + session tool-cache + parallel candidate routing, is generation **p50 < 15 s / p90 < 25 s** and **cost ~1–3¢ p50** (worst case ≤ ~10¢)?
> **Why:** the interactive promise + the $30 cap depend on it.
> **Prototype:** wire the full loop over SPK-04/10/15 with real Anthropic calls; run the eval-style brief set; log latency percentiles + per-gen token cost.
> **Time box:** 2 days. **Setup:** [HUMAN] Anthropic key + prepaid credit; SPK-15 pipeline.
> **Measure:** p50/p90/p99 latency; timeout rate; cost/gen; cache-hit rate.
> **Pass:** p50 < 15 s, p90 < 25 s, p50 cost ≤ ~3¢. **Fail:** p90 ≫ 25 s or cost ≫ target.
> **If pass:** lock model mix + budgets (§91). **If fail:** parallelize more / cut N candidates / shrink prompts / push more to Haiku / tighten the wall-clock budget (best-so-far). **Fallback:** smaller candidate set + Haiku-only select. **Blocking? B.**

> **SPK-20 — AI spend cap + kill switch**
> **Q:** Does app-side accounting (sum `token_cost_usd`) enforce $20 soft / $30 hard with graceful degradation, and does the kill switch + prepaid-credit backstop stop spend immediately?
> **Why:** protects the budget; prevents a runaway bill or broken demo.
> **Prototype:** the cost-guard module + a forced cap-hit; verify degradation (anon disabled/limited, logged-in reduced, auto-title→cheaper/async, browsing/saved/manual/record still work) + kill switch + that prepaid credits bound the true maximum.
> **Time box:** 1 day. **Setup:** backend + Anthropic prepaid credit + workspace limit.
> **Measure:** thresholds fire; degradation correct; kill switch immediate; credits cap the absolute max.
> **Pass:** all. **Fail:** spend continues past cap.
> **If fail:** fix accounting / lower prepaid balance. **Fallback:** rely on prepaid-credit ceiling + workspace limit. **Blocking? N (must pass before public link).**

> **SPK-21 — Public eval-page provenance**
> **Q:** Does the eval page display **real** aggregates from `ai_generation_requests` via a non-identifying read path (no briefs/user IDs), matching a manual spot-check?
> **Why:** the page's credibility (and the spec's honesty pillar) depends on real provenance.
> **Prototype:** the aggregate read path/view + the page; cross-check a metric against a manual query.
> **Time box:** 0.5 day. **Setup:** logged generations.
> **Measure:** page numbers == manual aggregate; no PII exposed.
> **Pass:** match + no PII. **Fail:** mismatch or leakage.
> **If fail:** fix the aggregate path. **Fallback:** ship fewer metrics, all verified. **Blocking? N.**

**Spike sequencing:** SPK-08 → SPK-04 → SPK-10 → SPK-15 → SPK-19 is the critical chain for the AI product; SPK-01 and SPK-09 run in parallel as the mobile + data gates; the security/abuse/privacy spikes (SPK-13/14/18/20) must pass **before the public link**, and SPK-03/17 before P4/P2 respectively.

---

## 22. Blocking decisions

There are **no open *product* decisions** blocking the start of P0 — the v2 spec's eight decisions are made and verified as sound. The remaining "blocking" items are **spike-gated go/no-go decisions** plus a small number of genuine setup/cost choices the builder should make deliberately:

1. **[Spike-gated] Routing host size** — CX22 vs **CX32** vs CX42, decided by **SPK-04** (tile RAM). *Default recommendation: start CX32.* Blocks committing the production routing topology.
2. **[Spike-gated] Supabase Free vs Pro for the public demo** — decided by **SPK-09** (egress) and risk tolerance for the **7-day pause + no backups**. *Recommendation:* **Free for dev/spikes; for the public-demo project, lean Pro ($25)** because the pause + missing backups + egress ceiling are real demo-killers and $25 is within budget. This is the **one cost decision worth making up front** (it changes the demo-tier total from ~$8 to ~$33–55/mo — still modest). **[HUMAN decision.]**
3. **[Decision] Expo SDK pin** — **SDK 55 / RN 0.83 (New Arch)** is recommended and current; the only reason to choose **SDK 54 (legacy arch)** is if **SPK-01** reveals a required native dep doesn't yet support the New Architecture. Decide at SPK-01.
4. **[HUMAN, not blocking the build but blocking the store]** Paid developer accounts (Apple $99/yr, Google $25) and the distribution channel (dev-build link vs TestFlight/internal track) for the demo — needed before TestFlight/store, not before P0.
5. **[Decision, minor] Anthropic backstop posture** — confirm using **prepaid credits + a workspace spend limit** (not just app-side accounting) as the true ceiling. Decide before the public link (SPK-20).

None of these requires architectural change; all are either spike outcomes or budget/credential choices.

## 23. Recommended fallbacks

A fallback per major dependency, so no single failure stalls the project:

| Area | Primary | Fallback (verified viable) | Trigger |
|---|---|---|---|
| Map SDK | `@rnmapbox/maps` v11 | **maplibre-react-native** (OSS, MapLibre style) | rnmapbox New-Arch/build failure (SPK-01) |
| Map tiles/style | Mapbox hosted | MapLibre + **self-hosted vector tiles** (from the same OSM extract) | Mapbox cost/terms problem |
| Routing host | Hetzner CX32 VPS | **CX42** (more RAM) → **hosted Valhalla (Stadia)** | tile RAM/latency (SPK-04) or ops burden |
| Routing engine | self-hosted Valhalla | hosted Valhalla (same API) | outage / can't self-host |
| Data backend | Supabase Free | **Supabase Pro ($25)** | egress/pause/backups (SPK-09) |
| Backups | nightly `pg_dump`→R2 | Supabase Pro managed backups + PITR | scale/criticality |
| Streaming | SSE | **poll a job-status endpoint** | RN SSE unreliability (SPK-03) |
| Hard constraints | Valhalla hard exclusion | **soft penalties + result-scan + disclosure** | exclusion behaviour (SPK-06) |
| Loop quality | full candidate pipeline | **simpler 1–2-cluster loop + relaxed diversity** | quality/latency (SPK-15) |
| AI latency/cost | Haiku+Sonnet mix + caching | **fewer candidates / Haiku-only select / tighter budget → best-so-far** | latency/cost (SPK-19) |
| AI spend ceiling | app-side cap | **prepaid-credit balance + workspace limit + kill switch** | accounting bug (SPK-20) |
| Image processing | sharp | Supabase image transforms / jimp / reject-by-default | sharp issue (SPK-18) |
| External nav | best-effort hand-off | **in-app follow-mode only** (already primary) | hand-off failure (SPK-17) |
| Scenicness | grounded blend | **curviness-only** (still honest) | no signal (SPK-11) |
| Scheduled jobs | `pg_cron`/`pg_net` | GitHub Actions cron | either suffices |

The architecture is **resilient by construction**: every brittle external is shadowed by an open-source or in-app alternative, and the most important fallback (hosted Valhalla speaking the same API) is a base-URL swap.

## 24. Go/No-Go checklist

**Pre-P0 (start the build) — all met today:**
- [x] Model identifiers + pricing verified (Haiku/Sonnet, $1/$5, $3/$15; API ≠ Max).
- [x] rnmapbox v11 + Expo dev-build requirement verified; version pins chosen (SDK 55/RN 0.83).
- [x] Supabase capabilities (PostGIS, RLS, `SECURITY DEFINER`, signed URLs, account deletion) verified; limits known.
- [x] Valhalla capabilities (route/match/isochrone/elevation/costing/hard-exclusion/TSP) verified.
- [x] Apple/Google hand-off limits verified; best-effort redesign confirmed correct.
- [x] VPS economics verified (CX32 ~$7–8/mo; 20 TB traffic).
- [x] No open product decision; no NO-GO blocker.

**Gate to commit production topology + public demo — must pass:**
- [ ] **SPK-01** dev build renders on iPhone+Android under New Arch.
- [ ] **SPK-04** regional tiles fit the chosen VPS RAM with route p95 < ~1 s.
- [ ] **SPK-09** projected egress < ~3 GB + DB < ~350 MB (else go Pro).
- [ ] **SPK-15** diverse, drivable, out-and-back-free loops satisfy briefs.
- [ ] **SPK-19** generation p50 < 15 s / p90 < 25 s, p50 cost ≤ ~3¢.

**Gate to publish the public link — must pass:**
- [ ] **SPK-13** least-privilege planner path leaks no private data.
- [ ] **SPK-14** anonymous rate limiting blocks abuse, allows demo.
- [ ] **SPK-18** EXIF stripped + re-encode + bad-type rejection + Storage cleanup.
- [ ] **SPK-20** spend cap + kill switch + prepaid-credit ceiling enforce the budget.
- [ ] **SPK-21** eval page shows real aggregates, no PII.
- [ ] Spec edits §8 applied (Nav-SDK prohibition, Data-API grants, Storage cleanup, Mapbox alert, cap-mechanism wording, public-roads softening, Apple unified-URL note, hard-exclusion detail, TSP ≥4, eval-cost discipline).

**Gate to store submission (P6):**
- [ ] Account deletion, privacy labels (foreground location; **no** background), permission strings, moderation **+ user blocking**, ToS/EULA + privacy policy, safe-driving framing, OSM+Mapbox attribution, reviewer account.

---

## Final verdict

**CONDITIONAL GO.**

The Roadopia v2 architecture is **verified as buildable and deployable as written**. Every load-bearing dependency matches its vendor's current primary source; the defining engineering judgments are sound; the cost envelope is realistic (and slightly conservative); and there is no NO-GO blocker or open product decision. Proceed to **Phase P0**.

The build may **not** be declared production-ready on architectural plausibility alone — four measurements gate the production-topology + public-demo commitment: **SPK-04** (Valhalla tiles fit a small VPS), **SPK-09** (Supabase egress holds), **SPK-19** (AI latency + cost hit target), and **SPK-15** (loops are diverse, drivable, and brief-satisfying — the one capability Valhalla doesn't provide and the project's true hard part). Pass those four, apply the ten precision edits in §8, clear the pre-public-link security/abuse/privacy spikes, and Roadopia v2 converts from **CONDITIONAL GO** to **GO**.

*End of Roadopia Dependency & Feasibility Verification v1.0.*
