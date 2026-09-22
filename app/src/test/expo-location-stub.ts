/** Node-safe stand-in for 'expo-location' (vitest alias — M7-T03). Tests
 *  inject their own `locate` into PlanScreen; this only satisfies imports. */

export const Accuracy = { Balanced: 3, BestForNavigation: 6 };

export function requestForegroundPermissionsAsync(): Promise<{ granted: boolean }> {
  return Promise.resolve({ granted: false });
}

/** The no-prompt CHECK used by `getKnownLocation` (the opening camera). Not
 *  granted by default, so a screen under test opens exactly as it did before
 *  this existed; a test that wants the granted path injects its own resolver
 *  through the screen's `knownLocation` prop rather than reaching in here. */
export function getForegroundPermissionsAsync(): Promise<{ granted: boolean }> {
  return Promise.resolve({ granted: false });
}

export function getCurrentPositionAsync(): Promise<{
  coords: { latitude: number; longitude: number };
}> {
  return Promise.reject(new Error('not available in node tests'));
}

/** Unreachable in tests (the permission check above refuses first), present so
 *  the import resolves. */
export function getLastKnownPositionAsync(): Promise<null> {
  return Promise.resolve(null);
}

/** M9-T03: recording stream — emits nothing by default; tests drive the
 *  recorder's pure addFix directly, so the stub only satisfies the import. */
export function watchPositionAsync(): Promise<{ remove: () => void }> {
  return Promise.resolve({ remove: () => undefined });
}
