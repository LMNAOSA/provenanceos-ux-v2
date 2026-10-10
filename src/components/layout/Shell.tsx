/**
 * CONSOL Application Shell
 * Connects the persistent navigation rail to native modular React views,
 * toast messaging, and modal dialogs.
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
import { NewSampleModal } from '../modals/NewSampleModal';
import { EvidenceModal } from '../modals/EvidenceModal';
import { TreatmentModal } from '../modals/TreatmentModal';
import type { CaptureKind } from '../../types';

const SolariumPage = React.lazy(() => import('../../modules/solarium/SolariumPage'));

export const Shell: React.FC = () => {
  const { route, specimenId, toastState, activeModal, modalPayload, closeModal } = useApp();

  const renderActiveView = () => {
    switch (route) {
      case 'home':
        return <HomeView />;
      case 'samples':
        return <SamplesView />;
      case 'sample':
        return <SampleDetailView />;
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
            <SolariumPage specimenId={specimenId} />
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

  return (
    <div className="shell">
      <Rail />
      <main className="content" id="content">
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

      {/* Stage 5A Native Modals */}
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
          // Trigger route refresh
          window.dispatchEvent(new Event('hashchange'));
        }}
      />

      <TreatmentModal
        isOpen={activeModal === 'treatment'}
        sampleId={treatmentPayload?.sampleId || null}
        onClose={closeModal}
        onSuccess={() => {
          // Trigger route refresh
          window.dispatchEvent(new Event('hashchange'));
        }}
      />
    </div>
  );
};

export default Shell;
