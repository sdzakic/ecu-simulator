/* Rolling strip charts of key ECU parameters. */
(function () {
  const ECU = window.ECU;
  const { fit, rr, rgba } = ECU.draw;
  const C = ECU.C;
  const N = 600, DT = 0.05;

  function TrendView(canvas) {
    this.canvas = canvas;
    this.buf = [];
    this.acc = 0;
    this.charts = [
      { title: 'Engine speed', series: [{ k: 'rpm', name: 'rpm', col: C.accent, min: 0, max: 8000, fmt: (v) => v.toFixed(0) }, { k: 'kmh', name: 'km/h', col: C.info, min: 0, max: 250, fmt: (v) => v.toFixed(0) }] },
      { title: 'Load', series: [{ k: 'map', name: 'MAP kPa', col: C.air, min: 0, max: 110, turboMax: 250, fmt: (v) => v.toFixed(0) }, { k: 'thr', name: 'throttle %', col: C.muted, min: 0, max: 100, fmt: (v) => v.toFixed(0) }] },
      { title: 'Oxygen sensors', series: [{ k: 'o2', name: 'up V', col: '#ff6b8a', min: 0, max: 1, fmt: (v) => v.toFixed(2) }, { k: 'o2dn', name: 'down V', col: C.ok, min: 0, max: 1, fmt: (v) => v.toFixed(2) }], ref: 0.45 },
      { title: 'Mixture λ', series: [{ k: 'lam', name: 'actual', col: C.fuel, min: 0.6, max: 1.4, fmt: (v) => v.toFixed(2) }, { k: 'lamT', name: 'target', col: C.text, min: 0.6, max: 1.4, dash: true, fmt: (v) => v.toFixed(2) }], ref: 1 },
      { title: 'Fuel trims', series: [{ k: 'stft', name: 'STFT %', col: C.cam, min: -25, max: 25, fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(1) }, { k: 'ltft', name: 'LTFT %', col: C.warn, min: -25, max: 25, fmt: (v) => (v > 0 ? '+' : '') + v.toFixed(1) }], ref: 0 },
      { title: 'Ignition', series: [{ k: 'spk', name: 'advance °', col: C.spark, min: -10, max: 45, fmt: (v) => v.toFixed(1) }, { k: 'kr', name: 'knock ret °', col: C.bad, min: -10, max: 45, fmt: (v) => v.toFixed(1) }], ref: 0 },
      { title: 'Injection', series: [{ k: 'pw', name: 'PW ms', col: C.fuel, min: 0, max: 20, fmt: (v) => v.toFixed(2) }, { k: 'duty', name: 'duty %', col: C.hot, min: 0, max: 100, fmt: (v) => v.toFixed(0) }] },
      { title: 'Temperatures', series: [{ k: 'ect', name: 'ECT °C', col: C.info, min: -20, max: 130, fmt: (v) => v.toFixed(0) }, { k: 'iat', name: 'IAT °C', col: C.air, min: -20, max: 130, fmt: (v) => v.toFixed(0) }, { k: 'egt', name: 'EGT/10', col: C.hot, min: -20, max: 130, fmt: (v) => (v * 10).toFixed(0) }] },
    ];
    this.turboCharts = { 1: { title: 'Load & boost', series: [{ k: 'map', name: 'MAP kPa', col: C.air, min: 0, max: 250, fmt: (v) => v.toFixed(0) }, { k: 'btgt', name: 'target', col: C.hot, min: 0, max: 250, dash: true, fmt: (v) => v.toFixed(0) }, { k: 'wg', name: 'WG %', col: C.muted, min: 0, max: 250 / 100 * 100, scale: 2.5, fmt: (v) => (v / 2.5).toFixed(0) }] } };
  }

  TrendView.prototype.sample = function (S, dt) {
    this.acc += dt;
    while (this.acc >= DT) {
      this.acc -= DT;
      const kr = (S.knockRetard[0] + S.knockRetard[1] + S.knockRetard[2] + S.knockRetard[3]) / 4;
      this.buf.push({
        rpm: S.rpm, kmh: S.v * 3.6, map: S.map, thr: S.throttle, o2: S.o2v, o2dn: S.o2dn,
        lam: S.rpm > 300 ? Math.min(S.lambda, 1.4) : NaN, lamT: S.running ? S.lambdaTarget : NaN,
        stft: S.stft * 100, ltft: S.ltft * 100, spk: S.running ? S.spark : NaN, kr: Math.max(...S.knockRetard),
        pw: S.pw, duty: S.injDuty * 100, ect: S.ect, iat: S.iat, egt: S.egt / 10,
        btgt: S.E.turbo ? S.baro + S.boostTargetKpa : NaN, wg: S.wgPos * 250,
      });
      if (this.buf.length > N) this.buf.shift();
    }
  };

  TrendView.prototype.render = function (S) {
    const w = this.canvas.clientWidth;
    const cols = w > 900 ? 4 : w > 560 ? 2 : 1;
    const rows = Math.ceil(this.charts.length / cols);
    const ch = 150;
    const H = rows * ch + (rows - 1) * 10;
    const { ctx } = fit(this.canvas, H);
    ctx.clearRect(0, 0, w, H);
    const cw = (w - (cols - 1) * 10) / cols;
    this.charts.forEach((chart0, i) => {
      const chart = S.E.turbo && this.turboCharts[i] ? this.turboCharts[i] : chart0;
      const x = (i % cols) * (cw + 10), y = Math.floor(i / cols) * (ch + 10);
      this.chart(ctx, x, y, cw, ch, chart);
    });
  };

  TrendView.prototype.chart = function (ctx, x, y, w, h, chart) {
    ctx.fillStyle = '#0a1017';
    rr(ctx, x, y, w, h, 10); ctx.fill();
    ctx.strokeStyle = '#18222f'; ctx.lineWidth = 1; ctx.stroke();
    const px = x + 8, py = y + 36, pw = w - 16, ph = h - 44;
    // grid
    ctx.strokeStyle = '#131c28';
    for (let i = 0; i <= 4; i++) { const yy = py + (ph * i) / 4; ctx.beginPath(); ctx.moveTo(px, yy); ctx.lineTo(px + pw, yy); ctx.stroke(); }
    ctx.fillStyle = C.text;
    ctx.font = '700 11px Inter, sans-serif';
    ctx.fillText(ECU.t(chart.title), x + 10, y + 16);
    const last = this.buf[this.buf.length - 1] || {};
    // legend w/ values
    let lx = x + 10;
    ctx.font = '600 9.5px "JetBrains Mono", monospace';
    chart.series.forEach((s) => {
      const v = last[s.k];
      const t = `${ECU.t(s.name)} ${v == null || isNaN(v) ? '—' : s.fmt(v)}`;
      ctx.fillStyle = s.col;
      ctx.fillRect(lx, y + 24, 8, 3);
      ctx.fillText(t, lx + 11, y + 29);
      lx += ctx.measureText(t).width + 22;
    });
    const s0 = chart.series[0];
    if (chart.ref != null) {
      const yy = py + ph - ((chart.ref - s0.min) / (s0.max - s0.min)) * ph;
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(px, yy); ctx.lineTo(px + pw, yy); ctx.stroke();
      ctx.setLineDash([]);
    }
    const n = this.buf.length;
    ctx.save();
    ctx.beginPath(); ctx.rect(px, py - 2, pw, ph + 4); ctx.clip();
    chart.series.forEach((s) => {
      ctx.strokeStyle = s.col;
      ctx.lineWidth = 1.5;
      if (s.dash) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < n; i++) {
        const v = this.buf[i][s.k];
        if (v == null || isNaN(v)) { pen = false; continue; }
        const xx = px + pw - ((n - 1 - i) / (N - 1)) * pw;
        const yy = py + ph - ((v - s.min) / (s.max - s.min)) * ph;
        if (pen) ctx.lineTo(xx, yy); else { ctx.moveTo(xx, yy); pen = true; }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.restore();
  };

  ECU.TrendView = TrendView;
})();
