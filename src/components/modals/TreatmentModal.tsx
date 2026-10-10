/**
 * CONSOL TreatmentModal Component
 * Native React 19 physical specimen treatment recorder.
 * Preserves chemical and thermal process variables without conflating analytical sulfur readings.
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/supabase';
import type { TreatmentStatus } from '../../types';

interface TreatmentModalProps {
  isOpen: boolean;
  sampleId: string | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export const TreatmentModal: React.FC<TreatmentModalProps> = ({
  isOpen,
  sampleId,
  onClose,
  onSuccess
}) => {
  const { toast } = useApp();

  const [status, setStatus] = useState<TreatmentStatus>('unknown');
  const [method, setMethod] = useState('');
  const [reagent, setReagent] = useState('');
  const [conc, setConc] = useState('');
  const [volume, setVolume] = useState('');
  const [duration, setDuration] = useState('');
  const [temp, setTemp] = useState('');
  const [cycles, setCycles] = useState('');
  const [preMass, setPreMass] = useState('');
  const [postMass, setPostMass] = useState('');
  const [operator, setOperator] = useState('');
  const [notes, setNotes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !sampleId) return null;

  const num = (v: string): number | null => {
    const trimmed = v.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const payload = {
        sample_id: sampleId,
        treatment_status: status,
        treatment_method: method.trim() || null,
        reagent_name: reagent.trim() || null,
        reagent_concentration_pct: num(conc),
        reagent_volume_ml: num(volume),
        treatment_duration_min: num(duration),
        temperature_c: num(temp),
        cycle_count: num(cycles),
        pre_treatment_mass_g: num(preMass),
        post_treatment_mass_g: num(postMass),
        operator: operator.trim() || null,
        treated_at: new Date().toISOString(),
        notes: notes.trim() || null
      };

      await api.addTreatment(payload);

      toast('Treatment record preserved');
      if (onSuccess) onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal" id="modal" style={{ display: 'flex' }}>
      <div className="modal-box wide" tabIndex={-1} style={{ maxWidth: 720 }}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">Specimen treatment</span>
            <h2 className="modal-title">Record what happened to {sampleId}.</h2>
            <p className="sub">
              Treatment history is separate from pXRF chemistry. Do not infer treatment dose from an S result.
            </p>
          </div>
          <button className="close" onClick={onClose} disabled={isSubmitting}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="fields">
            <div className="field">
              <label htmlFor="t-status">Status</label>
              <select
                id="t-status"
                value={status}
                onChange={e => setStatus(e.target.value as TreatmentStatus)}
              >
                <option value="unknown">Unknown</option>
                <option value="untreated">Untreated</option>
                <option value="treated">Treated</option>
              </select>
            </div>

            <div className="field">
              <label htmlFor="t-method">Method</label>
              <input
                id="t-method"
                placeholder="e.g. sugar / acid carbonisation"
                value={method}
                onChange={e => setMethod(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="t-reagent">Reagent</label>
              <input
                id="t-reagent"
                placeholder="Record reagent actually used"
                value={reagent}
                onChange={e => setReagent(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="t-conc">Reagent concentration (%)</label>
              <input
                id="t-conc"
                inputMode="decimal"
                value={conc}
                onChange={e => setConc(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="t-vol">Reagent volume (mL)</label>
              <input
                id="t-vol"
                inputMode="decimal"
                value={volume}
                onChange={e => setVolume(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="t-duration">Duration (min)</label>
              <input
                id="t-duration"
                inputMode="decimal"
                value={duration}
                onChange={e => setDuration(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="t-temp">Temperature (°C)</label>
              <input
                id="t-temp"
                inputMode="decimal"
                value={temp}
                onChange={e => setTemp(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="t-cycles">Cycles</label>
              <input
                id="t-cycles"
                inputMode="numeric"
                value={cycles}
                onChange={e => setCycles(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="t-pre">Pre-treatment mass (g)</label>
              <input
                id="t-pre"
                inputMode="decimal"
                value={preMass}
                onChange={e => setPreMass(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="t-post">Post-treatment mass (g)</label>
              <input
                id="t-post"
                inputMode="decimal"
                value={postMass}
                onChange={e => setPostMass(e.target.value)}
              />
            </div>

            <div className="field full">
              <label htmlFor="t-operator">Operator</label>
              <input
                id="t-operator"
                value={operator}
                onChange={e => setOperator(e.target.value)}
              />
            </div>

            <div className="field full">
              <label htmlFor="t-notes">Notes</label>
              <textarea
                id="t-notes"
                placeholder="Record known process details; do not fill unknown values by guesswork."
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="scientific-note" style={{ margin: '18px 0' }}>
            <span className="eyebrow">Important scientific separation</span>
            <p>
              A sulfur reading from the Vanta is stored as chemistry. It is not converted into an estimate of sulfuric-acid treatment amount.
            </p>
          </div>

          {error && (
            <div className="form-error" style={{ marginBottom: 16 }}>
              {error}
            </div>
          )}

          <div className="actions">
            <button type="button" className="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Save treatment record'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TreatmentModal;
