import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECU, run, started } from './helpers.mjs';

test('cold start: sync, idle, warm-up into closed loop', () => {
  const S = ECU.createState('na');
  S.key = 'ON'; run(S, 0.5);
  assert.equal(S.ecuOn, true);
  S.key = 'START'; run(S, 3);
  assert.equal(S.sync, 2, 'full crank + cam sync');
  assert.ok(S.running, 'engine running');
  assert.equal(S.key, 'ON', 'starter released after start');
  run(S, 40);
  assert.ok(S.closedLoop, 'closed loop after warm-up');
  assert.ok(Math.abs(S.rpm - 800) < 80, `warm idle ~800 rpm (got ${S.rpm.toFixed(0)})`);
  assert.ok(Math.abs(S.lambda - 1) < 0.06, `stoichiometric at idle (λ ${S.lambda.toFixed(2)})`);
});

test('O2 sensor switches ~0.5–2 Hz in closed loop', () => {
  const S = started('na');
  run(S, 20);
  assert.ok(S.closedLoop);
  assert.ok(S.o2Freq > 0.4 && S.o2Freq < 2.5, `O2 frequency ${S.o2Freq}`);
});

test('NA full throttle: power enrichment and plausible torque', () => {
  const S = started('na');
  S.gear = 2; S.pedal = 100;
  let peak = 0;
  run(S, 6, (s) => { peak = Math.max(peak, s.torque); });
  assert.ok(S.lambdaTarget < 0.9, 'rich target at WOT');
  assert.ok(peak > 140 && peak < 210, `NA peak torque ${peak.toFixed(0)} Nm`);
});

test('turbo holds the boost target with the wastegate', () => {
  const S = started('turbo');
  S.gear = 3; S.pedal = 100; S.v = 15;
  let peak = 0;
  run(S, 8, (s) => { peak = Math.max(peak, s.torque); });
  const boost = (S.boostP - S.baro) / 100;
  assert.ok(Math.abs(boost - 1.0) < 0.15, `boost ${boost.toFixed(2)} bar`);
  assert.ok(S.wgPos > 0.2 && S.wgPos < 0.95, `wastegate modulating (${S.wgPos.toFixed(2)})`);
  assert.ok(peak > 280 && peak < 400, `turbo peak torque ${peak.toFixed(0)} Nm`);
  assert.equal(S.overboostCut, false);
});

test('rev limiter and decel fuel cut', () => {
  const S = started('na');
  S.pedal = 100;
  let limited = false;
  run(S, 4, (s) => { if (s.revCut) limited = true; });
  assert.ok(limited, 'rev limiter engaged in neutral');
  assert.ok(S.rpm < S.E.redline + 150, 'rpm held near redline');
  S.pedal = 0;
  let dfco = false;
  run(S, 2, (s) => { if (s.dfco) dfco = true; });
  assert.ok(dfco, 'DFCO when lifting above 1700 rpm');
});

test('knock: low octane knocks and gets retarded, high octane does not', () => {
  const pull = (octane) => {
    const S = started('na', { octane });
    S.gear = 4; S.pedal = 100; S.grade = 10;
    const k0 = S.knockCount;
    run(S, 12);
    return { knocks: S.knockCount - k0, retard: Math.max(...S.knockRetard) };
  };
  const low = pull(91), high = pull(98);
  assert.ok(low.knocks > 5 && low.retard > 1, `91 RON knocks (${low.knocks}, −${low.retard.toFixed(1)}°)`);
  assert.equal(high.knocks, 0, '98 RON does not knock');
});

test('a zero or negative dt step is ignored (no NaN poisoning)', () => {
  const S = started('na');
  ECU.step(S, 0);
  ECU.step(S, -0.01);
  run(S, 0.5);
  assert.ok(Number.isFinite(S.rpm) && S.rpm > 500);
});
