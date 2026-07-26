# ACP-001 — Discover: from live isochrone retrieval to a pre-measured drive-core index

**Status:** APPROVED by owner 2026-07-26 (R25 planning session — "Index + fresh connectors" chosen
over "keep live generation" and "hand-curation"; new table + migration explicitly accepted).
**Build Contract §3 artifact.** Decision-log entry lands as BD-9x alongside implementation (U13/U14);
this document is the formal record produced BEFORE implementation begins.

---

## 1. Current decision (what stands today)

Discover (`backend/src/routes/discover.ts`, migrations 0014/0015) is a browsing-class endpoint that,
per request: runs an isochrone, scans up to ~5,000 corpus rows, ranks road clusters by
curviness·length with a **capped** distance discount (`DISCOVER_REACH_DISCOUNT_K = 0.5`), then
live-builds out-and-back routes around the top roads (`out_and_back.ts`) with `shortest`-costing
connectors, plus 8 hand-curated "classic" seed drives (migration 0015). No validation runs on any
pre-built route.

## 2. Evidence the current decision is invalid (audit-v11, 110-route traced audit)

- **The menu is a commute wrapped around a road**: median tapped drive is **79 % connector**; the
  featured road is ~10.5 % of the route (median core 4.6 km; 96/180 under 5 km).
- **Zero validation**: 180 pre-built routes, 0 validations. 110/180 exceed the loop planner's own
  hard self-overlap reject; 131/180 exceed its soft cap.
- **Road-class defects**: tapped drives measure 18.3 % highway (18/30 menus put highway in the
  featured drive), 52.9 % main, 19.5 % backroad — the exact opposite of "fun scenic twisty drives
  near you".
- **The classics are the highway offenders**, and the capped distance discount means a far great
  road can never be ruled out — Kitchener ranks a road 55 min away above a curvier one 7 min away.
- **Owner verdict (verbatim intent)**: Discover should show "most backroads, most curvy, most fun,
  most scenic possible drives nearby", generated properly, "then add on how to get to the start and
  come back home" — three legs, honestly labelled.

## 3. Proposed replacement

**Offline-generated, hard-measured drive-core index + fresh per-request connectors.**

- **Offline sweep (dev box, NOT the VPS)**: grid the region (~8 km cells); per cell, generate loop
  and ribbon core candidates with the EXISTING generation machinery (`retrieveCandidates` →
  `mergeRoadPieces` → `buildSpanPool`/`chainMatrixLocations`/`buildChainCandidates` →
  `assembleLoopWithRepair`); **trace every candidate**; accept only cores clearing a hard measured
  bar (target: `backroad ≥ 55 %`, `main ≤ 30 %`, `highway = 0`, `hood ≤ 5 %`, `turns/10min ≤ 5`,
  `uturns = spurs = 0`, loop `loopiness ≥ 0.25`; ribbons gate on corridor-doubling ≤ 0.10,
  endpoints ≥ 8 km, self-overlap ≤ 0.05 — never loopiness, invalid on open geometry); dedup by
  geometric overlap; keep best 2–4 per cell. Deterministic: no RNG, no `Date.now()` ids,
  collect-then-sort, byte-identical artifact hash across two runs.
- **Storage (migration 0016)**: `drive_cores` table — geometry + `geom_simplified` + measured
  metrics + entry/exit points + GiST bbox index; RLS deny-by-default; SECURITY DEFINER read
  function mirroring migration 0015's pattern, filtering `highway_share = 0` AND
  `generator_version` INSIDE the definer so a bad row can never be served. ~14–60 MB against the
  500 MB Supabase Free ceiling. Loaded by a `data/load_curvy.ts`-convention loader; refresh per
  corpus rebuild, not nightly (a nightly sweep ≈ 90k engine calls / 6–9 h would take down the
  2-vCPU VPS that also serves live Valhalla).
- **Live `/discover` (rewrite)**: one GiST bbox+quality query (LIMIT ~20) replaces isochrone +
  5,000-row scan; ONE `travelMatrix` with `use_highways: 0`; hard connector-share drop BEFORE
  building; build connector-out / connector-home in parallel (prefer a different home connector;
  one bearing-offset retry max, else disclose); NEVER re-route or re-trace the stored core; return
  `{ core, connectorOut, connectorHome }` with per-leg times. App sends `v: 2`; absent `v` gets the
  v1 shape (installed apps can't be force-updated), with a test pinning the v1 branch.
- **Kill condition (pre-registered)**: if <3 passing cores in >40 % of live cells, publish the
  per-bar rejection histogram, name the single binding constraint, lower THAT bar to the cell's
  measured p75 as `bar_profile='cell_relaxed'`, sorted below strict cores and stated on the card.
  If >90 % of cells fill, the bar was too loose — raise it before the live rewrite ships.

## 4. Alternatives considered

1. **Keep live generation, add validation** (rejected): validation without regeneration just empties
   the menu — 110/180 already exceed the hard self-overlap bar; the connector share cannot be fixed
   by filtering what the same generator produces per-request within browse-class latency.
2. **Hand-curation** (rejected by owner): doesn't scale over 230 km, and the existing 8 classics are
   the measured highway offenders.
3. **Full per-request planner runs** (rejected): `/plan`-grade generation costs 8–25 s and real
   engine load on an unauthenticated browse endpoint — a DoS amplifier (Build Contract §7).

## 5. Scope

Backend: `discover.ts` rewrite, `core_bars.ts` shared bar module, offline sweep script, loader,
migration 0016. App: `DiscoverHome.tsx`, `DriveLinesMap.tsx`, `lib/discover.ts` (three-leg render +
per-leg times + Remix via authenticated `/plan`). Deletes: `out_and_back.ts` + its `plan.ts` branch
(after U14), the Discover-tap Haiku parse, the refill loop, classics from the ranked menu (seed rows
move to an unranked "Editor's picks"; migration 0015 stays — migrations are additive).

## 6. Schedule

U12 (this record) → U13 (offline sweep + migration + loader; ~1–2 sessions incl. the full-region
sweep on the dev box) → U14 (live rewrite; 1 session) → U15 (app; 1 session). Discover Stage 1
(U11, measurement + honest gates on the CURRENT shape) ships independently beforehand.

## 7. Migration

Additive only: 0016 creates `drive_cores` + definer read. No existing table altered; 0014/0015
untouched. Hosted deploy applies 0010–0016 in order ([HUMAN] step, already carried). Rollback =
feature flag serving the legacy path (kept until v12 audit passes) + the table is inert if unread.

## 8. Testing

Sweep determinism (two-run hash equality); per-bar acceptance unit tests on `core_bars.ts` (shared
with the live gate — one rulebook); RLS leakage test extended (SPK-13 pattern) proving anon reads
only via the definer and never unpublished/bad rows; `/discover` golden fixture (v2) + v1-compat
test; egress budget test (payload ≤ ~250 KB per browse); `discover_quality.ts` re-baselined with
`DISCOVER_GATES=strict`.

## 9. Cost

Storage +14–60 MB (Free tier headroom OK; SPK-09 egress re-check REQUIRED before ship — core
geometry ships per browse; mitigations: `geom_simplified` only, 5 dp rounding, Caddy `encode gzip
zstd`). Engine cost: offline sweep ~90k calls on the DEV box only; live path gets CHEAPER per
request (no isochrone, no 5k-row scan: p50 ~0.8–1.5 s vs 2–4 s today). No new npm dependencies.
No LLM anywhere in `/discover` (browsing-class holds; Hard rule A untouched).

## 10. Recommendation

Adopt. The reject+repair+tier pattern is the only one this codebase has made work (u-turns 1/60,
spurs 3/60 where gates exist vs 52–53/60 where they don't); an offline index is the only place a
hard measured road-class bar can run without starving a live request or amplifying load. Owner has
approved; implementation may begin once this record is in the tree and the decision log carries the
corresponding BD entry.
