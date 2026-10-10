/**
 * CONSOL VantaImportModal Component
 * Native React 19 Vanta pXRF CSV batch and specimen-targeted ingestion modal.
 *
 * Capabilities:
 * - Mobile-safe file selection (iOS Files, iCloud Drive, Android Downloads, desktop drag-and-drop)
 * - Strictly preserves targetSpecimenId when opened from a specimen record (remediating the legacy target-clearing defect)
 * - SHA-256 source file hashing, exact specimen ID matching, and review-queue quarantine for ambiguous rows
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  buildVantaImportPlan,
  executeVantaImport
} from '../../services/vantaAdapter';
import type { VantaImportPlan } from '../../types';

interface VantaImportModalProps {
  isOpen: boolean;
  targetSpecimenId?: string | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export const VantaImportModal: React.FC<VantaImportModalProps> = ({
  isOpen,
  targetSpecimenId = null,
  onClose,
  onSuccess
}) => {
  const { toast } = useApp();

  // Lock targetSpecimenId for the lifetime of this modal session
  const [lockedTargetId, setLockedTargetId] = useState<string | null>(targetSpecimenId || null);
  const [plan, setPlan] = useState<(VantaImportPlan & { targetSpecimenId: string | null }) | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [progressText, setProgressText] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setLockedTargetId(targetSpecimenId ? targetSpecimenId.trim() : null);
      setPlan(null);
      setIsReading(false);
      setIsImporting(false);
      setProgressText('');
      setError(null);
    }
  }, [isOpen, targetSpecimenId]);

  const handleFilePicked = async (file: File | null | undefined) => {
    if (!file) return;
    setIsReading(true);
    setError(null);
    setPlan(null);

    try {
      const built = await buildVantaImportPlan(file, lockedTargetId);
      setPlan(built);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsReading(false);
    }
  };

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

  const summaryStats = useMemo(() => {
    if (!plan) return null;
    const bySample = new Map<string, number>();
    const reasons = new Map<string, number>();

    plan.rows.forEach(x => {
      bySample.set(x.sid, (bySample.get(x.sid) || 0) + 1);
    });
    plan.skipped.forEach(x => {
      reasons.set(x.why, (reasons.get(x.why) || 0) + 1);
    });

    return {
      bySample: Array.from(bySample.entries()),
      reasons: Array.from(reasons.entries())
    };
  }, [plan]);

  const handleRunImport = async () => {
    if (!plan || !plan.parsed.readings.length || isImporting) return;
    setIsImporting(true);
    setError(null);
    setProgressText('Preserving export…');

    try {
      const res = await executeVantaImport(plan, status => setProgressText(status));
      const parts = [
        `${res.insertedCount} reading${res.insertedCount === 1 ? '' : 's'} attached`
      ];
      if (res.duplicateCount > 0) {
        parts.push(`${res.duplicateCount} already held`);
      }
      if (res.skippedCount > 0) {
        parts.push(`${res.skippedCount} awaiting review`);
      }
      toast(parts.join(' · '));
      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`${msg} Repeating the import is safe.`);
    } finally {
      setIsImporting(false);
      setProgressText('');
    }
  };

  if (!isOpen) return null;

  const canImport = Boolean(plan && plan.parsed.readings.length > 0 && !isReading && !isImporting);
  const buttonLabel = isImporting
    ? progressText || 'Preserving export…'
    : !plan
      ? 'Import'
      : plan.rows.length > 0
        ? `Import ${plan.rows.length} reading${plan.rows.length === 1 ? '' : 's'}`
        : plan.parsed.readings.length > 0
          ? 'Preserve export'
          : 'Nothing to import';

  return (
    <div className="modal" id="modal" style={{ display: 'flex' }}>
      <div className="modal-box wide" tabIndex={-1}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">pXRF</span>
            <h2 className="modal-title">
              {lockedTargetId ? `Attach to ${lockedTargetId}` : 'Import Vanta export'}
            </h2>
            <p className="sub">
              {lockedTargetId
                ? `This file is restricted to specimen ${lockedTargetId}. Rows with conflicting specimen IDs are held for review.`
                : 'Choose the periodic Vanta CSV export. Every row with an exact specimen ID will attach automatically; unmatched rows remain in review.'}
            </p>
          </div>
          <button className="close" onClick={onClose} disabled={isImporting}>
            ×
          </button>
        </div>

        <label
          className="dropzone"
          style={{ position: 'relative', overflow: 'hidden', cursor: isImporting ? 'not-allowed' : 'pointer' }}
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
        >
          <span>
            {plan ? `Selected: ${plan.fileName} (tap to change)` : 'Choose Vanta CSV file'}
          </span>
          <input
            type="file"
            accept=".csv,.txt,.tsv,text/csv,text/plain,application/csv,text/comma-separated-values,application/vnd.ms-excel,application/octet-stream"
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
            Reading and matching Vanta CSV…
          </div>
        )}

        {plan && summaryStats && (
          <div className="import-summary" style={{ marginTop: 16 }}>
            <div className="stats compact">
              <div>
                <b>{plan.parsed.readings.length}</b>
                <span>Readings in file</span>
              </div>
              <div>
                <b>{plan.rows.length}</b>
                <span>Exact matches</span>
              </div>
              <div>
                <b>{summaryStats.reasons.length}</b>
                <span>Review reasons</span>
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

            <div className="section-title" style={{ marginTop: 18 }}>
              Source
            </div>
            <div className="sub" style={{ fontFamily: 'monospace', fontSize: 12 }}>
              {plan.fileName} · SHA-256 {plan.fileHash.slice(0, 16)}…
            </div>

            {summaryStats.bySample.length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 22 }}>
                  Matched specimens
                </div>
                <div className="match-strip">
                  {summaryStats.bySample.map(([id, count]) => (
                    <span key={id}>
                      {id} · {count}
                    </span>
                  ))}
                </div>
              </>
            )}

            {plan.skipped.length > 0 && (
              <div className="review-box" style={{ marginTop: 18 }}>
                <strong>
                  {plan.skipped.length} row{plan.skipped.length === 1 ? '' : 's'} held for review
                </strong>
                <small style={{ display: 'block', marginTop: 4 }}>
                  {summaryStats.reasons.map(([reason, count]) => `${count} × ${reason}`).join(' · ')}
                </small>
                <p style={{ marginTop: 6 }}>
                  No reading is attached when ProvenanceOS cannot establish the specimen identity.
                </p>
              </div>
            )}

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
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VantaImportModal;
