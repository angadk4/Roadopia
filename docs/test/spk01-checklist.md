# SPK-01 — Expo + Mapbox custom dev build (New Architecture)

**Spike (BLOCKING, gates all of M7). Owner-run on real devices.** Source: Dependency
Verification §21. This file is the record; tick the boxes on-device and paste the outcome.

> **Q (pass bar):** Does a custom Expo dev build render the Mapbox style + clustered pins +
> an amber route line with a distinct high-curvature treatment on a **real iPhone AND Android**,
> with all native deps building under the **New Architecture**?
> **Pass:** all of the above on both devices. **Fail:** a native dep won't build under New Arch,
> or rendering is broken.

---

## Status: **iOS leg PASSED (owner, 2026-07-16)** · Android **BUILD PASSED** (EAS APK, 2026-07-16) · Android render check OPEN (no device yet)

EAS cloud build (preview profile, Node 24 on the build image) → installed on the owner's real
iPhone → **all seven checks pass**: launch (New-Arch native build proven), dark map, clustering,
amber line + distinct curvy overlay, dark/light toggle, attribution, HUD. Android leg repeats
when a device is on hand — the spike's full bar is both devices.

**Owner observations, triaged (2026-07-16):**

- *"Route line doesn't follow roads — lines of best fit"* — CORRECT, it's the test fixture: 8
  hand-typed coordinates joined point-to-point. The spike only proves a LineLayer renders. M7
  feeds this exact layer real Valhalla geometry (hundreds of road-hugging vertices from /plan).
- *"Un-clustered dots stay dots instead of a cluster of 1"* — standard Mapbox semantics: a
  cluster forms at ≥2 points; a lone point renders as itself (desired in the real app).
- *"Slow launch; clustering not perfectly smooth"* — REAL WATCH-ITEM → carried to **SPK-02**
  (60 fps route-render spike at M7) and the M7 perf eye. Part is preview-build overhead +
  first-run style download; measure properly with real data.
- *"HUD panel sizing/opacity poor; toggle looks like plain text; tiny hit target"* — the rig is
  deliberately throwaway (deleted at M7-T01), BUT the specific complaints are recorded as the
  **M7 UI acceptance bar**: real buttons must look tappable, ≥44 pt hit targets, deliberate
  panel sizing/contrast (§663/§667 + owner taste).

**Build-path fixes that got us here (all committed):** hoisted pnpm layout (`nodeLinker:
hoisted` in pnpm-workspace.yaml — EAS autolinking can't see pnpm's isolated store) · Node
24.16.0 pinned in eas.json build profiles (EAS image defaults to Node 20; pnpm 11.8 needs ≥22)
· unique bundle id `com.angadk4.roadopia` + projectId in app.config.ts · `expo install --fix`
patch alignment · stray root eas.json/app.json (from running eas outside `app/`) removed.

---

## Pre-build — done by the agent (no device), all green

- [x] `app/` Expo project scaffolded: `app.config.ts` (rnmapbox + expo-location plugins),
      `eas.json` (development profile), `App.tsx` (MapView + clustered source + amber line +
      curvature overlay + attribution + dark/light toggle), `metro.config.js` (monorepo),
      `babel.config.js`, `index.js`, `tsconfig.json`, `expo-env.d.ts`.
- [x] Stack installed at the REAL current versions: **Expo SDK 55.0.27 · RN 0.83.6 ·
      React 19.2.0 · @rnmapbox/maps 10.3.2** (see the version correction below).
- [x] `expo config` resolves on **Node 24.16** (the SDK-55-on-Node-24 watch-item — clear for
      the CLI/config path; the actual build runs on EAS's own Node).
- [x] `expo-doctor`: **19/19 checks pass**.
- [x] Repo gates unaffected: typecheck ✓, lint ✓ (added a CJS block for metro/babel — the
      deferred RN lint work, BD-4), format ✓, **286 tests green** (app smoke survived the RN deps).

## ⚠ Version correction the spike already surfaced (ratify + fix the docs — BD-46)

- **`@rnmapbox/maps` 11.20.1 does NOT exist.** The npm registry's latest is **10.3.2** (no v11
  published at all). Dependency Verification §5/§122's "v10 deprecated → pin v11 (11.20.1)" is
  inverted vs. reality. **10.3.2 is the correct pin** and — per its own metadata (`react-native
  >=0.79` peer + a Fabric `codegenConfig`) — it **supports the New Architecture**, so the design
  (Expo + rnmapbox + Mapbox Maps SDK + New Arch) is intact; only the number changed.
- **The download token IS required.** §683's "no longer required for the SDK" is also inaccurate:
  the native Mapbox SDK build pulls from Mapbox's private registry and needs the `sk.`
  DOWNLOADS:READ token at BUILD time. It's wired as `RNMapboxMapsDownloadToken` from an EAS
  secret (never in the JS bundle). You already have this token from S0.
- **MapLibre fallback name** (if ever needed): the real package is `@maplibre/maplibre-react-native`
  (the doc's `maplibre-react-native` 404s).

---

## Owner steps — EAS cloud dev build (iPhone first)

Prereqs: a free **Expo account** (expo.dev). Your two Mapbox tokens from S0 (public `pk.` +
download `sk.`). Run everything from `app/`.

```bash
cd app
npm i -g eas-cli                      # or: pnpm add -g eas-cli
eas login                             # your Expo account

# one-time: register the EAS project (writes extra.eas.projectId to app.config)
eas init

# secrets — injected as build env, NEVER in the repo (Hard rule H):
eas secret:create --scope project --name EXPO_PUBLIC_MAPBOX_TOKEN --value "pk.<your-public-token>"
eas secret:create --scope project --name MAPBOX_DOWNLOAD_TOKEN   --value "sk.<your-download-token>"

# build the iOS dev client in the cloud (EAS walks you through Apple signing —
# a free Apple ID gives a 7-day profile; a paid Developer account lasts a year):
eas build --platform ios --profile development
```

When it finishes (~10–20 min), EAS gives a QR / install link → open it on the iPhone → install
the dev client → it launches straight into the SPK-01 screen.

### Verify on the iPhone (ticked by the owner, 2026-07-16)

- [x] Build **succeeds** (no native dep fails to compile under New Arch)
- [x] App launches; **map renders** (stock dark style) — slow first launch, noted above
- [x] **Clusters** show at low zoom; pins resolve on zoom-in (FR-012) — smoothness watch-item
- [x] **Amber route line** renders, with the **brighter/thicker high-curvature overlay** distinct
      against it (§663) — fixture is straight segments; real geometry lands at M7
- [x] Tap "↺ toggle theme" → **light style** renders; contrast OK on both (§663/§667)
- [x] **Attribution** visible ("© OpenStreetMap contributors · © Mapbox" + the Mapbox logo)
- [x] The HUD shows `SPK-01 · <theme> · ios` (confirms it's the real build, not a stale cache)

### Android leg (deferred — repeat when a device is on hand)

```bash
eas build --platform android --profile development   # → installable .apk
```
- [ ] Same seven checks on a real Android device.

**SPK-01 PASSES only when both device columns are ticked.** Record the result (and any deviation)
here + in BUILD_LOG, then M7-T01 (the full app shell + tab nav) is unblocked.

---

## If the build FAILS — the ladder (Dependency Verification §21)

1. **Native SDK download 401/403** → the `MAPBOX_DOWNLOAD_TOKEN` secret is missing/mis-scoped
   (needs DOWNLOADS:READ). Re-create it and rebuild.
2. **pnpm module-resolution / symlink errors on the EAS runner** → add a repo-root `.npmrc`
   with `node-linker=hoisted` and re-run `pnpm install` (the documented Expo+pnpm-monorepo
   setting; kept OFF for now to protect the isolated layout the 286 tests run on — re-verify
   the suite after flipping it).
3. **A native dep won't build under New Arch** → the spike's designed fallback: drop to
   **Expo SDK 54 / RN 0.81 (legacy arch)** for the lagging dep, or swap the map lib to
   **`@maplibre/maplibre-react-native`**. Both are owner decisions (§4 escalation).
