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
Verification §5 ("Node 20 LTS+"). *Revisit:* none — `>=22` is the verified floor.

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
