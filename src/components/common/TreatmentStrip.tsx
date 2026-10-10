/**
 * CONSOL TreatmentStrip Component
 * Renders specimen treatment state: Treated / Untreated / Not recorded.
 * Keeps physical treatment history rigorously distinct from elemental chemistry.
 */

import React from 'react';
import type { SpecimenTreatment } from '../../types';

interface TreatmentStripProps {
  treatments: SpecimenTreatment[];
  onAddTreatment?: () => void;
}

export const TreatmentStrip: React.FC<TreatmentStripProps> = ({ treatments, onAddTreatment }) => {
  const t = treatments?.[0];

  if (!t) {
    return (
      <div className="treatment-strip untreated">
        <div>
          <span className="eyebrow">Treatment</span>
          <strong>Not recorded</strong>
          <small>No treatment history has been entered for this specimen.</small>
        </div>
        {onAddTreatment && (
          <button className="secondary" onClick={onAddTreatment}>
            ＋ Record
          </button>
        )}
      </div>
    );
  }

  const label =
    t.treatment_status === 'treated'
      ? 'Treated'
      : t.treatment_status === 'untreated'
        ? 'Untreated'
        : 'Unknown';

  const detailsParts: string[] = [
    t.treatment_method || '',
    t.reagent_name || '',
    t.reagent_concentration_pct != null ? `${t.reagent_concentration_pct}%` : '',
    t.treatment_duration_min != null ? `${t.treatment_duration_min} min` : ''
  ].filter(Boolean);

  const details = detailsParts.join(' · ') || 'Process details recorded in history.';

  return (
    <div className={`treatment-strip ${t.treatment_status}`}>
      <div>
        <span className="eyebrow">Treatment</span>
        <strong>{label}</strong>
        <small>{details}</small>
      </div>
      {onAddTreatment && (
        <button className="secondary" onClick={onAddTreatment}>
          ＋ Add event
        </button>
      )}
    </div>
  );
};

export default TreatmentStrip;
