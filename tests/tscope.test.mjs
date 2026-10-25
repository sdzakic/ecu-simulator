import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECU, DT, started } from './helpers.mjs';

const TS = ECU.TSCOPE;
// run the sim while capturing every physics step, as the browser loop does
function capture(S, sec, cap = new TS.Capture()) {
  for (let i = 0; i < sec / DT; i++) { ECU.step(S, DT); cap.push(S); }
  return cap;
}
const lastWindow = (cap, W) => { const [, tNow] = cap.span(); return tNow - W - 0.01; };

test('CKP tooth frequency ≈ rpm and CMP gives one pulse per cycle', () => {
  const S = started('na');
  const cap = capture(S, 3);
  const W = 0.2, t0 = lastWindow(cap, W);
  const ckp = TS.measure(TS.trace(cap, 'ckp', 0, t0, W, 4000));
  assert.ok(Math.abs(ckp.freq - S.rpm) / S.rpm < 0.08, `tooth freq ${ckp.freq} vs ${S.rpm} rpm`);
  assert.ok(ckp.vmax > 2 && ckp.vmax < 10, `VR amplitude at idle ${ckp.vmax}`);
  const cmp = TS.measure(TS.trace(cap, 'cmp', 0, t0 - 0.4, 0.6, 3000));
  assert.ok(Math.abs(cmp.freq * 120 - S.rpm) / S.rpm < 0.1, `cam freq ${cmp.freq}`);
  assert.equal(Math.round(cmp.vmax), 5);
});

test('injector: low pulse ≈ commanded pulse width, flyback spike, pintle hump', () => {
  const S = started('na');
  const cap = capture(S, 3);
  const W = 0.4, t0 = lastWindow(cap, W);
  const m = TS.measure(TS.trace(cap, 'inj', 0, t0, W, 8000), TS.SIGNALS.inj.pulse(false));
  assert.ok(m.vmax > 60, `flyback ${m.vmax}`);
  assert.ok(m.vmin < 1);
  assert.ok(Math.abs(m.pulse * 1000 - S.pw) < 0.25, `pulse ${m.pulse * 1000} ms vs pw ${S.pw}`);
  assert.ok(Math.abs(m.freq * 120 - S.rpm) / S.rpm < 0.1, 'one injection per cycle');
});

test('coil primary: dwell, ~400 V spike and burn line; a dead coil has no burn line', () => {
  const burnTime = (S, cyl) => {
    const cap = capture(S, 1);
    const p = new TS.Probe(cap), [, tNow] = cap.span();
    let burn = 0, peak = 0;
    const step = 5e-6;
    for (let t = tNow - 0.3; t < tNow - 0.01; t += step) {
      const v = p.value('coil', cyl, t);
      peak = Math.max(peak, v);
      if (v > 33 && v < 50) burn += step;
    }
    return { burn: burn / (0.29 * S.rpm / 120), peak }; // per firing
  };
  const S = started('na');
  const ok = burnTime(S, 2);
  assert.ok(ok.peak > 300, `spike ${ok.peak}`);
  assert.ok(ok.burn > 0.0009 && ok.burn < 0.0016, `burn line ${ok.burn}`);
  {
    const cap = capture(S, 1), [, tNow] = cap.span();
    const m = TS.measure(TS.trace(cap, 'coil', 0, tNow - 0.31, 0.3, 6000), TS.SIGNALS.coil.pulse());
    assert.ok(Math.abs(m.pulse * 1000 - S.dwell) < 0.2, `dwell ${m.pulse * 1000} vs ${S.dwell} ms`);
  }
  S.faults.misfire3 = true;
  const dead = burnTime(S, 2);
  assert.ok(dead.burn < 0.0002, `dead coil burn ${dead.burn}`);
  assert.ok(dead.peak > 300, 'still rings');
});

test('trigger lands on a real rising edge of the cam signal', () => {
  const S = started('na');
  const cap = capture(S, 2);
  const [, tNow] = cap.span();
  const tt = TS.findTrigger(cap, 'cmp', 0, 2.5, 'rise', tNow - 0.5, tNow - 0.02, 1e-4);
  assert.ok(tt != null);
  const p = new TS.Probe(cap);
  assert.ok(p.value('cmp', 0, tt - 2e-5) < 2.5 && p.value('cmp', 0, tt + 2e-5) >= 2.5);
});

test('cranking battery dips at every compression; charging ripple when running', () => {
  const S = ECU.createState('na');
  S.ect = 88; S.oilT = 90;
  const cap = new TS.Capture();
  S.key = 'ON'; capture(S, 0.5, cap);
  S.key = 'START'; capture(S, 0.35, cap);
  const [, t1] = cap.span();
  const crank = TS.measure(TS.trace(cap, 'vbat', 0, t1 - 0.2, 0.2, 2000));
  assert.ok(crank.vmax < 11.5 && crank.pp > 0.4, `cranking ${crank.vmin}–${crank.vmax}`);
  capture(S, 4, cap);
  const [, t2] = cap.span();
  const run = TS.measure(TS.trace(cap, 'vbat', 0, t2 - 0.02, 0.02, 2000));
  assert.ok(run.vmin > 13.4 && run.pp > 0.05 && run.pp < 0.3, `charging ${run.vmin}–${run.vmax}`);
});

test('diesel: piezo pulses around 145 V and a rail signal with injection dips', () => {
  const S = started('diesel');
  const cap = capture(S, 3);
  const W = 0.3, t0 = lastWindow(cap, W);
  const inj = TS.measure(TS.trace(cap, 'inj', 0, t0, W, 6000), TS.SIGNALS.inj.pulse(true));
  assert.ok(inj.vmax > 140 && inj.vmin === 0, `piezo ${inj.vmin}–${inj.vmax}`);
  assert.ok(inj.pulse > 0.0002 && inj.pulse < 0.002, `piezo pulse ${inj.pulse}`);
  const rail = TS.measure(TS.trace(cap, 'rail', 0, t0, W, 3000));
  const bar = ((rail.vmax - 0.5) * 2200) / 4;
  assert.ok(Math.abs(bar - S.rail) < 60, `rail ${bar} vs ${S.rail}`);
  assert.ok(rail.pp > 0.05, 'dips visible');
});

test('knock events show up as a ringing burst on the knock sensor', () => {
  const S = started('turbo', { octane: 91 });
  S.cal.spark.z = S.cal.spark.z.map((row) => row.map((v) => v + 10)); // way past the knock limit
  S.gear = 3; S.pedal = 100; S.v = 15;
  const cap = capture(S, 4);
  assert.ok(cap.events.length > 0, 'knock captured');
  const e = cap.events[cap.events.length - 1];
  const p = new TS.Probe(cap);
  const peak = (a, b) => { let m = 0; for (let t = a; t < b; t += 5e-6) m = Math.max(m, Math.abs(p.value('knock', 0, t))); return m; };
  const ring = peak(e.t, e.t + 0.001), before = peak(e.t - 0.0025, e.t - 0.0015);
  assert.ok(ring > 0.25 && ring > 2.5 * before, `ring ${ring} vs background ${before}`);
});
