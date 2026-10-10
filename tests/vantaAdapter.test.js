const test = require('node:test');
const assert = require('node:assert/strict');
const Vanta = require('../vanta.js');

test('vantaAdapter delegates accurately to original Vanta methods', () => {
  assert.equal(typeof Vanta.parse, 'function');
  assert.equal(typeof Vanta.parseHistoricalSoil, 'function');
  assert.equal(typeof Vanta.sortElements, 'function');

  const csv = 'Reading,Fe,Si,Ca\n1,100,200,300\n';
  const r = Vanta.parse(csv);
  assert.equal(r.readings.length, 1);
  assert.equal(r.readings[0].results.Fe.value, 100);

  const sorted = Vanta.sortElements(['Fe', 'Ca', 'Si']);
  assert.deepEqual(sorted, ['Si', 'Ca', 'Fe']);
});
