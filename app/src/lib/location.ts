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
