/**
 * CONSOL Route Containers
 * Implements the React 19 layout views for all 8 canonical routes:
 * #/home, #/samples, #/samples/:id, #/xrf-inbox, #/reference-data, #/method, #/provenance, #/settings.
 * Connects directly to the Stage 2 typed Supabase DAO service while preserving full
 * route addressability, specimen context restoration, and browser history.
 */

import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { TopHeader } from '../layout/TopHeader';
import { api, signed } from '../../services/supabase';
import config from '../../config';
import {
  SpecimenOverview,
  SpecimenCounts,
  SpecimenDetail,
  ImportBatch,
  HistoricalDataset,
  SpecimenEvent,
  SPECIMEN_TYPES,
  SPECIMEN_TYPE_BY_CODE,
  SpecimenCode
} from '../../types';

export const HomeRoute: React.FC = () => {
  const { navigate } = useApp();
  const [counts, setCounts] = useState<SpecimenCounts>({ samples: 0, photographed: 0, analysed: 0 });
  const [recent, setRecent] = useState<SpecimenOverview[]>([]);
  const [urlMap, setUrlMap] = useState<((p: string | null | undefined) => string | null) | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([api.counts(), api.overview({ limit: 6 })])
      .then(async ([c, rec]) => {
        if (!active) return;
        setCounts(c);
        setRecent(rec);
        const getUrl = await signed(rec.map(x => x.cover_thumb_path || x.cover_path));
        if (active) setUrlMap(() => getUrl);
      })
      .catch(console.error)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return (
    <>
      <TopHeader
        eyebrow="Australian Provenance Project"
        title="A record of what was found."
        sub="Register once. Capture once. Let the evidence accumulate."
        action={
          <button className="primary" onClick={() => navigate('#/samples')}>
            View Registry
          </button>
        }
      />

      <div className="home-grid">
        <section className="hero-surface">
          <div className="orbital"></div>
          <span className="pill">
            <i className="dot"></i> ProvenanceOS / Live Registry
          </span>
          <h2>Identity before interpretation.</h2>
          <p>
            Every specimen receives a permanent code. Images, observations and instrument
            results attach to that identity — without overwriting the original evidence.
          </p>
          <div className="stats">
            <div>
              <b>{loading ? '…' : counts.samples}</b>
              <span>Specimens</span>
            </div>
            <div>
              <b>{loading ? '…' : counts.photographed}</b>
              <span>With Evidence</span>
            </div>
            <div>
              <b>{loading ? '…' : counts.analysed}</b>
              <span>Analysed</span>
            </div>
          </div>
        </section>

        <section className="surface">
          <div className="surface-head">
            <div>
              <span className="eyebrow">Registry</span>
              <h3>Recent specimens</h3>
            </div>
            <button className="quiet-action" onClick={() => navigate('#/samples')}>
              View all
            </button>
          </div>

          <div className="sample-list">
            {loading ? (
              <div className="loading" role="status">Loading specimens…</div>
            ) : recent.length > 0 ? (
              recent.map(s => {
                const thumb = urlMap ? urlMap(s.cover_thumb_path || s.cover_path) : null;
                const typeInfo = SPECIMEN_TYPE_BY_CODE[s.sample_code] || SPECIMEN_TYPES[3];
                return (
                  <button
                    key={s.id}
                    className="sample"
                    onClick={() => navigate(`#/samples/${encodeURIComponent(s.id)}`)}
                  >
                    <div className="thumb">
                      {thumb ? <img src={thumb} alt="" loading="lazy" /> : null}
                    </div>
                    <div className="sample-copy">
                      <strong>{s.id}</strong>
                      <small>
                        <span className={`code-pill code-${s.sample_code}`}>{s.sample_code}</span>{' '}
                        {typeInfo.short} · {s.location || 'Location not recorded'}
                      </small>
                    </div>
                    <div className="sample-status">
                      {s.analysis_count ? 'Analysed' : 'Registered'} <span>›</span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="empty-state compact">
                <p>No specimens registered yet.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
};

export const SamplesRoute: React.FC = () => {
  const { navigate } = useApp();
  const [samples, setSamples] = useState<SpecimenOverview[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<SpecimenCode | 'ALL'>('ALL');
  const [urlMap, setUrlMap] = useState<((p: string | null | undefined) => string | null) | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.overview({ limit: 500 })
      .then(async list => {
        if (!active) return;
        setSamples(list);
        const getUrl = await signed(list.map(x => x.cover_thumb_path || x.cover_path));
        if (active) setUrlMap(() => getUrl);
      })
      .catch(console.error)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const filtered = selectedFilter === 'ALL'
    ? samples
    : samples.filter(s => s.sample_code === selectedFilter);

  return (
    <>
      <TopHeader
        eyebrow="Collection"
        title="Samples"
        sub="The physical registry — choose the material class, then let the system count it."
      />

      <section className="surface">
        <div className="filter-row">
          <div className="code-filters">
            <button
              className={`filter ${selectedFilter === 'ALL' ? 'active' : ''}`}
              onClick={() => setSelectedFilter('ALL')}
            >
              ALL
              <small>All classes</small>
            </button>
            {SPECIMEN_TYPES.map(t => (
              <button
                key={t.code}
                className={`filter ${selectedFilter === t.code ? 'active' : ''}`}
                onClick={() => setSelectedFilter(t.code)}
              >
                {t.code}
                <small>{t.short}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="sample-list">
          {loading ? (
            <div className="loading" role="status">Loading collection…</div>
          ) : filtered.length > 0 ? (
            filtered.map(s => {
              const thumb = urlMap ? urlMap(s.cover_thumb_path || s.cover_path) : null;
              const typeInfo = SPECIMEN_TYPE_BY_CODE[s.sample_code] || SPECIMEN_TYPES[3];
              return (
                <button
                  key={s.id}
                  className="sample"
                  onClick={() => navigate(`#/samples/${encodeURIComponent(s.id)}`)}
                >
                  <div className="thumb">
                    {thumb ? <img src={thumb} alt="" loading="lazy" /> : null}
                  </div>
                  <div className="sample-copy">
                    <strong>{s.id}</strong>
                    <small>
                      <span className={`code-pill code-${s.sample_code}`}>{s.sample_code}</span>{' '}
                      {typeInfo.short} · {s.location || 'Location not recorded'}
                    </small>
                  </div>
                  <div className="sample-status">
                    {s.analysis_count ? 'Analysed' : 'Registered'} <span>›</span>
                  </div>
                </button>
              );
            })
          ) : (
            <div className="empty-state">
              <h2>Nothing in this class.</h2>
              <p>Filter or register specimens to view records.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
};

export const SampleDetailRoute: React.FC = () => {
  const { specimenId, activeTab, setActiveTab, navigate } = useApp();
  const [detail, setDetail] = useState<SpecimenDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!specimenId) return;
    let active = true;
    setLoading(true);
    setError(null);

    api.sampleDetail(specimenId)
      .then(d => {
        if (!active) return;
        if (!d.sample) {
          setError(`No record exists for specimen ${specimenId}`);
        } else {
          setDetail(d);
        }
      })
      .catch(err => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [specimenId]);

  if (!specimenId) {
    return (
      <div className="card pad">
        <div className="section-title">Specimen Not Specified</div>
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
        <TopHeader eyebrow="Sample" title="Not found" sub={error || `No record exists for ${specimenId}`} />
        <div className="card pad">
          <button className="secondary" onClick={() => navigate('#/samples')}>
            Back to Samples
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

  return (
    <>
      <TopHeader
        eyebrow="Specimen record"
        title={s.id}
        sub={`${s.sample_code} · ${typeInfo.name} · ${s.location || 'Location not recorded'}`}
        action={
          <button className="secondary" onClick={() => navigate('#/samples')}>
            ← Registry
          </button>
        }
      />

      <div className="record-grid">
        <section className={`specimen-stage ${coverUrl ? 'has-image' : ''}`}>
          {coverUrl ? (
            <img src={coverUrl} alt={s.id} />
          ) : (
            <div className="stage-empty">
              No visible-light specimen image yet.
            </div>
          )}
          <div className="stage-id">
            <span>{s.id}</span>
            <small>permanent specimen identity</small>
          </div>
        </section>

        <section className="surface record-panel">
          <div className="record-top">
            <div>
              <span className="eyebrow">
                Registered {new Date(s.created_at).toLocaleDateString('en-AU')}
              </span>
              <h2>{s.id}</h2>
              <p>{typeInfo.note}</p>
            </div>
          </div>

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

          <div className="tab-body">
            {activeTab === 'Overview' && (
              <div className="facts">
                <div>
                  <span>Location</span>
                  <b>{s.location || '—'}</b>
                </div>
                <div>
                  <span>Weight</span>
                  <b>{s.weight_g != null ? `${s.weight_g} g` : '—'}</b>
                </div>
                <div>
                  <span>Dimensions</span>
                  <b>{s.dimensions || '—'}</b>
                </div>
                <div>
                  <span>Evidence items</span>
                  <b>{detail.images.length} item{detail.images.length === 1 ? '' : 's'}</b>
                </div>
              </div>
            )}

            {activeTab === 'Evidence' && (
              <div className="media-grid">
                {detail.images.length > 0 ? (
                  detail.images.map(img => {
                    const src = detail.urlOf ? detail.urlOf(img.storage_path || img.thumb_path) : null;
                    return (
                      <div key={img.id} className="media-tile">
                        {src ? <img src={src} alt={img.file_name} /> : <div>No preview</div>}
                        <div>
                          <strong>{img.file_name}</strong>
                          <small>{img.capture_kind} · {img.processing_method}</small>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="empty-state compact">
                    <p>No evidence items captured for this specimen.</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'Analysis' && (
              <div className="reading-list">
                {detail.analyses.length > 0 ? (
                  detail.analyses.map((a, i) => (
                    <article key={a.id || i} className="card pad" style={{ marginBottom: 12 }}>
                      <div>
                        <strong>#{a.reading_no || String(i + 1)}</strong>
                        <small style={{ display: 'block', color: 'var(--muted)', marginTop: 4 }}>
                          {a.instrument || 'Vanta'} · {a.method || 'Geochem'} · {a.measured_at || ''}
                        </small>
                      </div>
                      <div className="reading-foot" style={{ marginTop: 12 }}>
                        <span>Source: {a.source_file || 'Vanta CSV'}</span>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state compact">
                    <p>No pXRF readings attached to this specimen.</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'History' && (
              <div className="events">
                {detail.events.length > 0 ? (
                  detail.events.map(e => (
                    <div key={e.id} className="event">
                      <i className="event-dot"></i>
                      <span className="event-main">
                        <strong>{e.kind.toUpperCase()}</strong>
                        <small>{JSON.stringify(e.detail)}</small>
                      </span>
                      <time>{new Date(e.created_at).toLocaleString('en-AU')}</time>
                    </div>
                  ))
                ) : (
                  <div className="empty-state compact">
                    <p>No audit events recorded.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
};

export const XrfInboxRoute: React.FC = () => {
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.imports()
      .then(setImports)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <TopHeader
        eyebrow="Instrument"
        title="XRF Inbox"
        sub="Drop in a Vanta export periodically. One file can connect hundreds of readings."
      />

      <div className="inbox-hero">
        <div>
          <span className="eyebrow">Batch workflow</span>
          <h2>One export. Many specimens.</h2>
          <p>
            The original CSV is preserved and hashed. Exact specimen IDs are matched
            automatically; anything ambiguous stays in review.
          </p>
        </div>
        <div className="inbox-steps">
          <span>01<br /><b>Export</b></span>
          <i>→</i>
          <span>02<br /><b>Match</b></span>
          <i>→</i>
          <span>03<br /><b>Attach</b></span>
        </div>
      </div>

      <section className="surface">
        <div className="surface-head">
          <div>
            <span className="eyebrow">Import history</span>
            <h3>Recent exports</h3>
          </div>
        </div>

        {loading ? (
          <div className="loading" role="status">Loading import history…</div>
        ) : imports.length > 0 ? (
          <div className="import-list">
            {imports.map(item => (
              <div key={item.id} className="import-row">
                <div>
                  <strong>{item.raw_files?.file_name || 'Vanta export'}</strong>
                  <small>
                    {new Date(item.created_at).toLocaleString('en-AU')} ·{' '}
                    {(item.raw_files?.sha256 || '').slice(0, 12)}…
                  </small>
                </div>
                <div className="import-metrics">
                  <span>{item.imported_count || 0} attached</span>
                  <span>{item.duplicate_count || 0} already held</span>
                  <span>{item.skipped_count || 0} review</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state compact">
            <p>No Vanta exports have been ingested yet.</p>
          </div>
        )}
      </section>
    </>
  );
};

export const ReferenceDataRoute: React.FC = () => {
  const [datasets, setDatasets] = useState<HistoricalDataset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.historicalDatasets()
      .then(setDatasets)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <TopHeader
        eyebrow="Reference data"
        title="Historical datasets"
        sub="Original scientific records that inform provenance without becoming physical specimens."
      />

      <section className="surface">
        <div className="surface-head">
          <div>
            <span className="eyebrow">Archive</span>
            <h3>Historical reference datasets</h3>
          </div>
        </div>

        {loading ? (
          <div className="loading" role="status">Loading historical datasets…</div>
        ) : datasets.length > 0 ? (
          <div className="dataset-list">
            {datasets.map(d => (
              <article key={d.id} className="dataset-row">
                <div>
                  <strong>{d.name}</strong>
                  <small>
                    {d.dataset_type} · {new Date(d.created_at).toLocaleString('en-AU')}
                  </small>
                </div>
                <div className="import-metrics">
                  <span>{d.metadata?.record_count || 0} records</span>
                  <span>{d.metadata?.observation_count || 0} observations</span>
                  <span>{(d.raw_files?.sha256 || '').slice(0, 12)}…</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state compact">
            <p>No historical reference datasets have been imported.</p>
            <p className="sub">These records remain separate from physical specimen records.</p>
          </div>
        )}
      </section>
    </>
  );
};

export const MethodRoute: React.FC = () => {
  return (
    <>
      <TopHeader
        eyebrow="Field method"
        title="ProvenanceOS™ method"
        sub="The operating record for specimen capture, pXRF handling and evidence discipline."
        action={
          <a
            className="method-download"
            href="field-guide.pdf"
            download="ProvenanceOS_Field_Guide_Mat.pdf"
            aria-label="Download ProvenanceOS Field Guide"
          >
            <span>DOWNLOAD</span>
            <span>FIELD GUIDE</span>
          </a>
        }
      />

      <section className="surface method-flow">
        <div className="method-flow-intro">
          <div className="eyebrow">FIELD WORKFLOW</div>
          <h2>Field workflow</h2>
          <p>One specimen. One record. Capture everything as you go.</p>
        </div>

        <div className="method-steps">
          <article className="method-step">
            <div className="method-step-number">01</div>
            <div className="method-step-icon">+</div>
            <div className="method-step-content">
              <div className="method-step-label">REGISTER</div>
              <h3>Start the specimen record</h3>
              <p>Choose the material class:</p>
              <div className="method-pills">
                <span>AHM</span>
                <span>ACC</span>
                <span>ACX</span>
                <span>OTH</span>
              </div>
            </div>
            <div className="method-step-note">The system creates the ID.</div>
          </article>

          <div className="method-arrow">↓</div>

          <article className="method-step">
            <div className="method-step-number">02</div>
            <div className="method-step-icon">⌾</div>
            <div className="method-step-content">
              <div className="method-step-label">CAPTURE</div>
              <h3>Shoot the specimen</h3>
              <p>Capture the evidence while you have the specimen in front of you.</p>
              <div className="method-pills">
                <span>VISIBLE</span>
                <span>UV</span>
                <span>AFTERGLOW</span>
              </div>
            </div>
            <div className="method-step-note">Original evidence is preserved.</div>
          </article>

          <div className="method-arrow">↓</div>

          <article className="method-step">
            <div className="method-step-number">03</div>
            <div className="method-step-icon">⌁</div>
            <div className="method-step-content">
              <div className="method-step-label">MEASURE</div>
              <h3>Record dimensions</h3>
              <p>Use a known reference in the same image plane for a 2D estimate.</p>
              <div className="method-pills">
                <span>REFERENCE</span>
                <span>2D ESTIMATE</span>
              </div>
            </div>
            <div className="method-step-note">No guessed thickness.</div>
          </article>

          <div className="method-arrow">↓</div>

          <article className="method-step">
            <div className="method-step-number">04</div>
            <div className="method-step-icon">◈</div>
            <div className="method-step-content">
              <div className="method-step-label">XRF</div>
              <h3>Attach the Vanta result</h3>
              <p>Export the Vanta data and attach readings using the exact specimen ID.</p>
              <div className="method-pills">
                <span>CSV</span>
                <span>EXACT ID</span>
              </div>
            </div>
            <div className="method-step-note">Batch import. No one-reading-at-a-time workflow.</div>
          </article>

          <div className="method-arrow">↓</div>

          <article className="method-step method-step-complete">
            <div className="method-step-number">05</div>
            <div className="method-step-icon">✓</div>
            <div className="method-step-content">
              <div className="method-step-label">COMPLETE</div>
              <h3>Review and move on</h3>
              <p>Check that the specimen, evidence and measurements belong together.</p>
              <div className="method-pills">
                <span>REVIEW</span>
                <span>PRESERVED</span>
              </div>
            </div>
            <div className="method-step-note">Then move to the next specimen.</div>
          </article>
        </div>
      </section>
    </>
  );
};

export const ProvenanceRoute: React.FC = () => {
  const { navigate } = useApp();
  const [events, setEvents] = useState<SpecimenEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.events()
      .then(setEvents)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <TopHeader
        eyebrow="ProvenanceOS"
        title="Provenance"
        sub="A quiet history of what happened to each specimen."
      />

      <section className="surface">
        <div className="events">
          {loading ? (
            <div className="loading" role="status">Loading provenance history…</div>
          ) : events.length > 0 ? (
            events.map(e => (
              <button
                key={e.id}
                className="event"
                onClick={() => navigate(`#/samples/${encodeURIComponent(e.sample_id)}`)}
              >
                <i className="event-dot"></i>
                <span className="event-main">
                  <strong>{e.sample_id} · {e.kind.toUpperCase()}</strong>
                  <small>{JSON.stringify(e.detail)}</small>
                </span>
                <time>{new Date(e.created_at).toLocaleString('en-AU')}</time>
              </button>
            ))
          ) : (
            <div className="empty-state">
              <p>No provenance events recorded yet.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
};

export const SettingsRoute: React.FC = () => {
  const { user, signOut } = useAuth();
  let host = config.SUPABASE_URL || '';
  try {
    host = new URL(host).host;
  } catch {
    // ignore
  }

  return (
    <>
      <TopHeader
        eyebrow="ProvenanceOS"
        title="Settings"
        sub="The instrument and evidence registry are append-only by design."
      />

      <section className="surface settings">
        <div style={{ marginBottom: 18 }}>
          <span className="eyebrow">Signed in</span>
          <p style={{ marginTop: 4 }}>{user?.email || 'Authenticated user'}</p>
        </div>
        <div style={{ marginBottom: 18 }}>
          <span className="eyebrow">Database</span>
          <p style={{ marginTop: 4 }}>{host}</p>
        </div>
        <div style={{ marginBottom: 18 }}>
          <span className="eyebrow">Parser</span>
          <p style={{ marginTop: 4 }}>{config.PARSER_VERSION}</p>
        </div>
        <div style={{ marginBottom: 18 }}>
          <span className="eyebrow">Evidence Architecture</span>
          <p style={{ marginTop: 4 }}>Originals + SHA-256 + derived lineage</p>
        </div>
        <div style={{ marginBottom: 24 }}>
          <span className="eyebrow">Runtime Strategy</span>
          <p style={{ marginTop: 4 }}>React 19 Shell (Stage 3 Active)</p>
          <small style={{ color: 'var(--muted)', display: 'block', marginTop: 4 }}>
            To verify original operational screens in isolated mode:{' '}
            <a href="?runtime=legacy#/home" style={{ color: 'var(--aqua)' }}>
              Switch to legacy operational runtime
            </a>.
          </small>
        </div>
        <div className="actions">
          <button className="secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </section>
    </>
  );
};
