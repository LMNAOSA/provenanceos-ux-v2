/**
 * CONSOL AppContext
 * Version 3.3 — Adaptive Instrument UX + Four-Pillar Workstation State
 *
 * Manages:
 * - Adaptive navigation modes:
 *   • 'workstation': Normal 232px rail for Collection, Science, and Workspace
 *   • 'instrument': Compact 60px icon rail automatically activated in SOLARIUM (expandable on demand)
 *   • 'immersive': Full-viewport instrument mode in SOLARIUM with minimal chrome (Esc exits)
 * - Persistent activeSpecimenId across all pillars and modules
 * - One-pillar-at-a-time default accordion behaviour
 * - Hash routing, toast messaging, and Stage 5A modal state
 */

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { AppRoute, PillarId, parseHash, getPillarForRoute } from '../types/routes';

export type NavigationMode = 'workstation' | 'instrument' | 'immersive';

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
  navigationMode: NavigationMode;
  railCollapsed: boolean;
  setRailCollapsed: (collapsed: boolean) => void;
  instrumentRailExpanded: boolean;
  setInstrumentRailExpanded: (expanded: boolean) => void;
  immersiveMode: boolean;
  setImmersiveMode: (immersive: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
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
  WORKSTATION_RAIL_COLLAPSED: 'consol.workstationRailCollapsed'
};

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

const GLOBAL_APP_CTX_KEY = '__CONSOL_APP_REACT_CONTEXT__';
const GLOBAL_APP_VAL_KEY = '__CONSOL_APP_LATEST_VALUE__';
const globalStore = globalThis as unknown as Record<string, unknown>;

const AppContext: React.Context<AppContextValue | null> =
  (globalStore[GLOBAL_APP_CTX_KEY] as React.Context<AppContextValue | null>) ||
  ((globalStore[GLOBAL_APP_CTX_KEY] = createContext<AppContextValue | null>(
    null
  )) as React.Context<AppContextValue | null>);

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

  // Workstation rail collapse preference (used outside SOLARIUM)
  const [workstationRailCollapsed, setWorkstationRailCollapsed] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined') {
        return window.localStorage.getItem(STORAGE_KEYS.WORKSTATION_RAIL_COLLAPSED) === 'true';
      }
    } catch {
      // ignore
    }
    return false;
  });

  // Instrument mode rail override: in SOLARIUM, rail defaults to collapsed (false = compact 60px instrument rail)
  // Researchers can expand the rail while in SOLARIUM and collapse it again.
  const [instrumentRailExpanded, setInstrumentRailExpanded] = useState<boolean>(false);

  // Immersive full-viewport instrument mode inside SOLARIUM
  const [immersiveMode, setImmersiveModeState] = useState<boolean>(false);

  // Mobile navigation drawer state
  const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);

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

  // Effective railCollapsed state:
  // - In SOLARIUM or SOLOPTICS: collapsed by default (!instrumentRailExpanded)
  // - In other workspaces: uses workstationRailCollapsed (false by default -> 232px normal rail)
  const isInstrumentRoute = route === 'solarium' || route === 'soloptics';
  const railCollapsed = isInstrumentRoute ? !instrumentRailExpanded : workstationRailCollapsed;

  const setRailCollapsed = useCallback((collapsed: boolean) => {
    if (route === 'solarium' || route === 'soloptics') {
      setInstrumentRailExpanded(!collapsed);
      return;
    }
    setWorkstationRailCollapsed(collapsed);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEYS.WORKSTATION_RAIL_COLLAPSED, String(collapsed));
      }
    } catch {
      // ignore
    }
  }, [route]);

  const setImmersiveMode = useCallback((immersive: boolean) => {
    setImmersiveModeState(immersive);
    if (immersive) {
      setMobileNavOpen(false);
    }
  }, []);

  const navigationMode: NavigationMode = useMemo(() => {
    if (route === 'solarium' || route === 'soloptics') {
      if (immersiveMode) return 'immersive';
      return 'instrument';
    }
    return 'workstation';
  }, [route, immersiveMode]);

  const syncHash = useCallback(() => {
    const parsed = parseHash(window.location.hash);
    setRoute(prevRoute => {
      const nextIsInstrument = parsed.route === 'solarium' || parsed.route === 'soloptics';
      const prevIsInstrument = prevRoute === 'solarium' || prevRoute === 'soloptics';
      // When entering SOLARIUM or SOLOPTICS from another workspace, activate compact instrument rail automatically
      if (nextIsInstrument && !prevIsInstrument) {
        setInstrumentRailExpanded(false);
      }
      // When leaving SOLARIUM or SOLOPTICS for another workspace, exit immersive mode and reset instrument rail override
      if (!nextIsInstrument && prevIsInstrument) {
        setImmersiveModeState(false);
        setInstrumentRailExpanded(false);
      }
      return parsed.route;
    });
    setSpecimenId(parsed.specimenId);
    setSubId(parsed.subId ?? null);
    setMobileNavOpen(false);

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

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('popstate', handleHashChange);
    };
  }, [syncHash]);

  // Escape key handler: exits modal first, or exits SOLARIUM immersive mode without disrupting viewer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (activeModal) {
          setActiveModal(null);
          return;
        }
        if (mobileNavOpen) {
          setMobileNavOpen(false);
          return;
        }
        if (immersiveMode) {
          setImmersiveModeState(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeModal, mobileNavOpen, immersiveMode]);

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
    navigationMode,
    railCollapsed,
    setRailCollapsed,
    instrumentRailExpanded,
    setInstrumentRailExpanded,
    immersiveMode,
    setImmersiveMode,
    mobileNavOpen,
    setMobileNavOpen,
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
    navigationMode,
    railCollapsed,
    setRailCollapsed,
    instrumentRailExpanded,
    immersiveMode,
    setImmersiveMode,
    mobileNavOpen,
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

  globalStore[GLOBAL_APP_VAL_KEY] = value;

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (ctx) {
    return ctx;
  }
  const fallback = globalStore[GLOBAL_APP_VAL_KEY] as AppContextValue | undefined;
  if (fallback) {
    return fallback;
  }
  throw new Error('useApp must be used within an AppProvider');
}
