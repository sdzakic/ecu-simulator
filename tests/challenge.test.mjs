import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECU, run, started } from './helpers.mjs';

const CH = ECU.CHALLENGE;

test('every fault has a challenge case with complaint and two hints in both languages', () => {
  for (const f of ECU.FAULTS) {
    const c = CH.CASES[f.id];
    assert.ok(c, `missing case for ${f.id}`);
    for (const o of [c.complaint, ...c.hints]) assert.ok(o.en && o.hr, `${f.id}: missing translation`);
    assert.equal(c.hints.length, 2);
    assert.equal(!!c.turbo, !!f.turboOnly, `${f.id}: turbo flag matches the fault`);
  }
});

test('turbo-only faults are never offered on the NA engine', () => {
  const na = CH.applicable('na'), tb = CH.applicable('turbo');
  assert.ok(!na.includes('wgstuck') && !na.includes('boostleak'));
  assert.ok(tb.includes('wgstuck') && tb.includes('boostleak'));
  assert.equal(tb.length, na.length + 2);
});

test('answer options: include the fault, are unique and sized by difficulty', () => {
  let seed = 7; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const type of ['na', 'turbo']) {
    for (const fault of CH.applicable(type)) {
      for (const [diff, n] of [['easy', 4], ['medium', 6], ['hard', CH.applicable(type).length]]) {
        const opts = CH.makeOptions(fault, type, diff, rng);
        assert.equal(opts.length, n, `${type}/${fault}/${diff}`);
        assert.ok(opts.includes(fault));
        assert.equal(new Set(opts).size, opts.length, 'no duplicates');
        opts.forEach((id) => assert.ok(CH.applicable(type).includes(id)));
      }
    }
  }
});

test('scoring: full marks when quick and unaided; penalties add up; never negative', () => {
  assert.equal(CH.score({ seconds: 30 }), 100);
  assert.equal(CH.score({ seconds: 30, hints: 1 }), 85);
  assert.equal(CH.score({ seconds: 30, codesRead: true, wrong: 1 }), 55);
  assert.equal(CH.score({ seconds: 160 }), 90, '−1 per 10 s after the first minute');
  assert.equal(CH.score({ seconds: 9999 }), 70, 'time penalty capped at 30');
  assert.equal(CH.score({ seconds: 9999, hints: 2, codesRead: true, wrong: 2 }), 0);
  assert.equal(CH.score({ solved: false }), 0);
});

// each case must be diagnosable: its fault leaves a measurable trace within a normal investigation
test('every challenge fault produces an observable symptom', () => {
  const symptom = {
    oil: (S) => S.oilP < 0.45,
    ckp: (S) => !S.running,
  };
  for (const type of ['na', 'turbo']) {
    for (const id of CH.applicable(type)) {
      if (type === 'turbo' && !CH.CASES[id].turbo) continue; // NA-side faults are covered on the NA engine
      const S = started(type);
      S.faults[id] = true;
      run(S, 20);
      if (['fuelpump', 'wgstuck', 'boostleak'].includes(id)) { S.gear = 2; S.pedal = 100; run(S, 8); }
      else run(S, 60);
      const ok = symptom[id] ? symptom[id](S) : Object.keys(S.dtc).length > 0;
      assert.ok(ok, `${type}/${id}: no observable symptom`);
    }
  }
});
