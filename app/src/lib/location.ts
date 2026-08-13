/**
 * Foreground-only device location (M7-T03; Master Spec §20.3 — no background
 * location, ever). Returns a discriminated result so the Plan screen renders
 * the §18 permission-denied state ("drop a pin instead") without try/catch
 * noise. Injectable in tests via the PlanScreen prop.
 */

import type { LatLng } from '@shared/types';
import * as Location from 'expo-location';

export type LocationResult =
  | { status: 'ok'; point: LatLng }
  | { status: 'denied' }
  | { status: 'error' };

export async function getCurrentLocation(): Promise<LocationResult> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { status: 'denied' };
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { status: 'ok', point: { lat: pos.coords.latitude, lng: pos.coords.longitude } };
  } catch {
    return { status: 'error' };
  }
}

export interface LocationFix {
  lat: number;
  lng: number;
  accuracyM: number | null;
}

export type StopWatching = () => void;

/**
 * Foreground position stream for recording (M9-T03; still §20.3: foreground
 * ONLY — this must never request background permission). High accuracy +
 * ~1 s cadence; the recorder's own gates do the filtering. Returns a stop
 * function; 'denied'/'error' resolve through the same discriminated shape.
 */
export async function watchLocation(
  onFix: (fix: LocationFix) => void,
): Promise<{ status: 'ok'; stop: StopWatching } | { status: 'denied' } | { status: 'error' }> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { status: 'denied' };
    const sub = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 5,
      },
      (pos) => {
        onFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy ?? null,
        });
      },
    );
    return { status: 'ok', stop: () => sub.remove() };
  } catch {
    return { status: 'error' };
  }
}
