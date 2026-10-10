/**
 * CONSOL ProvenanceView Component
 * Chronological audit trail of physical specimen events.
 * Connects specimen identity to registration, evidence captures, pXRF analyses,
 * dimension metrology, and physical treatments.
 */

import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { TopHeader } from '../layout/TopHeader';
import { api } from '../../services/supabase';
import type { SpecimenEvent } from '../../types';

const EVENT_LABELS: Record<string, string> = {
  registered: 'Registered',
  photographed: 'Evidence captured',
  analysed: 'pXRF attached',
  measured: 'Dimensions estimated',
  treated: 'Treatment recorded'
};

function formatEventDetail(e: SpecimenEvent): string {
  const d = e.detail || {};
  if (e.kind === 'registered') {
    return `${(d.sample_type as string) || ''} · ${(d.location as string) || ''}`;
  }
  if (e.kind === 'photographed') {
    return `${(d.capture_kind as string) || 'visible'} · ${(d.file_name as string) || ''}`;
  }
  if (e.kind === 'analysed') {
    const readings = Number(d.readings || 0);
    return `${readings} reading${readings === 1 ? '' : 's'} · ${(d.source_file as string) || ''}`;
  }
  if (e.kind === 'measured') {
    return `${(d.method as string) || 'camera calibration'} · ${JSON.stringify(d.dimensions || {})}`;
  }
  if (e.kind === 'treated') {
    return `${(d.treatment_method as string) || ''} · ${(d.reagent_name as string) || ''}`;
  }
  return (d.file_name as string) || JSON.stringify(d);
}

export const ProvenanceView: React.FC = () => {
  const { navigate } = useApp();
  const [events, setEvents] = useState<SpecimenEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    api.events()
      .then(list => {
        if (!isMounted) return;
        setEvents(list);
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
        eyebrow="ProvenanceOS"
        title="Provenance"
        sub="A quiet history of what happened to each specimen."
      />

      <section className="surface">
        {error && (
          <div className="form-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div className="events">
          {loading ? (
            <div className="loading" role="status">Loading provenance history…</div>
          ) : events.length > 0 ? (
            events.map(e => {
              const label = EVENT_LABELS[e.kind] || e.kind.toUpperCase();
              const detailText = formatEventDetail(e);

              return (
                <button
                  key={e.id}
                  className="event"
                  onClick={() => navigate(`#/samples/${encodeURIComponent(e.sample_id)}`)}
                >
                  <i className="event-dot"></i>
                  <span className="event-main">
                    <strong>{e.sample_id} · {label}</strong>
                    <small>{detailText}</small>
                  </span>
                  <time>{new Date(e.created_at).toLocaleString('en-AU')}</time>
                </button>
              );
            })
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

export default ProvenanceView;
