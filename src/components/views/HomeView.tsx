/**
 * CONSOL Operational Workbench (UX-01)
 * Replaces the marketing-style Home page with an authoritative scientific workstation overview.
 *
 * Displays only verified database records:
 * - Active Specimen Context Bar (with cross-pillar actions)
 * - Specimen Registration & Quick Acquisition Entry Points
 * - Live Specimen Registry & Classification Summary (AHM, ACC, ACX, OTH)
 * - Recent Vanta pXRF Import Batches & Unmatched Exception Counts
 * - Recent Provenance & Evidence Ledger
 * - Four-Pillar Workstation Entry Matrix
 */

import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { TopHeader } from '../layout/TopHeader';
import { api, signed } from '../../services/supabase';
import {
  SpecimenOverview,
  SpecimenCounts,
  ImportBatch,
  SpecimenEvent,
  SPECIMEN_TYPES,
  SPECIMEN_TYPE_BY_CODE
} from '../../types';

const EVENT_LABELS: Record<string, string> = {
  registered: 'Registered',
  photographed: 'Evidence captured',
  analysed: 'pXRF attached',
  measured: 'Dimensions estimated',
  treated: 'Treatment recorded'
};

export const HomeView: React.FC = () => {
  const {
    navigate,
    openModal,
    activeSpecimenId,
    setActiveSpecimenId
  } = useApp();

  const [counts, setCounts] = useState<SpecimenCounts>({ samples: 0, photographed: 0, analysed: 0 });
  const [recentSpecimens, setRecentSpecimens] = useState<SpecimenOverview[]>([]);
  const [recentImports, setRecentImports] = useState<ImportBatch[]>([]);
  const [recentEvents, setRecentEvents] = useState<SpecimenEvent[]>([]);
  const [urlMap, setUrlMap] = useState<((p: string | null | undefined) => string | null) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    Promise.all([
      api.counts(),
      api.overview({ limit: 8 }),
      api.imports().catch(() => [] as ImportBatch[]),
      api.events().catch(() => [] as SpecimenEvent[])
    ])
      .then(async ([c, rec, imp, ev]) => {
        if (!isMounted) return;
        setCounts(c);
        setRecentSpecimens(rec);
        setRecentImports(imp.slice(0, 4));
        setRecentEvents(ev.slice(0, 6));
        const getUrl = await signed(rec.map(x => x.cover_thumb_path || x.cover_path));
        if (isMounted) setUrlMap(() => getUrl);
      })
      .catch(err => {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const activeSpecimenRecord = recentSpecimens.find(s => s.id === activeSpecimenId) || null;
  const totalReviewRows = recentImports.reduce((acc, b) => acc + (b.skipped_count || 0), 0);

  return (
    <div className="workbench-view">
      <TopHeader
        eyebrow="CONSOL · Operational Workstation"
        title="Scientific Workbench"
        sub="Authoritative physical specimen identity, analytical pXRF ingestion, optical inspection, and research investigations."
        action={
          <div className="header-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => navigate(activeSpecimenId ? `#/solarium/${encodeURIComponent(activeSpecimenId)}` : '#/solarium')}
            >
              ◈ Open SOLARIUM
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => openModal('new-sample')}
            >
              ＋ Register specimen
            </button>
          </div>
        }
      />

      {error && (
        <div className="form-error" style={{ marginBottom: 18 }}>
          {error}
        </div>
      )}

      {/* Active Specimen Context Strip */}
      <section className="workbench-context-strip" aria-label="Active specimen workstation context">
        <div className="workbench-context-main">
          <span className="eyebrow">Active Specimen Context</span>
          {activeSpecimenId ? (
            <div className="workbench-context-detail">
              <strong>{activeSpecimenId}</strong>
              <span className="workbench-context-meta">
                {activeSpecimenRecord
                  ? `${activeSpecimenRecord.sample_code} · ${SPECIMEN_TYPE_BY_CODE[activeSpecimenRecord.sample_code]?.short || activeSpecimenRecord.sample_type} · ${activeSpecimenRecord.location || 'Location unrecorded'}`
                  : 'Persisted across Collection, Science, Visualisation, and Workspace'}
              </span>
            </div>
          ) : (
            <div className="workbench-context-detail">
              <strong>No specimen pinned</strong>
              <span className="workbench-context-meta">
                Select a specimen below to maintain its identity across XRF, SOLARIUM, and The Lab.
              </span>
            </div>
          )}
        </div>

        <div className="workbench-context-actions">
          {activeSpecimenId ? (
            <>
              <button
                type="button"
                className="secondary"
                onClick={() => navigate(`#/samples/${encodeURIComponent(activeSpecimenId)}`)}
              >
                Inspect Record
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => openModal('evidence', { sampleId: activeSpecimenId, kind: 'visible' })}
              >
                ＋ Capture Evidence
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => navigate(`#/solarium/${encodeURIComponent(activeSpecimenId)}`)}
              >
                SOLARIUM Chamber
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => navigate(`#/the-lab/${encodeURIComponent(activeSpecimenId)}`)}
              >
                Investigations
              </button>
              <button
                type="button"
                className="quiet-action"
                onClick={() => setActiveSpecimenId(null)}
                style={{ padding: '0 8px' }}
              >
                Clear
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="secondary"
                onClick={() => navigate('#/samples')}
              >
                Select from Registry
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => navigate('#/the-lab')}
              >
                Investigations
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => navigate('#/solarium')}
              >
                SOLARIUM Calibration Study (Specimen 01)
              </button>
            </>
          )}
        </div>
      </section>

      {/* Primary Operational Telemetry & Registry State */}
      <div className="workbench-ledger-strip" role="region" aria-label="Database Registry State">
        <div className="ledger-cell">
          <span className="ledger-label">Registered Specimens</span>
          <strong className="ledger-value">{loading ? '—' : counts.samples}</strong>
          <small className="ledger-sub">AHM · ACC · ACX · OTH</small>
        </div>
        <div className="ledger-cell">
          <span className="ledger-label">Media Evidence Records</span>
          <strong className="ledger-value">{loading ? '—' : counts.photographed}</strong>
          <small className="ledger-sub">Visible · UV · Phosphorescence</small>
        </div>
        <div className="ledger-cell">
          <span className="ledger-label">Attached pXRF Readings</span>
          <strong className="ledger-value">{loading ? '—' : counts.analysed}</strong>
          <small className="ledger-sub">Exact Specimen ID Match</small>
        </div>
        <div className="ledger-cell">
          <span className="ledger-label">Import Review Queue</span>
          <strong className="ledger-value">{loading ? '—' : totalReviewRows}</strong>
          <small className="ledger-sub">Unmatched Vanta Rows (Recent)</small>
        </div>
      </div>

      {/* Main Two-Column Workstation Grid */}
      <div className="workbench-grid">
        {/* Left Column: Specimen Registry & Recent Evidence */}
        <section className="surface">
          <div className="surface-head">
            <div>
              <span className="eyebrow">Collection</span>
              <h3>Specimen Registry</h3>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button
                type="button"
                className="quiet-action"
                onClick={() => openModal('new-sample')}
              >
                ＋ New Specimen
              </button>
              <button
                type="button"
                className="quiet-action"
                onClick={() => navigate('#/samples')}
              >
                Full Registry →
              </button>
            </div>
          </div>

          <div className="sample-list">
            {loading ? (
              <div className="loading" role="status">Querying specimen registry…</div>
            ) : recentSpecimens.length > 0 ? (
              recentSpecimens.map(s => {
                const thumb = urlMap ? urlMap(s.cover_thumb_path || s.cover_path) : null;
                const typeInfo = SPECIMEN_TYPE_BY_CODE[s.sample_code] || SPECIMEN_TYPES[3];
                const isPinned = activeSpecimenId === s.id;

                return (
                  <div
                    key={s.id}
                    className={`sample workbench-sample-row ${isPinned ? 'is-pinned' : ''}`}
                  >
                    <button
                      type="button"
                      className="workbench-sample-main"
                      onClick={() => {
                        setActiveSpecimenId(s.id);
                        navigate(`#/samples/${encodeURIComponent(s.id)}`);
                      }}
                    >
                      <div className="thumb">
                        {thumb ? <img src={thumb} alt={s.id} loading="lazy" /> : null}
                      </div>
                      <div className="sample-copy">
                        <strong>{s.id}</strong>
                        <small>
                          {s.sample_code} · {typeInfo.short} · {s.location || 'Location not recorded'}
                        </small>
                      </div>
                    </button>

                    <div className="workbench-sample-meta">
                      <span>{s.image_count || 0} img</span>
                      <span>·</span>
                      <span>{s.analysis_count || 0} pXRF</span>
                      <button
                        type="button"
                        className={`pin-btn ${isPinned ? 'active' : ''}`}
                        onClick={() => setActiveSpecimenId(isPinned ? null : s.id)}
                        title={isPinned ? 'Pinned as active specimen' : 'Pin specimen to workstation context'}
                      >
                        {isPinned ? 'Pinned' : 'Pin'}
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="workbench-empty-registry">
                <span className="eyebrow">Specimen Registry</span>
                <h4>No physical specimens registered in this workspace yet.</h4>
                <p>
                  Register an Andamooka specimen (AHM, ACC, ACX, or OTH) to generate a permanent
                  database-assigned specimen ID, or open the SOLARIUM Reference Calibration Study.
                </p>
                <div className="workbench-empty-actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => openModal('new-sample')}
                  >
                    ＋ Register First Specimen
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => navigate('#/solarium')}
                  >
                    ◈ Open SOLARIUM Demo (Specimen 01)
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Instrument Ingestion & Recent Provenance Activity */}
        <div className="workbench-side-stack">
          {/* XRF Batch Ingestion Status */}
          <section className="surface">
            <div className="surface-head">
              <div>
                <span className="eyebrow">Collection</span>
                <h3>Vanta pXRF Batches</h3>
              </div>
              <button
                type="button"
                className="quiet-action"
                onClick={() => navigate('#/xrf-inbox')}
              >
                Open XRF Inbox →
              </button>
            </div>

            {loading ? (
              <div className="loading" role="status">Checking import batches…</div>
            ) : recentImports.length > 0 ? (
              <div className="import-list">
                {recentImports.map(batch => (
                  <div key={batch.id} className="import-row">
                    <div>
                      <strong>{batch.raw_files?.file_name || 'Vanta export'}</strong>
                      <small>
                        {new Date(batch.created_at).toLocaleDateString('en-AU')} ·{' '}
                        <span className="mono-hash">
                          {(batch.raw_files?.sha256 || '').slice(0, 10)}…
                        </span>
                      </small>
                    </div>
                    <div className="import-metrics-inline">
                      <span>{batch.imported_count || 0} attached</span>
                      <span>·</span>
                      <span>{batch.skipped_count || 0} review</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="workbench-compact-empty">
                <p>No Vanta pXRF export batches ingested yet.</p>
                <a className="quiet-link" href="?runtime=legacy#/xrf-inbox">
                  Launch batch CSV importer →
                </a>
              </div>
            )}
          </section>

          {/* Recent Provenance & Evidence Ledger */}
          <section className="surface">
            <div className="surface-head">
              <div>
                <span className="eyebrow">Workspace</span>
                <h3>Recent Provenance Events</h3>
              </div>
              <button
                type="button"
                className="quiet-action"
                onClick={() => navigate('#/provenance')}
              >
                Full Ledger →
              </button>
            </div>

            {loading ? (
              <div className="loading" role="status">Loading provenance ledger…</div>
            ) : recentEvents.length > 0 ? (
              <div className="events">
                {recentEvents.map(ev => (
                  <button
                    key={ev.id}
                    type="button"
                    className="event"
                    onClick={() => {
                      setActiveSpecimenId(ev.sample_id);
                      navigate(`#/samples/${encodeURIComponent(ev.sample_id)}`);
                    }}
                  >
                    <span className="event-main">
                      <strong>
                        {ev.sample_id} · {EVENT_LABELS[ev.kind] || ev.kind}
                      </strong>
                      <small>
                        {new Date(ev.created_at).toLocaleString('en-AU')}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="workbench-compact-empty">
                <p>No specimen events recorded in the audit ledger yet.</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default HomeView;
