/**
 * CONSOL v3.5 — Interactive Historical Data Explorer
 *
 * Allows researchers to open any persisted historical dataset (e.g., 2018 Historical XRF Data)
 * and inspect all persisted historical_records (24 rows) and historical_observations (792 observations)
 * directly from Supabase PostgreSQL.
 *
 * Capabilities:
 * 1. Verified Supabase persistence header (exact table counts vs metadata counts + SHA-256 workbook digest).
 * 2. Records & Observations Explorer: filter by Location/Opal Field, Focus Analyte, Qualifier (Detected vs <LOD),
 *    sort by Row #, Location, or Focus Analyte concentration, and inspect all 33 analytes + raw row columns.
 * 3. Analyte Distribution Matrix: statistical summary across all 33 analytes (Detected vs <LOD, Min, Median, Mean, Max,
 *    Peak Location) with interactive per-analyte cross-location concentration breakdown.
 * 4. Side-by-Side Field Comparison: compare elemental signatures across multiple opal fields/locations.
 */

import React, { useState, useMemo, useEffect } from 'react';
import type {
  HistoricalDataset,
  HistoricalRecord,
  HistoricalDatabaseCounts
} from '../../types';
import {
  ELEMENT_NAMES,
  formatHistoricalObservation,
  computeAnalyteSummaries,
  getRecordTopObservations
} from '../../services/historicalIntelligence';

export interface HistoricalDataExplorerProps {
  datasets: HistoricalDataset[];
  records: HistoricalRecord[];
  dbCounts: HistoricalDatabaseCounts;
  loading?: boolean;
  selectedRecordId?: string | null;
  selectedSourceRowNo?: number | null;
  autoExpandRawColumns?: boolean;
  onSelectRecord?: (record: HistoricalRecord) => void;
  initialFocusAnalyte?: string;
  initialLocationFilter?: string;
  onImportHistorical?: (preloadBundled2018: boolean) => void;
}

type ExplorerSubMode = 'records' | 'analytes' | 'compare';
type RowObsFilter = 'ALL' | 'DETECTED' | 'LOD';
type QualifierFilter = 'ALL' | 'DETECTED' | 'LOD';
type RecordSortField = 'source_row_no' | 'location' | 'detected_count' | 'focus_analyte';

export const HistoricalDataExplorer: React.FC<HistoricalDataExplorerProps> = ({
  datasets,
  records,
  dbCounts,
  loading = false,
  selectedRecordId,
  selectedSourceRowNo,
  autoExpandRawColumns = false,
  onSelectRecord,
  initialFocusAnalyte = 'ALL',
  initialLocationFilter = 'ALL',
  onImportHistorical
}) => {
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>('ALL');
  const [subMode, setSubMode] = useState<ExplorerSubMode>('records');
  const [localSearch, setLocalSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState<string>(initialLocationFilter);
  const [focusAnalyte, setFocusAnalyte] = useState<string>(initialFocusAnalyte);
  const [qualifierFilter, setQualifierFilter] = useState<QualifierFilter>('ALL');
  const [sortField, setSortField] = useState<RecordSortField>('source_row_no');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Row inspector state
  const [internalSelectedRowNo, setInternalSelectedRowNo] = useState<number | null>(
    selectedSourceRowNo ?? null
  );
  const [rowObsFilter, setRowObsFilter] = useState<RowObsFilter>('ALL');
  const [showRawColumns, setShowRawColumns] = useState<boolean>(autoExpandRawColumns);

  // Side-by-side comparison state (row numbers)
  const [compareRowNos, setCompareRowNos] = useState<number[]>([]);

  useEffect(() => {
    if (selectedSourceRowNo !== undefined && selectedSourceRowNo !== null) {
      setInternalSelectedRowNo(selectedSourceRowNo);
      setSubMode('records');
    }
  }, [selectedSourceRowNo]);

  useEffect(() => {
    if (autoExpandRawColumns) {
      setShowRawColumns(true);
    }
  }, [autoExpandRawColumns]);

  useEffect(() => {
    if (initialFocusAnalyte && initialFocusAnalyte !== 'ALL') {
      setFocusAnalyte(initialFocusAnalyte);
      setSortField('focus_analyte');
      setSortDir('desc');
    } else if (initialFocusAnalyte === 'ALL') {
      setFocusAnalyte('ALL');
    }
  }, [initialFocusAnalyte]);

  useEffect(() => {
    if (initialLocationFilter) {
      setLocationFilter(initialLocationFilter);
    }
  }, [initialLocationFilter]);

  const datasetRecords = useMemo(() => {
    if (selectedDatasetId === 'ALL') return records;
    return records.filter(r => r.dataset_id === selectedDatasetId);
  }, [records, selectedDatasetId]);

  const activeDataset = useMemo(() => {
    if (selectedDatasetId === 'ALL') return datasets[0] || null;
    return datasets.find(d => d.id === selectedDatasetId) || datasets[0] || null;
  }, [datasets, selectedDatasetId]);

  // Distinct locations and analytes in the active dataset
  const distinctLocations = useMemo(() => {
    const locs = new Set<string>();
    datasetRecords.forEach(r => {
      if (r.location) locs.add(r.location);
    });
    return [...locs];
  }, [datasetRecords]);

  const analyteSummaries = useMemo(
    () => computeAnalyteSummaries(datasetRecords),
    [datasetRecords]
  );

  const availableAnalytes = useMemo(
    () => analyteSummaries.map(s => s.analyte),
    [analyteSummaries]
  );

  // Initialize comparison rows when datasetRecords load
  useEffect(() => {
    if (datasetRecords.length > 0 && compareRowNos.length === 0) {
      const defaults = datasetRecords.slice(0, Math.min(4, datasetRecords.length)).map(r => r.source_row_no);
      setCompareRowNos(defaults);
    }
  }, [datasetRecords, compareRowNos.length]);

  // Filtered and sorted historical records
  const filteredRecords = useMemo(() => {
    const q = localSearch.trim().toLowerCase();

    const filtered = datasetRecords.filter(r => {
      if (locationFilter !== 'ALL' && r.location !== locationFilter) return false;

      if (focusAnalyte !== 'ALL') {
        const obs = (r.observations || []).find(o => o.analyte === focusAnalyte);
        const isLod = !obs || obs.qualifier === 'below_lod' || obs.value === null;
        if (qualifierFilter === 'DETECTED' && isLod) return false;
        if (qualifierFilter === 'LOD' && !isLod) return false;
      } else if (qualifierFilter !== 'ALL') {
        const hasDetected = (r.observations || []).some(
          o => o.qualifier !== 'below_lod' && o.value !== null
        );
        if (qualifierFilter === 'DETECTED' && !hasDetected) return false;
      }

      if (!q) return true;
      const obsMatch = (r.observations || []).some(
        o =>
          o.analyte.toLowerCase().includes(q) ||
          (ELEMENT_NAMES[o.analyte] || '').toLowerCase().includes(q)
      );
      return (
        (r.location || '').toLowerCase().includes(q) ||
        String(r.original_index || '').toLowerCase().includes(q) ||
        String(r.original_sample || '').toLowerCase().includes(q) ||
        (r.material_type || '').toLowerCase().includes(q) ||
        (r.original_time || '').toLowerCase().includes(q) ||
        `row ${r.source_row_no}`.includes(q) ||
        obsMatch
      );
    });

    return [...filtered].sort((a, b) => {
      const factor = sortDir === 'asc' ? 1 : -1;
      if (sortField === 'location') {
        return (a.location || '').localeCompare(b.location || '') * factor;
      }
      if (sortField === 'detected_count') {
        const detA = (a.observations || []).filter(o => o.qualifier !== 'below_lod' && o.value !== null).length;
        const detB = (b.observations || []).filter(o => o.qualifier !== 'below_lod' && o.value !== null).length;
        return (detA - detB) * factor;
      }
      if (sortField === 'focus_analyte' && focusAnalyte !== 'ALL') {
        const oa = (a.observations || []).find(o => o.analyte === focusAnalyte);
        const ob = (b.observations || []).find(o => o.analyte === focusAnalyte);
        const aDet = oa && oa.qualifier !== 'below_lod' && oa.value !== null;
        const bDet = ob && ob.qualifier !== 'below_lod' && ob.value !== null;
        if (aDet !== bDet) return aDet ? -1 : 1;
        return (Number(oa?.value || 0) - Number(ob?.value || 0)) * factor;
      }
      return (a.source_row_no - b.source_row_no) * factor;
    });
  }, [datasetRecords, locationFilter, focusAnalyte, qualifierFilter, localSearch, sortField, sortDir]);

  // Active inspected record — only deployed when explicitly selected by the researcher
  const activeRecord = useMemo(() => {
    if (internalSelectedRowNo !== null) {
      const byRow = datasetRecords.find(r => r.source_row_no === internalSelectedRowNo);
      if (byRow) return byRow;
    }
    return null;
  }, [datasetRecords, internalSelectedRowNo]);

  const activeRecordObservations = useMemo(() => {
    if (!activeRecord?.observations) return [];
    const filtered = activeRecord.observations.filter(o => {
      const isLod = o.qualifier === 'below_lod' || o.value === null;
      if (rowObsFilter === 'DETECTED') return !isLod;
      if (rowObsFilter === 'LOD') return isLod;
      return true;
    });
    return [...filtered].sort((a, b) => {
      const aLod = a.qualifier === 'below_lod' || a.value === null;
      const bLod = b.qualifier === 'below_lod' || b.value === null;
      if (aLod !== bLod) return aLod ? 1 : -1;
      return Number(b.value || 0) - Number(a.value || 0);
    });
  }, [activeRecord, rowObsFilter]);

  const focusedAnalyteSummary = useMemo(() => {
    if (focusAnalyte === 'ALL') return null;
    return analyteSummaries.find(s => s.analyte === focusAnalyte) || null;
  }, [analyteSummaries, focusAnalyte]);

  const handleSort = (field: RecordSortField) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'source_row_no' || field === 'location' ? 'asc' : 'desc');
    }
  };

  const handleRowSelect = (rec: HistoricalRecord) => {
    if (internalSelectedRowNo === rec.source_row_no) {
      setInternalSelectedRowNo(null);
      return;
    }
    setInternalSelectedRowNo(rec.source_row_no);
    onSelectRecord?.(rec);
  };

  const toggleCompareRow = (rowNo: number) => {
    setCompareRowNos(prev => {
      if (prev.includes(rowNo)) {
        return prev.filter(n => n !== rowNo);
      }
      if (prev.length >= 6) {
        return [...prev.slice(1), rowNo];
      }
      return [...prev, rowNo];
    });
  };

  if (loading) {
    return (
      <div className="loading" role="status">
        Querying persisted historical_records and historical_observations from Supabase…
      </div>
    );
  }

  if (datasets.length === 0) {
    return (
      <div className="workbench-empty-registry">
        <span className="eyebrow">Historical Reference Archive</span>
        <h4>No historical reference datasets imported yet.</h4>
        <p>
          Import the bundled 2018 Historical XRF Workbook (24 rows · 792 elemental observations across 33 analytes) or upload a CSV/XLSX reference dataset. Historical observations are preserved independently of AHM/ACC/ACX/OTH physical specimens.
        </p>
        {onImportHistorical && (
          <div className="workbench-empty-actions">
            <button
              type="button"
              className="primary"
              onClick={() => onImportHistorical(true)}
            >
              Import 2018 Historical XRF Workbook
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => onImportHistorical(false)}
            >
              ＋ Import CSV / XLSX
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="hist-explorer">
      {/* 1. Quiet Dataset Provenance & Mode Bar */}
      <div className="hist-provenance-banner">
        <div className="hist-provenance-main">
          <div className="hist-dataset-title-row">
            {datasets.length > 1 ? (
              <select
                className="consol-status-select"
                value={selectedDatasetId}
                onChange={e => setSelectedDatasetId(e.target.value)}
                aria-label="Select historical dataset"
              >
                <option value="ALL">All Historical Datasets ({datasets.length})</option>
                {datasets.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.metadata?.record_count || 0} rows)
                  </option>
                ))}
              </select>
            ) : (
              <h4>{activeDataset?.name || '2018 Historical XRF Dataset'}</h4>
            )}

            {activeDataset && (
              <div className="hist-dataset-meta-pills">
                <span>{dbCounts.records.toLocaleString('en-AU')} rows</span>
                <span>·</span>
                <span>{dbCounts.observations.toLocaleString('en-AU')} observations</span>
                <span>·</span>
                <span>{activeDataset.raw_files?.file_name || activeDataset.metadata?.source_file || '2018_Historical_XRF_Data.xlsx'}</span>
                <span>·</span>
                <span className="mono-cell">
                  SHA-256 {(activeDataset.raw_files?.sha256 || activeDataset.metadata?.source_sha256 || '').slice(0, 12) || '—'}…
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="hist-submode-tabs" role="tablist" aria-label="Historical Explorer Modes">
          <button
            type="button"
            role="tab"
            aria-selected={subMode === 'records'}
            className={`consol-seg-btn ${subMode === 'records' ? 'active' : ''}`}
            onClick={() => setSubMode('records')}
          >
            Records &amp; Matrix ({datasetRecords.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subMode === 'analytes'}
            className={`consol-seg-btn ${subMode === 'analytes' ? 'active' : ''}`}
            onClick={() => setSubMode('analytes')}
          >
            Analyte Summary ({availableAnalytes.length} Els)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subMode === 'compare'}
            className={`consol-seg-btn ${subMode === 'compare' ? 'active' : ''}`}
            onClick={() => setSubMode('compare')}
          >
            Field Comparison ({compareRowNos.length})
          </button>
        </div>
      </div>

      {/* 2. Explorer Filter & Focus Bar */}
      <div className="hist-filter-bar">
        <div className="hist-search-box">
          <input
            type="search"
            className="consol-search-input hist-local-search"
            placeholder="Search historical rows by location (Second Hill, Coober Pedy, Lightning Ridge, Mintabie…), index (106), or analyte (Fe, Zr, Sr)…"
            value={localSearch}
            onChange={e => setLocalSearch(e.target.value)}
            aria-label="Filter historical records"
          />
          {localSearch && (
            <button
              type="button"
              className="consol-search-clear"
              onClick={() => setLocalSearch('')}
            >
              Clear
            </button>
          )}
        </div>

        <div className="hist-filter-controls">
          <label className="hist-select-label">
            <span>Location / Field</span>
            <select
              className="consol-status-select"
              value={locationFilter}
              onChange={e => setLocationFilter(e.target.value)}
            >
              <option value="ALL">All Locations ({distinctLocations.length})</option>
              {distinctLocations.map(loc => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </label>

          <label className="hist-select-label">
            <span>Focus Analyte</span>
            <select
              className="consol-status-select"
              value={focusAnalyte}
              onChange={e => {
                const val = e.target.value;
                setFocusAnalyte(val);
                if (val !== 'ALL') {
                  setSortField('focus_analyte');
                  setSortDir('desc');
                } else {
                  setSortField('source_row_no');
                  setSortDir('asc');
                }
              }}
            >
              <option value="ALL">All Analytes ({availableAnalytes.length})</option>
              {analyteSummaries.map(s => (
                <option key={s.analyte} value={s.analyte}>
                  {s.analyte} — {s.elementName} ({s.detectedCount}/{s.totalCount} det)
                </option>
              ))}
            </select>
          </label>

          <label className="hist-select-label">
            <span>Qualifier</span>
            <select
              className="consol-status-select"
              value={qualifierFilter}
              onChange={e => setQualifierFilter(e.target.value as QualifierFilter)}
            >
              <option value="ALL">All Readings</option>
              <option value="DETECTED">Detected Only (&gt;LOD)</option>
              <option value="LOD">&lt;LOD Only (below_lod)</option>
            </select>
          </label>

          {(locationFilter !== 'ALL' || focusAnalyte !== 'ALL' || qualifierFilter !== 'ALL' || localSearch) && (
            <button
              type="button"
              className="consol-row-btn"
              onClick={() => {
                setLocationFilter('ALL');
                setFocusAnalyte('ALL');
                setQualifierFilter('ALL');
                setLocalSearch('');
                setSortField('source_row_no');
                setSortDir('asc');
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Focused Analyte Statistical Callout Ribbon (when an element is selected) */}
      {focusedAnalyteSummary && (
        <div className="hist-analyte-callout">
          <div className="hist-analyte-callout-head">
            <div>
              <span className="eyebrow">Focused Analyte Distribution</span>
              <h5>
                {focusedAnalyteSummary.analyte} — {focusedAnalyteSummary.elementName}
              </h5>
            </div>
            <div className="hist-analyte-callout-stats">
              <span>
                Detected: <b>{focusedAnalyteSummary.detectedCount} / {focusedAnalyteSummary.totalCount}</b> ({focusedAnalyteSummary.detectionRatePct}%)
              </span>
              <span>
                &lt;LOD: <b>{focusedAnalyteSummary.lodCount}</b>
              </span>
              {focusedAnalyteSummary.detectedCount > 0 ? (
                <>
                  <span>
                    Min: <b>{focusedAnalyteSummary.min?.toLocaleString('en-AU')} {focusedAnalyteSummary.unit || 'ppm'}</b> ({focusedAnalyteSummary.lowestRecord?.location})
                  </span>
                  <span>
                    Median: <b>{focusedAnalyteSummary.median?.toLocaleString('en-AU')} {focusedAnalyteSummary.unit || 'ppm'}</b>
                  </span>
                  <span>
                    Mean: <b>{focusedAnalyteSummary.mean?.toLocaleString('en-AU')} {focusedAnalyteSummary.unit || 'ppm'}</b>
                  </span>
                  <span>
                    Max: <b>{focusedAnalyteSummary.max?.toLocaleString('en-AU')} {focusedAnalyteSummary.unit || 'ppm'}</b> ({focusedAnalyteSummary.peakRecord?.location})
                  </span>
                </>
              ) : (
                <span>All {focusedAnalyteSummary.totalCount} observations are &lt;LOD (below detection limit)</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-MODE 1: RECORDS & ELEMENTAL MATRIX + FULL ROW INSPECTOR */}
      {subMode === 'records' && (
        <div className="hist-records-split">
          <div className="consol-table-wrap hist-records-table-wrap">
            {filteredRecords.length > 0 ? (
              <table className="consol-table">
                <thead>
                  <tr>
                    <th>
                      <button
                        type="button"
                        className="consol-th-sort"
                        onClick={() => handleSort('source_row_no')}
                      >
                        Row / Index {sortField === 'source_row_no' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th>
                      <button
                        type="button"
                        className="consol-th-sort"
                        onClick={() => handleSort('location')}
                      >
                        Location / Opal Field {sortField === 'location' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    <th>Type &amp; Instrument Meta</th>
                    <th>Original Time</th>
                    <th className="num">
                      <button
                        type="button"
                        className="consol-th-sort"
                        onClick={() => handleSort('detected_count')}
                      >
                        Det / &lt;LOD {sortField === 'detected_count' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                      </button>
                    </th>
                    {focusAnalyte !== 'ALL' && (
                      <th className="num">
                        <button
                          type="button"
                          className="consol-th-sort"
                          onClick={() => handleSort('focus_analyte')}
                        >
                          {focusAnalyte} ({ELEMENT_NAMES[focusAnalyte] || focusAnalyte}){' '}
                          {sortField === 'focus_analyte' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                        </button>
                      </th>
                    )}
                    <th>Dominant Quantified Chemistry (Preserved Units &amp; Reported Error)</th>
                    <th className="actions-col">Compare</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map(rec => {
                    const isSelected = activeRecord?.source_row_no === rec.source_row_no;
                    const obsList = rec.observations || [];
                    const detCount = obsList.filter(
                      o => o.qualifier !== 'below_lod' && o.value !== null
                    ).length;
                    const lodCount = obsList.length - detCount;
                    const topObs = getRecordTopObservations(rec, 4);
                    const focusedObs =
                      focusAnalyte !== 'ALL'
                        ? obsList.find(o => o.analyte === focusAnalyte) || null
                        : null;
                    const formattedFocus = focusedObs
                      ? formatHistoricalObservation(focusedObs)
                      : null;
                    const inCompare = compareRowNos.includes(rec.source_row_no);

                    return (
                      <tr
                        key={rec.id || `row-${rec.source_row_no}`}
                        className={`consol-tr ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => handleRowSelect(rec)}
                      >
                        <td className="mono-cell">
                          <strong>#{rec.source_row_no}</strong>
                          <small className="consol-cell-sub">
                            Idx {rec.original_index || '—'}
                            {rec.original_sample ? ` · Smp ${rec.original_sample}` : ''}
                          </small>
                        </td>
                        <td>
                          <strong>{rec.location || 'Unrecorded location'}</strong>
                          <small className="consol-cell-sub">
                            Historical Reference (Non-Specimen)
                          </small>
                        </td>
                        <td className="mono-cell">
                          <span>{rec.material_type || 'Soil'} · {rec.units || 'ppm'}</span>
                          <small className="consol-cell-sub">
                            {rec.duration_s ? `${rec.duration_s}s` : '—'} ·{' '}
                            {rec.sigma_value ? `${rec.sigma_value}σ` : '—'} ·{' '}
                            {rec.sequence || 'Final'}
                          </small>
                        </td>
                        <td className="mono-cell">
                          <span>{rec.original_time || '—'}</span>
                          {rec.time_ambiguous && (
                            <small className="consol-cell-sub hist-ambiguous-tag" title="Day/month order ambiguous in original export; raw string preserved">
                              Ambiguous date preserved
                            </small>
                          )}
                        </td>
                        <td className="num mono-cell">
                          <strong>{detCount}</strong> / <span className="consol-muted-dash">{lodCount}</span>
                          <small className="consol-cell-sub">{obsList.length} obs</small>
                        </td>
                        {focusAnalyte !== 'ALL' && (
                          <td className="num mono-cell">
                            {formattedFocus ? (
                              <span className={`consol-el-pair ${formattedFocus.isLod ? 'is-lod' : ''}`}>
                                <b>{formattedFocus.valueText}</b>{' '}
                                {!formattedFocus.isLod ? formattedFocus.unitText : ''}
                                {formattedFocus.uncertaintyText ? (
                                  <small className="consol-cell-sub">
                                    {formattedFocus.uncertaintyText}
                                  </small>
                                ) : null}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        )}
                        <td>
                          <div className="consol-inline-elements">
                            {topObs.map(o => {
                              const f = formatHistoricalObservation(o);
                              return (
                                <button
                                  key={o.analyte}
                                  type="button"
                                  className={`consol-el-pair hist-clickable-el ${f.isLod ? 'is-lod' : ''} ${focusAnalyte === o.analyte ? 'is-focused' : ''}`}
                                  onClick={e => {
                                    e.stopPropagation();
                                    setFocusAnalyte(o.analyte);
                                    setSortField('focus_analyte');
                                    setSortDir('desc');
                                  }}
                                  title={`Focus on ${o.analyte} (${ELEMENT_NAMES[o.analyte] || o.analyte}) across all historical rows`}
                                >
                                  <b>{o.analyte}</b> {f.valueText}
                                  {!f.isLod && f.unitText ? ` ${f.unitText}` : ''}
                                  {f.uncertaintyText ? ` (${f.uncertaintyText})` : ''}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                        <td className="actions-col" onClick={e => e.stopPropagation()}>
                          <button
                            type="button"
                            className={`consol-row-btn ${inCompare ? 'is-active' : ''}`}
                            onClick={() => toggleCompareRow(rec.source_row_no)}
                            title="Add or remove row from side-by-side field comparison"
                          >
                            {inCompare ? '✓ Comparing' : '+ Compare'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="consol-empty-inline">
                No historical records match the active filter criteria.
              </div>
            )}
          </div>

          {/* Selected Historical Row Full 33-Analyte Inspector */}
          {activeRecord && (
            <div className="hist-row-detail-panel">
              <div className="hist-row-detail-head">
                <div>
                  <span className="eyebrow">
                    Historical Row Inspector · Row #{activeRecord.source_row_no} (Index {activeRecord.original_index || '—'})
                  </span>
                  <h4>{activeRecord.location || `Historical Row #${activeRecord.source_row_no}`}</h4>
                  <small>
                    Type: {activeRecord.material_type || 'Soil'} · Duration: {activeRecord.duration_s ?? '—'}s · Sigma: {activeRecord.sigma_value ?? '—'}σ · Sequence: {activeRecord.sequence || 'Final'} · Original Time: {activeRecord.original_time || '—'}
                    {activeRecord.original_sample ? ` · Original Sample Note: ${activeRecord.original_sample}` : ''}
                  </small>
                </div>

                <div className="hist-row-detail-controls">
                  <div className="consol-segmented-group" role="group" aria-label="Filter row observations">
                    <button
                      type="button"
                      className={`consol-seg-btn ${rowObsFilter === 'ALL' ? 'active' : ''}`}
                      onClick={() => setRowObsFilter('ALL')}
                    >
                      All ({activeRecord.observations?.length || 0})
                    </button>
                    <button
                      type="button"
                      className={`consol-seg-btn ${rowObsFilter === 'DETECTED' ? 'active' : ''}`}
                      onClick={() => setRowObsFilter('DETECTED')}
                    >
                      Detected (
                      {(activeRecord.observations || []).filter(
                        o => o.qualifier !== 'below_lod' && o.value !== null
                      ).length}
                      )
                    </button>
                    <button
                      type="button"
                      className={`consol-seg-btn ${rowObsFilter === 'LOD' ? 'active' : ''}`}
                      onClick={() => setRowObsFilter('LOD')}
                    >
                      &lt;LOD (
                      {(activeRecord.observations || []).filter(
                        o => o.qualifier === 'below_lod' || o.value === null
                      ).length}
                      )
                    </button>
                  </div>

                  <button
                    type="button"
                    className="consol-row-btn"
                    onClick={() => setShowRawColumns(v => !v)}
                  >
                    {showRawColumns ? 'Hide Raw Row' : 'Raw Row JSON'}
                  </button>

                  <button
                    type="button"
                    className="consol-row-btn"
                    onClick={() => setInternalSelectedRowNo(null)}
                    title="Close row inspector"
                  >
                    Close ✕
                  </button>
                </div>
              </div>

              <div className="hist-obs-grid">
                {activeRecordObservations.map(obs => {
                  const f = formatHistoricalObservation(obs);
                  return (
                    <button
                      key={obs.analyte}
                      type="button"
                      className={`hist-obs-cell ${f.isLod ? 'is-lod' : ''} ${focusAnalyte === obs.analyte ? 'is-focused' : ''}`}
                      onClick={() => {
                        setFocusAnalyte(obs.analyte);
                        setSortField('focus_analyte');
                        setSortDir('desc');
                      }}
                      title={`Click to rank all historical rows by ${obs.analyte} (${f.elementName})`}
                    >
                      <div className="hist-obs-cell-top">
                        <strong>{obs.analyte}</strong>
                        <span>{f.elementName}</span>
                      </div>
                      <div className="hist-obs-cell-val mono-cell">
                        {f.valueText} {!f.isLod ? f.unitText : ''}
                      </div>
                      <div className="hist-obs-cell-sub mono-cell">
                        {f.uncertaintyText ? `Error ${f.uncertaintyText}` : 'No error col'} ·{' '}
                        {f.isLod ? `raw "${obs.raw_value}"` : 'quantified'}
                      </div>
                    </button>
                  );
                })}
              </div>

              {showRawColumns && activeRecord.raw && (
                <div className="hist-raw-json-box">
                  <span className="eyebrow">Preserved Original Workbook Columns (historical_records.raw)</span>
                  <div className="hist-raw-kv-grid">
                    {Object.entries(activeRecord.raw)
                      .filter(([, val]) => String(val ?? '').trim() !== '')
                      .map(([k, val]) => (
                        <div key={k} className="hist-raw-kv">
                          <span>{k}</span>
                          <strong className="mono-cell">{String(val)}</strong>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUB-MODE 2: ANALYTE SUMMARY & CROSS-LOCATION DISTRIBUTION */}
      {subMode === 'analytes' && (
        <div className="consol-table-wrap">
          <table className="consol-table">
            <thead>
              <tr>
                <th>Analyte</th>
                <th>Element Name</th>
                <th className="num">Total Obs</th>
                <th className="num">Detected</th>
                <th className="num">&lt;LOD (below_lod)</th>
                <th className="num">Detection %</th>
                <th className="num">Min Detected</th>
                <th className="num">Median</th>
                <th className="num">Mean</th>
                <th className="num">Max Detected</th>
                <th>Peak Location / Field</th>
                <th className="actions-col">Action</th>
              </tr>
            </thead>
            <tbody>
              {analyteSummaries.map(s => {
                const unit = s.unit || 'ppm';
                return (
                  <tr
                    key={s.analyte}
                    className={`consol-tr ${focusAnalyte === s.analyte ? 'is-selected' : ''}`}
                    onClick={() => {
                      setFocusAnalyte(s.analyte);
                      setSortField('focus_analyte');
                      setSortDir('desc');
                      setSubMode('records');
                    }}
                  >
                    <td className="mono-cell">
                      <strong>{s.analyte}</strong>
                    </td>
                    <td>{s.elementName}</td>
                    <td className="num mono-cell">{s.totalCount}</td>
                    <td className="num mono-cell">
                      <strong>{s.detectedCount}</strong>
                    </td>
                    <td className="num mono-cell">{s.lodCount}</td>
                    <td className="num mono-cell">{s.detectionRatePct}%</td>
                    <td className="num mono-cell">
                      {s.min !== null ? `${s.min.toLocaleString('en-AU')} ${unit}` : '— (<LOD)'}
                    </td>
                    <td className="num mono-cell">
                      {s.median !== null ? `${s.median.toLocaleString('en-AU')} ${unit}` : '—'}
                    </td>
                    <td className="num mono-cell">
                      {s.mean !== null ? `${s.mean.toLocaleString('en-AU')} ${unit}` : '—'}
                    </td>
                    <td className="num mono-cell">
                      {s.max !== null ? (
                        <strong>
                          {s.max.toLocaleString('en-AU')} {unit}
                        </strong>
                      ) : (
                        '— (<LOD)'
                      )}
                    </td>
                    <td>
                      {s.peakRecord ? (
                        <span>
                          <strong>{s.peakRecord.location}</strong>{' '}
                          <small className="consol-cell-sub">
                            Row #{s.peakRecord.sourceRowNo}
                            {s.peakRecord.error ? ` (±${s.peakRecord.error})` : ''}
                          </small>
                        </span>
                      ) : (
                        <span className="consol-muted-dash">All rows &lt;LOD</span>
                      )}
                    </td>
                    <td className="actions-col" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        className="consol-row-btn"
                        onClick={() => {
                          setFocusAnalyte(s.analyte);
                          setSortField('focus_analyte');
                          setSortDir('desc');
                          setSubMode('records');
                        }}
                      >
                        Rank Rows →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* SUB-MODE 3: SIDE-BY-SIDE FIELD COMPARISON MATRIX */}
      {subMode === 'compare' && (
        <div className="hist-compare-pane">
          <div className="hist-compare-picker">
            <span className="eyebrow">Select up to 6 Historical Rows / Opal Fields for Side-by-Side Elemental Comparison:</span>
            <div className="hist-compare-chips">
              {datasetRecords.map(r => {
                const active = compareRowNos.includes(r.source_row_no);
                return (
                  <button
                    key={r.source_row_no}
                    type="button"
                    className={`consol-seg-btn ${active ? 'active' : ''}`}
                    onClick={() => toggleCompareRow(r.source_row_no)}
                  >
                    #{r.source_row_no} {r.location}
                  </button>
                );
              })}
            </div>
          </div>

          {compareRowNos.length > 0 ? (
            <div className="consol-table-wrap">
              <table className="consol-table">
                <thead>
                  <tr>
                    <th>Analyte</th>
                    <th>Element</th>
                    {compareRowNos.map(rNo => {
                      const rec = datasetRecords.find(x => x.source_row_no === rNo);
                      return (
                        <th key={rNo} className="num">
                          Row #{rNo}: {rec?.location || '—'}
                          <small className="consol-cell-sub">
                            Idx {rec?.original_index || '—'} · {rec?.units || 'ppm'}
                          </small>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {analyteSummaries.map(s => (
                    <tr key={s.analyte} className="consol-tr">
                      <td className="mono-cell">
                        <strong>{s.analyte}</strong>
                      </td>
                      <td>{s.elementName}</td>
                      {compareRowNos.map(rNo => {
                        const rec = datasetRecords.find(x => x.source_row_no === rNo);
                        const obs = (rec?.observations || []).find(o => o.analyte === s.analyte);
                        if (!obs) {
                          return (
                            <td key={rNo} className="num mono-cell">
                              —
                            </td>
                          );
                        }
                        const f = formatHistoricalObservation(obs);
                        return (
                          <td
                            key={rNo}
                            className={`num mono-cell ${f.isLod ? 'is-lod' : ''}`}
                          >
                            <strong>{f.valueText}</strong>{' '}
                            {!f.isLod ? f.unitText : ''}
                            {f.uncertaintyText ? (
                              <small className="consol-cell-sub">{f.uncertaintyText}</small>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="consol-empty-inline">
              Select at least one historical row above to compare elemental observations.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default HistoricalDataExplorer;
