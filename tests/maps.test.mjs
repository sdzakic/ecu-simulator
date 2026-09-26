import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECU, run, started } from './helpers.mjs';

test('stock tables have the expected shape; boost only on the turbo', () => {
  const na = ECU.makeCal(ECU.ENGINES.na), tb = ECU.makeCal(ECU.ENGINES.turbo);
  assert.deepEqual(Object.keys(na), ['spark', 'lambda']);
  assert.deepEqual(Object.keys(tb), ['spark', 'lambda', 'boost']);
  for (const t of [na.spark, na.lambda, tb.spark, tb.boost]) {
    assert.equal(t.z.length, t.y.length);
    t.z.forEach((row) => assert.equal(row.length, t.x.length));
    assert.deepEqual(t.z, t.base);
  }
});

test('bilinear interpolation hits cell values and midpoints', () => {
  const t = { x: [0, 10], y: [0, 10], z: [[0, 10], [20, 30]] };
  assert.equal(ECU.interp2(t, 0, 0), 0);
  assert.equal(ECU.interp2(t, 10, 10), 30);
  assert.equal(ECU.interp2(t, 5, 5), 15);
  assert.equal(ECU.interp2(t, -50, 99), 20, 'clamped at edges');
});

test('over-advancing the spark map causes knock that knock control pulls back', () => {
  const pull = (S) => { S.gear = 3; S.pedal = 100; S.grade = 8; S.v = 12; const k0 = S.knockCount; run(S, 6); return S.knockCount - k0; };
  const stock = started('na');
  assert.equal(pull(stock), 0, 'stock map does not knock');
  const S = started('na');
  const t = S.cal.spark;
  t.z = t.z.map((row, j) => row.map((v, i) => (t.x[i] >= 1000 && t.x[i] <= 3000 && t.y[j] >= 70 ? v + 8 : v)));
  const knocks = pull(S);
  assert.ok(knocks > 5, `edited map knocks (${knocks})`);
  assert.ok(S.spark < S.sparkMap - 2, 'final advance retarded below the map');
});

test('a lean λ cell switches to open-loop lean cruise', () => {
  const S = started('na');
  const t = S.cal.lambda;
  t.z = t.z.map((row, j) => row.map((v, i) => (t.x[i] >= 1500 && t.x[i] <= 4000 && t.y[j] >= 20 && t.y[j] <= 60 ? 1.1 : v)));
  S.gear = 3; S.pedal = 18;
  run(S, 12);
  assert.equal(S.closedLoop, false);
  assert.equal(S.olReason.k, 'lean cruise (from the λ map)');
  assert.ok(S.lambda > 1.05, `running lean (λ ${S.lambda.toFixed(2)})`);
});

test('raising the boost map raises boost and torque', () => {
  const pull = (S) => { S.gear = 3; S.pedal = 100; S.v = 15; let peak = 0; run(S, 10, (s) => { peak = Math.max(peak, s.torque); }); return peak; };
  const stock = pull(started('turbo'));
  const S = started('turbo', { octane: 98 });
  const t = S.cal.boost;
  t.z = t.z.map((row, j) => row.map((v, i) => (t.x[i] >= 3000 && t.y[j] >= 80 ? 1.4 : v)));
  const raised = pull(S);
  assert.ok(raised > stock + 30, `more torque with more boost (${stock.toFixed(0)} → ${raised.toFixed(0)} Nm)`);
});
