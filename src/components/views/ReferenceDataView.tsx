/**
 * CONSOL ReferenceDataView Component (v3.5)
 * Displays preserved historical datasets, verified Supabase row/observation counts,
 * workbook SHA-256 provenance, and the interactive Historical Data Explorer.
 * Strictly isolates historical soil reference data from physical AHM/ACC/ACX/OTH specimens.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { TopHeader } from '../layout/TopHeader';
import { api } from '../../services/supabase';
import { HistoricalDataExplorer } from './HistoricalDataExplorer';
import type {
  HistoricalDataset,
  HistoricalRecord,
  HistoricalDatabaseCounts
} from '../../types';

export const ReferenceDataView: React.FC = () => {
  const { openModal } = useApp();
  const [datasets, setDatasets] = useState<HistoricalDataset[]>([]);
  const [records, setRecords] = useState<HistoricalRecord[]>([]);
  const [dbCounts, setDbCounts] = useState<HistoricalDatabaseCounts>({
    datasets: 0,
    records: 0,
    observations: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReferenceData = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.historicalDatasets(),
      api.historicalCounts().catch(() => ({ datasets: 0, records: 0, observations: 0 }))
    ])
      .then(async ([dsList, counts]) => {
        setDatasets(dsList);
        const recs = await api.allHistoricalRecordsWithObservations(dsList);
        setRecords(recs);
        const loadedObs = recs.reduce((acc, r) => acc + (r.observations?.length || 0), 0);
        setDbCounts({
          datasets: counts.datasets || dsList.length,
          records: counts.records || recs.length,
          observations: counts.observations || loadedObs
        });
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadReferenceData();
    const onRefresh = () => loadReferenceData();
    window.addEventListener('consol:data-updated', onRefresh);
    return () => {
      window.removeEventListener('consol:data-updated', onRefresh);
    };
  }, [loadReferenceData]);

  return (
    <>
      <TopHeader
        eyebrow="Collection · Reference Data"
        title="Historical Reference Datasets & Explorer"
        sub="Original scientific records and elemental observations that inform provenance without becoming physical AHM/ACC/ACX/OTH specimens."
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

      {error && (
        <div className="form-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <section className="surface">
        <HistoricalDataExplorer
          datasets={datasets}
          records={records}
          dbCounts={dbCounts}
          loading={loading}
          onImportHistorical={preload => openModal('import-history', { preloadBundled2018: preload })}
        />
      </section>
    </>
  );
};

export default ReferenceDataView;
