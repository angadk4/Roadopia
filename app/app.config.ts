import type { ExpoConfig } from 'expo/config';

/**
 * Expo app config (SPK-01 / M7-T01). Pins the mobile foundation the spike must
 * prove out (Dependency Verification §5/§21):
 *   Expo SDK 55 · RN 0.83 · @rnmapbox/maps 11.20.1 · New Architecture ON.
 *
 * Mapbox: the rnmapbox config plugin installs the native Maps SDK. TWO tokens,
 * kept strictly separate (Hard rule H):
 *   - PUBLIC pk. token — ships in the build, read at RUNTIME in App.tsx via
 *     `extra` (safe to embed; scoped/restricted).
 *   - DOWNLOAD sk. token (DOWNLOADS:READ) — used ONLY at BUILD time by the
 *     config plugin to fetch the native SDK from Mapbox's private registry.
 *     NEVER prefixed EXPO_PUBLIC_ and NEVER in the JS bundle. Set as an EAS
 *     secret `MAPBOX_DOWNLOAD_TOKEN`.
 * NB: SPK-01 corrected the docs here — the real rnmapbox is 10.3.2 (not the
 * doc's fictional 11.20.1), and the native SDK build DOES need the download
 * token (Dep-Verification §683's "no longer required" is inaccurate). See
 * decision-log BD-46.
 *
 * Hard rule F: Mapbox Maps SDK ONLY — the Navigation SDK is prohibited and is
 * never added as a plugin or dependency.
 */
const config: ExpoConfig = {
  name: 'Roadopia',
  slug: 'roadopia',
  scheme: 'roadopia',
  version: '0.0.1',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic', // dark + light both matter (§663 contrast)
  // NB: no `newArchEnabled` — SDK 55 is New-Arch-ONLY, so the flag was removed
  // from ExpoConfig (its absence IS the guarantee; confirmed by SPK-01).
  ios: {
    // Unique to this Apple account (com.roadopia.app was already taken); matches
    // what EAS registered during `eas init` (SPK-01).
    bundleIdentifier: 'com.angadk4.roadopia',
    supportsTablet: false,
    infoPlist: {
      // No custom/non-exempt crypto → skip the export-compliance prompt on builds.
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'com.angadk4.roadopia',
  },
  plugins: [
    [
      '@rnmapbox/maps',
      {
        // Native Mapbox Maps SDK version left to the plugin default (matched to
        // rnmapbox 10.3.2) for first-build success; pin explicitly (§122) once
        // SPK-01 confirms the build. Nav SDK not referenced (Hard rule F).
        // Build-time download token (sk.) — never inlined; EAS secret.
        RNMapboxMapsDownloadToken: process.env['MAPBOX_DOWNLOAD_TOKEN'],
      },
    ],
    [
      'expo-location',
      {
        // Foreground only — no background location (Master Spec §20.3 / §752).
        locationWhenInUsePermission:
          'Roadopia uses your location to start a drive from where you are and to follow the route.',
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    [
      'expo-image-picker',
      {
        // M10-T05: without this the iOS build has no NSPhotoLibraryUsageDescription
        // and the OS kills the app the instant the picker opens. Library only —
        // no camera permission is requested (the MVP picks existing photos).
        photosPermission:
          'Roadopia uses your photos so you can add pictures to a car spot. Location data is stripped from every upload before anyone can see it.',
      },
    ],
    'expo-dev-client',
  ],
  extra: {
    // Client-safe public token only (Hard rule H; Master Spec §57/§683). Set as
    // an EAS env var / secret named EXPO_PUBLIC_MAPBOX_TOKEN for cloud builds.
    mapboxPublicToken: process.env['EXPO_PUBLIC_MAPBOX_TOKEN'] ?? '',
    // Agent-backend base URL (M7-T01; NOT a secret). Empty in dev = the app
    // derives it from the Metro host (phone on the same LAN reaches
    // `pnpm -C backend dev` with zero config — see lib/api resolveApiBaseUrl).
    // Set EXPO_PUBLIC_API_URL for EAS builds pointed at a deployed backend.
    apiUrl: process.env['EXPO_PUBLIC_API_URL'] ?? '',
    // Supabase Data API for direct client reads (M7-T02; anon key is
    // CLIENT-SAFE by design — Hard rule H). Empty in dev = derived local
    // stack (`supabase start`) + the public supabase-cli demo anon key.
    supabaseUrl: process.env['EXPO_PUBLIC_SUPABASE_URL'] ?? '',
    supabaseAnonKey: process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] ?? '',
    // EAS project link (from `eas init`, M6/SPK-01).
    eas: {
      projectId: '55cb079a-892f-4233-a813-24623af95338',
    },
  },
};

export default config;
