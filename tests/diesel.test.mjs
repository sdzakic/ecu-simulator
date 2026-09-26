import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECU, run, started } from './helpers.mjs';

const cold = (temp) => { const S = ECU.createState('diesel'); S.ambient = temp; S.ect = S.oilT = S.iat = S.chargeT = temp; return S; };
function crank(S, maxSec = 8) { S.key = 'START'; let t = 0; while (!S.running && t < maxSec) { run(S, 0.1); t += 0.1; } return t; }

test('warm start: syncs, idles ~800 rpm lean (λ > 3) with EGR open, no codes', () => {
  const S = started('diesel');
  run(S, 10);
  assert.ok(S.running && S.sync === 2);
  assert.ok(Math.abs(S.rpm - 800) < 80, `idle ${S.rpm.toFixed(0)} rpm`);
  assert.ok(S.lambda > 3, `idle λ ${S.lambda.toFixed(2)}`);
  assert.ok(S.egrPos > 0.2, 'EGR open at idle');
  assert.ok(S.qMg > 2 && S.qMg < 8, `idle fuel ${S.qMg.toFixed(1)} mg`);
  assert.equal(S.throttle > 95, true, 'no throttling');
  assert.deepEqual(Object.keys(S.dtc), []);
});

test('cold start: pre-glow at −10 °C; with dead glow plugs it cranks long and rough', () => {
  const ok = cold(-10);
  ok.key = 'ON'; run(ok, 0.3);
  assert.equal(ok.glowPhase, 'pre');
  const pre = ok.glowT; run(ok, pre + 0.3);
  const tOk = crank(ok);
  assert.ok(ok.running && tOk < 1.5, `glowed start in ${tOk.toFixed(1)} s`);

  const bad = cold(-10); bad.faults.glowplug = true;
  bad.key = 'ON'; run(bad, 0.3); run(bad, bad.glowT + 0.3);
  assert.ok(bad.dtc.P0670, 'glow plug circuit fault found at key-on');
  const tBad = crank(bad);
  assert.ok(tBad > tOk * 2, `dead glow plugs: ${tBad.toFixed(1)} s vs ${tOk.toFixed(1)} s`);
});

test('full throttle: smoke limiter during spool-up, then ~330 Nm / ~110 kW at λ ≥ 1.2', () => {
  const S = started('diesel');
  S.gear = 3; S.pedal = 100;
  let sawSmoke = false, peakT = 0, peakKw = 0, minLam = 9;
  run(S, 12, (s) => { if (s.limiter === 'smoke') sawSmoke = true; peakT = Math.max(peakT, s.torque); peakKw = Math.max(peakKw, s.power); if (s.qMg > 20) minLam = Math.min(minLam, s.lambda); });
  assert.ok(sawSmoke, 'smoke limiter engaged');
  assert.ok(peakT > 290 && peakT < 380, `peak ${peakT.toFixed(0)} Nm`);
  assert.ok(peakKw > 95 && peakKw < 125, `peak ${peakKw.toFixed(0)} kW`);
  assert.ok(minLam > 1.1, `never richer than the smoke limit (λ ${minLam.toFixed(2)})`);
  assert.equal(S.overboostCut, false);
  assert.deepEqual(Object.keys(S.dtc), []);
});

test('overrun cut: foot off at speed → zero injection', () => {
  const S = started('diesel');
  S.gear = 3; S.pedal = 60; run(S, 8);
  S.pedal = 0; run(S, 1);
  assert.equal(S.limiter, 'cut');
  assert.equal(S.qMg, 0);
});

test('EGR lowers NOx at idle (vs a stuck-closed valve)', () => {
  const a = started('diesel'); run(a, 10);
  const b = started('diesel'); b.faults.egrclosed = true; run(b, 10);
  assert.ok(a.nox < b.nox * 0.8, `NOx with EGR ${a.nox.toFixed(0)} vs without ${b.nox.toFixed(0)} ppm`);
});

test('DPF: soot builds while driving, active regeneration burns it off', () => {
  const S = started('diesel');
  S.soot = S.sootEst = 21;
  S.gear = 3; S.pedal = 45;
  let t = 0;
  while (!S.regen && t < 120) { run(S, 1); t++; }
  assert.ok(S.regen, `regeneration started after ${t} s at ${S.sootEst.toFixed(1)} g`);
  let peakT = 0;
  while (S.regen && t < 300) { run(S, 1, (s) => { peakT = Math.max(peakT, s.dpfT); }); t++; }
  assert.equal(S.regen, false, 'regeneration finished');
  assert.ok(peakT > 560, `DPF reached ${peakT.toFixed(0)} °C`);
  assert.ok(S.soot < 8, `soot burnt down to ${S.soot.toFixed(1)} g`);
  assert.ok(S.monitors.pm, 'PM filter monitor complete');
});

for (const [fault, code, drive] of [['glowplug', 'P0670'], ['egropen', 'P0402'], ['egrclosed', 'P0401'], ['injleak3', 'P0093'], ['dpfclog', 'P2463', true], ['vgtstuck', 'P0234', true], ['fuelpump', 'P0087', true], ['maf', 'P0102'], ['ckp', 'P0335']]) {
  test(`diesel fault ${fault} → ${code}`, () => {
    const S = started('diesel');
    run(S, 5);
    S.faults[fault] = true;
    if (fault === 'glowplug') { S.key = 'OFF'; run(S, 0.5); S.key = 'ON'; run(S, 0.5); }
    if (drive) { S.gear = 3; S.pedal = 100; S.v = 15; run(S, 12); } else run(S, 30);
    assert.ok(S.dtc[code], `expected ${code}, got [${Object.keys(S.dtc).join(', ')}]`);
  });
}

test('diesel OBD: rail pressure / EGR / timing PIDs round-trip, compression-ignition monitor bit', () => {
  const S = started('diesel'); run(S, 5);
  const O = ECU.OBD;
  assert.ok(Math.abs(O.mode01(S, 0x23).value - S.rail * 100) <= 10, 'rail pressure in kPa');
  assert.ok(Math.abs(O.mode01(S, 0x2C).value - S.egrCmd * 100) <= 0.5, 'commanded EGR');
  assert.ok(Math.abs(O.mode01(S, 0x5D).value - S.soi) <= 0.01, 'injection timing');
  assert.equal(O.monitorStatus(S)[1] & 0x08, 0x08, 'PID 01 byte B bit 3 = compression ignition');
  assert.ok(O.PIDS.filter((p) => ECU.appliesTo(p, 'diesel')).every((p) => p.pid !== 0x14), 'no narrowband O2 PID on the diesel');
});

test('diesel maps drive the ECU: more driver’s wish = more fuel (until a limiter)', () => {
  const S = started('diesel'); run(S, 5);
  S.gear = 3; S.pedal = 30; run(S, 6);
  const q0 = S.qMg;
  const t = S.cal.quantity; t.z = t.z.map((row) => row.map((v) => v * 1.3));
  run(S, 2);
  assert.ok(S.qMg > q0 * 1.15, `${q0.toFixed(1)} → ${S.qMg.toFixed(1)} mg`);
});

test('diesel dyno pull and clatter', () => {
  const S = started('diesel');
  ECU.startDyno(S);
  let g = 0; while (S.dyno.phase !== 'done' && g++ < 400) run(S, 0.1);
  assert.equal(S.dyno.phase, 'done');
  assert.ok(S.dyno.peak.tq > 290, `dyno peak ${S.dyno.peak.tq.toFixed(0)} Nm`);
  assert.ok(S.dyno.peak.kwRpm < 4800, 'power peaks below the diesel redline');
  const idle = started('diesel'); run(idle, 3);
  assert.ok(ECU.soundParams(idle).clatter > 0.02, 'diesel clatter at idle');
  assert.equal(ECU.soundParams(started('na')).clatter, 0, 'no clatter on the petrol engine');
});
