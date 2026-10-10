/**
 * CONSOL AppContext
 * Coordinates navigation, hash routing, toast messaging, and modal infrastructure.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { AppRoute, parseHash } from '../types/routes';

export interface ToastState {
  message: string;
  type: 'info' | 'error';
  visible: boolean;
}

export interface AppContextValue {
  route: AppRoute;
  specimenId: string | null;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  navigate: (hashOrSlug: string) => void;
  toast: (message: string, type?: 'info' | 'error') => void;
  toastState: ToastState;
  activeModal: string | null;
  modalPayload: unknown;
  openModal: (modalId: string, payload?: unknown) => void;
  closeModal: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [route, setRoute] = useState<AppRoute>('home');
  const [specimenId, setSpecimenId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('Overview');

  const [toastState, setToastState] = useState<ToastState>({
    message: '',
    type: 'info',
    visible: false
  });

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [modalPayload, setModalPayload] = useState<unknown>(null);

  // Synchronise route from hash
  const syncHash = useCallback(() => {
    const parsed = parseHash(window.location.hash);
    setRoute(parsed.route);
    setSpecimenId(parsed.specimenId);
  }, []);

  useEffect(() => {
    // Initial sync
    if (!window.location.hash) {
      window.location.hash = '#/home';
    }
    syncHash();

    const handleHashChange = () => {
      syncHash();
      // Close modal on navigation
      setActiveModal(null);
    };

    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('popstate', handleHashChange);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActiveModal(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('popstate', handleHashChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [syncHash]);

  const navigate = useCallback((target: string) => {
    const formatted = target.startsWith('#')
      ? target
      : `#/${target.replace(/^\//, '')}`;

    if (window.location.hash === formatted) {
      syncHash();
    } else {
      window.location.hash = formatted;
    }
  }, [syncHash]);

  const triggerToast = useCallback((message: string, type: 'info' | 'error' = 'info') => {
    setToastState({ message, type, visible: true });

    // Also update existing #toast element if present in DOM for compatibility
    const toastEl = document.getElementById('toast');
    if (toastEl) {
      toastEl.textContent = message;
      toastEl.className = `toast show${type === 'error' ? ' error' : ''}`;
    }

    window.setTimeout(() => {
      setToastState(prev => ({ ...prev, visible: false }));
      if (toastEl) {
        toastEl.className = 'toast';
      }
    }, 4200);
  }, []);

  const openModal = useCallback((modalId: string, payload?: unknown) => {
    setActiveModal(modalId);
    setModalPayload(payload ?? null);
  }, []);

  const closeModal = useCallback(() => {
    setActiveModal(null);
    setModalPayload(null);
  }, []);

  const value = useMemo<AppContextValue>(() => ({
    route,
    specimenId,
    activeTab,
    setActiveTab,
    navigate,
    toast: triggerToast,
    toastState,
    activeModal,
    modalPayload,
    openModal,
    closeModal
  }), [
    route,
    specimenId,
    activeTab,
    navigate,
    triggerToast,
    toastState,
    activeModal,
    modalPayload,
    openModal,
    closeModal
  ]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return ctx;
}
