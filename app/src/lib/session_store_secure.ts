/**
 * SecureStore-backed session persistence (M8-T01). The refresh token is a
 * long-lived credential, so it lives in the platform keychain/keystore —
 * never AsyncStorage (Hard rule H). This is the ONLY module importing
 * expo-secure-store; everything else uses the pure SessionStore contract.
 */

import * as SecureStore from 'expo-secure-store';

import type { AuthSession } from './auth';
import { isSession, type SessionStore } from './session_store';

const KEY = 'roadopia.auth.session.v1';

export const secureSessionStore: SessionStore = {
  async load(): Promise<AuthSession | null> {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      return isSession(parsed) ? parsed : null;
    } catch {
      return null; // an unreadable session is an absent session, never a crash
    }
  },
  async save(session: AuthSession): Promise<void> {
    await SecureStore.setItemAsync(KEY, JSON.stringify(session));
  },
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY);
  },
};
