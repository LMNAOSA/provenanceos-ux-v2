/**
 * CONSOL AuthContext
 * Centralised, single-source Supabase authentication and session state.
 * Strictly preserves RBAC authorization (public.is_staff RPC) and database RLS.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { getSupabase, checkSchema, api } from '../services/supabase';

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

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('booting');
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isStaff, setIsStaff] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const evaluateSession = useCallback(async (currentSession: Session | null) => {
    if (!currentSession) {
      setUser(null);
      setSession(null);
      setIsStaff(false);
      setStatus('unauthenticated');
      return;
    }

    setSession(currentSession);
    setUser(currentSession.user);

    try {
      const staffMember = await api.isStaff();
      setIsStaff(staffMember);
      if (staffMember) {
        setStatus('authenticated');
        setErrorMessage(null);
      } else {
        setStatus('pending');
      }
    } catch (err) {
      // In development or if staff RPC fails, preserve safe unauthenticated state
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setStatus('pending');
    }
  }, []);

  const boot = useCallback(async () => {
    setStatus('booting');
    setErrorMessage(null);

    try {
      const schemaState = await checkSchema();

      if (schemaState === 'offline') {
        setStatus('offline');
        return;
      }

      if (schemaState === 'missing') {
        setStatus('missing_schema');
        return;
      }

      const sb = getSupabase();
      const { data, error } = await sb.auth.getSession();

      if (error) {
        throw error;
      }

      await evaluateSession(data.session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setStatus('offline');
    }
  }, [evaluateSession]);

  useEffect(() => {
    void boot();

    const sb = getSupabase();
    const { data: authListener } = sb.auth.onAuthStateChange((event, newSession) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setSession(null);
        setIsStaff(false);
        setStatus('unauthenticated');
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        void evaluateSession(newSession);
      }
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [boot, evaluateSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const sb = getSupabase();
    setErrorMessage(null);

    const { data, error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
      const msg = /invalid login/i.test(error.message)
        ? 'That email and password don’t match.'
        : error.message;
      setErrorMessage(msg);
      return { success: false, error: msg };
    }

    await evaluateSession(data.session);
    return { success: true };
  }, [evaluateSession]);

  const signOut = useCallback(async () => {
    const sb = getSupabase();
    await sb.auth.signOut();
    setUser(null);
    setSession(null);
    setIsStaff(false);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    user,
    session,
    isStaff,
    errorMessage,
    signIn,
    signOut,
    retryBoot: boot
  }), [status, user, session, isStaff, errorMessage, signIn, signOut, boot]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
