/* Four cut-away cylinders driven by the (slow-motion) visual crank angle. */
(function () {
  const ECU = window.ECU;
  const { fit, rr, glow, noGlow, hash, mix, rgba } = ECU.draw;
  const C = ECU.C;

  // base geometry (design units, x centred at 0)
  const G = { bw: 46, roof: 100, yc: 268, r: 34, l: 104, crown: 24, skirt: 18, camY: 36, vx: 22 };
  const STROKE_COL = ['#ff7a3d', '#a08a7a', '#3fc6ff', '#b98cff'];
  const STROKE_NAME = ['POWER', 'EXHAUST', 'INTAKE', 'COMPRESSION'];
  const T = (s, v) => ECU.t(s, v);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  function EngineView(canvas) {
    this.canvas = canvas;
    this.knockPending = [false, false, false, false];
    this.knockShown = [false, false, false, false];
    this.prevKnock = [0, 0, 0, 0];
    this.t = 0;
  }

  EngineView.prototype.cylState = function (S, c) {
    const F = S.faults;
    if (S.E.diesel) {
      // compression ignition: "spark" = the charge is hot enough to self-ignite
      const fuel = S.ecuOn && S.qMg > 0 && S.sync === 2 && !F.ckp;
      const ign = fuel && S.ignQ > 0.25;
      return { fuel, spark: ign, burn: ign && S.rpm > 60 };
    }
    const fuel = S.ecuOn && S.pw > 0 && !S.injCut[c] && !S.fuelCutAll && S.sync > 0;
    const spark = S.ecuOn && S.sync > 0 && S.rpm > 40 && !F.ckp && !(F.misfire3 && c === 2);
    return { fuel, spark, burn: fuel && spark && S.rpm > 60 && S.lambdaCyl[c] < 1.75 };
  };

  EngineView.prototype.render = function (S, theta, dtVis) {
    this.t += dtVis;
    const cw0 = this.canvas.clientWidth / 4;
    const k = Math.max(0.62, Math.min(cw0 / 230, 1.3));
    const H = Math.round(362 * k);
    const { ctx, w } = fit(this.canvas, H);
    ctx.clearRect(0, 0, w, H);
    const cw = w / 4;

    // knock latching: show knock at the next combustion of that cylinder
    for (let c = 0; c < 4; c++) {
      if (S.knockTrue[c] > this.prevKnock[c] + 0.05) this.knockPending[c] = true;
      this.prevKnock[c] = S.knockTrue[c];
    }

    // shared shafts
    ctx.save();
    ctx.scale(1, 1);
    const yc = G.yc * k, camY = G.camY * k;
    ctx.strokeStyle = '#223043';
    ctx.lineWidth = 7 * k;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(10, yc); ctx.lineTo(w - 10, yc); ctx.stroke();
    ctx.lineWidth = 4 * k;
    ctx.strokeStyle = '#1f2b3b';
    ctx.beginPath(); ctx.moveTo(10, camY); ctx.lineTo(w - 10, camY); ctx.stroke();
    ctx.restore();

    for (let c = 0; c < 4; c++) {
      ctx.save();
      ctx.translate(cw * c + cw / 2, 0);
      ctx.scale(k, k);
      this.drawCylinder(ctx, S, theta, c, cw / k);
      ctx.restore();
      if (c > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cw * c, 8); ctx.lineTo(cw * c, H - 8); ctx.stroke();
      }
    }
  };

  EngineView.prototype.drawCylinder = function (ctx, S, theta, c, cellW) {
    const L = ECU.localAngle(theta, c);
    const stroke = ECU.strokeOf(L);
    const cs = this.cylState(S, c);
    const a = ((L % 360) * Math.PI) / 180;
    const { bw, roof, yc, r, l } = G;
    const pinY = yc - (r * Math.cos(a) + Math.sqrt(l * l - r * r * Math.sin(a) ** 2));
    const crownY = pinY - G.crown;
    const cpx = r * Math.sin(a), cpy = yc - r * Math.cos(a);
    const vvt = S.vvt || 0;
    const liftIn = ECU.valveLift(L, 'in', vvt);
    const liftEx = ECU.valveLift(L, 'ex', 0);
    const rpm = S.rpm;
    const degPerMs = (rpm * 6) / 1000;
    const half = cellW / 2;

    // ---- spark / injection windows ----
    const D = S.E.diesel;
    // diesel: combustion starts ~7° after the start of the main injection (ignition delay)
    const adv = D ? (S.soi || 0) - 7 : S.sparkCyl[c] || 0;
    const Ls = (720 - adv + 720) % 720;
    const sinceSpark = (L - Ls + 720) % 720;
    const sparkNow = !D && cs.spark && sinceSpark < 16;
    const wasted = !D && cs.spark && S.sync === 1 && ((L - (Ls + 360) + 1440) % 720) < 16;
    const dwellDeg = Math.min(200, S.dwell * degPerMs);
    const dwellNow = !D && cs.spark && ((Ls - L + 720) % 720) < dwellDeg;
    let injNow = false, injProg = 0, injKind = '';
    if (D && cs.fuel) {
      // pilot, main (near TDC) and — during regeneration — a late post injection
      const win = (start, len, kind) => { const d = (L - start + 1440) % 720; if (d < Math.max(len, 3)) { injNow = true; injProg = d / Math.max(len, 3); injKind = kind; } };
      if (S.pilot) win(720 - S.pilotSoi, 4, 'pilot');
      win(720 - S.soi, Math.min(90, S.pw * degPerMs), 'main');
      if (S.postMg > 0) win(70, 10, 'post');
    } else if (cs.fuel) {
      const windows = S.batch ? [S.eoi, S.eoi - 360] : [S.eoi];
      const pwDeg = Math.min(680, S.pw * degPerMs);
      for (const eoi of windows) {
        const soi = eoi - pwDeg;
        const d = (L - soi + 1440) % 720;
        if (d < pwDeg) { injNow = true; injProg = d / pwDeg; }
      }
    }
    const burning = cs.burn && (sinceSpark < 200 + adv) && (stroke === 0 || stroke === 3 || sinceSpark < 60);

    // ---- intake & exhaust ports ----
    const portTop = 60, portBot = 84;
    ctx.save();
    // intake port
    const inFill = liftIn > 0.02 ? rgba(C.air, 0.22 + 0.25 * liftIn) : 'rgba(63,198,255,0.08)';
    ctx.fillStyle = inFill;
    ctx.beginPath();
    const pe = Math.min(half - 6, bw + 34);
    ctx.moveTo(-pe, portTop);
    ctx.lineTo(-54, portTop);
    ctx.quadraticCurveTo(-30, portTop + 2, -G.vx - 13, roof - 4);
    ctx.lineTo(-G.vx + 13, roof - 6);
    ctx.quadraticCurveTo(-28, portBot + 6, -54, portBot);
    ctx.lineTo(-pe, portBot);
    ctx.closePath();
    ctx.fill();
    // exhaust port
    const exhHot = S.egt > 200 ? Math.min(1, (S.egt - 200) / 700) : 0;
    ctx.fillStyle = liftEx > 0.02 ? rgba(mix('#a2826c', '#ff6a2a', exhHot * (cs.burn ? 1 : 0.2)), 0.3 + 0.3 * liftEx) : 'rgba(162,130,108,0.1)';
    ctx.beginPath();
    ctx.moveTo(pe, portTop);
    ctx.lineTo(54, portTop);
    ctx.quadraticCurveTo(30, portTop + 2, G.vx + 13, roof - 4);
    ctx.lineTo(G.vx - 13, roof - 6);
    ctx.quadraticCurveTo(28, portBot + 6, 54, portBot);
    ctx.lineTo(pe, portBot);
    ctx.closePath();
    ctx.fill();
    // flow dashes
    ctx.setLineDash([4, 8]);
    ctx.lineWidth = 2;
    if (liftIn > 0.05 && rpm > 30) {
      ctx.strokeStyle = rgba(C.air, 0.8);
      ctx.lineDashOffset = -this.t * 60;
      ctx.beginPath(); ctx.moveTo(-pe + 4, 72); ctx.quadraticCurveTo(-34, 72, -G.vx, roof + 6); ctx.stroke();
    }
    if (liftEx > 0.05 && rpm > 30) {
      ctx.strokeStyle = rgba(cs.burn ? '#ff9a5a' : '#b39a88', 0.8);
      ctx.lineDashOffset = -this.t * 60;
      ctx.beginPath(); ctx.moveTo(G.vx, roof + 6); ctx.quadraticCurveTo(34, 72, pe - 4, 72); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // ---- cylinder head block ----
    ctx.fillStyle = '#152030';
    ctx.strokeStyle = '#2a3a4f';
    ctx.lineWidth = 1.5;
    rr(ctx, -bw - 16, 14, 2 * bw + 32, 44, 8);
    ctx.fill(); ctx.stroke();

    // ---- gas in the chamber ----
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-bw, roof);
    ctx.lineTo(0, roof - 8);
    ctx.lineTo(bw, roof);
    ctx.lineTo(bw, crownY);
    ctx.lineTo(-bw, crownY);
    ctx.closePath();
    ctx.clip();
    const comp = 1 - (crownY - 106) / 70; // 0 at BDC .. 1 at TDC
    let gas;
    if (stroke === 2) gas = rgba(C.air, 0.16 + 0.1 * liftIn);
    else if (stroke === 3) gas = rgba(mix('#3fc6ff', D ? '#ff9a5a' : '#b98cff', comp), 0.22 + 0.35 * comp); // diesel: air heats up by compression
    else if (stroke === 0) gas = burning || cs.burn ? rgba(mix('#ff5a1f', '#6b2a12', L / 180), 0.55 - 0.25 * (L / 180)) : 'rgba(185,140,255,0.25)';
    else gas = rgba('#8c7564', 0.35 * (1 - (L - 180) / 180) + 0.05);
    ctx.fillStyle = gas;
    ctx.fillRect(-bw, roof - 10, 2 * bw, crownY - roof + 12);
    // fuel droplets during intake / compression (port injection only)
    if (!D && cs.fuel && (stroke === 2 || stroke === 3)) {
      const n = stroke === 2 ? Math.floor(4 + 22 * ((L - 360) / 180)) : 26;
      ctx.fillStyle = rgba(C.fuel, stroke === 2 ? 0.8 : 0.5 * (1 - comp) + 0.2);
      for (let i = 0; i < n; i++) {
        const px = (hash(i * 3.1 + c) - 0.5) * 2 * (bw - 4);
        const py = roof + hash(i * 7.7 + c * 2) * (crownY - roof);
        ctx.beginPath(); ctx.arc(px, py, stroke === 2 ? 1.6 : 1.2, 0, Math.PI * 2); ctx.fill();
      }
    }
    // diesel: combustion starts at the spray plumes; darker (sooty) near the smoke limit, pale when cold
    if (D && burning) {
      const prog = Math.min(1, sinceSpark / 30);
      const sooty = clamp((1.6 - S.lambda) / 0.5, 0, 1), pale = clamp((1 - S.ignQ) * 1.6, 0, 1);
      ctx.globalAlpha = sinceSpark < 110 ? 1 : Math.max(0, 1 - (sinceSpark - 110) / 90);
      for (const px of [-bw * 0.55, 0, bw * 0.55]) {
        const R = 6 + prog * 60;
        const grd = ctx.createRadialGradient(px, roof + 10, 0, px, roof + 10, R);
        grd.addColorStop(0, rgba(mix('#fff3c0', '#ffffff', pale), 0.95));
        grd.addColorStop(0.4, rgba(mix(mix('#ffb040', '#8a3a10', sooty), '#d8d8d8', pale), 0.85));
        grd.addColorStop(1, 'rgba(255,90,20,0)');
        ctx.fillStyle = grd;
        ctx.fillRect(-bw, roof - 10, 2 * bw, crownY - roof + 12);
      }
      ctx.globalAlpha = 1;
    }
    // flame front
    if (!D && burning) {
      const prog = Math.min(1, sinceSpark / (35 + adv * 0.8));
      const R = 6 + prog * 110;
      const grd = ctx.createRadialGradient(0, roof - 2, 0, 0, roof - 2, R);
      grd.addColorStop(0, 'rgba(255,255,220,0.95)');
      grd.addColorStop(0.35, 'rgba(255,200,80,0.85)');
      grd.addColorStop(0.75, 'rgba(255,110,30,0.65)');
      grd.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = grd;
      ctx.globalAlpha = sinceSpark < 120 ? 1 : Math.max(0, 1 - (sinceSpark - 120) / 100);
      ctx.fillRect(-bw, roof - 10, 2 * bw, crownY - roof + 12);
      ctx.globalAlpha = 1;
    }
    // knock: pressure waves from end-gas
    if (this.knockPending[c] && L > 4 && L < 80 && cs.burn) {
      this.knockShown[c] = true;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 3; i++) {
        const rr0 = ((L * 2.2 + i * 14) % 40) + 4;
        ctx.beginPath();
        for (let j = 0; j <= 16; j++) {
          const ang = (j / 16) * Math.PI * 2;
          const jag = rr0 + (j % 2 ? 3 : -2);
          const x = bw * 0.55 + Math.cos(ang) * jag, y = crownY - 16 + Math.sin(ang) * jag * 0.6;
          j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
    }
    if (this.knockShown[c] && L >= 80) { this.knockPending[c] = false; this.knockShown[c] = false; }
    ctx.restore();

    // ---- liner walls ----
    ctx.fillStyle = '#1b2736';
    ctx.fillRect(-bw - 8, roof - 2, 8, 140);
    ctx.fillRect(bw, roof - 2, 8, 140);
    // water jacket hint
    const ectT = Math.max(0, Math.min(1, (S.ect - 20) / 80));
    ctx.fillStyle = rgba(mix('#2a78ff', '#ff5a3a', ectT), 0.25);
    ctx.fillRect(-bw - 16, roof + 6, 7, 100);
    ctx.fillRect(bw + 9, roof + 6, 7, 100);

    // ---- piston ----
    const pg = ctx.createLinearGradient(-bw, 0, bw, 0);
    pg.addColorStop(0, '#5b6a7d'); pg.addColorStop(0.5, '#aab8c8'); pg.addColorStop(1, '#5b6a7d');
    ctx.fillStyle = pg;
    rr(ctx, -bw + 1, crownY, 2 * bw - 2, G.crown + G.skirt, 4);
    ctx.fill();
    ctx.strokeStyle = '#3a4757';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-bw + 1, crownY + 5 + i * 4); ctx.lineTo(bw - 1, crownY + 5 + i * 4); ctx.stroke(); }
    if (burning && stroke === 0) {
      ctx.fillStyle = 'rgba(255,120,40,0.35)';
      ctx.fillRect(-bw + 1, crownY, 2 * bw - 2, 3);
    }
    // wrist pin
    ctx.fillStyle = '#2a3544';
    ctx.beginPath(); ctx.arc(0, pinY, 5, 0, Math.PI * 2); ctx.fill();

    // ---- crank & rod ----
    ctx.save();
    ctx.translate(0, yc);
    ctx.rotate(a);
    ctx.fillStyle = '#2b384a';
    ctx.beginPath(); // counterweight
    ctx.moveTo(-26, 6);
    ctx.arc(0, 0, 44, Math.PI * 0.18, Math.PI * 0.82);
    ctx.lineTo(26, 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#39485c';
    rr(ctx, -12, -r - 10, 24, r + 20, 10);
    ctx.fill();
    ctx.restore();
    // main journal
    ctx.fillStyle = '#56657a';
    ctx.beginPath(); ctx.arc(0, yc, 9, 0, Math.PI * 2); ctx.fill();
    // rod
    ctx.strokeStyle = '#8796a8';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, pinY); ctx.lineTo(cpx, cpy); ctx.stroke();
    ctx.strokeStyle = '#b4c1cf';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, pinY); ctx.lineTo(cpx, cpy); ctx.stroke();
    ctx.fillStyle = '#c7d2de';
    ctx.beginPath(); ctx.arc(cpx, cpy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2a3544';
    ctx.beginPath(); ctx.arc(cpx, cpy, 3, 0, Math.PI * 2); ctx.fill();

    // ---- valves ----
    const drawValve = (x, lift, col) => {
      const y = roof - 3 + lift * 13;
      ctx.strokeStyle = '#9aa8b8';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, 48 + lift * 13); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = lift > 0.02 ? col : '#9aa8b8';
      ctx.beginPath();
      ctx.moveTo(x - 14, y + 3); ctx.lineTo(x + 14, y + 3); ctx.lineTo(x + 3, y - 3); ctx.lineTo(x - 3, y - 3);
      ctx.closePath(); ctx.fill();
      // spring
      ctx.strokeStyle = '#4b5a6d';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      const top = 42 + lift * 13, bot = 56;
      for (let i = 0; i <= 6; i++) { const yy = top + ((bot - top) * i) / 6; ctx.lineTo(x + (i % 2 ? 6 : -6), yy); }
      ctx.stroke();
    };
    drawValve(-G.vx, liftIn, C.air);
    drawValve(G.vx, liftEx, '#e0935a');

    // ---- camshafts (half crank speed) ----
    const drawCam = (x, lobeCenterLocal, col, lift) => {
      const dir = (((L - lobeCenterLocal) / 2) * Math.PI) / 180; // rotation of nose away from "down"
      ctx.save();
      ctx.translate(x, G.camY);
      ctx.rotate(dir);
      ctx.fillStyle = lift > 0.02 ? col : '#5c6b80';
      ctx.beginPath();
      for (let i = 0; i <= 36; i++) {
        const t = (i / 36) * Math.PI * 2;
        const nose = Math.max(0, Math.cos(t - Math.PI / 2));
        const rad = 8 + 6 * Math.pow(nose, 3);
        const px = Math.cos(t) * rad, py = Math.sin(t) * rad;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1b2533';
      ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };
    drawCam(-G.vx, 470 - vvt, C.air, liftIn);
    drawCam(G.vx, 251, '#e0935a', liftEx);

    if (D) this.drawDieselHead(ctx, S, injNow, injKind, injProg);
    // ---- spark plug & coil ----
    if (!D) {
    ctx.fillStyle = dwellNow ? rgba(C.spark, 0.3 + 0.5 * (1 - ((Ls - L + 720) % 720) / Math.max(dwellDeg, 1))) : '#232f40';
    rr(ctx, -7, 4, 14, 20, 3);
    ctx.fill();
    ctx.fillStyle = '#e8eef5';
    ctx.fillRect(-3, 24, 6, 22);
    ctx.fillStyle = '#8a99ab';
    ctx.fillRect(-4.5, 46, 9, 44);
    ctx.fillStyle = '#c6d0dc';
    ctx.fillRect(-1, 90, 2, 5);
    if (sparkNow || wasted) {
      const intensity = wasted ? 0.45 : 1 - sinceSpark / 16;
      glow(ctx, C.spark, 22);
      ctx.strokeStyle = rgba('#fffbe0', intensity);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 94);
      for (let i = 0; i < 4; i++) ctx.lineTo((hash(this.t * 50 + i) - 0.5) * 8, 96 + i * 2.5);
      ctx.stroke();
      const g2 = ctx.createRadialGradient(0, 97, 0, 0, 97, 22);
      g2.addColorStop(0, rgba('#fff7c0', 0.9 * intensity));
      g2.addColorStop(1, 'rgba(255,220,90,0)');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(0, 97, 22, 0, Math.PI * 2); ctx.fill();
      noGlow(ctx);
    }
    }

    // ---- injector (port injection, petrol) ----
    if (!D) {
    ctx.save();
    ctx.translate(-62, 50);
    ctx.rotate(0.62);
    ctx.fillStyle = injNow ? C.fuel : '#3a4a5e';
    rr(ctx, -5, -18, 10, 26, 3);
    ctx.fill();
    ctx.fillStyle = '#9aa8b8';
    ctx.fillRect(-2, 8, 4, 6);
    ctx.restore();
    if (injNow) {
      const nx = -55, ny = 61;
      ctx.save();
      const grd = ctx.createLinearGradient(nx, ny, -G.vx, roof - 6);
      grd.addColorStop(0, 'rgba(255,190,60,0.9)');
      grd.addColorStop(1, 'rgba(255,190,60,0.05)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(-G.vx - 12, roof - 8);
      ctx.lineTo(-G.vx + 8, roof - 12);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,210,110,0.9)';
      for (let i = 0; i < 10; i++) {
        const t = (hash(i + Math.floor(this.t * 20)) + injProg) % 1;
        const sx = nx + (-G.vx - 2 - nx) * t + (hash(i * 9 + this.t) - 0.5) * 10 * t;
        const sy = ny + (roof - 10 - ny) * t;
        ctx.beginPath(); ctx.arc(sx, sy, 1.3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    }

    // ---- labels ----
    ctx.textAlign = 'center';
    ctx.font = '700 12px Inter, sans-serif';
    ctx.fillStyle = C.text;
    ctx.fillText(T('CYL {c}', { c: c + 1 }), 0, 336);
    const sc = STROKE_COL[stroke];
    ctx.font = '800 9.5px Inter, sans-serif';
    const label = T(STROKE_NAME[stroke]);
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = rgba(sc, 0.18);
    rr(ctx, -tw / 2, 342, tw, 15, 4);
    ctx.fill();
    ctx.fillStyle = sc;
    ctx.fillText(label, 0, 353);

    // angle text
    ctx.font = '500 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = C.muted;
    const l360 = L % 360;
    const angTxt = l360 < 180 ? T('{a}° ATDC', { a: Math.round(l360) }) : T('{a}° BTDC', { a: Math.round(360 - l360) });
    ctx.fillText(angTxt, 0, 322);

    // event tags
    const tags = [];
    if (sparkNow) tags.push([T('⚡ SPARK {a}° BTDC', { a: adv.toFixed(0) }), C.spark]);
    else if (wasted) tags.push([T('wasted spark'), C.muted]);
    else if (dwellNow) tags.push([T('coil charging'), rgba(C.spark, 0.8)]);
    if (injNow && D) tags.push([injKind === 'main' ? T('MAIN {q} mg', { q: S.qMg.toFixed(1) }) : injKind === 'pilot' ? T('PILOT') : T('POST (regen)'), injKind === 'post' ? C.cam : C.fuel]);
    else if (injNow) tags.push([T('INJ {pw} ms', { pw: S.pw.toFixed(1) }), C.fuel]);
    if (D && S.glowOn && stroke === 3) tags.push([T('GLOW'), '#ff9a5a']);
    if (this.knockShown[c]) tags.push([T('KNOCK!'), '#ffffff']);
    if (S.faults.misfire3 && c === 2 && S.running && !ECU.hideTruth) tags.push([T('NO SPARK'), C.bad]);
    if (S.injCut[c]) tags.push([T('INJ CUT'), C.bad]);
    if (S.fuelCutAll && S.running && (S.dfco || S.revCut || S.overboostCut)) tags.push([S.dfco ? 'DFCO' : S.revCut ? T('REV CUT') : T('OB CUT'), C.warn]);
    ctx.font = '700 9.5px Inter, sans-serif';
    tags.slice(0, 2).forEach((tg, i) => {
      const y = 142 + i * 16;
      const tw2 = ctx.measureText(tg[0]).width + 10;
      ctx.fillStyle = 'rgba(7,11,17,0.85)';
      rr(ctx, -tw2 / 2, y - 10, tw2, 14, 4);
      ctx.fill();
      ctx.fillStyle = tg[1];
      ctx.fillText(tg[0], 0, y);
    });
    ctx.textAlign = 'left';
  };

  // diesel head: central piezo injector spraying into the piston bowl, glow plug beside it
  EngineView.prototype.drawDieselHead = function (ctx, S, injNow, kind, prog) {
    const { roof } = G;
    // glow plug (angled, tip glows with its temperature)
    ctx.save();
    ctx.translate(14, 30); ctx.rotate(-0.28);
    ctx.fillStyle = '#3a4a5e'; rr(ctx, -4, -14, 8, 16, 2); ctx.fill();
    ctx.fillStyle = '#8a99ab'; ctx.fillRect(-2, 2, 4, 56);
    const gt = S.glowTemp || 0;
    if (gt > 0.05) { glow(ctx, '#ff7a3d', 14 * gt); ctx.fillStyle = mix('#8a99ab', '#ffcc66', gt); ctx.fillRect(-2.5, 48, 5, 12); noGlow(ctx); }
    ctx.restore();
    // injector body
    ctx.fillStyle = injNow ? (kind === 'post' ? C.cam : C.fuel) : '#3a4a5e';
    rr(ctx, -6, 4, 12, 26, 3); ctx.fill();
    ctx.fillStyle = '#9aa8b8'; ctx.fillRect(-3, 30, 6, 58);
    ctx.fillStyle = '#c6d0dc'; ctx.fillRect(-1.5, 88, 3, 5);
    if (!injNow) return;
    // multi-hole spray plumes
    const len = (kind === 'pilot' ? 18 : 42) * (0.4 + 0.6 * Math.min(1, prog * 2));
    ctx.save();
    for (const ang of [-1.0, -0.5, 0, 0.5, 1.0]) {
      const ex = Math.sin(ang) * len, ey = Math.cos(ang) * len;
      const grd = ctx.createLinearGradient(0, roof - 6, ex, roof - 6 + ey);
      grd.addColorStop(0, kind === 'post' ? 'rgba(185,140,255,0.95)' : 'rgba(255,200,90,0.95)');
      grd.addColorStop(1, 'rgba(255,200,90,0)');
      ctx.strokeStyle = grd; ctx.lineWidth = kind === 'pilot' ? 1.5 : 3; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, roof - 6); ctx.lineTo(ex, roof - 6 + ey); ctx.stroke();
    }
    ctx.restore();
  };

  // Describe what's happening at this crank angle, for the "now" box
  EngineView.prototype.describe = function (S, theta) {
    const tag = (bg, fg, text, v) => `<span class="tag" style="background:${bg};color:${fg}">${T(text, v)}</span> `;
    if (S.E.diesel) return this.describeDiesel(S, theta, tag);
    if (!S.ecuOn) return T('Key OFF — the ECU is asleep. Turn the key to <b>ON</b>.');
    if (S.rpm < 5) {
      if (S.primeT > 0) return tag('#3a2a0a', '#ffc043', 'PRIME') + T('Fuel pump running for 2 s to pressurise the rail. All warning lamps lit for the bulb check.');
      return T('ECU awake, engine stopped. Oil and battery lamps on (no oil pressure, no charging). Press <b>START</b>.');
    }
    if (S.sync === 0) return tag('#3a2a0a', '#ffc043', 'CRANKING') + T('Starter spins the engine. The ECU counts CKP teeth, waiting for the <b>missing-tooth gap</b> — no fuel or spark until it knows the crank position.');
    const items = [];
    for (let c = 0; c < 4; c++) {
      const L = ECU.localAngle(theta, c);
      const adv = S.sparkCyl[c];
      const Ls = (720 - adv + 720) % 720;
      const since = (L - Ls + 720) % 720;
      const cs = this.cylState(S, c);
      const n = c + 1;
      if (cs.spark && since < 25) items.push({ p: 3, t: tag('#3a340a', '#ffe45c', 'IGN {c}', { c: n }) + T('Coil {c} fires at <b>{a}° BTDC</b> — spark starts combustion early so peak pressure lands ~15° after TDC.', { c: n, a: adv.toFixed(1) }) });
      if (cs.burn && L > 5 && L < 60) items.push({ p: 2, t: tag('#3a1a0a', '#ff7a3d', 'POWER {c}', { c: n }) + T('Burning gas pushes piston {c} down. The knock sensor is listening to cylinder {c} right now (knock window).', { c: n }) });
      const pwDeg = S.pw * S.rpm * 6 / 1000;
      const soi = (S.eoi - pwDeg + 720) % 720;
      if (cs.fuel && ((L - soi + 720) % 720) < pwDeg) items.push({ p: 2.5, t: tag('#3a2a0a', '#ffb020', 'INJ {c}', { c: n }) + T('Injector {c} open {pw} ms ({deg}° of crank) — {mg} mg sprayed onto the closed intake valve', { c: n, pw: S.pw.toFixed(2), deg: pwDeg.toFixed(0), mg: S.fuelMg.toFixed(1) }) + (S.batch ? T(' (batch mode: paired with its partner cylinder)') : '') + '.' });
      if (L > 348 && L < 372) items.push({ p: 1, t: tag('#0a2a3a', '#3fc6ff', 'OVERLAP {c}', { c: n }) + T('Cylinder {c} at exhaust TDC — both valves slightly open. The exiting exhaust helps pull fresh charge in.', { c: n }) });
      if (L > 540 && L < 560) items.push({ p: 1, t: tag('#2a1a3a', '#b98cff', 'COMP {c}', { c: n }) + T('Intake valve {c} closes — the trapped air mass is what MAF/MAP predicted. Compression begins.', { c: n }) });
    }
    const tooth = ECU.ckpTooth(theta);
    if (tooth.missing) items.push({ p: 2.8, t: tag('#0a3a2a', '#2ee6c5', 'CKP GAP') + T('The missing-tooth gap passes the crank sensor → the ECU re-confirms: next tooth = 90° BTDC of cylinders 1 & 4.') });
    if (ECU.cmpSignal(theta, S.vvt) && !S.faults.cmp) items.push({ p: 1.5, t: tag('#2a1a3a', '#b98cff', 'CMP') + T('Cam tab under the sensor — confirms cylinder 1 is approaching its <b>compression</b> TDC (not exhaust).') });
    items.sort((a, b) => b.p - a.p);
    return items.length ? items[0].t : T('Crank at {a}° — between events. Tooth #{n} under the CKP sensor.', { a: theta.toFixed(0), n: tooth.idx + 1 });
  };


  EngineView.prototype.describeDiesel = function (S, theta, tag) {
    if (!S.ecuOn) return T('Key OFF — the ECU is asleep. Turn the key to <b>ON</b>.');
    if (S.glowPhase === 'pre') return tag('#3a2a0a', '#ffb020', 'GLOW') + T('Glow plugs pre-heating the chambers ({s} s left). Wait for the glow lamp to go out, then crank.', { s: Math.max(0, S.glowT).toFixed(1) });
    if (S.rpm < 5) return T('ECU awake, engine stopped. Oil and battery lamps on (no oil pressure, no charging). Press <b>START</b>.');
    if (S.sync < 2) return tag('#3a2a0a', '#ffc043', 'CRANKING') + T('Starter spins the engine. The rail pressure must build up and the ECU must see the CKP gap and the cam pulse before it may inject.');
    const items = [];
    for (let c = 0; c < 4; c++) {
      const L = ECU.localAngle(theta, c), n = c + 1;
      const cs = this.cylState(S, c);
      const since = (L - (720 - S.soi) + 720) % 720;
      if (cs.fuel && since < Math.max(6, S.pw * S.rpm * 0.006)) items.push({ p: 3, t: tag('#3a2a0a', '#ffb020', 'MAIN {c}', { c: n }) + T('Main injection into cylinder {c}: {q} mg at {r} bar, starting {a}° BTDC, straight into the hot compressed air.', { c: n, q: S.qMg.toFixed(1), r: S.rail.toFixed(0), a: S.soi.toFixed(1) }) });
      else if (cs.fuel && S.pilot && ((L - (720 - S.pilotSoi) + 720) % 720) < 5) items.push({ p: 2.6, t: tag('#3a2a0a', '#ffd070', 'PILOT {c}', { c: n }) + T('A tiny pilot injection (~1.5 mg) in cylinder {c} starts burning first, so the main injection lights softly — less of the diesel clatter.', { c: n }) });
      if (cs.burn && L > 2 && L < 50) items.push({ p: 2, t: tag('#3a1a0a', '#ff7a3d', 'POWER {c}', { c: n }) + T('The fuel self-ignites in cylinder {c} — no spark plug. Compression to 16.5:1 heated the air to ~600 °C.', { c: n }) });
      if (S.postMg > 0 && L > 65 && L < 85) items.push({ p: 2.8, t: tag('#2a1a3a', '#b98cff', 'POST {c}', { c: n }) + T('Post-injection in cylinder {c}: too late to make torque — the fuel burns on the oxidation catalyst and heats the DPF for regeneration.', { c: n }) });
      if (L > 600 && L < 640) items.push({ p: 1, t: tag('#2a1a3a', '#ff9a5a', 'COMP {c}', { c: n }) + T('Cylinder {c} compressing pure air (no throttle, no fuel yet) — the temperature climbs towards auto-ignition.', { c: n }) });
    }
    items.sort((a, b) => b.p - a.p);
    return items.length ? items[0].t : T('Crank at {a}° — between events. Tooth #{n} under the CKP sensor.', { a: theta.toFixed(0), n: ECU.ckpTooth(theta).idx + 1 });
  };

  ECU.EngineView = EngineView;
})();
