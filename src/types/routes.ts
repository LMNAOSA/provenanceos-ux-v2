/**
 * CONSOL Route Definitions, Four-Pillar Navigation & Module Registry
 * UX Reset Step 4 — Scientist-First Information Architecture
 *
 * Preserves all canonical ProvenanceOS hash routes (#/home, #/samples, #/samples/:id,
 * #/solarium, #/solarium/:id, #/xrf-inbox, #/evidence, #/reference-data, #/method,
 * #/provenance, #/settings) and supports #/the-lab and #/the-lab/:id (Investigations).
 */

export type AppRoute =
  | 'home'
  | 'samples'
  | 'sample'
  | 'solarium'
  | 'xrf-inbox'
  | 'evidence'
  | 'reference-data'
  | 'method'
  | 'provenance'
  | 'settings'
  | 'the-lab'
  | 'modules';

export type PillarId =
  | 'COLLECTION'
  | 'SCIENCE'
  | 'VISUALISATION'
  | 'WORKSPACE';

export type ModuleAvailability =
  | 'operational'
  | 'research-stage'
  | 'planned';

export type CapabilityRequirement =
  | 'staff'
  | 'research'
  | 'geology'
  | 'field-acquisition'
  | 'admin'
  | 'scoped-ip';

export interface PillarDefinition {
  id: PillarId;
  label: string;
  subtitle: string;
  description: string;
}

export const PILLARS: PillarDefinition[] = [
  {
    id: 'COLLECTION',
    label: 'Collection',
    subtitle: 'Acquisition & Evidence',
    description: 'Physical specimen registration, field evidence capture, pXRF batch ingestion, and reference datasets.'
  },
  {
    id: 'SCIENCE',
    label: 'Science',
    subtitle: 'Research & Investigation',
    description: 'Scientific questions, controlled experiments, linked specimen evidence, and reviewed findings.'
  },
  {
    id: 'VISUALISATION',
    label: 'Visualisation',
    subtitle: 'Optical & Digital Inspection',
    description: 'Calibrated directional lighting studies and mineral optical inspection.'
  },
  {
    id: 'WORKSPACE',
    label: 'Workspace',
    subtitle: 'Provenance & Governance',
    description: 'Append-only specimen provenance history and research governance.'
  }
];

export interface ModuleRegistryEntry {
  id: string;
  pillar: PillarId;
  label: string;
  shortLabel?: string;
  route: AppRoute | null;
  hash: string | null;
  availability: ModuleAvailability;
  requiredCapability: CapabilityRequirement;
  specimenContextDependency: 'none' | 'optional' | 'required';
  description: string;
  scientificNote?: string;
}

export const MODULE_REGISTRY: ModuleRegistryEntry[] = [
  // 1. COLLECTION
  {
    id: 'specimen-registry',
    pillar: 'COLLECTION',
    label: 'Specimens',
    shortLabel: 'Specimens',
    route: 'samples',
    hash: '#/samples',
    availability: 'operational',
    requiredCapability: 'staff',
    specimenContextDependency: 'optional',
    description: 'Authoritative physical specimen registry (AHM, ACC, ACX, OTH).'
  },
  {
    id: 'xrf-inbox',
    pillar: 'COLLECTION',
    label: 'XRF Inbox',
    route: 'xrf-inbox',
    hash: '#/xrf-inbox',
    availability: 'operational',
    requiredCapability: 'field-acquisition',
    specimenContextDependency: 'optional',
    description: 'Batch Vanta pXRF export ingestion and exact specimen ID matching.'
  },
  {
    id: 'evidence-index',
    pillar: 'COLLECTION',
    label: 'Evidence',
    route: 'evidence',
    hash: '#/evidence',
    availability: 'operational',
    requiredCapability: 'field-acquisition',
    specimenContextDependency: 'optional',
    description: 'Visible light, UV fluorescence, and phosphorescence media evidence.'
  },
  {
    id: 'reference-data',
    pillar: 'COLLECTION',
    label: 'Reference Data',
    route: 'reference-data',
    hash: '#/reference-data',
    availability: 'operational',
    requiredCapability: 'geology',
    specimenContextDependency: 'none',
    description: 'Preserved historical regional soil and geological datasets.'
  },
  {
    id: 'field-method',
    pillar: 'COLLECTION',
    label: 'Field Method',
    route: 'method',
    hash: '#/method',
    availability: 'operational',
    requiredCapability: 'staff',
    specimenContextDependency: 'none',
    description: 'Standardised 5-step field acquisition and evidence protocol.'
  },

  // 2. SCIENCE
  {
    id: 'the-lab',
    pillar: 'SCIENCE',
    label: 'Investigations',
    shortLabel: 'Investigations',
    route: 'the-lab',
    hash: '#/the-lab',
    availability: 'operational',
    requiredCapability: 'research',
    specimenContextDependency: 'optional',
    description: 'Scientific questions, experiments, linked evidence, and reviewed findings.'
  },
  {
    id: 'solve',
    pillar: 'SCIENCE',
    label: 'SOLVE',
    route: null,
    hash: null,
    availability: 'planned',
    requiredCapability: 'research',
    specimenContextDependency: 'optional',
    description: 'Evidence-grounded scientific assistance and comparative chemistry.'
  },

  // 3. VISUALISATION
  {
    id: 'solarium',
    pillar: 'VISUALISATION',
    label: 'SOLARIUM',
    route: 'solarium',
    hash: '#/solarium',
    availability: 'operational',
    requiredCapability: 'staff',
    specimenContextDependency: 'optional',
    description: 'Calibrated Three.js optical Light Box and directional illumination chamber.'
  },
  {
    id: 'soloptics',
    pillar: 'VISUALISATION',
    label: 'SOLOPTICS',
    route: null,
    hash: null,
    availability: 'planned',
    requiredCapability: 'field-acquisition',
    specimenContextDependency: 'required',
    description: 'Guided physical 3D capture sessions.'
  },
  {
    id: 'solid',
    pillar: 'VISUALISATION',
    label: 'SOLID',
    route: null,
    hash: null,
    availability: 'planned',
    requiredCapability: 'research',
    specimenContextDependency: 'required',
    description: 'Photogrammetric reconstruction and versioned digital twins.'
  },
  {
    id: 'excavate',
    pillar: 'VISUALISATION',
    label: 'EXCAVATE',
    route: null,
    hash: null,
    availability: 'planned',
    requiredCapability: 'geology',
    specimenContextDependency: 'optional',
    description: 'Spatial deposit exploration.'
  },

  // 4. WORKSPACE
  {
    id: 'provenance-custody',
    pillar: 'WORKSPACE',
    label: 'Provenance',
    shortLabel: 'Provenance',
    route: 'provenance',
    hash: '#/provenance',
    availability: 'operational',
    requiredCapability: 'staff',
    specimenContextDependency: 'optional',
    description: 'Chronological audit trail of specimen registration, evidence capture, and analyses.'
  },
  {
    id: 'opn-registry',
    pillar: 'WORKSPACE',
    label: 'OPN Registry & Wallet',
    route: null,
    hash: null,
    availability: 'planned',
    requiredCapability: 'admin',
    specimenContextDependency: 'optional',
    description: 'Cross-module provenance attestations.'
  },
  {
    id: 'ip-discovery',
    pillar: 'WORKSPACE',
    label: 'IP & Discovery',
    route: null,
    hash: null,
    availability: 'planned',
    requiredCapability: 'scoped-ip',
    specimenContextDependency: 'optional',
    description: 'Access-scoped intellectual property chronology.'
  },
  {
    id: 'funding-studio',
    pillar: 'WORKSPACE',
    label: 'Funding Studio',
    route: null,
    hash: null,
    availability: 'planned',
    requiredCapability: 'admin',
    specimenContextDependency: 'none',
    description: 'Evidence-linked research grant preparation.'
  }
];

export interface RouteItem {
  id: AppRoute;
  name: string;
  slug: string;
  hash: string;
  pillar?: PillarId;
}

export const APP_ROUTES: RouteItem[] = [
  { id: 'home', name: 'CONSOL', slug: 'home', hash: '#/home' },
  { id: 'samples', name: 'Specimens', slug: 'samples', hash: '#/samples', pillar: 'COLLECTION' },
  { id: 'xrf-inbox', name: 'XRF Inbox', slug: 'xrf-inbox', hash: '#/xrf-inbox', pillar: 'COLLECTION' },
  { id: 'evidence', name: 'Evidence', slug: 'evidence', hash: '#/evidence', pillar: 'COLLECTION' },
  { id: 'reference-data', name: 'Reference Data', slug: 'reference-data', hash: '#/reference-data', pillar: 'COLLECTION' },
  { id: 'method', name: 'Field Method', slug: 'method', hash: '#/method', pillar: 'COLLECTION' },
  { id: 'the-lab', name: 'Investigations', slug: 'the-lab', hash: '#/the-lab', pillar: 'SCIENCE' },
  { id: 'solarium', name: 'SOLARIUM', slug: 'solarium', hash: '#/solarium', pillar: 'VISUALISATION' },
  { id: 'provenance', name: 'Provenance', slug: 'provenance', hash: '#/provenance', pillar: 'WORKSPACE' },
  { id: 'settings', name: 'Settings', slug: 'settings', hash: '#/settings' }
];

export function getPillarForRoute(route: AppRoute): PillarId | null {
  switch (route) {
    case 'samples':
    case 'sample':
    case 'xrf-inbox':
    case 'evidence':
    case 'reference-data':
    case 'method':
      return 'COLLECTION';
    case 'the-lab':
      return 'SCIENCE';
    case 'solarium':
      return 'VISUALISATION';
    case 'provenance':
      return 'WORKSPACE';
    default:
      return null;
  }
}

export function getNavigableModulesByPillar(pillar: PillarId): ModuleRegistryEntry[] {
  return MODULE_REGISTRY.filter(
    m => m.pillar === pillar && m.route !== null && m.availability !== 'planned'
  );
}

export interface ParsedRoute {
  route: AppRoute;
  specimenId: string | null;
  subId?: string | null;
  hash: string;
}

const SPECIMEN_ID_PATTERN = /^(AND|AHM|ACC|ACX|OTH)-[0-9]{6,}$/i;

export function isSpecimenIdentifier(val: string | null | undefined): boolean {
  if (!val) return false;
  return SPECIMEN_ID_PATTERN.test(val.trim());
}

export function parseHash(hash: string): ParsedRoute {
  const clean = hash.replace(/^#\/?/, '').trim();
  const parts = clean.split('/').filter(Boolean);

  if (!parts.length) {
    return { route: 'home', specimenId: null, subId: null, hash: '#/home' };
  }

  const first = parts[0].toLowerCase();

  if (first === 'samples') {
    if (parts[1]) {
      const decoded = decodeURIComponent(parts[1]);
      return { route: 'sample', specimenId: decoded, subId: decoded, hash };
    }
    return { route: 'samples', specimenId: null, subId: null, hash };
  }

  if (first === 'solarium') {
    if (parts[1]) {
      const decoded = decodeURIComponent(parts[1]);
      return { route: 'solarium', specimenId: decoded, subId: decoded, hash };
    }
    return { route: 'solarium', specimenId: null, subId: null, hash };
  }

  if (first === 'the-lab' || first === 'lab' || first === 'investigations') {
    if (parts[1]) {
      const decoded = decodeURIComponent(parts[1]);
      return {
        route: 'the-lab',
        specimenId: isSpecimenIdentifier(decoded) ? decoded : null,
        subId: decoded,
        hash
      };
    }
    return { route: 'the-lab', specimenId: null, subId: null, hash };
  }

  if (first === 'xrf-inbox') return { route: 'xrf-inbox', specimenId: null, subId: null, hash };
  if (first === 'evidence') return { route: 'evidence', specimenId: null, subId: null, hash };
  if (first === 'reference-data') return { route: 'reference-data', specimenId: null, subId: null, hash };
  if (first === 'method') return { route: 'method', specimenId: null, subId: null, hash };
  if (first === 'provenance') return { route: 'provenance', specimenId: null, subId: null, hash };
  if (first === 'modules') return { route: 'modules', specimenId: null, subId: null, hash };
  if (first === 'settings') return { route: 'settings', specimenId: null, subId: null, hash };
  if (first === 'home' || first === 'consol' || first === 'workbench') {
    return { route: 'home', specimenId: null, subId: null, hash: '#/home' };
  }

  return { route: 'home', specimenId: null, subId: null, hash: '#/home' };
}
