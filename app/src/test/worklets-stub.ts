/**
 * Node-safe stand-in for 'react-native-worklets' 0.7.4 (vitest alias — iOS-grade
 * redesign).
 *
 * WHY IT EXISTS. The real module installs the worklets runtime at import time
 * (it reads NativeModules and creates the UI JSI runtime) and throws in node
 * before any export exists; react-native-reanimated re-exports from it, and the
 * redesign calls `scheduleOnRN` directly from gesture / animation callbacks.
 *
 * WHAT IT EMULATES. There is exactly one thread in node, so "schedule this on
 * the other thread" becomes "call it now": `scheduleOnRN` / `scheduleOnUI` /
 * `scheduleOnRuntime` invoke the function synchronously with its arguments and
 * return undefined; `runOnJS` / `runOnUI` / `runOnRuntime` return the function
 * itself. Serialisation helpers are identity. Everything returned is plain data
 * or the caller's own function — nothing here can reach a host element as a
 * cyclic prop.
 *
 * WHAT IT DELIBERATELY DOES NOT EMULATE (device-only): a second runtime, the
 * Babel worklet transform (`isWorkletFunction` is always false — as on the real
 * API whenever the plugin has not marked the function), the event loop on the
 * UI runtime, or Synchronizable memory. Thread hand-off timing is an
 * on-device check.
 */

export type WorkletRuntime = Readonly<Record<string, never>>;

export const RuntimeKind = { ReactNative: 1, UI: 2, Worker: 3 } as const;
export type RuntimeKind = (typeof RuntimeKind)[keyof typeof RuntimeKind];

/** Always the React Native runtime: node has no UI runtime to be on. */
export function getRuntimeKind(): RuntimeKind {
  return RuntimeKind.ReactNative;
}

/** Calls `fun(...args)` synchronously and returns undefined. */
export function scheduleOnRN<Args extends unknown[], Return>(
  fun: (...args: Args) => Return,
  ...args: Args
): void {
  fun(...args);
}

/** Calls `worklet(...args)` synchronously and returns undefined. */
export function scheduleOnUI<Args extends unknown[], Return>(
  worklet: (...args: Args) => Return,
  ...args: Args
): void {
  worklet(...args);
}

export function scheduleOnRuntime<Args extends unknown[], Return>(
  workletRuntime: WorkletRuntime,
  worklet: (...args: Args) => Return,
  ...args: Args
): void {
  void workletRuntime;
  worklet(...args);
}

/** Returns the function itself (deprecated on the real API; scheduleOnRN wins). */
export function runOnJS<Args extends unknown[], Return>(
  fun: (...args: Args) => Return,
): (...args: Args) => void {
  return fun;
}

export function runOnUI<Args extends unknown[], Return>(
  worklet: (...args: Args) => Return,
): (...args: Args) => void {
  return worklet;
}

export function runOnUISync<Args extends unknown[], Return>(
  worklet: (...args: Args) => Return,
  ...args: Args
): Return {
  return worklet(...args);
}

export function runOnUIAsync<Args extends unknown[], Return>(
  worklet: (...args: Args) => Return,
  ...args: Args
): Promise<Return> {
  return Promise.resolve(worklet(...args));
}

export function executeOnUIRuntimeSync<Args extends unknown[], Return>(
  worklet: (...args: Args) => Return,
): (...args: Args) => Return {
  return worklet;
}

export function runOnRuntime<Args extends unknown[], Return>(
  workletRuntime: WorkletRuntime,
  worklet: (...args: Args) => Return,
): (...args: Args) => void {
  void workletRuntime;
  return worklet;
}

/** Returns an empty plain object: there is no runtime to create. */
export function createWorkletRuntime(): WorkletRuntime {
  return {};
}

/** Nothing in node has been through the worklet Babel transform. */
export function isWorkletFunction(): boolean {
  return false;
}

export function callMicrotasks(): void {}

// Memory / serialisation helpers: identity, and never "a ref".
export function createSerializable<T>(value: T): T {
  return value;
}
export function isSerializableRef(): boolean {
  return false;
}
/** @deprecated names the real index still ships. */
export function makeShareable<T>(value: T): T {
  return value;
}
export function makeShareableCloneRecursive<T>(value: T): T {
  return value;
}
export function makeShareableCloneOnUIRecursive<T>(value: T): T {
  return value;
}
export function isShareableRef(): boolean {
  return false;
}
