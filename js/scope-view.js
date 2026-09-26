/* 720° timing diagram: strokes, CKP, CMP, injectors, coils, knock, crank speed. */
(function () {
  const ECU = window.ECU;
  const { fit, rr, glow, noGlow, hash, rgba } = ECU.draw;
  const C = ECU.C;
  const STROKE_COL = ['#ff7a3d', '#a08a7a', '#3fc6ff', '#b98cff'];
  const STROKE_WORD = ['POWER', 'EXHAUST', 'INTAKE', 'COMPRESSION'];
  const T = (s, v) => ECU.t(s, v);
  const CYL_COL = ['#ff7a8a', '#62d0ff', '#ffd166', '#8cf08a'];

  function ScopeView(canvas) {
    this.canvas = canvas;
    this.rows = [];
    this.knockMark = [0, 0, 0, 0];
    this.prevKnock = [0, 0, 0, 0];
    this.prevTheta = 0;
    this.hoverX = null;
  }

  ScopeView.prototype.layout = function (w) {
    const labelW = w < 700 ? 74 : 118;
    const x0 = labelW, x1 = w - 12;
    const rows = [];
    let y = 26;
    const add = (id, label, h, extra) => { rows.push(Object.assign({ id, label, y, h }, extra || {})); y += h; };
    for (let c = 0; c < 4; c++) add('stroke' + c, 'Strokes 1–4', 13, { c, kind: 'stroke', info: null });
    y += 8;
    add('ckp', 'CKP crank', 50, { kind: 'ckp', info: 'ckp' });
    y += 4;
    add('cmp', 'CMP cam', 28, { kind: 'cmp', info: 'cmp' });
    y += 8;
    for (let c = 0; c < 4; c++) add('inj' + c, 'Injector {c}', 17, { c, kind: 'inj', info: 'act:inj' });
    y += 8;
    for (let c = 0; c < 4; c++) add('ign' + c, 'Coil {c}', 19, { c, kind: 'ign', info: 'act:coil' });
    y += 8;
    add('knock', 'Knock sensor', 44, { kind: 'knock', info: 'knock' });
    y += 6;
    add('crank', 'Crank speed', 34, { kind: 'crank', info: 'ckp' });
    this.rows = rows;
    this.x0 = x0; this.x1 = x1;
    return y + 8;
  };

  ScopeView.prototype.xOf = function (ang) {
    return this.x0 + (((ang % 720) + 720) % 720) / 720 * (this.x1 - this.x0);
  };
  ScopeView.prototype.angleAt = function (x) {
    return Math.max(0, Math.min(719.9, ((x - this.x0) / (this.x1 - this.x0)) * 720));
  };
  ScopeView.prototype.hit = function (x, y) {
    if (x > this.x0) return null;
    for (const r of this.rows) if (y >= r.y && y < r.y + r.h && r.info) return r.info;
    return null;
  };

  ScopeView.prototype.render = function (S, theta) {
    const w = this.canvas.clientWidth;
    const H = this.layout(w);
    const { ctx } = fit(this.canvas, H);
    ctx.clearRect(0, 0, w, H);
    const th = ((theta % 720) + 720) % 720;
    const cx = this.xOf(th);
    const x0 = this.x0, x1 = this.x1, pw = x1 - x0;
    const small = w < 700;

    // knock latch (per visual cycle)
    for (let c = 0; c < 4; c++) {
      if (S.knockTrue[c] > this.prevKnock[c] + 0.05) this.knockMark[c] = 1;
      this.prevKnock[c] = S.knockTrue[c];
      const winEnd = (ECU.CYL_OFFSET[c] + 70) % 720;
      if (this.crossed(this.prevTheta, th, winEnd)) this.knockMark[c] *= 0.35;
    }
    this.prevTheta = th;

    // grid & axis
    ctx.font = `600 ${small ? 8.5 : 9.5}px "JetBrains Mono", monospace`;
    for (let a = 0; a <= 720; a += 30) {
      const x = x0 + (a / 720) * pw;
      const major = a % 180 === 0;
      ctx.strokeStyle = major ? '#223046' : '#131c28';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 20); ctx.lineTo(x, H - 6); ctx.stroke();
      if (major) {
        ctx.fillStyle = C.muted;
        ctx.textAlign = a === 720 ? 'right' : a === 0 ? 'left' : 'center';
        const cyl = { 0: 1, 180: 3, 360: 4, 540: 2, 720: 1 }[a];
        ctx.fillText(small ? `${a}°` : T('{a}° · TDC {c}', { a, c: cyl }), x, 13);
      }
    }
    ctx.textAlign = 'left';

    // label column
    ctx.font = `600 ${small ? 9 : 10.5}px Inter, sans-serif`;
    for (const r of this.rows) {
      if (r.kind === 'stroke' && r.c > 0) continue;
      const col = r.kind === 'inj' ? C.fuel : r.kind === 'ign' ? C.spark : r.kind === 'ckp' ? C.accent : r.kind === 'cmp' ? C.cam : r.kind === 'knock' ? '#ff8fa0' : r.kind === 'crank' ? C.info : C.muted;
      ctx.fillStyle = col;
      const SHORT = { stroke: 'Strokes', ckp: 'CKP', cmp: 'CMP', inj: 'INJ {c}', ign: 'IGN {c}', knock: 'Knock', crank: 'ω crank' };
      const label = T(small ? SHORT[r.kind] : r.label, { c: r.c + 1 });
      const yy = r.kind === 'stroke' ? r.y + 30 : r.y + r.h / 2 + 4;
      ctx.fillText(label, 8, yy);
      if (r.info && !small) { ctx.fillStyle = C.dim; ctx.fillText('ⓘ', x0 - 18, yy); }
    }

    const bright = (fn) => { ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, cx - x0, H); ctx.clip(); fn(); ctx.restore(); };
    const dim = (fn) => { ctx.save(); ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.rect(cx, 0, x1 - cx, H); ctx.clip(); fn(); ctx.restore(); };
    const both = (fn) => { dim(fn); bright(fn); };

    const rpm = S.rpm;
    const degPerMs = (rpm * 6) / 1000;
    const alive = S.ecuOn && rpm > 5;

    for (const r of this.rows) {
      const mid = r.y + r.h / 2;
      if (r.kind === 'stroke') {
        for (let s = 0; s < 4; s++) {
          const a0 = ECU.CYL_OFFSET[r.c] + s * 180;
          const seg = [[a0 % 720, (a0 % 720) + 180]];
          for (const [sa, sb] of seg) {
            for (const [pa, pb] of splitWrap(sa, sb)) {
              const xa = x0 + (pa / 720) * pw, xb = x0 + (pb / 720) * pw;
              ctx.fillStyle = rgba(STROKE_COL[s], 0.28);
              ctx.fillRect(xa + 0.5, r.y + 1, xb - xa - 1, r.h - 2);
              if (xb - xa > 30) {
                ctx.fillStyle = STROKE_COL[s];
                ctx.font = '700 8.5px Inter, sans-serif';
                ctx.fillText(xb - xa > 90 && !small ? `${r.c + 1}·${T(STROKE_WORD[s])}` : `${r.c + 1}${T(STROKE_WORD[s]).charAt(0)}`, xa + 4, r.y + r.h - 3);
              }
            }
          }
        }
        continue;
      }
      // row background
      ctx.fillStyle = 'rgba(10,16,23,0.6)';
      ctx.fillRect(x0, r.y, pw, r.h - 1);

      if (r.kind === 'ckp') {
        const dead = S.faults.ckp || !alive;
        const vr = S.ckpType === 'vr';
        const amp = (r.h / 2 - 5) * (vr ? Math.min(1, 0.25 + rpm / 2000) : 0.85);
        // gap shading
        ctx.fillStyle = rgba(C.accent, 0.1);
        [258, 618].forEach((g) => { const xa = this.xOf(g), xb = this.xOf(g + 12); ctx.fillRect(xa, r.y, xb - xa, r.h - 1); });
        both(() => {
          ctx.strokeStyle = C.accent;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          const N = Math.max(1440, Math.floor(pw * 3));
          for (let i = 0; i <= N; i++) {
            const a = (i / N) * 720;
            let v = dead ? 0 : ECU.ckpSignal(a, S.ckpType, rpm);
            if (!vr) v = v * 2 - 1;
            const x = x0 + (a / 720) * pw, y = mid - v * amp;
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        });
        if (!small) {
          ctx.fillStyle = rgba(C.accent, 0.8);
          ctx.font = '600 8.5px Inter, sans-serif';
          ctx.fillText(T('gap → tooth 1 = 90° BTDC'), this.xOf(258) + 2, r.y + 9);
        }
      } else if (r.kind === 'cmp') {
        const dead = S.faults.cmp || !alive;
        both(() => {
          ctx.strokeStyle = C.cam;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const N = 720;
          for (let i = 0; i <= N; i++) {
            const a = i;
            const v = dead ? 0 : ECU.cmpSignal(a, S.vvt);
            const x = x0 + (a / 720) * pw, y = r.y + r.h - 5 - v * (r.h - 10);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        });
        if (S.faults.cmp) { ctx.fillStyle = C.bad; ctx.font = '700 9px Inter'; ctx.fillText(T('NO SIGNAL — ECU in batch-fire / wasted-spark fallback'), x0 + 8, mid + 3); }
      } else if (r.kind === 'inj') {
        const c = r.c;
        const on = alive && S.pw > 0 && !S.injCut[c] && !S.fuelCutAll && S.sync > 0;
        const pwDeg = Math.min(700, S.pw * degPerMs);
        const eois = S.batch ? [S.eoi, S.eoi - 360] : [S.eoi];
        // intake valve open window for reference
        const ivo = ECU.CYL_OFFSET[c] + 350 - (S.vvt || 0);
        for (const [pa, pb] of splitWrap(ivo % 720, (ivo % 720) + 240)) {
          ctx.fillStyle = 'rgba(63,198,255,0.07)';
          ctx.fillRect(this.xOf(pa), r.y + 1, ((pb - pa) / 720) * pw, r.h - 3);
        }
        both(() => {
          ctx.strokeStyle = C.fuel;
          ctx.fillStyle = rgba(C.fuel, 0.35);
          ctx.lineWidth = 1.3;
          const base = r.y + r.h - 3, top = r.y + 3;
          ctx.beginPath();
          ctx.moveTo(x0, base); ctx.lineTo(x1, base); ctx.stroke();
          if (on) {
            for (const eoi of eois) {
              const g1 = ECU.CYL_OFFSET[c] + eoi;
              const g0 = g1 - pwDeg;
              for (const [pa, pb] of splitWrap(((g0 % 720) + 720) % 720, ((g0 % 720) + 720) % 720 + pwDeg)) {
                const xa = x0 + (pa / 720) * pw, xb = x0 + (pb / 720) * pw;
                ctx.fillRect(xa, top, Math.max(1.5, xb - xa), base - top);
                ctx.beginPath(); ctx.moveTo(xa, base); ctx.lineTo(xa, top); ctx.lineTo(xb, top); ctx.lineTo(xb, base); ctx.stroke();
              }
            }
          }
        });
        if (on && !small) {
          const g1 = (ECU.CYL_OFFSET[c] + S.eoi) % 720;
          ctx.fillStyle = C.fuel;
          ctx.font = '600 8.5px "JetBrains Mono", monospace';
          const t = `${S.pw.toFixed(2)} ms`;
          ctx.fillText(t, Math.min(this.xOf(g1) + 4, x1 - 50), r.y + r.h - 5);
        }
        if (S.injCut[c]) { ctx.fillStyle = C.bad; ctx.font = '700 9px Inter'; ctx.fillText(T('INJECTOR CUT (misfire protection)'), x0 + 8, mid + 3); }
      } else if (r.kind === 'ign') {
        const c = r.c;
        const dead = S.faults.misfire3 && c === 2;
        const on = alive && S.sync > 0 && !S.faults.ckp;
        const adv = S.sparkCyl[c];
        const dwellDeg = Math.min(200, S.dwell * degPerMs);
        const sparks = S.batch ? [ECU.CYL_OFFSET[c] - adv, ECU.CYL_OFFSET[c] - adv + 360] : [ECU.CYL_OFFSET[c] - adv];
        both(() => {
          const base = r.y + r.h - 3, top = r.y + 3;
          ctx.strokeStyle = rgba(C.spark, 0.9);
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(x0, base); ctx.lineTo(x1, base); ctx.stroke();
          if (!on) return;
          sparks.forEach((sa, k) => {
            const g = ((sa % 720) + 720) % 720;
            const d0 = g - dwellDeg;
            // dwell ramp (coil current rising)
            ctx.fillStyle = rgba(C.spark, 0.18);
            ctx.beginPath();
            const pts = [];
            for (let i = 0; i <= 12; i++) {
              const a = d0 + (dwellDeg * i) / 12;
              pts.push([this.xOf(a), base - (base - top) * 0.75 * (i / 12)]);
            }
            // handle wrap by drawing points individually as small columns
            for (let i = 0; i < pts.length - 1; i++) {
              if (pts[i + 1][0] < pts[i][0]) continue;
              ctx.fillRect(pts[i][0], pts[i][1], pts[i + 1][0] - pts[i][0] + 0.5, base - pts[i][1]);
            }
            if (!dead) {
              const x = this.xOf(g);
              glow(ctx, C.spark, 8);
              ctx.strokeStyle = k === 1 ? rgba(C.spark, 0.5) : '#fff6b0';
              ctx.lineWidth = 2;
              ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, top - 1); ctx.stroke();
              noGlow(ctx);
            }
          });
        });
        if (on && !small) {
          const g = ((ECU.CYL_OFFSET[c] - adv) % 720 + 720) % 720;
          ctx.fillStyle = dead ? C.bad : C.spark;
          ctx.font = '600 8.5px "JetBrains Mono", monospace';
          const t = dead ? T('coil dead') : T('{a}° BTDC', { a: adv.toFixed(1) }) + (S.knockRetard[c] > 0.3 ? '  ' + T('(−{k}° knock)', { k: S.knockRetard[c].toFixed(1) }) : '');
          const tx = this.xOf(g) + 5;
          ctx.fillText(t, tx > x1 - 150 ? this.xOf(g) - ctx.measureText(t).width - 6 : tx, r.y + 10);
        }
      } else if (r.kind === 'knock') {
        // knock windows
        for (let c = 0; c < 4; c++) {
          const a = ECU.CYL_OFFSET[c] + 10;
          const xa = this.xOf(a), xb = this.xOf(a + 50);
          ctx.fillStyle = rgba(CYL_COL[c], 0.08);
          ctx.fillRect(xa, r.y, xb - xa, r.h - 1);
          ctx.fillStyle = rgba(CYL_COL[c], 0.7);
          ctx.font = '700 8px Inter';
          ctx.fillText(T('win {c}', { c: c + 1 }), xa + 2, r.y + 9);
        }
        const dead = S.faults.knocksensor;
        const nAmp = alive ? Math.min(1, 0.15 + rpm / 7000) : 0.03;
        both(() => {
          ctx.strokeStyle = '#ff8fa0';
          ctx.lineWidth = 1;
          ctx.beginPath();
          const N = Math.floor(pw * 1.2);
          for (let i = 0; i <= N; i++) {
            const a = (i / N) * 720;
            let v = (hash(i * 1.37) - 0.5) * nAmp * 0.5;
            if (alive) {
              for (let c = 0; c < 4; c++) {
                const L = ((a - ECU.CYL_OFFSET[c]) % 720 + 720) % 720;
                if (L < 50) v += (hash(i * 3.1) - 0.5) * nAmp * 0.35 * (1 - L / 50); // combustion noise
                const km = this.knockMark[c];
                if (km > 0.05 && L > 12 && L < 60) v += Math.sin(L * 5.2) * Math.exp(-(L - 12) / 14) * km * 1.1;
              }
            }
            if (dead) v = 0;
            const x = x0 + (a / 720) * pw, y = mid - v * (r.h / 2 - 3);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        });
        if (dead) { ctx.fillStyle = C.bad; ctx.font = '700 9px Inter'; ctx.fillText(T('SENSOR FAILED — ECU is deaf, uses safe retarded spark'), x0 + 8, mid + 3); }
      } else if (r.kind === 'crank') {
        const scale = alive ? Math.max(0.3, Math.min(1.4, 1300 / Math.max(rpm, 300))) : 0;
        both(() => {
          ctx.strokeStyle = C.info;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          for (let i = 0; i <= 720; i += 2) {
            let v = 0;
            for (let c = 0; c < 4; c++) {
              const L = ((i - ECU.CYL_OFFSET[c]) % 720 + 720) % 720;
              if (L < 180) {
                const cs = S.ecuOn && S.sync > 0 && S.pw > 0 && !S.injCut[c] && !(S.faults.misfire3 && c === 2) && !S.fuelCutAll;
                v += cs ? Math.sin((L / 180) * Math.PI * 2) * 0.55 + 0.12 : -Math.sin((L / 180) * Math.PI) * 0.8;
              }
            }
            const x = x0 + (i / 720) * pw, y = mid - v * scale * (r.h / 2 - 3);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          }
          ctx.stroke();
        });
        const mis = S.faults.misfire3 && S.running;
        if (mis) {
          const xa = this.xOf(ECU.CYL_OFFSET[2]), xb = this.xOf(ECU.CYL_OFFSET[2] + 180);
          ctx.fillStyle = 'rgba(255,77,94,0.12)';
          ctx.fillRect(xa, r.y, xb - xa, r.h - 1);
          ctx.fillStyle = C.bad; ctx.font = '700 9px Inter';
          ctx.fillText(T('cyl 3 segment slows → misfire'), xa + 4, r.y + 10);
        }
      }
    }

    // cursor
    glow(ctx, C.accent, 12);
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(cx, 18); ctx.lineTo(cx, H - 4); ctx.stroke();
    noGlow(ctx);
    ctx.fillStyle = C.accent;
    ctx.beginPath(); ctx.moveTo(cx - 5, 18); ctx.lineTo(cx + 5, 18); ctx.lineTo(cx, 25); ctx.closePath(); ctx.fill();

    // hover crosshair
    if (this.hoverX != null && this.hoverX > x0 && this.hoverX < x1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(this.hoverX, 20); ctx.lineTo(this.hoverX, H - 4); ctx.stroke();
      ctx.setLineDash([]);
    }
  };

  ScopeView.prototype.crossed = function (prev, cur, mark) {
    if (cur >= prev) return mark > prev && mark <= cur;
    return mark > prev || mark <= cur;
  };

  function splitWrap(a, b) {
    if (b <= 720) return [[a, b]];
    return [[a, 720], [0, b - 720]];
  }

  ECU.ScopeView = ScopeView;
})();
