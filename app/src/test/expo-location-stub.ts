/** Node-safe stand-in for 'expo-location' (vitest alias — M7-T03). Tests
 *  inject their own `locate` into PlanScreen; this only satisfies imports. */

export const Accuracy = { Balanced: 3 };

export function requestForegroundPermissionsAsync(): Promise<{ granted: boolean }> {
  return Promise.resolve({ granted: false });
}

export function getCurrentPositionAsync(): Promise<{
  coords: { latitude: number; longitude: number };
}> {
  return Promise.reject(new Error('not available in node tests'));
}
