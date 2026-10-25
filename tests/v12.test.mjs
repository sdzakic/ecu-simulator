import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECU, DT, run, started } from './helpers.mjs';

test('V12 geometry: 12 cylinders, one firing every 60° in firing order', () => {
  const G = ECU.geom(ECU.ENGINES.v12);
  assert.equal(G.n, 12);
  assert.deepEqual([...G.off].sort((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i * 60));
  G.order.forEach((cyl, i) => assert.equal(G.off[cyl - 1], i * 60, `cyl ${cyl}`));
  const S = ECU.createState('v12');
  for (const k of ['sparkCyl', 'knockRetard', 'injCut', 'lambdaCyl', 'crankJitter']) assert.equal(S[k].length, 12, k);
});

test('V12 idles smoothly, closes the loop and sets no codes', () => {
  const S = started('v12');
  run(S, 20);
  assert.ok(Math.abs(S.rpm - 900) < 60, `idle ${S.rpm}`);
  assert.ok(S.closedLoop);
  assert.ok(Math.abs(S.stft + S.ltft) < 0.08);
  assert.deepEqual(Object.keys(S.dtc), []);
});

test('V12 dyno: ~650 Nm, ~540 kW near the 9200 rpm limit, no knock on stock maps', () => {
  const S = started('v12');
  run(S, 3);
  ECU.startDyno(S, {});
  const k0 = S.knockCount;
  for (let i = 0; i < 60 / DT && !['done', 'aborted'].includes(S.dyno.phase); i++) ECU.step(S, DT);
  const p = S.dyno.peak;
  assert.equal(S.dyno.phase, 'done');
  assert.ok(p.tq > 600 && p.tq < 720, `torque ${p.tq}`);
  assert.ok(p.kw > 480 && p.kw < 600 && p.kwRpm > 8000, `power ${p.kw} kW @ ${p.kwRpm}`);
  assert.equal(S.knockCount - k0, 0);
  assert.ok(S.injDuty < 0.85);
});

test('V12 misfire on cylinder 3 is found and that injector cut', () => {
  const S = started('v12');
  S.faults.misfire3 = true;
  run(S, 25);
  assert.ok(S.dtc.P0303);
  assert.equal(S.injCut[2], true);
  assert.equal(S.injCut.filter(Boolean).length, 1);
});

test('automatic: creeps in D, upshifts at full throttle, locks up when cruising, kicks down', () => {
  const S = started('na');
  S.trans = 'auto'; S.sel = 'D';
  run(S, 3);
  assert.equal(S.gear, 1);
  assert.ok(S.v > 0.5, 'creeps without throttle');
  S.pedal = 100;
  let maxGear = 1;
  run(S, 18, (s) => { maxGear = Math.max(maxGear, s.gear); });
  assert.ok(maxGear >= 4, `reached gear ${maxGear}`);
  assert.ok(S.rpm < S.E.redline, 'shifted before the limiter');
  S.pedal = 20; run(S, 10);
  assert.ok(S.gear >= 6 && S.lockCap > 0 && S.clutchLocked, `cruise gear ${S.gear}, lock-up ${S.lockCap}`);
  const g = S.gear;
  S.pedal = 100; run(S, 0.5);
  assert.ok(S.gear <= g - 2, `kickdown ${g} → ${S.gear}`);
  S.pedal = 0; S.brake = true; run(S, 20);
  assert.ok(S.v < 0.1 && S.gear === 1 && S.running, 'stops in 1st without stalling');
});

test('manual: pulls away gently in 1st and never stalls when braking to a stop in gear', () => {
  for (const type of ['na', 'diesel', 'v12']) {
    const S = started(type);
    S.gear = 1; S.pedal = 15; run(S, 4);
    assert.ok(S.running && S.v > 2, `${type}: pulled away (${S.v.toFixed(1)} m/s)`);
    assert.equal(S.clutchState, 'locked');
    S.gear = 2; S.pedal = 60; run(S, 4);
    assert.equal(S.clutchState, 'locked');
    S.pedal = 0; S.brake = true; run(S, 12);
    assert.ok(S.v < 0.1 && S.running, `${type}: stopped in gear without stalling`);
  }
});

test('V12 sound fires at rpm / 10 and gets its howl', () => {
  const S = started('v12');
  S.gear = 2; S.pedal = 100; S.v = 15; run(S, 2);
  const p = ECU.soundParams(S);
  assert.ok(Math.abs(p.fire - S.rpm / 10) < 1e-6);
  assert.ok(p.howl > 0.05);
  assert.equal(ECU.soundParams(started('na')).howl, 0);
});

test('oscilloscope on the V12: coil 12 fires once per cycle, injections 60° apart', () => {
  const TS = ECU.TSCOPE;
  const S = started('v12');
  const cap = new TS.Capture();
  for (let i = 0; i < 2 / DT; i++) { ECU.step(S, DT); cap.push(S); }
  const [, tNow] = cap.span();
  const m = TS.measure(TS.trace(cap, 'coil', 11, tNow - 0.41, 0.4, 6000), TS.SIGNALS.coil.pulse());
  assert.ok(Math.abs(m.freq * 120 - S.rpm) / S.rpm < 0.1, `coil 12 freq ${m.freq}`);
  // injector 1 and 7 (next in the firing order) are 60° of crank apart
  const p = new TS.Probe(cap);
  const firstLow = (cyl) => { for (let t = tNow - 0.3; t < tNow - 0.01; t += 2e-5) if (p.value('inj', cyl, t) < 1) return t; return null; };
  const t1 = firstLow(0), t7 = firstLow(6);
  const deg = (((t7 - t1) * S.rpm * 6) % 720 + 720) % 720;
  assert.ok(Math.abs(deg - 60) < 6 || Math.abs(deg - 780 + 720) < 6, `1→7 spacing ${deg.toFixed(0)}°`);
});
