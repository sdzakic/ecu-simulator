import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECU, run, started } from './helpers.mjs';

const O = ECU.OBD;

test('every mode 01 PID round-trips through its byte encoding', () => {
  const S = started('na');
  S.gear = 2; S.pedal = 40; run(S, 4);
  const truth = {
    0x05: S.sens.ect, 0x0B: S.sens.map, 0x0C: S.sens.rpm, 0x0D: S.v * 3.6, 0x0E: S.spark, 0x0F: S.sens.iat,
    0x10: S.sens.maf, 0x11: S.throttle, 0x14: S.o2v, 0x42: S.vbat, 0x44: S.lambdaTarget, 0x06: S.stft * 100,
  };
  const tol = { 0x05: 1, 0x0B: 1, 0x0C: 0.25, 0x0D: 1, 0x0E: 0.5, 0x0F: 1, 0x10: 0.01, 0x11: 0.4, 0x14: 0.005, 0x42: 0.001, 0x44: 0.0001, 0x06: 0.8 };
  for (const [pid, v] of Object.entries(truth)) {
    const x = O.mode01(S, +pid);
    assert.ok(Math.abs(x.value - v) <= tol[pid], `PID ${O.hex(+pid)}: decoded ${x.value} vs actual ${v}`);
    assert.match(x.resp, new RegExp(`^41 ${O.hex(+pid)}( [0-9A-F]{2})+$`));
  }
});

test('rpm example from the J1979 formula: 836 rpm → 0D 10', () => {
  const S = started('na');
  S.sens.rpm = 836;
  assert.equal(O.mode01(S, 0x0C).resp, '41 0C 0D 10');
});

test('DTC byte encoding matches SAE J2012 and round-trips', () => {
  assert.deepEqual(O.dtcBytes('P0303'), [0x03, 0x03]);
  assert.deepEqual(O.dtcBytes('P0420'), [0x04, 0x20]);
  assert.deepEqual(O.dtcBytes('P0171'), [0x01, 0x71]);
  for (const code of Object.keys(ECU.DTC_TEXT)) assert.equal(O.dtcFromBytes(...O.dtcBytes(code)), code);
});

test('PID 01: MIL bit and code count follow stored DTCs', () => {
  const S = started('na');
  assert.equal(O.monitorStatus(S)[0], 0);
  S.faults.misfire3 = true; run(S, 10);
  const [A] = O.monitorStatus(S);
  assert.equal(A & 0x80, 0x80, 'MIL on');
  assert.equal(A & 0x7f, Object.keys(S.dtc).length);
});

test('PID 03 fuel system status: open loop cold, closed loop warm', () => {
  const S = ECU.createState('na');
  S.key = 'ON'; run(S, 0.5); S.key = 'START'; run(S, 2);
  assert.equal(O.fuelStatus(S), 1, 'open loop while cold');
  run(S, 40);
  assert.equal(O.fuelStatus(S), 2, 'closed loop when warm');
});

test('readiness monitors complete after driving and reset when codes are cleared', () => {
  const S = started('na');
  assert.equal(S.monitors.cat, false);
  run(S, 60);
  for (const k of ['fuel', 'o2', 'o2heater', 'cat']) assert.ok(S.monitors[k], `${k} monitor complete`);
  ECU.clearDTC(S);
  assert.equal(S.monitors.cat, false, 'catalyst monitor incomplete after clearing');
  assert.equal(S.monitors.misfire, true, 'continuous monitors stay complete');
  const [, , , D] = O.monitorStatus(S);
  assert.ok(D & 1, 'PID 01 byte D flags the catalyst monitor incomplete');
});

test('freeze frame captures conditions at the first code and is cleared with codes', () => {
  const S = started('na');
  assert.equal(S.freeze, null);
  S.faults.maf = true; run(S, 3);
  assert.ok(S.freeze, 'freeze frame stored');
  assert.equal(S.freeze.code, 'P0102');
  assert.ok(S.freeze.rpm > 500);
  const first = S.freeze.code;
  S.faults.ect = true; run(S, 2);
  assert.equal(S.freeze.code, first, 'only the first code triggers the freeze frame');
  ECU.clearDTC(S);
  assert.equal(S.freeze, null);
});

test('scan tool reads the ECU view: a dead ECT reads −40 °C', () => {
  const S = started('na'); S.faults.ect = true; run(S, 1);
  assert.equal(O.mode01(S, 0x05).value, -40);
});
