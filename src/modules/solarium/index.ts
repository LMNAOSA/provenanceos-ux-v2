/**
 * CONSOL / SOLARIUM Module Integration
 * Authoritative Light Box and optical research workstation.
 */

export { SolariumPage } from './SolariumPage';
export type { SolariumPageProps } from './SolariumPage';
export { ThreeOpalViewer } from './ThreeOpalViewer';
export type {
  ThreeOpalViewerRef,
  ProjectedFeature,
  OpticalBench3DPoints,
  MatrixBench3DPoints,
  OpticalMetrics
} from './ThreeOpalViewer';

export interface SolariumSpecimenContext {
  specimenId: string;
  hasOpticalMaps?: boolean;
}

export type SolariumEnvironment = 'explorer' | 'laboratory';

export interface SolariumModuleContract {
  name: 'SOLARIUM';
  version: '2.1.0-restyled-integrated';
  active: true;
}

export const SOLARIUM_MODULE_SLOT: SolariumModuleContract = {
  name: 'SOLARIUM',
  version: '2.1.0-restyled-integrated',
  active: true
};
