/**
 * CONSOL Route Definitions & Navigation Model
 * Preserves the exact 8 hash routes from ProvenanceOS UX V2.
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
  | 'settings';

export interface RouteItem {
  id: AppRoute;
  name: string;
  slug: string;
  hash: string;
}

export const APP_ROUTES: RouteItem[] = [
  { id: 'home', name: 'Home', slug: 'home', hash: '#/home' },
  { id: 'samples', name: 'Samples', slug: 'samples', hash: '#/samples' },
  { id: 'solarium', name: 'SOLARIUM', slug: 'solarium', hash: '#/solarium' },
  { id: 'xrf-inbox', name: 'XRF Inbox', slug: 'xrf-inbox', hash: '#/xrf-inbox' },
  { id: 'evidence', name: 'Evidence', slug: 'evidence', hash: '#/evidence' },
  { id: 'reference-data', name: 'Reference Data', slug: 'reference-data', hash: '#/reference-data' },
  { id: 'method', name: 'Method', slug: 'method', hash: '#/method' },
  { id: 'provenance', name: 'Provenance', slug: 'provenance', hash: '#/provenance' },
  { id: 'settings', name: 'Settings', slug: 'settings', hash: '#/settings' }
];

export interface ParsedRoute {
  route: AppRoute;
  specimenId: string | null;
  hash: string;
}

export function parseHash(hash: string): ParsedRoute {
  const clean = hash.replace(/^#\/?/, '').trim();
  const parts = clean.split('/').filter(Boolean);

  if (!parts.length) {
    return { route: 'home', specimenId: null, hash: '#/home' };
  }

  const first = parts[0].toLowerCase();

  if (first === 'samples') {
    if (parts[1]) {
      return { route: 'sample', specimenId: decodeURIComponent(parts[1]), hash };
    }
    return { route: 'samples', specimenId: null, hash };
  }

  if (first === 'solarium') {
    if (parts[1]) {
      return { route: 'solarium', specimenId: decodeURIComponent(parts[1]), hash };
    }
    return { route: 'solarium', specimenId: null, hash };
  }

  if (first === 'xrf-inbox') return { route: 'xrf-inbox', specimenId: null, hash };
  if (first === 'evidence') return { route: 'evidence', specimenId: null, hash };
  if (first === 'reference-data') return { route: 'reference-data', specimenId: null, hash };
  if (first === 'method') return { route: 'method', specimenId: null, hash };
  if (first === 'provenance') return { route: 'provenance', specimenId: null, hash };
  if (first === 'settings') return { route: 'settings', specimenId: null, hash };
  if (first === 'home') return { route: 'home', specimenId: null, hash };

  return { route: 'home', specimenId: null, hash: '#/home' };
}
