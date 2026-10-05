// Run with: node --test tests/
// NOTE: these fixtures are hand-written to cover the header styles Vanta/Olympus exports are known to use.
// They are not copies of a real export — add a real one here once you have it.
const test = require('node:test');
const assert = require('node:assert/strict');
const Vanta = require('../vanta.js');

test('value + "Error1s" columns, preamble lines, BOM, quoted cells, CRLF', () => {
  const csv = '﻿Instrument Serial Num,941729\r\nExport,"Vanta, Geochem"\r\n' +
    'Reading #,Date,Time,Method,Sample,Fe,Fe Error1s,Ca,Ca Error1s,Ba,Ba Error1s\r\n' +
    '1,2026-10-12,14:03:05,Geochem,"AND-000012, rough",1780.74,25.1,710.17,40.2,1841.76,60.5\r\n' +
    '2,2026-10-12,14:04:10,Geochem,AND-000012,1694.3,24.0,452.06,31.9,547.95,22.8\r\n';
  const r = Vanta.parse(csv);
  assert.equal(r.headerRowNo, 3);
  assert.deepEqual(r.elements, ['Ca', 'Fe', 'Ba']);
  assert.equal(r.readings.length, 2);
  const a = r.readings[0];
  assert.equal(a.readingNo, '1');
  assert.equal(a.method, 'Geochem');
  assert.equal(a.sampleId, 'AND-000012');
  assert.deepEqual(a.results.Fe, { value: 1780.74, unit: 'ppm', lod: false, error: 25.1 });
  assert.ok(a.measuredAt.startsWith('2026-10-12') || a.measuredAt.startsWith('2026-10-11'));
  assert.equal(a.raw['Fe Error1s'], '25.1');
  assert.equal(r.unitsAssumed, true);
  assert.match(r.warnings[0], /No units found/);
});

test('units in header and a Units column win over the ppm default', () => {
  const h = Vanta.parse('Reading,Si (%),Al (%),Fe (ppm)\n1,32.48,10.32,2456\n');
  assert.equal(h.unitsAssumed, false);
  assert.equal(h.readings[0].results.Si.unit, '%');
  assert.equal(h.readings[0].results.Fe.unit, 'ppm');
  const u = Vanta.parse('Reading,Units,Si,Al,Fe\n1,%,32.48,10.32,0.4\n');
  assert.equal(u.readings[0].results.Al.unit, '%');
});

test('below-detection values are flagged, not turned into zero', () => {
  const r = Vanta.parse('Reading,Pb,Zn,Cu,U\n1,<LOD,20.04,< LOD,ND\n2,<5.5,12.3,31.58,\n');
  assert.deepEqual(r.readings[0].results.Pb, { value: null, unit: 'ppm', lod: true });
  assert.equal(r.readings[0].results.U.lod, true);
  assert.deepEqual(r.readings[1].results.Pb, { value: null, unit: 'ppm', lod: true, limit: 5.5 });
  assert.equal(r.readings[1].results.U, undefined); // empty cell: no entry at all
});

test('standalone "+/-" columns attach to the element before them', () => {
  const r = Vanta.parse('Reading,Fe,+/-,Ti,+/-,Mn,+/-\n1,1780,25,311,18,81,9\n');
  assert.equal(r.readings[0].results.Fe.error, 25);
  assert.equal(r.readings[0].results.Mn.error, 9);
});

test('Australian dd/mm/yyyy with am/pm, and month-first when it is forced', () => {
  const r = Vanta.parse('Reading,Date,Time,Fe,Si,Ca\n1,13/10/2026,2:03:05 PM,1,2,3\n2,10/13/2026,2:03:05 PM,1,2,3\n3,05/06/2026,9:00:00 AM,1,2,3\n');
  const local = iso => { const d = new Date(iso); return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]; };
  assert.deepEqual(local(r.readings[0].measuredAt), [2026, 10, 13, 14]);
  assert.deepEqual(local(r.readings[1].measuredAt), [2026, 10, 13, 14]);
  assert.deepEqual(local(r.readings[2].measuredAt), [2026, 6, 5, 9]); // ambiguous → day first
  assert.ok(r.warnings.some(w => /day\/month\/year/.test(w)));
});

test('semicolon delimiter with decimal commas', () => {
  const r = Vanta.parse('Reading;Fe;Si;Ca\n1;1780,74;32,48;710,17\n');
  assert.equal(r.delimiter, ';');
  assert.equal(r.readings[0].results.Fe.value, 1780.74);
  assert.equal(r.readings[0].results.Si.value, 32.48);
});

test('non-element columns are not mistaken for elements', () => {
  const r = Vanta.parse('Reading #,Date,Time,Mode,Beam,Sample,Notes,Units,Duration(s),Fe,Si,Ca\n1,2026-10-12,10:00:00,Geochem,1,x,n,ppm,30,1,2,3\n');
  assert.deepEqual(r.elements, ['Si', 'Ca', 'Fe']);
});

test('rejects files that are not element tables', () => {
  assert.throws(() => Vanta.parse('name,age\nbob,3\n'), /No element columns/);
  assert.throws(() => Vanta.parse('Reading,Fe,Si,Ca\n'), /no readings/);
});
