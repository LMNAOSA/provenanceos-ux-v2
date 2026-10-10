/**
 * CONSOL Home View
 * High-authority operational registry overview.
 * Real specimen records, live counts, recent evidence acquisition, and direct navigation.
 */

import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { TopHeader } from '../layout/TopHeader';
import { api, signed } from '../../services/supabase';
import {
  SpecimenOverview,
  SpecimenCounts,
  SPECIMEN_TYPES,
  SPECIMEN_TYPE_BY_CODE
} from '../../types';

export const HomeView: React.FC = () => {
  const { navigate, openModal } = useApp();
  const [counts, setCounts] = useState<SpecimenCounts>({ samples: 0, photographed: 0, analysed: 0 });
  const [recent, setRecent] = useState<SpecimenOverview[]>([]);
  const [urlMap, setUrlMap] = useState<((p: string | null | undefined) => string | null) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    Promise.all([api.counts(), api.overview({ limit: 6 })])
      .then(async ([c, rec]) => {
        if (!isMounted) return;
        setCounts(c);
        setRecent(rec);
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

  return (
    <>
      <TopHeader
        eyebrow="Australian Provenance Project"
        title="A record of what was found."
        sub="Register once. Capture once. Let the evidence accumulate."
        action={
          <button className="primary" onClick={() => openModal('new-sample')}>
            ＋ Register specimen
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

          {error && (
            <div className="form-error" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

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
                      {thumb ? <img src={thumb} alt={s.id} loading="lazy" /> : null}
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

export default HomeView;
