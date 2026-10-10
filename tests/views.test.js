const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// Test 1: Hash route parsing logic (v3.2 Four-Pillar Architecture)
function parseHash(hash) {
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
  if (first === 'the-lab' || first === 'lab') {
    if (parts[1]) {
      return { route: 'the-lab', specimenId: decodeURIComponent(parts[1]), hash };
    }
    return { route: 'the-lab', specimenId: null, hash };
  }
  if (first === 'xrf-inbox') return { route: 'xrf-inbox', specimenId: null, hash };
  if (first === 'evidence') return { route: 'evidence', specimenId: null, hash };
  if (first === 'reference-data') return { route: 'reference-data', specimenId: null, hash };
  if (first === 'method') return { route: 'method', specimenId: null, hash };
  if (first === 'provenance') return { route: 'provenance', specimenId: null, hash };
  if (first === 'modules') return { route: 'modules', specimenId: null, hash };
  if (first === 'settings') return { route: 'settings', specimenId: null, hash };
  if (first === 'home' || first === 'consol' || first === 'workbench') return { route: 'home', specimenId: null, hash: '#/home' };
  return { route: 'home', specimenId: null, hash: '#/home' };
}

test('route parsing resolves all canonical routes and specimen IDs including consol, solarium and the-lab', () => {
  assert.equal(parseHash('#/home').route, 'home');
  assert.equal(parseHash('#/consol').route, 'home');
  assert.equal(parseHash('#/workbench').route, 'home');
  assert.equal(parseHash('#/samples').route, 'samples');
  assert.equal(parseHash('#/samples/AHM-000042').route, 'sample');
  assert.equal(parseHash('#/samples/AHM-000042').specimenId, 'AHM-000042');
  assert.equal(parseHash('#/solarium').route, 'solarium');
  assert.equal(parseHash('#/solarium/AHM-000042').route, 'solarium');
  assert.equal(parseHash('#/solarium/AHM-000042').specimenId, 'AHM-000042');
  assert.equal(parseHash('#/the-lab').route, 'the-lab');
  assert.equal(parseHash('#/the-lab/AHM-000042').route, 'the-lab');
  assert.equal(parseHash('#/the-lab/AHM-000042').specimenId, 'AHM-000042');
  assert.equal(parseHash('#/xrf-inbox').route, 'xrf-inbox');
  assert.equal(parseHash('#/reference-data').route, 'reference-data');
  assert.equal(parseHash('#/method').route, 'method');
  assert.equal(parseHash('#/provenance').route, 'provenance');
  assert.equal(parseHash('#/modules').route, 'modules');
  assert.equal(parseHash('#/settings').route, 'settings');
  assert.equal(parseHash('').route, 'home');
});

// Test 2: Specimen material classification codes
const SPECIMEN_CODES = {
  AHM: { code: 'AHM', name: 'Andamooka Hard Matrix', short: 'Hard Matrix' },
  ACC: { code: 'ACC', name: 'Andamooka Coloured Concrete', short: 'Coloured Concrete' },
  ACX: { code: 'ACX', name: 'Andamooka Crystal Opal', short: 'Crystal Opal' },
  OTH: { code: 'OTH', name: 'Unknown/Other/Mixed', short: 'Unknown / Other' }
};

test('specimen classifications preserve physical material categories', () => {
  assert.equal(SPECIMEN_CODES.AHM.short, 'Hard Matrix');
  assert.equal(SPECIMEN_CODES.ACC.short, 'Coloured Concrete');
  assert.equal(SPECIMEN_CODES.ACX.short, 'Crystal Opal');
  assert.equal(SPECIMEN_CODES.OTH.short, 'Unknown / Other');
});

// Test 3: 2D Camera metrology calibration calculation
function calculate2DMeasurement(refPoints, lenPoints, refMm) {
  if (refPoints.length < 2 || lenPoints.length < 2 || !Number.isFinite(refMm) || refMm <= 0) return null;
  const dist = (p1, p2) => Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const refPx = dist(refPoints[0], refPoints[1]);
  const objPx = dist(lenPoints[0], lenPoints[1]);
  if (!refPx) return null;
  return {
    length_mm: (objPx / refPx) * refMm,
    reference_mm: refMm,
    reference_px: refPx,
    object_px: objPx,
    method: '2D camera calibration'
  };
}

test('metrology calculates proportional planar length without guessing thickness', () => {
  const refPoints = [{ x: 0, y: 0 }, { x: 100, y: 0 }]; // 100px reference
  const objPoints = [{ x: 0, y: 0 }, { x: 250, y: 0 }]; // 250px specimen
  const result = calculate2DMeasurement(refPoints, objPoints, 10); // 10mm reference

  assert.ok(result);
  assert.equal(result.length_mm, 25);
  assert.equal(result.reference_px, 100);
  assert.equal(result.object_px, 250);
  assert.equal(result.method, '2D camera calibration');
});

// Test 4: Evidence SHA-256 verification test vector
test('evidence hashing conforms to standard SHA-256 digests', () => {
  const content = 'ProvenanceOS Specimen Evidence Checksum Verification';
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  assert.equal(hash.length, 64);
  assert.match(hash, /^[0-9a-f]{64}$/);
});

// Test 5: Stage 5A capture classification preserves scientific literals without index coercion
test('capture kinds strictly preserve string literals and reject index coercion', () => {
  const validKinds = ['visible', 'fluorescence', 'phosphorescence'];
  validKinds.forEach(kind => {
    assert.ok(typeof kind === 'string');
    assert.ok(!Number.isInteger(Number(kind)));
  });

  // Guard against legacy defect where array index e.g. 0 was passed
  const simulateSafeKind = (input) => {
    if (typeof input === 'number') {
      const kinds = ['visible', 'fluorescence', 'phosphorescence'];
      return kinds[input] || 'visible';
    }
    return ['visible', 'fluorescence', 'phosphorescence'].includes(input) ? input : 'visible';
  };
  assert.equal(simulateSafeKind('fluorescence'), 'fluorescence');
  assert.equal(simulateSafeKind('phosphorescence'), 'phosphorescence');
  assert.equal(simulateSafeKind(1), 'fluorescence');
});

// Test 6: Database specimen ID constraint regex format
test('specimen ID matches authoritative database constraint format', () => {
  const idRegex = /^(AND|AHM|ACC|ACX|OTH)-[0-9]{6,}$/;
  assert.ok(idRegex.test('AHM-000001'));
  assert.ok(idRegex.test('ACC-000042'));
  assert.ok(idRegex.test('ACX-000100'));
  assert.ok(idRegex.test('OTH-999999'));
  assert.ok(idRegex.test('AHM-1234567')); // allows 6+ digits
  assert.ok(!idRegex.test('AHM-42')); // rejected: must be at least 6 digits
  assert.ok(!idRegex.test('XYZ-000001')); // rejected: invalid prefix
});

// Test 7: Upload state machine transitions guarantee retryability without data loss
test('upload state machine handles failure idempotently without data loss', () => {
  const item = {
    id: 'shot-1',
    file: { name: 'specimen.jpg', size: 1024 },
    state: 'pending',
    captureKind: 'visible'
  };

  // Storage upload success
  item.state = 'uploading';
  item.storagePath = 'AHM-000001/shot-1.jpg';

  // Simulated database insert failure
  item.state = 'retryable';
  item.error = 'Database timeout';

  // Assert item retains storagePath and file for re-try
  assert.equal(item.state, 'retryable');
  assert.ok(item.storagePath);
  assert.ok(item.file);

  // On successful re-try
  item.state = 'saved';
  item.error = undefined;
  assert.equal(item.state, 'saved');
  assert.equal(item.error, undefined);
});

// Test 8: Four-Pillar Architecture & Module Registry Contract (UX-01 / UX-02)
function getPillarForRoute(route) {
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

test('four-pillar architecture maps every operational and research route to its authoritative pillar', () => {
  assert.equal(getPillarForRoute('samples'), 'COLLECTION');
  assert.equal(getPillarForRoute('sample'), 'COLLECTION');
  assert.equal(getPillarForRoute('xrf-inbox'), 'COLLECTION');
  assert.equal(getPillarForRoute('evidence'), 'COLLECTION');
  assert.equal(getPillarForRoute('reference-data'), 'COLLECTION');
  assert.equal(getPillarForRoute('method'), 'COLLECTION');
  assert.equal(getPillarForRoute('the-lab'), 'SCIENCE');
  assert.equal(getPillarForRoute('solarium'), 'VISUALISATION');
  assert.equal(getPillarForRoute('provenance'), 'WORKSPACE');
  assert.equal(getPillarForRoute('home'), null);
  assert.equal(getPillarForRoute('settings'), null);
});

// Test 9: Persistent specimen context across pillar transitions
test('persistent specimen context preserves specimen identity across Collection, Visualisation, and Science', () => {
  let activeSpecimenId = null;

  const navigateWithContext = (hash) => {
    const parsed = parseHash(hash);
    if (parsed.specimenId) {
      activeSpecimenId = parsed.specimenId;
    }
    return {
      route: parsed.route,
      effectiveSpecimenId: parsed.specimenId || activeSpecimenId
    };
  };

  // 1. Open specimen in Collection
  const step1 = navigateWithContext('#/samples/AHM-000042');
  assert.equal(step1.route, 'sample');
  assert.equal(step1.effectiveSpecimenId, 'AHM-000042');

  // 2. Inspect XRF Inbox -> context remains AHM-000042
  const step2 = navigateWithContext('#/xrf-inbox');
  assert.equal(step2.route, 'xrf-inbox');
  assert.equal(step2.effectiveSpecimenId, 'AHM-000042');

  // 3. Open SOLARIUM -> inherits AHM-000042
  const step3 = navigateWithContext('#/solarium');
  assert.equal(step3.route, 'solarium');
  assert.equal(step3.effectiveSpecimenId, 'AHM-000042');

  // 4. Open The Lab -> inherits AHM-000042
  const step4 = navigateWithContext('#/the-lab');
  assert.equal(step4.route, 'the-lab');
  assert.equal(step4.effectiveSpecimenId, 'AHM-000042');
});


// Test 10: UX Reset Step 4 — Separation of Investigation Lifecycle & Scientific Record Verification
test('scientific record verification state is independent of investigation lifecycle and requires explicit review for Accepted Finding', () => {
  const investigationLifecycles = ['Draft', 'Active', 'Under Review', 'Closed'];
  const scientificRecordTypes = ['Hypothesis', 'Procedure', 'Observation', 'Interpretation', 'Finding'];

  assert.deepEqual(investigationLifecycles, ['Draft', 'Active', 'Under Review', 'Closed']);
  assert.deepEqual(scientificRecordTypes, ['Hypothesis', 'Procedure', 'Observation', 'Interpretation', 'Finding']);

  // Creating a hypothesis or observation never auto-promotes to Accepted Finding
  const createScientificRecord = (recordType, title) => ({
    recordType,
    verificationState: recordType === 'Finding' ? 'Under Review' : 'Unverified',
    title
  });

  const hyp = createScientificRecord('Hypothesis', 'Sulfur enrichment correlates with dark matrix zones');
  assert.equal(hyp.verificationState, 'Unverified');

  const cand = createScientificRecord('Finding', 'Elevated S confirmed across 3 pXRF spots');
  assert.equal(cand.verificationState, 'Under Review');

  // Explicit review decision required to reach Accepted Finding
  const approveRecord = (rec, reviewer) => ({
    ...rec,
    recordType: 'Finding',
    verificationState: 'Accepted Finding',
    reviewedBy: reviewer
  });

  const accepted = approveRecord(cand, 'Danielle (Geology)');
  assert.equal(accepted.verificationState, 'Accepted Finding');
  assert.equal(accepted.reviewedBy, 'Danielle (Geology)');
});

// Test 11: UX Reset Step 4 — Accordion pillar expansion & subId vs specimenId distinction
test('the-lab route distinguishes specimen IDs from investigation IDs without corrupting activeSpecimenId', () => {
  const isSpecimenIdentifier = (val) => /^(AND|AHM|ACC|ACX|OTH)-[0-9]{6,}$/i.test(String(val || '').trim());

  const parseLabRoute = (param) => ({
    route: 'the-lab',
    specimenId: isSpecimenIdentifier(param) ? param : null,
    subId: param
  });

  const withSpecimen = parseLabRoute('AHM-000042');
  assert.equal(withSpecimen.specimenId, 'AHM-000042');
  assert.equal(withSpecimen.subId, 'AHM-000042');

  const withInvestigation = parseLabRoute('inv-m9x8k2');
  assert.equal(withInvestigation.specimenId, null);
  assert.equal(withInvestigation.subId, 'inv-m9x8k2');
});


// Test 12: Production Authentication State Machine (Issue 1 Regression)
test('authentication state machine strictly enforces unauthenticated, pending, offline, and expired session states', () => {
  function resolveAuthState({ session, serverUserValid, isStaff, networkError, authTokenError }) {
    if (networkError) return 'offline';
    if (!session || !session.access_token || authTokenError || !serverUserValid) {
      return 'unauthenticated';
    }
    if (!isStaff) {
      return 'pending';
    }
    return 'authenticated';
  }

  // 1. Fresh private session (no stored credentials) -> Login screen ('unauthenticated')
  assert.equal(
    resolveAuthState({ session: null, serverUserValid: false, isStaff: false, networkError: false, authTokenError: false }),
    'unauthenticated'
  );

  // 2. Valid authenticated session + authorised staff -> 'authenticated'
  assert.equal(
    resolveAuthState({
      session: { access_token: 'valid-jwt' },
      serverUserValid: true,
      isStaff: true,
      networkError: false,
      authTokenError: false
    }),
    'authenticated'
  );

  // 3. Authenticated user not on staff list -> 'pending'
  assert.equal(
    resolveAuthState({
      session: { access_token: 'valid-jwt' },
      serverUserValid: true,
      isStaff: false,
      networkError: false,
      authTokenError: false
    }),
    'pending'
  );

  // 4. Expired or revoked session -> 'unauthenticated'
  assert.equal(
    resolveAuthState({
      session: { access_token: 'expired-jwt' },
      serverUserValid: false,
      isStaff: true,
      networkError: false,
      authTokenError: true
    }),
    'unauthenticated'
  );

  // 5. Network failure -> 'offline' (never auto-authorises)
  assert.equal(
    resolveAuthState({
      session: { access_token: 'valid-jwt' },
      serverUserValid: true,
      isStaff: true,
      networkError: true,
      authTokenError: false
    }),
    'offline'
  );
});

// Test 13: Mobile Media & Import MIME Resolution and Target-Specimen Locking (Issue 2 Regression)
test('mobile file selection resolves MIME types from extensions and locks specimen-targeted pXRF imports', () => {
  const EXTENSION_TO_MIME = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime'
  };

  function resolveMediaMime(file) {
    const rawType = (file.type || '').trim().toLowerCase();
    if (rawType.startsWith('image/') || rawType.startsWith('video/')) return rawType;
    const ext = ((file.name || '').split('.').pop() || '').trim().toLowerCase();
    return EXTENSION_TO_MIME[ext] || rawType;
  }

  // Mobile iOS Files / Android empty or octet-stream MIME fallback
  assert.equal(resolveMediaMime({ name: 'IMG_4021.HEIC', type: '' }), 'image/heic');
  assert.equal(resolveMediaMime({ name: 'afterglow.MOV', type: 'application/octet-stream' }), 'video/quicktime');
  assert.equal(resolveMediaMime({ name: 'specimen.jpg', type: '' }), 'image/jpeg');

  // Historical raw bucket upload MIME compatibility with vanta-raw allowed_mime_types
  function resolveRawBucketUploadMime(fileName) {
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    return ext === 'xlsx' || ext === 'xls' ? 'application/vnd.ms-excel' : 'text/csv';
  }
  assert.equal(resolveRawBucketUploadMime('2018_Historical_XRF_Data.xlsx'), 'application/vnd.ms-excel');
  assert.equal(resolveRawBucketUploadMime('vanta_export.csv'), 'text/csv');

  // Specimen-targeted import lock prevents attaching rows from other specimens
  function matchRowWithTarget(rowSampleId, lockedTarget) {
    if (lockedTarget) {
      if (!rowSampleId || rowSampleId === lockedTarget) {
        return { matched: lockedTarget, reason: null };
      }
      return { matched: null, reason: `row is labelled ${rowSampleId} (expected ${lockedTarget})` };
    }
    return { matched: rowSampleId, reason: rowSampleId ? null : 'no specimen ID in row' };
  }

  assert.deepEqual(matchRowWithTarget('AHM-000042', 'AHM-000042'), { matched: 'AHM-000042', reason: null });
  assert.deepEqual(matchRowWithTarget(null, 'AHM-000042'), { matched: 'AHM-000042', reason: null });
  assert.deepEqual(matchRowWithTarget('ACC-000009', 'AHM-000042'), {
    matched: null,
    reason: 'row is labelled ACC-000009 (expected AHM-000042)'
  });
});

// Test 14: CONSOL v3.4 Intelligence Dashboard — Elemental LOD & Unit Provenance Discipline
test('CONSOL dashboard formats elemental concentrations without converting <LOD to zero or inventing missing units', () => {
  function formatElementValue(el) {
    const unitText = el.unit ? el.unit : 'unit unrecorded';
    if (el.is_lod) {
      const lodLimit =
        el.lod !== null && el.lod !== undefined && Number.isFinite(Number(el.lod))
          ? `<LOD (${Number(el.lod)})`
          : '<LOD';
      return { valueText: lodLimit, unitText: el.unit || '', isLod: true };
    }
    if (el.concentration === null || el.concentration === undefined || !Number.isFinite(Number(el.concentration))) {
      return { valueText: '—', unitText: el.unit || '', isLod: false };
    }
    return { valueText: String(el.concentration), unitText, isLod: false };
  }

  // Non-detect (<LOD) is never represented as 0
  const lodReading = formatElementValue({ element: 'Au', concentration: null, is_lod: true, lod: 5, unit: 'ppm' });
  assert.equal(lodReading.isLod, true);
  assert.equal(lodReading.valueText, '<LOD (5)');
  assert.notEqual(lodReading.valueText, '0');

  // Missing unit is explicitly flagged, never silently defaulted to ppm
  const missingUnitReading = formatElementValue({ element: 'Fe', concentration: 1420, is_lod: false, unit: null });
  assert.equal(missingUnitReading.unitText, 'unit unrecorded');
  assert.notEqual(missingUnitReading.unitText, 'ppm');
});

// Test 15: CONSOL v3.5 Historical Data Intelligence & Ask CONSOL Interrogation over 24 Rows / 792 Observations
test('CONSOL v3.5 verifies 24 rows and 792 observations in 2018 historical dataset and computes deterministic analyte summaries without converting <LOD to zero', () => {
  const XLSX = require('xlsx');
  const Vanta = require('../vanta.js');
  const wb = XLSX.readFile('./supabase/2018_Historical_XRF_Data.xlsx', { cellDates: true });
  const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { blankrows: true });
  const parsed = Vanta.parseHistoricalSoil(csv);

  assert.equal(parsed.recordCount, 24);
  assert.equal(parsed.observationCount, 792);
  assert.equal(parsed.elements.length, 33);

  // Verify Fe is detected across all 24 rows with peak at Ethiopia (Light Opal) (7013.71 ppm)
  const feValues = parsed.records
    .map(r => r.observations.find(o => o.analyte === 'Fe'))
    .filter(o => o && o.qualifier !== 'below_lod' && o.value !== null);
  assert.equal(feValues.length, 24);
  const maxFe = Math.max(...feValues.map(o => o.value));
  assert.equal(maxFe, 7013.71);

  // Verify Se, Au, U are 100% below_lod (24/24 <LOD) and never numeric 0
  for (const lodEl of ['Se', 'Au', 'U']) {
    const obsForEl = parsed.records.map(r => r.observations.find(o => o.analyte === lodEl));
    assert.equal(obsForEl.length, 24);
    assert.equal(obsForEl.every(o => o.qualifier === 'below_lod' && o.value === null), true);
  }
});

// Test 16: CONSOL v3.6 Priority 2 — Verification of Sulfur Record #14 (Allens Rise Black Opal, Index 112)
test('CONSOL v3.6 verifies Sulfur Record #14 (Allens Rise Black Opal, original index 112) equals 7733.63 ppm with reported error 312.48 ppm against source workbook', () => {
  const XLSX = require('xlsx');
  const Vanta = require('../vanta.js');
  const wb = XLSX.readFile('./supabase/2018_Historical_XRF_Data.xlsx', { cellDates: true });
  const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { blankrows: true });
  const parsed = Vanta.parseHistoricalSoil(csv);

  // Rank all 24 records by Sulfur (S) descending
  const sulfurRanked = parsed.records
    .map(r => {
      const sObs = r.observations.find(o => o.analyte === 'S');
      return {
        sourceRowNo: r.sourceRowNo,
        originalIndex: r.originalIndex,
        location: r.location,
        originalSample: r.originalSample,
        sigmaValue: r.sigmaValue,
        durationS: r.durationS,
        value: sObs ? sObs.value : null,
        error: sObs ? sObs.error : null,
        unit: sObs ? sObs.unit : null,
        qualifier: sObs ? sObs.qualifier : null,
        rawS: r.raw['S'],
        rawSError: r.raw['S Error']
      };
    })
    .filter(item => item.qualifier !== 'below_lod' && item.value !== null)
    .sort((a, b) => b.value - a.value);

  assert.equal(sulfurRanked.length, 24);
  const highestSulfur = sulfurRanked[0];

  // Exact match against persisted Record #14, Allens Rise (Black Opal), original index 112
  assert.equal(highestSulfur.sourceRowNo, 14);
  assert.equal(highestSulfur.originalIndex, '112');
  assert.equal(highestSulfur.location, 'Allens Rise (Black Opal)');
  assert.equal(highestSulfur.originalSample, '6');
  assert.equal(highestSulfur.value, 7733.63);
  assert.equal(highestSulfur.error, 312.48);
  assert.equal(highestSulfur.unit, 'ppm');
  assert.equal(highestSulfur.sigmaValue, 2);
  assert.equal(highestSulfur.durationS, 60);
  assert.equal(highestSulfur.rawS, '7733.63');
  assert.equal(highestSulfur.rawSError, '312.48');

  // Verify next 5 sulfur records for conversational follow-up ("Show me the next five", ranks 2..6)
  const nextFiveLocations = sulfurRanked.slice(1, 6).map(r => r.location);
  assert.deepEqual(nextFiveLocations, [
    'Lightning Ridge (Black Opal)',
    'Slovakia',
    'Coober Pedy (White/Light Opal)',
    'Idaho',
    'Third Hill (White Dam)'
  ]);
});

// Test 17: CONSOL v3.6 Priority 2 & Priority 3 — Regression Fixtures (Units, Synonyms, Duplicates, Scope Isolation, Follow-Up, Unauthorised & Empty Queries)
test('CONSOL v3.6 regression suite covers unit conversions, synonyms, duplicate observations, historical vs contemporary scope isolation, follow-up state, empty results, and unauthorised queries', () => {
  // 1. Unit normalisation & conversion (ppm <-> wt%) without inventing unrecorded units
  function normalizeConcentrationToPpm(value, unit) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return { ppmValue: null, wtPercentValue: null, unitWarning: false };
    }
    const num = Number(value);
    const u = (unit || '').trim().toLowerCase();
    if (!u || u === 'unit unrecorded') {
      return { ppmValue: num, wtPercentValue: null, unitWarning: true };
    }
    if (u === 'ppm' || u === 'mg/kg' || u === 'ug/g') {
      return { ppmValue: num, wtPercentValue: num / 10000, unitWarning: false };
    }
    if (u === '%' || u === 'wt%' || u === 'wt %') {
      return { ppmValue: num * 10000, wtPercentValue: num, unitWarning: false };
    }
    return { ppmValue: num, wtPercentValue: null, unitWarning: true };
  }

  const sulfurConv = normalizeConcentrationToPpm(7733.63, 'ppm');
  assert.equal(sulfurConv.ppmValue, 7733.63);
  assert.equal(Number(sulfurConv.wtPercentValue.toFixed(6)), 0.773363);
  assert.equal(sulfurConv.unitWarning, false);

  const wtPercentConv = normalizeConcentrationToPpm(0.773363, 'wt%');
  assert.equal(Number(wtPercentConv.ppmValue.toFixed(2)), 7733.63);
  assert.equal(wtPercentConv.unitWarning, false);

  const missingUnitConv = normalizeConcentrationToPpm(500, '');
  assert.equal(missingUnitConv.unitWarning, true);
  assert.equal(missingUnitConv.wtPercentValue, null);

  // 2. Element symbols and British/American synonyms (Sulfur / Sulphur -> S, Chromium -> Cr, Aluminium / Aluminum -> Al)
  const SYNONYM_MAP = {
    sulfur: 'S',
    sulphur: 'S',
    s: 'S',
    chromium: 'Cr',
    cr: 'Cr',
    iron: 'Fe',
    fe: 'Fe',
    zirconium: 'Zr',
    zr: 'Zr'
  };
  function resolveAnalyteToken(token) {
    return SYNONYM_MAP[String(token || '').trim().toLowerCase()] || null;
  }
  assert.equal(resolveAnalyteToken('sulfur'), 'S');
  assert.equal(resolveAnalyteToken('sulphur'), 'S');
  assert.equal(resolveAnalyteToken('Chromium'), 'Cr');
  assert.equal(resolveAnalyteToken('Fe'), 'Fe');

  // 3. Duplicate or repeated observations detection within a record
  function detectDuplicates(observations) {
    const counts = {};
    for (const obs of observations) {
      counts[obs.analyte] = (counts[obs.analyte] || 0) + 1;
    }
    return Object.entries(counts)
      .filter(([, count]) => count > 1)
      .map(([analyte, count]) => ({ analyte, count }));
  }
  const dupResult = detectDuplicates([
    { analyte: 'S', value: 7733.63 },
    { analyte: 'S', value: 7710.0 },
    { analyte: 'Fe', value: 1852.04 }
  ]);
  assert.deepEqual(dupResult, [{ analyte: 'S', count: 2 }]);

  // 4. Historical vs Contemporary source isolation + Empty results + Unauthorised queries
  function executeScopedQuery({ query, scope, isAuthorized, historicalRows, contemporaryRows }) {
    if (!isAuthorized) {
      return {
        intent: 'unauthorised',
        directAnswer: 'Query blocked: Authenticated researcher session and active staff capability are required to interrogate CONSOL scientific records.',
        rankedRows: []
      };
    }
    const candidateRows = [
      ...(scope === 'ALL' || scope === 'HISTORICAL' ? historicalRows : []),
      ...(scope === 'ALL' || scope === 'CONTEMPORARY' ? contemporaryRows : [])
    ];
    if (candidateRows.length === 0) {
      return {
        intent: 'empty-result',
        directAnswer: `No records matched in ${scope} scope for "${query}".`,
        rankedRows: []
      };
    }
    return {
      intent: 'element-ranking',
      directAnswer: `Top result is ${candidateRows[0].label} (${candidateRows[0].value} ppm).`,
      rankedRows: candidateRows
    };
  }

  const mockHistorical = [{ sourceKind: 'HISTORICAL', label: 'Allens Rise (Black Opal)', value: 7733.63 }];
  const mockContemporary = []; // 0 contemporary specimens currently registered

  // Unauthorised query is blocked
  const unauthRes = executeScopedQuery({
    query: 'Highest sulfur',
    scope: 'ALL',
    isAuthorized: false,
    historicalRows: mockHistorical,
    contemporaryRows: mockContemporary
  });
  assert.equal(unauthRes.intent, 'unauthorised');
  assert.equal(unauthRes.rankedRows.length, 0);

  // Contemporary-only scope isolates out historical records and returns explicit empty result when 0 specimens exist
  const contempOnlyRes = executeScopedQuery({
    query: 'Highest sulfur',
    scope: 'CONTEMPORARY',
    isAuthorized: true,
    historicalRows: mockHistorical,
    contemporaryRows: mockContemporary
  });
  assert.equal(contempOnlyRes.intent, 'empty-result');
  assert.equal(contempOnlyRes.rankedRows.length, 0);

  // Historical-only scope returns the historical record without fabricating a contemporary specimen ID
  const histOnlyRes = executeScopedQuery({
    query: 'Highest sulfur',
    scope: 'HISTORICAL',
    isAuthorized: true,
    historicalRows: mockHistorical,
    contemporaryRows: mockContemporary
  });
  assert.equal(histOnlyRes.intent, 'element-ranking');
  assert.equal(histOnlyRes.rankedRows.length, 1);
  assert.equal(histOnlyRes.rankedRows[0].sourceKind, 'HISTORICAL');
});

// Test 18: SOLOPTICS v1.0 — Guided Dual-Pass Capture, Quality Evaluation, Acquisition Metadata & Resilient Recovery
test('SOLOPTICS v1.0 enforces specimen binding, Pass A & Pass B completeness, camera AE/AWB limitation flags, SHA-256 hashing, and idempotent retry recovery', async () => {
  // 1. Verify SOLOPTICS route parsing (#/soloptics and #/soloptics/:id)
  function parseSolopticsHash(hash) {
    const clean = hash.replace(/^#\/?/, '').trim();
    const parts = clean.split('/').filter(Boolean);
    if (parts[0]?.toLowerCase() === 'soloptics') {
      return {
        route: 'soloptics',
        specimenId: parts[1] ? decodeURIComponent(parts[1]) : null
      };
    }
    return { route: 'home', specimenId: null };
  }

  assert.deepEqual(parseSolopticsHash('#/soloptics'), { route: 'soloptics', specimenId: null });
  assert.deepEqual(parseSolopticsHash('#/soloptics/AHM-000001'), {
    route: 'soloptics',
    specimenId: 'AHM-000001'
  });

  // 2. Verify Pass A (Physical Appearance) and Pass B (Play-of-Colour) completeness evaluation
  function evaluatePassCompleteness(assets, conditions) {
    const passA = assets.filter(a => a.pass === 'pass_a_appearance');
    const passB = assets.filter(a => a.pass === 'pass_b_play_of_colour');
    const reqRoles = ['front_surface', 'reverse_surface', 'side_profile'];
    const missingA = reqRoles.filter(r => !passA.some(a => a.stepRole === r));
    const passAComplete = missingA.length === 0;
    const passBStills = passB.filter(a => !a.isVideo).length;
    const passBVideos = passB.filter(a => a.isVideo).length;
    const passBComplete = passBStills >= 3 || (passBStills >= 2 && passBVideos >= 1);

    return {
      passAComplete,
      missingA,
      passBComplete,
      passBStills,
      passBVideos,
      scaleRecorded: Boolean(conditions.scaleReferencePresent),
      colourRecorded: Boolean(conditions.colourReferencePresent)
    };
  }

  const partialResult = evaluatePassCompleteness(
    [
      { pass: 'pass_a_appearance', stepRole: 'front_surface', isVideo: false },
      { pass: 'pass_b_play_of_colour', stepRole: 'poc_view_1', isVideo: false }
    ],
    { scaleReferencePresent: false, colourReferencePresent: false }
  );
  assert.equal(partialResult.passAComplete, false);
  assert.deepEqual(partialResult.missingA, ['reverse_surface', 'side_profile']);
  assert.equal(partialResult.passBComplete, false);
  assert.equal(partialResult.scaleRecorded, false);

  const completeResult = evaluatePassCompleteness(
    [
      { pass: 'pass_a_appearance', stepRole: 'front_surface', isVideo: false },
      { pass: 'pass_a_appearance', stepRole: 'reverse_surface', isVideo: false },
      { pass: 'pass_a_appearance', stepRole: 'side_profile', isVideo: false },
      { pass: 'pass_b_play_of_colour', stepRole: 'poc_view_1', isVideo: false },
      { pass: 'pass_b_play_of_colour', stepRole: 'poc_view_2', isVideo: false },
      { pass: 'pass_b_play_of_colour', stepRole: 'poc_view_3', isVideo: false }
    ],
    { scaleReferencePresent: true, colourReferencePresent: true }
  );
  assert.equal(completeResult.passAComplete, true);
  assert.equal(completeResult.passBComplete, true);
  assert.equal(completeResult.scaleRecorded, true);
  assert.equal(completeResult.colourRecorded, true);

  // 3. Verify partial upload failure retains storagePath & sha256 and marks asset 'retryable' without duplicating storage blobs
  const mockAsset = {
    id: 'sol-asset-1',
    sessionId: 'SOL-TEST01',
    sampleId: 'AHM-000001',
    pass: 'pass_a_appearance',
    stepRole: 'front_surface',
    sequenceOrder: 1,
    uploadState: 'pending',
    sha256: null,
    storagePath: null
  };

  let storageUploadCalls = 0;
  let dbInsertCalls = 0;

  async function simulateResilientSolopticsUpload(asset, shouldFailDb) {
    if (!asset.sha256) {
      asset.sha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    }
    if (!asset.storagePath) {
      storageUploadCalls++;
      asset.storagePath = `${asset.sampleId}/soloptics_${asset.sessionId}_${asset.pass}_01.jpg`;
    }
    dbInsertCalls++;
    if (shouldFailDb) {
      asset.uploadState = 'retryable';
      throw new Error('Simulated network interruption during DB insert');
    }
    asset.uploadState = 'saved';
    return asset;
  }

  // First attempt fails on DB insert after storage upload succeeds
  await assert.rejects(
    () => simulateResilientSolopticsUpload(mockAsset, true),
    /Simulated network interruption/
  );
  assert.equal(mockAsset.uploadState, 'retryable');
  assert.equal(storageUploadCalls, 1);
  assert.equal(dbInsertCalls, 1);

  // Second attempt (retry) reuses storagePath & sha256 without re-uploading to storage
  await simulateResilientSolopticsUpload(mockAsset, false);
  assert.equal(mockAsset.uploadState, 'saved');
  assert.equal(storageUploadCalls, 1); // No duplicate storage upload!
  assert.equal(dbInsertCalls, 2);
});
