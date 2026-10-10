/**
 * CONSOL ReferenceDataView Component
 * Displays preserved historical datasets, observation counts, and workbook provenance.
 * Strictly isolates historical soil data from modern physical specimen registries.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { TopHeader } from '../layout/TopHeader';
import { api } from '../../services/supabase';
import type { HistoricalDataset } from '../../types';

export const ReferenceDataView: React.FC = () => {
  const { openModal } = useApp();
  const [datasets, setDatasets] = useState<HistoricalDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDatasets = useCallback(() => {
    setLoading(true);
    setError(null);
    api.historicalDatasets()
      .then(list => {
        setDatasets(list);
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadDatasets();
    const onRefresh = () => loadDatasets();
    window.addEventListener('consol:data-updated', onRefresh);
    return () => {
      window.removeEventListener('consol:data-updated', onRefresh);
    };
  }, [loadDatasets]);

  return (
    <>
      <TopHeader
        eyebrow="Reference data"
        title="Historical datasets"
        sub="Original scientific records that inform provenance without becoming physical specimens."
        action={
          <div className="header-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="secondary"
              onClick={() => openModal('import-history', { preloadBundled2018: false })}
            >
              ＋ Import CSV / XLSX
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => openModal('import-history', { preloadBundled2018: true })}
            >
              Import bundled 2018 dataset
            </button>
          </div>
        }
      />

      <section className="surface">
        <div className="surface-head">
          <div>
            <span className="eyebrow">Archive</span>
            <h3>Historical reference datasets</h3>
          </div>
          <small style={{ color: 'var(--muted)' }}>
            Preserved reference evidence · Independent of AHM/ACC/ACX/OTH specimens
          </small>
        </div>

        {error && (
          <div className="form-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

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
                  <span style={{ fontFamily: 'monospace' }}>
                    {(d.raw_files?.sha256 || '').slice(0, 12)}…
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state compact">
            <p>No historical reference datasets have been imported.</p>
            <p className="sub" style={{ marginTop: 6 }}>
              These records remain separate from AHM, ACC, ACX and OTH specimens.
            </p>
          </div>
        )}
      </section>
    </>
  );
};

export default ReferenceDataView;
