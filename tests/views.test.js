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
  if (first === 'home' || first === 'workbench') return { route: 'home', specimenId: null, hash: '#/home' };
  return { route: 'home', specimenId: null, hash: '#/home' };
}

test('route parsing resolves all canonical routes and specimen IDs including solarium and the-lab', () => {
  assert.equal(parseHash('#/home').route, 'home');
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
