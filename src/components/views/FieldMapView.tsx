/**
 * Private geographic evidence map.
 * All spatial marks come from EXIF or explicit observations. Text labels never become pins.
 * Default street basemap uses OpenFreeMap; APP may supply its own private MapLibre style.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './field-map.css';
import { useApp } from '../../context/AppContext';
import { signed } from '../../services/supabase';
import {
  auditOriginalPhotos, listGeographicObservations, listOriginalPhotos,
  savePhotoGeoObservation, type PhotoGeoAuditRow, type GeoObservation,
  type GeoAuditProgress, type StoredPhoto, type GeographicSource
} from '../../services/geographicEvidence';

interface Pin {
  key: string;
  sample_id: string;
  image_id: string | null;
  latitude: number;
  longitude: number;
  source: GeographicSource;
  accuracy_m: number | null;
  captured_at: string | null;
  source_sha256: string | null;
  preview: boolean;
}
const ANDAMOOKA_CENTER: [number, number] = [137.16, -30.45];
const STREET_STYLE = (import.meta.env.VITE_GEO_MAP_STYLE_URL as string | undefined)?.trim() || 'https://tiles.openfreemap.org/styles/liberty';
// A licensed imagery style can replace this demonstration source via Vercel.
// Do not expose specimen coordinates or private dataset identifiers in tile URLs.
const LICENSED_SATELLITE_STYLE = (import.meta.env.VITE_GEO_SATELLITE_STYLE_URL as string | undefined)?.trim();
const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    'world-imagery': {
      type: 'raster' as const,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Imagery &copy; Esri, Vantor, Earthstar Geographics, and the GIS User Community'
    }
  },
  layers: [{ id: 'satellite-imagery', type: 'raster' as const, source: 'world-imagery' }]
};
type BasemapMode = 'streets' | 'satellite';
const sourceLabel = (source: GeographicSource) => ({
  photo_exif: 'Photo GPS (camera)', device_gps: 'Device GPS',
  reported_origin: 'Reported origin', verified_origin: 'Verified origin'
})[source];

function FieldGeoMap({ pins, selectedId, onSelect, expanded }: {
  expanded: boolean;
  pins: Pin[];
  selectedId: string | null;
  onSelect: (key: string) => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const callbacksRef = useRef(onSelect);
  const [basemap, setBasemap] = useState<BasemapMode>('satellite');
  const [tileError, setTileError] = useState(false);
  callbacksRef.current = onSelect;

  const changeBasemap = (next: BasemapMode) => {
    const map = mapRef.current;
    if (!map || next === basemap) return;
    setTileError(false);
    map.setStyle(next === 'streets' ? STREET_STYLE : LICENSED_SATELLITE_STYLE || SATELLITE_STYLE);
    setBasemap(next);
  };

  useEffect(() => {
    if (!target.current) return;
    // Retain the configured imagery providers; satellite is the initial presentation.
    // Public tile services can infer viewed regions from map tile requests.
    const map = new maplibregl.Map({
      container: target.current,
      style: LICENSED_SATELLITE_STYLE || SATELLITE_STYLE,
      center: ANDAMOOKA_CENTER,
      zoom: 10,
      attributionControl: {}
    });
    map.on('error', () => setTileError(true));
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = map;
    // The rail can collapse independently of the window size.
    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(target.current);
    return () => {
      resizeObserver.disconnect();
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    for (const pin of pins) {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'field-map-marker' + (pin.key === selectedId ? ' is-selected' : '') +
        (pin.preview ? ' is-preview' : '');
      node.dataset.observationKey = pin.key;
      node.dataset.source = pin.source;
      node.setAttribute('aria-pressed', String(pin.key === selectedId));
      const dot = document.createElement('span');
      dot.className = 'field-map-marker-dot';
      dot.setAttribute('aria-hidden', 'true');
      node.appendChild(dot);
      node.title = pin.sample_id + ' · ' + sourceLabel(pin.source) + (pin.preview ? ' · Unsaved EXIF preview' : '');
      node.setAttribute('aria-label', node.title + ' · View coordinates');
      node.addEventListener('click', e => {
        e.stopPropagation();
        callbacksRef.current(pin.key);
      });
      const marker = new maplibregl.Marker({ element: node, anchor: 'center' })
        .setLngLat([pin.longitude, pin.latitude]).addTo(map);
      markersRef.current.push(marker);
    }
    if (pins.length) {
      const bounds = new maplibregl.LngLatBounds();
      pins.forEach(p => bounds.extend([p.longitude, p.latitude]));
      map.fitBounds(bounds, { padding: 56, maxZoom: 16, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 650 });
    }
  }, [pins]);

  useEffect(() => {
    for (const marker of markersRef.current) {
      // Coordinates may be shared by several photos; selection belongs to the observation.
      const node = marker.getElement();
      const active = node.dataset.observationKey === selectedId;
      node.classList.toggle('is-selected', active);
      node.setAttribute('aria-pressed', String(active));
    }
    const selected = pins.find(p => p.key === selectedId);
    if (!selected || !mapRef.current) return;
    const map = mapRef.current;
    const frame = map.getContainer().getBoundingClientRect();
    const mobile = window.matchMedia('(max-width: 950px)').matches;
    // Keep the selected beacon in the exposed map, above/beside the evidence panel.
    const offset: [number, number] = mobile
      ? [0, -(expanded ? Math.min(frame.height * .70, 560) : 100) / 2]
      : [-Math.min(frame.width * .32, 360) / 2, 0];
    map.easeTo({ center: [selected.longitude, selected.latitude], offset,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450 });
  }, [pins, selectedId, expanded]);

  return (
    <div className="field-map-canvas-container">
      <div className="field-map-canvas" ref={target} role="application" aria-label="Private map of georeferenced field evidence" />
      <div className="field-map-base-controls" role="group" aria-label="Select field map imagery">
        <button type="button" className={basemap === 'streets' ? 'is-active' : ''}
          onClick={() => changeBasemap('streets')} aria-pressed={basemap === 'streets'}>Street</button>
        <button type="button" className={basemap === 'satellite' ? 'is-active' : ''}
          onClick={() => changeBasemap('satellite')} aria-pressed={basemap === 'satellite'}
          title="Loads imagery from an external tile provider; viewed map area is visible to the provider">Satellite</button>
      </div>
      <p className="field-map-map-notice">
        {basemap === 'satellite'
          ? LICENSED_SATELLITE_STYLE
            ? 'Satellite imagery · Licensed APP map style'
            : 'Satellite imagery · Esri preview. Check imagery licence before production.'
          : 'Street map · OpenFreeMap'}
        {' · Third-party tile requests reveal the viewed map area'}
      </p>
      {tileError && <p className="field-map-tile-error" role="status">
        Some map tiles failed to load. GPS evidence markers remain available.
      </p>}
    </div>
  );
}

export const FieldMapView: React.FC = () => {
  const { navigate, toast } = useApp();
  const [observations, setObservations] = useState<GeoObservation[]>([]);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  const [rows, setRows] = useState<PhotoGeoAuditRow[]>([]);
  const [auditProgress, setAuditProgress] = useState<GeoAuditProgress | null>(null);
  const [scanning, setScanning] = useState(false);
  const stopRef = useRef(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // CONSOL PREMIUM FIELD MAP V1 — presentation state only. No changes to geographic evidence persistence.
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const sheetToggleRef = useRef<HTMLButtonElement>(null);
  const sheetGesture = useRef<{ y: number; x: number } | null>(null);
  const suppressToggleClick = useRef(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const selectPin = (id: string) => { setSelectedId(id); setDetailsExpanded(true); };

  useEffect(() => {
    const page = pageRef.current;
    const rail = document.querySelector('.pillar-rail');
    if (!page || !rail) return;
    const update = () => page.style.setProperty('--field-nav-height', `${rail.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);
  const [showOnlyGps, setShowOnlyGps] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [signedMap, setSignedMap] = useState<((p: string | null | undefined) => string | null) | null>(null);

  const loadObservations = async () => {
    const result = await listGeographicObservations();
    setObservations(result.observations);
    setMigrationMissing(result.migrationMissing);
  };
  useEffect(() => {
    let active = true;
    Promise.all([listOriginalPhotos(), listGeographicObservations()])
      .then(async ([images, geo]) => {
        if (!active) return;
        setPhotos(images);
        setObservations(geo.observations);
        setMigrationMissing(geo.migrationMissing);
        const urlOf = await signed(images.map(p => p.thumb_path || p.storage_path));
        if (active) setSignedMap(() => urlOf);
      })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; stopRef.current = true; };
  }, []);

  const audit = async () => {
    if (scanning) return;
    setRows([]);
    setAuditProgress(null);
    setNotice('');
    setError('');
    stopRef.current = false;
    setScanning(true);
    try {
      const scanned = await auditOriginalPhotos(p => {
        setAuditProgress(p);
        if (p.row) setRows(previous => [...previous, p.row!]);
      }, () => stopRef.current);
      const located = scanned.filter(r => r.status === 'gps_found').length;
      setNotice('Read-only audit complete: ' + scanned.length + ' originals checked; ' +
        located + ' with usable embedded GPS. No evidence or database records changed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  const pins: Pin[] = useMemo(() => {
    const saved: Pin[] = observations.filter(o => o.verification_status !== 'rejected').map(o => ({
      key: 'saved:' + o.id, sample_id: o.sample_id, image_id: o.sample_image_id,
      latitude: o.latitude, longitude: o.longitude, source: o.source_type,
      accuracy_m: o.accuracy_m, captured_at: o.captured_at,
      source_sha256: o.source_sha256, preview: false
    }));
    const recorded = new Set(saved.filter(x => x.source === 'photo_exif').map(x => x.image_id));
    const unsaved: Pin[] = rows.filter(r => r.geo && !recorded.has(r.photo.id)).map(r => ({
      key: 'preview:' + r.photo.id, sample_id: r.photo.sample_id, image_id: r.photo.id,
      latitude: r.geo!.latitude, longitude: r.geo!.longitude,
      source: 'photo_exif', accuracy_m: r.geo!.accuracy_m,
      captured_at: r.geo!.captured_at, source_sha256: r.actual_sha256, preview: true
    }));
    return [...saved, ...unsaved];
  }, [observations, rows]);

  const selected = pins.find(p => p.key === selectedId) ?? null;
  const photosById = useMemo(() => new Map(photos.map(p => [p.id, p])), [photos]);
  const photo = selected?.image_id ? photosById.get(selected.image_id) : undefined;
  const previewUrl = photo && signedMap ? signedMap(photo.thumb_path || photo.storage_path) : null;
  const validRows = rows.filter(r => r.status === 'gps_found' && r.geo !== null);
  const save = async () => {
    if (migrationMissing || saving || scanning || !validRows.length) return;
    if (!window.confirm('Import ' + validRows.length + ' EXIF observations into the private geographic evidence table? This does not change the original photos.')) return;
    setSaving(true);
    setError('');
    let newRows = 0;
    let duplicates = 0;
    try {
      for (const row of validRows) {
        if (!row.geo || !row.actual_sha256) continue;
        const result = await savePhotoGeoObservation(row.photo, row.geo, row.actual_sha256);
        if (result === 'saved') newRows++;
        else duplicates++;
      }
      await loadObservations();
      setNotice(newRows + ' geographic observations recorded; ' + duplicates + ' already existed. Original evidence untouched.');
    } catch (e) {
      await loadObservations();
      setError('Import stopped after ' + newRows + ' new observations: ' +
        (e instanceof Error ? e.message : String(e)) + '. Retry safely; duplicates are skipped.');
    } finally {
      setSaving(false);
    }
  };

  const statusCounts = rows.reduce((result, r) => {
    result[r.status] = (result[r.status] || 0) + 1;
    return result;
  }, {} as Record<string, number>);

  return (
    <div className="field-map-page" ref={pageRef}>
      <div className="field-map-grid" data-design="premium-field-v1">
        <div className="field-map-ambient-top" aria-hidden="true" />
        <button type="button" className="field-map-back-btn"
          onClick={() => navigate('#/samples')} aria-label="Back to specimen registry">←</button>
        <div className="field-map-hero-brand">
          <span>CONSOL / COLLECTION</span>
          <h1>Field Map</h1>
          <small>{pins.length} evidence {pins.length === 1 ? 'location' : 'locations'}</small>
        </div>
        <button type="button" className="field-map-tools-link" onClick={() => {
          const tools = document.getElementById('field-map-tools');
          tools?.scrollIntoView({ block: 'start' }); tools?.focus({ preventScroll: true });
        }}>EXIF audit &amp; import</button>
        <section className="field-map-surface" aria-label="Evidence coordinates map">
          <FieldGeoMap pins={pins} selectedId={selectedId} expanded={detailsExpanded} onSelect={selectPin} />
          {pins.length === 0 && <div className="field-map-empty-map">No coordinate observations to display. Run a read-only EXIF audit to preview recoverable locations.</div>}
        </section>
        <aside className={'field-map-panel' + (detailsExpanded ? ' is-expanded' : '')}
          aria-label="Map location details" onKeyDown={event => {
            if (event.key === 'Escape') { setDetailsExpanded(false); sheetToggleRef.current?.focus(); }
          }}>
          <div className="field-map-sheet-handle" aria-hidden="true" />
          <button className="field-map-sheet-toggle" type="button" ref={sheetToggleRef}
            aria-controls="field-map-sheet-body"
            onPointerDown={event => {
              if (!event.isPrimary || event.button !== 0) return;
              sheetGesture.current = { y: event.clientY, x: event.clientX };
              suppressToggleClick.current = false;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={event => {
              const start = sheetGesture.current;
              sheetGesture.current = null;
              if (!start) return;
              const dy = event.clientY - start.y;
              if (Math.abs(dy) > 32 && Math.abs(dy) > Math.abs(event.clientX - start.x)) {
                setDetailsExpanded(dy < 0);
                suppressToggleClick.current = true;
              }
            }}
            onPointerCancel={() => { sheetGesture.current = null; }}
            aria-expanded={detailsExpanded}
            aria-label={detailsExpanded ? 'Collapse location details' : 'Expand location details'}
            onClick={() => {
              if (suppressToggleClick.current) { suppressToggleClick.current = false; return; }
              setDetailsExpanded(expanded => !expanded);
            }}>
            {selected && previewUrl && <img src={previewUrl} alt="" />}
            <span className="field-map-sheet-caption">
              <strong>{selected ? selected.sample_id : 'Field observations'}</strong>
              <small>{selected
                ? sourceLabel(selected.source) + (selected.preview ? ' · Unsaved preview' : '')
                : pins.length + ' mapped evidence locations'}</small>
            </span>
            <span className="field-map-sheet-toggle-icon" aria-hidden="true">{detailsExpanded ? '−' : '+'}</span>
          </button>
          <div id="field-map-sheet-body" className="field-map-sheet-body" hidden={!detailsExpanded}>
          {selected ? (
            <div className="field-map-detail">
              <span className="eyebrow">{selected.preview ? 'EXIF PREVIEW · NOT IMPORTED' : 'RECORDED EVIDENCE'}</span>
              {previewUrl && <img className="field-map-photo" src={previewUrl} alt={'Original evidence preview for ' + selected.sample_id} />}
              <h2>{selected.sample_id}</h2>
              <p className="field-map-provenance-note">Camera GPS records the photograph’s capture location, not a verified geological extraction origin.</p>
              <dl>
                <dt>Coordinates</dt><dd>{selected.latitude.toFixed(8)}, {selected.longitude.toFixed(8)}</dd>
                <dt>Evidence source</dt><dd>{sourceLabel(selected.source)}</dd>
                <dt>GPS error estimate</dt><dd>{selected.accuracy_m == null ? 'Not recorded' : selected.accuracy_m.toFixed(2) + ' m'}</dd>
                <dt>Camera timestamp</dt><dd>{selected.captured_at || 'Not recorded'}</dd>
              </dl>

            </div>
          ) : (
            <div className="field-map-detail">
              <span className="eyebrow">Spatial evidence</span>
              <h2>Field observations</h2>
              <p>Select a pin or specimen below. Preview pins are not saved to the database.</p>
              <p>Only explicitly recorded coordinates are mapped. The registry's default location name is never used to invent a GPS position.</p>
            </div>
          )}
          <div className="field-map-list-header">
            <strong>Locations</strong>
            <label><input type="checkbox" checked={showOnlyGps} onChange={e => setShowOnlyGps(e.target.checked)} /> Photo GPS only</label>
          </div>
          <div className="field-map-list">
            {pins.filter(p => !showOnlyGps || p.source === 'photo_exif').map(p =>
              <button type="button" key={p.key} className={'field-map-list-item' + (selectedId === p.key ? ' active' : '')}
                aria-pressed={selectedId === p.key} onClick={() => selectPin(p.key)}>
                <strong>{p.sample_id}</strong><span>{sourceLabel(p.source)}{p.preview ? ' · Preview' : ''}</span>
                <small>{p.latitude.toFixed(6)}, {p.longitude.toFixed(6)}</small>
              </button>
            )}
            {!pins.length && <p className="field-map-list-empty">No coordinates to display.</p>}
          </div>
          </div>
          {selected && detailsExpanded && (
              <div className="field-map-detail-actions">
                <button className="primary" onClick={() => navigate('#/samples/' + encodeURIComponent(selected.sample_id))}>View specimen</button>
                <button className="secondary" onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(selected.latitude.toFixed(8) + ', ' + selected.longitude.toFixed(8));
                    toast('Coordinates copied');
                  } catch { toast('Could not copy coordinates. Select the coordinates above to copy them.', 'error'); }
                }}>Copy coordinates</button>
              </div>
          )}
        </aside>
      </div>
      <section id="field-map-tools" tabIndex={-1} className="field-map-toolbar" aria-label="Geographic evidence actions">
        <div className="field-map-stats">
          <span><strong>{photos.length}</strong> original photographs</span>
          <span><strong>{observations.length}</strong> recorded observations</span>
          <span><strong>{pins.length}</strong> plotted locations</span>
        </div>
        <div className="field-map-actions">
          <button type="button" className="primary" onClick={audit} disabled={scanning || saving}>
            {scanning ? 'Scanning originals…' : 'Scan original photos'}
          </button>
          {scanning && <button type="button" className="secondary" onClick={() => { stopRef.current = true; }}>Stop after current</button>}
          <button type="button" className="secondary" onClick={save} disabled={migrationMissing || scanning || saving || validRows.length === 0}
            title={migrationMissing ? 'Apply the reviewed migration before importing observations' : undefined}>
            {saving ? 'Saving…' : 'Import GPS evidence'}
          </button>
        </div>
      </section>
      {migrationMissing && <div className="field-map-banner" role="status">
        Database migration pending. You can inspect originals and preview all recovered points without making any changes; saving is disabled.
      </div>}
      {auditProgress && <div className="field-map-progress" role="status">
        {scanning ? 'Inspecting' : 'Inspected'} {auditProgress.completed} / {auditProgress.total} originals
        {rows.length > 0 && ' · ' + (statusCounts.gps_found || 0) + ' GPS found · ' + (statusCounts.no_gps || 0) + ' without GPS'}
      </div>}
      {notice && <div className="field-map-banner" role="status">{notice}</div>}
      {error && <div className="field-map-error" role="alert">{error}</div>}
      {rows.length > 0 && <section className="field-map-audit">
        <h2>Original-file audit</h2>
        <p>Read-only assessment. A matching SHA-256 is required before GPS is accepted; missing data is never guessed.</p>
        <div className="field-map-audit-table">
          {rows.map(row => <div className="field-map-audit-row" key={row.photo.id}>
            <strong>{row.photo.sample_id}</strong>
            <span title={row.photo.file_name || ''}>{row.photo.file_name || 'Unnamed image'}</span>
            <span className={'field-map-audit-status ' + row.status}>{row.status.replaceAll('_',' ')}</span>
            <span>{row.geo ? row.geo.latitude.toFixed(6) + ', ' + row.geo.longitude.toFixed(6) : row.detail || 'No coordinates embedded'}</span>
          </div>)}
        </div>
      </section>}
    </div>
  );
};
export default FieldMapView;
