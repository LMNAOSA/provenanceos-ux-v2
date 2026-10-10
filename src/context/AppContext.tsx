/**
 * CONSOL AppContext
 * Coordinates four-pillar navigation (one pillar expanded at a time by default),
 * persistent specimen context across modules, navigation history, hash routing,
 * toast messaging, and modal infrastructure.
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { AppRoute, PillarId, parseHash, getPillarForRoute } from '../types/routes';

export interface ToastState {
  message: string;
  type: 'info' | 'error';
  visible: boolean;
}

export interface NavigationHistoryEntry {
  route: AppRoute;
  specimenId: string | null;
  subId: string | null;
  hash: string;
  timestamp: string;
}

export interface AppContextValue {
  route: AppRoute;
  specimenId: string | null;
  subId: string | null;
  activeSpecimenId: string | null;
  setActiveSpecimenId: (id: string | null) => void;
  activePillar: PillarId | null;
  expandedPillars: Record<PillarId, boolean>;
  togglePillar: (pillar: PillarId) => void;
  railCollapsed: boolean;
  setRailCollapsed: (collapsed: boolean) => void;
  navigationHistory: NavigationHistoryEntry[];
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

const STORAGE_KEYS = {
  ACTIVE_SPECIMEN: 'consol.activeSpecimenId',
  EXPANDED_PILLARS: 'consol.expandedPillars.v2',
  RAIL_COLLAPSED: 'consol.railCollapsed'
};

// One pillar expanded at a time by default
const DEFAULT_EXPANDED_PILLARS: Record<PillarId, boolean> = {
  COLLECTION: true,
  SCIENCE: false,
  VISUALISATION: false,
  WORKSPACE: false
};

function singleExpandedPillar(target: PillarId): Record<PillarId, boolean> {
  return {
    COLLECTION: target === 'COLLECTION',
    SCIENCE: target === 'SCIENCE',
    VISUALISATION: target === 'VISUALISATION',
    WORKSPACE: target === 'WORKSPACE'
  };
}

const AppContext = createContext<AppContextValue | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [route, setRoute] = useState<AppRoute>('home');
  const [specimenId, setSpecimenId] = useState<string | null>(null);
  const [subId, setSubId] = useState<string | null>(null);

  const [activeSpecimenId, setActiveSpecimenIdState] = useState<string | null>(() => {
    try {
      return typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEYS.ACTIVE_SPECIMEN) : null;
    } catch {
      return null;
    }
  });

  const [expandedPillars, setExpandedPillars] = useState<Record<PillarId, boolean>>(() => {
    try {
      if (typeof window !== 'undefined') {
        const raw = window.localStorage.getItem(STORAGE_KEYS.EXPANDED_PILLARS);
        if (raw) {
          const parsed = JSON.parse(raw);
          return { ...DEFAULT_EXPANDED_PILLARS, ...parsed };
        }
      }
    } catch {
      // ignore
    }
    return DEFAULT_EXPANDED_PILLARS;
  });

  const [railCollapsed, setRailCollapsedState] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined') {
        return window.localStorage.getItem(STORAGE_KEYS.RAIL_COLLAPSED) === 'true';
      }
    } catch {
      // ignore
    }
    return false;
  });

  const [navigationHistory, setNavigationHistory] = useState<NavigationHistoryEntry[]>([]);
  const [activeTab, setActiveTab] = useState<string>('Overview');

  const [toastState, setToastState] = useState<ToastState>({
    message: '',
    type: 'info',
    visible: false
  });

  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [modalPayload, setModalPayload] = useState<unknown>(null);

  const setActiveSpecimenId = useCallback((id: string | null) => {
    setActiveSpecimenIdState(id);
    try {
      if (typeof window !== 'undefined') {
        if (id) {
          window.localStorage.setItem(STORAGE_KEYS.ACTIVE_SPECIMEN, id);
        } else {
          window.localStorage.removeItem(STORAGE_KEYS.ACTIVE_SPECIMEN);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Accordion behaviour: one pillar expanded at a time by default
  const togglePillar = useCallback((pillar: PillarId) => {
    setExpandedPillars(prev => {
      const willOpen = !prev[pillar];
      const next: Record<PillarId, boolean> = willOpen
        ? singleExpandedPillar(pillar)
        : { ...prev, [pillar]: false };
      try {
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(STORAGE_KEYS.EXPANDED_PILLARS, JSON.stringify(next));
        }
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const setRailCollapsed = useCallback((collapsed: boolean) => {
    setRailCollapsedState(collapsed);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEYS.RAIL_COLLAPSED, String(collapsed));
      }
    } catch {
      // ignore
    }
  }, []);

  const syncHash = useCallback(() => {
    const parsed = parseHash(window.location.hash);
    setRoute(parsed.route);
    setSpecimenId(parsed.specimenId);
    setSubId(parsed.subId ?? null);

    if (parsed.specimenId) {
      setActiveSpecimenId(parsed.specimenId);
    }

    const routePillar = getPillarForRoute(parsed.route);
    if (routePillar) {
      setExpandedPillars(prev => {
        if (prev[routePillar]) return prev;
        const next = singleExpandedPillar(routePillar);
        try {
          window.localStorage.setItem(STORAGE_KEYS.EXPANDED_PILLARS, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    }

    setNavigationHistory(prev => {
      const top = prev[0];
      if (top && top.hash === parsed.hash) return prev;
      const entry: NavigationHistoryEntry = {
        route: parsed.route,
        specimenId: parsed.specimenId,
        subId: parsed.subId ?? null,
        hash: parsed.hash,
        timestamp: new Date().toISOString()
      };
      return [entry, ...prev].slice(0, 12);
    });
  }, [setActiveSpecimenId]);

  useEffect(() => {
    if (!window.location.hash) {
      window.location.hash = '#/home';
    }
    syncHash();

    const handleHashChange = () => {
      syncHash();
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

  const activePillar = useMemo(() => getPillarForRoute(route), [route]);

  const value = useMemo<AppContextValue>(() => ({
    route,
    specimenId,
    subId,
    activeSpecimenId,
    setActiveSpecimenId,
    activePillar,
    expandedPillars,
    togglePillar,
    railCollapsed,
    setRailCollapsed,
    navigationHistory,
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
    subId,
    activeSpecimenId,
    setActiveSpecimenId,
    activePillar,
    expandedPillars,
    togglePillar,
    railCollapsed,
    setRailCollapsed,
    navigationHistory,
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
