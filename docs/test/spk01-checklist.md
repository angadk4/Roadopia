# SPK-01 — Expo + Mapbox custom dev build (New Architecture)

**Spike (BLOCKING, gates all of M7). Owner-run on real devices.** Source: Dependency
Verification §21. This file is the record; tick the boxes on-device and paste the outcome.

> **Q (pass bar):** Does a custom Expo dev build render the Mapbox style + clustered pins +
> an amber route line with a distinct high-curvature treatment on a **real iPhone AND Android**,
> with all native deps building under the **New Architecture**?
> **Pass:** all of the above on both devices. **Fail:** a native dep won't build under New Arch,
> or rendering is broken.

---

## Status: iOS build PENDING (owner) · Android leg DEFERRED (no device yet)

The scaffold + toolchain are built and locally verified. What remains is the [HUMAN] core:
build on EAS, install on a real iPhone, eyeball the render. Android repeats once a device is on
hand — **the gate is not "passed" until both are ticked** (the spike's bar is both devices).

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

### Verify on the iPhone (tick each)

- [ ] Build **succeeds** (no native dep fails to compile under New Arch)
- [ ] App launches; **map renders** (stock dark style)
- [ ] **Clusters** show at low zoom; pins resolve on zoom-in (FR-012)
- [ ] **Amber route line** renders, with the **brighter/thicker high-curvature overlay** distinct
      against it (§663)
- [ ] Tap "↺ toggle theme" → **light style** renders; contrast OK on both (§663/§667)
- [ ] **Attribution** visible ("© OpenStreetMap contributors · © Mapbox" + the Mapbox logo)
- [ ] The HUD shows `SPK-01 · <theme> · ios` (confirms it's the real build, not a stale cache)

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
