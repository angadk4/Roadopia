/** Node-safe stand-in for 'expo-keep-awake' (M9-T03). The wake-lock is a
 *  native side effect; tests assert recorder behaviour, not the lock. */

export function activateKeepAwakeAsync(): Promise<void> {
  return Promise.resolve();
}

export function deactivateKeepAwake(): void {
  // no-op
}
