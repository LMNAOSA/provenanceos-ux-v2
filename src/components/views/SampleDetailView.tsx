/**
 * CONSOL SampleDetailView Component
 * High-precision authoritative specimen record view.
 * 4 deep scientific tabs: Overview, Evidence, Analysis, and History.
 * Features:
 * - Permanent physical specimen identity stage with SOLARIUM module reservation boundary
 * - Chemical Sulfur callout preserving distinction between elemental observation and treatment dose
 * - Analytical ElementGrid presenting concentrations, units, LOD qualifiers (< LOD), and uncertainties (± error)
 * - Multi-mode evidence galleries (Visible light, UV fluorescence, Phosphorescence video)
 * - Traceable Vanta source file hashes and audit history
 */

import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { TopHeader } from '../layout/TopHeader';
import { ElementGrid } from '../common/ElementGrid';
import { TreatmentStrip } from '../common/TreatmentStrip';
import { api } from '../../services/supabase';
import {
  SpecimenDetail,
  SPECIMEN_TYPES,
  SPECIMEN_TYPE_BY_CODE,
  CaptureKind
} from '../../types';

const EVENT_LABELS: Record<string, string> = {
  registered: 'Registered',
  photographed: 'Evidence captured',
  analysed: 'pXRF attached',
  measured: 'Dimensions estimated',
  treated: 'Treatment recorded'
};

function fmtNum(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return '—';
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 3 }).format(val);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : new Intl.DateTimeFormat('en-AU', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }).format(d);
}

export const SampleDetailView: React.FC = () => {
  const { specimenId, activeTab, setActiveTab, navigate, openModal } = useApp();
  const [detail, setDetail] = useState<SpecimenDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSpecimen = React.useCallback((quiet = false) => {
    if (!specimenId) return;
    if (!quiet) setLoading(true);
    setError(null);

    api.sampleDetail(specimenId)
      .then(d => {
        if (!d.sample) {
          setError(`No record exists for specimen ${specimenId}`);
        } else {
          setDetail(d);
        }
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [specimenId]);

  useEffect(() => {
    loadSpecimen(false);
    const onRefresh = () => loadSpecimen(true);
    window.addEventListener('consol:data-updated', onRefresh);
    return () => {
      window.removeEventListener('consol:data-updated', onRefresh);
    };
  }, [loadSpecimen]);

  if (!specimenId) {
    return (
      <div className="card pad">
        <div className="section-title">Specimen Not Specified</div>
        <p className="sub">Select a specimen from the collection to inspect analytical records.</p>
        <button className="primary" onClick={() => navigate('#/samples')}>
          Return to Registry
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="loading" role="status">
        Loading specimen record {specimenId}…
      </div>
    );
  }

  if (error || !detail) {
    return (
      <>
        <TopHeader
          eyebrow="Sample"
          title="Not found"
          sub={error || `No record exists for ${specimenId}`}
        />
        <div className="card pad">
          <button className="secondary" onClick={() => navigate('#/samples')}>
            ← Back to Registry
          </button>
        </div>
      </>
    );
  }

  const s = detail.sample;
  const cover = detail.images.find(x => x.capture_kind === 'visible') || detail.images[0];
  const coverUrl = cover && detail.urlOf ? detail.urlOf(cover.storage_path) : null;
  const typeInfo = SPECIMEN_TYPE_BY_CODE[s.sample_code] || SPECIMEN_TYPES[3];
  const tabs = ['Overview', 'Evidence', 'Analysis', 'History'];

  const latestAnalysis = detail.analyses[0];
  const latestMeasurement = detail.measurements[0];
  const sulfurObservation = latestAnalysis?.results?.S;

  const evidenceKinds = [...new Set(detail.images.map(img => img.capture_kind))];

  return (
    <>
      <TopHeader
        eyebrow="Specimen record"
        title={s.id}
        sub={`${typeInfo.short} · ${typeInfo.name} · ${s.location || 'Location not recorded'}`}
        action={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="secondary" onClick={() => navigate('#/samples')}>
              ← Registry
            </button>
            <button
              className="secondary"
              onClick={() => navigate(`#/soloptics/${encodeURIComponent(s.id)}`)}
              title="Open SOLOPTICS mobile optical acquisition for this specimen"
            >
              ◎ SOLOPTICS Capture
            </button>
            <button
              className="secondary"
              onClick={() => navigate(`#/the-lab/${encodeURIComponent(s.id)}`)}
              title="Link this specimen into The Lab research workspace"
            >
              Open in The Lab
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => openModal('evidence', { sampleId: s.id, kind: 'visible' })}
            >
              ＋ Capture Evidence
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => openModal('import-csv', { sampleId: s.id })}
            >
              ＋ Attach pXRF
            </button>
          </div>
        }
      />

      <div className="record-grid">
        {/* Specimen Visual Stage & SOLARIUM Reservation Boundary */}
        <section className={`specimen-stage ${coverUrl ? 'has-image' : ''}`}>
          {coverUrl ? (
            <img src={coverUrl} alt={s.id} />
          ) : (
            <div className="stage-empty">
              <span>No visible-light specimen image yet.</span>
              <small style={{ color: 'var(--muted)', marginTop: 8 }}>
                Capture evidence to populate specimen stage.
              </small>
            </div>
          )}

          {/* Integrated anchor for SOLARIUM Light Box & SOLOPTICS */}
          <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => navigate(`#/soloptics/${encodeURIComponent(s.id)}`)}
              style={{
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                padding: '5px 12px',
                borderRadius: 999,
                background: 'rgba(12, 23, 29, 0.85)',
                border: '1px solid rgba(255, 255, 255, 0.24)',
                color: 'var(--ink)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer'
              }}
              title="Open specimen in SOLOPTICS Optical Acquisition"
            >
              ◎ SOLOPTICS
            </button>
            <button
              type="button"
              onClick={() => navigate(`#/solarium/${encodeURIComponent(s.id)}`)}
              style={{
                fontSize: 10,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                padding: '5px 12px',
                borderRadius: 999,
                background: 'rgba(12, 23, 29, 0.85)',
                border: '1px solid rgba(158, 230, 221, 0.4)',
                color: 'var(--aqua)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer'
              }}
              title="Open specimen in SOLARIUM Light Box"
            >
              ◈ Open in SOLARIUM
            </button>
          </div>

          <div className="stage-id">
            <span>{s.id}</span>
            <small>permanent specimen identity</small>
          </div>
        </section>

        {/* Specimen Record Analytical Panel */}
        <section className="surface record-panel">
          <div className="record-top">
            <div>
              <span className="eyebrow">
                Registered {fmtDate(s.created_at)}
              </span>
              <h2>{s.id}</h2>
              <p>{typeInfo.note}</p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="tabs">
            {tabs.map(t => (
              <button
                key={t}
                className={t === activeTab ? 'active' : ''}
                onClick={() => setActiveTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'Overview' && (
            <div>
              <div className="facts">
                <div>
                  <span>Location</span>
                  <b>{s.location || '—'}</b>
                </div>
                <div>
                  <span>Weight</span>
                  <b>{s.weight_g != null ? `${fmtNum(s.weight_g)} g` : '—'}</b>
                </div>
                <div>
                  <span>Dimension estimate</span>
                  <b>
                    {latestMeasurement
                      ? `${fmtNum(latestMeasurement.dimensions?.length_mm)} mm (2D)`
                      : 'Not measured'}
                  </b>
                </div>
                <div>
                  <span>Evidence sets</span>
                  <b>
                    {evidenceKinds.length > 0
                      ? evidenceKinds.join(' · ')
                      : '—'}
                  </b>
                </div>
              </div>

              {/* Treatment Status Strip */}
              <TreatmentStrip
                treatments={detail.treatments}
                onAddTreatment={() => {
                  openModal('treatment', { sampleId: s.id });
                }}
              />

              <div className="scientific-note">
                <span className="eyebrow">Evidence discipline</span>
                <p>
                  Original media and source Vanta rows are preserved. Derived masks and camera
                  estimates remain explicitly labelled as derivatives.
                </p>
              </div>

              {/* Scientific Sulfur Observation Callout */}
              {sulfurObservation && (
                <div className="scientific-note">
                  <span className="eyebrow">Sulfur observation</span>
                  <p>
                    <b>
                      {sulfurObservation.lod ? '<LOD' : fmtNum(sulfurObservation.value)}{' '}
                      {sulfurObservation.unit || ''}
                    </b>{' '}
                    observed in the latest pXRF reading. This is an elemental observation, not a
                    treatment-dose estimate.
                  </p>
                </div>
              )}

              {/* Latest Analytical pXRF Preview */}
              {latestAnalysis ? (
                <div className="analysis-preview">
                  <div className="surface-head">
                    <div>
                      <span className="eyebrow">Latest pXRF</span>
                      <h3>
                        {latestAnalysis.instrument || 'Vanta'} ·{' '}
                        {latestAnalysis.method || 'Method not recorded'}
                      </h3>
                    </div>
                    <button className="quiet-action" onClick={() => setActiveTab('Analysis')}>
                      View all data
                    </button>
                  </div>
                  <ElementGrid results={latestAnalysis.results} />
                </div>
              ) : (
                <div className="empty-state compact">
                  <p>No pXRF results attached to this specimen yet.</p>
                  <button
                    type="button"
                    className="secondary"
                    style={{ marginTop: 8 }}
                    onClick={() => openModal('import-csv', { sampleId: s.id })}
                  >
                    Import Vanta data
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: EVIDENCE */}
          {activeTab === 'Evidence' && (
            <div className="evidence-sections">
              {(['visible', 'fluorescence', 'phosphorescence'] as CaptureKind[]).map(kind => {
                const title =
                  kind === 'visible'
                    ? 'Visible light'
                    : kind === 'fluorescence'
                      ? 'Fluorescence'
                      : 'Phosphorescence';
                const sub =
                  kind === 'visible'
                    ? 'Original daylight / normal capture'
                    : kind === 'fluorescence'
                      ? 'UV response — wavelength/source noted in records'
                      : 'Afterglow sequence — photo or video capture';

                const mediaItems = detail.images.filter(img => img.capture_kind === kind);

                return (
                  <section key={kind} style={{ marginBottom: 28 }}>
                    <div className="section-intro" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span className="eyebrow">{title}</span>
                        <p>{sub}</p>
                      </div>
                      <button
                        className="secondary"
                        style={{ fontSize: 12, padding: '5px 12px' }}
                        onClick={() => openModal('evidence', { sampleId: s.id, kind })}
                      >
                        ＋ Capture {title}
                      </button>
                    </div>

                    <div className="media-grid">
                      {mediaItems.length > 0 ? (
                        mediaItems.map(item => {
                          const src = detail.urlOf
                            ? detail.urlOf(item.storage_path || item.thumb_path)
                            : null;
                          const isVideo = (item.media_type || '').startsWith('video/');

                          return (
                            <div key={item.id} className="media-tile">
                              {src ? (
                                isVideo ? (
                                  <video controls preload="metadata" src={src}></video>
                                ) : (
                                  <img src={src} alt={item.file_name || title} />
                                )
                              ) : (
                                <span className="tile-missing">Preview unavailable</span>
                              )}
                              <div>
                                <strong>{item.file_name || title}</strong>
                                <small>
                                  {item.processing_method || 'original'} ·{' '}
                                  {fmtDate(item.created_at)}
                                </small>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="empty-state compact" style={{ gridColumn: '1 / -1' }}>
                          <p>No {title.toLowerCase()} capture recorded.</p>
                        </div>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {/* TAB 3: ANALYSIS */}
          {activeTab === 'Analysis' && (
            <div>
              {detail.analyses.length > 0 ? (
                <div>
                  <div className="analysis-head">
                    <div>
                      <span className="eyebrow">
                        {detail.analyses.length} stored reading
                        {detail.analyses.length === 1 ? '' : 's'}
                      </span>
                      <p>
                        Exact specimen-ID matches only. Source rows remain attached to the
                        export hash.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => openModal('import-csv', { sampleId: s.id })}
                    >
                      ＋ Add export
                    </button>
                  </div>

                  <div className="reading-list">
                    {detail.analyses.map((a, i) => (
                      <article key={a.id || i} className="card pad" style={{ marginBottom: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                          <div>
                            <strong>#{a.reading_no || String(i + 1)}</strong>
                            <small style={{ display: 'block', color: 'var(--muted)', marginTop: 4 }}>
                              {fmtDateTime(a.measured_at)} · {a.instrument || 'Vanta'} ·{' '}
                              {a.method || 'Method not recorded'}
                            </small>
                          </div>
                        </div>

                        <ElementGrid results={a.results} />

                        <div
                          className="reading-foot"
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginTop: 14,
                            paddingTop: 10,
                            borderTop: '1px solid var(--line)',
                            fontSize: 11,
                            color: 'var(--muted)'
                          }}
                        >
                          <span>{a.source_file || 'Vanta export'}</span>
                          <span className="hash" style={{ fontFamily: 'monospace' }}>
                            {(a.source_sha256 || '').slice(0, 16)}…
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <h2>No pXRF attached</h2>
                  <p>Batch import Vanta CSV files matching this specimen ID.</p>
                  <button
                    type="button"
                    className="primary"
                    style={{ marginTop: 10 }}
                    onClick={() => openModal('import-csv', { sampleId: s.id })}
                  >
                    Import Vanta CSV
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: HISTORY */}
          {activeTab === 'History' && (
            <div className="events record-events">
              {detail.events.length > 0 ? (
                detail.events.map(e => {
                  const label = EVENT_LABELS[e.kind] || e.kind.toUpperCase();
                  const detailText = JSON.stringify(e.detail || {});

                  return (
                    <div key={e.id} className="event">
                      <i className="event-dot"></i>
                      <span className="event-main">
                        <strong>{label}</strong>
                        <small>{detailText}</small>
                      </span>
                      <time>{fmtDateTime(e.created_at)}</time>
                    </div>
                  );
                })
              ) : (
                <div className="empty-state compact">
                  <p>No recorded events for this specimen.</p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
};

export default SampleDetailView;
