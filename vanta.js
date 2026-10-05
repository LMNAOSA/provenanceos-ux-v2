/*! Vanta pXRF CSV parser. Pure functions: no DOM, no network. Runs in the browser and in Node. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Vanta = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SYMBOLS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
    'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re ' +
    'Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu').split(' ');
  const ELEMENT_ORDER = Object.fromEntries(SYMBOLS.map((s, i) => [s, i + 1]));
  ELEMENT_ORDER.LE = 200; // "LE" = light-element balance reported by Vanta Geochem modes
  const isElement = s => Object.prototype.hasOwnProperty.call(ELEMENT_ORDER, s);
  const DEFAULT_UNIT = 'ppm';

  const sortElements = els => [...els].sort((a, b) => (ELEMENT_ORDER[a] ?? 999) - (ELEMENT_ORDER[b] ?? 999));

  function detectDelimiter(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 40);
    const count = (l, d) => l.split(d).length - 1;
    let best = ',', bestScore = 0;
    for (const d of [',', ';', '\t']) {
      const counts = lines.map(l => count(l, d));
      const freq = new Map();
      counts.forEach(c => c > 0 && freq.set(c, (freq.get(c) || 0) + 1));
      const score = freq.size ? Math.max(...freq.values()) : 0; // how many lines agree on the column count
      if (score > bestScore) { best = d; bestScore = score; }
    }
    return best;
  }

  function parseCSV(text, delim) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
        else cell += c;
      } else if (c === '"' && cell === '') quoted = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  function normUnit(u) {
    if (!u) return null;
    const s = u.trim().toLowerCase().replace(/\s+/g, '');
    if (['%', 'wt%', 'weight%', 'percent'].includes(s)) return '%';
    if (['ppm', 'mg/kg'].includes(s)) return 'ppm';
    if (s === 'ppb') return 'ppb';
    return u.trim();
  }

  const ERR_WORD = /^[\s_]*(?:[(\[][^)\]]*[)\]])?[\s_]*(?:\+\/-|\+-|±|err(?:or)?|sd|std(?:\s*dev)?|1\s*s(?:d|igma)?|σ|sigma|uncertainty)/i;
  const ERR_ALONE = /^(?:\+\/-|\+-|±|err(?:or)?(?:\s*1\s*s(?:d|igma)?)?|1\s*s(?:d|igma)?|sd)$/i;

  // "Si" | "Si (%)" | "Si Concentration" → value column.  "Si Error1s" | "Si +/-" | bare "+/-" after Si → error column.
  function classifyHeader(raw, prevEl) {
    const h = String(raw ?? '').replace(/^﻿/, '').trim();
    if (!h) return null;
    if (prevEl && ERR_ALONE.test(h)) return { el: prevEl, kind: 'error' };
    for (const len of [2, 1]) {
      const sym = h.slice(0, len);
      if (sym.length !== len || !isElement(sym)) continue;
      const rest = h.slice(len);
      if (rest.trim() === '') return { el: sym, kind: 'value' };
      const paren = rest.match(/^\s*[(\[]\s*([^)\]]+?)\s*[)\]]\s*$/);
      if (paren) {
        return /^(?:err|error|sd|\+\/-|±|1\s*s)/i.test(paren[1])
          ? { el: sym, kind: 'error' }
          : { el: sym, kind: 'value', unit: normUnit(paren[1]) };
      }
      if (ERR_WORD.test(rest)) return { el: sym, kind: 'error' };
      const label = rest.match(/^\s*(?:conc(?:entration)?|result|content|wt\s*%|ppm|%)\s*$/i);
      if (label) return { el: sym, kind: 'value', unit: normUnit(/ppm|%/i.exec(rest)?.[0]) };
    }
    return null;
  }

  const metaKey = h => String(h ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const META = {
    reading: ['reading', 'reading no', 'reading number', 'test', 'test no', 'test number', 'no', 'index'],
    date: ['date'],
    time: ['time'],
    datetime: ['date time', 'datetime', 'timestamp'],
    method: ['method', 'mode', 'calibration', 'analysis mode', 'test mode', 'application'],
    instrument: ['instrument', 'instrument model', 'model', 'instrument name'],
    unit: ['unit', 'units']
  };
  function findMeta(headers, skip) {
    const out = {};
    for (const [field, names] of Object.entries(META)) {
      let best = -1, bestRank = Infinity;
      headers.forEach((h, i) => {
        if (skip.has(i)) return;
        const rank = names.indexOf(metaKey(h));
        if (rank !== -1 && rank < bestRank) { best = i; bestRank = rank; }
      });
      if (best !== -1) out[field] = best;
    }
    return out;
  }

  function toNumber(s, decimalComma) {
    const t = s.replace(/\s/g, '');
    return Number(decimalComma ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, ''));
  }

  function parseValue(cell, decimalComma) {
    const s = String(cell ?? '').trim();
    if (s === '') return { empty: true };
    if (/^(?:<\s*lod|nd|n\.d\.?|not detected|n\/a|na|-+)$/i.test(s)) return { lod: true };
    const lt = s.match(/^<\s*([0-9.,]+)$/);
    if (lt) { const limit = toNumber(lt[1], decimalComma); return { lod: true, limit: Number.isFinite(limit) ? limit : undefined }; }
    const n = toNumber(s, decimalComma);
    return Number.isFinite(n) ? { value: n } : { invalid: true };
  }

  // Instrument clocks are local time with no zone. dd/mm/yyyy is assumed (Australia) unless the numbers force mm/dd.
  function parseDateTime(dateStr, timeStr) {
    const s = [dateStr, timeStr].filter(Boolean).join(' ').trim();
    if (!s) return null;
    const make = (y, mo, d, hh, mi, ss, ambiguous) => {
      const dt = new Date(y, mo - 1, d, +hh || 0, +mi || 0, +ss || 0);
      if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
      return { iso: dt.toISOString(), ambiguous: !!ambiguous };
    };
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return make(+m[1], +m[2], +m[3], m[4], m[5], m[6]);
    m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]?)?/);
    if (!m) return null;
    const a = +m[1], b = +m[2];
    let y = +m[3]; if (y < 100) y += 2000;
    let day = a, month = b, ambiguous = false;
    if (b > 12 && a <= 12) { day = b; month = a; }
    else if (a <= 12 && b <= 12 && a !== b) ambiguous = true;
    let hh = m[4];
    if (m[7] && hh != null) { hh = +hh % 12; if (/p/i.test(m[7])) hh += 12; }
    return make(y, month, day, hh, m[5], m[6], ambiguous);
  }

  const ID_RE = /\b([A-Za-z]{3})-(\d{6})\b/;

  function parse(input) {
    const text = String(input ?? '').replace(/^﻿/, '');
    const delimiter = detectDelimiter(text);
    const decimalComma = delimiter === ';';
    const rows = parseCSV(text, delimiter);

    // The header is the first row that has several element columns (instruments often write a preamble).
    let headerIdx = -1, cols = [];
    for (let r = 0; r < Math.min(rows.length, 80); r++) {
      let prev = null;
      const found = [];
      rows[r].forEach((cell, i) => {
        const c = classifyHeader(cell, prev);
        if (c) { found.push({ ...c, idx: i }); if (c.kind === 'value') prev = c.el; }
        else prev = null;
      });
      if (found.filter(f => f.kind === 'value').length >= 3) { headerIdx = r; cols = found; break; }
    }
    if (headerIdx === -1) throw new Error('No element columns found. Expected a Vanta CSV export with columns such as Fe, Si, Ca…');

    const headers = rows[headerIdx].map(h => String(h ?? '').replace(/^﻿/, '').trim());
    const elCols = [];
    const seen = new Set();
    for (const c of cols.filter(f => f.kind === 'value')) {
      if (seen.has(c.el)) continue; // repeated element (second beam etc.): keep the first
      seen.add(c.el);
      const err = cols.find(f => f.kind === 'error' && f.el === c.el);
      elCols.push({ el: c.el, valueIdx: c.idx, errorIdx: err ? err.idx : null, unit: c.unit || null });
    }
    const elementIdx = new Set(cols.map(c => c.idx));
    const meta = findMeta(headers, elementIdx);

    const rawKeys = [];
    const used = new Map();
    headers.forEach((h, i) => {
      const base = h || `column ${i + 1}`;
      const n = (used.get(base) || 0) + 1;
      used.set(base, n);
      rawKeys.push(n === 1 ? base : `${base} (${n})`);
    });

    const warnings = [];
    let unitsFound = elCols.some(c => c.unit) || meta.unit != null;
    let ambiguousDates = 0, invalidCells = 0;
    const readings = [];

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const cells = rows[r];
      if (!cells.some(c => String(c).trim() !== '')) continue;
      const rowUnit = meta.unit != null ? normUnit(cells[meta.unit]) : null;
      const results = {};
      for (const col of elCols) {
        const v = parseValue(cells[col.valueIdx], decimalComma);
        if (v.invalid) { invalidCells++; continue; }
        if (v.empty) continue;
        const entry = { value: v.lod ? null : v.value, unit: rowUnit || col.unit || DEFAULT_UNIT, lod: !!v.lod };
        if (v.limit !== undefined) entry.limit = v.limit;
        if (col.errorIdx != null) {
          const e = parseValue(cells[col.errorIdx], decimalComma);
          if (e.value !== undefined && !v.lod) entry.error = e.value;
        }
        results[col.el] = entry;
      }
      if (!Object.keys(results).length) continue;

      const raw = {};
      rawKeys.forEach((k, i) => { raw[k] = cells[i] == null ? '' : String(cells[i]).trim(); });

      let sampleId = null;
      for (let i = 0; i < cells.length && !sampleId; i++) {
        if (elementIdx.has(i)) continue;
        const m = ID_RE.exec(String(cells[i] ?? ''));
        if (m) sampleId = `${m[1]}-${m[2]}`.toUpperCase();
      }

      let when = null;
      if (meta.datetime != null) when = parseDateTime(String(cells[meta.datetime] ?? '').trim());
      else if (meta.date != null) when = parseDateTime(String(cells[meta.date] ?? '').trim(), meta.time != null ? String(cells[meta.time] ?? '').trim() : '');
      if (when?.ambiguous) ambiguousDates++;

      const pick = k => (meta[k] != null && String(cells[meta[k]] ?? '').trim()) || null;
      readings.push({
        rowNo: r + 1,
        readingNo: pick('reading') || String(readings.length + 1),
        measuredAt: when ? when.iso : null,
        method: pick('method'),
        instrument: pick('instrument'),
        sampleId,
        results,
        raw
      });
    }

    if (!readings.length) throw new Error('The file has element columns but no readings under them.');
    if (!unitsFound) warnings.push(`No units found in the file — values are being stored as ${DEFAULT_UNIT}.`);
    if (ambiguousDates) warnings.push('Dates were read as day/month/year. Check the measured times if your instrument uses month/day.');
    if (invalidCells) warnings.push(`${invalidCells} value${invalidCells > 1 ? 's' : ''} could not be read and were left out.`);

    return {
      delimiter,
      headerRowNo: headerIdx + 1,
      elements: sortElements(elCols.map(c => c.el)),
      unitsAssumed: !unitsFound,
      defaultUnit: DEFAULT_UNIT,
      readings,
      warnings
    };
  }


  function parseHistoricalSoil(input) {
    const text = String(input ?? '').replace(/^﻿/, '');
    const delimiter = detectDelimiter(text);
    const decimalComma = delimiter === ';';
    const rows = parseCSV(text, delimiter);
    let headerIdx = -1;
    for (let r = 0; r < Math.min(rows.length, 100); r++) {
      const h = rows[r].map(x => String(x ?? '').trim());
      const names = new Set(h.map(metaKey));
      const elementHeaders = h.reduce((n, cell) => n + (classifyHeader(cell) ? 1 : 0), 0);
      if (names.has('location') && (names.has('time') || names.has('date time')) && names.has('sample') && elementHeaders >= 5) {
        headerIdx = r;
        break;
      }
    }
    if (headerIdx === -1) throw new Error('No historical soil export header found. Expected LOCATION, Time, SAMPLE and paired element/error columns.');

    const headers = rows[headerIdx].map(h => String(h ?? '').replace(/^﻿/, '').trim());
    const find = name => {
      const target = metaKey(name);
      const i = headers.findIndex(h => metaKey(h) === target);
      return i === -1 ? null : i;
    };
    const locationIdx = find('location');
    const timeIdx = find('time');
    const dateTimeIdx = find('date time');
    const typeIdx = find('type');
    const durationIdx = find('duration');
    const unitsIdx = find('units');
    const sigmaIdx = find('sigma value');
    const sequenceIdx = find('sequence');
    const resIdx = find('res');
    const eScaleIdx = find('escale');
    const shapeTimeIdx = find('shape time');
    const sampleIdx = find('sample');
    const indexIdx = find('index');
    const inspectorIdx = find('inspector');
    const cor1Idx = find('cor 1');
    const cor2Idx = find('cor 2');
    const miscIdx = find('misc');
    const noteIdx = find('note');
    const flagsIdx = find('flags');

    const cols = [];
    const seen = new Set();
    headers.forEach((h, idx) => {
      const c = classifyHeader(h);
      if (!c || c.kind !== 'value' || seen.has(c.el)) return;
      seen.add(c.el);
      const err = headers.findIndex((x, i) => i !== idx && classifyHeader(x)?.kind === 'error' && classifyHeader(x)?.el === c.el);
      cols.push({ el:c.el, valueIdx:idx, errorIdx:err === -1 ? null : err, unit:c.unit || null });
    });

    const rawKeys = [];
    const used = new Map();
    headers.forEach((h, i) => {
      const base = h || `column ${i + 1}`;
      const n = (used.get(base) || 0) + 1;
      used.set(base, n);
      rawKeys.push(n === 1 ? base : `${base} (${n})`);
    });

    const warnings = [];
    let ambiguousDates = 0, invalidCells = 0, skippedRows = 0, duplicateHeaders = 0;
    const records = [];

    const textAt = (cells, idx) => idx == null ? null : (String(cells[idx] ?? '').trim() || null);
    const numAt = (cells, idx) => {
      const raw = textAt(cells, idx);
      if (!raw) return null;
      const n = toNumber(raw, decimalComma);
      return Number.isFinite(n) ? n : null;
    };
    const headerRowFingerprint = headers.map(metaKey).join('|');

    for (let r = headerIdx + 1; r < rows.length; r++) {
      const cells = rows[r];
      if (!cells.some(c => String(c).trim() !== '')) continue;
      const fingerprint = cells.map(metaKey).join('|');
      if (fingerprint === headerRowFingerprint || metaKey(cells[locationIdx]) === 'location') {
        duplicateHeaders++;
        continue;
      }

      const location = textAt(cells, locationIdx);
      const originalIndex = textAt(cells, indexIdx);
      const originalSample = textAt(cells, sampleIdx);
      if (!location && !originalIndex && !originalSample) {
        skippedRows++;
        continue;
      }

      const results = [];
      for (const col of cols) {
        const rawValue = textAt(cells, col.valueIdx);
        if (!rawValue) continue;
        const v = parseValue(rawValue, decimalComma);
        if (v.invalid) { invalidCells++; continue; }
        const entry = {
          analyte: col.el,
          raw_value: rawValue,
          value: v.lod ? null : (v.value ?? null),
          qualifier: v.lod ? 'below_lod' : null,
          detection_limit: v.limit ?? null,
          unit: textAt(cells, unitsIdx) || col.unit || null,
          raw_error: textAt(cells, col.errorIdx)
        };
        if (col.errorIdx != null) {
          const e = parseValue(textAt(cells, col.errorIdx) || '', decimalComma);
          entry.error = e.value !== undefined ? e.value : null;
        } else entry.error = null;
        results.push(entry);
      }
      if (!results.length) { skippedRows++; continue; }

      let when = null, timeAmbiguous = false;
      const rawTime = textAt(cells, timeIdx) || textAt(cells, dateTimeIdx);
      if (rawTime) {
        when = parseDateTime(rawTime);
        timeAmbiguous = !!when?.ambiguous;
        if (timeAmbiguous) ambiguousDates++;
      }

      const raw = {};
      rawKeys.forEach((k, i) => { raw[k] = cells[i] == null ? '' : String(cells[i]).trim(); });
      records.push({
        sourceRowNo: r + 1,
        originalIndex,
        location,
        originalTime: rawTime,
        measuredAtLocal: when ? when.iso.slice(0, 19).replace('T', ' ') : null,
        timeAmbiguous,
        originalSample,
        materialType: textAt(cells, typeIdx),
        durationS: numAt(cells, durationIdx),
        units: textAt(cells, unitsIdx),
        sigmaValue: numAt(cells, sigmaIdx),
        sequence: textAt(cells, sequenceIdx),
        res: numAt(cells, resIdx),
        eScale: numAt(cells, eScaleIdx),
        shapeTime: numAt(cells, shapeTimeIdx),
        inspector: textAt(cells, inspectorIdx),
        cor1: textAt(cells, cor1Idx),
        cor2: textAt(cells, cor2Idx),
        misc: textAt(cells, miscIdx),
        note: textAt(cells, noteIdx),
        flags: textAt(cells, flagsIdx),
        raw,
        observations: results
      });
    }

    if (!records.length) throw new Error('The historical soil file has a valid header but no readable records.');
    if (ambiguousDates) warnings.push(`${ambiguousDates} date/time value${ambiguousDates === 1 ? '' : 's'} are ambiguous; the original time text is preserved and the parsed value is marked ambiguous.`);
    if (duplicateHeaders) warnings.push(`${duplicateHeaders} repeated header row${duplicateHeaders === 1 ? '' : 's'} were ignored.`);
    if (invalidCells) warnings.push(`${invalidCells} elemental value${invalidCells === 1 ? '' : 's'} could not be read and were left in the original row only.`);
    if (skippedRows) warnings.push(`${skippedRows} non-data row${skippedRows === 1 ? '' : 's'} were ignored.`);

    return {
      delimiter,
      headerRowNo: headerIdx + 1,
      elements: sortElements(cols.map(c => c.el)),
      units: [...new Set(records.map(r => r.units).filter(Boolean))],
      warnings,
      repeatedHeadersIgnored: duplicateHeaders,
      records,
      recordCount: records.length,
      observationCount: records.reduce((n, r) => n + r.observations.length, 0)
    };
  }

  return { parse, parseCSV, classifyHeader, parseDateTime, sortElements, parseHistoricalSoil, ELEMENT_ORDER };
});
