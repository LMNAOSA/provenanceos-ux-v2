/**
 * CONSOL AuthContext
 * Centralised, single-source Supabase authentication and session state.
 * Strictly enforces:
 * 1. Valid authenticated session restoration verified via server-side getUser() + public.is_staff() RPC
 * 2. Unauthenticated users always see LoginScreen before any protected content mounts
 * 3. Authenticated non-staff users see PendingScreen (access denied / awaiting authorisation)
 * 4. Expired or revoked sessions are cleared locally and returned to LoginScreen
 * 5. Network / authentication transport failures transition to OfflineScreen (never auto-authorising)
 * 6. Sign-out immediately clears local state, signed URL caches, and Supabase session
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { getSupabase, checkSchema, api, clearSignedUrlCache } from '../services/supabase';

export type AuthStatus =
  | 'booting'
  | 'offline'
  | 'missing_schema'
  | 'unauthenticated'
  | 'pending'
  | 'authenticated';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  isStaff: boolean;
  errorMessage: string | null;
  signIn: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signOut: () => Promise<void>;
  retryBoot: () => Promise<void>;
}

const GLOBAL_AUTH_CTX_KEY = '__CONSOL_AUTH_REACT_CONTEXT__';
const GLOBAL_AUTH_VAL_KEY = '__CONSOL_AUTH_LATEST_VALUE__';
const globalAuthStore = globalThis as unknown as Record<string, unknown>;

const AuthContext: React.Context<AuthContextValue | null> =
  (globalAuthStore[GLOBAL_AUTH_CTX_KEY] as React.Context<AuthContextValue | null>) ||
  ((globalAuthStore[GLOBAL_AUTH_CTX_KEY] = createContext<AuthContextValue | null>(
    null
  )) as React.Context<AuthContextValue | null>);

export function isNetworkErrorMessage(msg: string): boolean {
  return /failed to fetch|networkerror|network request failed|load failed|fetch error|offline/i.test(msg);
}

export function isAuthOrExpiredTokenError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; status?: number; message?: string; name?: string };
  const msg = (e.message || '').toLowerCase();
  const code = (e.code || '').toLowerCase();
  if (e.status === 401 || e.status === 403) return true;
  if (
    code === 'pgrst301' ||
    code === 'invalid_jwt' ||
    code === 'session_not_found' ||
    code === 'user_not_found' ||
    code === 'refresh_token_not_found' ||
    code === 'bad_jwt'
  ) {
    return true;
  }
  if (
    /jwt expired|invalid jwt|invalid token|token is expired|session_not_found|user from sub claim in jwt does not exist|not authenticated|refresh token not found/i.test(
      msg
    )
  ) {
    return true;
  }
  return false;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('booting');
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isStaff, setIsStaff] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const evalSeqRef = useRef(0);

  const clearLocalAuthState = useCallback(() => {
    setUser(null);
    setSession(null);
    setIsStaff(false);
    clearSignedUrlCache();
    delete globalAuthStore[GLOBAL_AUTH_VAL_KEY];
  }, []);

  const evaluateSession = useCallback(
    async (candidateSession: Session | null, options?: { skipServerUserCheck?: boolean }) => {
      const seq = ++evalSeqRef.current;

      if (!candidateSession || !candidateSession.access_token || !candidateSession.user) {
        clearLocalAuthState();
        setStatus('unauthenticated');
        return;
      }

      const sb = getSupabase();
      let activeSession = candidateSession;

      // 1. Check token expiry timestamp; refresh if already expired locally
      if (
        typeof activeSession.expires_at === 'number' &&
        activeSession.expires_at * 1000 <= Date.now() + 5000
      ) {
        try {
          const { data: refreshed, error: refreshErr } = await sb.auth.refreshSession();
          if (seq !== evalSeqRef.current) return;
          if (refreshErr || !refreshed.session) {
            if (refreshErr && isNetworkErrorMessage(refreshErr.message || '')) {
              clearLocalAuthState();
              setErrorMessage('Cannot reach authentication server to refresh session.');
              setStatus('offline');
              return;
            }
            await sb.auth.signOut({ scope: 'local' }).catch(() => {});
            clearLocalAuthState();
            setStatus('unauthenticated');
            return;
          }
          activeSession = refreshed.session;
        } catch (err) {
          if (seq !== evalSeqRef.current) return;
          const msg = err instanceof Error ? err.message : String(err);
          if (isNetworkErrorMessage(msg)) {
            clearLocalAuthState();
            setErrorMessage(msg);
            setStatus('offline');
            return;
          }
          await sb.auth.signOut({ scope: 'local' }).catch(() => {});
          clearLocalAuthState();
          setStatus('unauthenticated');
          return;
        }
      }

      // 2. Verify token server-side with Supabase Auth unless just returned by signInWithPassword
      let verifiedUser: User = activeSession.user;
      if (!options?.skipServerUserCheck) {
        try {
          const { data: userData, error: userErr } = await sb.auth.getUser(activeSession.access_token);
          if (seq !== evalSeqRef.current) return;

          if (userErr) {
            const msg = userErr.message || String(userErr);
            if (isNetworkErrorMessage(msg)) {
              clearLocalAuthState();
              setErrorMessage(msg);
              setStatus('offline');
              return;
            }
            // Expired, revoked, or invalid session token
            await sb.auth.signOut({ scope: 'local' }).catch(() => {});
            clearLocalAuthState();
            setStatus('unauthenticated');
            return;
          }

          if (!userData?.user) {
            await sb.auth.signOut({ scope: 'local' }).catch(() => {});
            clearLocalAuthState();
            setStatus('unauthenticated');
            return;
          }

          verifiedUser = userData.user;
        } catch (err) {
          if (seq !== evalSeqRef.current) return;
          const msg = err instanceof Error ? err.message : String(err);
          if (isNetworkErrorMessage(msg)) {
            clearLocalAuthState();
            setErrorMessage(msg);
            setStatus('offline');
            return;
          }
          await sb.auth.signOut({ scope: 'local' }).catch(() => {});
          clearLocalAuthState();
          setStatus('unauthenticated');
          return;
        }
      }

      // 3. Enforce backend staff authorisation (public.is_staff RPC)
      try {
        const staffMember = await api.isStaff();
        if (seq !== evalSeqRef.current) return;

        setSession(activeSession);
        setUser(verifiedUser);
        setIsStaff(staffMember);

        if (staffMember) {
          setErrorMessage(null);
          setStatus('authenticated');
        } else {
          setStatus('pending');
        }
      } catch (err) {
        if (seq !== evalSeqRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);

        if (isAuthOrExpiredTokenError(err)) {
          await sb.auth.signOut({ scope: 'local' }).catch(() => {});
          clearLocalAuthState();
          setStatus('unauthenticated');
          return;
        }

        if (isNetworkErrorMessage(msg)) {
          clearLocalAuthState();
          setErrorMessage(msg);
          setStatus('offline');
          return;
        }

        // Non-network RPC failure: never auto-authorise
        clearLocalAuthState();
        setErrorMessage(msg);
        setStatus('offline');
      }
    },
    [clearLocalAuthState]
  );

  const boot = useCallback(async () => {
    setStatus('booting');
    setErrorMessage(null);

    try {
      const schemaState = await checkSchema();

      if (schemaState === 'offline') {
        clearLocalAuthState();
        setErrorMessage('Can’t reach Supabase. Check your signal and try again.');
        setStatus('offline');
        return;
      }

      if (schemaState === 'missing') {
        clearLocalAuthState();
        setStatus('missing_schema');
        return;
      }

      const sb = getSupabase();
      const { data, error } = await sb.auth.getSession();

      if (error) {
        if (isAuthOrExpiredTokenError(error)) {
          await sb.auth.signOut({ scope: 'local' }).catch(() => {});
          clearLocalAuthState();
          setStatus('unauthenticated');
          return;
        }
        throw error;
      }

      if (!data?.session) {
        clearLocalAuthState();
        setStatus('unauthenticated');
        return;
      }

      await evaluateSession(data.session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      clearLocalAuthState();
      setErrorMessage(msg);
      setStatus('offline');
    }
  }, [clearLocalAuthState, evaluateSession]);

  useEffect(() => {
    void boot();

    const sb = getSupabase();
    const { data: authListener } = sb.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_OUT') {
        evalSeqRef.current++;
        clearLocalAuthState();
        setErrorMessage(null);
        setStatus('unauthenticated');
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        void evaluateSession(newSession);
      }
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [boot, clearLocalAuthState, evaluateSession]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const sb = getSupabase();
      setErrorMessage(null);

      try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });

        if (error) {
          const msg = /invalid login/i.test(error.message)
            ? 'That email and password don’t match.'
            : error.message;
          setErrorMessage(msg);
          return { success: false, error: msg };
        }

        await evaluateSession(data.session, { skipServerUserCheck: true });
        return { success: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMessage(msg);
        return { success: false, error: msg };
      }
    },
    [evaluateSession]
  );

  const signOut = useCallback(async () => {
    evalSeqRef.current++;
    clearLocalAuthState();
    setErrorMessage(null);
    setStatus('unauthenticated');

    try {
      const sb = getSupabase();
      await sb.auth.signOut();
    } catch {
      // Local state is already cleared; ensure local storage token is also purged
      try {
        const sb = getSupabase();
        await sb.auth.signOut({ scope: 'local' });
      } catch {
        // ignore
      }
    }
  }, [clearLocalAuthState]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      session,
      isStaff,
      errorMessage,
      signIn,
      signOut,
      retryBoot: boot
    }),
    [status, user, session, isStaff, errorMessage, signIn, signOut, boot]
  );

  globalAuthStore[GLOBAL_AUTH_VAL_KEY] = value;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx) {
    return ctx;
  }
  const fallback = globalAuthStore[GLOBAL_AUTH_VAL_KEY] as AuthContextValue | undefined;
  if (fallback) {
    return fallback;
  }
  throw new Error('useAuth must be used within an AuthProvider');
}
