/* Instrument cluster: tachometer, speedometer, manifold/boost gauge + digital readouts. */
(function () {
  const ECU = window.ECU;
  const { fit, rr, glow, noGlow, rgba } = ECU.draw;
  const C = ECU.C;
  const T = (s, v) => ECU.t(s, v);
  const A0 = Math.PI * 0.75, SWEEP = Math.PI * 1.5;

  function ClusterView(canvas) { this.canvas = canvas; this.disp = { rpm: 0, v: 0, map: 101 }; }

  ClusterView.prototype.render = function (S, dt, sweep) {
    const w = this.canvas.clientWidth;
    const narrow = w < 640;
    const H = narrow ? 446 : 236;
    const { ctx } = fit(this.canvas, H);
    ctx.clearRect(0, 0, w, H);
    const d = this.disp, k = 1 - Math.exp(-dt / 0.06);
    // needle sweep at key-on (sweep = 0..1..0, or -1 when inactive)
    const rMax = S.E.diesel ? 6000 : 8000; // diesel tach reads to 6000 rpm
    d.rpm += ((sweep >= 0 ? sweep * rMax : S.rpm) - d.rpm) * k;
    d.v += ((sweep >= 0 ? sweep * 240 : S.v * 3.6) - d.v) * k;
    d.map += (S.map - d.map) * k;
    const E = S.E;

    const R = narrow ? Math.min(92, w * 0.22) : Math.min(96, w * 0.14);
    const tachX = narrow ? w * 0.26 : w * 0.19, speedX = narrow ? w * 0.74 : w * 0.81, gy = narrow ? 108 : 112;

    this.gauge(ctx, tachX, gy, R, d.rpm / rMax, {
      major: rMax / 1000 + 1, minor: 4, labels: (i) => String(i), red: E.redline / rMax, unit: T('×1000 rpm'),
      big: Math.round(d.rpm / 10) * 10, bigUnit: 'rpm', col: C.accent, lit: S.ecuOn,
    });
    this.gauge(ctx, speedX, gy, R, d.v / 240, {
      major: 7, minor: 4, labels: (i) => String(i * 40), unit: 'km/h', big: Math.round(d.v), bigUnit: 'km/h', col: C.info, lit: S.ecuOn,
    });

    // center gauge: manifold pressure / boost
    const cxm = w / 2, cym = narrow ? 336 : 96, Rm = narrow ? 64 : Math.min(62, w * 0.075);
    if (E.turbo) {
      const bar = (d.map - S.baro) / 100;
      this.gauge(ctx, cxm, cym, Rm, (bar + 1) / 2.8, {
        major: 7, minor: 2, labels: (i) => (i * 0.4 - 1 === 0 ? '0' : (i * 0.4 - 1).toFixed(1)), unit: T('boost bar'), big: bar.toFixed(2), bigUnit: 'bar', col: C.hot, lit: S.ecuOn,
        zeroAt: 1 / 2.8, small: true, red: ((E.diesel ? 1.25 : S.boostTarget) + 0.35 + 1) / 2.8,
      });
    } else {
      this.gauge(ctx, cxm, cym, Rm, d.map / 120, {
        major: 7, minor: 2, labels: (i) => String(i * 20), unit: 'MAP kPa', big: d.map.toFixed(0), bigUnit: 'kPa', col: C.air, lit: S.ecuOn, small: true,
      });
    }

    // digital strip
    const sy = narrow ? 216 : 178;
    const items = [
      [T('GEAR'), S.gear === 0 ? 'N' : String(S.gear), C.text],
      ['λ', S.rpm > 300 && S.lambda < 5 ? S.lambda.toFixed(2) : '—', S.lambda < 0.95 ? C.fuel : S.lambda > 1.05 ? C.air : C.ok],
      [T('TORQUE'), `${Math.max(0, S.torque).toFixed(0)} Nm`, C.text],
      [T('POWER'), `${(S.power * 1.341).toFixed(0)} ${T('hp')}`, C.text],
    ];
    const iw = narrow ? w / 4 : Math.min(84, (w * 0.38) / 4);
    const sx = w / 2 - (iw * items.length) / 2;
    items.forEach((it, i) => {
      const x = sx + i * iw;
      ctx.fillStyle = 'rgba(12,19,28,0.9)';
      rr(ctx, x + 3, sy, iw - 6, 40, 8); ctx.fill();
      ctx.strokeStyle = '#18222f'; ctx.lineWidth = 1; ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = C.dim;
      ctx.font = '700 8.5px Inter, sans-serif';
      ctx.fillText(it[0], x + iw / 2, sy + 13);
      ctx.fillStyle = S.ecuOn ? it[2] : '#26313f';
      ctx.font = `700 ${i === 0 ? 16 : 12.5}px "JetBrains Mono", monospace`;
      ctx.fillText(it[1], x + iw / 2, sy + 32);
    });
    ctx.textAlign = 'left';

    // coolant & fuel bars
    const by = narrow ? 432 : 226;
    const bw = narrow ? w * 0.36 : Math.min(150, w * 0.13);
    this.bar(ctx, narrow ? w * 0.06 : tachX - bw / 2, by, bw, (S.ect - 40) / 90, 'C', 'H', `${S.ect.toFixed(0)}°C`, S.ect > 110 ? C.bad : C.info, S.ecuOn);
    this.bar(ctx, narrow ? w * 0.58 : speedX - bw / 2, by, bw, S.fuelLevel / 100, 'E', 'F', `${S.fuelLevel.toFixed(0)}%`, S.fuelLevel < 10 ? C.warn : C.fuel, S.ecuOn);
  };

  ClusterView.prototype.gauge = function (ctx, cx, cy, R, frac, o) {
    frac = Math.max(-0.02, Math.min(1.03, frac));
    // bezel
    const bg = ctx.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R * 1.08);
    bg.addColorStop(0, '#111b27'); bg.addColorStop(1, '#070b11');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.08, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#1c2a3a'; ctx.lineWidth = 2; ctx.stroke();

    // track
    ctx.lineCap = 'butt';
    ctx.strokeStyle = '#141e2b';
    ctx.lineWidth = R * 0.07;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.9, A0, A0 + SWEEP); ctx.stroke();
    // lit arc
    if (o.lit) {
      const start = o.zeroAt != null ? A0 + SWEEP * o.zeroAt : A0;
      const end = A0 + SWEEP * Math.max(0, frac);
      const grad = ctx.createLinearGradient(cx - R, cy, cx + R, cy);
      grad.addColorStop(0, rgba(o.col, 0.4)); grad.addColorStop(1, o.col);
      ctx.strokeStyle = grad;
      glow(ctx, o.col, 12);
      ctx.beginPath();
      if (end >= start) ctx.arc(cx, cy, R * 0.9, start, end); else ctx.arc(cx, cy, R * 0.9, end, start);
      ctx.stroke();
      noGlow(ctx);
    }
    // red zone
    if (o.red != null && o.red < 1) {
      ctx.strokeStyle = 'rgba(255,77,94,0.7)';
      ctx.lineWidth = R * 0.05;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.8, A0 + SWEEP * o.red, A0 + SWEEP); ctx.stroke();
    }
    // ticks
    const n = (o.major - 1) * o.minor;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const ang = A0 + SWEEP * f;
      const major = i % o.minor === 0;
      const r0 = R * (major ? 0.7 : 0.75), r1 = R * 0.8;
      ctx.strokeStyle = o.red != null && f >= o.red ? '#ff6474' : major ? '#aebccc' : '#4f6075';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
      if (major) {
        const lr = R * (o.small ? 0.5 : 0.56);
        ctx.fillStyle = o.lit ? '#c3cfdc' : '#3a4757';
        ctx.font = `600 ${o.small ? 8.5 : Math.max(9, R * 0.11)}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(o.labels(i / o.minor), cx + Math.cos(ang) * lr, cy + Math.sin(ang) * lr + 3.5);
      }
    }
    // needle
    const na = A0 + SWEEP * frac;
    ctx.strokeStyle = '#ff5a4a';
    ctx.lineWidth = o.small ? 2.2 : 3;
    ctx.lineCap = 'round';
    glow(ctx, '#ff5a4a', 10);
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(na) * R * 0.12, cy - Math.sin(na) * R * 0.12);
    ctx.lineTo(cx + Math.cos(na) * R * 0.86, cy + Math.sin(na) * R * 0.86);
    ctx.stroke();
    noGlow(ctx);
    ctx.fillStyle = '#1e2a3a';
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#3a4a5e'; ctx.lineWidth = 1.5; ctx.stroke();

    // digital
    ctx.textAlign = 'center';
    ctx.fillStyle = o.lit ? C.text : '#2a3544';
    ctx.font = `700 ${o.small ? 13 : Math.max(14, R * 0.2)}px "JetBrains Mono", monospace`;
    ctx.fillText(String(o.big), cx, cy + R * 0.48);
    ctx.fillStyle = C.dim;
    ctx.font = `600 ${o.small ? 8 : 9}px Inter, sans-serif`;
    ctx.fillText(o.unit, cx, cy + R * (o.small ? 0.7 : 0.66));
    ctx.textAlign = 'left';
  };

  ClusterView.prototype.bar = function (ctx, x, y, w, frac, l0, l1, val, col, lit) {
    frac = Math.max(0, Math.min(1, frac));
    ctx.fillStyle = '#121b27';
    rr(ctx, x + 12, y - 4, w - 24, 6, 3); ctx.fill();
    if (lit) {
      ctx.fillStyle = col;
      glow(ctx, col, 8);
      rr(ctx, x + 12, y - 4, Math.max(4, (w - 24) * frac), 6, 3); ctx.fill();
      noGlow(ctx);
    }
    ctx.fillStyle = C.dim;
    ctx.font = '700 9px Inter, sans-serif';
    ctx.fillText(l0, x, y + 2);
    ctx.textAlign = 'right';
    ctx.fillText(l1, x + w, y + 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = lit ? C.muted : '#2a3544';
    ctx.font = '600 9px "JetBrains Mono", monospace';
    ctx.fillText(val, x + w / 2, y - 8);
    ctx.textAlign = 'left';
  };

  ECU.ClusterView = ClusterView;
})();
