/**
 * CONSOL HistoricalImportModal Component
 * Native React 19 Historical Reference Dataset importer (.csv, .xlsx, .xls, and bundled 2018 dataset).
 *
 * Guarantees:
 * - Original CSV or Excel workbook is preserved and hashed with SHA-256
 * - Mobile-safe file selection on iOS Safari / Files and Android Chrome
 * - Strictly isolated from physical AHM / ACC / ACX / OTH specimen identities
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  buildHistoricalImportPlan,
  executeHistoricalImport,
  loadBundled2018HistoricalFile
} from '../../services/historical';
import type { HistoricalImportPlan } from '../../types';

interface HistoricalImportModalProps {
  isOpen: boolean;
  preloadBundled2018?: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const HistoricalImportModal: React.FC<HistoricalImportModalProps> = ({
  isOpen,
  preloadBundled2018 = false,
  onClose,
  onSuccess
}) => {
  const { toast } = useApp();

  const [datasetName, setDatasetName] = useState('');
  const [plan, setPlan] = useState<HistoricalImportPlan | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleFilePicked = async (file: File | null | undefined, defaultTitle?: string) => {
    if (!file) return;
    setIsReading(true);
    setError(null);
    setPlan(null);

    try {
      const built = await buildHistoricalImportPlan(file);
      setPlan(built);
      setDatasetName(prev =>
        defaultTitle || prev.trim() || file.name.replace(/\.[^.]+$/, '')
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsReading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setDatasetName('');
    setPlan(null);
    setIsReading(false);
    setIsImporting(false);
    setProgressText('');
    setError(null);

    if (preloadBundled2018) {
      setIsReading(true);
      loadBundled2018HistoricalFile()
        .then(file => handleFilePicked(file, '2018 Historical XRF Dataset'))
        .catch(err => {
          setIsReading(false);
          setError(err instanceof Error ? err.message : String(err));
        });
    }
  }, [isOpen, preloadBundled2018]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    void handleFilePicked(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    if (isReading || isImporting) return;
    const file = e.dataTransfer.files?.[0];
    void handleFilePicked(file);
  };

  const locationCount = useMemo(() => {
    if (!plan) return 0;
    return new Set(plan.parsed.records.map(r => r.location).filter(Boolean)).size;
  }, [plan]);

  const handleRunImport = async () => {
    if (!plan || !plan.parsed.records.length || isImporting) return;
    setIsImporting(true);
    setError(null);
    setProgressText('Preserving source…');

    try {
      const dataset = await executeHistoricalImport(plan, datasetName, status =>
        setProgressText(status)
      );
      toast(`${dataset.name} preserved · ${plan.parsed.recordCount} historical records`);
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsImporting(false);
      setProgressText('');
    }
  };

  if (!isOpen) return null;

  const canImport = Boolean(plan && plan.parsed.records.length > 0 && !isReading && !isImporting);

  return (
    <div className="modal" id="modal" style={{ display: 'flex' }}>
      <div className="modal-box wide" tabIndex={-1}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">Reference data</span>
            <h2 className="modal-title">Import historical soil data.</h2>
            <p className="sub">
              The original file is preserved exactly. The worksheet is parsed into historical records
              only; no AHM, ACC, ACX or OTH identities are created.
            </p>
          </div>
          <button className="close" onClick={onClose} disabled={isImporting}>
            ×
          </button>
        </div>

        <div className="fields" style={{ marginBottom: 14 }}>
          <div className="field full">
            <label htmlFor="history-name">Dataset name</label>
            <input
              id="history-name"
              placeholder="e.g. 2018 historical XRF dataset"
              value={datasetName}
              onChange={e => setDatasetName(e.target.value)}
              disabled={isImporting}
            />
          </div>
        </div>

        <label
          className="dropzone"
          style={{ position: 'relative', overflow: 'hidden', cursor: isImporting ? 'not-allowed' : 'pointer' }}
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
        >
          <span>
            {plan
              ? `Selected: ${plan.fileName} (tap to choose another file)`
              : 'Choose historical CSV or Excel workbook (.csv, .xlsx)'}
          </span>
          <input
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,text/plain,application/csv,text/comma-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/octet-stream"
            onChange={handleInputChange}
            disabled={isReading || isImporting}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              cursor: 'pointer'
            }}
          />
        </label>

        {isReading && (
          <div className="loading-inline" role="status" style={{ marginTop: 14 }}>
            Reading historical source…
          </div>
        )}

        {plan && (
          <div className="import-summary" style={{ marginTop: 16 }}>
            <div className="stats compact">
              <div>
                <b>{plan.parsed.recordCount}</b>
                <span>Historical records</span>
              </div>
              <div>
                <b>{plan.parsed.observationCount}</b>
                <span>Element observations</span>
              </div>
              <div>
                <b>{locationCount}</b>
                <span>Locations</span>
              </div>
            </div>

            {plan.parsed.elements.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 22 }}>
                  Elements
                </div>
                <div className="sub">{plan.parsed.elements.join(' · ')}</div>
              </>
            )}

            <div className="section-title" style={{ marginTop: 22 }}>
              Source
            </div>
            <div className="sub">
              {plan.fileName} · {(plan.parsed.sourceFormat || 'csv').toUpperCase()}
              {plan.parsed.workbookSheet ? ` · sheet ${plan.parsed.workbookSheet}` : ''} · SHA-256{' '}
              <span style={{ fontFamily: 'monospace' }}>{plan.fileHash.slice(0, 16)}…</span>
            </div>

            {plan.parsed.warnings.map((w, idx) => (
              <div key={idx} className="warn" style={{ marginTop: 10 }}>
                {w}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="form-error" style={{ marginTop: 16 }} role="alert">
            {error}
          </div>
        )}

        <div className="actions" style={{ marginTop: 22 }}>
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={isImporting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void handleRunImport()}
            disabled={!canImport}
          >
            {isImporting
              ? progressText || 'Preserving source…'
              : plan
                ? `Preserve ${plan.parsed.recordCount} record${plan.parsed.recordCount === 1 ? '' : 's'}`
                : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default HistoricalImportModal;
