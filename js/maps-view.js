/* Live calibration maps: heat-map editor for the ECU's lookup tables with the operating point
   tracked in real time. Edits apply immediately (the ECU reads S.cal every step). */
(function () {
  const ECU = window.ECU;
  const { fit, rr, glow, noGlow, mix } = ECU.draw;
  const C = ECU.C;
  const T = (s, v) => ECU.t(s, v);
  const $ = (s) => document.querySelector(s);

  const ramp = (stops, t) => {
    t = Math.max(0, Math.min(1, t));
    const n = stops.length - 1, k = Math.min(n - 1, Math.floor(t * n));
    return mix(stops[k], stops[k + 1], t * n - k);
  };
  const DEFS = {
    spark: {
      title: 'Spark advance', unit: '°', step: 0.5, big: 2, min: -10, max: 50, yLabel: 'load %', fmt: (v) => v.toFixed(1),
      color: (v) => ramp(['#1d3b8f', '#2a7de1', '#2ee6c5', '#ffd23f', '#ff7a3d', '#ff3b5c'], (v + 5) / 50),
      desc: 'Degrees before TDC at which each cylinder fires, by rpm and load. More advance gives more torque — up to best-torque timing (MBT) — but too much makes the end-gas auto-ignite: knock.',
      tip: 'Try: select 1500–3000 rpm at 80–100 % load and add +6°. Red-outlined cells are past the knock limit — watch the knock sensor and per-cylinder retard.',
    },
    lambda: {
      title: 'Target λ', unit: '', step: 0.01, big: 0.05, min: 0.65, max: 1.3, yLabel: 'load %', fmt: (v) => v.toFixed(2),
      color: (v) => (v <= 1 ? ramp(['#2fbf71', '#ffb020', '#ff4d5e'], (1 - v) / 0.25) : ramp(['#2fbf71', '#3fc6ff', '#7b6cff'], (v - 1) / 0.2)),
      desc: 'The mixture the ECU aims for. λ 1.00 cells run in closed loop on the O2 sensor; richer cells (λ < 1) cool the charge and make maximum power; leaner cells run open loop for economy.',
      tip: 'Try: set 1.10 in the cruise area (2000–3500 rpm, 30–50 % load) — the ECU goes open-loop lean. Or lean out full load to 0.95 and watch the exhaust temperature climb.',
    },
    boost: {
      title: 'Boost target', unit: 'bar', step: 0.05, big: 0.2, min: 0, max: 2, yLabel: 'pedal %', fmt: (v) => v.toFixed(2), turbo: true,
      color: (v) => ramp(['#1b2433', '#5a3a1a', '#ff9f43', '#ffe066'], v / 1.6),
      desc: 'Boost pressure the ECU requests for each rpm and pedal position. The wastegate PID then chases this target. The “Boost target” slider on the left scales the whole table.',
      tip: 'Try: raise 3000–5000 rpm at 80–100 % pedal to 1.40 bar. More boost means more air and torque — and more knock, so watch spark timing get pulled back.',
    },
  };

  function MapsView(app) {
    this.app = app;
    this.tab = 'spark';
    this.sel = null;
    this.hover = null;
    this.trail = [];
    this.last = 0;
    this.lastSide = 0;
    this.showKnock = true;
    this.canvas = $('#mapCanvas');
    this.side = $('#mapSide');
    this.bindEvents();
    this.relabel();
  }

  MapsView.prototype.def = function () { return DEFS[this.tab]; };
  MapsView.prototype.table = function () { return this.app.S.cal[this.tab]; };

  MapsView.prototype.relabel = function () {
    const tabs = $('#mapTabs');
    tabs.innerHTML = Object.keys(DEFS).map((k) => `<button data-map="${k}" class="${k === this.tab ? 'active' : ''}${DEFS[k].turbo ? ' turbo-only' : ''}">${T(DEFS[k].title)}</button>`).join('');
    this.lastSide = 0;
    this.sideSig = null;
    this.render(this.app.S, true);
  };

  // ---------- geometry ----------
  MapsView.prototype.geom = function (t) {
    const w = this.canvas.clientWidth;
    const small = w < 560;
    const L = small ? 40 : 58, B = 38, Tp = 6, R = 6;
    const nx = t.x.length, ny = t.y.length;
    const ch = small ? 20 : 24;
    const H = Tp + ny * ch + B;
    const cw = (w - L - R) / nx;
    return { w, H, L, B, Tp, R, nx, ny, cw, ch, small };
  };
  MapsView.prototype.cellAt = function (px, py) {
    const t = this.table(); if (!t) return null;
    const g = this.geom(t);
    const i = Math.floor((px - g.L) / g.cw), r = Math.floor((py - g.Tp) / g.ch);
    if (i < 0 || i >= g.nx || r < 0 || r >= g.ny) return null;
    return { i, j: g.ny - 1 - r };
  };

  // ---------- drawing ----------
  MapsView.prototype.render = function (S, force) {
    const now = performance.now();
    if (!force && now - this.last < 50) return;
    this.last = now;
    if (this.calRef !== S.cal) { this.calRef = S.cal; this.sel = null; this.trail = []; this.sideSig = null; } // engine swap / lesson
    if (!S.cal[this.tab]) { this.tab = 'spark'; this.sel = null; this.relabel(); return; }
    const t = this.table(), d = this.def(), g = this.geom(t);
    const { ctx } = fit(this.canvas, g.H);
    ctx.clearRect(0, 0, g.w, g.H);

    // operating point (continuous cell coordinates)
    const xv = S.sens.rpm || 0;
    const yv = this.tab === 'boost' ? S.pedal : S.loadPct || 0;
    const [ci, fx] = ECU.calCell(t.x, xv), [cj, fy] = ECU.calCell(t.y, yv);
    const live = S.running;
    const opX = g.L + (ci + fx + 0.5) * g.cw, opY = g.Tp + (g.ny - 1 - (cj + fy) + 0.5) * g.ch;
    if (live) { this.trail.push([ci + fx, cj + fy]); if (this.trail.length > 90) this.trail.shift(); } else this.trail = [];

    const knockCell = (i, j) => {
      if (this.tab !== 'spark' || !this.showKnock) return false;
      const corr = -Math.max(0, S.iat - 25) * 0.2 - Math.max(0, S.ect - 95) * 0.4;
      return t.z[j][i] + corr > ECU.knockLimitAt(S.E, t.x[i], t.y[j] / 100, S.octane, S.iat, S.ect);
    };

    ctx.font = `600 ${g.small ? 8.5 : 10}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        const v = t.z[j][i];
        const x = g.L + i * g.cw, y = g.Tp + (g.ny - 1 - j) * g.ch;
        ctx.fillStyle = d.color(v);
        ctx.globalAlpha = 0.88;
        ctx.fillRect(x + 0.5, y + 0.5, g.cw - 1, g.ch - 1);
        ctx.globalAlpha = 1;
        // interpolation weights of the four cells around the operating point
        if (live) {
          const wx = i === ci ? 1 - fx : i === ci + 1 ? fx : 0, wy = j === cj ? 1 - fy : j === cj + 1 ? fy : 0;
          if (wx * wy > 0) { ctx.fillStyle = `rgba(255,255,255,${0.45 * wx * wy})`; ctx.fillRect(x + 0.5, y + 0.5, g.cw - 1, g.ch - 1); }
        }
        const modified = Math.abs(v - t.base[j][i]) > 1e-9;
        if (knockCell(i, j)) {
          ctx.strokeStyle = '#ff2e4d'; ctx.lineWidth = 2;
          ctx.strokeRect(x + 2, y + 2, g.cw - 4, g.ch - 4);
        }
        if (g.cw > 30) {
          const [cr, cg, cb] = d.color(v).match(/\d+/g).map(Number);
          ctx.fillStyle = 0.299 * cr + 0.587 * cg + 0.114 * cb > 120 ? 'rgba(6,16,26,0.92)' : 'rgba(235,244,255,0.95)';
          ctx.fillText(d.fmt(v), x + g.cw / 2, y + g.ch / 2 + 0.5);
        }
        if (modified) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x + g.cw - 5, y + 5, 2.5, 0, Math.PI * 2); ctx.fill(); }
      }
    }

    // selection
    if (this.sel) {
      const s = this.norm(this.sel);
      const x = g.L + s.i0 * g.cw, y = g.Tp + (g.ny - 1 - s.j1) * g.ch;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5;
      glow(ctx, C.accent, 10);
      ctx.strokeRect(x + 1, y + 1, (s.i1 - s.i0 + 1) * g.cw - 2, (s.j1 - s.j0 + 1) * g.ch - 2);
      noGlow(ctx);
    }
    // hover
    if (this.hover && !this.drag) {
      const x = g.L + this.hover.i * g.cw, y = g.Tp + (g.ny - 1 - this.hover.j) * g.ch;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
      ctx.strokeRect(x + 1.5, y + 1.5, g.cw - 3, g.ch - 3);
    }

    // axes
    ctx.fillStyle = C.muted;
    ctx.font = `600 ${g.small ? 8.5 : 9.5}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    t.x.forEach((xv2, i) => { if (!g.small || i % 2 === 0) ctx.fillText(xv2 >= 1000 ? `${xv2 / 1000}k` : String(xv2), g.L + (i + 0.5) * g.cw, g.Tp + g.ny * g.ch + 14); });
    ctx.fillText(T('rpm'), g.L + (g.nx * g.cw) / 2, g.H - 6);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    t.y.forEach((yv2, j) => ctx.fillText(String(yv2), g.L - 6, g.Tp + (g.ny - 1 - j + 0.5) * g.ch));
    ctx.save();
    ctx.translate(10, g.Tp + (g.ny * g.ch) / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    if (!g.small) ctx.fillText(T(d.yLabel), 0, 0);
    ctx.restore();

    // trail + operating point
    if (live && this.trail.length > 1) {
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (let k = 1; k < this.trail.length; k++) {
        const [a, b] = this.trail[k - 1], [c, e] = this.trail[k];
        ctx.strokeStyle = `rgba(255,255,255,${(k / this.trail.length) * 0.7})`;
        ctx.beginPath();
        ctx.moveTo(g.L + (a + 0.5) * g.cw, g.Tp + (g.ny - 1 - b + 0.5) * g.ch);
        ctx.lineTo(g.L + (c + 0.5) * g.cw, g.Tp + (g.ny - 1 - e + 0.5) * g.ch);
        ctx.stroke();
      }
    }
    if (live) {
      glow(ctx, '#ffffff', 16);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(opX, opY, 6, 0, Math.PI * 2); ctx.fill();
      noGlow(ctx);
      ctx.strokeStyle = C.bg; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(opX, opY, 3, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    if (force || now - this.lastSide > 150) { this.lastSide = now; this.renderSide(S); }
  };

  // ---------- side panel ----------
  MapsView.prototype.renderSide = function (S) {
    const d = this.def(), t = this.table();
    const row = (k, v, cls) => `<div class="mrow ${cls || ''}"><span>${k}</span><b>${v}</b></div>`;
    let live = '';
    if (!S.running) live = `<div class="mrow"><span>${T('Start the engine to see the operating point move.')}</span></div>`;
    else if (this.tab === 'spark') {
      const kr = Math.max(...S.knockRetard);
      live = row(T('Map value here'), `${S.sparkMap.toFixed(1)}°`) +
        row(T('IAT / ECT correction'), `${S.sparkCorr >= 0 ? '+' : ''}${S.sparkCorr.toFixed(1)}°`) +
        row(T('Knock retard'), kr > 0.2 ? `−${kr.toFixed(1)}°` : '0°', kr > 0.2 ? 'bad' : '') +
        row(T('Final advance'), `${S.spark.toFixed(1)}° BTDC`, 'hl') +
        row(T('Best-torque timing (MBT)'), `${S.mbtNow.toFixed(1)}°`) +
        row(T('Knock limit ({o} RON)', { o: S.octane }), `${S.klNow.toFixed(1)}°`, S.spark > S.klNow ? 'bad' : '') +
        row(T('Torque'), `${Math.max(0, S.torque).toFixed(0)} Nm`);
    } else if (this.tab === 'lambda') {
      live = row(T('Map value here'), `λ ${S.lambdaMap.toFixed(2)}`) +
        row(T('Final target'), `λ ${S.lambdaTarget.toFixed(2)}`, 'hl') +
        row(T('Actual (wideband)'), S.lambda < 5 ? `λ ${S.lambda.toFixed(2)}` : '—') +
        row(T('Fuel loop'), S.closedLoop ? T('CLOSED LOOP') : T('OPEN LOOP'), S.closedLoop ? 'ok' : '') +
        row(T('Exhaust temperature'), `${S.egt.toFixed(0)} °C`, S.egt > (S.E.turbo ? 950 : 920) ? 'bad' : '') +
        row(T('Torque'), `${Math.max(0, S.torque).toFixed(0)} Nm`);
    } else {
      const b = (S.boostP - S.baro) / 100;
      live = row(T('Map value here'), `${(S.boostMap || 0).toFixed(2)} bar`) +
        row(T('× slider'), `× ${S.boostTarget.toFixed(2)}`) +
        row(T('Target'), `${(S.boostTargetKpa / 100).toFixed(2)} bar`, 'hl') +
        row(T('Actual boost'), `${b >= 0 ? '+' : ''}${b.toFixed(2)} bar`) +
        row(T('Wastegate'), T('{o} % open', { o: (S.wgPos * 100).toFixed(0) })) +
        row(T('Torque'), `${Math.max(0, S.torque).toFixed(0)} Nm`);
    }
    const mods = t.z.reduce((n, r, j) => n + r.filter((v, i) => Math.abs(v - t.base[j][i]) > 1e-9).length, 0);
    const s = this.sel ? this.norm(this.sel) : null;
    let selInfo = `<p class="hint">${T('Click or drag across cells to select them.')}</p>`;
    if (s) {
      const cells = [];
      for (let j = s.j0; j <= s.j1; j++) for (let i = s.i0; i <= s.i1; i++) cells.push(t.z[j][i]);
      const avg = cells.reduce((a, b) => a + b, 0) / cells.length;
      const range = `${t.x[s.i0]}${s.i1 > s.i0 ? '–' + t.x[s.i1] : ''} ${T('rpm')} · ${t.y[s.j0]}${s.j1 > s.j0 ? '–' + t.y[s.j1] : ''} ${d.yLabel.includes('pedal') ? T('pedal %') : T('load %')}`;
      selInfo = `<div class="msel"><b>${T('{n} cell(s) selected', { n: cells.length })}</b><span>${range}</span><span>${T('average {v}', { v: d.fmt(avg) + (d.unit ? ' ' + d.unit : '') })}</span></div>`;
    }
    const hov = this.hover ? `${t.x[this.hover.i]} ${T('rpm')} · ${t.y[this.hover.j]} % → <b>${d.fmt(t.z[this.hover.j][this.hover.i])}${d.unit}</b> <small>(${T('stock')} ${d.fmt(t.base[this.hover.j][this.hover.i])})</small>` : '&nbsp;';
    const locked = this.app.stockMode;
    const sig = [this.tab, s && [s.i0, s.i1, s.j0, s.j1].join(','), locked, ECU.lang, this.showKnock, mods, this.editSeq].join('|');
    if (sig === this.sideSig) {
      // same structure — refresh only live values so an input being typed into isn't wiped
      this.side.querySelector('.mlive').innerHTML = live;
      this.side.querySelector('.mhover').innerHTML = hov;
      return;
    }
    this.sideSig = sig;
    const dis = locked || !s ? 'disabled' : '';
    this.side.innerHTML = `
      ${locked ? `<div class="mlock">🎓 ${T('A lesson is running on the stock maps. Your own maps come back when it ends.')}</div>` : ''}
      <p class="mdesc">${T(d.desc)}</p>
      <div class="mlive">${live}</div>
      <div class="mhover">${hov}</div>
      <div class="medit">
        ${selInfo}
        <div class="mbtns">
          <button class="btn sm" data-edit="-big" ${dis}>−${d.big}</button>
          <button class="btn sm" data-edit="-" ${dis}>−${d.step}</button>
          <button class="btn sm" data-edit="+" ${dis}>+${d.step}</button>
          <button class="btn sm" data-edit="+big" ${dis}>+${d.big}</button>
        </div>
        <div class="mbtns">
          <input type="number" class="mset" step="${d.step}" min="${d.min}" max="${d.max}" placeholder="${T('value')}" ${dis}>
          <button class="btn sm" data-edit="set" ${dis}>${T('Set')}</button>
          <button class="btn sm" data-edit="smooth" ${dis}>${T('Smooth')}</button>
          <button class="btn ghost sm" data-edit="resetSel" ${dis}>${T('Reset selection')}</button>
        </div>
      </div>
      ${this.tab === 'spark' ? `<label class="mknock"><input type="checkbox" data-knock ${this.showKnock ? 'checked' : ''}> ${T('Outline cells past the knock limit (current fuel & temperatures)')}</label>` : ''}
      <p class="mtip">💡 ${T(d.tip)}</p>
      <div class="mfoot"><span>${mods ? T('{n} cell(s) modified', { n: mods }) : T('Stock calibration')}</span><button class="btn ghost sm" data-edit="resetAll" ${mods && !locked ? '' : 'disabled'}>${T('Reset map')}</button></div>
      <p class="hint">${T('Keys: arrows move · Shift+arrows extend · +/− adjust · PgUp/PgDn big steps · Delete resets')}</p>`;
  };

  // ---------- editing ----------
  MapsView.prototype.norm = function (s) {
    return { i0: Math.min(s.a.i, s.b.i), i1: Math.max(s.a.i, s.b.i), j0: Math.min(s.a.j, s.b.j), j1: Math.max(s.a.j, s.b.j) };
  };
  MapsView.prototype.edit = function (op, val) {
    if (!this.sel || this.app.stockMode) return;
    const t = this.table(), d = this.def(), s = this.norm(this.sel);
    const clampV = (v) => Math.max(d.min, Math.min(d.max, Math.round(v / d.step) * d.step));
    const src = t.z.map((r) => r.slice());
    for (let j = s.j0; j <= s.j1; j++) {
      for (let i = s.i0; i <= s.i1; i++) {
        let v = t.z[j][i];
        if (op === '+') v += d.step;
        else if (op === '-') v -= d.step;
        else if (op === '+big') v += d.big;
        else if (op === '-big') v -= d.big;
        else if (op === 'set') { if (!isFinite(val)) return; v = val; }
        else if (op === 'reset') v = t.base[j][i];
        else if (op === 'smooth') {
          let sum = 0, n = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const jj = j + dj, ii = i + di;
            if (jj >= 0 && jj < t.y.length && ii >= 0 && ii < t.x.length) { sum += src[jj][ii]; n++; }
          }
          v = sum / n;
        }
        t.z[j][i] = op === 'reset' ? v : clampV(v);
      }
    }
    this.editSeq = (this.editSeq || 0) + 1; // selection average changed → rebuild editor text
    this.app.saveCal();
    this.render(this.app.S, true);
  };

  MapsView.prototype.bindEvents = function () {
    $('#mapTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-map]');
      if (!b) return;
      this.tab = b.dataset.map; this.sel = null; this.trail = [];
      document.querySelectorAll('#mapTabs button').forEach((x) => x.classList.toggle('active', x === b));
      this.render(this.app.S, true);
    });
    const cv = this.canvas;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return this.cellAt(e.clientX - r.left, e.clientY - r.top); };
    cv.addEventListener('pointerdown', (e) => {
      const c = pos(e); if (!c) return;
      cv.focus();
      this.sel = e.shiftKey && this.sel ? { a: this.sel.a, b: c } : { a: c, b: c };
      this.drag = true;
      cv.setPointerCapture(e.pointerId);
      this.render(this.app.S, true);
    });
    cv.addEventListener('pointermove', (e) => {
      const c = pos(e);
      this.hover = c;
      if (this.drag && c) this.sel.b = c;
      this.render(this.app.S, true);
    });
    cv.addEventListener('pointerup', () => { this.drag = false; this.render(this.app.S, true); });
    cv.addEventListener('pointerleave', () => { this.hover = null; });
    cv.addEventListener('keydown', (e) => {
      const t = this.table(); if (!t) return;
      const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (mv) {
        e.preventDefault();
        e.stopPropagation(); // ↑ is also the global throttle key
        const b = this.sel ? this.sel.b : { i: 0, j: 0 };
        const nb = { i: Math.max(0, Math.min(t.x.length - 1, b.i + mv[0])), j: Math.max(0, Math.min(t.y.length - 1, b.j + mv[1])) };
        this.sel = e.shiftKey && this.sel ? { a: this.sel.a, b: nb } : { a: nb, b: nb };
        this.render(this.app.S, true);
        return;
      }
      const op = { '+': '+', '=': '+', '-': '-', _: '-', PageUp: '+big', PageDown: '-big', Delete: 'reset', Backspace: 'reset' }[e.key];
      if (op) { e.preventDefault(); e.stopPropagation(); this.edit(op); }
    });
    this.side.addEventListener('click', (e) => {
      const b = e.target.closest('[data-edit]');
      if (!b || b.disabled) return;
      const op = b.dataset.edit;
      if (op === 'set') this.edit('set', parseFloat(this.side.querySelector('.mset').value));
      else if (op === 'resetSel') this.edit('reset');
      else if (op === 'resetAll') {
        if (!window.confirm(T('Reset the whole map to the stock calibration?'))) return;
        const t = this.table();
        t.z = t.base.map((r) => r.slice());
        this.app.saveCal();
        this.render(this.app.S, true);
      } else this.edit(op);
    });
    this.side.addEventListener('keydown', (e) => {
      if (e.target.classList.contains('mset') && e.key === 'Enter') this.edit('set', parseFloat(e.target.value));
    });
    this.side.addEventListener('change', (e) => {
      if (e.target.hasAttribute('data-knock')) { this.showKnock = e.target.checked; this.render(this.app.S, true); }
    });
  };

  ECU.MapsView = MapsView;
})();
