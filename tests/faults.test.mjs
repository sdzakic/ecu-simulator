import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, started } from './helpers.mjs';

// fault → expected DTC, and whether it needs a full-throttle pull to show up
const CASES = [
  ['na', 'misfire3', 'P0303'], ['na', 'vacleak', 'P0171'], ['na', 'o2', 'P0134'], ['na', 'cat', 'P0420'],
  ['na', 'cmp', 'P0340'], ['na', 'ckp', 'P0335'], ['na', 'maf', 'P0102'], ['na', 'map', 'P0107'],
  ['na', 'tps', 'P0121'], ['na', 'ect', 'P0118'], ['na', 'iat', 'P0113'], ['na', 'knocksensor', 'P0325'],
  ['na', 'fuelpump', 'P0087', true], ['na', 'thermostat', 'P0128'], ['na', 'alt', 'P0562'],
  ['turbo', 'wgstuck', 'P0234', true], ['turbo', 'boostleak', 'P0299', true],
];

for (const [type, fault, dtc, drive] of CASES) {
  test(`${type}: ${fault} → ${dtc}`, () => {
    const S = started(type);
    run(S, 20);
    S.faults[fault] = true;
    if (drive) { S.gear = 2; S.pedal = 100; run(S, 8); } else run(S, 75);
    assert.ok(S.dtc[dtc], `expected ${dtc}, got [${Object.keys(S.dtc).join(', ')}]`);
  });
}

test('CKP failure stops the engine; CMP failure falls back to batch fire', () => {
  const a = started('na'); a.faults.ckp = true; run(a, 3);
  assert.equal(a.running, false);
  const b = started('na'); b.faults.cmp = true; run(b, 3);
  assert.ok(b.running && b.batch, 'still running in batch mode');
});

test('low oil lights the oil lamp condition', () => {
  const S = started('na'); S.faults.oil = true; run(S, 5);
  assert.ok(S.oilP < 0.45, `oil pressure ${S.oilP.toFixed(2)} bar`);
});

test('misfire: injector 3 is shut off to protect the catalyst, and re-enabled after repair', () => {
  const S = started('na'); run(S, 5);
  S.faults.misfire3 = true; run(S, 10);
  assert.ok(S.dtc.P0303, 'P0303 stored');
  assert.equal(S.injCut[2], true, 'injector 3 cut');
  assert.deepEqual(S.injCut.filter(Boolean).length, 1, 'only cylinder 3 cut');
  S.faults.misfire3 = false; run(S, 1);
  assert.equal(S.injCut[2], false, 'cylinder 3 re-enabled');
});
