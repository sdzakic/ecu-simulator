import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECU, run, started } from './helpers.mjs';

function pull(type, opts = {}, prep) {
  const S = started(type, { octane: opts.octane || 95 });
  if (prep) prep(S);
  ECU.startDyno(S, { rate: opts.rate || 400 });
  let guard = 0;
  while (S.dyno.phase !== 'done' && S.dyno.phase !== 'aborted' && guard++ < 400) run(S, 0.1);
  return S.dyno;
}
const at = (d, rpm) => d.samples.reduce((b, x) => (Math.abs(x.rpm - rpm) < Math.abs(b.rpm - rpm) ? x : b));

test('NA sweep: complete curve, realistic peaks', () => {
  const d = pull('na');
  assert.equal(d.phase, 'done');
  assert.ok(d.samples.length > 90, `${d.samples.length} bins`);
  assert.ok(d.peak.tq > 150 && d.peak.tq < 210, `peak torque ${d.peak.tq.toFixed(0)} Nm`);
  assert.ok(d.peak.kw > 80 && d.peak.kw < 120, `peak power ${d.peak.kw.toFixed(0)} kW`);
  assert.ok(d.peak.kwRpm > d.peak.tqRpm, 'power peaks above the torque peak');
  assert.ok(d.samples.every((x) => Math.abs(x.kw - (x.tq * x.rpm * Math.PI) / 30000) < 0.5), 'kW = Nm × rpm consistency');
});

test('turbo out-torques the NA engine and shows boost in the curve', () => {
  const na = pull('na'), tb = pull('turbo');
  assert.ok(tb.peak.tq > na.peak.tq * 1.5, `turbo ${tb.peak.tq.toFixed(0)} vs NA ${na.peak.tq.toFixed(0)} Nm`);
  assert.ok(at(tb, 4000).boost > 80, 'on boost mid-range');
});

test('fast sweeps expose turbo lag at low rpm', () => {
  const slow = pull('turbo', { rate: 200 }), fast = pull('turbo', { rate: 800 });
  assert.ok(at(slow, 2500).tq > at(fast, 2500).tq + 15, `2500 rpm: slow ${at(slow, 2500).tq.toFixed(0)} vs fast ${at(fast, 2500).tq.toFixed(0)} Nm`);
});

test('low-octane fuel costs turbo torque through knock retard', () => {
  const good = pull('turbo', { octane: 98 }), bad = pull('turbo', { octane: 91 });
  const knocks = (d) => d.samples.reduce((n, x) => n + x.knock, 0);
  assert.equal(knocks(good), 0, '98 RON pull is knock-free');
  assert.ok(knocks(bad) > 3, `91 RON pull knocks (${knocks(bad)} events)`);
  assert.ok(bad.peak.tq < good.peak.tq - 5, `91 RON ${bad.peak.tq.toFixed(0)} vs 98 RON ${good.peak.tq.toFixed(0)} Nm`);
});

test('the pull aborts cleanly if the engine dies', () => {
  const S = started('na');
  ECU.startDyno(S);
  run(S, 2);
  S.faults.ckp = true;
  run(S, 2);
  assert.equal(S.dyno.phase, 'aborted');
});
