/**
 * CONSOL SamplesView Component
 * Specimen Registry with responsive search, class filtering (AHM, ACC, ACX, OTH),
 * and direct navigation to authoritative specimen records.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { TopHeader } from '../layout/TopHeader';
import { api, signed } from '../../services/supabase';
import {
  SpecimenOverview,
  SpecimenCode,
  SPECIMEN_TYPES,
  SPECIMEN_TYPE_BY_CODE
} from '../../types';

export const SamplesView: React.FC = () => {
  const { navigate, openModal } = useApp();
  const [samples, setSamples] = useState<SpecimenOverview[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<SpecimenCode | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [urlMap, setUrlMap] = useState<((p: string | null | undefined) => string | null) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    api.overview({ limit: 500 })
      .then(async list => {
        if (!isMounted) return;
        setSamples(list);
        const getUrl = await signed(list.map(x => x.cover_thumb_path || x.cover_path));
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

  const filteredSamples = useMemo(() => {
    return samples.filter(s => {
      const matchesCode = selectedFilter === 'ALL' || s.sample_code === selectedFilter;
      if (!matchesCode) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const idMatch = s.id.toLowerCase().includes(q);
      const locMatch = (s.location || '').toLowerCase().includes(q);
      const typeMatch = (s.sample_type || '').toLowerCase().includes(q);
      return idMatch || locMatch || typeMatch;
    });
  }, [samples, selectedFilter, searchQuery]);

  return (
    <>
      <TopHeader
        eyebrow="Collection"
        title="Samples"
        sub="The physical registry — choose the material class, then let the system count it."
        action={
          <button className="primary" onClick={() => openModal('new-sample')}>
            ＋ Register specimen
          </button>
        }
      />

      <section className="surface">
        <div className="filter-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ minWidth: 220, flex: '1 1 240px' }}>
            <input
              type="search"
              placeholder="Search specimen ID or location…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--line)',
                borderRadius: 12,
                padding: '8px 14px',
                color: 'var(--text)',
                fontSize: 13
              }}
            />
          </div>

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

        {error && (
          <div className="form-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div className="sample-list" style={{ marginTop: 16 }}>
          {loading ? (
            <div className="loading" role="status">Loading collection…</div>
          ) : filteredSamples.length > 0 ? (
            filteredSamples.map(s => {
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
            <div className="empty-state">
              <h2>Nothing matches that search.</h2>
              <p>Check the material class filter or search query.</p>
            </div>
          )}
        </div>
      </section>
    </>
  );
};

export default SamplesView;
