/**
 * CONSOL / Vanta Analytical Parser Adapter
 * Strictly preserves the working vanta.js implementation without altering
 * any scientific parsing algorithms, classification rules, or regexes.
 */

import type {
  VantaParseResult,
  HistoricalParseResult,
  ElementalResult
} from '../types';

// Declare global Vanta on window/globalThis for UMD environment
declare global {
  interface Window {
    Vanta?: VantaRawApi;
  }
}

export interface VantaRawApi {
  parse(input: string): VantaParseResult;
  parseCSV(text: string, delim: string): string[][];
  classifyHeader(raw: string, prevEl?: string | null): { el: string; kind: 'value' | 'error'; unit?: string | null } | null;
  parseDateTime(dateStr: string, timeStr?: string): { iso: string; ambiguous: boolean } | null;
  sortElements(els: string[]): string[];
  parseHistoricalSoil(input: string): HistoricalParseResult;
  ELEMENT_ORDER: Record<string, number>;
}

// Load the underlying vanta.js instance
let vantaInstance: VantaRawApi | null = null;

export async function getVantaInstance(): Promise<VantaRawApi> {
  if (vantaInstance) return vantaInstance;

  if (typeof window !== 'undefined' && window.Vanta) {
    vantaInstance = window.Vanta;
    return vantaInstance;
  }

  // In Node.js or dynamic ESM environment
  try {
    // Dynamic import to support both Node tests and Vite bundler
    const imported = await import('../../vanta.js');
    vantaInstance = (imported.default || imported || (typeof window !== 'undefined' ? window.Vanta : undefined)) as unknown as VantaRawApi;
    if (vantaInstance && typeof vantaInstance.parse === 'function') {
      return vantaInstance;
    }
  } catch {
    // Fallback to global Vanta if already evaluated
    if (typeof globalThis !== 'undefined' && (globalThis as unknown as { Vanta?: VantaRawApi }).Vanta) {
      vantaInstance = (globalThis as unknown as { Vanta?: VantaRawApi }).Vanta!;
      return vantaInstance;
    }
  }

  if (typeof window !== 'undefined' && window.Vanta) {
    vantaInstance = window.Vanta;
    return vantaInstance;
  }

  throw new Error('Vanta analytical parser module could not be initialized.');
}

/**
 * Synchronous accessor for environments where vanta.js has already loaded (browser window or Node require)
 */
export function getVantaSync(): VantaRawApi {
  if (vantaInstance) return vantaInstance;
  if (typeof window !== 'undefined' && window.Vanta) {
    vantaInstance = window.Vanta;
    return vantaInstance;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as unknown as { Vanta?: VantaRawApi }).Vanta) {
    vantaInstance = (globalThis as unknown as { Vanta?: VantaRawApi }).Vanta!;
    return vantaInstance;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const req = require('../../vanta.js');
    vantaInstance = req.default || req;
    if (vantaInstance) return vantaInstance;
  } catch {
    // ignore
  }
  throw new Error('Vanta parser is not loaded yet. Call getVantaInstance() or ensure vanta.js is evaluated.');
}

export const vantaAdapter = {
  async parse(input: string): Promise<VantaParseResult> {
    const vanta = await getVantaInstance();
    return vanta.parse(input);
  },

  async parseHistoricalSoil(input: string): Promise<HistoricalParseResult> {
    const vanta = await getVantaInstance();
    return vanta.parseHistoricalSoil(input);
  },

  async sortElements(elements: string[]): Promise<string[]> {
    const vanta = await getVantaInstance();
    return vanta.sortElements(elements);
  },

  sortElementsSync(elements: string[]): string[] {
    try {
      const vanta = getVantaSync();
      return vanta.sortElements(elements);
    } catch {
      return [...elements];
    }
  },

  storageResults(results: Record<string, ElementalResult>, unitsAssumed: boolean): Record<string, ElementalResult> {
    if (!unitsAssumed) return results;
    return Object.fromEntries(
      Object.entries(results || {}).map(([el, r]) => [el, { ...r, unit: r.lod ? r.unit : 'UNVERIFIED' }])
    );
  }
};

export default vantaAdapter;
