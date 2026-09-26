/* Engine physics + ECU control strategy.
   DOM-free: can be run headless (node) for testing.

   Crank-angle convention (used everywhere):
   0..720° engine cycle, 0° = cylinder 1 TDC at the start of its power stroke.
   Firing order 1-3-4-2 → cylinder TDC offsets 0 / 540 / 180 / 360 (cyl 1..4). */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const ECU = (root.ECU = root.ECU || {});

  const R = 287.05;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const PI4 = 4 * Math.PI;
  ECU.util = { clamp, lerp };

  // index = cylinder-1 ; value = crank angle of its firing TDC
  ECU.CYL_OFFSET = [0, 540, 180, 360];
  ECU.FIRING_ORDER = [1, 3, 4, 2];

  const ENGINES = {
    na: {
      id: 'na', name: '2.0 NA', label: 'Naturally aspirated 2.0 L I4', turbo: false,
      vd: 0.002, cr: 11.0, injFlow: 3.1, injCc: 240, fuelBase: 3.5, redline: 6800,
      etaTh: 0.38, klOffset: 0, idle: 800, idleFF: 5.5, thrArea: 2.83e-3, airRef: 0.6,
      ve(rpm) { return 0.62 + 0.33 * Math.exp(-(((rpm - 4600) / 3000) ** 2)); },
    },
    turbo: {
      id: 'turbo', name: '2.0 Turbo', label: 'Turbocharged 2.0 L I4 (intercooled)', turbo: true,
      vd: 0.002, cr: 9.6, injFlow: 5.6, injCc: 440, fuelBase: 4.0, redline: 6500,
      etaTh: 0.36, klOffset: 20, idle: 800, idleFF: 5.5, thrArea: 3.3e-3, airRef: 0.6,
      ve(rpm) { return 0.66 + 0.26 * Math.exp(-(((rpm - 3600) / 3400) ** 2)); },
    },
  };
  ECU.ENGINES = ENGINES;

  const GEAR_RATIOS = [0, 3.5, 2.1, 1.45, 1.05, 0.82];
  const FINAL = 3.9, RW = 0.31, MASS = 1400, J_ENG = 0.16;
  ECU.GEAR_RATIOS = GEAR_RATIOS;

  function phi(pr) {
    if (pr <= 0.528) return 0.6847;
    if (pr >= 1) return 0;
    return Math.sqrt(7 * (Math.pow(pr, 1.4286) - Math.pow(pr, 1.7143)));
  }
  // compressible orifice flow, kg/s. pressures in kPa
  function orifice(A, pu, pd, TK) {
    if (pu <= 0 || A <= 0) return 0;
    return (A * pu * 1000) / Math.sqrt(R * TK) * phi(pd / pu);
  }

  // residual exhaust gas expands into the cylinder at low manifold pressure → less fresh charge
  function veAt(E, rpm, P) {
    const resid = clamp((E.cr - 105 / Math.max(P, 1)) / (E.cr - 1), 0.02, 1.03);
    return E.ve(rpm) * resid;
  }

  // Spark: MBT (best torque) and knock-limited advance
  function mbt(rpm, load, E) {
    let a = 14 + 22 * Math.min(rpm, 4500) / 4500 - 8 * Math.min(load, 1);
    if (E.turbo) a -= 6 * Math.max(0, load - 1);
    return a;
  }
  // physical knock-limited advance (the real engine, not the ECU's map)
  function klPure(E, rpm, load, octane, iat, ect) {
    // −30°/100 % load up to atmospheric filling, flatter above (boosted charge is intercooled)
    let kl = 46 - 30 * Math.min(load, 1) - 17 * Math.max(0, load - 1) + (octane - 95) * 2.2 + E.klOffset;
    kl -= Math.max(0, iat - 25) * 0.2;
    kl -= Math.max(0, ect - 95) * 0.4;
    if (rpm < 2500) kl -= ((2500 - rpm) / 2500) * 6 * Math.min(load, 1.5);
    return kl;
  }
  function knockLimit(S, octane, load, cylBias) {
    return klPure(S.E, S.rpm, load, octane, S.iat, S.ect) + (cylBias || 0);
  }
  ECU.mbt = mbt;
  ECU.knockLimitAt = klPure;

  /* ---------- Calibration maps (the ECU's lookup tables) ----------
     Stock values are generated from the same models the engine obeys, so a stock ECU is well
     calibrated. Users can edit them; the physics (MBT, knock limit, breathing) stays untouched. */
  const AX = {
    rpm: [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000],
    loadNA: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110],
    loadT: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 140, 160, 180, 200],
    pedal: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  };
  ECU.CAL_AXES = AX;
  const r1 = (v, st) => Math.round(v / st) * st;
  function table(x, y, fn, step) {
    const z = y.map((yv) => x.map((xv) => r1(fn(xv, yv), step)));
    return { x, y, z, base: z.map((row) => row.slice()) };
  }
  function makeCal(E) {
    const load = E.turbo ? AX.loadT : AX.loadNA;
    const cal = {
      // spark advance (°BTDC) at reference conditions: 25 °C intake, 90 °C coolant, 95 RON, 1.5° knock margin
      spark: table(AX.rpm, load, (rpm, l) => Math.min(mbt(rpm, l / 100, E), klPure(E, rpm, l / 100, 95, 25, 90) - 1.5), 0.5),
      // target lambda
      lambda: table(AX.rpm, load, (rpm, l) => {
        if (E.turbo) return l > 95 ? lerp(0.98, 0.78, clamp((l - 95) / 80, 0, 1)) : 1;
        return l >= 85 ? 0.87 : l >= 75 ? 0.93 : 1;
      }, 0.01),
    };
    // boost target (bar) at "boost target" slider = 1.00; the slider scales the whole table
    if (E.turbo) cal.boost = table(AX.rpm, AX.pedal, (rpm, p) => clamp((p - 15) / 60, 0, 1) * (rpm < 1500 ? 0.5 : rpm < 2000 ? 0.8 : rpm > 6000 ? 0.9 : 1), 0.05);
    return cal;
  }
  ECU.makeCal = makeCal;

  // bilinear interpolation, clamped at the table edges
  function seg(ax, v) {
    if (v <= ax[0]) return [0, 0];
    const n = ax.length - 1;
    if (v >= ax[n]) return [n - 1, 1];
    let i = 0;
    while (v > ax[i + 1]) i++;
    return [i, (v - ax[i]) / (ax[i + 1] - ax[i])];
  }
  function interp2(t, xv, yv) {
    const [i, fx] = seg(t.x, xv), [j, fy] = seg(t.y, yv);
    const i1 = Math.min(i + 1, t.x.length - 1), j1 = Math.min(j + 1, t.y.length - 1);
    const a = t.z[j][i] + (t.z[j][i1] - t.z[j][i]) * fx;
    const b = t.z[j1][i] + (t.z[j1][i1] - t.z[j1][i]) * fx;
    return a + (b - a) * fy;
  }
  ECU.interp2 = interp2;
  ECU.calCell = seg;

  function gLambda(l) {
    if (l >= 0.88) return Math.pow(0.88 / l, 0.45);
    return 1 - 1.5 * (0.88 - l) ** 2;
  }

  function createState(type, prev) {
    const E = ENGINES[type];
    const S = {
      type, E, t: 0,
      key: 'OFF', ecuOn: false, bootT: 0, startHoldT: 0,
      rpm: 0, crank: 0, map: 101.3, baro: 101.3, boostP: 101.3, turbo: 0,
      wgPos: 1, wgCmd: 1, wgI: 0, bovT: 0, boostTargetKpa: 0,
      throttle: 6, throttleCmd: 6,
      airGs: 0, mafTrue: 0, airPerCyl: 0, fuelRateGs: 0,
      ambient: 20, iat: 22, chargeT: 20, compOutT: 20, ect: 20, oilT: 20, oilP: 0, egt: 20,
      fuelP: 0, vbat: 12.6, soc: 1, fuelLevel: 62,
      lambda: 1, lambdaCyl: [1, 1, 1, 1], lamHist: [], lamSensed: 1, o2v: 0.45, o2dn: 0.45, o2Temp: 20, catOsc: 0.5,
      torqueInd: 0, torque: 0, power: 0, v: 0, gear: 0,
      pedal: 0, brake: false, ac: false, lights: false, grade: 0, octane: 95, boostTarget: 1.0, ckpType: 'vr',
      faults: {},
      sync: 0, syncAngle: 0,
      sens: {},
      fuelMg: 0, pw: 0, injDuty: 0, deadtime: 0.7, eoi: 340, batch: false,
      lambdaTarget: 1, ltReason: { k: 'stoichiometric (catalyst window)' }, ltPower: false, stft: 0, ltft: 0, closedLoop: false, olReason: { k: 'engine not running' },
      o2Rich: false, o2Switches: [], o2Freq: 0, o2DeadT: 0, o2Dead: false,
      spark: 0, sparkBase: 0, sparkIdle: 0, sparkCyl: [0, 0, 0, 0], catHeat: 0, mbtNow: 0, klNow: 0,
      knockRetard: [0, 0, 0, 0], knockFlash: [0, 0, 0, 0], knockTrue: [0, 0, 0, 0], knockCount: 0, lastKnockT: -99, dwell: 3,
      idleTarget: 800, idleI: 0, idleAdder: 5.5, idleActive: false,
      dfco: false, dfcoT: 0, revCut: false, overboostCut: false, overboostT: 0, underboostT: 0, limp: false,
      ae: 0, prevThr: 6,
      afterStart: 0, runT: 0, running: false, cranking: false, startEct: 20, stallT: 0,
      fuelPump: false, primeT: 0, fan: false, vvt: 0,
      injCut: [false, false, false, false], misfireAcc: 0, misfireActive: false, crankJitter: [0, 0, 0, 0],
      dtc: {}, log: [], logSeq: 0,
      catMon: { up: 0, dn: 0 }, lastUpRich: false, lastDnRich: false,
      elecW: 0, loadCalc: 0, loadPct: 0, loadSrc: 'MAF', airCylMeas: 0,
      flags: {},
      cal: makeCal(E),
      freeze: null, distMil: 0, monitors: null, clTime: 0, o2Total: 0,
    };
    if (prev) {
      // carry user inputs across engine switch
      ['ambient', 'octane', 'boostTarget', 'ckpType', 'ac', 'lights', 'grade'].forEach((k) => (S[k] = prev[k]));
      S.ect = S.oilT = S.iat = S.chargeT = S.egt = S.ambient;
      S.log = prev.log;
      S.logSeq = prev.logSeq;
    }
    resetMonitors(S);
    return S;
  }
  ECU.createState = createState;

  // msg is an English i18n key; vars fill {placeholders} (values may be {k, v} keys themselves).
  // Entries are translated when rendered, so the log follows language switches.
  function log(S, msg, kind, vars) {
    S.log.push({ t: S.t, msg, vars, kind: kind || 'info', id: ++S.logSeq });
    if (S.log.length > 250) S.log.splice(0, S.log.length - 250);
  }
  ECU.log = log;

  // transition helper: logs once when a boolean condition changes
  function edge(S, key, value, onMsg, offMsg, kind, cooldown, vars) {
    const prev = !!S.flags[key];
    if (value && !prev && onMsg) {
      const last = S.flags[key + '_t'] || -99;
      if (!cooldown || S.t - last > cooldown) log(S, onMsg, kind, vars);
      S.flags[key + '_t'] = S.t;
    }
    if (!value && prev && offMsg) log(S, offMsg, kind === 'warn' ? 'ok' : 'info');
    S.flags[key] = !!value;
  }

  // OBD readiness monitors: continuous ones (misfire, fuel system checks, components) are always
  // complete; the others complete once the ECU has actually run the test since codes were cleared.
  function resetMonitors(S) {
    S.monitors = { misfire: true, comp: true, fuel: false, cat: false, o2: false, o2heater: false };
    S.clTime = 0;
    S.o2Total = 0;
  }
  ECU.resetMonitors = resetMonitors;

  function setDTC(S, code, mil) {
    if (S.dtc[code]) return;
    S.dtc[code] = { code, text: ECU.DTC_TEXT[code] || '', t: S.t, mil: mil !== false };
    // OBD mode 02: snapshot of the operating conditions when the first code is stored
    if (!S.freeze) {
      const sens = S.sens;
      S.freeze = { code, rpm: sens.rpm || 0, load: S.loadPct, ect: sens.ect, iat: sens.iat, map: sens.map, maf: sens.maf, vss: S.v * 3.6,
        stft: S.stft, ltft: S.ltft, spark: S.spark, throttle: S.throttle, closedLoop: S.closedLoop, fuelCut: !!S.fuelCutAll, t: S.t };
    }
    log(S, mil !== false ? 'DTC {code} stored — {text} · MIL on' : 'DTC {code} stored — {text}', 'fault', { code, text: { k: ECU.DTC_TEXT[code] || '' } });
  }
  ECU.clearDTC = function (S) {
    S.dtc = {};
    S.freeze = null;
    S.distMil = 0;
    resetMonitors(S); // non-continuous monitors must run again before the car is ready for inspection
    S.o2Dead = false;
    S.injCut = [false, false, false, false];
    S.misfireAcc = 0;
    S.ltft = 0;
    log(S, 'Scan tool: DTCs cleared, adaptations reset.', 'ok');
  };

  function noise(a) { return (Math.random() - 0.5) * 2 * a; }

  function step(S, dt) {
    if (!(dt > 0)) return; // several terms divide by dt
    const E = S.E, F = S.faults;
    S.t += dt;

    /* ================= KEY / ECU POWER ================= */
    const powered = S.key === 'ON' || S.key === 'START';
    if (powered && !S.ecuOn) {
      S.ecuOn = true; S.bootT = 0; S.primeT = 2.0;
      S.baro = 101.3;
      log(S, 'Key ON → ECU boots, self-test & bulb check. BARO learned from MAP. Fuel pump primes the rail for 2 s.', 'info');
    }
    if (!powered && S.ecuOn) {
      S.ecuOn = false; S.sync = 0; S.syncAngle = 0; S.closedLoop = false; S.fuelPump = false;
      log(S, 'Key OFF → ECU shuts injectors, coils and fuel pump.', 'info');
    }
    if (S.ecuOn) S.bootT += dt;

    const T_ambK = S.ambient + 273.15;
    const omega = (S.rpm * Math.PI) / 30;

    /* ================= THROTTLE ACTUATOR ================= */
    const dynoOn = S.dyno && (S.dyno.phase === 'settle' || S.dyno.phase === 'pull');
    if (dynoOn) { S.pedal = 100; S.gear = 0; S.brake = false; } // the dyno operator holds WOT in neutral
    const thrTarget = S.ecuOn && !F.tps ? S.throttleCmd : 7; // spring "limp-home" position
    S.throttle += (thrTarget - S.throttle) * (1 - Math.exp(-dt / 0.035));

    /* ================= AIR PATH ================= */
    let pUp, tIntK;
    if (E.turbo) {
      pUp = S.boostP - 1.5 * (S.airGs / 150) ** 2;
      tIntK = S.chargeT + 273.15 + 4;
    } else {
      pUp = S.baro - 0.8 * (S.airGs / 100) ** 2;
      tIntK = S.iat + 273.15;
    }
    const thrFrac = 1 - Math.cos((clamp(S.throttle, 0, 100) / 100) * Math.PI / 2);
    const Athr = E.thrArea * (thrFrac + 0.0012);
    const Aleak = F.vacleak ? E.thrArea * 0.0013 : 0;
    const rpmNow = S.rpm;
    const mEng = (P) => (veAt(E, rpmNow, P) * P * 1000 * E.vd) / (R * tIntK) * rpmNow / 120;

    let lo = 1, hi = Math.max(pUp, 2);
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      const f = orifice(Athr, pUp, mid, tIntK) + orifice(Aleak, S.baro, mid, T_ambK) - mEng(mid);
      if (f > 0) lo = mid; else hi = mid;
    }
    const Pss = (lo + hi) / 2;
    const mapPrev = S.map;
    S.map += (Pss - S.map) * (1 - Math.exp(-dt / 0.045));
    S.map = clamp(S.map, 1, 400);
    const dPdt = (S.map - mapPrev) / dt; // kPa/s

    const airKg = mEng(S.map);
    S.airGs = airKg * 1000;
    // mass entering the manifold = engine draw + manifold filling (dP/dt · V/RT)
    const fill = (0.003 / (R * tIntK)) * dPdt * 1000;
    const inflow = Math.max(0, airKg + fill) * 1000;
    const oT = orifice(Athr, pUp, S.map, tIntK), oL = orifice(Aleak, S.baro, S.map, T_ambK);
    const meteredShare = oT + oL > 0 ? oT / (oT + oL) : 1;
    const mT = inflow * meteredShare;
    const boostRelNow = S.boostP - S.baro;
    S.mafTrue = E.turbo && F.boostleak && boostRelNow > 5 ? mT * 1.18 : mT;
    S.airPerCyl = S.rpm > 5 ? S.airGs / (S.rpm / 30) : 0;
    const loadN = S.airPerCyl / E.airRef;

    /* ================= FUEL DELIVERY & COMBUSTION ================= */
    const railDelta = S.fuelP - (S.map - S.baro) / 100;
    const fuelPfac = Math.sqrt(clamp(railDelta, 0, 10) / E.fuelBase);
    const cycleMs = S.rpm > 1 ? 120000 / S.rpm : 1e9;
    const maxFuelMg = Math.max(0, (cycleMs - S.deadtime) * E.injFlow);
    let Tind = 0, airSum = 0, fuelSeen = 0, fuelTotalMg = 0;
    const canFire = S.ecuOn && S.sync > 0 && S.rpm > 60 && !F.ckp;
    for (let c = 0; c < 4; c++) {
      let mg = 0;
      if (canFire && !S.injCut[c] && !S.fuelCutAll) mg = Math.min(S.fuelMg, maxFuelMg) * fuelPfac;
      fuelTotalMg += mg;
      const fg = mg / 1000;
      const air = S.airPerCyl;
      const lam = fg > 0 ? air / (fg * 14.7) : 9;
      S.lambdaCyl[c] = Math.min(lam, 9);
      airSum += air;
      const sparkOk = canFire && !(F.misfire3 && c === 2);
      fuelSeen += sparkOk ? fg : fg * 0.3; // unburnt HC barely register on zirconia
      if (sparkOk && fg > 0 && lam > 0.45 && lam < 1.75) {
        const adv = S.sparkCyl[c];
        const effS = clamp(1 - 0.0008 * (adv - S.mbtNow) ** 2, 0.2, 1);
        const e = Math.min(fg, air / 14.7) * 44000 * E.etaTh * gLambda(lam) * effS;
        Tind += e / PI4;
      }
    }
    S.fuelRateGs = (fuelTotalMg / 1000) * (S.rpm / 120);
    S.lambda = fuelSeen > 0 ? clamp(airSum / (fuelSeen * 14.7), 0.5, 9) : 9;
    if (S.rpm < 30) S.lambda = 9;

    /* ================= KNOCK (physical) ================= */
    if (canFire && Tind > 0) {
      for (let c = 0; c < 4; c++) {
        if (S.injCut[c] || (F.misfire3 && c === 2)) continue;
        const kl = knockLimit(S, S.octane, loadN, c === 2 ? -1.2 : 0);
        const margin = S.sparkCyl[c] - kl;
        S.knockTrue[c] = Math.max(0, S.knockTrue[c] - dt * 3);
        if (margin > 0) {
          const rate = (S.rpm / 120) * clamp(margin * 0.12, 0, 0.9);
          if (Math.random() < rate * dt) {
            S.knockTrue[c] = Math.min(1.5, 0.4 + margin * 0.15);
            S.knockCount++;
            if (!F.knocksensor) {
              S.knockRetard[c] = Math.min(12, S.knockRetard[c] + 2);
              S.knockFlash[c] = 1;
              if (S.t - S.lastKnockT > 2.5) log(S, 'Knock on cylinder {c} (in its knock window) → spark retarded 2° on that cylinder only.', 'warn', { c: c + 1 });
              S.lastKnockT = S.t;
            } else if (S.t - S.lastKnockT > 3) {
              log(S, "Cylinder {c} is knocking — but the knock sensor is dead, the ECU can't hear it!", 'fault', { c: c + 1 });
              S.lastKnockT = S.t;
            }
          }
        }
      }
    }
    for (let c = 0; c < 4; c++) {
      S.knockFlash[c] = Math.max(0, S.knockFlash[c] - dt * 2.5);
      S.knockRetard[c] = Math.max(0, S.knockRetard[c] - dt * 0.7);
    }

    /* ================= LOADS & ROTATION ================= */
    const cold = 1 + Math.max(0, 60 - S.oilT) / 90;
    const Tfric = S.rpm > 0.5 ? (7 + 0.0028 * S.rpm + 2.5e-7 * S.rpm * S.rpm) * cold : 0;
    const Tpump = S.rpm > 0.5 ? (Math.max(0, S.baro - S.map) * 1000 * E.vd) / PI4 : 0;

    S.elecW = (S.ecuOn ? 180 : 0) + (S.fuelPump ? 110 : 0) + (S.lights ? 140 : 0) + (S.fan ? 260 : 0) + (S.ac ? 150 : 0) + (S.running ? 60 : 0);
    const charging = S.rpm > 550 && !F.alt;
    const Talt = charging ? Math.min(S.elecW / (Math.max(omega, 50) * 0.55) + 2, 22) : 0;
    const Tac = S.ac && S.running ? 10 + S.rpm * 0.0015 : 0;

    S.cranking = S.key === 'START';
    const Tst = S.cranking ? Math.max(0, 115 * (1 - S.rpm / 320)) : 0;
    const Tcomp = S.rpm > 1 && S.rpm < 700 ? -22 * Math.sin((2 * S.crank * Math.PI) / 180) * (S.map / 100) : 0;

    // torque converter style coupling to the car
    let Tc = 0;
    const g = S.gear;
    if (g > 0 && S.rpm > 1) {
      const wIn = (S.v / RW) * GEAR_RATIOS[g] * FINAL;
      const sr = wIn / Math.max(omega, 1);
      Tc = (S.rpm / 165) ** 2 * clamp((1 - sr) * 4, -2.5, 1);
    }

    S.torqueInd = Tind;
    S.torque = Tind - Tfric - Tpump;
    const Tnet = Tind - Tfric - Tpump - Talt - Tac - Tc + Tst + Tcomp;
    let newOmega = omega + (Tnet / J_ENG) * dt;
    if (S.rpm < 120 && !S.cranking && Tind < 5) newOmega -= 60 * dt;
    newOmega = Math.max(0, newOmega);
    if (dynoOn && S.rpm > 300) newOmega = (S.dyno.rpm * Math.PI) / 30; // dyno absorbs the torque and dictates speed
    S.rpm = (newOmega * 30) / Math.PI;
    S.crank = (S.crank + S.rpm * 6 * dt) % 720;
    S.power = Math.max(0, S.torque) * newOmega / 1000;

    // misfire → crank speed dips (used by scope "crank accel" row)
    for (let c = 0; c < 4; c++) {
      const mis = canFire && ((F.misfire3 && c === 2) || S.injCut[c]);
      const target = mis ? -1 : 0;
      S.crankJitter[c] += (target - S.crankJitter[c]) * (1 - Math.exp(-dt / 0.2));
    }

    /* ================= VEHICLE ================= */
    {
      const Fdrive = g > 0 ? (Tc * GEAR_RATIOS[g] * FINAL * 0.9) / RW : 0;
      const Faero = 0.5 * 1.2 * 0.62 * S.v * S.v;
      const Fgrade = MASS * 9.81 * S.grade / 100;
      const Froll = 190;
      const Fbrake = S.brake ? 9500 : 0;
      let net = Fdrive - Faero - Fgrade;
      if (S.v > 0.05) net -= Froll + Fbrake;
      else if (Math.abs(net) < Froll + Fbrake) net = 0;
      S.v = Math.max(0, S.v + (net / (MASS * 1.08)) * dt);
    }

    /* ================= TURBO ================= */
    if (E.turbo) {
      const exh = S.airGs + S.fuelRateGs;
      const egtF = (S.egt + 273) / 1100;
      const tgt = 215 * clamp(Math.pow(Math.max(exh, 0) / 100, 0.8) * Math.sqrt(Math.max(egtF, 0.2)) * (1 - 0.85 * S.wgPos), 0, 1.12);
      const tau = tgt > S.turbo ? 0.85 : 1.8;
      S.turbo += (tgt - S.turbo) * (1 - Math.exp(-dt / tau));
      let boostRel = 180 * (S.turbo / 200) ** 2;
      if (F.boostleak) boostRel = Math.min(boostRel * 0.6, 50);
      // blow-off valve: throttle snapped shut while pressurised
      const bovCond = S.throttle < 15 && S.map < S.boostP - 20;
      if (!S.bovOpen && bovCond && S.boostP - S.baro > 25) {
        S.bovOpen = true;
        log(S, 'Throttle closed under boost → blow-off valve vents the charge pipe (prevents compressor surge). Pssht!', 'info');
      }
      if (S.bovOpen && !bovCond) S.bovOpen = false;
      S.bovT = S.bovOpen ? 0.6 : Math.max(0, S.bovT - dt);
      if (S.bovOpen) boostRel = Math.min(boostRel, 4);
      S.boostP += (S.baro + boostRel - S.boostP) * (1 - Math.exp(-dt / 0.08));
      const PR = S.boostP / S.baro;
      const T2 = T_ambK * (1 + (Math.pow(PR, 0.2857) - 1) / 0.7);
      S.compOutT = T2 - 273.15;
      const icT = T2 - 0.75 * (T2 - T_ambK) + 6 * Math.exp(-S.airGs / 20);
      S.chargeT += (icT - 273.15 - S.chargeT) * (1 - Math.exp(-dt / 2.0));
      // wastegate actuator
      const wgGoal = F.wgstuck ? 0 : S.wgCmd;
      S.wgPos += (wgGoal - S.wgPos) * (1 - Math.exp(-dt / 0.15));
      S.iat = S.chargeT + 3;
    } else {
      S.boostP = S.baro;
      const it = S.ambient + 9 * Math.exp(-S.airGs / 18) + 0.07 * (S.ect - S.ambient);
      S.iat += (it - S.iat) * (1 - Math.exp(-dt / 3));
      S.chargeT = S.iat;
    }

    /* ================= TEMPERATURES / FLUIDS / ELECTRICAL ================= */
    {
      // (thermal behaviour is sped up ~8× so warm-up is watchable)
      const heatIn = 6900 * Math.pow(S.fuelRateGs, 0.6) + (S.ac && S.running ? 1200 : 0);
      const thermoOpen = F.thermostat ? 1 : clamp((S.ect - 86) / 8, 0, 1);
      const airF = 0.25 + (S.v / 25) + (S.fan ? 1.0 : 0);
      const radLoss = 520 * thermoOpen * (S.ect - S.ambient) * airF;
      const baseLoss = 14 * (S.ect - S.ambient);
      S.ect += ((heatIn - radLoss - baseLoss) / 1900) * dt;
      const oilTarget = S.running ? S.ect + 6 + 12 * clamp(loadN, 0, 1.5) : S.ect;
      S.oilT += (oilTarget - S.oilT) * (dt / 14);

      if (S.rpm > 100) {
        const base = Math.min(6.0, 0.9 + (S.rpm / 1000) * 1.05);
        const visc = clamp(1.35 - (S.oilT - 20) * 0.0062, 0.78, 1.6);
        const p = base * visc * (F.oil ? 0.26 : 1);
        S.oilP += (p - S.oilP) * (1 - Math.exp(-dt / 0.2));
      } else S.oilP += (0 - S.oilP) * (1 - Math.exp(-dt / 0.3));

      // EGT
      let egtT;
      if (S.fuelRateGs > 0 && S.rpm > 300) {
        egtT = 280 + 330 * Math.pow(clamp(loadN, 0, 2.2), 0.6) + S.rpm * 0.035;
        const l = S.lambda;
        if (l > 1) egtT += (Math.min(l, 1.15) - 1) * 900; else egtT -= (1 - l) * 700;
        egtT += Math.max(0, S.mbtNow - S.spark) * 7;
        if (E.turbo) egtT += 40;
      } else egtT = S.ect + (S.rpm > 300 ? 60 : 0);
      S.egt += (egtT - S.egt) * (1 - Math.exp(-dt / (egtT > S.egt ? 1.2 : 3.5)));

      // fuel rail
      let fpT;
      if (S.fuelPump) {
        fpT = E.fuelBase + (S.map - S.baro) / 100;
        if (F.fuelpump) fpT -= Math.max(0, S.fuelRateGs - 1.6) * 0.75;
        S.fuelP += (fpT - S.fuelP) * (1 - Math.exp(-dt / 0.25));
      } else S.fuelP += (0.4 * S.fuelP - S.fuelP) * (1 - Math.exp(-dt / 20));
      S.fuelP = Math.max(0, S.fuelP);

      // battery
      let vt;
      if (S.cranking && S.ecuOn) vt = 9.9 + noise(0.25);
      else if (charging) vt = 14.35 - S.elecW / 4000;
      else {
        if (S.ecuOn) S.soc = Math.max(0, S.soc - (S.elecW / 12) * dt / 36000 * 40);
        vt = 11.7 + 0.95 * S.soc - (S.ecuOn ? S.elecW / 2200 : 0);
      }
      if (charging) S.soc = Math.min(1, S.soc + dt * 0.01);
      S.vbat += (vt - S.vbat) * (1 - Math.exp(-dt / 0.15));

      S.fuelLevel = Math.max(0, S.fuelLevel - (S.fuelRateGs * dt) / (50 * 740) * 100);
    }

    /* ================= O2 SENSORS & CATALYST ================= */
    {
      const heaterOn = S.ecuOn && S.rpm > 300;
      const o2T = heaterOn ? 720 : Math.max(S.ambient, S.egt * 0.6);
      S.o2Temp += (o2T - S.o2Temp) * (1 - Math.exp(-dt / 5));
      S.lamHist.push({ t: S.t, l: S.lambda });
      const delay = 0.1 + (S.rpm > 100 ? 160 / S.rpm : 0.5);
      while (S.lamHist.length > 2 && S.lamHist[1].t < S.t - delay) S.lamHist.shift();
      const lamD = S.lamHist[0].l;
      S.lamSensed += (lamD - S.lamSensed) * (1 - Math.exp(-dt / 0.06));
      let v;
      if (F.o2) v = 0.06 + noise(0.005);
      else if (S.o2Temp < 320) v = 0.45 + noise(0.01);
      else v = 0.45 + 0.43 * Math.tanh((1 - S.lamSensed) * 45) + noise(0.012);
      S.o2v = clamp(v, 0.02, 0.98);

      // oxygen storage in the catalyst
      const excess = (S.lamSensed - 1) * S.airGs * 0.02;
      S.catOsc = clamp(S.catOsc + Math.max(-0.5, Math.min(0.5, excess)) * dt, 0, 1);
      let dn;
      if (F.cat) dn = 0.45 + (S.o2v - 0.45) * 0.9;
      else if (S.o2Temp < 320) dn = 0.45;
      else dn = 0.45 + 0.35 * Math.tanh((0.55 - S.catOsc) * 10);
      S.o2dn += (dn + noise(0.006) - S.o2dn) * (1 - Math.exp(-dt / 0.12));
    }

    /* ================= ECU ================= */
    ecuStep(S, dt, loadN);
    if (S.dyno) dynoStep(S, dt);
  }

  function ecuStep(S, dt, loadTrue) {
    const E = S.E, F = S.faults, sens = S.sens;

    // ---------- Sensor readings (what the ECU sees) ----------
    sens.rpm = F.ckp ? 0 : S.rpm;
    sens.maf = F.maf ? 0 : Math.max(0, S.mafTrue * (1 + noise(0.01)));
    sens.map = F.map ? 0 : S.map;
    sens.ect = F.ect ? -40 : S.ect;
    sens.iat = F.iat ? -40 : S.iat;
    sens.tps1 = S.throttle;
    sens.tps2 = F.tps ? clamp(S.throttle + 18, 0, 100) : S.throttle;
    sens.boost = S.boostP;
    sens.vss = S.v * 3.6;

    if (!S.ecuOn) {
      S.fuelMg = 0; S.pw = 0; S.injDuty = 0; S.fuelPump = false; S.closedLoop = false; S.olReason = { k: 'ECU off' };
      S.fan = false; S.sparkCyl = [0, 0, 0, 0]; S.spark = 0; S.running = false; S.dfco = false; S.revCut = false;
      S.fuelCutAll = true;
      S.throttleCmd = 7;
      S.startHoldT = 0;
      edge(S, 'running', false);
      return;
    }

    const ectU = F.ect ? 80 : sens.ect;
    const iatU = F.iat ? 25 : sens.iat;
    if (F.ect && S.bootT > 0.5) setDTC(S, 'P0118');
    if (F.iat && S.bootT > 0.5) setDTC(S, 'P0113');
    if (F.map && S.bootT > 0.5) setDTC(S, 'P0107');
    if (F.tps && S.bootT > 0.3) setDTC(S, 'P0121');
    S.limp = !!F.tps;

    // ---------- Crank / cam synchronisation ----------
    if (sens.rpm > 40) {
      S.syncAngle += sens.rpm * 6 * dt;
      if (S.sync === 0 && S.syncAngle >= 360) {
        S.sync = 1;
        log(S, 'CKP: missing-tooth gap found → ECU knows crank angle (cyl 1/4 TDC). Spark & batch injection enabled.', 'ok');
      }
      if (S.sync === 1 && S.syncAngle >= 720 && !F.cmp) {
        S.sync = 2;
        log(S, 'CMP: cam pulse seen → compression vs exhaust stroke identified. Full sequential injection & coil-on-plug.', 'ok');
      }
      if (S.sync === 2 && F.cmp) {
        S.sync = 1;
        log(S, 'CMP signal lost → fallback to batch fire & wasted spark.', 'warn');
      }
      if (F.cmp && S.syncAngle > 1440) setDTC(S, 'P0340');
    } else {
      if (S.sync > 0) log(S, 'Crank signal lost → sync dropped, injection & spark stopped.', S.rpm > 200 ? 'fault' : 'info');
      S.sync = 0; S.syncAngle = 0;
    }
    if (F.ckp && S.rpm > 100) setDTC(S, 'P0335');
    S.batch = S.sync === 1;

    // ---------- Running state ----------
    const wasRunning = S.running;
    if (!S.running) S.running = sens.rpm > 420 && S.torqueInd > 2 && S.sync > 0;
    else S.running = sens.rpm > 300 && S.sync > 0;
    if (S.running && !wasRunning) {
      S.runT = 0; S.startEct = ectU;
      S.afterStart = ectU < 60 ? 0.3 : 0.12;
      log(S, 'Engine running. After-start enrichment +{e} %, idle target {idle} rpm.', 'ok', { e: Math.round(S.afterStart * 100), idle: Math.round(S.idleTarget) });
    }
    if (!S.running && wasRunning && !S.cranking) log(S, 'Engine stalled / stopped.', 'warn');
    if (S.running) S.runT += dt;
    S.afterStart = Math.max(0, S.afterStart - dt * (S.afterStart / 6 + 0.002));
    edge(S, 'running', S.running);

    // starter auto-release (like letting go of the key once it fires)
    if (S.cranking) {
      S.startHoldT += dt;
      if ((S.running && S.rpm > 650) || S.startHoldT > 6) { S.key = 'ON'; S.startHoldT = 0; }
    } else S.startHoldT = 0;

    // ---------- Fuel pump / fan ----------
    S.primeT = Math.max(0, S.primeT - dt);
    const pumpWas = S.fuelPump;
    S.fuelPump = S.primeT > 0 || sens.rpm > 50;
    if (pumpWas && !S.fuelPump && S.primeT <= 0 && sens.rpm < 50 && S.bootT < 3) log(S, 'Prime complete. Pump stays off until crank pulses are seen (safety).', 'info');
    const fanWas = S.fan;
    if (F.ect || S.ac) S.fan = true;
    else if (ectU > 98) S.fan = true;
    else if (ectU < 93) S.fan = false;
    if (S.fan && !fanWas) log(S, F.ect ? 'Radiator fan ON (ECT fault – failsafe).' : S.ac ? 'Radiator fan ON (A/C request).' : 'Radiator fan ON (coolant {t} °C).', 'info', { t: ectU.toFixed(0) });
    if (!S.fan && fanWas) log(S, 'Radiator fan OFF.', 'info');

    // ---------- Idle speed control ----------
    S.idleTarget = E.idle + clamp((60 - ectU) * 6, 0, 350) + (S.ac ? 90 : 0);
    S.idleActive = S.pedal < 1 && !S.dfco && S.running;
    if (S.idleActive) {
      const err = S.idleTarget - sens.rpm;
      S.idleI = clamp(S.idleI + err * 0.006 * dt, -2.5, 9);
      S.idleAdder = clamp(E.idleFF + err * 0.005 + S.idleI, 0.5, 20);
      S.sparkIdle = clamp(err * 0.02, -6, 6);
    } else {
      if (!S.running) S.idleAdder = E.idleFF + 1.5 + clamp((20 - ectU) * 0.05, 0, 2);
      else S.idleAdder += (E.idleFF + S.idleI - S.idleAdder) * (1 - Math.exp(-dt / 0.5));
      S.sparkIdle *= Math.exp(-dt / 0.3);
    }

    // ---------- Throttle (drive-by-wire) ----------
    const p = S.pedal / 100;
    let thr = 100 * Math.pow(p, 1.25) + S.idleAdder * (1 - p);
    if (S.brake && p > 0.05 && S.v > 1) thr = S.idleAdder; // brake override
    if (S.dfco || (S.running && p < 0.01)) thr = Math.max(thr, E.idleFF + S.idleI * 0.5); // dashpot
    if (S.overboostCut) thr = Math.min(thr, 4);
    S.throttleCmd = clamp(thr, 0, 100);
    const dThr = (S.throttle - S.prevThr) / dt;
    S.prevThr = S.throttle;
    if (dThr > 60) S.ae = Math.min(0.2, S.ae + dThr / 6000);
    S.ae *= Math.exp(-dt / 0.25);

    // ---------- Load calculation ----------
    const rpmE = Math.max(sens.rpm, 1);
    let airCyl;
    const sdAir = () => (veAt(E, sens.rpm, sens.map) * sens.map * 1000 * (E.vd / 4)) / (R * (iatU + 273.15)) * 1000;
    if (sens.rpm < 450 && S.cranking) { airCyl = F.map ? 0.45 : sdAir(); S.loadSrc = 'MAP (cranking)'; }
    else if (!F.maf) {
      airCyl = sens.maf / (rpmE / 30); S.loadSrc = 'MAF';
      // manifold-filling correction: MAF sees air before the cylinders do → cap with speed-density
      const cap = (F.map ? (veAt(E, sens.rpm, S.boostP) * S.boostP * 1000 * (E.vd / 4)) / (R * (iatU + 273.15)) * 1000 : sdAir()) * 1.08;
      airCyl = Math.min(airCyl, cap);
    }
    else if (!F.map) { airCyl = sdAir(); S.loadSrc = 'MAP speed-density'; }
    else { airCyl = 0.05 + 0.55 * (1 - Math.cos((S.throttle / 100) * Math.PI / 2)) * 1.4; S.loadSrc = 'TPS alpha-N'; }
    if (F.maf && S.running) setDTC(S, 'P0102');
    S.airCylMeas = airCyl;
    const loadN = airCyl / E.airRef;
    S.loadPct = loadN * 100;

    // ---------- Target lambda ----------
    // reasons are i18n keys ({k, v}); `soft` = the reason may still be overridden by warm-up text
    let lt = interp2(S.cal.lambda, sens.rpm, loadN * 100), reason = { k: 'stoichiometric (catalyst window)' }, soft = true, power = false;
    S.lambdaMap = lt;
    if (lt < 0.985) { reason = { k: E.turbo ? 'power enrichment under boost' : 'power enrichment (WOT)' }; soft = false; power = true; }
    else if (lt > 1.015) { reason = { k: 'lean cruise (from the λ map)' }; soft = false; }
    const egtLim = E.turbo ? 950 : 920;
    if (S.egt > egtLim) { lt = Math.min(lt, 0.8); reason = { k: 'component protection (EGT > {t} °C)', v: { t: egtLim } }; soft = false; }
    const warm = clamp((50 - ectU) / 70, 0, 1) * 0.22;
    if (warm > 0.005) { lt /= 1 + warm; if (soft) reason = { k: 'cold-engine enrichment' }; }
    if (S.afterStart > 0.01) { lt /= 1 + S.afterStart; if (soft) reason = { k: 'after-start enrichment' }; }
    S.lambdaTarget = lt; S.ltReason = reason; S.ltPower = power;

    // ---------- Fuel cut logic ----------
    if (S.pedal < 1 && sens.rpm > 1700 && ectU > 45 && S.running) S.dfcoT += dt; else S.dfcoT = 0;
    if (!S.dfco && S.dfcoT > 0.4) S.dfco = true;
    if (S.dfco && (sens.rpm < 1250 || S.pedal >= 1)) S.dfco = false;
    edge(S, 'dfco', S.dfco, 'Decel fuel cut (DFCO): pedal released above 1700 rpm → injectors OFF. O2 reads lean, catalyst fills with oxygen.', 'DFCO ended → fuel resumes.');

    if (sens.rpm > E.redline) S.revCut = true;
    else if (sens.rpm < E.redline - 200) S.revCut = false;
    edge(S, 'rev', S.revCut, 'Rev limiter: {r} rpm reached → fuel cut until {r2} rpm.', null, 'warn', 4, { r: E.redline, r2: E.redline - 200 });

    // ---------- Boost control ----------
    if (E.turbo) {
      S.boostMap = interp2(S.cal.boost, sens.rpm, S.pedal);
      S.boostTargetKpa = S.boostMap * S.boostTarget * 100;
      const boostRel = sens.boost - S.baro;
      const err = S.boostTargetKpa - boostRel;
      const dBoost = (boostRel - (S.prevBoost ?? boostRel)) / dt;
      S.prevBoost = boostRel;
      S.dBoostF = (S.dBoostF || 0) + (dBoost - (S.dBoostF || 0)) * (1 - Math.exp(-dt / 0.08));
      if (S.boostTargetKpa < 5 || S.overboostCut) { S.wgCmd = 1; S.wgI = 0; }
      else {
        // feed-forward + PID; integrator only runs near target (anti-windup)
        const ff = clamp(0.85 - S.boostTargetKpa / 220, 0.05, 0.9);
        if (Math.abs(err) < 25) S.wgI = clamp(S.wgI + err * 0.01 * dt, -0.4, 0.4);
        S.wgCmd = clamp(ff - 0.012 * err - S.wgI + 0.0035 * S.dBoostF, 0, 1);
      }
      // overboost protection
      const boostMax = Math.max(...S.cal.boost.z.map((row) => Math.max(...row))) * S.boostTarget * 100;
      if (boostRel > boostMax + 35) S.overboostT += dt; else S.overboostT = 0;
      if (!S.overboostCut && S.overboostT > 0.35) {
        S.overboostCut = true; setDTC(S, 'P0234');
        log(S, 'OVERBOOST {b} bar → fuel cut & throttle closed to protect the engine.', 'fault', { b: (boostRel / 100).toFixed(2) });
      }
      if (S.overboostCut && boostRel < 15) { S.overboostCut = false; log(S, 'Boost back to safe level → fuel restored.', 'info'); }
      if (err > 35 && sens.rpm > 3200 && S.pedal > 70) S.underboostT += dt; else S.underboostT = 0;
      if (S.underboostT > 2.5) setDTC(S, 'P0299');
      edge(S, 'onboost', S.boostTargetKpa > 20 && boostRel > S.boostTargetKpa * 0.9,
        'Boost target reached → ECU opens the wastegate just enough to hold it.', null, 'info');
    } else { S.overboostCut = false; S.wgCmd = 1; }

    S.fuelCutAll = S.sync === 0 || S.dfco || S.revCut || S.overboostCut || sens.rpm < 40;

    // ---------- Fuel quantity ----------
    let fuel;
    if (sens.rpm < 450 && S.cranking) {
      fuel = (airCyl * 1000 / 14.7) * (1.35 + clamp((20 - ectU) / 40, 0, 0.8));
    } else {
      fuel = (airCyl * 1000 / (14.7 * lt)) * (1 + S.stft + S.ltft) * (1 + S.ae);
    }
    S.fuelMg = S.fuelCutAll ? 0 : fuel;
    S.baseFuelMg = airCyl * 1000 / (14.7 * lt);
    S.deadtime = 0.55 + clamp(14 - S.vbat, 0, 6) * 0.14;
    const cycleMs = sens.rpm > 1 ? 120000 / sens.rpm : 1e9;
    if (S.fuelMg > 0) {
      S.pw = S.batch ? S.fuelMg / 2 / E.injFlow + S.deadtime : S.fuelMg / E.injFlow + S.deadtime;
      S.injDuty = ((S.batch ? 2 : 1) * S.pw) / cycleMs;
    } else { S.pw = 0; S.injDuty = 0; }
    edge(S, 'injmax', S.injDuty > 0.9, 'Injector duty cycle above 90 % — injectors nearly static open!', null, 'warn');

    // ---------- Spark ----------
    S.mbtNow = mbt(sens.rpm, loadN, E);
    S.klNow = knockLimit(S, S.octane, loadN, 0); // shown to the user; the ECU itself can't know it
    S.sparkMap = interp2(S.cal.spark, sens.rpm, loadN * 100);
    S.sparkCorr = -Math.max(0, iatU - 25) * 0.2 - Math.max(0, ectU - 95) * 0.4; // map is at 25 °C IAT / ≤95 °C ECT
    let base = S.sparkMap + S.sparkCorr;
    if (S.idleActive) base = S.mbtNow - 6;
    if (sens.rpm < 450 && S.cranking) base = 8;
    S.catHeat = S.startEct < 40 && S.runT < 25 && S.running ? -7 * (1 - S.runT / 25) : 0;
    if (F.knocksensor) { if (S.running) setDTC(S, 'P0325'); base -= 5; }
    S.sparkBase = base;
    for (let c = 0; c < 4; c++) S.sparkCyl[c] = clamp(base + S.sparkIdle + S.catHeat - S.knockRetard[c], -8, 45);
    S.spark = (S.sparkCyl[0] + S.sparkCyl[1] + S.sparkCyl[2] + S.sparkCyl[3]) / 4;
    S.dwell = clamp(2.8 * Math.pow(14 / Math.max(S.vbat, 8), 1.2), 1.8, 6);
    S.vvt = S.running ? clamp(Math.sin(clamp((sens.rpm - 1200) / 4200, 0, 1) * Math.PI) * 30 * clamp(loadN * 1.6, 0.2, 1), 0, 35) : 0;

    // ---------- Misfire monitor ----------
    if (F.misfire3 && S.running && !S.injCut[2]) {
      S.misfireAcc += (sens.rpm / 120) * dt;
      S.misfireActive = true;
      if (S.misfireAcc > 25) {
        setDTC(S, 'P0303');
        S.injCut[2] = true;
        log(S, 'Misfire monitor: cyl 3 crank segment keeps decelerating → injector 3 shut off to protect the catalyst.', 'fault');
      }
    } else if (!F.misfire3) { S.misfireAcc = 0; S.misfireActive = false; if (S.injCut[2]) { S.injCut[2] = false; log(S, 'Cylinder 3 re-enabled.', 'ok'); } }
    else S.misfireActive = false;
    if (F.misfire3 && S.misfireAcc > 3 && !S.injCut[2]) edge(S, 'misfire', true, 'Crank speed dips every time cylinder 3 should fire → misfire counter rising. MIL flashing.', null, 'warn');
    else if (!F.misfire3) S.flags.misfire = false;

    // ---------- Closed loop fuel control ----------
    let ol = null;
    if (!S.running) ol = { k: 'engine not running' };
    else if (ectU < 35) ol = { k: 'coolant {t} °C < 35 °C', v: { t: ectU.toFixed(0) } };
    else if (S.o2Temp < 350) ol = { k: 'O2 sensor heating ({t} °C)', v: { t: S.o2Temp.toFixed(0) } };
    else if (S.dfco) ol = { k: 'decel fuel cut' };
    else if (S.revCut || S.overboostCut) ol = { k: 'fuel cut' };
    else if (lt < 0.985 || lt > 1.015) ol = reason;
    else if (S.o2Dead) ol = { k: 'O2 sensor fault (P0134)' };
    else if (S.injCut.some(Boolean)) ol = { k: 'cylinder shut-off (trims frozen)' };
    else if (S.runT < 3) ol = { k: 'post-start stabilisation' };
    const clWas = S.closedLoop;
    S.closedLoop = !ol;
    S.olReason = ol || { k: '' };
    if (S.closedLoop && !clWas) log(S, 'CLOSED LOOP: ECU now trims fuel from the upstream O2 sensor (switching around λ = 1).', 'ok');
    if (!S.closedLoop && clWas) log(S, 'OPEN LOOP: {ol}.', 'info', { ol });

    if (S.closedLoop) {
      // rich/lean decision with a hysteresis band so sensor noise can't chatter the controller
      const rich = S.o2v > 0.5 ? true : S.o2v < 0.4 ? false : S.o2Rich;
      if (rich !== S.o2Rich) {
        S.stft += rich ? -0.025 : 0.025; // proportional jump
        S.o2Switches.push(S.t);
        S.o2Total++;
        if (S.o2Total >= 20) S.monitors.o2 = true; // O2 response monitor: enough clean switches seen
      }
      S.o2Rich = rich;
      S.stft += (rich ? -0.07 : 0.07) * dt; // integral ramp
      S.stft = clamp(S.stft, -0.25, 0.25);
      if (Math.abs(S.stft) > 0.02) { const k = S.stft * 0.2 * dt; S.ltft = clamp(S.ltft + k, -0.25, 0.25); S.stft -= k; }
      // O2 activity monitor
      if (F.o2 && S.stft > 0.24) { S.o2DeadT += dt; if (S.o2DeadT > 3) { S.o2Dead = true; setDTC(S, 'P0134'); log(S, 'O2 sensor never switches rich even at +25 % trim → sensor declared dead, open loop.', 'fault'); } }
      else S.o2DeadT = 0;
      // catalyst monitor: count switches
      const upR = S.o2v > 0.5 ? true : S.o2v < 0.4 ? false : S.lastUpRich;
      const dnR = S.o2dn > 0.5 ? true : S.o2dn < 0.4 ? false : S.lastDnRich;
      if (upR !== S.lastUpRich) S.catMon.up++;
      if (dnR !== S.lastDnRich) S.catMon.dn++;
      S.lastUpRich = upR; S.lastDnRich = dnR;
      if (S.catMon.up > 40) {
        S.monitors.cat = true; // catalyst monitor has run
        if (S.catMon.dn / S.catMon.up > 0.5) { setDTC(S, 'P0420'); }
        S.catMon.up = 0; S.catMon.dn = 0;
      }
    } else {
      S.stft *= Math.exp(-dt / 0.5);
    }
    while (S.o2Switches.length && S.o2Switches[0] < S.t - 4) S.o2Switches.shift();
    S.o2Freq = S.o2Switches.length / 8;

    if (S.closedLoop) { S.clTime += dt; if (S.clTime > 10) S.monitors.fuel = true; }
    if (S.running && S.o2Temp > 350) S.monitors.o2heater = true;
    if (Object.values(S.dtc).some((d) => d.mil)) S.distMil += (S.v * dt) / 1000;

    const trim = S.stft + S.ltft;
    if (trim > 0.22 && S.closedLoop) { S.leanT = (S.leanT || 0) + dt; if (S.leanT > 4) setDTC(S, 'P0171'); } else S.leanT = 0;
    if (trim < -0.22 && S.closedLoop) { S.richT = (S.richT || 0) + dt; if (S.richT > 4) setDTC(S, 'P0172'); } else S.richT = 0;

    // ---------- Other monitors ----------
    if (F.fuelpump && S.fuelP - (S.map - S.baro) / 100 < E.fuelBase * 0.8 && S.running) setDTC(S, 'P0087');
    if (F.alt && S.running && S.vbat < 12.3) setDTC(S, 'P0562');
    if (F.thermostat && S.running && S.runT > 60 && S.ect < 70) setDTC(S, 'P0128');
  }

  ECU.step = step;

  /* ---------- Engine dyno: speed-controlled full-throttle sweep ----------
     settle at the start speed, then ramp rpm at `rate` rpm/s and average the brake torque in
     50 rpm bins. The absorber holds speed exactly, so the curve is the engine's own torque. */
  ECU.startDyno = function (S, { start = 1500, end = S.E.redline - 150, rate = 400, settle = 1.2 } = {}) {
    S.dyno = { phase: 'settle', rpm: start, start, end, rate, settle, t: 0, samples: [], nextBin: start + 50, acc: null, k0: S.knockCount };
    S.gear = 0; S.v = 0;
    log(S, 'Dyno: full throttle at {r} rpm, sweeping to {e} rpm at {rate} rpm/s…', 'info', { r: start, e: end, rate });
  };
  ECU.abortDyno = function (S, reason) {
    if (!S.dyno) return;
    S.dyno.phase = 'aborted';
    S.dyno.reason = reason;
    S.pedal = 0;
    log(S, 'Dyno pull aborted: {why}.', 'warn', { why: { k: reason } });
  };
  function dynoStep(S, dt) {
    const d = S.dyno;
    if (d.phase !== 'settle' && d.phase !== 'pull') return;
    if (!S.running) { ECU.abortDyno(S, 'engine not running'); return; }
    if (d.phase === 'settle') {
      d.t += dt;
      if (d.t >= d.settle) { d.phase = 'pull'; d.acc = null; }
      return;
    }
    d.rpm = Math.min(d.end, d.rpm + d.rate * dt);
    const a = d.acc || (d.acc = { n: 0, tq: 0, boost: 0, lam: 0, spark: 0, egt: 0, k: S.knockCount });
    a.n++; a.tq += S.torque; a.boost += S.boostP - S.baro; a.lam += Math.min(S.lambda, 2); a.spark += S.spark; a.egt += S.egt;
    if (d.rpm >= d.nextBin || d.rpm >= d.end) {
      const rpm = d.nextBin - 25;
      const tq = a.tq / a.n;
      d.samples.push({ rpm, tq, kw: (tq * rpm * Math.PI) / 30 / 1000, boost: a.boost / a.n, lam: a.lam / a.n, spark: a.spark / a.n, egt: a.egt / a.n, knock: S.knockCount - a.k });
      d.acc = null;
      d.nextBin += 50;
    }
    if (d.rpm >= d.end) {
      d.phase = 'done';
      S.pedal = 0;
      const pk = d.samples.reduce((m, x) => (x.tq > m.tq ? x : m), d.samples[0]);
      const pp = d.samples.reduce((m, x) => (x.kw > m.kw ? x : m), d.samples[0]);
      d.peak = { tq: pk.tq, tqRpm: pk.rpm, kw: pp.kw, kwRpm: pp.rpm };
      log(S, 'Dyno pull done: peak torque {t} Nm @ {tr} rpm, peak power {p} kW ({hp} hp) @ {pr} rpm.', 'ok',
        { t: pk.tq.toFixed(0), tr: pk.rpm, p: pp.kw.toFixed(0), hp: (pp.kw * 1.341).toFixed(0), pr: pp.rpm });
    }
  }

  /* Crank-angle domain helpers used by the views */

  // local cylinder angle: 0 = firing TDC
  ECU.localAngle = function (theta, c) {
    return (((theta - ECU.CYL_OFFSET[c]) % 720) + 720) % 720;
  };
  ECU.strokeOf = function (local) {
    return (Math.floor(local / 180) | 0) & 3; // 0 power,1 exhaust,2 intake,3 compression
  };
  // Valve timing (local degrees). Intake cam phased by VVT advance.
  ECU.valveLift = function (local, which, vvt) {
    let open, close;
    if (which === 'in') { open = 350 - vvt; close = 590 - vvt; }
    else { open = 130; close = 372; }
    let a = local;
    if (a < open - 360) a += 720;
    if (a < open || a > close) {
      if (a + 720 >= open && a + 720 <= close) a += 720; else return 0;
    }
    const x = (a - open) / (close - open);
    return Math.pow(Math.sin(x * Math.PI), 1.4);
  };

  // CKP signal at a crank angle (0..720): 60-2 wheel, first tooth after the gap = 90° BTDC #1/#4
  ECU.ckpTooth = function (theta) {
    const a = (((theta + 90) % 360) + 360) % 360; // tooth 0 starts 90° BTDC; teeth 58/59 missing
    const idx = Math.floor(a / 6);
    return { idx, frac: (a % 6) / 6, missing: idx >= 58 };
  };
  ECU.ckpSignal = function (theta, type, rpm) {
    const t = ECU.ckpTooth(theta);
    if (type === 'hall') return t.missing ? 0 : t.frac < 0.5 ? 1 : 0;
    // VR: derivative of flux — sine per tooth, bigger swing entering/leaving the gap
    if (t.missing) {
      const a = (((theta + 90) % 360) + 360) % 360 - 348; // 0..12 in gap
      return 0.15 * Math.sin((a / 12) * Math.PI) * -1;
    }
    let v = Math.sin(t.frac * 2 * Math.PI);
    if (t.idx === 0 && t.frac < 0.5) v *= 1.6;
    if (t.idx === 57 && t.frac > 0.5) v *= 1.6;
    return v;
  };
  // CMP: one tab on the cam, high 60° wide before cyl 1 compression TDC
  ECU.cmpSignal = function (theta, vvt) {
    const a = (((theta + (vvt || 0)) % 720) + 720) % 720;
    return a >= 600 && a < 660 ? 1 : 0;
  };
})();
