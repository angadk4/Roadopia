# M7-T09 — Physical-device hero-flow test (the M7 milestone gate)

**Gate (RG-M7):** the full hero flow works end-to-end **anonymously on a real iPhone AND a
real Android device** — land → plan → streamed generation → result → constraints →
explanation → refine → reasoning view. No crash; §18 states behave. (Spec §69; SC-1.)

**Status: OPEN — owner-run.** iOS first (device registered, SPK-01 passed); the Android
render check (SPK-01's open half) rides this same checklist when a device exists.

---

## One-time setup (owner)

1. **New iOS dev-client build** (native deps changed since SPK-01: react-native-screens,
   react-native-safe-area-context). From `app/`:

   ```bash
   cd app
   eas build --platform ios --profile development
   ```

   Install it on the iPhone when EAS finishes (~15 min). The DEVELOPMENT profile is the
   dev CLIENT: it loads JS from your PC, so every M7 iteration after this needs **no new
   build** — just reload.

2. **`app/.env`** (git-ignored) with the client-safe Mapbox token so Metro serves it:

   ```
   EXPO_PUBLIC_MAPBOX_TOKEN=pk.<your restricted public token>
   ```

3. **Start the dev world on this PC** (phone + PC on the SAME Wi-Fi):

   ```bash
   # terminal 1 — local stack (skip pieces already running):
   cd db && npx supabase start          # Supabase local (Kong on :54321)
   docker compose -f infra/docker-compose.dev.yml up -d valhalla   # Valhalla :8002

   # terminal 2 — the backend (binds 0.0.0.0:8080; verified recipe):
   cd "c:/Coding Projects/Roadopia"
   TSX_TSCONFIG_PATH=backend/tsconfig.json npx tsx --env-file=.env backend/src/start.ts

   # terminal 3 — Metro:
   cd app && pnpm start
   ```

4. Open the dev client on the iPhone → it finds Metro → the app loads. The app derives the
   backend (`:8080`) and Supabase (`:54321`) URLs **from the Metro host automatically** —
   zero URL configuration. If Windows Firewall prompts for node/ports 8080/8081/54321,
   allow private-network access.

---

## The hero flow (tick on iPhone; repeat the same column on Android later)

| # | Check | iPhone | Android |
|---|---|---|---|
| 1 | **Land** — app opens to the Map tab; seeded routes render as amber lines; spot pins cluster; attribution visible; no empty state (FR-010/011/012/014) | ☐ | ☐ |
| 2 | **Tap** a seed route → detail sheet (name, km, ≈min, tags); tap a spot → spot sheet (FR-013) | ☐ | ☐ |
| 3 | **Plan** — Plan tab: type a brief (e.g. "90 minute twisty loop with a coffee stop"), origin via *Use my location* (grant foreground permission) or *Pick on map*, optionally a preset chip → **Plan my drive** enabled only when valid (FR-040) | ☐ | ☐ |
| 4 | **Stream** — steps appear INCREMENTALLY (parse → scope → retrieve → … → explain) with tool rows + counts; **Cancel** stops the run instantly (FR-041; SPK-03 device half) | ☐ | ☐ |
| 5 | **Result** — route drawn on real roads (bounds-fitted amber line), honest stats (`≈N min`), constraints panel with real ✓/⚠ verdicts, grounded explanation, safe-driving note (FR-042/070/044) | ☐ | ☐ |
| 6 | **Reasoning view** — "How this route was built" expands to steps + tool grounding; nothing that reads like model musings (Hard rule I / RG-5) | ☐ | ☐ |
| 7 | **Refine** — "Tweak this drive" → *make it longer* → new stream → new result + **comparison rows with real deltas**; back returns to the previous result (FR-254/§34) | ☐ | ☐ |
| 8 | **States** — airplane-mode a plan (needs-connection message, not a raw error); background the app mid-generation (clean "paused" + re-run); deny location (drop-a-pin fallback); pick an out-of-region start e.g. Ottawa (friendly region message) (§18) | ☐ | ☐ |
| 9 | **No crash** anywhere in 1–8; theme legible in dark AND light (§663/§667) | ☐ | ☐ |

**SPK-03 closes** with row 4 (incremental render + cancel + backgrounding on hardware).
**SPK-01's Android leg closes** with rows 1–2 on Android (build risk already retired 2026-07-16).
**RG-M7 passes** only when BOTH columns are ticked.

## Record

Outcome, device models, and any deviation → this file + BUILD_LOG + docs/decision-log.md.
Bugs found: file honestly, fix before M8 (rollback = fix forward; the gate blocks M8+).
