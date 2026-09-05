/** Node-safe stand-in for 'expo-keep-awake' (M9-T03). The wake-lock is a
 *  native side effect; tests assert recorder behaviour, not the lock. A test
 *  can make activation FAIL (Android throws when the activity is momentarily
 *  gone) to pin what the screens do with a watcher already installed. */

export const KEEP_AWAKE_MOCK = { rejectActivate: false, activations: 0, deactivations: 0 };

export function activateKeepAwakeAsync(): Promise<void> {
  KEEP_AWAKE_MOCK.activations += 1;
  if (KEEP_AWAKE_MOCK.rejectActivate) {
    return Promise.reject(new Error('Unable to activate keep awake'));
  }
  return Promise.resolve();
}

export function deactivateKeepAwake(): void {
  KEEP_AWAKE_MOCK.deactivations += 1;
}
