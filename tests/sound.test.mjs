import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECU, run, started } from './helpers.mjs';

const P = (S) => ECU.soundParams(S);

test('silent with the engine off; fuel pump buzzes during the key-on prime', () => {
  const S = ECU.createState('na');
  let p = P(S);
  assert.equal(p.engine, 0); assert.equal(p.rumble, 0); assert.equal(p.pump, 0);
  S.key = 'ON'; run(S, 0.5);
  p = P(S);
  assert.ok(p.pump > 0, 'prime buzz'); assert.equal(p.engine, 0);
});

test('starter whine while cranking, gone once running', () => {
  const S = ECU.createState('na');
  S.key = 'ON'; run(S, 0.5); S.key = 'START'; run(S, 0.3);
  assert.ok(P(S).starter > 0);
  run(S, 4);
  assert.equal(P(S).starter, 0);
});

test('firing frequency is rpm/30 (4 cylinders, 2 combustions per revolution)', () => {
  const S = started('na');
  const p = P(S);
  assert.ok(Math.abs(p.fire - S.rpm / 30) < 1e-9);
  assert.ok(p.fire > 24 && p.fire < 32, `idle firing ${p.fire.toFixed(1)} Hz`);
  assert.ok(Math.abs(p.cycle - S.rpm / 120) < 1e-9);
});

test('full throttle is louder and brighter than idle', () => {
  const S = started('na');
  const idle = P(S);
  S.gear = 2; S.pedal = 100; run(S, 2);
  const wot = P(S);
  assert.ok(wot.engine > idle.engine * 1.5, `engine gain ${idle.engine.toFixed(2)} → ${wot.engine.toFixed(2)}`);
  assert.ok(wot.cutoff > idle.cutoff * 2);
  assert.ok(wot.intake > idle.intake * 3);
});

test('fuel cut (rev limiter / DFCO) drops the combustion sound', () => {
  const S = started('na');
  S.pedal = 100;
  let cut = null;
  run(S, 4, (s) => { if (s.revCut && s.fuelCutAll && !cut) cut = P(s); });
  assert.ok(cut, 'rev limiter reached');
  assert.equal(cut.rumble, 0);
  assert.ok(cut.engine < 0.1);
});

test('misfire adds a per-cycle beat', () => {
  const S = started('na');
  assert.equal(P(S).misfire, 0);
  S.faults.misfire3 = true; run(S, 1);
  assert.ok(P(S).misfire > 0.2);
});

test('turbo whistle only on the turbo engine, rising with shaft speed', () => {
  const na = started('na'); na.gear = 3; na.pedal = 100; na.v = 15; run(na, 6);
  assert.equal(P(na).turbo, 0);
  const tb = started('turbo');
  const idle = P(tb);
  tb.gear = 3; tb.pedal = 100; tb.v = 15; run(tb, 6);
  const boost = P(tb);
  assert.ok(boost.turbo > idle.turbo && boost.turbo > 0.03);
  assert.ok(boost.turboFreq > idle.turboFreq + 2000);
});
