/**
 * CONSOL Historical Dataset Import Service
 * Preserves historical soil and reference analytical records from CSV and XLSX.
 */

import * as XLSXModule from 'xlsx';
import vantaAdapter from './vantaAdapter';
import type { HistoricalParseResult } from '../types';

export async function parseHistoricalFile(file: File): Promise<HistoricalParseResult> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  if (ext === 'xlsx' || ext === 'xls') {
    const XLSX = (typeof window !== 'undefined' && (window as unknown as { XLSX?: typeof XLSXModule }).XLSX) || XLSXModule;
    if (!XLSX || !XLSX.read) {
      throw new Error('The spreadsheet reader did not load. Reload the page and try again.');
    }

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    if (!wb.SheetNames.length) {
      throw new Error('No worksheet found.');
    }

    let lastError: Error | null = null;
    for (const sheetName of wb.SheetNames) {
      try {
        const ws = wb.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: true });
        const parsed = await vantaAdapter.parseHistoricalSoil(csv);
        parsed.workbookSheet = sheetName;
        parsed.sourceFormat = 'xlsx';
        parsed.workbookSheets = wb.SheetNames;
        return parsed;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }

    throw lastError || new Error('No worksheet contained a recognisable historical soil dataset.');
  }

  const csvText = await file.text();
  const parsed = await vantaAdapter.parseHistoricalSoil(csvText);
  parsed.sourceFormat = 'csv';
  return parsed;
}
