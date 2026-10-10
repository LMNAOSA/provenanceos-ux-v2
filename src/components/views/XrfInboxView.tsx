/**
 * CONSOL XRFInboxView Component
 * Displays batch ingestion history, raw file hashes, match statistics, and review records.
 * Direct bridge provided to verified batch ingestion workflow pending Stage 5.
 */

import React, { useEffect, useState } from 'react';
import { TopHeader } from '../layout/TopHeader';
import { api } from '../../services/supabase';
import type { ImportBatch } from '../../types';

export const XrfInboxView: React.FC = () => {
  const [imports, setImports] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    api.imports()
      .then(list => {
        if (!isMounted) return;
        setImports(list);
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
        eyebrow="Instrument"
        title="XRF Inbox"
        sub="Drop in a Vanta export periodically. One file can connect hundreds of readings."
        action={
          <a
            className="primary"
            href="?runtime=legacy#/xrf-inbox"
            title="Launch interactive batch CSV importer via verified recovery mode"
          >
            ＋ Import Vanta CSV
          </a>
        }
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
          <small style={{ color: 'var(--muted)' }}>
            Stage 4 Operational View · Interactive CSV dropzone active via verified legacy recovery
          </small>
        </div>

        {error && (
          <div className="form-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

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
                    <span style={{ fontFamily: 'monospace' }}>
                      {(item.raw_files?.sha256 || '').slice(0, 12)}…
                    </span>
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

export default XrfInboxView;
