/* DOM panels: sensors, lamps, actuators, ECU brain, log, drawer, controls. */
(function () {
  const ECU = window.ECU;
  const $ = (s) => document.querySelector(s);
  const clamp = ECU.util.clamp;

  // ---------- electrical signal helpers ----------
  function ntcVolts(T) {
    const R = 2500 * Math.exp(3450 * (1 / (T + 273.15) - 1 / 293.15));
    return (5 * R) / (R + 2490);
  }
  const f1 = (v) => v.toFixed(1), f0 = (v) => v.toFixed(0), f2 = (v) => v.toFixed(2);

  // Reading for every sensor: value text, short tag, electrical signal, status, bar fraction
  function readSensor(S, id) {
    const F = S.faults, on = S.ecuOn, run = S.rpm > 30;
    const r = { value: '—', unit: '', short: '—', sig: '', status: on ? 'ok' : 'off', frac: 0 };
    switch (id) {
      case 'ckp': {
        const rpm = F.ckp ? 0 : S.rpm;
        const hz = (rpm / 60) * 58;
        r.value = f0(rpm); r.unit = 'rpm'; r.short = `${f0(rpm)} rpm`;
        r.sig = F.ckp ? 'open circuit' : S.ckpType === 'vr' ? `±${f1(Math.max(0.2, S.rpm / 450))} V · ${f0(hz)} Hz` : `0/5 V · ${f0(hz)} Hz`;
        r.status = F.ckp ? 'bad' : run ? 'live' : on ? 'ok' : 'off';
        r.frac = rpm / 8000;
        break;
      }
      case 'cmp': {
        r.value = F.cmp ? 'NO SIG' : S.sync === 2 ? 'SYNC' : run ? 'waiting' : '—';
        r.short = F.cmp ? 'NO SIG' : `${f1(S.vvt || 0)}° VVT`;
        r.sig = F.cmp ? 'no pulses' : `0/5 V · ${f1(S.rpm / 120)} Hz`;
        r.status = F.cmp ? 'bad' : S.sync === 2 ? 'live' : on ? 'ok' : 'off';
        r.frac = (S.vvt || 0) / 35;
        break;
      }
      case 'maf': {
        const v = F.maf ? 0 : S.mafTrue;
        r.value = f1(v); r.unit = 'g/s'; r.short = `${f1(v)} g/s`;
        r.sig = F.maf ? '0.00 V (fault)' : `${f2(0.95 + 3.9 * Math.sqrt(v / 260))} V`;
        r.status = F.maf ? 'bad' : on ? 'ok' : 'off';
        r.frac = v / (S.E.turbo ? 230 : 130);
        break;
      }
      case 'map': {
        const v = F.map ? 0 : S.map;
        const range = S.E.turbo ? 300 : 105;
        r.value = f0(v); r.unit = 'kPa'; r.short = `${f0(v)} kPa`;
        r.sig = F.map ? '0.00 V (fault)' : `${f2(0.5 + (4 * v) / range)} V`;
        r.status = F.map ? 'bad' : on ? 'ok' : 'off';
        r.frac = v / range;
        break;
      }
      case 'tps': {
        const t = S.throttle;
        r.value = f1(t); r.unit = '%'; r.short = `${f1(t)} %`;
        const v1 = 0.5 + (t / 100) * 4, v2 = F.tps ? 4.5 - (clamp(t + 18, 0, 100) / 100) * 4 : 4.5 - (t / 100) * 4;
        r.sig = `T1 ${f2(v1)} V · T2 ${f2(v2)} V`;
        r.status = F.tps ? 'bad' : on ? 'ok' : 'off';
        r.frac = t / 100;
        break;
      }
      case 'app': {
        r.value = f0(S.pedal); r.unit = '%'; r.short = `${f0(S.pedal)} %`;
        r.sig = `${f2(0.75 + S.pedal * 0.0375)} V / ${f2(0.375 + S.pedal * 0.01875)} V`;
        r.frac = S.pedal / 100;
        break;
      }
      case 'baro':
        r.value = f1(S.baro); r.unit = 'kPa'; r.short = `${f1(S.baro)} kPa`; r.sig = `${f2(0.5 + (4 * S.baro) / 115)} V`; r.frac = S.baro / 110;
        break;
      case 'o2up': {
        const v = S.o2v;
        r.value = f2(v); r.unit = 'V'; r.short = `${f2(v)} V`;
        r.sig = F.o2 ? 'stuck lean' : S.o2Temp < 320 ? `cold (${f0(S.o2Temp)} °C)` : S.closedLoop ? `${v > 0.45 ? 'RICH' : 'lean'} · ${f1(S.o2Freq)} Hz` : v > 0.45 ? 'RICH' : 'lean';
        r.status = F.o2 || S.o2Dead ? 'bad' : !on ? 'off' : S.o2Temp < 320 ? 'warn' : 'ok';
        r.frac = v;
        break;
      }
      case 'o2dn': {
        const v = S.o2dn;
        r.value = f2(v); r.unit = 'V'; r.short = `${f2(v)} V`;
        r.sig = F.cat ? 'mirrors upstream!' : S.o2Temp < 320 ? 'cold' : `cat O₂ store ${f0(S.catOsc * 100)} %`;
        r.status = S.dtc.P0420 ? 'bad' : !on ? 'off' : S.o2Temp < 320 ? 'warn' : 'ok';
        r.frac = v;
        break;
      }
      case 'knock': {
        const kn = Math.max(...S.knockTrue);
        const mv = F.knocksensor ? 0 : (run ? 40 + S.rpm * 0.05 : 5) + kn * 1400;
        r.value = f0(mv); r.unit = 'mV'; r.short = `${f0(mv)} mV`;
        r.sig = F.knocksensor ? 'open circuit' : kn > 0.1 ? 'KNOCK detected!' : `${S.knockCount} events total`;
        r.status = F.knocksensor ? 'bad' : S.t - S.lastKnockT < 1 ? 'warn' : on ? 'ok' : 'off';
        r.frac = mv / 1800;
        break;
      }
      case 'egt':
        r.value = f0(S.egt); r.unit = '°C'; r.short = `${f0(S.egt)} °C`; r.sig = `${f1((S.egt * 41) / 1000)} mV (type K)`;
        r.status = !on ? 'off' : S.egt > (S.E.turbo ? 950 : 920) ? 'warn' : 'ok'; r.frac = S.egt / 1050;
        break;
      case 'ect': {
        const t = F.ect ? -40 : S.ect;
        r.value = f0(t); r.unit = '°C'; r.short = `${f0(t)} °C`;
        r.sig = F.ect ? '4.98 V (open)' : `${f2(ntcVolts(S.ect))} V`;
        r.status = F.ect ? 'bad' : !on ? 'off' : S.ect > 110 ? 'bad' : S.ect < 40 ? 'warn' : 'ok';
        r.frac = (t + 40) / 170;
        break;
      }
      case 'iat': {
        const t = F.iat ? -40 : S.iat;
        r.value = f0(t); r.unit = '°C'; r.short = `${f0(t)} °C`;
        r.sig = F.iat ? '4.98 V (open)' : `${f2(ntcVolts(S.iat))} V`;
        r.status = F.iat ? 'bad' : on ? 'ok' : 'off';
        r.frac = (t + 40) / 140;
        break;
      }
      case 'oilp':
        r.value = f1(S.oilP); r.unit = 'bar'; r.short = `${f1(S.oilP)} bar`; r.sig = S.oilP < 0.45 ? 'switch CLOSED (low)' : `${f2(0.5 + S.oilP * 0.4)} V`;
        r.status = !on ? 'off' : S.oilP < 0.45 ? (run ? 'bad' : 'warn') : 'ok'; r.frac = S.oilP / 6;
        break;
      case 'oilt':
        r.value = f0(S.oilT); r.unit = '°C'; r.short = `${f0(S.oilT)} °C`; r.sig = `${f2(ntcVolts(S.oilT))} V`; r.frac = (S.oilT + 20) / 160;
        break;
      case 'fuelp':
        const dp = S.fuelP - (S.map - S.baro) / 100;
        r.value = f2(S.fuelP); r.unit = 'bar'; r.short = `${f1(S.fuelP)} bar`; r.sig = `Δp across inj. ${f2(dp)} bar`;
        r.status = !on ? 'off' : dp < S.E.fuelBase * 0.8 && run ? 'bad' : S.fuelP < 1 ? 'warn' : 'ok'; r.frac = S.fuelP / 6;
        break;
      case 'vbat':
        r.value = f1(S.vbat); r.unit = 'V'; r.short = `${f1(S.vbat)} V`; r.sig = S.rpm > 550 && !F.alt ? 'charging' : S.cranking ? 'cranking load' : 'battery only';
        r.status = !on ? 'off' : S.vbat < 11.8 ? 'bad' : S.vbat < 12.4 ? 'warn' : 'ok'; r.frac = (S.vbat - 9) / 6;
        break;
      case 'fuellvl':
        r.value = f0(S.fuelLevel); r.unit = '%'; r.short = `${f0(S.fuelLevel)} %`; r.sig = `${f0(10 + (1 - S.fuelLevel / 100) * 170)} Ω`;
        r.status = !on ? 'off' : S.fuelLevel < 10 ? 'warn' : 'ok'; r.frac = S.fuelLevel / 100;
        break;
      case 'boost': {
        const b = (S.boostP - S.baro) / 100;
        r.value = (b >= 0 ? '+' : '') + f2(b); r.unit = 'bar'; r.short = `${b >= 0 ? '+' : ''}${f2(b)} bar`;
        r.sig = `${f0(S.boostP)} kPa abs · ${f2(0.5 + (4 * S.boostP) / 300)} V`;
        r.status = !on ? 'off' : S.overboostCut ? 'bad' : 'ok'; r.frac = S.boostP / 280;
        break;
      }
      case 'cat':
        r.value = f0(S.chargeT); r.unit = '°C'; r.short = `${f0(S.chargeT)} °C`; r.sig = `comp. out ${f0(S.compOutT)} °C`; r.frac = (S.chargeT + 20) / 140;
        break;
      case 'turbo':
        r.value = f0(S.turbo); r.unit = 'krpm'; r.short = `${f0(S.turbo)} krpm`; r.sig = `${f0((S.turbo * 1000 * 12) / 60 / 1000)} kHz blade pass`; r.frac = S.turbo / 230;
        r.status = !on ? 'off' : S.turbo > 60 ? 'live' : 'ok';
        break;
      case 'wgpos':
        r.value = f0(S.wgPos * 100); r.unit = '% open'; r.short = `${f0(S.wgPos * 100)} %`; r.sig = `cmd duty ${f0((1 - S.wgCmd) * 100)} %`;
        r.status = F.wgstuck ? 'bad' : on ? 'ok' : 'off'; r.frac = S.wgPos;
        break;
      case 'vss':
        r.value = f0(S.v * 3.6); r.unit = 'km/h'; r.short = `${f0(S.v * 3.6)} km/h`; r.sig = `${f0(S.v * 3.6 * 1.9)} Hz`; r.frac = (S.v * 3.6) / 250;
        break;
      case 'brake':
        r.value = S.brake ? 'ON' : 'off'; r.short = S.brake ? 'ON' : 'off'; r.sig = S.brake ? '12 V / 0 V' : '0 V / 12 V'; r.status = !on ? 'off' : S.brake ? 'live' : 'ok'; r.frac = S.brake ? 1 : 0;
        break;
      case 'acsw':
        r.value = S.ac ? 'ON' : 'off'; r.short = S.ac ? 'ON' : 'off'; r.sig = S.ac ? `${f1(14 + S.rpm / 800)} bar refrig.` : 'idle'; r.status = !on ? 'off' : S.ac ? 'live' : 'ok'; r.frac = S.ac ? 1 : 0;
        break;
      case 'amb':
        r.value = f0(S.ambient); r.unit = '°C'; r.short = `${f0(S.ambient)} °C`; r.sig = `${f2(ntcVolts(S.ambient))} V`; r.frac = (S.ambient + 30) / 80;
        break;
    }
    r.frac = clamp(r.frac || 0, 0, 1);
    return r;
  }
  ECU.readSensor = readSensor;

  // ---------- lamps ----------
  const ICON = {
    mil: '<svg viewBox="0 0 24 24"><path d="M3 10h2V8h3V6h6v2h3l2 2h2v6h-2l-2 2H8l-3-3H3z"/></svg>',
    oil: '<svg viewBox="0 0 24 24"><path d="M2 11l3-1.5h6l2.5-2 8 3-7.5 6H6L2 14z"/><path d="M21.5 14.5c0 .9.6 1.8.6 1.8s.6-.9.6-1.8-.6-1.8-.6-1.8-.6.9-.6 1.8z"/></svg>',
    batt: '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M3 7h18v12H3zM5 11h4v1.5H5zm10 0h1.5V9.5H18V11h1.5v1.5H18V14h-1.5v-1.5H15z"/><path d="M6 5h3v2H6zM15 5h3v2h-3z"/></svg>',
    temp: '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M11 3h2v10.3a3.2 3.2 0 1 1-2 0z"/><path d="M14 6h4v1.5h-4zM14 9h4v1.5h-4zM3 19c2-1 3 1 5 0s3 1 5 0 3 1 5 0 3 1 3 0v1.5c-2 1-3-1-5 0s-3-1-5 0-3-1-5 0-3-1-3 0z"/></svg>',
    knock: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h6l-1 8 9-12h-6z"/></svg>',
    pump: '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M4 4h9v17H4zM6 6v4h5V6z"/><path d="M14 9h2l3 3v6a1.5 1.5 0 0 0 3 0V9l-3-3 1-1 3 3v10a3 3 0 0 1-6 0v-5l-2-2h-1z"/></svg>',
  };
  const LAMPS = [
    { id: 'mil', label: 'CHECK', icon: ICON.mil, c: '#ffb020', tip: 'Malfunction indicator (check engine). On with emissions faults, flashes for catalyst-damaging misfire.' },
    { id: 'oil', label: 'OIL', icon: ICON.oil, c: '#ff4d5e', tip: 'Oil pressure below ~0.4 bar.' },
    { id: 'batt', label: 'CHG', icon: ICON.batt, c: '#ff4d5e', tip: 'Alternator not charging.' },
    { id: 'hot', label: 'HOT', icon: ICON.temp, c: '#ff4d5e', tip: 'Coolant over 112 °C.' },
    { id: 'cold', label: 'COLD', icon: ICON.temp, c: '#62a8ff', tip: 'Engine still cold (<40 °C) — enrichment active, go easy.' },
    { id: 'epc', label: 'EPC', c: '#ffb020', tip: 'Electronic power control — throttle system fault, limp mode.' },
    { id: 'knock', label: 'KNOCK', icon: ICON.knock, c: '#ffb020', tip: 'Knock just detected and spark retarded.' },
    { id: 'boost', label: 'OVERBOOST', c: '#ff4d5e', tip: 'Overboost protection active.', turbo: true },
    { id: 'rev', label: 'SHIFT', c: '#ff4d5e', tip: 'Near/at the rev limiter.' },
    { id: 'lowfuel', label: 'FUEL', icon: ICON.pump, c: '#ffb020', tip: 'Low fuel.' },
    { id: 'pump', label: 'PUMP', c: '#3ee07a', tip: 'Fuel pump relay energised.' },
    { id: 'fan', label: 'FAN', c: '#2ee6c5', tip: 'Radiator fan running.' },
    { id: 'cl', label: 'CLOSED LOOP', c: '#3ee07a', tip: 'Fuel trimmed by O2 sensor feedback.' },
    { id: 'dfco', label: 'DFCO', c: '#62a8ff', tip: 'Deceleration fuel cut-off.' },
  ];

  function lampStates(S, bulb) {
    const on = S.ecuOn;
    const milDtc = Object.values(S.dtc).some((d) => d.mil);
    const st = {
      mil: on && (milDtc || S.misfireActive || S.rpm < 300),
      oil: on && S.oilP < 0.45,
      batt: on && (S.rpm < 500 || !!S.faults.alt),
      hot: on && S.ect > 112,
      cold: on && S.ect < 40,
      epc: on && S.limp,
      knock: on && S.t - S.lastKnockT < 0.5,
      boost: on && S.overboostCut,
      rev: on && S.rpm > S.E.redline - 350,
      lowfuel: on && S.fuelLevel < 10,
      pump: on && S.fuelPump,
      fan: on && S.fan,
      cl: on && S.closedLoop,
      dfco: on && S.dfco,
    };
    const flash = { mil: S.misfireActive && !S.injCut[2], boost: true, rev: S.revCut };
    if (on && bulb > 0) for (const k in st) st[k] = true;
    return { st, flash: bulb > 0 ? {} : flash };
  }

  // ---------- UI class ----------
  function UI(app) {
    this.app = app;
    this.selected = null;
    this.hist = [];
    this.lastLogId = 0;
    this.dtcSig = '';
    this.buildSensors();
    this.buildFaults();
    this.buildLamps();
    this.buildActuators();
    this.buildLegend();
    this.bindControls();
  }

  UI.prototype.buildLegend = function () {
    $('#strokeLegend').innerHTML = ECU.STROKES.map((s) => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('') +
      `<span><i style="background:var(--fuel)"></i>Injection</span><span><i style="background:var(--spark)"></i>Spark</span>`;
  };

  UI.prototype.buildSensors = function () {
    const list = $('#sensorList');
    list.innerHTML = '';
    this.sRows = {};
    for (const g of ECU.SENSOR_GROUPS) {
      const sens = ECU.SENSORS.filter((s) => s.group === g.id);
      if (!sens.length) continue;
      const box = document.createElement('div');
      box.className = 's-group' + (g.turboOnly ? ' turbo-only' : '');
      box.innerHTML = `<h4>${g.name}</h4>`;
      for (const s of sens) {
        const row = document.createElement('div');
        row.className = 'srow' + (s.turboOnly ? ' turbo-only' : '');
        row.innerHTML = `<span class="led"></span><div><div class="sn"><span class="ab">${s.abbr}</span>${s.name}</div><div class="sbar"><i></i></div></div><div><div class="sv">—</div><div class="ssig"></div></div>`;
        row.addEventListener('click', () => this.openSensor(s.id));
        box.appendChild(row);
        this.sRows[s.id] = { row, led: row.querySelector('.led'), v: row.querySelector('.sv'), sig: row.querySelector('.ssig'), bar: row.querySelector('.sbar i') };
      }
      list.appendChild(box);
    }
  };

  UI.prototype.buildFaults = function () {
    const box = $('#faultList');
    box.innerHTML = '';
    this.faultEls = {};
    for (const f of ECU.FAULTS) {
      const b = document.createElement('button');
      b.className = 'fault' + (f.turboOnly ? ' turbo-only' : '');
      b.innerHTML = `<span class="sw"></span><span><div class="fn">${f.name}</div><div class="fh">${f.hint}</div></span><span class="fc">${f.dtc}</span>`;
      b.addEventListener('click', () => {
        const S = this.app.S;
        S.faults[f.id] = !S.faults[f.id];
        b.classList.toggle('on', !!S.faults[f.id]);
        ECU.log(S, `${S.faults[f.id] ? 'FAULT INJECTED' : 'Fault repaired'}: ${f.name}.`, S.faults[f.id] ? 'fault' : 'ok');
      });
      box.appendChild(b);
      this.faultEls[f.id] = b;
    }
  };

  UI.prototype.buildLamps = function () {
    const box = $('#lamps');
    box.innerHTML = '';
    this.lampEls = {};
    for (const l of LAMPS) {
      const el = document.createElement('div');
      el.className = 'lamp' + (l.turbo ? ' turbo-only' : '');
      el.style.setProperty('--c', l.c);
      el.title = l.tip;
      el.innerHTML = (l.icon || '') + `<span>${l.label}</span>`;
      box.appendChild(el);
      this.lampEls[l.id] = el;
    }
  };

  UI.prototype.buildActuators = function () {
    const box = $('#actList');
    box.innerHTML = '';
    this.actEls = {};
    for (const a of ECU.ACTUATORS) {
      const el = document.createElement('div');
      el.className = 'act' + (a.turboOnly ? ' turbo-only' : '');
      el.innerHTML = `<div class="an"><span>${a.name}</span><span class="dot"></span></div><div class="av">—</div><div class="abar"><i></i></div>`;
      el.addEventListener('click', () => this.openActuator(a.id));
      box.appendChild(el);
      this.actEls[a.id] = { el, v: el.querySelector('.av'), bar: el.querySelector('.abar i') };
    }
  };

  function actState(S, id) {
    const on = S.ecuOn;
    switch (id) {
      case 'inj': return { on: S.pw > 0, v: S.pw > 0 ? `${S.pw.toFixed(2)} ms · ${(S.injDuty * 100).toFixed(0)} % duty · ${S.fuelMg.toFixed(1)} mg${S.batch ? ' · BATCH' : ''}` : S.fuelCutAll && S.running ? 'fuel CUT' : 'off', f: S.injDuty, c: '#ffb020' };
      case 'coil': return { on: on && S.sync > 0, v: on && S.sync > 0 ? `${S.spark.toFixed(1)}° BTDC · dwell ${S.dwell.toFixed(1)} ms${S.batch ? ' · WASTED' : ''}` : 'off', f: (S.spark + 10) / 55, c: '#ffe45c' };
      case 'etc': return { on, v: `cmd ${S.throttleCmd.toFixed(1)} % → ${S.throttle.toFixed(1)} %${S.limp ? ' · LIMP' : ''}`, f: S.throttle / 100, c: '#2ee6c5' };
      case 'pump': return { on: S.fuelPump, v: S.fuelPump ? (S.primeT > 0 && S.rpm < 50 ? 'ON · priming' : 'ON') : 'off', f: S.fuelPump ? 1 : 0, c: '#3ee07a' };
      case 'fan': return { on: S.fan, v: S.fan ? 'ON' : 'off', f: S.fan ? 1 : 0, c: '#2ee6c5' };
      case 'vvt': return { on: S.vvt > 0.5, v: `${S.vvt.toFixed(1)}° intake advance`, f: S.vvt / 35, c: '#b98cff' };
      case 'wg': return { on: S.boostTargetKpa > 5, v: `duty ${((1 - S.wgCmd) * 100).toFixed(0)} % · flap ${(S.wgPos * 100).toFixed(0)} % open`, f: 1 - S.wgCmd, c: '#ff9f43' };
      case 'bov': return { on: S.bovT > 0, v: S.bovT > 0 ? 'VENTING' : 'closed', f: S.bovT > 0 ? 1 : 0, c: '#cfe9ff' };
      case 'o2h': return { on: on && S.rpm > 300, v: `${on && S.rpm > 300 ? 'ON' : 'off'} · element ${S.o2Temp.toFixed(0)} °C`, f: S.o2Temp / 750, c: '#ff6b8a' };
      case 'alt': return { on: S.rpm > 550 && !S.faults.alt, v: S.faults.alt ? 'FAILED' : S.rpm > 550 ? `${S.vbat.toFixed(1)} V · ${S.elecW.toFixed(0)} W load` : 'not charging', f: S.elecW / 1000, c: '#62a8ff' };
      case 'acc': return { on: S.ac && S.running, v: S.ac && S.running ? 'engaged' : S.ac ? 'waiting for engine' : 'off', f: S.ac && S.running ? 1 : 0, c: '#62a8ff' };
      case 'mil': {
        const m = on && (Object.values(S.dtc).some((d) => d.mil) || S.rpm < 300);
        return { on: m, v: S.misfireActive && !S.injCut[2] ? 'FLASHING' : m ? 'ON' : 'off', f: m ? 1 : 0, c: '#ffb020' };
      }
    }
    return { on: false, v: '', f: 0 };
  }

  UI.prototype.update = function (S, bulb, dt) {
    // sensors
    const readings = {};
    let active = 0;
    for (const s of ECU.SENSORS) {
      const r = readSensor(S, s.id);
      readings[s.id] = r;
      if (s.turboOnly && !S.E.turbo) continue;
      const row = this.sRows[s.id];
      row.v.innerHTML = r.unit ? `${r.value}<small>${r.unit}</small>` : r.value;
      row.sig.textContent = r.sig;
      row.led.className = 'led ' + r.status;
      row.bar.style.width = (r.frac * 100).toFixed(1) + '%';
      row.bar.style.background = r.status === 'bad' ? 'var(--bad)' : r.status === 'warn' ? 'var(--warn)' : 'var(--accent)';
      if (r.status !== 'off') active++;
    }
    const total = ECU.SENSORS.filter((s) => !s.turboOnly || S.E.turbo).length;
    $('#sensorCount').textContent = `${active}/${total} live`;
    this.readings = readings;

    // lamps
    const ls = lampStates(S, bulb);
    for (const id in this.lampEls) {
      this.lampEls[id].classList.toggle('on', !!ls.st[id]);
      this.lampEls[id].classList.toggle('flash', !!(ls.st[id] && ls.flash[id]));
    }

    // actuators
    for (const a of ECU.ACTUATORS) {
      const st = actState(S, a.id);
      const e = this.actEls[a.id];
      e.el.classList.toggle('on', !!st.on);
      e.el.style.setProperty('--c', st.c || 'var(--ok)');
      e.v.textContent = st.v;
      e.bar.style.width = (clamp(st.f, 0, 1) * 100).toFixed(1) + '%';
    }

    // key + hints
    document.querySelectorAll('.kpos').forEach((b) => b.classList.toggle('active', b.dataset.key === S.key));
    const keyAng = { OFF: -60, ACC: -20, ON: 20, START: 60 }[S.key];
    $('#keyRotor').style.transform = `rotate(${keyAng}deg)`;
    $('#keyHint').textContent = !S.ecuOn ? (S.key === 'ACC' ? 'ACC — accessories only, ECU off.' : 'Key OFF — ECU asleep.') : S.cranking ? 'Cranking… starter engaged.' : S.running ? 'Engine running.' : S.primeT > 0 ? 'Bulb check + fuel pump prime…' : 'ECU on — ready to crank.';
    $('#speedVal').textContent = `${(S.v * 3.6).toFixed(0)} km/h`;
    document.querySelectorAll('#gearSel button').forEach((b) => b.classList.toggle('active', +b.dataset.g === S.gear));
    $('#brakeBtn').classList.toggle('active', S.brake);
    this.setRange($('#pedal'), S.pedal);
    $('#pedalVal').textContent = `${S.pedal.toFixed(0)} %`;

    // sync pill
    const sp = $('#syncPill');
    sp.className = 'sync-pill s' + S.sync;
    sp.textContent = S.sync === 2 ? 'FULL SYNC · sequential' : S.sync === 1 ? 'CRANK SYNC · batch/wasted' : S.rpm > 30 && S.ecuOn ? 'SEARCHING FOR GAP…' : 'NO SYNC';

    // log
    this.renderLog(S);

    // drawer live
    if (this.selected) this.updateDrawer(S, dt);
    return readings;
  };

  UI.prototype.setRange = function (el, v) {
    if (document.activeElement !== el && +el.value !== Math.round(v)) el.value = Math.round(v);
    const min = +el.min, max = +el.max;
    el.style.setProperty('--fill', `${((el.value - min) / (max - min)) * 100}%`);
  };

  UI.prototype.renderLog = function (S) {
    const list = $('#logList');
    const fresh = S.log.filter((l) => l.id > this.lastLogId);
    if (fresh.length) {
      for (const l of fresh) {
        const el = document.createElement('div');
        el.className = 'lg ' + l.kind;
        el.innerHTML = `<span class="lt">${l.t.toFixed(1)}s</span><span>${l.msg}</span>`;
        list.prepend(el);
      }
      this.lastLogId = fresh[fresh.length - 1].id;
      while (list.children.length > 80) list.lastChild.remove();
    }
    const codes = Object.values(S.dtc);
    const sig = codes.map((d) => d.code).join(',');
    if (sig !== this.dtcSig) {
      this.dtcSig = sig;
      $('#dtcList').innerHTML = codes.map((d) => `<div class="dtc"><b>${d.code}</b><span>${d.text}</span></div>`).join('');
      $('#dtcCount').innerHTML = codes.length ? `<span style="color:var(--bad)">${codes.length} DTC${codes.length > 1 ? 's' : ''} stored</span>` : '<span style="color:var(--ok)">no DTCs</span>';
    }
  };

  // ---------- ECU brain ----------
  UI.prototype.renderBrain = function (S) {
    const E = S.E, pill = $('#modePill');
    let mode = 'OFF', cls = '';
    if (!S.ecuOn) mode = 'ECU OFF';
    else if (S.cranking && !S.running) { mode = 'CRANKING'; cls = 'warn'; }
    else if (!S.running) mode = 'STANDBY';
    else if (S.overboostCut) { mode = 'OVERBOOST CUT'; cls = 'bad'; }
    else if (S.revCut) { mode = 'REV LIMIT'; cls = 'bad'; }
    else if (S.limp) { mode = 'LIMP HOME'; cls = 'bad'; }
    else if (S.dfco) { mode = 'DECEL FUEL CUT'; cls = 'run'; }
    else if (S.idleActive) { mode = S.ect < 60 ? 'COLD IDLE' : 'IDLE'; cls = 'run'; }
    else if (S.lambdaTarget < 0.985 && S.ltReason.includes('power')) { mode = E.turbo && S.boostP - S.baro > 20 ? 'FULL BOOST' : 'POWER (WOT)'; cls = 'warn'; }
    else { mode = S.pedal > 40 ? 'ACCELERATING' : 'PART LOAD'; cls = 'run'; }
    pill.textContent = mode;
    pill.className = 'mode-pill ' + cls;

    const step = (title, status, body, calc, col) => `<div class="bstep" style="--c:${col}"><div class="bt"><span>${title}</span><span class="st">${status || ''}</span></div>${body ? `<div class="bb">${body}</div>` : ''}${calc ? `<div class="calc">${calc}</div>` : ''}</div>`;
    const h = [];
    if (!S.ecuOn) {
      h.push(step('Standby', '', 'The ECU is unpowered. Turn the key to <b>ON</b>: it boots, runs a self-test, lights every lamp (bulb check) and primes the fuel pump.', '', 'var(--dim)'));
      $('#brain').innerHTML = h.join('');
      return;
    }
    const rpmS = S.sens.rpm || 0;
    h.push(step('1 · Where is the crank?', S.sync === 2 ? 'FULL SYNC' : S.sync === 1 ? 'CRANK ONLY' : 'NO SYNC',
      S.sync === 2 ? 'CKP gap + CMP pulse → exact position in the 720° cycle. Sequential injection & individual coils.' : S.sync === 1 ? (S.faults.cmp ? 'Cam signal missing → batch-fire and wasted spark fallback.' : 'Gap found, waiting for the cam pulse…') : rpmS > 30 ? 'Counting teeth, looking for the missing-tooth gap…' : 'No crank rotation.',
      `RPM from tooth period: <b>${rpmS.toFixed(0)} rpm</b>`, S.sync === 2 ? 'var(--ok)' : S.sync === 1 ? 'var(--warn)' : 'var(--dim)'));

    const rpmE = Math.max(rpmS, 1);
    let loadCalc;
    if (S.loadSrc === 'MAF') loadCalc = `MAF <b>${S.sens.maf.toFixed(1)} g/s</b> ÷ (${rpmS.toFixed(0)} rpm ÷ 30) = <b>${S.airCylMeas.toFixed(3)} g/cyl</b>`;
    else if (S.loadSrc.startsWith('MAP')) loadCalc = `VE × MAP <b>${S.sens.map.toFixed(0)} kPa</b> × V<sub>cyl</sub> ÷ (R·T<sub>IAT</sub>) = <b>${S.airCylMeas.toFixed(3)} g/cyl</b>`;
    else loadCalc = `from throttle angle only (${S.throttle.toFixed(0)} %) = <b>${S.airCylMeas.toFixed(3)} g/cyl</b>`;
    h.push(step('2 · How much air per cylinder?', `${S.loadSrc} · load ${S.loadPct.toFixed(0)} %`, '', loadCalc, 'var(--air)'));

    h.push(step('3 · What mixture do we want?', `λ ${S.lambdaTarget.toFixed(2)} · AFR ${(14.7 * S.lambdaTarget).toFixed(1)}:1`, S.ltReason.charAt(0).toUpperCase() + S.ltReason.slice(1) + '.', '', S.lambdaTarget < 0.985 ? 'var(--fuel)' : 'var(--ok)'));

    const trim = 1 + S.stft + S.ltft;
    if (S.fuelCutAll && S.running) {
      h.push(step('4 · Fuel', 'CUT', S.dfco ? 'Pedal released at speed: no fuel needed, the car\'s momentum turns the engine. Saves fuel, adds engine braking.' : S.revCut ? `Above ${E.redline} rpm: fuel cut to protect the engine.` : S.overboostCut ? 'Overboost: fuel cut until boost falls.' : 'Fuel cut.', '', 'var(--warn)'));
    } else if (S.pw > 0) {
      h.push(step('4 · Fuel mass', `${S.fuelMg.toFixed(1)} mg`, '', `${S.airCylMeas.toFixed(3)} g ÷ (14.7 × ${S.lambdaTarget.toFixed(2)}) = ${S.baseFuelMg.toFixed(1)} mg × trims <b>${trim.toFixed(3)}</b>${S.ae > 0.005 ? ` × accel ${(1 + S.ae).toFixed(2)}` : ''} = <b>${S.fuelMg.toFixed(1)} mg</b>`, 'var(--fuel)'));
      h.push(step('5 · Injector pulse', `${S.pw.toFixed(2)} ms · ${(S.injDuty * 100).toFixed(0)} %`, '', `${S.batch ? '½ × ' : ''}${S.fuelMg.toFixed(1)} mg ÷ ${E.injFlow} mg/ms + <b>${S.deadtime.toFixed(2)} ms</b> dead-time @ ${S.vbat.toFixed(1)} V = <b>${S.pw.toFixed(2)} ms</b> · ends ${S.eoi}° after TDC (before intake valve opens)`, 'var(--fuel)'));
    }

    if (S.sync > 0) {
      const kr = Math.max(...S.knockRetard);
      h.push(step('6 · Spark timing', `${S.spark.toFixed(1)}° BTDC`, '',
        `base ${S.sparkBase.toFixed(1)}° (MBT ${S.mbtNow.toFixed(1)}°, knock limit ${S.klNow.toFixed(1)}°)${Math.abs(S.sparkIdle) > 0.2 ? ` ${S.sparkIdle > 0 ? '+' : '−'} idle ${Math.abs(S.sparkIdle).toFixed(1)}°` : ''}${S.catHeat < -0.2 ? ` − cat heating ${(-S.catHeat).toFixed(1)}°` : ''}${kr > 0.2 ? ` − knock <b style="color:var(--bad)">${kr.toFixed(1)}°</b>` : ''} · dwell ${S.dwell.toFixed(1)} ms`, 'var(--spark)'));
    }

    h.push(step('7 · Fuel feedback', S.closedLoop ? 'CLOSED LOOP' : 'OPEN LOOP',
      S.closedLoop ? `O2 sensor switching ${S.o2Freq.toFixed(1)} Hz — reads ${S.o2v > 0.45 ? '<b style="color:var(--fuel)">RICH</b> → trimming fuel down' : '<b style="color:var(--air)">LEAN</b> → trimming fuel up'}.` : `Why open loop: ${S.olReason}.`,
      `STFT ${(S.stft * 100 >= 0 ? '+' : '')}${(S.stft * 100).toFixed(1)} % · LTFT ${(S.ltft * 100 >= 0 ? '+' : '')}${(S.ltft * 100).toFixed(1)} %`, S.closedLoop ? 'var(--ok)' : 'var(--dim)'));

    h.push(step('8 · Throttle & idle', S.idleActive ? `idle target ${S.idleTarget.toFixed(0)} rpm` : `pedal ${S.pedal.toFixed(0)} %`,
      S.idleActive ? `Driver off the pedal: ECU holds idle by moving the throttle and trimming spark (error ${(S.idleTarget - rpmS) >= 0 ? '+' : ''}${(S.idleTarget - rpmS).toFixed(0)} rpm).` : S.limp ? 'Throttle sensors disagree: motor off, spring holds limp-home position.' : 'Pedal = torque request → throttle angle.',
      `throttle cmd ${S.throttleCmd.toFixed(1)} % → actual ${S.throttle.toFixed(1)} %`, 'var(--accent)'));

    if (E.turbo) {
      const b = (S.boostP - S.baro) / 100;
      h.push(step('9 · Boost control', `${b >= 0 ? '+' : ''}${b.toFixed(2)} / ${(S.boostTargetKpa / 100).toFixed(2)} bar`,
        S.boostTargetKpa < 5 ? 'No boost requested → wastegate open, turbo idling.' : b < S.boostTargetKpa / 100 * 0.85 ? 'Turbo spooling up (lag) → wastegate held shut so all exhaust drives the turbine.' : 'On target → wastegate modulated to bleed off excess exhaust energy.',
        `WG flap ${(S.wgPos * 100).toFixed(0)} % open · turbo ${S.turbo.toFixed(0)} krpm · charge ${S.chargeT.toFixed(0)} °C (compressor out ${S.compOutT.toFixed(0)} °C)`, 'var(--hot)'));
    }
    $('#brain').innerHTML = h.join('');
  };

  // ---------- drawer ----------
  UI.prototype.openSensor = function (id) {
    const s = ECU.SENSORS.find((x) => x.id === id);
    if (!s) return;
    this.selected = { type: 's', id, def: s };
    this.hist = [];
    for (const k in this.sRows) this.sRows[k].row.classList.toggle('sel', k === id);
    this.app.diagram.select(id);
    $('#drawerBody').innerHTML = `
      <h2>${s.name}</h2><div class="tech">${s.abbr} · ${s.tech}</div>
      <div class="live"><div><span class="lbl">Reading</span><span class="mono" id="dwVal">—</span></div><div><span class="lbl">Electrical signal</span><span class="mono" id="dwSig" style="font-size:13px">—</span></div></div>
      <canvas id="dwCanvas" height="110"></canvas>
      <h4>What it measures</h4><p>${s.what}</p>
      <h4>How it works</h4><p>${s.how}</p>
      <h4>How the ECU uses it</h4><p>${s.ecu}</p>
      <h4>Typical values</h4><p>${s.typical}</p>
      <h4>When it fails</h4><p class="fail">${s.fail}</p>`;
    this.openDrawer();
  };
  UI.prototype.openActuator = function (id) {
    const a = ECU.ACTUATORS.find((x) => x.id === id);
    if (!a) return;
    this.selected = { type: 'a', id, def: a };
    this.hist = [];
    $('#drawerBody').innerHTML = `<h2>${a.name}</h2><div class="tech">ECU output</div>
      <div class="live"><div style="grid-column:span 2"><span class="lbl">Now</span><span class="mono" id="dwVal" style="font-size:14px">—</span></div></div>
      <h4>What it does</h4><p>${a.desc}</p>`;
    this.openDrawer();
  };
  UI.prototype.openDrawer = function () {
    $('#drawer').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
  };
  UI.prototype.closeDrawer = function () {
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    this.selected = null;
    for (const k in this.sRows) this.sRows[k].row.classList.remove('sel');
    this.app.diagram.select(null);
  };
  UI.prototype.updateDrawer = function (S, dt) {
    const sel = this.selected;
    if (sel.type === 'a') {
      const el = $('#dwVal');
      if (el) el.textContent = actState(S, sel.id).v;
      return;
    }
    const r = readSensor(S, sel.id);
    const v = $('#dwVal'), sg = $('#dwSig');
    if (v) v.innerHTML = `${r.value}<small style="font-size:12px;color:var(--muted);margin-left:4px">${r.unit}</small>`;
    if (sg) sg.textContent = r.sig || '—';
    this.hist.push(r.frac);
    if (this.hist.length > 300) this.hist.shift();
    const cv = $('#dwCanvas');
    if (!cv) return;
    const { ctx, w, h } = ECU.draw.fit(cv, 110);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#162130';
    for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, (h * i) / 4); ctx.lineTo(w, (h * i) / 4); ctx.stroke(); }
    ctx.strokeStyle = r.status === 'bad' ? '#ff4d5e' : '#2ee6c5';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    this.hist.forEach((f, i) => {
      const x = w - ((this.hist.length - 1 - i) / 299) * w, y = h - 8 - f * (h - 16);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = '#4d5d72';
    ctx.font = '600 9px Inter';
    ctx.fillText('last ~5 s (normalised)', 8, 12);
  };

  // ---------- controls ----------
  UI.prototype.bindControls = function () {
    const app = this.app;
    const S = () => app.S;

    document.querySelectorAll('#engineSel button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#engineSel button').forEach((x) => x.classList.toggle('active', x === b));
      app.setEngine(b.dataset.engine);
      for (const f of ECU.FAULTS) this.faultEls[f.id].classList.remove('on');
    }));
    document.querySelectorAll('#speedSel button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#speedSel button').forEach((x) => x.classList.toggle('active', x === b));
      app.speed = b.dataset.speed === 'auto' ? 'auto' : +b.dataset.speed;
    }));
    $('#pauseBtn').addEventListener('click', () => app.togglePause());
    $('#helpBtn').addEventListener('click', () => $('#helpModal').classList.add('open'));
    $('#helpModal').addEventListener('click', (e) => { if (e.target.id === 'helpModal' || e.target.hasAttribute('data-close')) $('#helpModal').classList.remove('open'); });
    $('#drawerClose').addEventListener('click', () => this.closeDrawer());

    document.querySelectorAll('.kpos').forEach((b) => b.addEventListener('click', () => { S().key = b.dataset.key; }));
    $('#quickStart').addEventListener('click', () => app.quickStart());

    const pedal = $('#pedal');
    pedal.addEventListener('input', () => { app.pedalBase = +pedal.value; if (!app.wHeld) S().pedal = app.pedalBase; });
    document.querySelectorAll('#pedalChips button').forEach((b) => b.addEventListener('click', () => { app.pedalBase = +b.dataset.p; S().pedal = app.pedalBase; }));

    document.querySelectorAll('#gearSel button').forEach((b) => b.addEventListener('click', () => { S().gear = +b.dataset.g; }));
    const brake = $('#brakeBtn');
    const bOn = (e) => { e.preventDefault(); S().brake = true; };
    const bOff = () => { S().brake = false; };
    brake.addEventListener('pointerdown', bOn);
    brake.addEventListener('pointerup', bOff);
    brake.addEventListener('pointerleave', bOff);

    const bindRange = (sel, valSel, fmt, apply) => {
      const el = $(sel);
      const upd = () => { $(valSel).textContent = fmt(+el.value); this.setRange(el, +el.value); apply(+el.value); };
      el.addEventListener('input', upd);
      upd();
    };
    bindRange('#boostTgt', '#boostTgtVal', (v) => `${v.toFixed(2)} bar`, (v) => (S().boostTarget = v));
    bindRange('#ambient', '#ambVal', (v) => `${v} °C`, (v) => {
      const s = S();
      s.ambient = v;
      if (!s.running && s.ect < v + 3 && s.ect > v - 3) { s.ect = s.oilT = s.iat = v; }
    });
    bindRange('#grade', '#gradeVal', (v) => `${v} %`, (v) => (S().grade = v));

    document.querySelectorAll('#octaneSel button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#octaneSel button').forEach((x) => x.classList.toggle('active', x === b));
      S().octane = +b.dataset.o;
      ECU.log(S(), `Tank filled with ${b.dataset.o} RON fuel.${+b.dataset.o < 95 ? ' Lower knock resistance — expect knock control to retard spark under load.' : ''}`, 'info');
    }));
    document.querySelectorAll('#ckpSel button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#ckpSel button').forEach((x) => x.classList.toggle('active', x === b));
      S().ckpType = b.dataset.t;
    }));
    const tog = (sel, key) => $(sel).addEventListener('click', (e) => { S()[key] = !S()[key]; e.currentTarget.classList.toggle('on', S()[key]); });
    tog('#acBtn', 'ac');
    tog('#lightsBtn', 'lights');
    $('#coldSoak').addEventListener('click', () => { const s = S(); s.ect = s.oilT = s.iat = s.egt = s.chargeT = s.ambient; s.o2Temp = s.ambient; ECU.log(s, `Cold soak: engine at ambient ${s.ambient} °C.`, 'info'); });
    $('#hotSoak').addEventListener('click', () => { const s = S(); s.ect = 88; s.oilT = 92; ECU.log(s, 'Engine warmed to 88 °C.', 'info'); });
    $('#clearDtc').addEventListener('click', () => ECU.clearDTC(S()));

    // keyboard
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp') { app.wHeld = true; e.preventDefault(); }
      else if (e.key === ' ') { S().brake = true; e.preventDefault(); }
      else if (/^[0-5]$/.test(e.key)) S().gear = +e.key;
      else if (k === 's') app.quickStart();
      else if (k === 'p') app.togglePause();
      else if (e.key === 'Escape') { this.closeDrawer(); $('#helpModal').classList.remove('open'); }
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp') { app.wHeld = false; S().pedal = app.pedalBase; }
      else if (e.key === ' ') S().brake = false;
    });

    // scope: hover readout, label click → drawer, drag to scrub while paused
    const sc = $('#scopeCanvas');
    const pos = (e) => { const r = sc.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    let drag = false;
    sc.addEventListener('pointermove', (e) => {
      const p = pos(e);
      app.scope.hoverX = p.x;
      if (p.x > app.scope.x0) {
        const a = app.scope.angleAt(p.x);
        $('#scopeRead').textContent = `cursor ${a.toFixed(0)}° · ${describeAngle(a)}`;
        if (drag && app.paused) app.theta = a;
      } else $('#scopeRead').textContent = app.scope.hit(p.x, p.y) ? 'click for details' : '';
    });
    sc.addEventListener('pointerleave', () => { app.scope.hoverX = null; $('#scopeRead').textContent = ''; drag = false; });
    sc.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      const hit = app.scope.hit(p.x, p.y);
      if (hit) { hit.startsWith('act:') ? this.openActuator(hit.slice(4)) : this.openSensor(hit); return; }
      if (app.paused && p.x > app.scope.x0) { drag = true; app.theta = app.scope.angleAt(p.x); }
    });
    window.addEventListener('pointerup', () => (drag = false));
  };

  function describeAngle(a) {
    const out = [];
    for (let c = 0; c < 4; c++) {
      const L = ECU.localAngle(a, c);
      if (L < 30) out.push(`cyl ${c + 1} power start`);
    }
    const t = ECU.ckpTooth(a);
    out.push(t.missing ? 'CKP gap' : `CKP tooth ${t.idx + 1}`);
    return out.join(' · ');
  }

  ECU.UI = UI;
})();
