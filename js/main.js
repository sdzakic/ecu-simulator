/* App state + animation loop. Physics runs in real time; crank-angle views run in slow motion. */
(function () {
  const ECU = window.ECU;
  const $ = (s) => document.querySelector(s);
  const PHYS_DT = 1 / 240;

  const app = {
    S: ECU.createState('na'),
    speed: 'auto',
    paused: false,
    theta: 0,
    pedalBase: 0,
    wHeld: false,

    setEngine(type) {
      const prev = this.S;
      this.S = ECU.createState(type, prev);
      this.S.cal = this.calFor(type);
      document.body.classList.toggle('is-turbo', type === 'turbo');
      ECU.log(this.S, 'Engine swapped: {label}. {detail}', 'info', {
        label: { k: this.S.E.label },
        detail: { k: type === 'turbo' ? 'Lower compression (9.6:1), bigger injectors (440 cc), turbo + intercooler, wastegate & blow-off valve.' : 'Higher compression (11:1), 240 cc injectors, no boost — MAP never exceeds atmospheric.' },
      });
      this.pedalBase = 0;
      document.querySelectorAll('#acBtn,#lightsBtn').forEach((b) => b.classList.toggle('on', !!this.S[b.id === 'acBtn' ? 'ac' : 'lights']));
    },
    // language switched: views that bake text into DOM/SVG get rebuilt
    relabel() {
      const sel = this.ui.selected;
      this.diagram = new ECU.DiagramView($('#diagramWrap'), (id) => this.ui.openSensor(id));
      if (sel && sel.type === 's') this.diagram.select(sel.id);
      $('#pauseBtn span').textContent = ECU.t(this.paused ? 'Resume' : 'Pause');
      this.ui.renderBrain(this.S);
      this.maps.relabel();
      this.dyno.relabel();
    },
    // ---------- calibration maps: user-edited per engine, saved in the browser ----------
    calStore: {},
    stockMode: false,
    calFor(type) {
      if (this.stockMode) return ECU.makeCal(ECU.ENGINES[type]);
      if (!this.calStore[type]) {
        const cal = ECU.makeCal(ECU.ENGINES[type]);
        try {
          const saved = JSON.parse(localStorage.getItem('ecu-cal-v1') || '{}')[type] || {};
          for (const k in saved) {
            const t = cal[k];
            if (t && saved[k].length === t.z.length && saved[k][0].length === t.z[0].length) t.z = saved[k];
          }
        } catch (e) { /* storage unavailable or stale — use stock */ }
        this.calStore[type] = cal;
      }
      return this.calStore[type];
    },
    saveCal() {
      try {
        const out = {};
        for (const type in this.calStore) { out[type] = {}; for (const k in this.calStore[type]) out[type][k] = this.calStore[type][k].z; }
        localStorage.setItem('ecu-cal-v1', JSON.stringify(out));
      } catch (e) { /* ignore */ }
    },
    // lessons run on stock maps so user edits can't change what they demonstrate
    useStockCal(on) {
      this.stockMode = on;
      this.S.cal = this.calFor(this.S.type);
      this.maps && this.maps.render(this.S, true);
    },

    // switch engine and keep the header buttons in sync (used by lessons)
    selectEngine(type) {
      document.querySelectorAll('#engineSel button').forEach((x) => x.classList.toggle('active', x.dataset.engine === type));
      this.setEngine(type);
    },
    setSpeed(v) {
      this.speed = v;
      document.querySelectorAll('#speedSel button').forEach((x) => x.classList.toggle('active', x.dataset.speed === String(v)));
    },
    togglePause() {
      this.paused = !this.paused;
      const b = $('#pauseBtn');
      b.classList.toggle('paused', this.paused);
      b.querySelector('span').textContent = ECU.t(this.paused ? 'Resume' : 'Pause');
      b.querySelector('svg').innerHTML = this.paused ? '<path d="M7 5l12 7-12 7z"/>' : '<path d="M7 5h3v14H7zM14 5h3v14h-3z"/>';
      if (this.paused) ECU.log(this.S, 'Paused — drag across the timing scope to scrub the crank angle.', 'info');
    },
    quickStart() {
      const S = this.S;
      if (S.running || S.cranking) return;
      if (!S.ecuOn) {
        S.key = 'ON';
        setTimeout(() => { if (this.S === S && S.key === 'ON' && !S.running) S.key = 'START'; }, 1600);
      } else S.key = 'START';
    },
  };
  window.app = app;

  ECU.applyStatic();
  $('#pauseBtn span').textContent = ECU.t('Pause');
  app.engine = new ECU.EngineView($('#engineCanvas'));
  app.wheels = new ECU.WheelView($('#wheelCanvas'));
  app.scope = new ECU.ScopeView($('#scopeCanvas'));
  app.cluster = new ECU.ClusterView($('#clusterCanvas'));
  app.trends = new ECU.TrendView($('#trendCanvas'));
  app.diagram = new ECU.DiagramView($('#diagramWrap'), (id) => app.ui.openSensor(id));
  app.ui = new ECU.UI(app);
  app.S.cal = app.calFor(app.S.type);
  app.maps = new ECU.MapsView(app);
  app.dyno = new ECU.DynoView(app);
  app.lessons = new ECU.Lessons(app);
  ECU.log(app.S, 'Welcome! Press ⚡ Start engine (or S), or turn the key yourself. Click any sensor to learn what it does.', 'ok');

  let last = performance.now();
  let tUi = 0, tBrain = 0, tDiag = 0, tNow = 0, tTrend = 0;

  function frame(now) {
    requestAnimationFrame(frame); // schedule first so one bad frame can't stop the loop
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    const S = app.S;

    if (app.wHeld) S.pedal = Math.min(100, S.pedal + dt * 350);

    if (!app.paused && dt > 0) {
      const n = Math.max(1, Math.round(dt / PHYS_DT));
      for (let i = 0; i < n; i++) ECU.step(S, dt / n);
    }

    // visual crank angle (slow motion)
    const rpm = S.rpm;
    let scale;
    if (app.speed === 'auto') scale = rpm > 1 ? (24 + rpm * 0.008) / rpm : 0;
    else scale = app.speed;
    const dtVis = app.paused ? 0 : dt;
    if (!app.paused) app.theta = (app.theta + rpm * 6 * dt * scale) % 720;
    const th = app.theta;

    const sweep = S.ecuOn && S.bootT < 1.6 && rpm < 10 ? Math.sin((S.bootT / 1.6) * Math.PI) : -1;
    const bulb = S.ecuOn && S.bootT < 2.2 ? 2.2 - S.bootT : 0;

    app.engine.render(S, th, dtVis);
    app.wheels.render(S, th, dtVis);
    app.scope.render(S, th);
    app.cluster.render(S, dt, sweep);
    app.diagram.animate(S, th, dtVis);
    if (!app.paused) app.trends.sample(S, dt);
    app.lessons.tick(S);

    tTrend += dt; tUi += dt; tBrain += dt; tDiag += dt; tNow += dt;
    if (tTrend > 0.05) { tTrend = 0; app.trends.render(S); }
    if (tUi > 0.066) { tUi = 0; app.ui.update(S, bulb, 0.066); }
    if (tDiag > 0.12 && app.ui.readings) { tDiag = 0; app.diagram.updateValues(app.ui.readings); }
    if (tBrain > 0.2) { tBrain = 0; app.ui.renderBrain(S); }
    app.maps.render(S);
    app.dyno.render(S);
    if (tNow > 0.1) {
      tNow = 0;
      $('#nowBox').innerHTML = app.engine.describe(S, th);
      $('#crankDeg').textContent = `${th.toFixed(0)}°`;
      $('#camDeg').textContent = `${(((th + (S.vvt || 0)) % 720) / 2).toFixed(0)}°`;
    }
  }
  app.frame = frame; // handy for driving the loop manually when rAF is paused (hidden tab)
  requestAnimationFrame(frame);
})();
