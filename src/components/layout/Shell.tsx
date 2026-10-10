/**
 * CONSOL Application Shell (BUILD 01)
 * Connects the adaptive navigation rail (Normal Workstation, SOLARIUM Instrument Mode,
 * and Immersive Full-Screen Instrument Mode) to modular React views, persistent specimen
 * context, toast messaging, and native modal dialogs.
 */

import React from 'react';
import { useApp } from '../../context/AppContext';
import { Rail } from './Rail';
import { HomeView } from '../views/HomeView';
import { SamplesView } from '../views/SamplesView';
import { SampleDetailView } from '../views/SampleDetailView';
import { XrfInboxView } from '../views/XrfInboxView';
import { ReferenceDataView } from '../views/ReferenceDataView';
import { MethodView } from '../views/MethodView';
import { ProvenanceView } from '../views/ProvenanceView';
import { SettingsView } from '../views/SettingsView';
import { TheLabView } from '../views/TheLabView';
import { ModuleDirectoryView } from '../views/ModuleDirectoryView';
import { SolopticsView } from '../views/SolopticsView';
import { NewSampleModal } from '../modals/NewSampleModal';
import { EvidenceModal } from '../modals/EvidenceModal';
import { TreatmentModal } from '../modals/TreatmentModal';
import { VantaImportModal } from '../modals/VantaImportModal';
import { HistoricalImportModal } from '../modals/HistoricalImportModal';
import type { CaptureKind } from '../../types';

const SolariumPage = React.lazy(() => import('../../modules/solarium/SolariumPage'));

export const Shell: React.FC = () => {
  const {
    route,
    specimenId,
    activeSpecimenId,
    navigationMode,
    railCollapsed,
    setRailCollapsed,
    immersiveMode,
    setImmersiveMode,
    toastState,
    activeModal,
    modalPayload,
    closeModal
  } = useApp();

  // Pass either the explicit URL specimenId or the persisted activeSpecimenId into SOLARIUM
  const solariumSpecimenId = specimenId || activeSpecimenId;

  const renderActiveView = () => {
    switch (route) {
      case 'home':
        return <HomeView />;
      case 'samples':
        return <SamplesView />;
      case 'sample':
        return <SampleDetailView />;
      case 'the-lab':
        return <TheLabView />;
      case 'modules':
        return <ModuleDirectoryView />;
      case 'soloptics':
        return <SolopticsView />;
      case 'solarium':
        return (
          <React.Suspense
            fallback={
              <div
                className="loading"
                role="status"
                style={{
                  minHeight: '60vh',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--muted)',
                  fontSize: 13
                }}
              >
                Loading SOLARIUM Light Box…
              </div>
            }
          >
            <SolariumPage
              specimenId={solariumSpecimenId}
              immersiveMode={immersiveMode}
              onToggleImmersive={setImmersiveMode}
              railCollapsed={railCollapsed}
              onToggleRail={() => setRailCollapsed(!railCollapsed)}
            />
          </React.Suspense>
        );
      case 'xrf-inbox':
        return <XrfInboxView />;
      case 'evidence':
        return <SamplesView />;
      case 'reference-data':
        return <ReferenceDataView />;
      case 'method':
        return <MethodView />;
      case 'provenance':
        return <ProvenanceView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <HomeView />;
    }
  };

  const evidencePayload = modalPayload as { sampleId?: string; kind?: CaptureKind } | null;
  const treatmentPayload = modalPayload as { sampleId?: string } | null;
  const vantaImportPayload = modalPayload as { sampleId?: string | null } | null;
  const historicalImportPayload = modalPayload as { preloadBundled2018?: boolean } | null;

  const isInstrumentView = route === 'solarium' || route === 'soloptics';
  const shellClasses = [
    'shell',
    railCollapsed ? 'rail-is-collapsed' : '',
    isInstrumentView ? 'in-solarium' : '',
    immersiveMode && isInstrumentView ? 'is-immersive-instrument' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={shellClasses} data-nav-mode={navigationMode}>
      <Rail />
      <main className={`content ${route === 'solarium' ? 'content-solarium' : ''}`} id="content">
        {renderActiveView()}
      </main>

      {/* Persistent Toast Notifications */}
      <div
        className={`toast ${toastState.visible ? 'show' : ''} ${toastState.type === 'error' ? 'error' : ''}`}
        role="status"
        aria-live="polite"
      >
        {toastState.message}
      </div>

      {/* Native Operational Modals */}
      <NewSampleModal
        isOpen={activeModal === 'new-sample'}
        onClose={closeModal}
      />

      <EvidenceModal
        isOpen={activeModal === 'evidence'}
        sampleId={evidencePayload?.sampleId || null}
        initialKind={evidencePayload?.kind || 'visible'}
        onClose={closeModal}
        onSuccess={() => {
          window.dispatchEvent(new Event('hashchange'));
          window.dispatchEvent(new Event('consol:data-updated'));
        }}
      />

      <TreatmentModal
        isOpen={activeModal === 'treatment'}
        sampleId={treatmentPayload?.sampleId || null}
        onClose={closeModal}
        onSuccess={() => {
          window.dispatchEvent(new Event('hashchange'));
          window.dispatchEvent(new Event('consol:data-updated'));
        }}
      />

      <VantaImportModal
        isOpen={activeModal === 'import-csv'}
        targetSpecimenId={vantaImportPayload?.sampleId || null}
        onClose={closeModal}
        onSuccess={() => {
          window.dispatchEvent(new Event('hashchange'));
          window.dispatchEvent(new Event('consol:data-updated'));
        }}
      />

      <HistoricalImportModal
        isOpen={activeModal === 'import-history'}
        preloadBundled2018={Boolean(historicalImportPayload?.preloadBundled2018)}
        onClose={closeModal}
        onSuccess={() => {
          window.dispatchEvent(new Event('hashchange'));
          window.dispatchEvent(new Event('consol:data-updated'));
        }}
      />
    </div>
  );
};

export default Shell;
