/**
 * CONSOL — Investigations (The Lab)
 * UX Reset Step 4 — Scientist-First Research Workspace
 *
 * Principles:
 * 1. Opens to a clean Investigation Library with:
 *    - Page title: Investigations
 *    - Prominent New Investigation action
 *    - Search
 *    - Existing investigations, if any
 *    - Purposeful empty state when none exist (no fabricated research fixtures or invented team findings)
 * 2. Simple New Investigation workflow:
 *    - Investigation title (required)
 *    - Research question (required)
 *    - Optional related specimen or project
 *    - Responsible researcher (required)
 * 3. Inside an Investigation (#/the-lab/:id):
 *    - Four focused tabs: Overview, Evidence, Experiments, Findings
 *    - Maximum of one primary content area + optional contextual evidence inspector
 * 4. Strict separation of Investigation Lifecycle vs Scientific Record Classification:
 *    - Investigation Lifecycle: Draft | Active | Under Review | Closed
 *    - Scientific Record Types: Hypothesis | Procedure | Observation | Interpretation | Finding
 *    - Scientific Verification States: Unverified | Under Review | Accepted (requires explicit authorised review decision)
 * 5. Honest Persistence Behaviour:
 *    - Does not simulate production database writes while the Lab schema migration awaits approval.
 *    - Clearly identifies temporary browser draft records when created in development.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { TopHeader } from '../layout/TopHeader';
import { api } from '../../services/supabase';
import { isSpecimenIdentifier } from '../../types/routes';
import type { SpecimenOverview, SpecimenDetail } from '../../types';

// 1. Investigation Lifecycle States (Independent of scientific record verification)
export type InvestigationLifecycle =
  | 'Draft'
  | 'Active'
  | 'Under Review'
  | 'Closed';

export const INVESTIGATION_LIFECYCLES: InvestigationLifecycle[] = [
  'Draft',
  'Active',
  'Under Review',
  'Closed'
];

// 2. Scientific Record Types
export type ScientificRecordType =
  | 'Hypothesis'
  | 'Procedure'
  | 'Observation'
  | 'Interpretation'
  | 'Finding';

// 3. Independent Scientific Verification State
export type ScientificVerificationState =
  | 'Unverified'
  | 'Under Review'
  | 'Accepted Finding';

export interface ScientificRecordItem {
  id: string;
  recordType: ScientificRecordType;
  verificationState: ScientificVerificationState;
  title: string;
  content: string;
  uncertaintyNote?: string;
  author: string;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  linkedSpecimenId?: string;
}

export interface InvestigationRecord {
  id: string;
  title: string;
  question: string;
  description: string;
  relatedSpecimenOrProject: string;
  responsibleResearcher: string;
  collaborators: string[];
  lifecycle: InvestigationLifecycle;
  linkedSpecimenIds: string[];
  includeOpticalReferenceStudy: boolean;
  records: ScientificRecordItem[];
  createdAt: string;
  updatedAt: string;
  isTemporaryDraft: true;
}

const DRAFT_STORAGE_KEY = 'consol.investigations.drafts.v4';

function loadDraftInvestigations(): InvestigationRecord[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDraftInvestigations(list: InvestigationRecord[]): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(list));
    }
  } catch {
    // ignore storage errors
  }
}

export const TheLabView: React.FC = () => {
  const {
    subId,
    specimenId,
    activeSpecimenId,
    setActiveSpecimenId,
    navigate,
    toast
  } = useApp();
  const { user } = useAuth();

  // Temporary session/browser drafts (starts empty — zero fabricated investigations)
  const [investigations, setInvestigations] = useState<InvestigationRecord[]>(() =>
    loadDraftInvestigations()
  );

  // Library search query
  const [searchQuery, setSearchQuery] = useState('');

  // New Investigation modal state (4 simple fields)
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [newRelated, setNewRelated] = useState('');
  const [newResearcher, setNewResearcher] = useState('');
  const [newFormError, setNewFormError] = useState<string | null>(null);

  // Individual Investigation active tab
  const [detailTab, setDetailTab] = useState<'Overview' | 'Evidence' | 'Experiments' | 'Findings'>('Overview');

  // Optional contextual evidence inspector (closed by default, opens only when requested)
  const [inspectedEvidence, setInspectedEvidence] = useState<{
    kind: 'specimen' | 'solarium-reference';
    specimenId?: string;
  } | null>(null);
  const [inspectedSpecimenDetail, setInspectedSpecimenDetail] = useState<SpecimenDetail | null>(null);
  const [loadingInspector, setLoadingInspector] = useState(false);

  // Live specimens from Supabase for linking
  const [liveSpecimens, setLiveSpecimens] = useState<SpecimenOverview[]>([]);
  const [loadingLiveSpecimens, setLoadingLiveSpecimens] = useState(false);

  // Record entry composer inside Experiments / Findings tabs
  const [composerOpen, setComposerOpen] = useState(false);
  const [recType, setRecType] = useState<ScientificRecordType>('Hypothesis');
  const [recTitle, setRecTitle] = useState('');
  const [recContent, setRecContent] = useState('');
  const [recUncertainty, setRecUncertainty] = useState('');

  // Overview description & collaborator quick edit
  const [newCollaboratorInput, setNewCollaboratorInput] = useState('');
  const [specimenLinkInput, setSpecimenLinkInput] = useState('');

  // Persist temporary drafts to localStorage
  useEffect(() => {
    saveDraftInvestigations(investigations);
  }, [investigations]);

  // Load live registered specimens for evidence linking
  useEffect(() => {
    let active = true;
    setLoadingLiveSpecimens(true);
    api.overview({ limit: 100 })
      .then(list => {
        if (active) setLiveSpecimens(list);
      })
      .catch(() => {
        if (active) setLiveSpecimens([]);
      })
      .finally(() => {
        if (active) setLoadingLiveSpecimens(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Determine if we are viewing a specific investigation or the library
  const activeInvestigation = useMemo(() => {
    if (!subId) return null;
    return investigations.find(inv => inv.id === subId) || null;
  }, [subId, investigations]);

  // If navigated with a specimen ID (#/the-lab/AHM-000042) and no matching investigation ID,
  // keep the library open with that specimen pre-filled for starting or filtering an investigation
  const contextSpecimenId = specimenId || activeSpecimenId;

  // Load live specimen details when the contextual inspector is explicitly opened
  useEffect(() => {
    if (!inspectedEvidence || inspectedEvidence.kind !== 'specimen' || !inspectedEvidence.specimenId) {
      setInspectedSpecimenDetail(null);
      return;
    }

    let active = true;
    setLoadingInspector(true);
    api.sampleDetail(inspectedEvidence.specimenId)
      .then(detail => {
        if (active) setInspectedSpecimenDetail(detail.sample ? detail : null);
      })
      .catch(() => {
        if (active) setInspectedSpecimenDetail(null);
      })
      .finally(() => {
        if (active) setLoadingInspector(false);
      });

    return () => {
      active = false;
    };
  }, [inspectedEvidence]);

  const openNewInvestigationModal = (prefillSpecimen?: string | null) => {
    setNewTitle('');
    setNewQuestion('');
    setNewRelated(prefillSpecimen || contextSpecimenId || '');
    setNewResearcher(user?.email || '');
    setNewFormError(null);
    setIsNewModalOpen(true);
  };

  const handleCreateInvestigation = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = newTitle.trim();
    const cleanQuestion = newQuestion.trim();
    const cleanResearcher = newResearcher.trim();
    const cleanRelated = newRelated.trim();

    if (!cleanTitle) {
      setNewFormError('Enter an investigation title.');
      return;
    }
    if (!cleanQuestion) {
      setNewFormError('Enter the primary research question.');
      return;
    }
    if (!cleanResearcher) {
      setNewFormError('Specify the responsible researcher.');
      return;
    }

    const id = `inv-${Date.now().toString(36)}`;
    const nowIso = new Date().toISOString();
    const linkedSpecimens = isSpecimenIdentifier(cleanRelated) ? [cleanRelated.toUpperCase()] : [];

    const created: InvestigationRecord = {
      id,
      title: cleanTitle,
      question: cleanQuestion,
      description: '',
      relatedSpecimenOrProject: cleanRelated,
      responsibleResearcher: cleanResearcher,
      collaborators: [],
      lifecycle: 'Draft',
      linkedSpecimenIds: linkedSpecimens,
      includeOpticalReferenceStudy: false,
      records: [],
      createdAt: nowIso,
      updatedAt: nowIso,
      isTemporaryDraft: true
    };

    if (linkedSpecimens[0]) {
      setActiveSpecimenId(linkedSpecimens[0]);
    }

    setInvestigations(prev => [created, ...prev]);
    setIsNewModalOpen(false);
    setDetailTab('Overview');
    setInspectedEvidence(null);
    navigate(`#/the-lab/${encodeURIComponent(id)}`);
    toast('Temporary draft investigation created in browser session.');
  };

  const updateActiveInvestigation = (updater: (inv: InvestigationRecord) => InvestigationRecord) => {
    if (!activeInvestigation) return;
    setInvestigations(prev =>
      prev.map(item =>
        item.id === activeInvestigation.id
          ? { ...updater(item), updatedAt: new Date().toISOString() }
          : item
      )
    );
  };

  const handleAddScientificRecord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeInvestigation) return;
    const cleanTitle = recTitle.trim();
    const cleanContent = recContent.trim();
    if (!cleanTitle || !cleanContent) return;

    // Hypotheses, Procedures, Observations, and Interpretations always start as 'Unverified'
    // Candidate Findings start as 'Under Review' — never automatically 'Accepted Finding'
    const initialVerification: ScientificVerificationState =
      recType === 'Finding' ? 'Under Review' : 'Unverified';

    const newRecord: ScientificRecordItem = {
      id: `rec-${Date.now().toString(36)}`,
      recordType: recType,
      verificationState: initialVerification,
      title: cleanTitle,
      content: cleanContent,
      uncertaintyNote: recUncertainty.trim() || undefined,
      author: user?.email || activeInvestigation.responsibleResearcher,
      createdAt: new Date().toISOString(),
      linkedSpecimenId: activeInvestigation.linkedSpecimenIds[0] || undefined
    };

    updateActiveInvestigation(inv => ({
      ...inv,
      records: [newRecord, ...inv.records]
    }));

    setRecTitle('');
    setRecContent('');
    setRecUncertainty('');
    setComposerOpen(false);
  };

  // Explicit authorised review decision to promote a record to Accepted Finding
  const handleUpdateRecordVerification = (
    recordId: string,
    nextState: ScientificVerificationState
  ) => {
    updateActiveInvestigation(inv => ({
      ...inv,
      records: inv.records.map(r => {
        if (r.id !== recordId) return r;
        return {
          ...r,
          recordType: nextState === 'Accepted Finding' ? 'Finding' : r.recordType,
          verificationState: nextState,
          reviewedBy: nextState === 'Accepted Finding' ? (user?.email || 'Authorised Reviewer') : r.reviewedBy,
          reviewedAt: nextState === 'Accepted Finding' ? new Date().toISOString() : r.reviewedAt
        };
      })
    }));
  };

  const filteredInvestigations = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return investigations;
    return investigations.filter(inv => {
      return (
        inv.title.toLowerCase().includes(q) ||
        inv.question.toLowerCase().includes(q) ||
        inv.relatedSpecimenOrProject.toLowerCase().includes(q) ||
        inv.responsibleResearcher.toLowerCase().includes(q) ||
        inv.linkedSpecimenIds.some(id => id.toLowerCase().includes(q))
      );
    });
  }, [investigations, searchQuery]);

  // ============================================================================
  // VIEW A: INDIVIDUAL INVESTIGATION SCREEN (#/the-lab/:id)
  // ============================================================================
  if (activeInvestigation) {
    const experimentRecords = activeInvestigation.records.filter(
      r => r.recordType === 'Hypothesis' || r.recordType === 'Procedure' || r.recordType === 'Observation'
    );
    const findingRecords = activeInvestigation.records.filter(
      r => r.recordType === 'Interpretation' || r.recordType === 'Finding' || r.verificationState !== 'Unverified'
    );

    return (
      <div className="lab-screen">
        {/* Individual Investigation Header */}
        <header className="top lab-detail-top">
          <div>
            <div className="lab-back-row">
              <button
                type="button"
                className="lab-back-link"
                onClick={() => {
                  setInspectedEvidence(null);
                  navigate('#/the-lab');
                }}
              >
                ← Investigations
              </button>
              <span className="lab-dot-sep" aria-hidden="true">·</span>
              <span className="lab-draft-notice">Temporary draft (not saved to database)</span>
            </div>
            <h1 className="title">{activeInvestigation.title}</h1>
            <p className="sub lab-question-lead">{activeInvestigation.question}</p>
          </div>

          <div className="header-actions">
            <label className="lab-lifecycle-select">
              <span>Status</span>
              <select
                aria-label="Investigation lifecycle status"
                value={activeInvestigation.lifecycle}
                onChange={e =>
                  updateActiveInvestigation(inv => ({
                    ...inv,
                    lifecycle: e.target.value as InvestigationLifecycle
                  }))
                }
              >
                {INVESTIGATION_LIFECYCLES.map(state => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        {/* Horizontal Navigation Tabs: Overview, Evidence, Experiments, Findings */}
        <div className="tabs lab-detail-tabs" role="tablist" aria-label="Investigation sections">
          {(['Overview', 'Evidence', 'Experiments', 'Findings'] as const).map(tab => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={detailTab === tab}
              className={detailTab === tab ? 'active' : ''}
              onClick={() => {
                setDetailTab(tab);
                setComposerOpen(false);
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Single Primary Content Area + Optional Contextual Inspector */}
        <div className={`lab-workspace-layout ${inspectedEvidence ? 'has-inspector' : ''}`}>
          <div className="lab-primary-area">
            {/* TAB 1: OVERVIEW */}
            {detailTab === 'Overview' && (
              <section className="surface lab-section-panel">
                <div className="lab-overview-grid">
                  <div>
                    <span className="eyebrow">Research Question</span>
                    <p className="lab-overview-question">{activeInvestigation.question}</p>
                  </div>

                  <div className="facts" style={{ marginTop: 24 }}>
                    <div>
                      <span>Investigation Status</span>
                      <b>{activeInvestigation.lifecycle}</b>
                    </div>
                    <div>
                      <span>Responsible Researcher</span>
                      <b>{activeInvestigation.responsibleResearcher}</b>
                    </div>
                    <div>
                      <span>Related Specimen or Project</span>
                      <b>{activeInvestigation.relatedSpecimenOrProject || '—'}</b>
                    </div>
                    <div>
                      <span>Linked Specimens</span>
                      <b>
                        {activeInvestigation.linkedSpecimenIds.length > 0
                          ? activeInvestigation.linkedSpecimenIds.join(', ')
                          : 'None linked'}
                      </b>
                    </div>
                  </div>

                  <div className="lab-divider" />

                  <div className="field full" style={{ marginTop: 0 }}>
                    <label htmlFor="inv-desc">Description & Scope</label>
                    <textarea
                      id="inv-desc"
                      placeholder="Add background context, geological horizon, or study scope…"
                      value={activeInvestigation.description}
                      onChange={e =>
                        updateActiveInvestigation(inv => ({
                          ...inv,
                          description: e.target.value
                        }))
                      }
                    />
                  </div>

                  <div className="lab-divider" />

                  <div>
                    <span className="eyebrow">Collaborators</span>
                    <div className="lab-collaborators-row">
                      <span className="lab-collab-item">
                        {activeInvestigation.responsibleResearcher} (Lead)
                      </span>
                      {activeInvestigation.collaborators.map((c, idx) => (
                        <span key={idx} className="lab-collab-item">
                          · {c}
                        </span>
                      ))}
                    </div>

                    <form
                      className="lab-inline-form"
                      onSubmit={e => {
                        e.preventDefault();
                        const clean = newCollaboratorInput.trim();
                        if (!clean) return;
                        updateActiveInvestigation(inv => ({
                          ...inv,
                          collaborators: [...new Set([...inv.collaborators, clean])]
                        }));
                        setNewCollaboratorInput('');
                      }}
                    >
                      <input
                        type="text"
                        placeholder="Add collaborator name or role…"
                        value={newCollaboratorInput}
                        onChange={e => setNewCollaboratorInput(e.target.value)}
                      />
                      <button type="submit" className="secondary">
                        Add Collaborator
                      </button>
                    </form>
                  </div>
                </div>
              </section>
            )}

            {/* TAB 2: EVIDENCE */}
            {detailTab === 'Evidence' && (
              <section className="surface lab-section-panel">
                <div className="surface-head">
                  <div>
                    <span className="eyebrow">Linked Evidence</span>
                    <h3>Specimens, XRF & Optical Records</h3>
                  </div>
                </div>

                {/* Attach Specimen Control */}
                <form
                  className="lab-inline-form"
                  style={{ marginBottom: 24 }}
                  onSubmit={e => {
                    e.preventDefault();
                    const clean = specimenLinkInput.trim().toUpperCase();
                    if (!clean) return;
                    updateActiveInvestigation(inv => ({
                      ...inv,
                      linkedSpecimenIds: [...new Set([...inv.linkedSpecimenIds, clean])]
                    }));
                    setActiveSpecimenId(clean);
                    setSpecimenLinkInput('');
                  }}
                >
                  <input
                    type="text"
                    placeholder="Enter specimen ID (e.g. AHM-000001)…"
                    value={specimenLinkInput}
                    onChange={e => setSpecimenLinkInput(e.target.value)}
                    list="live-specimen-ids"
                  />
                  <datalist id="live-specimen-ids">
                    {liveSpecimens.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.sample_code} · {s.location}
                      </option>
                    ))}
                  </datalist>
                  <button type="submit" className="secondary">
                    ＋ Attach Specimen
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      updateActiveInvestigation(inv => ({
                        ...inv,
                        includeOpticalReferenceStudy: true
                      }))
                    }
                  >
                    ＋ Link SOLARIUM Study (Specimen 01)
                  </button>
                </form>

                {/* Linked Items List */}
                {activeInvestigation.linkedSpecimenIds.length === 0 &&
                !activeInvestigation.includeOpticalReferenceStudy ? (
                  <div className="lab-calm-empty">
                    <h4>No evidence linked to this investigation yet.</h4>
                    <p>
                      Attach a specimen ID above or link the SOLARIUM optical reference study to inspect
                      XRF readings, photographs, and directional lighting behaviour.
                    </p>
                  </div>
                ) : (
                  <div className="sample-list">
                    {activeInvestigation.linkedSpecimenIds.map(sid => {
                      const isInspected =
                        inspectedEvidence?.kind === 'specimen' &&
                        inspectedEvidence.specimenId === sid;
                      return (
                        <div key={sid} className="sample lab-evidence-row">
                          <div className="sample-copy">
                            <strong>{sid}</strong>
                            <small>Physical specimen · Click Inspect to view live XRF and images</small>
                          </div>
                          <div className="lab-evidence-actions">
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => {
                                setActiveSpecimenId(sid);
                                setInspectedEvidence(
                                  isInspected ? null : { kind: 'specimen', specimenId: sid }
                                );
                              }}
                            >
                              {isInspected ? 'Close Inspector' : 'Inspect Evidence'}
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              onClick={() => {
                                setActiveSpecimenId(sid);
                                navigate(`#/solarium/${encodeURIComponent(sid)}`);
                              }}
                            >
                              Open in SOLARIUM
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {activeInvestigation.includeOpticalReferenceStudy && (
                      <div className="sample lab-evidence-row">
                        <div className="sample-copy">
                          <strong>Specimen 01 · SOLARIUM Calibration Twin</strong>
                          <small>
                            Reference 3D geometry (Matrixtwin_opal.glb) · Flash & domain optical maps
                          </small>
                        </div>
                        <div className="lab-evidence-actions">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() =>
                              setInspectedEvidence(
                                inspectedEvidence?.kind === 'solarium-reference'
                                  ? null
                                  : { kind: 'solarium-reference' }
                              )
                            }
                          >
                            {inspectedEvidence?.kind === 'solarium-reference'
                              ? 'Close Inspector'
                              : 'Inspect Optical Maps'}
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => navigate('#/solarium')}
                          >
                            Open in SOLARIUM
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!loadingLiveSpecimens && liveSpecimens.length === 0 && (
                  <p className="lab-subtle-note" style={{ marginTop: 18 }}>
                    The live specimen registry is currently empty. You can register a new physical specimen
                    from Specimens or inspect the SOLARIUM calibration study.
                  </p>
                )}
              </section>
            )}

            {/* TAB 3: EXPERIMENTS (Hypotheses, Procedures, Observations) */}
            {detailTab === 'Experiments' && (
              <section className="surface lab-section-panel">
                <div className="surface-head">
                  <div>
                    <span className="eyebrow">Experimental Work</span>
                    <h3>Hypotheses, Procedures & Observations</h3>
                  </div>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      setRecType('Hypothesis');
                      setComposerOpen(!composerOpen);
                    }}
                  >
                    {composerOpen ? 'Cancel' : '＋ Add Entry'}
                  </button>
                </div>

                {composerOpen && (
                  <form className="lab-record-form" onSubmit={handleAddScientificRecord}>
                    <div className="fields" style={{ marginTop: 0 }}>
                      <div className="field">
                        <label htmlFor="exp-rec-type">Record Type</label>
                        <select
                          id="exp-rec-type"
                          value={recType}
                          onChange={e => setRecType(e.target.value as ScientificRecordType)}
                        >
                          <option value="Hypothesis">Hypothesis</option>
                          <option value="Procedure">Procedure</option>
                          <option value="Observation">Observation</option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="exp-rec-title">Title</label>
                        <input
                          id="exp-rec-title"
                          type="text"
                          placeholder="Concise summary of the hypothesis, step or observation"
                          value={recTitle}
                          onChange={e => setRecTitle(e.target.value)}
                          required
                        />
                      </div>
                      <div className="field full">
                        <label htmlFor="exp-rec-body">Details</label>
                        <textarea
                          id="exp-rec-body"
                          placeholder="Record experimental conditions, method parameters or direct observations…"
                          value={recContent}
                          onChange={e => setRecContent(e.target.value)}
                          required
                        />
                      </div>
                      <div className="field full">
                        <label htmlFor="exp-rec-unc">Uncertainty or Measurement Limits (Optional)</label>
                        <input
                          id="exp-rec-unc"
                          type="text"
                          placeholder="Note instrument limits, calibration bounds or unverified assumptions"
                          value={recUncertainty}
                          onChange={e => setRecUncertainty(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="actions">
                      <button type="submit" className="primary">
                        Save {recType}
                      </button>
                    </div>
                  </form>
                )}

                {experimentRecords.length === 0 ? (
                  <div className="lab-calm-empty">
                    <h4>No hypotheses, procedures or observations recorded yet.</h4>
                    <p>
                      Record a testable hypothesis, experimental procedure, or direct observation.
                      Hypotheses and observations remain distinct from confirmed findings until reviewed.
                    </p>
                  </div>
                ) : (
                  <div className="lab-records-stack">
                    {experimentRecords.map(rec => (
                      <article key={rec.id} className="lab-record-item">
                        <div className="lab-record-meta">
                          <strong>{rec.recordType}</strong>
                          <span>·</span>
                          <span>Verification: {rec.verificationState}</span>
                          <span>·</span>
                          <span>{rec.author}</span>
                          <span>·</span>
                          <time>{new Date(rec.createdAt).toLocaleDateString('en-AU')}</time>
                        </div>
                        <h4>{rec.title}</h4>
                        <p>{rec.content}</p>
                        {rec.uncertaintyNote && (
                          <p className="lab-record-uncertainty">
                            Uncertainty: {rec.uncertaintyNote}
                          </p>
                        )}
                        <div className="lab-record-actions">
                          {rec.verificationState === 'Unverified' && (
                            <button
                              type="button"
                              className="quiet-action"
                              onClick={() => handleUpdateRecordVerification(rec.id, 'Under Review')}
                            >
                              Submit for Review →
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* TAB 4: FINDINGS (Interpretations, Uncertainties, Scientific Review Status) */}
            {detailTab === 'Findings' && (
              <section className="surface lab-section-panel">
                <div className="surface-head">
                  <div>
                    <span className="eyebrow">Interpretations & Scientific Review</span>
                    <h3>Findings</h3>
                  </div>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      setRecType('Interpretation');
                      setComposerOpen(!composerOpen);
                    }}
                  >
                    {composerOpen ? 'Cancel' : '＋ Record Interpretation'}
                  </button>
                </div>

                <p className="lab-subtle-note" style={{ marginBottom: 20 }}>
                  Hypotheses and experimental observations are never automatically promoted. An{' '}
                  <strong>Accepted Finding</strong> requires an explicit review decision with documented
                  uncertainty bounds.
                </p>

                {composerOpen && (
                  <form className="lab-record-form" onSubmit={handleAddScientificRecord}>
                    <div className="fields" style={{ marginTop: 0 }}>
                      <div className="field">
                        <label htmlFor="find-rec-type">Record Classification</label>
                        <select
                          id="find-rec-type"
                          value={recType}
                          onChange={e => setRecType(e.target.value as ScientificRecordType)}
                        >
                          <option value="Interpretation">Scientific Interpretation</option>
                          <option value="Finding">Candidate Finding (For Review)</option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor="find-rec-title">Summary Title</label>
                        <input
                          id="find-rec-title"
                          type="text"
                          placeholder="State the analytical interpretation or candidate finding"
                          value={recTitle}
                          onChange={e => setRecTitle(e.target.value)}
                          required
                        />
                      </div>
                      <div className="field full">
                        <label htmlFor="find-rec-body">Analytical Basis & Evidence Lineage</label>
                        <textarea
                          id="find-rec-body"
                          placeholder="Describe the supporting evidence, specimen IDs and analytical reasoning…"
                          value={recContent}
                          onChange={e => setRecContent(e.target.value)}
                          required
                        />
                      </div>
                      <div className="field full">
                        <label htmlFor="find-rec-unc">Uncertainty & Limitations</label>
                        <input
                          id="find-rec-unc"
                          type="text"
                          placeholder="Document remaining uncertainty, sample size limits or calibration scope"
                          value={recUncertainty}
                          onChange={e => setRecUncertainty(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="actions">
                      <button type="submit" className="primary">
                        Save {recType}
                      </button>
                    </div>
                  </form>
                )}

                {findingRecords.length === 0 ? (
                  <div className="lab-calm-empty">
                    <h4>No interpretations or reviewed findings recorded yet.</h4>
                    <p>
                      Record a scientific interpretation above, or submit an experimental observation for
                      review from the Experiments tab.
                    </p>
                  </div>
                ) : (
                  <div className="lab-records-stack">
                    {findingRecords.map(rec => (
                      <article
                        key={rec.id}
                        className={`lab-record-item ${
                          rec.verificationState === 'Accepted Finding' ? 'is-accepted-finding' : ''
                        }`}
                      >
                        <div className="lab-record-meta">
                          <strong>{rec.recordType}</strong>
                          <span>·</span>
                          <span
                            className={
                              rec.verificationState === 'Accepted Finding'
                                ? 'verification-accepted'
                                : 'verification-pending'
                            }
                          >
                            {rec.verificationState}
                          </span>
                          <span>·</span>
                          <span>Author: {rec.author}</span>
                          {rec.reviewedBy && (
                            <>
                              <span>·</span>
                              <span>Reviewed by {rec.reviewedBy}</span>
                            </>
                          )}
                        </div>
                        <h4>{rec.title}</h4>
                        <p>{rec.content}</p>
                        {rec.uncertaintyNote && (
                          <p className="lab-record-uncertainty">
                            Uncertainty: {rec.uncertaintyNote}
                          </p>
                        )}

                        <div className="lab-record-actions">
                          {rec.verificationState !== 'Accepted Finding' ? (
                            <button
                              type="button"
                              className="secondary"
                              onClick={() =>
                                handleUpdateRecordVerification(rec.id, 'Accepted Finding')
                              }
                            >
                              Approve as Accepted Finding
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="quiet-action"
                              onClick={() =>
                                handleUpdateRecordVerification(rec.id, 'Under Review')
                              }
                            >
                              Return to Under Review
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>

          {/* OPTIONAL CONTEXTUAL INSPECTOR (Opens only when requested) */}
          {inspectedEvidence && (
            <aside className="surface lab-contextual-inspector" aria-label="Evidence Inspector">
              <div className="lab-inspector-head">
                <div>
                  <span className="eyebrow">Evidence Inspector</span>
                  <h4>
                    {inspectedEvidence.kind === 'specimen'
                      ? inspectedEvidence.specimenId
                      : 'Specimen 01 (SOLARIUM)'}
                  </h4>
                </div>
                <button
                  type="button"
                  className="close"
                  onClick={() => setInspectedEvidence(null)}
                  aria-label="Close inspector"
                >
                  ×
                </button>
              </div>

              {inspectedEvidence.kind === 'specimen' && (
                <div className="lab-inspector-body">
                  {loadingInspector ? (
                    <div className="loading" role="status">Loading specimen record…</div>
                  ) : inspectedSpecimenDetail ? (
                    <>
                      <div className="lab-inspector-facts">
                        <div>
                          <span>Material Class</span>
                          <b>{inspectedSpecimenDetail.sample.sample_code} · {inspectedSpecimenDetail.sample.sample_type}</b>
                        </div>
                        <div>
                          <span>Location</span>
                          <b>{inspectedSpecimenDetail.sample.location || '—'}</b>
                        </div>
                        <div>
                          <span>Captured Media</span>
                          <b>{inspectedSpecimenDetail.images.length} item(s)</b>
                        </div>
                        <div>
                          <span>Attached pXRF Readings</span>
                          <b>{inspectedSpecimenDetail.analyses.length} reading(s)</b>
                        </div>
                      </div>

                      <div className="lab-inspector-actions">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            navigate(`#/samples/${encodeURIComponent(inspectedSpecimenDetail.sample.id)}`)
                          }
                        >
                          Open Full Specimen Record
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() =>
                            navigate(`#/solarium/${encodeURIComponent(inspectedSpecimenDetail.sample.id)}`)
                          }
                        >
                          Open in SOLARIUM
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="lab-inspector-empty">
                      <p>
                        No database record found for <strong>{inspectedEvidence.specimenId}</strong> in
                        the live registry.
                      </p>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => navigate('#/samples')}
                      >
                        Go to Specimen Registry
                      </button>
                    </div>
                  )}
                </div>
              )}

              {inspectedEvidence.kind === 'solarium-reference' && (
                <div className="lab-inspector-body">
                  <div className="lab-inspector-facts">
                    <div>
                      <span>Geometry Asset</span>
                      <b>Matrixtwin_opal.glb (Draco compressed)</b>
                    </div>
                    <div>
                      <span>Flash Optical Map</span>
                      <b>Matrixtwin_opal_flash_smooth.png</b>
                    </div>
                    <div>
                      <span>Domain Map</span>
                      <b>Matrixtwin_opal_domain_smooth.png</b>
                    </div>
                    <div>
                      <span>Calibration Scope</span>
                      <b>Directional lighting study · Non-radiometric</b>
                    </div>
                  </div>
                  <div className="lab-inspector-actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => navigate('#/solarium')}
                    >
                      Open in SOLARIUM Light Box
                    </button>
                  </div>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
    );
  }

  // ============================================================================
  // VIEW B: INVESTIGATION LIBRARY (#/the-lab)
  // ============================================================================
  return (
    <div className="lab-screen">
      <TopHeader
        eyebrow="Science"
        title="Investigations"
        sub="Scientific questions, experiments and reviewed findings."
        action={
          <button
            type="button"
            className="primary"
            onClick={() => openNewInvestigationModal(contextSpecimenId)}
          >
            ＋ New Investigation
          </button>
        }
      />

      <section className="surface lab-library-surface">
        {/* Search Bar */}
        <div className="lab-library-toolbar">
          <input
            type="search"
            className="lab-search-input"
            placeholder="Search investigations by title, question or specimen ID…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            aria-label="Search investigations"
          />
          {contextSpecimenId && (
            <span className="lab-context-hint">
              Active specimen context: <strong>{contextSpecimenId}</strong>
            </span>
          )}
        </div>

        {/* Investigation List or Purposeful Empty State */}
        {investigations.length === 0 ? (
          <div className="lab-library-empty">
            <h2>No investigations recorded yet.</h2>
            <p>
              Start an investigation to connect physical specimens, XRF analyses and optical
              observations to a structured research question.
            </p>
            <div className="lab-empty-cta">
              <button
                type="button"
                className="primary"
                onClick={() => openNewInvestigationModal(contextSpecimenId)}
              >
                ＋ New Investigation
              </button>
            </div>
          </div>
        ) : filteredInvestigations.length === 0 ? (
          <div className="lab-library-empty">
            <h2>No investigations match that search.</h2>
            <p>Clear or refine the search filter above.</p>
          </div>
        ) : (
          <div className="sample-list lab-investigation-list">
            {filteredInvestigations.map(inv => {
              const acceptedCount = inv.records.filter(
                r => r.verificationState === 'Accepted Finding'
              ).length;
              return (
                <button
                  key={inv.id}
                  type="button"
                  className="sample lab-investigation-row"
                  onClick={() => {
                    setDetailTab('Overview');
                    setInspectedEvidence(null);
                    navigate(`#/the-lab/${encodeURIComponent(inv.id)}`);
                  }}
                >
                  <div className="sample-copy">
                    <strong>{inv.title}</strong>
                    <small>{inv.question}</small>
                    <small className="lab-row-submeta">
                      Status: {inv.lifecycle} · Researcher: {inv.responsibleResearcher}
                      {inv.relatedSpecimenOrProject
                        ? ` · Related: ${inv.relatedSpecimenOrProject}`
                        : ''}
                      {acceptedCount > 0
                        ? ` · ${acceptedCount} Accepted Finding${acceptedCount === 1 ? '' : 's'}`
                        : ''}
                      {' · Temporary draft'}
                    </small>
                  </div>
                  <div className="sample-status">
                    Open <span>›</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Simple New Investigation Modal (4 required/optional initial fields) */}
      {isNewModalOpen && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-investigation-title"
          onClick={e => {
            if (e.target === e.currentTarget) setIsNewModalOpen(false);
          }}
        >
          <div className="modal-box">
            <div className="modal-head">
              <div>
                <div className="eyebrow">Science · The Lab</div>
                <h2 id="new-investigation-title" className="title" style={{ fontSize: 28 }}>
                  New Investigation
                </h2>
              </div>
              <button
                type="button"
                className="close"
                onClick={() => setIsNewModalOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateInvestigation} noValidate>
              <div className="fields">
                <div className="field full">
                  <label htmlFor="inv-title-input">1. Investigation Title</label>
                  <input
                    id="inv-title-input"
                    type="text"
                    placeholder="e.g. Andamooka Matrix Sulfur Provenance"
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    autoFocus
                    required
                  />
                </div>

                <div className="field full">
                  <label htmlFor="inv-question-input">2. Research Question</label>
                  <textarea
                    id="inv-question-input"
                    placeholder="State the scientific question this investigation seeks to answer…"
                    value={newQuestion}
                    onChange={e => setNewQuestion(e.target.value)}
                    required
                  />
                </div>

                <div className="field">
                  <label htmlFor="inv-related-input">3. Related Specimen or Project (Optional)</label>
                  <input
                    id="inv-related-input"
                    type="text"
                    placeholder="e.g. AHM-000001 or Andamooka Field Horizon"
                    value={newRelated}
                    onChange={e => setNewRelated(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label htmlFor="inv-researcher-input">4. Responsible Researcher</label>
                  <input
                    id="inv-researcher-input"
                    type="text"
                    placeholder="Name or email of lead researcher"
                    value={newResearcher}
                    onChange={e => setNewResearcher(e.target.value)}
                    required
                  />
                </div>
              </div>

              <p className="lab-modal-disclosure">
                Methodologies, contributors, linked evidence and experimental observations can be added
                after creating the investigation. Saved as a temporary browser draft until database
                persistence is enabled.
              </p>

              {newFormError && (
                <div className="form-error" role="alert">
                  {newFormError}
                </div>
              )}

              <div className="actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setIsNewModalOpen(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary">
                  Create Investigation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default TheLabView;
