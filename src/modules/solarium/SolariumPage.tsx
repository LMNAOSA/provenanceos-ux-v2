/**
 * CONSOL / SOLARIUM Light Box Workstation (BUILD 01 & Master Directive Section 11)
 * Native React 19 integration of the authoritative restyled Three.js opal renderer.
 *
 * Capabilities:
 * 1. Explorer & Research Laboratory environments (preserving ThreeOpalViewer, shaders, GLB, Draco, optical maps).
 * 2. Adaptive Instrument UX (BUILD 01):
 *    - Works with 60px collapsed Instrument Rail by default on #/solarium
 *    - Provides explicit Expand / Collapse Navigation control
 *    - Provides Immersive Full-Screen Mode toggle (hides rail completely, Escape or button to exit)
 *    - Never unmounts or recreates the Three.js WebGL context when switching rail or immersive modes
 * 3. Explicit Optical Observation Recording (Section 11):
 *    - Changing visual sliders never silently creates a measurement
 *    - Researchers can explicitly record an optical observation with parameters, actor, timestamp, and specimen ID
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ThreeOpalViewer, ThreeOpalViewerRef } from './ThreeOpalViewer';
import './solarium.css';

const initialLighting = {
  azimuth: 30,
  elevation: (Math.atan2(280, 240) * 180) / Math.PI,
  intensity: 100,
  ambient: 10
};

const defaultMaps = {
  flash: '/solarium/models/Matrixtwin_opal_flash_smooth.png',
  domain: '/solarium/models/Matrixtwin_opal_domain_smooth.png'
};

export interface RecordedOpticalObservation {
  id: string;
  specimenId: string;
  isReferenceModel: boolean;
  azimuth: number;
  elevation: number;
  intensity: number;
  ambient: number;
  lampMode: 'camera' | 'fixed';
  background: 'dark' | 'gray' | 'white';
  environment: 'explorer' | 'laboratory';
  note: string;
  recordedAt: string;
}

const OPTICAL_OBS_STORAGE_KEY = 'consol.solarium.observations.v1';

function loadSavedOpticalObservations(): RecordedOpticalObservation[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = window.localStorage.getItem(OPTICAL_OBS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export interface SolariumPageProps {
  specimenId?: string | null;
  modelUrl?: string;
  opticalMaps?: { flash: string; domain: string };
  initialEnvironment?: 'explorer' | 'laboratory';
  immersiveMode?: boolean;
  onToggleImmersive?: (value: boolean) => void;
  railCollapsed?: boolean;
  onToggleRail?: () => void;
}

export const SolariumPage: React.FC<SolariumPageProps> = ({
  specimenId = null,
  modelUrl = '/solarium/models/Matrixtwin_opal.glb',
  opticalMaps = defaultMaps,
  initialEnvironment = 'explorer',
  immersiveMode = false,
  onToggleImmersive,
  railCollapsed = true,
  onToggleRail
}) => {
  const viewer = useRef<ThreeOpalViewerRef>(null);

  // Environment mode: Explorer (clean restyled presentation) vs Research Laboratory (instrumented)
  const [environment, setEnvironment] = useState<'explorer' | 'laboratory'>(initialEnvironment);

  // Lamp & chamber state
  const [light, setLight] = useState(initialLighting);
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<'camera' | 'fixed'>('camera');
  const [background, setBackground] = useState<'dark' | 'gray' | 'white'>('dark');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // Explicit Optical Observation capture (never triggered automatically by sliders)
  const [observations, setObservations] = useState<RecordedOpticalObservation[]>(() =>
    loadSavedOpticalObservations()
  );
  const [obsNote, setObsNote] = useState('');
  const [obsSavedFeedback, setObsSavedFeedback] = useState<string | null>(null);

  const ready = useCallback(() => setStatus('ready'), []);
  const failed = useCallback(() => setStatus('error'), []);

  const reset = () => {
    setLight(initialLighting);
    setEnabled(true);
    setMode('camera');
    setBackground('dark');
    viewer.current?.resetView();
  };

  // Trigger a smooth resize notification when railCollapsed or immersiveMode changes
  // without remounting ThreeOpalViewer
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [railCollapsed, immersiveMode]);

  const handleRecordObservation = () => {
    const targetSpecimen = specimenId || 'Specimen 01 (Matrixtwin Reference)';
    const entry: RecordedOpticalObservation = {
      id: `OPT-${Date.now().toString(36).toUpperCase()}`,
      specimenId: targetSpecimen,
      isReferenceModel: !specimenId,
      azimuth: Math.round(light.azimuth),
      elevation: Math.round(light.elevation),
      intensity: enabled ? Math.round(light.intensity) : 0,
      ambient: Math.round(light.ambient),
      lampMode: mode,
      background,
      environment,
      note: obsNote.trim() || 'Directional illumination observation',
      recordedAt: new Date().toISOString()
    };

    const next = [entry, ...observations].slice(0, 25);
    setObservations(next);
    setObsNote('');
    try {
      window.localStorage.setItem(OPTICAL_OBS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
    setObsSavedFeedback(`Recorded ${entry.id} (${entry.azimuth}° az / ${entry.elevation}° el)`);
    window.setTimeout(() => {
      setObsSavedFeedback(prev => (prev?.includes(entry.id) ? null : prev));
    }, 4000);
  };

  const snapshot = useRef({ light, enabled, mode, background, status });
  snapshot.current = { light, enabled, mode, background, status };

  // Register browser tool context if available (preserves original capability)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const life = new AbortController();

    const tool = {
      name: 'configure_opal_lamp',
      description: 'Set the visible opal light-box lamp direction, brightness, and fill light.',
      inputSchema: {
        type: 'object',
        properties: {
          azimuth: { type: 'number', minimum: -180, maximum: 180 },
          elevation: { type: 'number', minimum: -20, maximum: 90 },
          intensity: { type: 'number', minimum: 0, maximum: 150 },
          ambient: { type: 'number', minimum: 0, maximum: 50 }
        },
        additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async execute(input: any) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
          throw new Error('Expected lamp settings');
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ranges: any = {
          azimuth: [-180, 180],
          elevation: [-20, 90],
          intensity: [0, 150],
          ambient: [0, 50]
        };
        for (const [k, v] of Object.entries(input)) {
          if (!ranges[k] || typeof v !== 'number' || !Number.isFinite(v) || v < ranges[k][0] || v > ranges[k][1]) {
            throw new Error('Invalid lamp setting: ' + k);
          }
        }
        setLight(p => ({ ...p, ...input }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return snapshot.current;
      }
    };

    try {
      Promise.resolve(context.registerTool(tool, { signal: life.signal })).catch(() => {});
    } catch {
      // ignore
    }
    return () => life.abort();
  }, []);

  function renderSlider(
    key: keyof typeof light,
    label: string,
    min: number,
    max: number,
    unit: string
  ) {
    const fillPercent = ((light[key] - min) / (max - min)) * 100;
    return (
      <label className="slider">
        <span>
          {label}
          <output>
            {Math.round(light[key])}
            {unit}
          </output>
        </span>
        <input
          type="range"
          aria-label={label}
          style={{ '--range-fill': `${fillPercent}%` } as React.CSSProperties}
          min={min}
          max={max}
          step={1}
          value={light[key]}
          onChange={e => setLight(p => ({ ...p, [key]: +e.target.value }))}
        />
      </label>
    );
  }

  const isSpecimenDemo = !specimenId;
  const specimenLabel = specimenId
    ? `Specimen · ${specimenId}`
    : 'Demonstration optical study · Specimen 01 (Matrixtwin)';

  return (
    <div className={`solarium-workstation ${immersiveMode ? 'is-immersive' : ''}`}>
      <div className="solarium-container">
        {!immersiveMode && (
          <header>
            <div className="brand">
              <img
                src="/assets/SOLARIUM logo.svg"
                alt="SOLARIUM"
                className="solarium-logo-svg"
              />
              <div>
                <span className="eyebrow">Optical studies · Light Box</span>
              </div>
            </div>

            <div className="header-meta">
              {onToggleRail && (
                <button
                  type="button"
                  className="solarium-nav-btn"
                  onClick={onToggleRail}
                  aria-label={railCollapsed ? 'Expand Navigation' : 'Collapse Navigation'}
                  title={
                    railCollapsed
                      ? 'Expand CONSOL Navigation Rail'
                      : 'Collapse to 60px Instrument Rail'
                  }
                >
                  {railCollapsed ? 'Expand Navigation' : 'Instrument Rail'}
                </button>
              )}

              {onToggleImmersive && (
                <button
                  type="button"
                  className="solarium-nav-btn"
                  onClick={() => onToggleImmersive(true)}
                  aria-label="Enter immersive full-screen instrument mode"
                  title="Hide navigation and expand viewing chamber (Esc to exit)"
                >
                  Immersive View
                </button>
              )}

              <div className="env-pills" role="radiogroup" aria-label="Environment Mode">
                <button
                  type="button"
                  className={`env-pill ${environment === 'explorer' ? 'active' : ''}`}
                  onClick={() => setEnvironment('explorer')}
                >
                  Explorer
                </button>
                <button
                  type="button"
                  className={`env-pill ${environment === 'laboratory' ? 'active' : ''}`}
                  onClick={() => setEnvironment('laboratory')}
                >
                  Research Laboratory
                </button>
              </div>

              <span className="specimen">
                <span className="specimen-dot" /> {specimenLabel}
              </span>
            </div>
          </header>
        )}

        {!immersiveMode && (
          <div className="intro">
            <div>
              <p className="eyebrow">Light · Form · Colour</p>
              <h2>Discover every flash.</h2>
              <p className="intro-note">
                {isSpecimenDemo
                  ? 'Reference mineral geometry under calibrated directional illumination.'
                  : `Interactive optical investigation for specimen ${specimenId} (using Specimen 01 reference geometry until SOLID twin is published).`}
              </p>
            </div>
            <span className="study-label">
              {environment === 'explorer' ? 'Interactive lighting study' : 'Scientific Research Interface'}
            </span>
          </div>
        )}

        <div className="workspace">
          <section className={`stage ${background}`} aria-label="Opal viewing chamber">
            <ThreeOpalViewer
              ref={viewer}
              modelUrl={modelUrl}
              dracoDecoderPath="/solarium/draco/"
              opticalMaps={opticalMaps}
              lighting={{ ...light, intensity: enabled ? light.intensity : 0 }}
              lampMode={mode}
              showInstruments={environment === 'laboratory'}
              proceduralFallback={false}
              fitWidth
              onReady={ready}
              onLoadError={failed}
            />

            {status !== 'ready' && (
              <div className="status" role="status">
                {status === 'loading' ? (
                  <>
                    <span className="spinner" />
                    Loading mineral specimen…
                  </>
                ) : (
                  <>
                    The 3D model could not be displayed.
                    <button type="button" onClick={() => window.location.reload()}>
                      Try again
                    </button>
                  </>
                )}
              </div>
            )}

            <div className="stage-top">
              <span className="chamber-label">
                <span className="eyebrow">
                  {isSpecimenDemo ? 'Specimen 01 · Reference' : `${specimenId} · Reference Geometry`}
                </span>
                Viewing chamber
              </span>
              <div className="stage-top-actions">
                {immersiveMode && onToggleImmersive && (
                  <button
                    type="button"
                    className="exit-immersive-btn"
                    onClick={() => onToggleImmersive(false)}
                    aria-label="Exit immersive mode"
                  >
                    Exit Immersive · Esc
                  </button>
                )}
                {!immersiveMode && onToggleImmersive && (
                  <button
                    type="button"
                    onClick={() => onToggleImmersive(true)}
                    aria-label="Expand viewing chamber to immersive mode"
                  >
                    Full Chamber
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => viewer.current?.resetView()}
                  aria-label="Reset camera view"
                >
                  Reset view
                </button>
              </div>
            </div>

            <div className="stage-bottom">
              <span>Drag to rotate · Pinch to zoom</span>
              <span className={`lamp-status ${enabled && light.intensity > 0 ? 'is-on' : ''}`}>
                <i />
                {enabled && light.intensity > 0 ? 'Lamp on' : 'Lamp off'}
              </span>
            </div>
          </section>

          <aside aria-label="Lighting controls">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Illumination</p>
                <h2>Shape the light</h2>
              </div>
              <label className="toggle">
                <input
                  type="checkbox"
                  aria-label="Lamp enabled"
                  checked={enabled}
                  onChange={e => setEnabled(e.target.checked)}
                />
                <span>{enabled ? 'On' : 'Off'}</span>
              </label>
            </div>

            {renderSlider('azimuth', 'Around the stone', -180, 180, '°')}
            {renderSlider('elevation', 'Lamp height', -20, 90, '°')}
            {renderSlider('intensity', 'Brightness', 0, 150, '%')}
            {renderSlider('ambient', 'Fill light', 0, 50, '%')}

            <label className="select-label">
              Lamp position
              <select value={mode} onChange={e => setMode(e.target.value as 'camera' | 'fixed')}>
                <option value="camera">Moves with the view</option>
                <option value="fixed">Stays in the light box</option>
              </select>
            </label>

            <div className="divider" />
            <h2 className="section-heading">Chamber background</h2>
            <div className="swatches" role="group" aria-label="Background colour">
              {(
                [
                  ['dark', 'Dark'],
                  ['gray', 'Grey'],
                  ['white', 'White']
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  className={`swatch ${val}${background === val ? ' selected' : ''}`}
                  aria-pressed={background === val}
                  onClick={() => setBackground(val)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="divider" />
            <h2 className="section-heading">Optical observation log</h2>
            <div className="observation-capture">
              <input
                type="text"
                className="observation-note-input"
                placeholder="Observation note (e.g. green-blue flash at 30°)"
                value={obsNote}
                onChange={e => setObsNote(e.target.value)}
                aria-label="Optical observation note"
              />
              <button
                type="button"
                className="record-observation-btn"
                onClick={handleRecordObservation}
              >
                Record optical observation
              </button>
              {obsSavedFeedback && (
                <p className="observation-feedback" role="status">
                  {obsSavedFeedback}
                </p>
              )}
            </div>

            <button type="button" className="reset" onClick={reset}>
              Reset light box
            </button>
            <p className="note">
              Adjusting illumination does not automatically create a measurement. Use Record optical observation to log parameters.
            </p>
          </aside>
        </div>

        {!immersiveMode && (
          <footer>
            <span>SOLARIUM · OPAL LIGHT BOX</span>
            <span>Original geometry · Visual lighting study</span>
          </footer>
        )}
      </div>
    </div>
  );
};

export default SolariumPage;
