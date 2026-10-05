const test = require('node:test');
const assert = require('node:assert/strict');
const Vanta = require('../vanta.js');

test('historical soil export preserves repeated headers, metadata, units and LOD results', () => {
  const header = 'Index,LOCATION,Time,Type,Duration,Units,Sigma Value,Sequence,Res,EScale,Shape Time,SAMPLE,INSPECTOR,COR 1,COR 2,MISC,NOTE,Flags,Cu,Cu Error,Fe,Fe Error,Ca,Ca Error';
  const csv =
    header + '\r\n' +
    '106,Second Hill,11/4/2018 20:33,Soil,60,ppm,2,Final,,,,,, , , , , ,44.47,14.27,2456.37,86.98,< LOD,4.97\r\n' +
    header + '\r\n' +
    '107,Third Hill (White Dam),11/4/2018 20:36,Soil,60,ppm,2,Final,,,,1,,,,,,35.14,13.34,2244.99,81.78,< LOD,4.90\r\n';

  const r = Vanta.parseHistoricalSoil(csv);

  assert.equal(r.recordCount, 2);
  assert.equal(r.repeatedHeadersIgnored, 1);
  assert.equal(r.observationCount, 6);
  assert.deepEqual(r.elements, ['Ca','Fe','Cu']);
  assert.equal(r.records[0].location, 'Second Hill');
  assert.equal(r.records[0].originalSample, null);
  assert.equal(r.records[1].originalSample, '1');
  assert.equal(r.records[0].units, 'ppm');
  assert.equal(r.records[0].sigmaValue, 2);
  assert.equal(r.records[0].durationS, 60);
  assert.equal(r.records[0].observations.find(o => o.analyte === 'Fe').value, 2456.37);
  const ca = r.records[0].observations.find(o => o.analyte === 'Ca');
  assert.equal(ca.value, null);
  assert.equal(ca.qualifier, 'below_lod');
  assert.equal(ca.raw_value, '< LOD');
  assert.equal(ca.error, 4.97);
  assert.ok(r.warnings.some(w => /repeated header/i.test(w)));
  assert.ok(r.warnings.some(w => /ambiguous/i.test(w)));
});

test('historical parser keeps original row text even when an elemental value is invalid', () => {
  const csv = 'Index,LOCATION,Time,Type,Duration,Units,Sigma Value,Sequence,SAMPLE,Cu,Cu Error,Fe,Fe Error,Ca,Ca Error\n' +
    '1,Test,13/4/2018 20:00,Soil,60,ppm,2,Final,1,not-a-number,2,12.5,1.2,3.1,0.9\n';
  const r = Vanta.parseHistoricalSoil(csv);
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].observations.some(o => o.analyte === 'Cu'), false);
  assert.equal(r.records[0].raw.Cu, 'not-a-number');
  assert.ok(r.warnings.some(w => /could not be read/i.test(w)));
});
