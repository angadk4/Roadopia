/**
 * React wiring for auth (M8-T01) — a thin context over AuthEngine.
 *
 * Screens consume:
 *   const { status, user, gate, signOut } = useAuth();
 *   gate(() => saveRoute(...));   // FR-201: the ONLY sign-in trigger
 * The SignInSheet renders once at the root, driven by the same context.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { AuthEngine, type AuthState } from './auth_state';
import { getSupabaseConfig } from './runtime';
import { type SessionStore } from './session_store';

export interface AuthContextValue {
  status: AuthState['status'];
  user: { id: string; email: string } | null;
  sheetOpen: boolean;
  gate: (action: () => void) => void;
  dismissSheet: () => void;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  freshAccessToken: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider(props: {
  children: ReactNode;
  /** Tests inject a full engine; the app root injects the SecureStore-backed
   *  store (keeping this module Expo-free and node-testable). One of the two
   *  is required — silent non-persistence is a bug, not a default. */
  engine?: AuthEngine;
  store?: SessionStore;
}): ReactElement {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    session: null,
    sheetOpen: false,
  });
  const engine = useMemo(() => {
    if (props.engine) return props.engine;
    if (!props.store) throw new Error('AuthProvider needs an engine or a session store');
    return new AuthEngine({ cfg: getSupabaseConfig(), store: props.store });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- construct once
  }, []);
  useEffect(() => {
    engine.setListener(setState);
    setState(engine.getState());
    void engine.init();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status: state.status,
      user: state.session?.user ?? null,
      sheetOpen: state.sheetOpen,
      gate: (a) => engine.gate(a),
      dismissSheet: () => engine.dismissSheet(),
      sendCode: (email) => engine.sendCode(email),
      verifyCode: (email, code) => engine.verifyCode(email, code),
      freshAccessToken: () => engine.freshAccessToken(),
      signOut: () => engine.signOut(),
    }),
    [state, engine],
  );
  return <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
