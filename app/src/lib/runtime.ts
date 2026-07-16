/**
 * Expo-side runtime wiring (M7-T01). The ONLY module that reads Expo constants
 * for the API client — everything downstream takes plain values, so the rest of
 * lib/ stays node-testable.
 */

import Constants from 'expo-constants';

import { resolveApiBaseUrl } from './api';
import { LOCAL_DEV_ANON_KEY, resolveSupabaseUrl, type SupabaseConfig } from './data';

/** The agent-backend base URL for this launch (see resolveApiBaseUrl order). */
export function getApiBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const explicit = typeof extra?.['apiUrl'] === 'string' ? (extra['apiUrl'] as string) : null;
  return resolveApiBaseUrl({
    explicit,
    hostUri: Constants.expoConfig?.hostUri ?? null,
  });
}

/** Client-safe Mapbox public token (pk. — Hard rule H; wired at SPK-01). */
export function getMapboxPublicToken(): string {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const fromExtra =
    typeof extra?.['mapboxPublicToken'] === 'string' ? (extra['mapboxPublicToken'] as string) : '';
  return fromExtra || (process.env['EXPO_PUBLIC_MAPBOX_TOKEN'] ?? '');
}

/** Supabase Data-API config for direct client reads (M7-T02; Spec §49.1). */
export function getSupabaseConfig(): SupabaseConfig {
  const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
  const explicitUrl =
    typeof extra?.['supabaseUrl'] === 'string' && extra['supabaseUrl']
      ? (extra['supabaseUrl'] as string)
      : null;
  const explicitKey =
    typeof extra?.['supabaseAnonKey'] === 'string' && extra['supabaseAnonKey']
      ? (extra['supabaseAnonKey'] as string)
      : null;
  return {
    url: resolveSupabaseUrl({
      explicit: explicitUrl,
      hostUri: Constants.expoConfig?.hostUri ?? null,
    }),
    // Zero-config LAN dev: when no hosted project is configured, the derived
    // local stack pairs with the public supabase-cli demo anon key.
    anonKey: explicitKey ?? (explicitUrl ? '' : LOCAL_DEV_ANON_KEY),
  };
}
