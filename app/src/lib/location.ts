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

/**
 * Where the user already is, WITHOUT ever showing a permission dialog.
 *
 * `getCurrentLocation` above *requests* permission, which is right for a button
 * the user pressed and wrong for app launch: a dialog that appears before the
 * person has done anything has no context to justify itself, and iOS only ever
 * asks once — spending that single ask on a cold start is how an app ends up
 * permanently denied. So this CHECKS (`getForegroundPermissionsAsync`) and
 * returns 'denied' rather than prompting. The in-context ask stays where it
 * belongs: the "Use my location" button.
 *
 * Prefers the OS's last known fix because this runs while a map is mounting and
 * a cached answer is immediate, where a fresh GPS acquisition can take seconds —
 * by which time the camera has already settled somewhere else and moving it
 * again reads as the map lurching. A stale-by-minutes position is still the
 * right neighbourhood, which is all an opening camera needs.
 *
 * Still §20.3 foreground-only, and the caller must never log the coordinate
 * (Hard rule H).
 */
export async function getKnownLocation(): Promise<LocationResult> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return { status: 'denied' };
    const last = await Location.getLastKnownPositionAsync();
    if (last) {
      return { status: 'ok', point: { lat: last.coords.latitude, lng: last.coords.longitude } };
    }
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
  /** Course over ground in degrees clockwise from north; null when the OS
   *  has none (stationary, or a fix without heading). */
  headingDeg: number | null;
  /** Ground speed in m/s; null when unknown. Used ONLY for the follow-mode
   *  arrival estimate (Hard rule D: never shown as a number, never framed). */
  speedMps: number | null;
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
        // iOS reports -1 for "no heading/speed"; Android null. Both → null.
        const heading = pos.coords.heading;
        const speed = pos.coords.speed;
        onFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy ?? null,
          headingDeg: typeof heading === 'number' && heading >= 0 ? heading : null,
          speedMps: typeof speed === 'number' && speed >= 0 ? speed : null,
        });
      },
    );
    return { status: 'ok', stop: () => sub.remove() };
  } catch {
    return { status: 'error' };
  }
}
