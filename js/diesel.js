/* Common-rail diesel (2.0 TDI-style): physics + ECU strategy.
   Torque comes from the injected fuel quantity (no throttling); the air is whatever the turbo
   supplies minus what EGR displaces. DOM-free, runs headless. Loaded after sim.js. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const ECU = (root.ECU = root.ECU || {});
  const X = ECU._sim;
  const { clamp, lerp, R, PI4, log, edge, setDTC, orifice, interp2, noise } = X;
  const LHV = 42500; // J/g diesel
  const AFR = 14.5;  // stoichiometric air/fuel ratio of diesel
  const SOOT_ACCEL = 40; // soot build-up sped up so a DPF regeneration happens within a session

  ECU.ENGINES.diesel = {
    id: 'diesel', name: '2.0 TDI', label: 'Common-rail diesel 2.0 L I4 (VGT, EGR, DPF)', diesel: true, turbo: true,
    vd: 0.002, cr: 16.5, redline: 4800, idle: 800, airRef: 0.6, etaTh: 0.44, thrArea: 4.5e-3,
    fricK: 1.3, starterT: 165, compPulse: 40, heatK: 5200,
    turboMax: 235, turboFlowRef: 90, boostK: 185, turboTau: 0.55,
    qMax: (rpm) => (rpm < 1000 ? 38 : rpm < 1700 ? lerp(38, 64, (rpm - 1000) / 700) : rpm < 2600 ? 64 : lerp(64, 44, clamp((rpm - 2600) / 2000, 0, 1))),
    ve(rpm) { return 0.9 - 0.12 * ((rpm - 2200) / 2600) ** 2; },
  };

  /* ---------- calibration maps ---------- */
  const AX = { rpm: [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000], pedal: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100], q: [0, 5, 10, 15, 20, 30, 40, 50, 60, 70] };
  ECU.DIESEL_AXES = AX;
  // which rule set the injected quantity (shown in the brain panel and the maps panel)
  ECU.DIESEL_LIMITERS = { idle: 'idle governor', driver: 'driver’s wish', smoke: 'smoke limiter', torque: 'torque limiter', limp: 'limp mode', rpm: 'rpm limiter', cut: 'overrun cut', sync: 'waiting for sync', off: 'no injection' };
  ECU.makeDieselCal = function (E, { table }) {
    return {
      // driver's wish: injected quantity (mg/stroke) requested for pedal & rpm (limiters apply afterwards)
      quantity: table(AX.rpm, AX.pedal, (rpm, p) => (p < 1 ? 0 : Math.pow(p / 100, 1.15) * E.qMax(rpm) * 1.05), 0.5),
      // start of main injection (° BTDC)
      soi: table(AX.rpm, AX.q, (rpm, q) => clamp(1 + (rpm / 1000) * 2.4 - q * 0.035, -2, 14), 0.5),
      // boost target (bar above ambient)
      boostD: table(AX.rpm, AX.q, (rpm, q) => clamp((q - 8) / 50, 0, 1) * (rpm < 1300 ? 0.6 : rpm < 3800 ? 1.25 : 1.1), 0.05),
    };
  };

  ECU.initDiesel = function (S) {
    Object.assign(S, {
      rail: 0, railTarget: 0, railMax: 0, qMg: 0, qDriver: 0, qSmoke: 99, qTorque: 99, qIdle: 0, qIdleI: 0, limiter: 'off',
      soi: 0, pilot: false, pilotSoi: 0, postMg: 0, egrPos: 0, egrCmd: 0, egrRate: 0, egrGs: 0, egrI: 0, mafTarget: 0,
      glowOn: false, glowT: 0, glowPhase: 'off', glowTemp: 0, glowChecked: false, soot: 8, sootEst: 8, dpfDp: 0, dpfT: 20,
      regen: false, regenT: 0, nox: 0, sootRate: 0, fuelTemp: 20, lambdaWB: 9, lamWB: 9, lamSensorT: 20, ignQ: 1,
      smoke: 0, railLeak: 0, leakT: 0, egrDevT: 0, dpfLimp: false, ashFake: 0, docT: 20, catHot: 0, boostOk: 0, egrOkT: 0, pmT: 0,
    });
    S.throttle = 100; S.throttleCmd = 100;
    S.ect = S.oilT = S.iat = S.chargeT = S.egt = S.ambient; S.dpfT = S.docT = S.ambient;
  };

  function stepDiesel(S, dt) {
    const E = S.E, F = S.faults;
    S.t += dt;
    const { T_ambK, dynoOn } = X.keyPower(S, dt);

    /* ---------------- air path: turbo → (throttle flap) → manifold, plus EGR ---------------- */
    S.throttle += ((S.ecuOn ? S.throttleCmd : 100) - S.throttle) * (1 - Math.exp(-dt / 0.08));
    const flap = clamp(S.throttle, 0, 100) / 100;
    const Athr = E.thrArea * (0.004 + flap * flap);
    const pUp = S.boostP - 1.2 * (S.airGs / 150) ** 2;
    // EGR: fraction of the cylinder charge that is recirculated exhaust (needs exhaust back-pressure)
    const egrGoal = F.egropen ? 1 : F.egrclosed ? 0 : S.egrCmd;
    S.egrPos += (egrGoal - S.egrPos) * (1 - Math.exp(-dt / 0.12));
    const boostRel = S.boostP - S.baro;
    S.egrRate = S.rpm > 200 ? 0.55 * S.egrPos * clamp(1.25 - boostRel / 140, 0.25, 1) : 0;
    const tIntK = S.chargeT + 273.15 + 5 + S.egrRate * 70; // cooled EGR still warms the charge
    const rpmNow = S.rpm;
    const mTot = (P) => (X.veAt(E, rpmNow, P) * P * 1000 * E.vd) / (R * tIntK) * rpmNow / 120;
    let lo = 1, hi = Math.max(pUp, 2);
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (orifice(Athr, pUp, mid, tIntK) - mTot(mid) * (1 - S.egrRate) > 0) lo = mid; else hi = mid;
    }
    const mapPrev = S.map;
    S.map += ((lo + hi) / 2 - S.map) * (1 - Math.exp(-dt / 0.05));
    const dPdt = (S.map - mapPrev) / dt;
    const totKg = mTot(S.map);
    const freshKg = totKg * (1 - S.egrRate);
    S.airGs = freshKg * 1000;
    S.egrGs = (totKg - freshKg) * 1000;
    const inflow = Math.max(0, freshKg + (0.003 / (R * tIntK)) * dPdt * 1000) * 1000;
    S.mafTrue = F.boostleak && boostRel > 5 ? inflow * 1.18 : inflow;
    S.airPerCyl = S.rpm > 5 ? S.airGs / (S.rpm / 30) : 0;

    /* ---------------- high-pressure rail ---------------- */
    const pumpMax = S.rpm > 30 ? Math.min(2000, 150 + S.rpm * 1.1) : 0; // cam-driven pump: needs rotation
    let railMax = pumpMax * (F.injleak3 ? 0.75 : 1);
    if (F.fuelpump) railMax = Math.min(railMax, 1900 - S.qMg * S.rpm * 0.009); // weak supply pump starves the HP pump
    S.railMax = railMax;
    const railGoal = S.ecuOn ? Math.min(S.railTarget, railMax) : 0;
    S.rail += (railGoal - S.rail) * (1 - Math.exp(-dt / (railGoal > S.rail ? 0.12 : 0.6)));
    S.fuelP = S.rail / 100; // bar/100 for shared gauges that expect "fuel pressure"
    S.railLeak = F.injleak3 && S.rail > 100 ? 3 + S.rail * 0.004 : 0; // mg per cycle dribbling into cyl 3

    /* ---------------- combustion (compression ignition) ---------------- */
    const canFire = S.ecuOn && S.sync > 0 && S.rpm > 60 && !F.ckp && S.rail > 140;
    // auto-ignition needs heat: cold engines rely on the glow plugs (ignQ = fraction of good combustions)
    S.glowTemp += ((S.glowOn && !F.glowplug ? 1 : 0) - S.glowTemp) * (1 - Math.exp(-dt / (S.glowOn ? 1.6 : 4)));
    const compHeat = clamp((S.ect + 12) / 26, 0, 1) + 0.9 * S.glowTemp + (S.rpm > 450 ? 0.15 : 0);
    S.ignQ = clamp(compHeat, 0, 1);
    const soiOpt = 4 + S.rpm / 900;
    const effSoi = clamp(1 - 0.0022 * (S.soi - soiOpt) ** 2, 0.4, 1);
    let Tind = 0, fuelSum = 0, burnt = 0, airSum = 0, sootG = 0;
    for (let c = 0; c < 4; c++) {
      let q = canFire && S.limiter !== 'cut' ? S.qMg : 0;
      if (canFire && c === 2) q += S.railLeak; // leaking injector dribbles extra, badly atomised fuel
      const fg = q / 1000, air = S.airPerCyl;
      fuelSum += fg; airSum += air;
      const lam = fg > 0 ? air / (fg * AFR) : 9;
      S.lambdaCyl[c] = Math.min(lam, 9);
      if (fg <= 0) continue;
      const burnFrac = S.ignQ * (lam >= 1.05 ? 1 : clamp(lam - 0.05, 0.3, 1));
      const effLam = lam > 1.35 ? 1 : clamp(1 - (1.35 - lam) * 0.9, 0.5, 1);
      const e = fg * burnFrac * LHV * E.etaTh * effSoi * effLam * (c === 2 && F.injleak3 ? 0.85 : 1);
      Tind += e / PI4;
      burnt += fg * burnFrac;
      // soot: rises steeply towards λ≈1.2, with EGR (less O2) and poorly atomised fuel
      sootG += fg * (0.0006 + 0.03 * Math.exp(-(lam - 1.1) * 3.2) + S.egrRate * 0.004 + (c === 2 && F.injleak3 ? 0.01 : 0)) * (700 / Math.max(S.rail, 250));
    }
    S.fuelRateGs = (fuelSum + (S.postMg * 4) / 1000) * (S.rpm / 120);
    S.lambda = fuelSum > 0 ? clamp(airSum / (fuelSum * AFR), 0.5, 9) : 9;
    if (S.rpm < 30) S.lambda = 9;
    S.sootRate = sootG * (S.rpm / 120); // g/s (real scale)
    S.smoke = clamp(S.sootRate * 60 + (canFire && S.ignQ < 0.9 && S.qMg > 0 ? (1 - S.ignQ) * 1.5 : 0), 0, 2); // visual: black (soot) / white (unburnt, cold)
    // NOx: needs oxygen + heat; EGR and late injection suppress it
    const loadF = clamp(S.qMg / 60, 0, 1.2);
    S.nox = S.running && burnt > 0 ? clamp(1400 * Math.pow(loadF, 0.7) * (1 - 1.5 * S.egrRate) * (1 + 0.05 * (S.soi - 4)) * clamp(S.lambda / 1.5, 0.4, 1.3), 25, 2500) : 0;

    /* ---------------- rotation, vehicle, turbo, fluids (shared) ---------------- */
    X.rotation(S, dt, Tind, dynoOn, (c) => canFire && ((F.injleak3 && c === 2) || S.ignQ < 0.95));
    X.turboStep(S, dt, T_ambK);

    const loadN = clamp(S.qMg / 60, 0, 1.5);
    X.fluidsStep(S, dt, loadN);
    S.fuelTemp += (S.ambient + 18 + S.rail / 55 - S.fuelTemp) * (dt / 20);

    /* ---------------- exhaust temperatures, DOC, DPF ---------------- */
    let egtT;
    if (S.running && fuelSum > 0) egtT = 110 + 540 * Math.pow(clamp(S.qMg / 60, 0, 1.3), 0.8) + S.rpm * 0.02 + (S.postMg > 0 ? 70 : 0) - 3 * (S.soi - soiOpt);
    else egtT = S.ect + (S.rpm > 300 ? 50 : 0);
    S.egt += (egtT - S.egt) * (1 - Math.exp(-dt / (egtT > S.egt ? 1.3 : 3.5)));
    const postTurb = S.egt - 60 - 60 * clamp(boostRel / 120, 0, 1);
    // DOC burns the post-injected fuel (only once it's lit off, > ~200 °C) → heats the DPF
    const docLit = S.docT > 200 ? 1 : 0;
    const exhGs = S.airGs + S.fuelRateGs + 0.1;
    const docExo = docLit * ((S.postMg * 4) / 1000) * (S.rpm / 120) * LHV / Math.max(exhGs, 3) * 0.95;
    S.docT += (postTurb + docExo * 0.6 - S.docT) * (1 - Math.exp(-dt / 2.5));
    S.dpfT += (S.docT + docExo * 0.4 - S.dpfT) * (1 - Math.exp(-dt / 4));
    // soot in the filter: accumulation vs passive (NO2, > 300 °C) and active (O2, > 550 °C) burn-off
    const passive = 0.0006 * Math.max(0, (S.dpfT - 300) / 100);
    const active = 0.018 * Math.pow(Math.max(0, (S.dpfT - 540) / 60), 1.5);
    const burn = S.soot * (passive + active) * (F.dpfclog ? 0.3 : 1);
    S.soot = clamp(S.soot + (S.sootRate * SOOT_ACCEL - burn) * dt, 0, 80);
    S.ashFake = F.dpfclog ? 42 : 0; // ash can't be burned: the filter reads permanently "full"
    const flowF = Math.pow(exhGs / 60, 1.25);
    S.dpfDp = S.rpm > 30 ? (4 + (S.soot + S.ashFake) * 1.6) * flowF + 0.5 : 0;

    /* ---------------- wideband lambda sensor ---------------- */
    S.lamSensorT += ((S.ecuOn && S.rpm > 300 ? 780 : Math.max(S.ambient, S.egt * 0.5)) - S.lamSensorT) * (1 - Math.exp(-dt / 6));
    S.lamWB += (Math.min(S.lambda, 9) - S.lamWB) * (1 - Math.exp(-dt / 0.15));
    S.lambdaWB = S.lamSensorT > 600 ? S.lamWB : NaN;
    S.o2v = 0.45; S.o2dn = 0.45; S.spark = S.soi; // shared displays (trends, dyno) show injection timing

    ecuDiesel(S, dt);
    if (S.dyno) X.dynoStep(S, dt);
  }
  ECU.stepDiesel = stepDiesel;

  /* ============================== diesel ECU ============================== */
  function ecuDiesel(S, dt) {
    const E = S.E, F = S.faults, sens = S.sens;
    sens.rpm = F.ckp ? 0 : S.rpm;
    sens.maf = F.maf ? 0 : Math.max(0, S.mafTrue * (1 + noise(0.01)));
    sens.map = F.map ? 0 : S.map;
    sens.ect = F.ect ? -40 : S.ect;
    sens.iat = F.iat ? -40 : S.iat;
    sens.boost = F.map ? 0 : S.boostP;
    sens.vss = S.v * 3.6;
    if (!S.ecuOn) {
      S.qMg = 0; S.pw = 0; S.injDuty = 0; S.fuelMg = 0; S.fuelPump = false; S.running = false; S.limiter = 'off'; S.glowOn = false; S.glowPhase = 'off';
      S.railTarget = 0; S.postMg = 0; S.regen = false; S.fuelCutAll = true; S.glowChecked = false; S.startHoldT = 0;
      edge(S, 'running', false);
      return;
    }
    const ectU = F.ect ? 80 : sens.ect;
    if (F.ect && S.bootT > 0.5) setDTC(S, 'P0118');
    if (F.iat && S.bootT > 0.5) setDTC(S, 'P0113');
    if (F.map && S.bootT > 0.5) setDTC(S, 'P0107');

    // glow plugs: circuit check at key-on, pre-glow when cold, post-glow after start
    if (!S.glowChecked && S.bootT > 0.2) {
      S.glowChecked = true;
      if (F.glowplug) setDTC(S, 'P0670');
      if (ectU < 25) {
        S.glowPhase = 'pre';
        S.glowT = clamp((25 - ectU) * 0.18 + 1.5, 1.5, 8);
        log(S, 'Glow plugs pre-heating for {s} s (coolant {t} °C) — wait for the glow lamp to go out before cranking.', 'info', { s: S.glowT.toFixed(1), t: ectU.toFixed(0) });
      }
    }
    if (S.glowPhase === 'pre') { S.glowT -= dt; if (S.glowT <= 0) { S.glowPhase = S.running ? 'post' : 'ready'; S.glowT = 0; } }
    if (S.glowPhase === 'ready' && S.running) { S.glowPhase = ectU < 40 ? 'post' : 'off'; S.glowT = 25; }
    if (S.glowPhase === 'post') { S.glowT -= dt; if (S.glowT <= 0 || ectU > 60) S.glowPhase = 'off'; }
    S.glowOn = S.glowPhase === 'pre' || S.glowPhase === 'ready' || S.glowPhase === 'post' || (S.cranking && ectU < 25);

    // crank/cam sync (without a cam signal the ECU finds the stroke from crank-speed signature: slower)
    if (sens.rpm > 40) {
      S.syncAngle += sens.rpm * 6 * dt;
      if (S.sync === 0 && S.syncAngle >= 360) S.sync = 1;
      if (S.sync === 1 && S.syncAngle >= (F.cmp ? 4000 : 720)) {
        S.sync = 2;
        log(S, F.cmp ? 'No cam signal — stroke identified from the crank-speed signature after a long crank. Injection enabled.' : 'CKP gap + CMP pulse → full sync. Common-rail injection enabled.', F.cmp ? 'warn' : 'ok');
      }
      if (F.cmp && S.syncAngle > 1440) setDTC(S, 'P0340');
    } else {
      if (S.sync > 0) log(S, 'Crank signal lost → sync dropped, injection & spark stopped.', S.rpm > 200 ? 'fault' : 'info');
      S.sync = 0; S.syncAngle = 0;
    }
    if (F.ckp && S.rpm > 100) setDTC(S, 'P0335');

    const wasRunning = S.running;
    if (!S.running) S.running = sens.rpm > 420 && S.torqueInd > 2 && S.sync === 2;
    else S.running = sens.rpm > 300 && S.sync === 2;
    if (S.running && !wasRunning) { S.runT = 0; S.startEct = ectU; log(S, 'Diesel running — compression ignition, idle governor holding {idle} rpm by fuel quantity.', 'ok', { idle: Math.round(S.idleTarget || 800) }); }
    if (!S.running && wasRunning && !S.cranking) log(S, 'Engine stalled / stopped.', 'warn');
    if (S.running) S.runT += dt;
    edge(S, 'running', S.running);
    if (S.cranking) {
      S.startHoldT += dt;
      if ((S.running && S.rpm > 650) || S.startHoldT > 8) { S.key = 'ON'; S.startHoldT = 0; }
    } else S.startHoldT = 0;

    S.primeT = Math.max(0, S.primeT - dt);
    S.fuelPump = S.primeT > 0 || sens.rpm > 50;
    const fanWas = S.fan;
    if (F.ect || S.ac || S.regen) S.fan = true;
    else if (ectU > 98) S.fan = true;
    else if (ectU < 93) S.fan = false;
    if (S.fan && !fanWas) log(S, S.regen ? 'Radiator fan ON (DPF regeneration).' : F.ect ? 'Radiator fan ON (ECT fault – failsafe).' : S.ac ? 'Radiator fan ON (A/C request).' : 'Radiator fan ON (coolant {t} °C).', 'info', { t: ectU.toFixed(0) });
    if (!S.fan && fanWas) log(S, 'Radiator fan OFF.', 'info');

    // ---------- air-mass measurement ----------
    const rpmE = Math.max(sens.rpm, 1);
    const airCyl = !F.maf ? sens.maf / (rpmE / 30) : 0.5 * (sens.map || S.baro) / 100; // MAF fault → crude model
    S.airCylMeas = airCyl;
    if (F.maf && S.running) setDTC(S, 'P0102');

    // ---------- fuel quantity: driver's wish → idle governor → limiters ----------
    S.idleTarget = E.idle + clamp((40 - ectU) * 4, 0, 200) + (S.ac ? 50 : 0) + (S.regen ? 100 : 0);
    const idleErr = S.idleTarget - sens.rpm;
    if (S.running && S.pedal < 1) {
      S.qIdleI = clamp(S.qIdleI + idleErr * 0.004 * dt, -3, 12);
      S.qIdle = clamp(4.5 + idleErr * 0.012 + S.qIdleI, 0, 20);
    } else if (!S.running) { S.qIdle = S.cranking ? 12 + clamp((10 - ectU) * 0.3, 0, 8) : 0; S.qIdleI = 0; }
    else S.qIdle = clamp(4.5 + S.qIdleI, 0, 12);
    S.qDriver = interp2(S.cal.quantity, sens.rpm, S.pedal);
    // overrun cut: foot off above ~1300 rpm while rolling
    if (S.pedal < 1 && sens.rpm > 1300 && S.running) S.dfcoT += dt; else S.dfcoT = 0;
    S.dfco = S.dfcoT > 0.4 && sens.rpm > 1050;
    let q = S.pedal < 1 ? S.qIdle : Math.max(S.qDriver, sens.rpm < S.idleTarget + 200 ? S.qIdle : 0);
    let lim = S.pedal < 1 ? 'idle' : 'driver';
    // smoke limiter: never more fuel than the measured air can burn cleanly (λ ≥ 1.2)
    S.qSmoke = S.running ? (airCyl * 1000) / (AFR * 1.2) : 99;
    S.qTorque = E.qMax(sens.rpm);
    const limp = S.dpfLimp || F.maf || S.overboostCut || S.leakLimp;
    if (q > S.qSmoke) { q = S.qSmoke; lim = 'smoke'; }
    if (q > S.qTorque) { q = S.qTorque; lim = 'torque'; }
    if (limp && q > 28) { q = 28; lim = 'limp'; }
    if (sens.rpm > E.redline - 300) { const cap = S.qTorque * clamp((E.redline - sens.rpm) / 300, 0, 1); if (q > cap) { q = cap; lim = 'rpm'; } }
    if (S.dfco) { q = 0; lim = 'cut'; }
    if (S.sync < 2 || sens.rpm < 40) { q = 0; lim = S.cranking ? 'sync' : 'off'; }
    S.revCut = lim === 'rpm' && q < 1;
    S.qMg = Math.max(0, q);
    S.fuelMg = S.qMg;
    S.limiter = lim;
    S.fuelCutAll = S.qMg <= 0;
    S.loadPct = (S.qMg / 60) * 100;
    edge(S, 'dsmoke', lim === 'smoke' && S.pedal > 60, 'Smoke limiter active: the turbo hasn’t built boost yet, so fuel is capped to what the air can burn cleanly (λ 1.2).', null, 'info', 6);
    edge(S, 'dfco', S.dfco, 'Overrun fuel cut: foot off above 1300 rpm → no injection at all.', 'Overrun cut ended → idle governor takes over.');

    // ---------- rail pressure, injection timing, pilot / post ----------
    S.railTarget = S.running || S.cranking ? clamp(250 + 1500 * clamp(S.qMg / 58, 0, 1) * clamp(sens.rpm / 3000, 0.35, 1) + (S.cranking ? 0 : 0), 250, 1800) : 0;
    const coldAdv = clamp((40 - ectU) * 0.08, 0, 3);
    S.soi = interp2(S.cal.soi, sens.rpm, S.qMg) + coldAdv;
    S.pilot = S.qMg > 0 && (S.qMg < 42 || ectU < 40);
    S.pilotSoi = S.soi + 14;
    const flow = 15 * Math.sqrt(Math.max(S.rail, 100) / 100); // mg per ms of injector opening
    S.pw = S.qMg > 0 ? S.qMg / flow + 0.1 : 0;
    S.injDuty = S.pw / (120000 / rpmE);
    S.deadtime = 0.1;

    // rail deviation / leak diagnosis: the pump must deliver more than is injected
    if (S.running && S.railTarget - S.rail > 150) S.railDevT = (S.railDevT || 0) + dt; else S.railDevT = 0;
    if (S.railDevT > 3 && F.fuelpump) setDTC(S, 'P0087');
    if (S.running && S.railLeak > 0 && S.railLeak / Math.max(S.qMg, 2) > 0.3) S.leakT += dt; else S.leakT = Math.max(0, S.leakT - dt);
    if (S.leakT > 3 && !S.leakLimp) { setDTC(S, 'P0093'); S.leakLimp = true; log(S, 'Pump delivery far exceeds injected quantity → large fuel leak suspected. Limp mode, torque limited.', 'fault'); }
    if (!F.injleak3 && S.leakLimp && !S.dtc.P0093) S.leakLimp = false;

    // ---------- boost control (VGT) ----------
    const boostRel = sens.boost - S.baro;
    S.boostMap = interp2(S.cal.boostD, sens.rpm, S.qMg);
    S.boostTargetKpa = F.map ? 0 : S.boostMap * 100;
    const err = S.boostTargetKpa - boostRel;
    const dB = (boostRel - (S.prevBoost ?? boostRel)) / dt; S.prevBoost = boostRel;
    S.dBoostF = (S.dBoostF || 0) + (dB - (S.dBoostF || 0)) * (1 - Math.exp(-dt / 0.08));
    if (S.boostTargetKpa < 5 || S.overboostCut) { S.wgCmd = 1; S.wgI = 0; }
    else {
      // feed-forward opens the vanes as exhaust flow grows; PID trims to the target
      const ff = clamp(0.85 - S.boostTargetKpa / 200 + (S.airGs - 60) / 160, 0.05, 0.95);
      S.wgI = clamp(S.wgI + err * 0.006 * dt, -0.5, 0.5);
      S.wgCmd = clamp(ff - 0.016 * err - S.wgI + 0.004 * S.dBoostF, 0, 1);
    }
    const boostMaxMap = Math.max(...S.cal.boostD.z.map((row) => Math.max(...row))) * 100;
    if (boostRel > boostMaxMap + 35) S.overboostT += dt; else S.overboostT = 0;
    if (!S.overboostCut && S.overboostT > 0.4) { S.overboostCut = true; setDTC(S, 'P0234'); log(S, 'OVERBOOST {b} bar → VGT opened fully and fuel limited to protect the engine.', 'fault', { b: (boostRel / 100).toFixed(2) }); }
    if (S.overboostCut && boostRel < 20) S.overboostCut = false;
    if (err > 35 && sens.rpm > 2200 && S.pedal > 70) S.underboostT += dt; else S.underboostT = 0;
    if (S.underboostT > 2.5) setDTC(S, 'P0299');
    if (S.boostTargetKpa > 40 && Math.abs(err) < S.boostTargetKpa * 0.12) S.monitors.boost = true;

    // ---------- EGR: close the loop on the MAF (fresh-air setpoint) ----------
    const egrActive = S.running && ectU > 30 && S.qMg < 38 && sens.rpm < 3200 && !S.regen && !S.dfco && !F.maf;
    if (egrActive) {
      const lamSet = lerp(5.0, 1.6, clamp(S.qMg / 35, 0, 1)); // desired fresh-air λ
      S.mafTarget = (S.qMg / 1000) * AFR * lamSet;            // g per cylinder per stroke
      const e = (airCyl - S.mafTarget) / Math.max(S.mafTarget, 0.05); // too much fresh air → open EGR
      S.egrI = clamp(S.egrI + e * 1.4 * dt, 0, 1);
      S.egrCmd = clamp(S.egrI + e * 0.4, 0, 1);
      // a fault is only flagged when the valve is saturated and the MAF still misses its setpoint
      const stuckHigh = e > 0.15 && S.egrCmd > 0.95, stuckLow = e < -0.15 && S.egrCmd < 0.05;
      if (stuckHigh || stuckLow) S.egrDevT += dt; else S.egrDevT = Math.max(0, S.egrDevT - dt);
      if (S.egrDevT > 4) setDTC(S, stuckHigh ? 'P0401' : 'P0402');
      if (Math.abs(e) < 0.15) { S.egrOkT += dt; if (S.egrOkT > 8) S.monitors.egr = true; }
    } else {
      S.egrCmd = 0; S.egrI = Math.max(0, S.egrI - dt); S.mafTarget = 0;
      // with EGR commanded shut, the MAF should match the charge the engine draws (speed-density model);
      // a large shortfall means exhaust is getting in → EGR stuck open
      const expCyl = S.running && sens.map > 0 ? (X.veAt(E, sens.rpm, sens.map) * sens.map * 1000 * (E.vd / 4)) / (R * (S.iat + 278)) * 1000 : 0;
      if (S.running && expCyl > 0 && S.egrPos < 1.01 && airCyl < expCyl * 0.72) { S.egrDevT += dt; if (S.egrDevT > 4) setDTC(S, 'P0402'); }
      else S.egrDevT = Math.max(0, S.egrDevT - dt);
    }
    edge(S, 'egr', S.egrPos > 0.15 && S.running, 'EGR open: exhaust is recirculated to lower combustion temperature and NOx (MAF drops to its setpoint).', 'EGR closed (full load, regeneration or cold) — maximum fresh air.', 'info', 20);

    // ---------- DPF: soot estimate, regeneration, overload ----------
    // the ΔP sensor is only trusted above a minimum exhaust flow; below it the soot model carries on
    const exhFlow = S.airGs + S.fuelRateGs;
    if (exhFlow > 15 && S.dpfDp > 1) {
      const fromDp = clamp(((S.dpfDp - 0.5) / Math.pow((exhFlow + 0.1) / 60, 1.25) - 4) / 1.6, 0, 99);
      S.sootEst += (fromDp - S.sootEst) * (1 - Math.exp(-dt / 2));
    } else S.sootEst = Math.max(0, S.sootEst + (S.soot - (S.sootPrev ?? S.soot)));
    S.sootPrev = S.soot;
    if (!S.regen && S.running && S.sootEst > 24 && ectU > 60) {
      S.regen = true; S.regenT = 0;
      log(S, 'DPF {s} g full → active regeneration: post-injection burns on the DOC to push the filter to ~600 °C.', 'warn', { s: S.sootEst.toFixed(0) });
    }
    if (S.regen) {
      S.regenT += dt;
      const e = 620 - S.dpfT;
      S.postMg = S.running ? clamp(4 + e * 0.03, 0, 10) : 0;
      S.throttleCmd = S.pedal < 20 ? 72 : 100; // intake throttling at low load keeps the exhaust hot
      if (S.sootEst < 4 || !S.running) {
        S.regen = false; S.postMg = 0; S.throttleCmd = 100;
        if (S.running) { log(S, 'Regeneration complete — soot burnt off, DPF {s} g.', 'ok', { s: S.sootEst.toFixed(1) }); S.monitors.pm = true; }
      } else if (S.regenT > 90) {
        S.regen = false; S.postMg = 0; S.throttleCmd = 100;
        log(S, 'Regeneration aborted — the pressure drop won’t come down.', 'fault');
      }
    } else { S.postMg = 0; S.throttleCmd = S.running || S.cranking || S.key === 'ON' ? 100 : 0; }
    if (S.sootEst > 45 && S.running) { S.dpfOverT = (S.dpfOverT || 0) + dt; } else S.dpfOverT = 0;
    if (S.dpfOverT > 4 && !S.dpfLimp) { S.dpfLimp = true; setDTC(S, 'P2463'); log(S, 'DPF overloaded ({s} g) → DPF lamp, limp mode. The filter needs a forced regeneration or cleaning.', 'fault', { s: S.sootEst.toFixed(0) }); }
    if (S.dpfLimp && !S.dtc.P2463) S.dpfLimp = false;

    // ---------- monitors ----------
    if (S.running && S.docT > 250) { S.catHot += dt; if (S.catHot > 20) S.monitors.cat = true; }
    if (S.running && S.lamSensorT > 600) S.monitors.exhaust = true;
    if (S.running && S.dpfT > 250) { S.pmT += dt; if (S.pmT > 30) S.monitors.pm = true; }
    if (S.running) { S.clTime += dt; if (S.clTime > 10) S.monitors.fuel = true; }
    S.closedLoop = false; S.olReason = { k: 'diesel: always lean, no λ = 1 loop' };
    S.lambdaTarget = S.qMg > 0 ? (airCyl * 1000) / (S.qMg * AFR) : 9;

    if (F.alt && S.running && S.vbat < 12.3) setDTC(S, 'P0562');
    if (F.thermostat && S.running && S.runT > 60 && S.ect < 70) setDTC(S, 'P0128');
    if (Object.values(S.dtc).some((d) => d.mil)) S.distMil += (S.v * dt) / 1000;
  }
})();
