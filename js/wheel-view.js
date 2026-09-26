/* 60-2 crank trigger wheel + single-tab cam wheel with their sensors and rolling signals. */
(function () {
  const ECU = window.ECU;
  const { fit, rr, glow, noGlow, rgba } = ECU.draw;
  const C = ECU.C;
  const D2R = Math.PI / 180;

  function WheelView(canvas) { this.canvas = canvas; this.t = 0; }

  WheelView.prototype.render = function (S, theta, dtVis) {
    this.t += dtVis;
    const narrow = this.canvas.clientWidth < 620;
    const H = narrow ? 560 : 300;
    const { ctx, w } = fit(this.canvas, H);
    ctx.clearRect(0, 0, w, H);
    const colW = narrow ? w : w / 2;
    const ckpDead = S.faults.ckp, cmpDead = S.faults.cmp;

    // ------------------------------------------------ CRANK
    {
      const ox = 0, oy = 0;
      const R = Math.min(74, colW * 0.22);
      const cx = ox + R + 22, cy = oy + R + 58;
      const a = (((theta + 90) % 360) + 360) % 360; // wheel angle under the sensor
      const tooth = ECU.ckpTooth(theta);

      ctx.fillStyle = C.muted;
      ctx.font = '700 10px Inter, sans-serif';
      ctx.fillText('CRANKSHAFT · 60-2 TRIGGER WHEEL', ox + 8, 14);

      // disc
      const dg = ctx.createRadialGradient(cx, cy, 4, cx, cy, R);
      dg.addColorStop(0, '#2b394b'); dg.addColorStop(1, '#172231');
      ctx.fillStyle = dg;
      ctx.beginPath(); ctx.arc(cx, cy, R - 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#2f3f54'; ctx.lineWidth = 1; ctx.stroke();
      // bolt holes
      for (let i = 0; i < 6; i++) {
        const ang = (-a + i * 60) * D2R - Math.PI / 2;
        ctx.fillStyle = '#0c131c';
        ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * R * 0.45, cy + Math.sin(ang) * R * 0.45, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#0c131c';
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.18, 0, Math.PI * 2); ctx.fill();

      // teeth
      for (let k = 0; k < 60; k++) {
        const w0 = k * 6, w1 = k * 6 + 3;
        const s0 = (a - w0) * D2R - Math.PI / 2, s1 = (a - w1) * D2R - Math.PI / 2;
        if (k >= 58) {
          // gap marker
          ctx.strokeStyle = rgba(C.accent, 0.5);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, cy, R - 2, (a - 360) * D2R - Math.PI / 2, (a - 347) * D2R - Math.PI / 2); ctx.stroke();
          continue;
        }
        const active = k === tooth.idx && !tooth.missing && tooth.frac < 0.5;
        ctx.fillStyle = active ? C.accent : '#6f8196';
        if (active) glow(ctx, C.accent, 10);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(s0) * (R - 6), cy + Math.sin(s0) * (R - 6));
        ctx.lineTo(cx + Math.cos(s0) * (R + 5), cy + Math.sin(s0) * (R + 5));
        ctx.lineTo(cx + Math.cos(s1) * (R + 5), cy + Math.sin(s1) * (R + 5));
        ctx.lineTo(cx + Math.cos(s1) * (R - 6), cy + Math.sin(s1) * (R - 6));
        ctx.closePath(); ctx.fill();
        noGlow(ctx);
      }
      // gap label on wheel
      {
        const gm = (a - 354) * D2R - Math.PI / 2;
        ctx.fillStyle = C.accent;
        ctx.font = '700 8.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('GAP', cx + Math.cos(gm) * (R - 18), cy + Math.sin(gm) * (R - 18) + 3);
        // TDC marks
        [[90, 'TDC 1/4'], [270, 'TDC 2/3']].forEach(([wa, t]) => {
          const m = (a - wa) * D2R - Math.PI / 2;
          ctx.fillStyle = C.spark;
          ctx.beginPath();
          ctx.arc(cx + Math.cos(m) * (R - 14), cy + Math.sin(m) * (R - 14), 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = rgba(C.spark, 0.75);
          ctx.fillText(t, cx + Math.cos(m) * (R - 32), cy + Math.sin(m) * (R - 32) + 3);
        });
        ctx.textAlign = 'left';
      }

      // sensor
      const onTooth = !tooth.missing && tooth.frac < 0.5;
      ctx.fillStyle = ckpDead ? '#3a1a20' : '#26364a';
      rr(ctx, cx - 9, cy - R - 30, 18, 20, 3); ctx.fill();
      ctx.fillStyle = '#1a2533';
      ctx.fillRect(cx - 5, cy - R - 12, 10, 5);
      ctx.strokeStyle = ckpDead ? C.bad : '#4a5d75';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy - R - 30); ctx.quadraticCurveTo(cx + 20, cy - R - 42, cx + 42, cy - R - 38); ctx.stroke();
      if (S.rpm > 5 && onTooth && !ckpDead) {
        glow(ctx, C.accent, 12);
        ctx.strokeStyle = rgba(C.accent, 0.8);
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath(); ctx.arc(cx, cy - R - 7, 4 + i * 3, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
        }
        noGlow(ctx);
      }
      ctx.fillStyle = ckpDead ? C.bad : C.muted;
      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.fillText(ckpDead ? 'CKP ✕ OPEN' : S.ckpType === 'vr' ? 'CKP (VR)' : 'CKP (Hall)', cx + 16, cy - R - 20);

      // info text
      const tx = cx + R + 22;
      const lines = [];
      const period = S.rpm > 1 ? (60000 / S.rpm / 60) : 0;
      lines.push(['Tooth under sensor', tooth.missing ? 'GAP (58–59)' : `#${tooth.idx + 1} of 58`]);
      const l360 = ((theta % 360) + 360) % 360;
      lines.push(['Crank angle', l360 < 180 ? `${l360.toFixed(0)}° ATDC 1/4` : `${(360 - l360).toFixed(0)}° BTDC 1/4`]);
      lines.push(['Tooth period', period ? `${period.toFixed(2)} ms` : '—']);
      lines.push(['Signal', ckpDead ? 'none!' : S.ckpType === 'vr' ? `±${(Math.max(0.2, S.rpm / 450)).toFixed(1)} V AC` : '0 / 5 V square']);
      lines.push(['Gives the ECU', 'RPM + position']);
      this.infoLines(ctx, tx, 44, lines, Math.max(120, colW - tx - 8));

      // trace
      const ty = cy + R + 14, th = narrow ? 60 : H - ty - 8;
      this.trace(ctx, 10, ty, colW - 20, th, theta, 360, (ang) => {
        if (ckpDead || S.rpm < 1) return 0;
        const v = ECU.ckpSignal(ang, S.ckpType, S.rpm);
        return S.ckpType === 'vr' ? v * Math.min(1, 0.25 + S.rpm / 2000) : v * 1.6 - 0.8;
      }, C.accent, 'last 360°', (ang) => ECU.ckpTooth(ang).missing);
    }

    // ------------------------------------------------ CAM
    {
      const ox = narrow ? 0 : colW, oy = narrow ? 280 : 0;
      const R = Math.min(60, colW * 0.18);
      const cx = ox + R + 40, cy = oy + 58 + 74;
      const psi = ((((theta + (S.vvt || 0)) % 720) + 720) % 720) / 2;
      const high = !cmpDead && ECU.cmpSignal(theta, S.vvt);

      ctx.fillStyle = C.muted;
      ctx.font = '700 10px Inter, sans-serif';
      ctx.fillText('INTAKE CAMSHAFT · 1 TAB (turns at ½ crank speed)', ox + 8, oy + 14);

      const dg = ctx.createRadialGradient(cx, cy, 4, cx, cy, R);
      dg.addColorStop(0, '#2d2742'); dg.addColorStop(1, '#1a1728');
      ctx.fillStyle = dg;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#3b3358'; ctx.lineWidth = 1.5; ctx.stroke();
      // sprocket teeth (decorative)
      ctx.strokeStyle = '#2e2846';
      ctx.lineWidth = 3;
      for (let i = 0; i < 40; i++) {
        const ang = (psi * -1 + i * 9) * D2R;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * (R - 3), cy + Math.sin(ang) * (R - 3));
        ctx.lineTo(cx + Math.cos(ang) * (R - 8), cy + Math.sin(ang) * (R - 8));
        ctx.stroke();
      }
      // tab: wheel angle 300..330
      const s0 = (psi - 300) * D2R - Math.PI / 2, s1 = (psi - 330) * D2R - Math.PI / 2;
      ctx.fillStyle = high ? C.cam : '#7d6aa8';
      if (high) glow(ctx, C.cam, 14);
      ctx.beginPath();
      ctx.arc(cx, cy, R + 9, s1, s0);
      ctx.arc(cx, cy, R - 2, s0, s1, true);
      ctx.closePath(); ctx.fill();
      noGlow(ctx);
      ctx.fillStyle = '#0c131c';
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.22, 0, Math.PI * 2); ctx.fill();
      // cam phase arrow
      if (S.vvt > 0.5) {
        ctx.strokeStyle = rgba(C.cam, 0.8);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, -Math.PI / 2, -Math.PI / 2 - (S.vvt / 2) * D2R * 3, true); ctx.stroke();
      }

      // sensor
      ctx.fillStyle = cmpDead ? '#3a1a20' : '#2d2742';
      rr(ctx, cx - 9, cy - R - 34, 18, 20, 3); ctx.fill();
      ctx.fillStyle = '#1a1728';
      ctx.fillRect(cx - 5, cy - R - 16, 10, 5);
      ctx.strokeStyle = cmpDead ? C.bad : '#5a4d7e';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy - R - 34); ctx.quadraticCurveTo(cx + 20, cy - R - 46, cx + 42, cy - R - 42); ctx.stroke();
      if (high) {
        glow(ctx, C.cam, 12);
        ctx.strokeStyle = rgba(C.cam, 0.9);
        ctx.lineWidth = 1.2;
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx, cy - R - 11, 4 + i * 3, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke(); }
        noGlow(ctx);
      }
      ctx.fillStyle = cmpDead ? C.bad : C.muted;
      ctx.font = '700 9px "JetBrains Mono", monospace';
      ctx.fillText(cmpDead ? 'CMP ✕ FAIL' : 'CMP (Hall)', cx + 16, cy - R - 24);

      const tx = cx + R + 26;
      const lines = [
        ['Cam angle', `${psi.toFixed(0)}°`],
        ['Signal now', cmpDead ? 'none' : high ? 'HIGH (tab)' : 'low'],
        ['Cam phase (VVT)', `${(S.vvt || 0).toFixed(1)}° adv`],
        ['Pulses', '1 per 720° crank'],
        ['Gives the ECU', 'which stroke'],
      ];
      this.infoLines(ctx, tx, oy + 44, lines, Math.max(120, ox + colW - tx - 8));

      const ty = oy + 58 + 74 + 74 + 14, th = narrow ? 60 : H - ty - 8;
      this.trace(ctx, ox + 10, ty, colW - 20, th, theta, 720, (ang) => (cmpDead || S.rpm < 1 ? 0 : ECU.cmpSignal(ang, S.vvt) * 1.6 - 0.8), C.cam, 'last 720°');
    }
  };

  WheelView.prototype.infoLines = function (ctx, x, y, lines, maxW) {
    lines.forEach((ln, i) => {
      ctx.font = '600 9.5px Inter, sans-serif';
      ctx.fillStyle = C.dim;
      ctx.fillText(ln[0].toUpperCase(), x, y + i * 30);
      ctx.font = '700 12.5px "JetBrains Mono", monospace';
      ctx.fillStyle = C.text;
      let t = ln[1];
      while (ctx.measureText(t).width > maxW && t.length > 3) t = t.slice(0, -2) + '…';
      ctx.fillText(t, x, y + i * 30 + 14);
    });
  };

  // rolling trace: newest angle at the right edge
  WheelView.prototype.trace = function (ctx, x, y, w, h, theta, span, fn, col, label, shadeFn) {
    ctx.fillStyle = '#0a1017';
    rr(ctx, x, y, w, h, 8); ctx.fill();
    ctx.strokeStyle = '#18222f'; ctx.lineWidth = 1; ctx.stroke();
    const mid = y + h / 2;
    ctx.strokeStyle = '#162130';
    ctx.beginPath(); ctx.moveTo(x + 6, mid); ctx.lineTo(x + w - 6, mid); ctx.stroke();
    const N = Math.min(900, Math.floor(w * 1.5));
    const amp = h * 0.36;
    if (shadeFn) {
      ctx.fillStyle = rgba(C.accent, 0.07);
      for (let i = 0; i < N; i++) {
        const ang = theta - span + (span * i) / N;
        if (shadeFn(ang)) ctx.fillRect(x + 6 + (i / N) * (w - 12), y + 2, (w - 12) / N + 0.5, h - 4);
      }
    }
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.4;
    glow(ctx, col, 6);
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const ang = theta - span + (span * i) / N;
      const px = x + 6 + (i / N) * (w - 12);
      const py = mid - fn(ang) * amp;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
    noGlow(ctx);
    ctx.fillStyle = C.dim;
    ctx.font = '600 9px Inter, sans-serif';
    ctx.fillText(label, x + 10, y + 12);
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x + w - 6, mid - fn(theta) * amp, 3, 0, Math.PI * 2); ctx.fill();
  };

  ECU.WheelView = WheelView;
})();
