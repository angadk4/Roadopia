# Roadopia

**Find a road worth driving.**

Most navigation apps answer one question: what is the fastest way from A to B? Roadopia answers a
different one — _where should I drive today?_ Describe the drive you want in plain language ("a
two-hour loop from Milton on quiet backroads, coffee halfway") and it builds a real, drivable route
on real roads, tells you honestly why it chose them, and then navigates it.

It is a full-stack mobile application: a React Native client, a Fastify API, a PostGIS geospatial
database, and a self-hosted [Valhalla](https://valhalla.github.io/valhalla/) routing engine, backed
by a curvature-scored corpus of **133,865 road segments** built from OpenStreetMap.

<!-- SCREENSHOTS: drop 4 PNGs into assets/screenshots/ named exactly as below and this row renders.
     Suggested shots: (1) the plan screen mid-generation, (2) a finished loop on the map,
     (3) follow-mode while driving, (4) the record-a-drive review screen. -->

<p align="center">
  <img src="assets/screenshots/plan.png" width="24%" alt="Describing a drive" />
  <img src="assets/screenshots/result.png" width="24%" alt="A generated loop" />
  <img src="assets/screenshots/follow.png" width="24%" alt="Follow mode" />
  <img src="assets/screenshots/record.png" width="24%" alt="Recording a drive" />
</p>

---

## Contents

- [What it does](#what-it-does)
- [The core idea: deterministic-first AI](#the-core-idea-deterministic-first-ai)
- [How a route gets built](#how-a-route-gets-built)
- [The route planner](#the-route-planner)
- [Architecture](#architecture)
- [Safety, privacy and cost](#safety-privacy-and-cost)
- [Testing](#testing)
- [Running it locally](#running-it-locally)
- [Status](#status)

---

## What it does

|                    |                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan a drive**   | Describe it in plain language. The route is assembled from measured road data and streamed back step by step as it is built.                                |
| **Discover**       | Curated menus of drives near you, generated from a pre-computed index rather than on demand.                                                                |
| **Build by hand**  | Drop points on the map; the line snaps to real roads as you go, with live distance and time.                                                                |
| **Record a drive** | Capture a drive as you drive it. The GPS trace is map-matched to real roads on stop, and saved with the time you actually took — not an engine estimate.    |
| **Follow it**      | In-app navigation along the route: live position, distance remaining and next-turn cues, with the screen held awake.                                        |
| **Hand off**       | Open the drive in Apple or Google Maps, within what those URL schemes can genuinely represent — and never claiming a loop survived the trip when it cannot. |
| **Car spots**      | Add viewpoints, great roads, meetup spots and cafés, with photos. Community spots sit alongside imported OpenStreetMap places.                              |
| **Your library**   | Accounts, saved drives, forking, favourites, private/unlinked/public visibility, and real account deletion.                                                 |

---

## The core idea: deterministic-first AI

The interesting engineering problem in an "AI route planner" is not calling a language model. It is
making sure the model cannot lie to you.

Ask a language model for a scenic route and it will happily invent a road that does not exist, a
distance it did not measure, and a café that closed in 2019. Roadopia is built so that this is
**structurally impossible**:

- **The deterministic pipeline owns all geography.** Every road, coordinate, distance, duration and
  route shape comes from the routing engine and the geospatial database. The model has no tool that
  emits geometry, so there is no path by which a hallucinated road can reach a map.
- **The LLM handles language only.** It parses a free-text request into a typed constraint object,
  and it writes the explanation of a route that has already been built and validated.
- **Its output is checked before you see it.** Explanations are verified against the facts the
  pipeline actually produced: a place name or number that did not come from a tool result is
  rejected, not rendered.
- **Everything it touches is bounded.** Requests are validated and length-capped, model calls are
  routed by task, cached, and metered against a hard spend ceiling with a kill switch that degrades
  the app to browsing rather than failing.

The result is an app where the language is generated and the geography is measured — and where the
copy never claims more than the data supports. A route with unmeasured curvature says "not
measured" rather than showing a confident `0.0`.

---

## How a route gets built

```
  "a 2 hour loop from Milton, quiet backroads, coffee halfway"
                            │
                   ┌────────▼────────┐
                   │  parse (LLM)    │  free text ──► typed constraints
                   └────────┬────────┘
                            │            ┌─────────────────────────────┐
                   ┌────────▼────────┐   │ PostGIS                     │
                   │  candidate      │◄──┤  · 133,865 scored segments  │
                   │  generation     │   │  · pre-indexed drive cores  │
                   └────────┬────────┘   │  · spots + landuse          │
                            │            └─────────────────────────────┘
                   ┌────────▼────────┐   ┌─────────────────────────────┐
                   │  routing +      │◄──┤ self-hosted Valhalla        │
                   │  map matching   │   │  routes · matrices · traces │
                   └────────┬────────┘   └─────────────────────────────┘
                            │
                   ┌────────▼────────┐   rejects self-crossings, u-turns,
                   │ structural      │   microloops and doubled-back
                   │ judge           │   segments — nothing dirty ships
                   └────────┬────────┘
                            │
                   ┌────────▼────────┐
                   │ explain (LLM)   │  grounded in the validated result,
                   └────────┬────────┘  then checked against it
                            │
                     streamed to the app over SSE, step by step
```

Every stage emits a progress event, so the client shows real work as it happens instead of a
spinner — and the same event stream carries honest failure states when a stage cannot deliver.

---

## The route planner

This is the part of the project with the most depth. A good driving road is not a shortest path, and
none of the usual routing primitives optimise for one.

**A curvature corpus from raw OpenStreetMap.** An Ontario extract is filtered to drivable roads,
segmented, and scored for curvature, giving **133,865 scored road segments** in PostGIS with spatial
indexes. The scoring model was validated against a hand-labelled ground-truth set and reaches a rank
correlation of **ρ = 0.825**, so "twisty" means something measurable rather than something asserted.

**Loop synthesis.** Round trips are the hard case: there is no "route me a two-hour loop" primitive
in any routing engine. Roadopia pre-computes a searchable index of good road cores, then assembles
candidate loops around them — choosing entry and exit pairs with real travel-time matrices rather
than nearest-vertex guesses, and composing the drive out of a get-there leg, the drive itself, and a
get-home leg.

**A structural judge.** Candidate routes are inspected geometrically before they can be served.
Self-crossings, u-turns, microloops, dead-end stubs and doubled-back segments are all detected and
rejected, and every exit path in the planner runs through the same judge — so there is no branch
that can quietly serve a route the rest of the system would have refused.

**Honest failure.** When no clean route fits the request, the planner says so and offers the nearest
clean alternative, rather than relaxing its own quality bars to return something. Constraints that
could not be satisfied are reported as relaxed, not silently dropped.

**An evaluation harness.** Planner behaviour is measured, not eyeballed. Frozen route suites, a
held-out set never used for tuning, geometric invariants that fail the build, and **47 experiments**
run behind environment flags with accept/reject criteria fixed in advance — including a record of
changes that were rejected because the measurements did not support them.

---

## Architecture

```
roadopia/
├── app/         React Native (Expo) client — maps, planning, navigation, library
├── backend/     Fastify API — planner, routing/matching, model client, image pipeline
├── shared/      Domain types + typed config, shared by client and server (zod)
├── db/          PostGIS schema, RLS policies and migrations
├── eval/        Route-quality evaluation harness, experiments and fixtures
├── data/        OSM extracts, routing tiles, generated geodata (local, not tracked)
└── infra/       Docker Compose, routing engine config, deploy and ops
```

| Layer        | Choice                       | Why                                                                                                                           |
| ------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Client       | React Native (Expo), Mapbox  | One codebase for iOS and Android with real native map rendering and GPS.                                                      |
| API          | Fastify (TypeScript, strict) | Schema-validated routes, low overhead, first-class streaming for the SSE plan endpoint.                                       |
| Data         | PostgreSQL + PostGIS         | The planner is a geospatial query problem; spatial indexes and geometry operations belong in the database.                    |
| Routing      | Self-hosted Valhalla         | Routing, map matching, isochrones and time-distance matrices without per-request cost or rate limits, running on a small VPS. |
| Auth/Storage | Supabase                     | Postgres-native auth and row-level security, plus object storage for photos.                                                  |
| LLM          | Anthropic API                | Task-routed models — a small model for parsing, a larger one for explanation — behind a cost guard.                           |

The API surface is deliberately small: ten HTTP endpoints, of which the planning endpoint is the
only long-lived one, streamed over Server-Sent Events. JWT verification is implemented directly on
Node's `crypto` module (ES256/RS256 via JWKS with key rotation, HS256 for local development) rather
than pulling in an auth SDK.

---

## Safety, privacy and cost

Because this app handles location, photographs and money, those constraints are enforced in code
rather than in a policy document:

- **Row-level security, deny-by-default.** Every table is RLS-enabled and nothing is readable that
  is not explicitly granted. The policy set is verified by a **26-check matrix** that runs as the
  actual database roles — anonymous and authenticated — asserting both what each role can reach and
  what it must not.
- **No image is retrievable before it is processed.** Uploads are validated by magic bytes (not the
  client's content type), size- and pixel-capped against decompression bombs, stripped of all
  metadata and re-encoded server-side. Only the processed artifact reaches storage, in a private
  bucket served by time-limited signed URLs; a failure anywhere in the pipeline rejects the upload
  rather than serving the original.
- **Location stays in the foreground.** Drive recording never requests background location
  permission, and the recording screen releases its GPS subscription and wake-lock on exit.
- **Deletion is real.** Deleting an account removes the auth record and cascades the user's data —
  and sweeps their photo blobs out of object storage, which a row cascade alone does not do.
- **Spending is capped.** Model calls run through a cost guard with soft and hard monthly ceilings,
  a kill switch, prompt caching and a per-request wall-clock budget. When the cap is hit the app
  degrades to browsing and saved drives instead of failing.
- **No speed, racing or timing framing.** Anywhere. It is a driving-enjoyment app, not a
  performance-timing app, and a lexicon scan in CI fails the build if that language appears in the
  source — including in identifiers.

---

## Testing

**780 automated tests** across the workspace:

| Package   | Tests | Covers                                                                                                                                                                         |
| --------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend` | 496   | Planner algorithms and geometry, route/match endpoints, the SSE plan stream and its degradation ladder, cost guard and rate limits, grounded-output validation, image pipeline |
| `app`     | 260   | Pure client logic (route building, recording, follow-mode geometry, hand-off URLs) and screen rendering against a node-safe native stub                                        |
| `shared`  | 24    | Domain schemas and typed config                                                                                                                                                |

Plus a geometric invariant suite that fails the build on structural regressions, and a
role-permission matrix executed against a live database.

CI runs lint, format, strict typecheck and the full test matrix across every package on each push.

---

## Running it locally

**Prerequisites:** Node ≥ 22, pnpm 11, Docker (for the database and routing engine), and an
[Expo](https://expo.dev) development build on a physical device — the app uses native map and
location modules, so Expo Go will not run it.

```bash
git clone https://github.com/angadk4/Roadopia.git
cd Roadopia
pnpm install
cp .env.example .env          # fill in the API keys listed there
```

Bring up the data tier and the routing engine:

```bash
cd db && npx supabase start   # Postgres + PostGIS + auth + storage
docker compose -f infra/docker-compose.yml up -d valhalla
```

Then the API and the client:

```bash
pnpm dev:api                  # Fastify on :8080
pnpm -C app start             # Metro; open the dev build on your phone
```

Useful checks:

```bash
pnpm test                     # every package
pnpm typecheck                # strict TypeScript, workspace-wide
pnpm lint
```

Routing tiles are built from an OpenStreetMap extract; see `infra/` for the extract and tile-build
scripts. The current region is south-central Ontario, and the region boundary is configuration
rather than a hard-coded box.

---

## Status

Actively developed. The full feature set above runs end to end on a physical device against the
local stack. Public deployment — hosted database, the API on a VPS behind TLS, and distributed
builds — is in progress.

Roadopia is a personal project, built to see how far a genuinely grounded AI product could be
pushed: one where the model writes the words, the measurements decide the geography, and the app
never claims more than it can prove.
