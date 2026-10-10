/**
 * CONSOL — Central Scientific Intelligence & Operational Command Centre
 * Version 3.7 | Jony Ive Precision Reduction & On-Demand Deployable Workspace Architecture
 *
 * Sits above the four operational pillars (Collection · Science · Visualisation · Workspace)
 * as the primary authenticated landing experience (#/home, #/consol).
 *
 * Design & Functional Architecture:
 * 1. Serene Focal Anchor (Ask CONSOL): Clean, single-elevation interrogation instrument with
 *    unboxed metadata, scope isolation (All Data / Historical / Contemporary), and collapsible
 *    example queries.
 * 2. Answer-First Result Card: Direct natural-language answer, measured value & unit,
 *    record/specimen identity, source dataset & original workbook reference, on-demand
 *    expandable qualifications/rankings/charts, and explicit Close (✕) control.
 * 3. Deployable Workspace Modules: All operational boxes (Historical Explorer, Specimen Registry,
 *    pXRF Stream, Batches & Reference, Source Inspector, Team Review Inbox, and Provenance Stream)
 *    are stowed by default in a precision telemetry launcher bar and deploy/close on demand.
 */

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import config from '../../config';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { api, signed } from '../../services/supabase';
import {
  SpecimenOverview,
  SpecimenCounts,
  ImportBatch,
  SpecimenEvent,
  Analysis,
  HistoricalDataset,
  HistoricalRecord,
  HistoricalDatabaseCounts,
  ElementalResult,
  SpecimenCode,
  SPECIMEN_TYPES,
  SPECIMEN_TYPE_BY_CODE
} from '../../types';
import type { InvestigationRecord } from './TheLabView';
import { HistoricalDataExplorer } from './HistoricalDataExplorer';
import { TeamIntelligenceInbox } from './TeamIntelligenceInbox';
import {
  ELEMENT_NAMES,
  INITIAL_QUERY_SESSION,
  formatHistoricalObservation,
  interrogateConsolData,
  type SearchScope,
  type QuerySessionContext
} from '../../services/historicalIntelligence';

const EVENT_LABELS: Record<string, string> = {
  registered: 'Registered',
  photographed: 'Evidence captured',
  analysed: 'pXRF attached',
  measured: 'Dimensions estimated',
  treated: 'Treatment recorded'
};

export type DeployableModuleId =
  | 'historical-explorer'
  | 'specimens'
  | 'pxrf-stream'
  | 'imports-reference'
  | 'source-inspector'
  | 'team-inbox'
  | 'provenance';

type SpecimenStatusFilter = 'ALL' | 'HAS_PXRF' | 'HAS_MEDIA' | 'NEEDS_PXRF';
type SortField = 'created_at' | 'id' | 'sample_code' | 'weight_g' | 'image_count' | 'analysis_count';
type SortDirection = 'asc' | 'desc';
type InspectorMode = 'specimen' | 'historical';

export interface NamedElementalResult extends ElementalResult {
  element: string;
}

const DRAFT_INVESTIGATIONS_KEY = 'consol.investigations.drafts.v4';

const ASK_CONSOL_PRESETS: Array<{ label: string; query: string }> = [
  { label: 'Highest Sulfur (S)', query: 'Highest sulfur' },
  { label: 'Highest Fe locations', query: 'Highest Fe' },
  { label: 'Zr & Sr trace profile', query: 'Zr Sr' },
  { label: 'Coober Pedy vs Lightning Ridge', query: 'Coober Pedy, Lightning Ridge' },
  { label: 'Fe > 2500 ppm', query: 'Fe > 2500' },
  { label: '<LOD Qualification Audit', query: 'below LOD' },
  { label: '2018 Dataset Summary (792 obs)', query: '2018 dataset summary' }
];

const FOLLOW_UP_CHIPS: Array<{ label: string; command: string }> = [
  { label: 'Show me the next five', command: 'Show me the next five' },
  { label: 'Now compare those with chromium', command: 'Now compare those with chromium' },
  { label: 'Only show Coober Pedy', command: 'Only show Coober Pedy' },
  { label: 'Display the source measurements', command: 'Display the source measurements' }
];

function loadLabInvestigationsSummary(): InvestigationRecord[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(DRAFT_INVESTIGATIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Formats a contemporary specimen elemental reading with strict scientific unit & LOD discipline.
 */
function formatElementValue(el: ElementalResult): {
  valueText: string;
  unitText: string;
  uncertaintyText: string | null;
  isLod: boolean;
} {
  const unitText = el.unit ? el.unit : 'unit unrecorded';
  if (el.lod) {
    const lodLimit =
      el.limit !== null && el.limit !== undefined && Number.isFinite(Number(el.limit))
        ? `<LOD (${Number(el.limit).toLocaleString('en-AU', { maximumFractionDigits: 4 })})`
        : '<LOD';
    return {
      valueText: lodLimit,
      unitText: el.unit || '',
      uncertaintyText: null,
      isLod: true
    };
  }

  if (el.value === null || el.value === undefined || !Number.isFinite(Number(el.value))) {
    return {
      valueText: '—',
      unitText: el.unit || '',
      uncertaintyText: null,
      isLod: false
    };
  }

  const num = Number(el.value);
  const formatted =
    Math.abs(num) >= 100
      ? num.toLocaleString('en-AU', { maximumFractionDigits: 1 })
      : num.toLocaleString('en-AU', { maximumFractionDigits: 3 });

  const uncertaintyText =
    el.error !== null && el.error !== undefined && Number.isFinite(Number(el.error))
      ? `±${Number(el.error).toLocaleString('en-AU', { maximumFractionDigits: 3 })}`
      : null;

  return {
    valueText: formatted,
    unitText,
    uncertaintyText,
    isLod: false
  };
}

function getTopElements(results: Record<string, ElementalResult> | undefined, maxCount = 5): NamedElementalResult[] {
  if (!results) return [];
  const all: NamedElementalResult[] = Object.entries(results).map(([element, res]) => ({
    ...res,
    element
  }));
  const detected = all
    .filter(e => !e.lod && e.value !== null && Number.isFinite(Number(e.value)))
    .sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
  const lods = all.filter(e => e.lod);
  return [...detected, ...lods].slice(0, maxCount);
}

function formatEventSummary(e: SpecimenEvent): string {
  const d = e.detail || {};
  if (e.kind === 'registered') {
    return `${(d.sample_type as string) || 'Specimen'} · ${(d.location as string) || 'Andamooka'}`;
  }
  if (e.kind === 'photographed') {
    return `${(d.capture_kind as string) || 'visible'} · ${(d.file_name as string) || 'media asset'}`;
  }
  if (e.kind === 'analysed') {
    const readings = Number(d.readings || 0);
    return `${readings} reading${readings === 1 ? '' : 's'} · ${(d.source_file as string) || 'Vanta export'}`;
  }
  if (e.kind === 'measured') {
    return `${(d.method as string) || '2D camera calibration'}`;
  }
  if (e.kind === 'treated') {
    return `${(d.treatment_method as string) || 'Treatment'} · ${(d.reagent_name as string) || ''}`;
  }
  return (d.file_name as string) || 'Provenance event';
}

export const HomeView: React.FC = () => {
  const {
    navigate,
    openModal,
    activeSpecimenId,
    setActiveSpecimenId
  } = useApp();
  const { user, isStaff, status } = useAuth();

  // Live backend state
  const [counts, setCounts] = useState<SpecimenCounts>({ samples: 0, photographed: 0, analysed: 0 });
  const [specimens, setSpecimens] = useState<SpecimenOverview[]>([]);
  const [recentAnalyses, setRecentAnalyses] = useState<Analysis[]>([]);
  const [recentImports, setRecentImports] = useState<ImportBatch[]>([]);
  const [historicalDatasets, setHistoricalDatasets] = useState<HistoricalDataset[]>([]);
  const [historicalRecords, setHistoricalRecords] = useState<HistoricalRecord[]>([]);
  const [historicalDbCounts, setHistoricalDbCounts] = useState<HistoricalDatabaseCounts>({
    datasets: 0,
    records: 0,
    observations: 0
  });
  const [recentEvents, setRecentEvents] = useState<SpecimenEvent[]>([]);
  const [unmatchedTotal, setUnmatchedTotal] = useState<number>(0);
  const [investigations, setInvestigations] = useState<InvestigationRecord[]>(() =>
    loadLabInvestigationsSummary()
  );
  const [urlMap, setUrlMap] = useState<((p: string | null | undefined) => string | null) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  // Ask CONSOL Answer-First & Persistent Session Context State
  const [inputQuery, setInputQuery] = useState('');
  const [executedQuery, setExecutedQuery] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('ALL');
  const [querySession, setQuerySession] = useState<QuerySessionContext>(INITIAL_QUERY_SESSION);
  const [showPresets, setShowPresets] = useState(false);
  const [expandRankings, setExpandRankings] = useState(false);
  const [expandChart, setExpandChart] = useState(false);
  const [expandQualifications, setExpandQualifications] = useState(false);

  // Deployable Workspace Boxes State — stowed by default for Jony Ive calm & zero clutter
  const [deployedModules, setDeployedModules] = useState<DeployableModuleId[]>([]);

  // Module-internal filter & sort controls
  const [classFilter, setClassFilter] = useState<'ALL' | SpecimenCode>('ALL');
  const [statusFilter, setStatusFilter] = useState<SpecimenStatusFilter>('ALL');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [eventFilter, setEventFilter] = useState<string>('ALL');

  // Historical Explorer & Source Inspector focus state
  const [selectedHistoricalRecord, setSelectedHistoricalRecord] = useState<HistoricalRecord | null>(null);
  const [explorerSourceRowNo, setExplorerSourceRowNo] = useState<number | null>(null);
  const [explorerAutoExpandRaw, setExplorerAutoExpandRaw] = useState(false);
  const [explorerFocusAnalyte, setExplorerFocusAnalyte] = useState<string>('ALL');
  const [explorerLocationFilter] = useState<string>('ALL');
  const [inspectorMode, setInspectorMode] = useState<InspectorMode>('historical');

  // Team Intelligence prefill draft state
  const [teamQuestionDraft, setTeamQuestionDraft] = useState<{
    title: string;
    questionBody: string;
    linkedHistoricalRowNo?: number | null;
    linkedHistoricalLocation?: string | null;
    linkedSpecimenId?: string | null;
    evidenceCitation?: string | null;
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const deployedWorkspaceRef = useRef<HTMLDivElement | null>(null);

  const isModuleDeployed = useCallback(
    (id: DeployableModuleId) => deployedModules.includes(id),
    [deployedModules]
  );

  const toggleModule = useCallback((id: DeployableModuleId) => {
    setDeployedModules(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    );
  }, []);

  const deployModule = useCallback((id: DeployableModuleId) => {
    setDeployedModules(prev => (prev.includes(id) ? prev : [...prev, id]));
    setTimeout(() => {
      deployedWorkspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  }, []);

  const stowModule = useCallback((id: DeployableModuleId) => {
    setDeployedModules(prev => prev.filter(m => m !== id));
  }, []);

  const stowAllModules = useCallback(() => {
    setDeployedModules([]);
  }, []);

  const loadDashboardData = useCallback((quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    Promise.all([
      api.counts(),
      api.overview({ limit: 500 }),
      api.recentAnalyses(60).catch(() => [] as Analysis[]),
      api.imports().catch(() => [] as ImportBatch[]),
      api.historicalDatasets().catch(() => [] as HistoricalDataset[]),
      api.historicalCounts().catch(() => ({ datasets: 0, records: 0, observations: 0 })),
      api.events().catch(() => [] as SpecimenEvent[]),
      api.unmatchedCount().catch(() => 0)
    ])
      .then(async ([c, specList, anaList, impList, histList, histCounts, evList, unmCount]) => {
        setCounts(c);
        setSpecimens(specList);
        setRecentAnalyses(anaList);
        setRecentImports(impList);
        setHistoricalDatasets(histList);
        setRecentEvents(evList);
        setUnmatchedTotal(unmCount);
        setInvestigations(loadLabInvestigationsSummary());

        const loadedHistRecords = await api
          .allHistoricalRecordsWithObservations(histList)
          .catch(() => [] as HistoricalRecord[]);
        setHistoricalRecords(loadedHistRecords);

        const loadedObsCount = loadedHistRecords.reduce(
          (acc, r) => acc + (r.observations?.length || 0),
          0
        );
        const verifiedCounts: HistoricalDatabaseCounts = {
          datasets: histCounts.datasets || histList.length,
          records: histCounts.records || loadedHistRecords.length,
          observations: histCounts.observations || loadedObsCount
        };
        setHistoricalDbCounts(verifiedCounts);

        if (loadedHistRecords.length > 0) {
          setSelectedHistoricalRecord(prev => {
            if (prev) return prev;
            return loadedHistRecords.find(r => r.source_row_no === 14) || loadedHistRecords[0];
          });
        }

        if (c.samples > 0 && loadedHistRecords.length === 0) {
          setInspectorMode('specimen');
        }

        setLastSyncedAt(
          new Date().toLocaleTimeString('en-AU', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
          })
        );

        const paths = specList
          .slice(0, 40)
          .map(x => x.cover_thumb_path || x.cover_path)
          .filter(Boolean);
        const getUrl = await signed(paths);
        setUrlMap(() => getUrl);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadDashboardData(false);

    const handleRefresh = () => {
      loadDashboardData(true);
    };
    window.addEventListener('consol:data-updated', handleRefresh);
    return () => {
      window.removeEventListener('consol:data-updated', handleRefresh);
    };
  }, [loadDashboardData]);

  // '/' keyboard shortcut to focus Ask CONSOL
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'SELECT'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Execute an Ask CONSOL query (supporting both new queries and conversational follow-ups)
  const runAskConsolQuery = useCallback(
    (qText: string, overrideScope?: SearchScope) => {
      const clean = qText.trim();
      setInputQuery(qText);
      setExecutedQuery(clean);
      if (!clean) {
        setQuerySession({ ...INITIAL_QUERY_SESSION, scope: overrideScope || searchScope });
        return;
      }
      const nextScope = overrideScope || searchScope;
      const res = interrogateConsolData(clean, {
        historicalDatasets,
        historicalRecords,
        historicalDbCounts,
        specimens,
        recentAnalyses,
        scope: nextScope,
        sessionContext: { ...querySession, scope: nextScope },
        isAuthenticated: status === 'authenticated',
        isStaff
      });
      if (res) {
        setQuerySession(res.updatedSession);
        if (res.showSourceMeasurements || res.isFollowUp) {
          setExpandRankings(true);
        }
        if (res.updatedSession.activeAnalytes.length >= 2) {
          setExpandChart(true);
        }
      }
    },
    [
      searchScope,
      historicalDatasets,
      historicalRecords,
      historicalDbCounts,
      specimens,
      recentAnalyses,
      querySession,
      status,
      isStaff
    ]
  );

  // Compute live interrogation result from executedQuery (or live inputQuery)
  const activeQueryText = executedQuery || inputQuery.trim();
  const interrogationResult = useMemo(() => {
    if (!activeQueryText) return null;
    return interrogateConsolData(activeQueryText, {
      historicalDatasets,
      historicalRecords,
      historicalDbCounts,
      specimens,
      recentAnalyses,
      scope: searchScope,
      sessionContext: { ...querySession, scope: searchScope },
      isAuthenticated: status === 'authenticated',
      isStaff
    });
  }, [
    activeQueryText,
    historicalDatasets,
    historicalRecords,
    historicalDbCounts,
    specimens,
    recentAnalyses,
    searchScope,
    querySession,
    status,
    isStaff
  ]);

  // Inspect Source action handler — deploys the Historical Explorer (and Source Inspector if requested)
  const handleInspectSource = useCallback(
    (rowNo: number | null, analyteFocus?: string | null, openRaw = true) => {
      if (rowNo !== null) {
        const rec = historicalRecords.find(r => r.source_row_no === rowNo) || null;
        if (rec) {
          setSelectedHistoricalRecord(rec);
          setInspectorMode('historical');
        }
        setExplorerSourceRowNo(rowNo);
        setExplorerAutoExpandRaw(openRaw);
      }
      if (analyteFocus) {
        setExplorerFocusAnalyte(analyteFocus);
      }
      deployModule('historical-explorer');
    },
    [historicalRecords, deployModule]
  );

  // Classification breakdown across registered specimens
  const classBreakdown = useMemo(() => {
    const map: Record<SpecimenCode, number> = { AHM: 0, ACC: 0, ACX: 0, OTH: 0 };
    specimens.forEach(s => {
      if (s.sample_code in map) {
        map[s.sample_code] += 1;
      } else {
        map.OTH += 1;
      }
    });
    return map;
  }, [specimens]);

  // Media evidence & analytical coverage metrics
  const coverageMetrics = useMemo(() => {
    let withPxrf = 0;
    let withMedia = 0;

    specimens.forEach(s => {
      if ((s.analysis_count || 0) > 0) withPxrf += 1;
      if ((s.image_count || 0) > 0) withMedia += 1;
    });

    const totalSkippedInBatches = recentImports.reduce((acc, b) => acc + (b.skipped_count || 0), 0);
    const reviewQueueCount = Math.max(unmatchedTotal, totalSkippedInBatches);

    const metaRecords = historicalDatasets.reduce(
      (acc, d) => acc + Number(d.metadata?.record_count || 0),
      0
    );
    const metaObs = historicalDatasets.reduce(
      (acc, d) => acc + Number(d.metadata?.observation_count || 0),
      0
    );

    const totalHistoricalRecords = historicalDbCounts.records || historicalRecords.length || metaRecords;
    const totalHistoricalObs =
      historicalDbCounts.observations ||
      historicalRecords.reduce((acc, r) => acc + (r.observations?.length || 0), 0) ||
      metaObs;

    const activeInvCount = investigations.filter(
      i => i.lifecycle === 'Active' || i.lifecycle === 'Under Review'
    ).length;

    return {
      withPxrf,
      withMedia,
      reviewQueueCount,
      totalHistoricalRecords,
      totalHistoricalObs,
      activeInvCount
    };
  }, [specimens, recentImports, unmatchedTotal, historicalDatasets, historicalRecords, historicalDbCounts, investigations]);

  const latestAnalysisBySample = useMemo(() => {
    const map = new Map<string, Analysis>();
    recentAnalyses.forEach(a => {
      if (!map.has(a.sample_id)) {
        map.set(a.sample_id, a);
      }
    });
    return map;
  }, [recentAnalyses]);

  const effectiveSpecimenId = activeSpecimenId || (specimens[0]?.id ?? null);
  const selectedSpecimen = useMemo(
    () => specimens.find(s => s.id === effectiveSpecimenId) || null,
    [specimens, effectiveSpecimenId]
  );
  const selectedSpecimenAnalyses = useMemo(
    () => recentAnalyses.filter(a => a.sample_id === effectiveSpecimenId),
    [recentAnalyses, effectiveSpecimenId]
  );
  const selectedLatestAnalysis = selectedSpecimenAnalyses[0] || null;

  const filteredSpecimens = useMemo(() => {
    const q = activeQueryText.toLowerCase();

    const filtered = specimens.filter(s => {
      if (classFilter !== 'ALL' && s.sample_code !== classFilter) return false;
      if (statusFilter === 'HAS_PXRF' && (s.analysis_count || 0) === 0) return false;
      if (statusFilter === 'HAS_MEDIA' && (s.image_count || 0) === 0) return false;
      if (statusFilter === 'NEEDS_PXRF' && (s.analysis_count || 0) > 0) return false;

      if (!q) return true;
      const latestAna = latestAnalysisBySample.get(s.id);
      const elementKeys = latestAna?.results ? Object.keys(latestAna.results).join(' ').toLowerCase() : '';

      return (
        s.id.toLowerCase().includes(q) ||
        s.sample_code.toLowerCase().includes(q) ||
        (s.sample_type || '').toLowerCase().includes(q) ||
        (s.location || '').toLowerCase().includes(q) ||
        elementKeys.includes(q)
      );
    });

    return [...filtered].sort((a, b) => {
      const factor = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'id') return a.id.localeCompare(b.id) * factor;
      if (sortField === 'sample_code') return a.sample_code.localeCompare(b.sample_code) * factor;
      if (sortField === 'weight_g') return ((a.weight_g || 0) - (b.weight_g || 0)) * factor;
      if (sortField === 'image_count') return ((a.image_count || 0) - (b.image_count || 0)) * factor;
      if (sortField === 'analysis_count') return ((a.analysis_count || 0) - (b.analysis_count || 0)) * factor;
      return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * factor;
    });
  }, [specimens, classFilter, statusFilter, activeQueryText, sortField, sortDir, latestAnalysisBySample]);

  const filteredAnalyses = useMemo(() => {
    const q = activeQueryText.toLowerCase();
    if (!q) return recentAnalyses;
    return recentAnalyses.filter(a => {
      const elementSymbols = a.results ? Object.keys(a.results).join(' ').toLowerCase() : '';
      return (
        a.sample_id.toLowerCase().includes(q) ||
        (a.instrument || '').toLowerCase().includes(q) ||
        (a.method || '').toLowerCase().includes(q) ||
        (a.reading_no || '').toLowerCase().includes(q) ||
        elementSymbols.includes(q)
      );
    });
  }, [recentAnalyses, activeQueryText]);

  const filteredEvents = useMemo(() => {
    const q = activeQueryText.toLowerCase();
    return recentEvents
      .filter(ev => {
        if (eventFilter !== 'ALL' && ev.kind !== eventFilter) return false;
        if (!q) return true;
        return (
          ev.sample_id.toLowerCase().includes(q) ||
          ev.kind.toLowerCase().includes(q) ||
          formatEventSummary(ev).toLowerCase().includes(q)
        );
      })
      .slice(0, 14);
  }, [recentEvents, eventFilter, activeQueryText]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const selectedInspectorElements = useMemo<NamedElementalResult[]>(() => {
    if (!selectedLatestAnalysis?.results) return [];
    const entries: NamedElementalResult[] = Object.entries(selectedLatestAnalysis.results).map(
      ([element, res]) => ({
        ...res,
        element
      })
    );
    return entries.sort((a, b) => {
      if (a.lod !== b.lod) return a.lod ? 1 : -1;
      return Number(b.value || 0) - Number(a.value || 0);
    });
  }, [selectedLatestAnalysis]);

  const selectedHistoricalInspectorObs = useMemo(() => {
    if (!selectedHistoricalRecord?.observations) return [];
    return [...selectedHistoricalRecord.observations].sort((a, b) => {
      const aLod = a.qualifier === 'below_lod' || a.value === null;
      const bLod = b.qualifier === 'below_lod' || b.value === null;
      if (aLod !== bLod) return aLod ? 1 : -1;
      return Number(b.value || 0) - Number(a.value || 0);
    });
  }, [selectedHistoricalRecord]);

  const maxChartValue = useMemo(() => {
    if (!interrogationResult?.chartSeries.length) return 1;
    const vals = interrogationResult.chartSeries
      .map(p => p.value || 0)
      .filter(v => Number.isFinite(v) && v > 0);
    return vals.length > 0 ? Math.max(...vals) : 1;
  }, [interrogationResult]);

  // Deployable Workspace Modules Descriptor List
  const workspaceModules: Array<{
    id: DeployableModuleId;
    label: string;
    metric: string;
    subtext: string;
  }> = [
    {
      id: 'historical-explorer',
      label: 'Historical Explorer',
      metric: loading ? '—' : `${coverageMetrics.totalHistoricalRecords} rows`,
      subtext: `${coverageMetrics.totalHistoricalObs.toLocaleString('en-AU')} verified obs`
    },
    {
      id: 'specimens',
      label: 'Specimen Registry',
      metric: loading ? '—' : String(counts.samples),
      subtext: `AHM ${classBreakdown.AHM} · ACC ${classBreakdown.ACC} · ACX ${classBreakdown.ACX}`
    },
    {
      id: 'pxrf-stream',
      label: 'pXRF Stream',
      metric: loading ? '—' : String(counts.analysed),
      subtext: `${coverageMetrics.withPxrf} specimens analysed`
    },
    {
      id: 'imports-reference',
      label: 'Batches & Reference',
      metric: loading ? '—' : String(historicalDatasets.length + recentImports.length),
      subtext: `${historicalDatasets.length} dataset · ${recentImports.length} batches`
    },
    {
      id: 'source-inspector',
      label: 'Source Inspector',
      metric:
        inspectorMode === 'historical' && selectedHistoricalRecord
          ? `Row #${selectedHistoricalRecord.source_row_no}`
          : selectedSpecimen
            ? selectedSpecimen.id
            : 'Ready',
      subtext:
        inspectorMode === 'historical' && selectedHistoricalRecord
          ? selectedHistoricalRecord.location || 'Historical row'
          : 'Elemental detail'
    },
    {
      id: 'team-inbox',
      label: 'Questions & Review',
      metric: `${investigations.length}`,
      subtext: `${coverageMetrics.activeInvCount} active in Lab`
    },
    {
      id: 'provenance',
      label: 'Provenance Stream',
      metric: loading ? '—' : String(recentEvents.length),
      subtext: 'Audit ledger events'
    }
  ];

  return (
    <div className="consol-dashboard">
      {/* 1. Refined, Quiet CONSOL Header */}
      <header className="consol-header">
        <div className="consol-header-identity">
          <h1 className="consol-title">
            <img src={config.CONSOL_LOGO} alt="CONSOL" className="consol-hero-logo" />
          </h1>
          <div className="consol-quiet-meta">
            <span>Scientific Intelligence</span>
            <span aria-hidden="true">·</span>
            <span>{coverageMetrics.totalHistoricalObs.toLocaleString('en-AU')} historical observations</span>
            <span aria-hidden="true">·</span>
            <span>{counts.samples} contemporary specimens</span>
            {lastSyncedAt && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  className="consol-inline-sync"
                  onClick={() => loadDashboardData(false)}
                  title="Synchronise with Supabase PostgreSQL"
                >
                  Synced {lastSyncedAt} ↻
                </button>
              </>
            )}
          </div>
        </div>

        <div className="consol-command-actions">
          <button
            type="button"
            className="secondary consol-action-btn"
            onClick={() => openModal('import-csv', { sampleId: null })}
          >
            Import Vanta CSV
          </button>
          <button
            type="button"
            className="secondary consol-action-btn"
            onClick={() =>
              navigate(
                activeSpecimenId
                  ? `#/soloptics/${encodeURIComponent(activeSpecimenId)}`
                  : '#/soloptics'
              )
            }
          >
            SOLOPTICS
          </button>
          <button
            type="button"
            className="secondary consol-action-btn"
            onClick={() =>
              navigate(
                activeSpecimenId
                  ? `#/solarium/${encodeURIComponent(activeSpecimenId)}`
                  : '#/solarium'
              )
            }
          >
            SOLARIUM
          </button>
          <button
            type="button"
            className="primary consol-action-btn"
            onClick={() => openModal('new-sample')}
          >
            Register Specimen
          </button>
        </div>
      </header>

      {error && (
        <div className="form-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* 2. FOCAL ANCHOR: ASK CONSOL — SCIENTIFIC INTERROGATION INSTRUMENT */}
      <section
        className="consol-ask-hero"
        aria-label="Ask CONSOL Scientific Interrogation Instrument"
      >
        <div className="consol-ask-hero-top">
          <div className="consol-ask-title-group">
            <h2 className="consol-instrument-heading">Ask CONSOL</h2>
            {querySession.activeAnalytes.length > 0 && (
              <span className="consol-quiet-context mono-cell">
                Active Context: {querySession.activeAnalytes.join(' vs ')}
                {querySession.activeLocations.length > 0
                  ? ` · ${querySession.activeLocations.join(', ')}`
                  : ''}
                {' · '}Ranks #{querySession.offset + 1}–#{querySession.offset + querySession.pageSize}
              </span>
            )}
          </div>

          {/* Scope Selector (All Data / Historical / Contemporary) */}
          <div className="consol-scope-selector" role="group" aria-label="Interrogation Data Scope">
            {(
              [
                { id: 'ALL' as SearchScope, label: 'All Data' },
                { id: 'HISTORICAL' as SearchScope, label: 'Historical' },
                { id: 'CONTEMPORARY' as SearchScope, label: 'Contemporary' }
              ]
            ).map(sc => (
              <button
                key={sc.id}
                type="button"
                className={`consol-seg-btn ${searchScope === sc.id ? 'active' : ''}`}
                onClick={() => {
                  setSearchScope(sc.id);
                  if (activeQueryText) {
                    runAskConsolQuery(activeQueryText, sc.id);
                  }
                }}
              >
                {sc.label}
              </button>
            ))}
          </div>
        </div>

        {/* Search & Question Input Form */}
        <form
          className="consol-ask-form"
          onSubmit={e => {
            e.preventDefault();
            runAskConsolQuery(inputQuery);
          }}
        >
          <div className="consol-search-wrap consol-ask-input-wrap">
            <span className="consol-search-glyph" aria-hidden="true">⌕</span>
            <input
              ref={searchInputRef}
              type="search"
              className="consol-search-input consol-ask-main-input"
              placeholder="Ask a scientific question or follow-up: e.g. 'Highest sulfur', 'Show me the next five', 'Compare with chromium'… (Press /)"
              value={inputQuery}
              onChange={e => setInputQuery(e.target.value)}
              aria-label="Ask CONSOL scientific question input"
            />
            {activeQueryText && (
              <button
                type="button"
                className="consol-search-clear"
                onClick={() => {
                  setInputQuery('');
                  setExecutedQuery('');
                  setQuerySession({ ...INITIAL_QUERY_SESSION, scope: searchScope });
                }}
              >
                Clear
              </button>
            )}
            <button type="submit" className="primary consol-ask-submit-btn">
              Interrogate
            </button>
          </div>
        </form>

        {/* Quiet Collapsible Example Queries Drawer */}
        <div className="consol-ask-footer-bar">
          <button
            type="button"
            className="consol-quiet-toggle"
            onClick={() => setShowPresets(v => !v)}
            aria-expanded={showPresets}
          >
            {showPresets ? 'Hide Example Queries ▴' : 'Example Queries ▾'}
          </button>

          {showPresets && (
            <div className="consol-ask-presets" role="group" aria-label="Scientific interrogation presets">
              {ASK_CONSOL_PRESETS.map(p => (
                <button
                  key={p.label}
                  type="button"
                  className={`consol-preset-chip ${activeQueryText.toLowerCase() === p.query.toLowerCase() ? 'active' : ''}`}
                  onClick={() => {
                    setQuerySession({ ...INITIAL_QUERY_SESSION, scope: searchScope });
                    runAskConsolQuery(p.query);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ANSWER-FIRST DIRECT SCIENTIFIC RESULT CARD (Deployable & Closable) */}
        {interrogationResult && (
          <div
            className="consol-answer-first-container"
            role="region"
            aria-label="Ask CONSOL Answer-First Scientific Result"
          >
            <div className="consol-answer-direct-card">
              {/* Top Row: Unboxed Record Kind + Provenance + Inspect Source & Close Actions */}
              <div className="consol-answer-card-header">
                <div className="consol-quiet-meta">
                  <strong>{interrogationResult.answerCard.recordKindBadge}</strong>
                  <span aria-hidden="true">·</span>
                  <span className="mono-cell">{interrogationResult.provenanceLine}</span>
                  {interrogationResult.isFollowUp && interrogationResult.followUpDescription && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Follow-up: {interrogationResult.followUpDescription}</span>
                    </>
                  )}
                </div>

                <div className="consol-answer-actions">
                  {interrogationResult.answerCard.targetSourceRowNo !== null && (
                    <button
                      type="button"
                      className="primary consol-inspect-source-btn"
                      onClick={() =>
                        handleInspectSource(
                          interrogationResult.answerCard.targetSourceRowNo,
                          interrogationResult.focusedAnalytes[0] || null,
                          true
                        )
                      }
                    >
                      Inspect Source Record #{interrogationResult.answerCard.targetSourceRowNo} →
                    </button>
                  )}
                  <button
                    type="button"
                    className="consol-row-btn"
                    onClick={() => {
                      setTeamQuestionDraft({
                        title: `Review: ${interrogationResult.headline}`,
                        questionBody: interrogationResult.answerCard.directAnswerText,
                        linkedHistoricalRowNo: interrogationResult.answerCard.targetSourceRowNo,
                        linkedSpecimenId: interrogationResult.answerCard.targetSpecimenId,
                        evidenceCitation: `${interrogationResult.answerCard.recordIdentityDisplay} · ${interrogationResult.answerCard.measuredValueDisplay} (${interrogationResult.answerCard.originalReferenceDisplay})`
                      });
                      deployModule('team-inbox');
                    }}
                  >
                    ＋ Raise Question
                  </button>
                  <button
                    type="button"
                    className="consol-row-btn"
                    onClick={() => {
                      setInputQuery('');
                      setExecutedQuery('');
                      setQuerySession({ ...INITIAL_QUERY_SESSION, scope: searchScope });
                    }}
                    title="Close interrogation result"
                  >
                    Close ✕
                  </button>
                </div>
              </div>

              {/* 1. Direct Natural-Language Answer */}
              <p className="consol-direct-answer-text">
                {interrogationResult.answerCard.directAnswerText}
              </p>

              {/* 2, 3, 4: Hairline Key-Value Grid for Measured Value, Record Identity & Source Dataset */}
              <div className="consol-answer-evidence-grid">
                <div className="consol-answer-evidence-cell">
                  <span className="consol-evidence-cell-label">
                    Measured Value &amp; Unit
                  </span>
                  <strong className="consol-evidence-cell-primary mono-cell">
                    {interrogationResult.answerCard.measuredValueDisplay}
                  </strong>
                  {interrogationResult.answerCard.reportedErrorDisplay && (
                    <small className="consol-evidence-cell-sub mono-cell">
                      {interrogationResult.answerCard.reportedErrorDisplay}
                    </small>
                  )}
                </div>

                <div className="consol-answer-evidence-cell">
                  <span className="consol-evidence-cell-label">
                    Record / Specimen Identity
                  </span>
                  <strong className="consol-evidence-cell-id">
                    {interrogationResult.answerCard.recordIdentityDisplay}
                  </strong>
                  <small className="consol-evidence-cell-sub">
                    {interrogationResult.answerCard.recordKindBadge === 'HISTORICAL REFERENCE RECORD'
                      ? 'Preserved reference record (isolated from physical AHM/ACC/ACX/OTH IDs)'
                      : interrogationResult.answerCard.measuredUnitDisplay}
                  </small>
                </div>

                <div className="consol-answer-evidence-cell">
                  <span className="consol-evidence-cell-label">
                    Source Dataset &amp; Reference
                  </span>
                  <strong className="consol-evidence-cell-dataset">
                    {interrogationResult.answerCard.sourceDatasetDisplay}
                  </strong>
                  <small className="consol-evidence-cell-sub mono-cell">
                    {interrogationResult.answerCard.originalReferenceDisplay}
                  </small>
                </div>
              </div>

              {/* Conversational Follow-up Refinement Bar */}
              <div className="consol-followup-chips-bar">
                <span className="consol-preset-label">Follow up:</span>
                {FOLLOW_UP_CHIPS.map(chip => (
                  <button
                    key={chip.label}
                    type="button"
                    className="consol-preset-chip"
                    onClick={() => runAskConsolQuery(chip.command)}
                  >
                    {chip.label}
                  </button>
                ))}
                {interrogationResult.pagination.hasPrev && (
                  <button
                    type="button"
                    className="consol-preset-chip"
                    onClick={() => runAskConsolQuery('First five')}
                  >
                    Show top five
                  </button>
                )}
              </div>

              {/* On-Demand Deployable Evidence Drawers (Rankings, Source Measurements, Chart, Qualifications) */}
              <div className="consol-expandable-toggles">
                <button
                  type="button"
                  className={`consol-row-btn ${expandRankings ? 'is-active' : ''}`}
                  onClick={() => setExpandRankings(v => !v)}
                >
                  {expandRankings ? 'Stow Ranked Table ▴' : `Deploy Ranked Table (${interrogationResult.pagination.totalRows}) ▾`}
                </button>
                <button
                  type="button"
                  className={`consol-row-btn ${interrogationResult.showSourceMeasurements ? 'is-active' : ''}`}
                  onClick={() => {
                    const nextVal = !querySession.showSourceMeasurements;
                    setQuerySession(prev => ({
                      ...prev,
                      showSourceMeasurements: nextVal
                    }));
                    if (nextVal) setExpandRankings(true);
                  }}
                >
                  {interrogationResult.showSourceMeasurements ? 'Stow Source Measurements ▴' : 'Deploy Source Measurements ▾'}
                </button>
                {interrogationResult.chartSeries.length > 0 && (
                  <button
                    type="button"
                    className={`consol-row-btn ${expandChart ? 'is-active' : ''}`}
                    onClick={() => setExpandChart(v => !v)}
                  >
                    {expandChart ? 'Stow Concentration Chart ▴' : `Deploy Concentration Chart (${interrogationResult.chartSeries.length}) ▾`}
                  </button>
                )}
                <button
                  type="button"
                  className={`consol-row-btn ${expandQualifications ? 'is-active' : ''}`}
                  onClick={() => setExpandQualifications(v => !v)}
                >
                  {expandQualifications ? 'Stow Qualifications ▴' : 'Scientific Qualifications ▾'}
                </button>
              </div>

              {/* Deployable Scientific Qualifications */}
              {expandQualifications && (
                <div className="consol-qualifications-block">
                  <ul className="consol-qualifications-list">
                    {interrogationResult.answerCard.scientificQualifications.map((qText, idx) => (
                      <li key={idx}>{qText}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Deployable Analytical Comparison Chart */}
              {expandChart && interrogationResult.chartSeries.length > 0 && (
                <div className="consol-analytical-chart" role="region" aria-label="Analytical Concentration Chart">
                  <div className="consol-chart-head">
                    <span className="eyebrow">
                      Concentration Distribution ({interrogationResult.focusedAnalytes.join(' vs ')})
                    </span>
                    <small className="mono-cell">
                      Bars proportional to measured concentration ({interrogationResult.chartSeries[0]?.unit || 'ppm'})
                    </small>
                  </div>
                  <div className="consol-chart-rows">
                    {interrogationResult.chartSeries.map(pt => {
                      const pct =
                        !pt.isLod && pt.value !== null && maxChartValue > 0
                          ? Math.max(4, Math.min(100, Math.round((pt.value / maxChartValue) * 100)))
                          : 0;
                      return (
                        <div
                          key={`${pt.sourceRowNo}-${pt.label}`}
                          className="consol-chart-row"
                          onClick={() =>
                            handleInspectSource(
                              pt.sourceRowNo,
                              interrogationResult.focusedAnalytes[0] || null,
                              true
                            )
                          }
                        >
                          <div className="consol-chart-label">
                            <strong>{pt.label}</strong>
                            <small className="mono-cell">{pt.subLabel}</small>
                          </div>
                          <div className="consol-chart-track-wrap">
                            {pt.isLod ? (
                              <span className="consol-chart-lod-tag mono-cell">
                                &lt;LOD (below_lod)
                              </span>
                            ) : (
                              <div className="consol-chart-bar-track">
                                <div
                                  className="consol-chart-bar-fill"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            )}
                          </div>
                          <div className="consol-chart-val mono-cell">
                            {pt.isLod ? (
                              '<LOD'
                            ) : (
                              <>
                                <strong>{pt.value?.toLocaleString('en-AU')}</strong> {pt.unit}
                                {pt.error !== null ? (
                                  <small> (±{pt.error.toLocaleString('en-AU')})</small>
                                ) : null}
                              </>
                            )}
                            {pt.secondaryAnalyte && (
                              <div className="consol-chart-sec-val">
                                {pt.secondaryAnalyte}:{' '}
                                {pt.secondaryIsLod
                                  ? '<LOD'
                                  : `${pt.secondaryValue?.toLocaleString('en-AU')} ${pt.unit}${pt.secondaryError ? ` (±${pt.secondaryError})` : ''}`}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Deployable Ranked Records & Source Measurements Table */}
              {expandRankings && interrogationResult.paginatedHistoricalRows.length > 0 && (
                <div className="consol-table-wrap" style={{ marginTop: 10 }}>
                  <div className="consol-ranking-pagination-bar">
                    <span className="mono-cell">
                      Rank #{interrogationResult.pagination.offset + 1}–#
                      {Math.min(
                        interrogationResult.pagination.offset +
                          interrogationResult.paginatedHistoricalRows.length,
                        interrogationResult.pagination.totalRows
                      )}{' '}
                      of {interrogationResult.pagination.totalRows} records
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {interrogationResult.pagination.hasPrev && (
                        <button
                          type="button"
                          className="consol-row-btn"
                          onClick={() =>
                            setQuerySession(prev => ({
                              ...prev,
                              offset: Math.max(0, prev.offset - prev.pageSize)
                            }))
                          }
                        >
                          ← Previous 5
                        </button>
                      )}
                      {interrogationResult.pagination.hasNext && (
                        <button
                          type="button"
                          className="consol-row-btn"
                          onClick={() => runAskConsolQuery('Show me the next five')}
                        >
                          Show Next 5 →
                        </button>
                      )}
                      {interrogationResult.pagination.totalRows >
                        interrogationResult.paginatedHistoricalRows.length && (
                        <button
                          type="button"
                          className="consol-row-btn"
                          onClick={() =>
                            setQuerySession(prev => ({
                              ...prev,
                              offset: 0,
                              pageSize: interrogationResult.pagination.totalRows
                            }))
                          }
                        >
                          Show All ({interrogationResult.pagination.totalRows})
                        </button>
                      )}
                    </div>
                  </div>

                  <table className="consol-table">
                    <thead>
                      <tr>
                        <th>Rank / Row</th>
                        <th>Historical Location / Opal Field</th>
                        <th>Original Timestamp</th>
                        {interrogationResult.focusedAnalytes.slice(0, 3).map(el => (
                          <th key={el} className="num">
                            {el} ({ELEMENT_NAMES[el] || el}) &amp; Reported Error
                          </th>
                        ))}
                        {interrogationResult.showSourceMeasurements ? (
                          <th>Preserved Source Measurements</th>
                        ) : (
                          <th>Dominant Quantified Chemistry</th>
                        )}
                        <th className="actions-col">Source Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {interrogationResult.paginatedHistoricalRows.map((rec, idx) => {
                        const rankNo = interrogationResult.pagination.offset + idx + 1;
                        const obsList = rec.observations || [];
                        const topDetected = obsList
                          .filter(o => o.qualifier !== 'below_lod' && o.value !== null)
                          .sort((a, b) => Number(b.value || 0) - Number(a.value || 0))
                          .slice(0, 4);
                        const primaryEl = interrogationResult.focusedAnalytes[0];
                        const primaryObs = primaryEl
                          ? obsList.find(o => o.analyte === primaryEl)
                          : topDetected[0];

                        return (
                          <tr
                            key={rec.id || `ask-row-${rec.source_row_no}`}
                            className="consol-tr"
                            onClick={() =>
                              handleInspectSource(
                                rec.source_row_no,
                                interrogationResult.focusedAnalytes[0] || null,
                                false
                              )
                            }
                          >
                            <td className="mono-cell">
                              <strong>#{rankNo}</strong> · Row #{rec.source_row_no}
                              <small className="consol-cell-sub">
                                Index {rec.original_index || '—'}
                              </small>
                            </td>
                            <td>
                              <strong>{rec.location || '—'}</strong>
                              <small className="consol-cell-sub">
                                {rec.dataset_name || '2018_Historical_XRF_Data'}
                              </small>
                            </td>
                            <td className="mono-cell">
                              <span>{rec.original_time || '—'}</span>
                            </td>
                            {interrogationResult.focusedAnalytes.slice(0, 3).map(el => {
                              const o = obsList.find(x => x.analyte === el);
                              if (!o) {
                                return (
                                  <td key={el} className="num mono-cell">
                                    —
                                  </td>
                                );
                              }
                              const f = formatHistoricalObservation(o);
                              return (
                                <td key={el} className={`num mono-cell ${f.isLod ? 'is-lod' : ''}`}>
                                  <strong>{f.valueText}</strong> {!f.isLod ? f.unitText : ''}
                                  {f.uncertaintyText ? (
                                    <small className="consol-cell-sub">
                                      Reported Error {f.uncertaintyText}
                                    </small>
                                  ) : null}
                                </td>
                              );
                            })}
                            {interrogationResult.showSourceMeasurements ? (
                              <td className="mono-cell">
                                <div>
                                  raw: <b>"{primaryObs?.raw_value ?? '—'}"</b> · err:{' '}
                                  <b>"{primaryObs?.raw_error ?? '—'}"</b> · qual:{' '}
                                  <b>{primaryObs?.qualifier || 'quantified'}</b>
                                </div>
                                <small className="consol-cell-sub">
                                  {rec.material_type || 'Soil'} · {rec.duration_s ?? 60}s · {rec.sigma_value ?? 2}σ · {rec.sequence || 'Final'}
                                </small>
                              </td>
                            ) : (
                              <td>
                                <div className="consol-inline-elements">
                                  {topDetected.map(o => {
                                    const f = formatHistoricalObservation(o);
                                    return (
                                      <span key={o.analyte} className="consol-el-pair">
                                        <b>{o.analyte}</b> {f.valueText} {f.unitText}
                                      </span>
                                    );
                                  })}
                                </div>
                              </td>
                            )}
                            <td className="actions-col" onClick={e => e.stopPropagation()}>
                              <button
                                type="button"
                                className="consol-row-btn"
                                onClick={() =>
                                  handleInspectSource(
                                    rec.source_row_no,
                                    interrogationResult.focusedAnalytes[0] || null,
                                    true
                                  )
                                }
                              >
                                Inspect Source →
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {/* 3. PRECISION TELEMETRY & DEPLOYABLE WORKSPACE LAUNCHER BAR */}
      <section className="consol-launcher-section" aria-label="Deployable Scientific Workspace Modules">
        <div className="consol-launcher-header">
          <span className="consol-launcher-title">
            Workspace Modules — select any module to deploy or stow its panel
          </span>
          {deployedModules.length > 0 && (
            <button
              type="button"
              className="consol-quiet-toggle"
              onClick={stowAllModules}
            >
              Stow All Panels ({deployedModules.length}) ✕
            </button>
          )}
        </div>

        <div className="consol-launcher-grid" role="toolbar" aria-label="Workspace module toggles">
          {workspaceModules.map(mod => {
            const active = isModuleDeployed(mod.id);
            return (
              <button
                key={mod.id}
                type="button"
                aria-expanded={active}
                className={`consol-launcher-tile ${active ? 'is-deployed' : ''}`}
                onClick={() => toggleModule(mod.id)}
              >
                <div className="consol-launcher-tile-top">
                  <span className="consol-launcher-label">{mod.label}</span>
                  <span className="consol-launcher-action">
                    {active ? 'Stow ▴' : 'Deploy ▾'}
                  </span>
                </div>
                <strong className="consol-launcher-metric mono-cell">{mod.metric}</strong>
                <span className="consol-launcher-sub">{mod.subtext}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 4. ON-DEMAND DEPLOYED WORKSPACE PANELS */}
      {deployedModules.length > 0 && (
        <div ref={deployedWorkspaceRef} className="consol-deployed-stack">
          {/* MODULE A: HISTORICAL REFERENCE DATA EXPLORER */}
          {isModuleDeployed('historical-explorer') && (
            <section
              className="surface consol-deployed-panel"
              aria-label="Historical Reference Data Explorer"
            >
              <div className="consol-panel-header">
                <div>
                  <span className="eyebrow">Collection · Reference Data</span>
                  <h3>
                    Historical Reference Explorer ({coverageMetrics.totalHistoricalRecords} rows ·{' '}
                    {coverageMetrics.totalHistoricalObs.toLocaleString('en-AU')} observations)
                  </h3>
                </div>
                <button
                  type="button"
                  className="consol-row-btn"
                  onClick={() => stowModule('historical-explorer')}
                  title="Stow Historical Explorer"
                >
                  Stow ✕
                </button>
              </div>

              <HistoricalDataExplorer
                datasets={historicalDatasets}
                records={historicalRecords}
                dbCounts={historicalDbCounts}
                loading={loading}
                selectedRecordId={selectedHistoricalRecord?.id || null}
                selectedSourceRowNo={explorerSourceRowNo}
                autoExpandRawColumns={explorerAutoExpandRaw}
                onSelectRecord={rec => {
                  setSelectedHistoricalRecord(rec);
                  setExplorerSourceRowNo(rec.source_row_no);
                  setInspectorMode('historical');
                }}
                initialFocusAnalyte={explorerFocusAnalyte}
                initialLocationFilter={explorerLocationFilter}
                onImportHistorical={preload =>
                  openModal('import-history', { preloadBundled2018: preload })
                }
              />
            </section>
          )}

          {/* MODULE B: CONTEMPORARY SPECIMEN REGISTRY */}
          {isModuleDeployed('specimens') && (
            <section
              className="surface consol-deployed-panel"
              aria-label="Contemporary Specimen Registry"
            >
              <div className="consol-panel-header">
                <div>
                  <span className="eyebrow">Collection · Specimen Registry</span>
                  <h3>Contemporary Specimens ({filteredSpecimens.length})</h3>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div className="consol-segmented-group" role="group" aria-label="Filter by classification">
                    <button
                      type="button"
                      className={`consol-seg-btn ${classFilter === 'ALL' ? 'active' : ''}`}
                      onClick={() => setClassFilter('ALL')}
                    >
                      ALL
                    </button>
                    {SPECIMEN_TYPES.map(t => (
                      <button
                        key={t.code}
                        type="button"
                        className={`consol-seg-btn ${classFilter === t.code ? 'active' : ''}`}
                        onClick={() => setClassFilter(t.code)}
                        title={t.name}
                      >
                        {t.code}
                      </button>
                    ))}
                  </div>

                  <select
                    className="consol-status-select"
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value as SpecimenStatusFilter)}
                    aria-label="Filter specimens by analytical or media state"
                  >
                    <option value="ALL">All Evidence States</option>
                    <option value="HAS_PXRF">Analysed (Has pXRF)</option>
                    <option value="NEEDS_PXRF">Awaiting pXRF</option>
                    <option value="HAS_MEDIA">Photographed (Has Media)</option>
                  </select>

                  <button
                    type="button"
                    className="consol-row-btn"
                    onClick={() => stowModule('specimens')}
                  >
                    Stow ✕
                  </button>
                </div>
              </div>

              <div className="consol-table-wrap">
                {loading ? (
                  <div className="loading" role="status">
                    Synchronising specimen registry…
                  </div>
                ) : filteredSpecimens.length > 0 ? (
                  <table className="consol-table">
                    <thead>
                      <tr>
                        <th>
                          <button type="button" className="consol-th-sort" onClick={() => handleSort('id')}>
                            Specimen ID {sortField === 'id' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th>
                          <button type="button" className="consol-th-sort" onClick={() => handleSort('sample_code')}>
                            Class {sortField === 'sample_code' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th>Location &amp; Classification</th>
                        <th className="num">
                          <button type="button" className="consol-th-sort" onClick={() => handleSort('weight_g')}>
                            Mass (g) {sortField === 'weight_g' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="num">
                          <button type="button" className="consol-th-sort" onClick={() => handleSort('image_count')}>
                            Media {sortField === 'image_count' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="num">
                          <button type="button" className="consol-th-sort" onClick={() => handleSort('analysis_count')}>
                            pXRF {sortField === 'analysis_count' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th>Latest Elements</th>
                        <th className="num">
                          <button type="button" className="consol-th-sort" onClick={() => handleSort('created_at')}>
                            Registered {sortField === 'created_at' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                          </button>
                        </th>
                        <th className="actions-col">Operations</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSpecimens.map(s => {
                        const isSelected = effectiveSpecimenId === s.id;
                        const isPinned = activeSpecimenId === s.id;
                        const typeInfo = SPECIMEN_TYPE_BY_CODE[s.sample_code] || SPECIMEN_TYPES[3];
                        const latestAna = latestAnalysisBySample.get(s.id);
                        const topEls = getTopElements(latestAna?.results, 3);

                        return (
                          <tr
                            key={s.id}
                            className={`consol-tr ${isSelected ? 'is-selected' : ''} ${isPinned ? 'is-pinned' : ''}`}
                            onClick={() => {
                              setActiveSpecimenId(s.id);
                              setInspectorMode('specimen');
                              deployModule('source-inspector');
                            }}
                          >
                            <td className="mono-cell">
                              <div className="consol-id-cell">
                                <strong>{s.id}</strong>
                                {isPinned && <span className="consol-pin-indicator">Active</span>}
                              </div>
                            </td>
                            <td>
                              <span className="consol-class-code">{s.sample_code}</span>
                              <small className="consol-cell-sub">{typeInfo.short}</small>
                            </td>
                            <td>
                              <span className="consol-location-text">
                                {s.location || 'Andamooka, SA'}
                              </span>
                              <small className="consol-cell-sub">
                                {s.sample_type || typeInfo.name}
                              </small>
                            </td>
                            <td className="num mono-cell">
                              {s.weight_g !== null && s.weight_g !== undefined
                                ? Number(s.weight_g).toLocaleString('en-AU', { maximumFractionDigits: 2 })
                                : '—'}
                            </td>
                            <td className="num mono-cell">{s.image_count || 0}</td>
                            <td className="num mono-cell">{s.analysis_count || 0}</td>
                            <td>
                              {topEls.length > 0 ? (
                                <div className="consol-inline-elements">
                                  {topEls.map(el => {
                                    const f = formatElementValue(el);
                                    return (
                                      <span
                                        key={el.element}
                                        className={`consol-el-pair ${f.isLod ? 'is-lod' : ''}`}
                                      >
                                        <b>{el.element}</b> {f.valueText}
                                        {f.unitText && !f.isLod ? ` ${f.unitText}` : ''}
                                      </span>
                                    );
                                  })}
                                </div>
                              ) : (
                                <span className="consol-muted-dash">
                                  {(s.analysis_count || 0) > 0 ? 'See record' : 'Unanalysed'}
                                </span>
                              )}
                            </td>
                            <td className="num mono-cell">
                              {new Date(s.created_at).toLocaleDateString('en-AU')}
                            </td>
                            <td className="actions-col" onClick={e => e.stopPropagation()}>
                              <div className="consol-row-actions">
                                <button
                                  type="button"
                                  className="consol-row-btn"
                                  onClick={() => {
                                    setActiveSpecimenId(s.id);
                                    navigate(`#/samples/${encodeURIComponent(s.id)}`);
                                  }}
                                >
                                  Record
                                </button>
                                <button
                                  type="button"
                                  className="consol-row-btn"
                                  onClick={() => {
                                    setActiveSpecimenId(s.id);
                                    openModal('import-csv', { sampleId: s.id });
                                  }}
                                >
                                  +pXRF
                                </button>
                                <button
                                  type="button"
                                  className="consol-row-btn"
                                  onClick={() => {
                                    setActiveSpecimenId(s.id);
                                    navigate(`#/solarium/${encodeURIComponent(s.id)}`);
                                  }}
                                >
                                  SOLARIUM
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="workbench-empty-registry">
                    <h4>0 contemporary physical specimens registered yet.</h4>
                    <p>
                      Register an Andamooka specimen (AHM, ACC, ACX, or OTH) to generate an authoritative database-assigned specimen ID, or deploy the Historical Explorer to inspect the {coverageMetrics.totalHistoricalObs} reference observations.
                    </p>
                    <div className="workbench-empty-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => openModal('new-sample')}
                      >
                        Register Contemporary Specimen
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* MODULE C: LIVE pXRF ANALYTICAL STREAM */}
          {isModuleDeployed('pxrf-stream') && (
            <section
              className="surface consol-deployed-panel"
              aria-label="Live pXRF Analytical Stream"
            >
              <div className="consol-panel-header">
                <div>
                  <span className="eyebrow">Collection · Analytical Stream</span>
                  <h3>Contemporary pXRF Readings ({filteredAnalyses.length})</h3>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="consol-row-btn"
                    onClick={() => openModal('import-csv', { sampleId: null })}
                  >
                    ＋ Import Vanta CSV
                  </button>
                  <button
                    type="button"
                    className="consol-row-btn"
                    onClick={() => stowModule('pxrf-stream')}
                  >
                    Stow ✕
                  </button>
                </div>
              </div>

              <div className="consol-table-wrap">
                {filteredAnalyses.length > 0 ? (
                  <table className="consol-table">
                    <thead>
                      <tr>
                        <th>Specimen ID</th>
                        <th>Reading #</th>
                        <th>Instrument &amp; Method</th>
                        <th>Measured Timestamp</th>
                        <th>Primary Elemental Concentrations</th>
                        <th className="actions-col">Inspect</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAnalyses.map((ana, idx) => {
                        const topEls = getTopElements(ana.results, 5);
                        return (
                          <tr
                            key={ana.id || `${ana.sample_id}-${ana.reading_hash}-${idx}`}
                            className={`consol-tr ${effectiveSpecimenId === ana.sample_id ? 'is-selected' : ''}`}
                            onClick={() => {
                              setActiveSpecimenId(ana.sample_id);
                              setInspectorMode('specimen');
                              deployModule('source-inspector');
                            }}
                          >
                            <td className="mono-cell">
                              <strong>{ana.sample_id}</strong>
                            </td>
                            <td className="mono-cell">{ana.reading_no || '—'}</td>
                            <td>
                              <span>{ana.instrument || 'Olympus Vanta'}</span>
                              <small className="consol-cell-sub">{ana.method || 'Geochem'}</small>
                            </td>
                            <td className="mono-cell">
                              {ana.measured_at
                                ? new Date(ana.measured_at).toLocaleString('en-AU')
                                : ana.created_at
                                  ? new Date(ana.created_at).toLocaleDateString('en-AU')
                                  : '—'}
                            </td>
                            <td>
                              <div className="consol-inline-elements">
                                {topEls.map(el => {
                                  const f = formatElementValue(el);
                                  return (
                                    <span
                                      key={el.element}
                                      className={`consol-el-pair ${f.isLod ? 'is-lod' : ''}`}
                                    >
                                      <b>{el.element}</b> {f.valueText}
                                      {f.unitText && !f.isLod ? ` ${f.unitText}` : ''}
                                    </span>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="actions-col" onClick={e => e.stopPropagation()}>
                              <button
                                type="button"
                                className="consol-row-btn"
                                onClick={() => {
                                  setActiveSpecimenId(ana.sample_id);
                                  navigate(`#/samples/${encodeURIComponent(ana.sample_id)}`);
                                }}
                              >
                                Open Specimen →
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="consol-empty-inline">
                    No contemporary Vanta pXRF readings attached to registered specimens yet.
                  </div>
                )}
              </div>
            </section>
          )}

          {/* MODULE D: IMPORT BATCHES & HISTORICAL REFERENCE DATASETS */}
          {isModuleDeployed('imports-reference') && (
            <section
              className="surface consol-deployed-panel"
              aria-label="Batches and Reference Datasets"
            >
              <div className="consol-panel-header">
                <div>
                  <span className="eyebrow">Collection · Provenance Batches</span>
                  <h3>
                    Reference Datasets ({historicalDatasets.length}) &amp; Vanta Batches ({recentImports.length})
                  </h3>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="consol-row-btn"
                    onClick={() => openModal('import-history', { preloadBundled2018: false })}
                  >
                    ＋ Import Reference CSV/XLSX
                  </button>
                  <button
                    type="button"
                    className="consol-row-btn"
                    onClick={() => stowModule('imports-reference')}
                  >
                    Stow ✕
                  </button>
                </div>
              </div>

              {historicalDatasets.length > 0 && (
                <div className="consol-table-wrap">
                  <table className="consol-table">
                    <thead>
                      <tr>
                        <th>Dataset Name</th>
                        <th>Source Workbook</th>
                        <th>SHA-256 Digest</th>
                        <th className="num">Verified Rows</th>
                        <th className="num">Verified Observations</th>
                        <th className="actions-col">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historicalDatasets.map(ds => (
                        <tr
                          key={ds.id}
                          className="consol-tr"
                          onClick={() => deployModule('historical-explorer')}
                        >
                          <td>
                            <strong>{ds.name}</strong>
                          </td>
                          <td>{ds.raw_files?.file_name || ds.metadata?.source_file || 'Workbook'}</td>
                          <td className="mono-cell">
                            {(ds.raw_files?.sha256 || ds.metadata?.source_sha256 || '').slice(0, 14) || '—'}…
                          </td>
                          <td className="num mono-cell">
                            {Number(historicalDbCounts.records || ds.metadata?.record_count || 0).toLocaleString('en-AU')}
                          </td>
                          <td className="num mono-cell">
                            {Number(historicalDbCounts.observations || ds.metadata?.observation_count || 0).toLocaleString('en-AU')}
                          </td>
                          <td className="actions-col" onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              className="consol-row-btn"
                              onClick={() => deployModule('historical-explorer')}
                            >
                              Deploy Explorer →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* MODULE E: CONTEXTUAL SOURCE INSPECTOR */}
          {isModuleDeployed('source-inspector') && (
            <section
              className="surface consol-deployed-panel"
              aria-label="Contextual Source Inspector"
            >
              <div className="consol-panel-header">
                <div>
                  <span className="eyebrow">Source Inspector</span>
                  <h3>
                    {inspectorMode === 'historical' && selectedHistoricalRecord
                      ? `Historical Record #${selectedHistoricalRecord.source_row_no} · ${selectedHistoricalRecord.location}`
                      : selectedSpecimen
                        ? selectedSpecimen.id
                        : 'Select a Record'}
                  </h3>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {specimens.length > 0 && historicalRecords.length > 0 && (
                    <div className="consol-segmented-group">
                      <button
                        type="button"
                        className={`consol-seg-btn ${inspectorMode === 'specimen' ? 'active' : ''}`}
                        onClick={() => setInspectorMode('specimen')}
                      >
                        Specimen
                      </button>
                      <button
                        type="button"
                        className={`consol-seg-btn ${inspectorMode === 'historical' ? 'active' : ''}`}
                        onClick={() => setInspectorMode('historical')}
                      >
                        Historical
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    className="consol-row-btn"
                    onClick={() => stowModule('source-inspector')}
                  >
                    Stow ✕
                  </button>
                </div>
              </div>

              {inspectorMode === 'specimen' && selectedSpecimen ? (
                <div className="consol-inspector-body">
                  <div className="consol-inspector-summary">
                    <div className="thumb consol-inspector-thumb">
                      {urlMap && urlMap(selectedSpecimen.cover_thumb_path || selectedSpecimen.cover_path) ? (
                        <img
                          src={urlMap(selectedSpecimen.cover_thumb_path || selectedSpecimen.cover_path)!}
                          alt={selectedSpecimen.id}
                        />
                      ) : null}
                    </div>
                    <div className="consol-inspector-meta">
                      <strong>
                        {selectedSpecimen.sample_code} ·{' '}
                        {SPECIMEN_TYPE_BY_CODE[selectedSpecimen.sample_code]?.name ||
                          selectedSpecimen.sample_type}
                      </strong>
                      <small>
                        {selectedSpecimen.location || 'Andamooka, South Australia'} ·{' '}
                        {selectedSpecimen.weight_g ? `${selectedSpecimen.weight_g} g` : 'Mass unrecorded'}
                      </small>
                    </div>
                  </div>
                  {selectedInspectorElements.length > 0 && (
                    <div className="consol-el-mini-table-wrap">
                      <table className="consol-el-mini-table">
                        <thead>
                          <tr>
                            <th>Elem</th>
                            <th className="num">Concentration</th>
                            <th>Unit</th>
                            <th className="num">Reported Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedInspectorElements.slice(0, 10).map(el => {
                            const f = formatElementValue(el);
                            return (
                              <tr key={el.element} className={f.isLod ? 'is-lod' : ''}>
                                <td><strong>{el.element}</strong></td>
                                <td className="num mono-cell">{f.valueText}</td>
                                <td className="mono-cell">{f.unitText || '—'}</td>
                                <td className="num mono-cell">{f.uncertaintyText || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : selectedHistoricalRecord ? (
                <div className="consol-inspector-body">
                  <div className="consol-quiet-meta" style={{ marginBottom: 10 }}>
                    <span>Original Index {selectedHistoricalRecord.original_index || '—'}</span>
                    <span>·</span>
                    <span>{selectedHistoricalRecord.material_type || 'Soil'}</span>
                    <span>·</span>
                    <span>{selectedHistoricalRecord.duration_s ?? 60}s</span>
                    <span>·</span>
                    <span>Sigma {selectedHistoricalRecord.sigma_value ?? 2}</span>
                    <span>·</span>
                    <span>{selectedHistoricalRecord.original_time || '—'}</span>
                  </div>
                  <div className="consol-el-mini-table-wrap">
                    <table className="consol-el-mini-table">
                      <thead>
                        <tr>
                          <th>Elem</th>
                          <th className="num">Measured Value</th>
                          <th>Unit</th>
                          <th className="num">Reported Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedHistoricalInspectorObs.slice(0, 12).map(obs => {
                          const f = formatHistoricalObservation(obs);
                          return (
                            <tr
                              key={obs.analyte}
                              className={f.isLod ? 'is-lod' : ''}
                              onClick={() => runAskConsolQuery(obs.analyte)}
                              style={{ cursor: 'pointer' }}
                            >
                              <td><strong>{obs.analyte}</strong></td>
                              <td className="num mono-cell">{f.valueText}</td>
                              <td className="mono-cell">{f.unitText || '—'}</td>
                              <td className="num mono-cell">{f.uncertaintyText || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </section>
          )}

          {/* MODULE F: TEAM INTELLIGENCE INBOX */}
          {isModuleDeployed('team-inbox') && (
            <TeamIntelligenceInbox
              currentUserEmail={user?.email || null}
              historicalRecords={historicalRecords}
              specimens={specimens}
              investigations={investigations}
              prefillDraft={teamQuestionDraft}
              onClearPrefillDraft={() => setTeamQuestionDraft(null)}
              onInspectHistoricalRow={rowNo => handleInspectSource(rowNo, null, true)}
              onOpenSpecimen={specId => {
                setActiveSpecimenId(specId);
                navigate(`#/samples/${encodeURIComponent(specId)}`);
              }}
              onOpenInvestigation={invId => navigate(`#/the-lab/${encodeURIComponent(invId)}`)}
              onClose={() => stowModule('team-inbox')}
            />
          )}

          {/* MODULE G: PROVENANCE AUDIT STREAM */}
          {isModuleDeployed('provenance') && (
            <section
              className="surface consol-deployed-panel"
              aria-label="Provenance Audit Stream"
            >
              <div className="consol-panel-header">
                <div>
                  <span className="eyebrow">Workspace · Audit Ledger</span>
                  <h3>Provenance Stream ({filteredEvents.length})</h3>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div className="consol-event-filters" role="group" aria-label="Filter provenance stream">
                    {[
                      { id: 'ALL', label: 'All' },
                      { id: 'registered', label: 'Reg' },
                      { id: 'photographed', label: 'Media' },
                      { id: 'analysed', label: 'pXRF' },
                      { id: 'treated', label: 'Treat' }
                    ].map(f => (
                      <button
                        key={f.id}
                        type="button"
                        className={`consol-seg-btn ${eventFilter === f.id ? 'active' : ''}`}
                        onClick={() => setEventFilter(f.id)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="consol-row-btn"
                    onClick={() => stowModule('provenance')}
                  >
                    Stow ✕
                  </button>
                </div>
              </div>

              {filteredEvents.length > 0 ? (
                <div className="consol-stream-list">
                  {filteredEvents.map(ev => (
                    <button
                      key={ev.id}
                      type="button"
                      className="consol-stream-item"
                      onClick={() => {
                        setActiveSpecimenId(ev.sample_id);
                        navigate(`#/samples/${encodeURIComponent(ev.sample_id)}`);
                      }}
                    >
                      <div className="consol-stream-top">
                        <strong className="mono-cell">{ev.sample_id}</strong>
                        <span className="consol-stream-kind">
                          {EVENT_LABELS[ev.kind] || ev.kind}
                        </span>
                        <time className="mono-cell">
                          {new Date(ev.created_at).toLocaleDateString('en-AU')}
                        </time>
                      </div>
                      <small className="consol-stream-detail">{formatEventSummary(ev)}</small>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="consol-empty-inline">
                  No matching provenance events in the ledger.
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
};

export default HomeView;
