/**
 * CONSOL ElementGrid Component
 * Precision scientific presentation of pXRF elemental analysis.
 * Displays elemental symbols in Mendeleev order, concentrations, units,
 * LOD qualifiers (< LOD), detection limits, and 1-sigma analytical uncertainties (± error).
 */

import React from 'react';
import type { ElementalResult } from '../../types';
import { vantaAdapter } from '../../services/vantaAdapter';

interface ElementGridProps {
  results: Record<string, ElementalResult>;
}

function fmtNum(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return '—';
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 3 }).format(val);
}

export const ElementGrid: React.FC<ElementGridProps> = ({ results }) => {
  const elements = Object.keys(results || {});
  const sortedElements = vantaAdapter.sortElementsSync(elements);

  if (!sortedElements.length) {
    return <div className="empty-state compact"><p>No elemental observations recorded.</p></div>;
  }

  return (
    <div className="analysis-grid">
      {sortedElements.map(el => {
        const r = results[el];
        if (!r) return null;

        const isLod = r.lod;
        const displayValue = isLod ? '< LOD' : fmtNum(r.value);

        const metaParts: string[] = [];
        if (isLod) {
          if (r.limit != null) {
            metaParts.push(`limit ${fmtNum(r.limit)}`);
          } else {
            metaParts.push('not detected');
          }
        } else {
          if (r.unit) metaParts.push(r.unit);
          if (r.error != null) metaParts.push(`± ${fmtNum(r.error)}`);
        }
        const metaText = metaParts.join(' · ');

        return (
          <div key={el} className={`element ${isLod ? 'is-lod' : ''}`}>
            <span>{el}</span>
            <b>{displayValue}</b>
            <small>{metaText || '—'}</small>
          </div>
        );
      })}
    </div>
  );
};

export default ElementGrid;
