/* Dyno panel: runs full-throttle sweeps (ECU.startDyno) and overlays the curves for comparison. */
(function () {
  const ECU = window.ECU;
  const { fit, rr, glow, noGlow } = ECU.draw;
  const C = ECU.C;
  const T = (s, v) => ECU.t(s, v);
  const $ = (s) => document.querySelector(s);

  const COLORS = ['#2ee6c5', '#ff9f43', '#62a8ff', '#ff6b8a', '#b98cff', '#ffe45c'];
  const MAX_RUNS = 6;
  const X0 = 1000, X1 = 7000;
  const VIEWS = {
    power: { label: 'Torque & power' },
    boost: { label: 'Boost', key: 'boost', unit: 'bar', scale: 0.01, fmt: (v) => v.toFixed(2) },
    spark: { label: 'Timing', key: 'spark', unit: '° BTDC', scale: 1, fmt: (v) => v.toFixed(1) },
    lam: { label: 'λ', key: 'lam', unit: '', scale: 1, fmt: (v) => v.toFixed(2) },
  };
  const niceMax = (v, step) => Math.max(step, Math.ceil(v / step) * step);

  function DynoView(app) {
    this.app = app;
    this.view = 'power';
    this.units = 'hp';
    this.rate = 400;
    this.pending = false;
    this.status = null;
    this.hoverX = null;
    this.last = 0;
    this.runs = [];
    try { this.runs = JSON.parse(localStorage.getItem('ecu-dyno-runs') || '[]'); } catch (e) { this.runs = []; }
    this.canvas = $('#dynoCanvas');
    this.side = $('#dynoSide');
    this.bind();
    this.relabel();
  }

  DynoView.prototype.save = function () {
    try { localStorage.setItem('ecu-dyno-runs', JSON.stringify(this.runs)); } catch (e) { /* ignore */ }
  };

  DynoView.prototype.label = function (r) {
    const parts = [r.type === 'turbo' ? T('Turbo') : r.type === 'diesel' ? T('Diesel') : T('NA')];
    if (r.type !== 'diesel') parts.push(`${r.octane} RON`);
    if (r.type === 'turbo') parts.push(T('boost ×{b}', { b: r.boost.toFixed(2) }));
    parts.push(r.mapsMod ? T('modified maps') : T('stock maps'));
    if (r.faults && r.faults.length) parts.push(T('{n} fault(s)', { n: r.faults.length }));
    if (r.rate !== 400) parts.push(`${r.rate} rpm/s`);
    return parts.join(' · ');
  };

  DynoView.prototype.relabel = function () {
    $('#dynoViews').innerHTML = Object.keys(VIEWS).map((k) => `<button data-view="${k}" class="${k === this.view ? 'active' : ''}">${T(VIEWS[k].label)}</button>`).join('');
    this.sideSig = null;
    this.renderSide(this.app.S);
  };

  // ---------- control ----------
  DynoView.prototype.start = function () {
    const app = this.app, S = app.S;
    if (app.lessons && app.lessons.lesson) return;
    if (S.dyno && (S.dyno.phase === 'settle' || S.dyno.phase === 'pull')) return;
    if (S.ect < 80) { S.ect = 88; S.oilT = 90; ECU.log(S, 'Dyno: engine brought to operating temperature first.', 'info'); }
    this.sRef = S; // this state is the one we're pulling on (don't treat it as an engine swap)
    this.pending = true;
    this.status = 'starting';
    if (!S.running) app.quickStart();
    this.renderSide(S, true);
  };
  DynoView.prototype.abort = function () {
    this.pending = false;
    if (this.app.S.dyno) ECU.abortDyno(this.app.S, 'stopped by the operator');
  };

  DynoView.prototype.tick = function (S) {
    if (this.sRef !== S) { this.sRef = S; this.pending = false; this.status = null; this.sideSig = null; } // engine swapped
    if (this.pending && S.running && S.runT > 1.5 && !S.cranking) {
      this.pending = false;
      ECU.startDyno(S, { rate: this.rate });
    }
    const d = S.dyno;
    if (d && d.phase === 'done') {
      const used = new Set(this.runs.map((r) => r.color));
      const cal = S.cal;
      const mapsMod = Object.keys(cal).some((k) => cal[k].z.some((row, j) => row.some((v, i) => Math.abs(v - cal[k].base[j][i]) > 1e-9)));
      this.runs.push({
        id: Date.now(), color: COLORS.find((c) => !used.has(c)) || COLORS[this.runs.length % COLORS.length], visible: true,
        type: S.type, octane: S.octane, boost: S.boostTarget, mapsMod, rate: d.rate,
        faults: ECU.hideTruth ? [] : Object.keys(S.faults).filter((k) => S.faults[k]), samples: d.samples, peak: d.peak,
      });
      while (this.runs.length > MAX_RUNS) this.runs.shift();
      this.save();
      S.dyno = null;
      this.status = 'done';
      this.sideSig = null;
    } else if (d && d.phase === 'aborted') {
      S.dyno = null;
      this.status = 'aborted';
      this.sideSig = null;
    }
  };

  // ---------- drawing ----------
  DynoView.prototype.render = function (S) {
    this.tick(S);
    const now = performance.now();
    if (now - this.last < 33) return;
    this.last = now;
    const w = this.canvas.clientWidth, small = w < 560;
    const H = small ? 260 : 340;
    const { ctx } = fit(this.canvas, H);
    ctx.clearRect(0, 0, w, H);
    const L = small ? 40 : 52, R = this.view === 'power' ? (small ? 40 : 52) : 16, Tp = 14, B = 34;
    const pw = w - L - R, ph = H - Tp - B;
    const xOf = (rpm) => L + ((rpm - X0) / (X1 - X0)) * pw;
    const live = S.dyno && (S.dyno.phase === 'pull' || S.dyno.phase === 'settle') ? S.dyno : null;
    const shown = this.runs.filter((r) => r.visible);
    const series = shown.map((r) => ({ color: r.color, samples: r.samples }));
    if (live) series.push({ color: '#ffffff', samples: live.samples, live: true });
    const powK = this.units === 'hp' ? 1.341 : 1;

    // scales
    let yMax, y2Max, yUnit, y2Unit;
    const all = series.flatMap((s) => s.samples);
    if (this.view === 'power') {
      yMax = niceMax(Math.max(200, ...all.map((x) => x.tq)) * 1.08, 50);
      y2Max = niceMax(Math.max(100, ...all.map((x) => x.kw * powK)) * 1.08, 25);
      yUnit = 'Nm'; y2Unit = this.units === 'hp' ? T('hp') : 'kW';
    } else {
      const v = VIEWS[this.view];
      const vals = all.map((x) => x[v.key] * v.scale);
      if (this.view === 'lam') { const lv = vals.length ? vals : [0.8, 1.1]; yMax = Math.max(1.2, Math.ceil(Math.max(...lv) * 5) / 5 + 0.1); }
      else yMax = this.view === 'boost' ? niceMax(Math.max(0.5, ...vals) * 1.15, 0.25) : niceMax(Math.max(20, ...vals) * 1.1, 5);
      yUnit = v.unit;
    }
    const yMin = this.view === 'lam' ? Math.min(0.7, Math.floor(Math.min(0.8, ...all.map((x) => x.lam)) * 10) / 10) : this.view === 'spark' ? Math.min(0, Math.floor(Math.min(0, ...all.map((x) => x.spark)) / 5) * 5) : 0;
    const yOf = (v) => Tp + ph - ((v - yMin) / (yMax - yMin)) * ph;
    const y2Of = (v) => Tp + ph - (v / y2Max) * ph;

    // grid + axes
    ctx.font = `600 ${small ? 8.5 : 9.5}px "JetBrains Mono", monospace`;
    ctx.fillStyle = C.muted;
    ctx.textBaseline = 'middle';
    for (let k = 0; k <= 5; k++) {
      const v = yMin + ((yMax - yMin) * k) / 5, y = yOf(v);
      ctx.strokeStyle = k === 0 ? '#223046' : '#141d29';
      ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(this.view === 'boost' || this.view === 'lam' ? v.toFixed(2) : v.toFixed(0), L - 6, y);
      if (this.view === 'power') { ctx.textAlign = 'left'; ctx.fillText(((y2Max * k) / 5).toFixed(0), L + pw + 6, y); }
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let rpm = X0; rpm <= X1; rpm += 1000) {
      const x = xOf(rpm);
      ctx.strokeStyle = '#141d29';
      ctx.beginPath(); ctx.moveTo(x, Tp); ctx.lineTo(x, Tp + ph); ctx.stroke();
      ctx.fillText(`${rpm / 1000}k`, x, Tp + ph + 14);
    }
    ctx.fillText(T('rpm'), L + pw / 2, H - 4);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.text;
    ctx.fillText(yUnit, L + 4, Tp + 10);
    if (this.view === 'power') {
      ctx.textAlign = 'right';
      ctx.fillText(`${y2Unit} ┄`, L + pw - 4, Tp + 10);
      ctx.textAlign = 'left';
      ctx.fillText(`${yUnit} ━`, L + 4, Tp + 10);
    }

    // curves
    ctx.save();
    ctx.beginPath(); ctx.rect(L, Tp - 2, pw, ph + 4); ctx.clip();
    const line = (samples, fn, color, dash, width) => {
      if (samples.length < 2) return;
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
      ctx.beginPath();
      samples.forEach((x, i) => { const px = xOf(x.rpm), py = fn(x); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.stroke(); ctx.setLineDash([]);
    };
    for (const s of series) {
      const width = s.live ? 2.5 : 2;
      if (s.live) glow(ctx, '#ffffff', 8);
      if (this.view === 'power') {
        line(s.samples, (x) => yOf(x.tq), s.color, null, width);
        line(s.samples, (x) => y2Of(x.kw * powK), s.color, [6, 4], width - 0.5);
      } else {
        const v = VIEWS[this.view];
        line(s.samples, (x) => yOf(x[v.key] * v.scale), s.color, null, width);
      }
      noGlow(ctx);
      // knock marks under the curve
      if (this.view !== 'lam') s.samples.forEach((x) => { if (x.knock > 0) { ctx.fillStyle = '#ff2e4d'; ctx.fillRect(xOf(x.rpm) - 1, Tp + ph - 5, 2, 5); } });
    }
    ctx.restore();

    // live marker
    if (live) {
      const x = xOf(live.rpm);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(x, Tp); ctx.lineTo(x, Tp + ph); ctx.stroke(); ctx.setLineDash([]);
      const txt = live.phase === 'settle' ? T('settling at {r} rpm…', { r: live.start }) : `${Math.round(live.rpm)} rpm · ${Math.max(0, S.torque).toFixed(0)} Nm`;
      ctx.font = '700 11px "JetBrains Mono", monospace';
      const tw = ctx.measureText(txt).width + 12;
      const bx = Math.min(Math.max(L, x - tw / 2), L + pw - tw);
      ctx.fillStyle = 'rgba(7,11,17,0.9)'; rr(ctx, bx, Tp + 4, tw, 20, 6); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillText(txt, bx + 6, Tp + 18);
    }

    // empty state
    if (!series.some((s) => s.samples.length)) {
      ctx.fillStyle = C.muted; ctx.textAlign = 'center';
      ctx.font = '600 12px Inter, sans-serif';
      ctx.fillText(live || this.pending ? T('Preparing the engine…') : T('Press “Run pull” to measure a torque and power curve.'), L + pw / 2, Tp + ph / 2);
      ctx.textAlign = 'left';
    }

    // hover readout
    if (this.hoverX != null && this.hoverX > L && this.hoverX < L + pw && shown.length) {
      const rpm = X0 + ((this.hoverX - L) / pw) * (X1 - X0);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.moveTo(this.hoverX, Tp); ctx.lineTo(this.hoverX, Tp + ph); ctx.stroke();
      const rows = [];
      for (const r of shown) {
        const x = r.samples.reduce((b, s) => (Math.abs(s.rpm - rpm) < Math.abs(b.rpm - rpm) ? s : b), r.samples[0]);
        if (!x || Math.abs(x.rpm - rpm) > 60) continue;
        const v = this.view === 'power' ? `${x.tq.toFixed(0)} Nm · ${(x.kw * powK).toFixed(0)} ${y2Unit}` : `${VIEWS[this.view].fmt(x[VIEWS[this.view].key] * VIEWS[this.view].scale)} ${yUnit}`;
        rows.push([r.color, v]);
      }
      if (rows.length) {
        ctx.font = '600 10.5px "JetBrains Mono", monospace';
        const head = `${Math.round(rpm / 50) * 50} rpm`;
        const bw = Math.max(ctx.measureText(head).width, ...rows.map((r) => ctx.measureText(r[1]).width)) + 28;
        const bh = 20 + rows.length * 15;
        let bx = this.hoverX + 10; if (bx + bw > L + pw) bx = this.hoverX - bw - 10;
        ctx.fillStyle = 'rgba(7,11,17,0.94)'; rr(ctx, bx, Tp + 30, bw, bh, 8); ctx.fill();
        ctx.strokeStyle = '#223046'; ctx.stroke();
        ctx.fillStyle = C.muted; ctx.fillText(head, bx + 8, Tp + 44);
        rows.forEach(([c, v], i) => { ctx.fillStyle = c; ctx.fillRect(bx + 8, Tp + 53 + i * 15, 8, 3); ctx.fillStyle = C.text; ctx.fillText(v, bx + 20, Tp + 58 + i * 15); });
      }
    }

    this.renderSide(S);
  };

  // ---------- side panel ----------
  DynoView.prototype.renderSide = function (S, force) {
    const d = S.dyno;
    const running = !!(d && (d.phase === 'settle' || d.phase === 'pull')) || this.pending;
    const lesson = this.app.lessons && this.app.lessons.lesson;
    let status;
    if (lesson) status = T('Not available during a lesson.');
    else if (this.pending) status = T('Starting and warming the engine…');
    else if (d && d.phase === 'settle') status = T('Full throttle, holding {r} rpm to settle…', { r: d.start });
    else if (d && d.phase === 'pull') status = T('Sweeping… {r} rpm', { r: Math.round(d.rpm) });
    else if (this.status === 'aborted') status = T('Last pull was aborted.');
    else if (this.status === 'done') status = T('Pull complete — added to the list.');
    else status = T('Ready. The dyno holds full throttle in neutral and controls engine speed.');
    const sig = [running, !!lesson, this.rate, this.units, this.runs.map((r) => r.id + (r.visible ? 'v' : 'h')).join(','), ECU.lang, this.status].join('|');
    if (!force && sig === this.sideSig) { const el = this.side.querySelector('.dstatus'); if (el) el.textContent = status; return; }
    this.sideSig = sig;
    const powK = this.units === 'hp' ? 1.341 : 1, pu = this.units === 'hp' ? T('hp') : 'kW';
    const runs = this.runs.slice().reverse().map((r) => `
      <div class="drun ${r.visible ? '' : 'off'}" data-run="${r.id}">
        <button class="dvis" data-act="vis" title="${T('Show / hide')}"><i style="background:${r.color}"></i></button>
        <div class="dlabel"><b>${this.label(r)}</b><span>${r.peak.tq.toFixed(0)} Nm @ ${r.peak.tqRpm} · ${(r.peak.kw * powK).toFixed(0)} ${pu} @ ${r.peak.kwRpm}</span></div>
        <button class="coach-x" data-act="del" title="${T('Delete run')}">×</button>
      </div>`).join('');
    this.side.innerHTML = `
      <div class="drow">
        ${running ? `<button class="btn sm dbtn" data-act="abort">■ ${T('Abort')}</button>` : `<button class="btn primary sm dbtn" data-act="run" ${lesson ? 'disabled' : ''}>▶ ${T('Run pull')}</button>`}
      </div>
      <div class="dstatus">${status}</div>
      <label class="slider-lbl">${T('Sweep rate')}</label>
      <div class="seg small wide" data-group="rate">
        ${[[200, 'Slow'], [400, 'Normal'], [800, 'Fast']].map(([v, l]) => `<button data-rate="${v}" class="${v === this.rate ? 'active' : ''}" ${running ? 'disabled' : ''}>${T(l)}<small> ${v}</small></button>`).join('')}
      </div>
      <label class="slider-lbl">${T('Power units')}</label>
      <div class="seg small wide" data-group="units">
        <button data-units="hp" class="${this.units === 'hp' ? 'active' : ''}">${T('hp')}</button><button data-units="kW" class="${this.units === 'kW' ? 'active' : ''}">kW</button>
      </div>
      <div class="druns-h"><span>${T('Runs ({n}/{m})', { n: this.runs.length, m: MAX_RUNS })}</span>${this.runs.length ? `<button class="btn ghost sm" data-act="clear">${T('Clear all')}</button>` : ''}</div>
      <div class="druns">${runs || `<p class="hint">${T('No runs yet.')}</p>`}</div>
      <p class="mtip">💡 ${T('Compare: do a stock pull, then add spark or boost in the calibration maps (or switch fuel) and pull again. Red ticks under a curve mark knock.')}</p>`;
  };

  DynoView.prototype.bind = function () {
    $('#dynoViews').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]'); if (!b) return;
      this.view = b.dataset.view;
      document.querySelectorAll('#dynoViews button').forEach((x) => x.classList.toggle('active', x === b));
    });
    this.side.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      if (b.dataset.rate) { this.rate = +b.dataset.rate; this.sideSig = null; return; }
      if (b.dataset.units) { this.units = b.dataset.units; this.sideSig = null; return; }
      const act = b.dataset.act, row = b.closest('[data-run]');
      const run = row && this.runs.find((r) => String(r.id) === row.dataset.run);
      if (act === 'run') this.start();
      else if (act === 'abort') this.abort();
      else if (act === 'clear') { this.runs = []; this.save(); this.sideSig = null; }
      else if (act === 'vis' && run) { run.visible = !run.visible; this.save(); this.sideSig = null; }
      else if (act === 'del' && run) { this.runs = this.runs.filter((r) => r !== run); this.save(); this.sideSig = null; }
    });
    const cv = this.canvas;
    cv.addEventListener('pointermove', (e) => { this.hoverX = e.clientX - cv.getBoundingClientRect().left; });
    cv.addEventListener('pointerleave', () => { this.hoverX = null; });
  };

  ECU.DynoView = DynoView;
})();
