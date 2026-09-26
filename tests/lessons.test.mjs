import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECU, run } from './helpers.mjs';

// minimal stand-in for the browser app: everything the lesson scripts touch
function fakeApp() {
  const app = {
    S: ECU.createState('na'), paused: false, dyno: null, pedalBase: 0, stockMode: false, pendingStart: false,
    selectEngine(type) { this.S = ECU.createState(type, this.S); this.S.cal = ECU.makeCal(ECU.ENGINES[type]); },
    setSpeed() {}, togglePause() { this.paused = !this.paused; },
    quickStart() { if (!this.S.ecuOn) { this.S.key = 'ON'; this.pendingStart = true; } else this.S.key = 'START'; },
    ui: { syncControls() {}, setControlsCollapsed() {}, showControls() {}, setDrawer() {} },
  };
  return app;
}

for (const lesson of ECU.LESSONS) {
  test(`lesson "${lesson.id}" runs to completion`, () => {
    const app = fakeApp();
    lesson.setup(app);
    lesson.steps.forEach((st, i) => {
      const ctx = { k0: app.S.knockCount, t0: app.S.t };
      if (st.action) st.action(app);
      if (!st.until) { run(app.S, 0.5); return; }
      let t = 0, ok = false;
      while (t < 120 && !(ok = st.until(app.S, ctx))) {
        run(app.S, 0.25); t += 0.25;
        if (st.doIt && t === 1) st.doIt(app);
        if (app.pendingStart && app.S.bootT > 1.6) { app.S.key = 'START'; app.pendingStart = false; }
      }
      assert.ok(ok, `step ${i + 1} never reached: ${st.wait.en}`);
    });
  });
}

test('every lesson text exists in English and Croatian', () => {
  for (const l of ECU.LESSONS) {
    for (const o of [l.title, l.desc, ...l.steps.map((s) => s.text), ...l.steps.filter((s) => s.wait).map((s) => s.wait)]) {
      assert.ok(o.en && o.hr, `lesson ${l.id}: missing translation`);
    }
  }
});
