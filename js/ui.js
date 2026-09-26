/* DOM panels: sensors, lamps, actuators, ECU brain, log, drawer, controls. */
(function () {
  const ECU = window.ECU;
  const $ = (s) => document.querySelector(s);
  const clamp = ECU.util.clamp;
  const T = (s, v) => ECU.t(s, v);

  // ---------- electrical signal helpers ----------
  function ntcVolts(temp) {
    const R = 2500 * Math.exp(3450 * (1 / (temp + 273.15) - 1 / 293.15));
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
        r.sig = F.ckp ? (ECU.hideTruth ? '0 Hz' : T('open circuit')) : S.ckpType === 'vr' ? `±${f1(Math.max(0.2, S.rpm / 450))} V · ${f0(hz)} Hz` : `0/5 V · ${f0(hz)} Hz`;
        r.status = F.ckp ? 'bad' : run ? 'live' : on ? 'ok' : 'off';
        r.frac = rpm / 8000;
        break;
      }
      case 'cmp': {
        r.value = F.cmp ? T('NO SIG') : S.sync === 2 ? 'SYNC' : run ? T('waiting') : '—';
        r.short = F.cmp ? T('NO SIG') : `${f1(S.vvt || 0)}° VVT`;
        r.sig = F.cmp ? T('no pulses') : `0/5 V · ${f1(S.rpm / 120)} Hz`;
        r.status = F.cmp ? 'bad' : S.sync === 2 ? 'live' : on ? 'ok' : 'off';
        r.frac = (S.vvt || 0) / 35;
        break;
      }
      case 'maf': {
        const v = F.maf ? 0 : S.mafTrue;
        r.value = f1(v); r.unit = 'g/s'; r.short = `${f1(v)} g/s`;
        r.sig = F.maf ? (ECU.hideTruth ? '0.00 V' : T('0.00 V (fault)')) : `${f2(0.95 + 3.9 * Math.sqrt(v / 260))} V`;
        r.status = F.maf ? 'bad' : on ? 'ok' : 'off';
        r.frac = v / (S.E.turbo ? 230 : 130);
        break;
      }
      case 'map': {
        const v = F.map ? 0 : S.map;
        const range = S.E.turbo ? 300 : 105;
        r.value = f0(v); r.unit = 'kPa'; r.short = `${f0(v)} kPa`;
        r.sig = F.map ? (ECU.hideTruth ? '0.00 V' : T('0.00 V (fault)')) : `${f2(0.5 + (4 * v) / range)} V`;
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
        const rl = v > 0.45 ? T('RICH') : T('lean');
        r.value = f2(v); r.unit = 'V'; r.short = `${f2(v)} V`;
        r.sig = F.o2 && !ECU.hideTruth ? T('stuck lean') : S.o2Temp < 320 ? T('cold ({t} °C)', { t: f0(S.o2Temp) }) : S.closedLoop ? `${rl} · ${f1(S.o2Freq)} Hz` : rl;
        r.status = F.o2 || S.o2Dead ? 'bad' : !on ? 'off' : S.o2Temp < 320 ? 'warn' : 'ok';
        r.frac = v;
        break;
      }
      case 'o2dn': {
        const v = S.o2dn;
        r.value = f2(v); r.unit = 'V'; r.short = `${f2(v)} V`;
        r.sig = F.cat && !ECU.hideTruth ? T('mirrors upstream!') : S.o2Temp < 320 ? T('cold') : T('cat O₂ store {p} %', { p: f0(S.catOsc * 100) });
        r.status = S.dtc.P0420 ? 'bad' : !on ? 'off' : S.o2Temp < 320 ? 'warn' : 'ok';
        r.frac = v;
        break;
      }
      case 'knock': {
        const kn = Math.max(...S.knockTrue);
        const mv = F.knocksensor ? 0 : (run ? 40 + S.rpm * 0.05 : 5) + kn * 1400;
        r.value = f0(mv); r.unit = 'mV'; r.short = `${f0(mv)} mV`;
        r.sig = F.knocksensor ? (ECU.hideTruth ? '0 mV' : T('open circuit')) : kn > 0.1 ? T('KNOCK detected!') : T('{n} events total', { n: S.knockCount });
        r.status = F.knocksensor ? 'bad' : S.t - S.lastKnockT < 1 ? 'warn' : on ? 'ok' : 'off';
        r.frac = mv / 1800;
        break;
      }
      case 'egt':
        r.value = f0(S.egt); r.unit = '°C'; r.short = `${f0(S.egt)} °C`; r.sig = T('{v} mV (type K)', { v: f1((S.egt * 41) / 1000) });
        r.status = !on ? 'off' : S.egt > (S.E.turbo ? 950 : 920) ? 'warn' : 'ok'; r.frac = S.egt / 1050;
        break;
      case 'ect': {
        const t = F.ect ? -40 : S.ect;
        r.value = f0(t); r.unit = '°C'; r.short = `${f0(t)} °C`;
        r.sig = F.ect ? (ECU.hideTruth ? '4.98 V' : T('4.98 V (open)')) : `${f2(ntcVolts(S.ect))} V`;
        r.status = F.ect ? 'bad' : !on ? 'off' : S.ect > 110 ? 'bad' : S.ect < 40 ? 'warn' : 'ok';
        r.frac = (t + 40) / 170;
        break;
      }
      case 'iat': {
        const t = F.iat ? -40 : S.iat;
        r.value = f0(t); r.unit = '°C'; r.short = `${f0(t)} °C`;
        r.sig = F.iat ? (ECU.hideTruth ? '4.98 V' : T('4.98 V (open)')) : `${f2(ntcVolts(S.iat))} V`;
        r.status = F.iat ? 'bad' : on ? 'ok' : 'off';
        r.frac = (t + 40) / 140;
        break;
      }
      case 'oilp':
        r.value = f1(S.oilP); r.unit = 'bar'; r.short = `${f1(S.oilP)} bar`; r.sig = S.oilP < 0.45 ? T('switch CLOSED (low)') : `${f2(0.5 + S.oilP * 0.4)} V`;
        r.status = !on ? 'off' : S.oilP < 0.45 ? (run ? 'bad' : 'warn') : 'ok'; r.frac = S.oilP / 6;
        break;
      case 'oilt':
        r.value = f0(S.oilT); r.unit = '°C'; r.short = `${f0(S.oilT)} °C`; r.sig = `${f2(ntcVolts(S.oilT))} V`; r.frac = (S.oilT + 20) / 160;
        break;
      case 'fuelp': {
        const dp = S.fuelP - (S.map - S.baro) / 100;
        r.value = f2(S.fuelP); r.unit = 'bar'; r.short = `${f1(S.fuelP)} bar`; r.sig = T('Δp across inj. {v} bar', { v: f2(dp) });
        r.status = !on ? 'off' : dp < S.E.fuelBase * 0.8 && run ? 'bad' : S.fuelP < 1 ? 'warn' : 'ok'; r.frac = S.fuelP / 6;
        break;
      }
      case 'vbat':
        r.value = f1(S.vbat); r.unit = 'V'; r.short = `${f1(S.vbat)} V`; r.sig = S.rpm > 550 && !F.alt ? T('charging') : S.cranking ? T('cranking load') : T('battery only');
        r.status = !on ? 'off' : S.vbat < 11.8 ? 'bad' : S.vbat < 12.4 ? 'warn' : 'ok'; r.frac = (S.vbat - 9) / 6;
        break;
      case 'fuellvl':
        r.value = f0(S.fuelLevel); r.unit = '%'; r.short = `${f0(S.fuelLevel)} %`; r.sig = `${f0(10 + (1 - S.fuelLevel / 100) * 170)} Ω`;
        r.status = !on ? 'off' : S.fuelLevel < 10 ? 'warn' : 'ok'; r.frac = S.fuelLevel / 100;
        break;
      case 'boost': {
        const b = (S.boostP - S.baro) / 100;
        r.value = (b >= 0 ? '+' : '') + f2(b); r.unit = 'bar'; r.short = `${b >= 0 ? '+' : ''}${f2(b)} bar`;
        r.sig = T('{p} kPa abs · {v} V', { p: f0(S.boostP), v: f2(0.5 + (4 * S.boostP) / 300) });
        r.status = !on ? 'off' : S.overboostCut ? 'bad' : 'ok'; r.frac = S.boostP / 280;
        break;
      }
      case 'cat':
        r.value = f0(S.chargeT); r.unit = '°C'; r.short = `${f0(S.chargeT)} °C`; r.sig = T('comp. out {t} °C', { t: f0(S.compOutT) }); r.frac = (S.chargeT + 20) / 140;
        break;
      case 'turbo':
        r.value = f0(S.turbo); r.unit = 'krpm'; r.short = `${f0(S.turbo)} krpm`; r.sig = T('{v} kHz blade pass', { v: f0((S.turbo * 1000 * 12) / 60 / 1000) }); r.frac = S.turbo / 230;
        r.status = !on ? 'off' : S.turbo > 60 ? 'live' : 'ok';
        break;
      case 'wgpos':
        r.value = f0(S.wgPos * 100); r.unit = T('% open'); r.short = `${f0(S.wgPos * 100)} %`; r.sig = T('cmd duty {v} %', { v: f0((1 - S.wgCmd) * 100) });
        r.status = F.wgstuck ? 'bad' : on ? 'ok' : 'off'; r.frac = S.wgPos;
        break;
      case 'vss':
        r.value = f0(S.v * 3.6); r.unit = 'km/h'; r.short = `${f0(S.v * 3.6)} km/h`; r.sig = `${f0(S.v * 3.6 * 1.9)} Hz`; r.frac = (S.v * 3.6) / 250;
        break;
      case 'brake':
        r.value = S.brake ? T('ON') : T('off'); r.short = r.value; r.sig = S.brake ? '12 V / 0 V' : '0 V / 12 V'; r.status = !on ? 'off' : S.brake ? 'live' : 'ok'; r.frac = S.brake ? 1 : 0;
        break;
      case 'acsw':
        r.value = S.ac ? T('ON') : T('off'); r.short = r.value; r.sig = S.ac ? T('{v} bar refrig.', { v: f1(14 + S.rpm / 800) }) : T('idle'); r.status = !on ? 'off' : S.ac ? 'live' : 'ok'; r.frac = S.ac ? 1 : 0;
        break;
      case 'amb':
        r.value = f0(S.ambient); r.unit = '°C'; r.short = `${f0(S.ambient)} °C`; r.sig = `${f2(ntcVolts(S.ambient))} V`; r.frac = (S.ambient + 30) / 80;
        break;
    }
    r.frac = clamp(r.frac || 0, 0, 1);
    if (ECU.hideTruth && r.status === 'bad') r.status = 'ok'; // a scan tool shows values, not "this one is broken"
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
    this.buildAll();
    this.bindControls();
    window.addEventListener('ecu:lang', () => this.relabel());
  }

  UI.prototype.buildAll = function () {
    this.buildSensors();
    this.buildFaults();
    this.buildLamps();
    this.buildActuators();
    this.buildLegend();
    document.querySelectorAll('#langSel button').forEach((b) => b.classList.toggle('active', b.dataset.lang === ECU.lang));
  };

  // language switched: rebuild everything that holds translated text
  UI.prototype.relabel = function () {
    this.buildAll();
    this.setControlsCollapsed(document.body.classList.contains('controls-collapsed'), true);
    $('#logList').innerHTML = '';
    this.lastLogId = 0;
    this.dtcSig = null; // force the DTC list/counter to re-render (empty list included)
    const sel = this.selected;
    if (sel) sel.type === 's' ? this.openSensor(sel.id) : this.openActuator(sel.id);
    this.app.relabel();
  };

  UI.prototype.buildLegend = function () {
    $('#strokeLegend').innerHTML = ECU.STROKES.map((s) => `<span><i style="background:${s.color}"></i>${T(s.name)}</span>`).join('') +
      `<span><i style="background:var(--fuel)"></i>${T('Injection')}</span><span><i style="background:var(--spark)"></i>${T('Spark')}</span>`;
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
      box.innerHTML = `<h4>${T(g.name)}</h4>`;
      for (const s of sens) {
        const row = document.createElement('div');
        row.className = 'srow' + (s.turboOnly ? ' turbo-only' : '') + (this.selected && this.selected.id === s.id ? ' sel' : '');
        row.dataset.sid = s.id;
        row.innerHTML = `<span class="led"></span><div><div class="sn"><span class="ab">${s.abbr}</span>${ECU.info('sensors', s, 'name')}</div><div class="sbar"><i></i></div></div><div><div class="sv">—</div><div class="ssig"></div></div>`;
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
      b.className = 'fault' + (f.turboOnly ? ' turbo-only' : '') + (this.app.S.faults[f.id] ? ' on' : '');
      b.innerHTML = `<span class="sw"></span><span><div class="fn">${ECU.info('faults', f, 'name')}</div><div class="fh">${ECU.info('faults', f, 'hint')}</div></span><span class="fc">${f.dtc}</span>`;
      b.addEventListener('click', () => {
        if (this.faultsLocked) return;
        const S = this.app.S;
        S.faults[f.id] = !S.faults[f.id];
        b.classList.toggle('on', !!S.faults[f.id]);
        ECU.log(S, S.faults[f.id] ? 'FAULT INJECTED: {name}.' : 'Fault repaired: {name}.', S.faults[f.id] ? 'fault' : 'ok', { name: { k: f.name } });
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
      el.title = T(l.tip);
      el.innerHTML = (l.icon || '') + `<span>${T(l.label)}</span>`;
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
      el.innerHTML = `<div class="an"><span>${ECU.info('actuators', a, 'name')}</span><span class="dot"></span></div><div class="av">—</div><div class="abar"><i></i></div>`;
      el.addEventListener('click', () => this.openActuator(a.id));
      box.appendChild(el);
      this.actEls[a.id] = { el, v: el.querySelector('.av'), bar: el.querySelector('.abar i') };
    }
  };

  function actState(S, id) {
    const on = S.ecuOn;
    switch (id) {
      case 'inj': return { on: S.pw > 0, v: S.pw > 0 ? T('{pw} ms · {d} % duty · {mg} mg', { pw: S.pw.toFixed(2), d: (S.injDuty * 100).toFixed(0), mg: S.fuelMg.toFixed(1) }) + (S.batch ? ' · ' + T('BATCH') : '') : S.fuelCutAll && S.running ? T('fuel CUT') : T('off'), f: S.injDuty, c: '#ffb020' };
      case 'coil': return { on: on && S.sync > 0, v: on && S.sync > 0 ? T('{a}° BTDC · dwell {d} ms', { a: S.spark.toFixed(1), d: S.dwell.toFixed(1) }) + (S.batch ? ' · ' + T('WASTED') : '') : T('off'), f: (S.spark + 10) / 55, c: '#ffe45c' };
      case 'etc': return { on, v: T('cmd {c} % → {a} %', { c: S.throttleCmd.toFixed(1), a: S.throttle.toFixed(1) }) + (S.limp ? ' · ' + T('LIMP') : ''), f: S.throttle / 100, c: '#2ee6c5' };
      case 'pump': return { on: S.fuelPump, v: S.fuelPump ? (S.primeT > 0 && S.rpm < 50 ? T('ON · priming') : T('ON')) : T('off'), f: S.fuelPump ? 1 : 0, c: '#3ee07a' };
      case 'fan': return { on: S.fan, v: S.fan ? T('ON') : T('off'), f: S.fan ? 1 : 0, c: '#2ee6c5' };
      case 'vvt': return { on: S.vvt > 0.5, v: T('{a}° intake advance', { a: S.vvt.toFixed(1) }), f: S.vvt / 35, c: '#b98cff' };
      case 'wg': return { on: S.boostTargetKpa > 5, v: T('duty {d} % · flap {o} % open', { d: ((1 - S.wgCmd) * 100).toFixed(0), o: (S.wgPos * 100).toFixed(0) }), f: 1 - S.wgCmd, c: '#ff9f43' };
      case 'bov': return { on: S.bovT > 0, v: S.bovT > 0 ? T('VENTING') : T('closed'), f: S.bovT > 0 ? 1 : 0, c: '#cfe9ff' };
      case 'o2h': return { on: on && S.rpm > 300, v: T('{s} · element {t} °C', { s: on && S.rpm > 300 ? T('ON') : T('off'), t: S.o2Temp.toFixed(0) }), f: S.o2Temp / 750, c: '#ff6b8a' };
      case 'alt': return { on: S.rpm > 550 && !S.faults.alt, v: S.faults.alt && !ECU.hideTruth ? T('FAILED') : S.faults.alt ? T('not charging') : S.rpm > 550 ? T('{v} V · {w} W load', { v: S.vbat.toFixed(1), w: S.elecW.toFixed(0) }) : T('not charging'), f: S.elecW / 1000, c: '#62a8ff' };
      case 'acc': return { on: S.ac && S.running, v: S.ac && S.running ? T('engaged') : S.ac ? T('waiting for engine') : T('off'), f: S.ac && S.running ? 1 : 0, c: '#62a8ff' };
      case 'mil': {
        const m = on && (Object.values(S.dtc).some((d) => d.mil) || S.rpm < 300);
        return { on: m, v: S.misfireActive && !S.injCut[2] ? T('FLASHING') : m ? T('ON') : T('off'), f: m ? 1 : 0, c: '#ffb020' };
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
    $('#sensorCount').textContent = T('{a}/{n} live', { a: active, n: total });
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
    $('#keyHint').textContent = !S.ecuOn ? (S.key === 'ACC' ? T('ACC — accessories only, ECU off.') : T('Key OFF — ECU asleep.')) : S.cranking ? T('Cranking… starter engaged.') : S.running ? T('Engine running.') : S.primeT > 0 ? T('Bulb check + fuel pump prime…') : T('ECU on — ready to crank.');
    $('#speedVal').textContent = `${(S.v * 3.6).toFixed(0)} km/h`;
    document.querySelectorAll('#gearSel button').forEach((b) => b.classList.toggle('active', +b.dataset.g === S.gear));
    $('#brakeBtn').classList.toggle('active', S.brake);
    this.setRange($('#pedal'), S.pedal);
    $('#pedalVal').textContent = `${S.pedal.toFixed(0)} %`;
    $('#tpPedal').textContent = `${S.pedal.toFixed(0)} %`;
    $('#tpGear').textContent = S.gear === 0 ? 'N' : String(S.gear);
    $('#tpStart').hidden = S.running || S.cranking;

    // sync pill
    const sp = $('#syncPill');
    sp.className = 'sync-pill s' + S.sync;
    sp.textContent = S.sync === 2 ? T('FULL SYNC · sequential') : S.sync === 1 ? T('CRANK SYNC · batch/wasted') : S.rpm > 30 && S.ecuOn ? T('SEARCHING FOR GAP…') : T('NO SYNC');

    // log
    this.renderLog(S);

    // drawer live
    if (this.selected) this.updateDrawer(S, dt);
    return readings;
  };

  // during a diagnostic challenge the fault switches would give the answer away
  UI.prototype.lockFaults = function (on) {
    this.faultsLocked = on;
    $('.ctl.faults').classList.toggle('locked', on);
    $('.ctl.faults').dataset.lockMsg = T('🔒 Hidden during the diagnostic challenge');
  };

  // reflect programmatic state changes (lessons, engine swap) in the controls
  UI.prototype.syncControls = function () {
    const S = this.app.S;
    document.querySelectorAll('#octaneSel button').forEach((b) => b.classList.toggle('active', +b.dataset.o === S.octane));
    document.querySelectorAll('#ckpSel button').forEach((b) => b.classList.toggle('active', b.dataset.t === S.ckpType));
    $('#acBtn').classList.toggle('on', !!S.ac);
    $('#lightsBtn').classList.toggle('on', !!S.lights);
    for (const f of ECU.FAULTS) this.faultEls[f.id].classList.toggle('on', !this.faultsLocked && !!S.faults[f.id]);
    const pairs = [['#grade', '#gradeVal', S.grade, (v) => `${v} %`], ['#ambient', '#ambVal', S.ambient, (v) => `${v} °C`], ['#boostTgt', '#boostTgtVal', S.boostTarget, (v) => `${(+v).toFixed(2)} bar`]];
    for (const [sel, valSel, v, fmt] of pairs) { const el = $(sel); el.value = v; $(valSel).textContent = fmt(v); this.setRange(el, v); }
  };

  UI.prototype.setRange = function (el, v) {
    if (document.activeElement !== el && +el.value !== Math.round(v)) el.value = Math.round(v);
    const min = +el.min, max = +el.max;
    el.style.setProperty('--fill', `${((el.value - min) / (max - min)) * 100}%`);
  };

  UI.prototype.renderLog = function (S) {
    const list = $('#logList');
    const fresh = S.log.filter((l) => l.id > this.lastLogId).slice(-80);
    if (fresh.length) {
      for (const l of fresh) {
        const el = document.createElement('div');
        el.className = 'lg ' + l.kind;
        el.innerHTML = `<span class="lt">${l.t.toFixed(1)}s</span><span>${this.logText(l)}</span>`;
        list.prepend(el);
      }
      this.lastLogId = fresh[fresh.length - 1].id;
      while (list.children.length > 80) list.lastChild.remove();
    }
    const codes = Object.values(S.dtc);
    const hidden = this.codesHidden();
    const sig = codes.map((d) => d.code).join(',') + (hidden ? '|h' : '');
    if (sig !== this.dtcSig) {
      this.dtcSig = sig;
      if (hidden) {
        $('#dtcList').innerHTML = codes.length ? `<div class="dtc masked"><b>🔒</b><span>${T('{n} fault code(s) stored — hidden in this challenge', { n: codes.length })}</span></div>` : '';
        $('#dtcCount').innerHTML = `<span style="color:var(--muted)">${T('codes hidden')}</span>`;
        return;
      }
      $('#dtcList').innerHTML = codes.map((d) => `<div class="dtc"><b>${d.code}</b><span>${T(d.text)}</span></div>`).join('');
      $('#dtcCount').innerHTML = codes.length ? `<span style="color:var(--bad)">${T('{n} DTC(s) stored', { n: codes.length })}</span>` : `<span style="color:var(--ok)">${T('no DTCs')}</span>`;
    }
  };

  UI.prototype.codesHidden = function () { return !!(this.app.challenge && !this.app.challenge.codesVisible()); };
  // log entries that would reveal a challenge's answer are masked
  const TRUTH_KEYS = new Set(["Cylinder {c} is knocking — but the knock sensor is dead, the ECU can't hear it!"]);
  UI.prototype.logText = function (l) {
    if (ECU.hideTruth && TRUTH_KEYS.has(l.msg)) return T('Something sounds wrong under load…');
    if (this.codesHidden() && l.msg.startsWith('DTC {code} stored')) return T('A fault code was stored (read it with a scan tool).');
    return T(l.msg, l.vars);
  };

  // ---------- ECU brain ----------
  UI.prototype.renderBrain = function (S) {
    const E = S.E, pill = $('#modePill');
    let mode, cls = '';
    if (!S.ecuOn) mode = 'ECU OFF';
    else if (S.cranking && !S.running) { mode = 'CRANKING'; cls = 'warn'; }
    else if (!S.running) mode = 'STANDBY';
    else if (S.overboostCut) { mode = 'OVERBOOST CUT'; cls = 'bad'; }
    else if (S.revCut) { mode = 'REV LIMIT'; cls = 'bad'; }
    else if (S.limp) { mode = 'LIMP HOME'; cls = 'bad'; }
    else if (S.dfco) { mode = 'DECEL FUEL CUT'; cls = 'run'; }
    else if (S.idleActive) { mode = S.ect < 60 ? 'COLD IDLE' : 'IDLE'; cls = 'run'; }
    else if (S.lambdaTarget < 0.985 && S.ltPower) { mode = E.turbo && S.boostP - S.baro > 20 ? 'FULL BOOST' : 'POWER (WOT)'; cls = 'warn'; }
    else { mode = S.pedal > 40 ? 'ACCELERATING' : 'PART LOAD'; cls = 'run'; }
    pill.textContent = T(mode);
    pill.className = 'mode-pill ' + cls;

    const step = (title, status, body, calc, col) => `<div class="bstep" style="--c:${col}"><div class="bt"><span>${T(title)}</span><span class="st">${status || ''}</span></div>${body ? `<div class="bb">${body}</div>` : ''}${calc ? `<div class="calc">${calc}</div>` : ''}</div>`;
    const h = [];
    if (!S.ecuOn) {
      h.push(step('Standby', '', T('The ECU is unpowered. Turn the key to <b>ON</b>: it boots, runs a self-test, lights every lamp (bulb check) and primes the fuel pump.'), '', 'var(--dim)'));
      $('#brain').innerHTML = h.join('');
      return;
    }
    const rpmS = S.sens.rpm || 0;
    h.push(step('1 · Where is the crank?', S.sync === 2 ? T('FULL SYNC') : S.sync === 1 ? T('CRANK ONLY') : T('NO SYNC'),
      S.sync === 2 ? T('CKP gap + CMP pulse → exact position in the 720° cycle. Sequential injection & individual coils.') : S.sync === 1 ? (S.faults.cmp ? T('Cam signal missing → batch-fire and wasted spark fallback.') : T('Gap found, waiting for the cam pulse…')) : rpmS > 30 ? T('Counting teeth, looking for the missing-tooth gap…') : T('No crank rotation.'),
      T('RPM from tooth period: <b>{r} rpm</b>', { r: rpmS.toFixed(0) }), S.sync === 2 ? 'var(--ok)' : S.sync === 1 ? 'var(--warn)' : 'var(--dim)'));

    let loadCalc;
    const ac = S.airCylMeas.toFixed(3);
    if (S.loadSrc === 'MAF') loadCalc = T('MAF <b>{m} g/s</b> ÷ ({r} rpm ÷ 30) = <b>{a} g/cyl</b>', { m: S.sens.maf.toFixed(1), r: rpmS.toFixed(0), a: ac });
    else if (S.loadSrc.startsWith('MAP')) loadCalc = T('VE × MAP <b>{p} kPa</b> × V<sub>cyl</sub> ÷ (R·T<sub>IAT</sub>) = <b>{a} g/cyl</b>', { p: S.sens.map.toFixed(0), a: ac });
    else loadCalc = T('from throttle angle only ({t} %) = <b>{a} g/cyl</b>', { t: S.throttle.toFixed(0), a: ac });
    h.push(step('2 · How much air per cylinder?', `${T(S.loadSrc)} · ${T('load')} ${S.loadPct.toFixed(0)} %`, '', loadCalc, 'var(--air)'));

    const why = ECU.tr(S.ltReason);
    h.push(step('3 · What mixture do we want?', `λ ${S.lambdaTarget.toFixed(2)} · AFR ${(14.7 * S.lambdaTarget).toFixed(1)}:1`, why.charAt(0).toUpperCase() + why.slice(1) + '.', '', S.lambdaTarget < 0.985 ? 'var(--fuel)' : 'var(--ok)'));

    const trim = 1 + S.stft + S.ltft;
    if (S.fuelCutAll && S.running) {
      h.push(step('4 · Fuel', T('CUT'), S.dfco ? T("Pedal released at speed: no fuel needed, the car's momentum turns the engine. Saves fuel, adds engine braking.") : S.revCut ? T('Above {r} rpm: fuel cut to protect the engine.', { r: E.redline }) : S.overboostCut ? T('Overboost: fuel cut until boost falls.') : T('Fuel cut.'), '', 'var(--warn)'));
    } else if (S.pw > 0) {
      h.push(step('4 · Fuel mass', `${S.fuelMg.toFixed(1)} mg`, '', `${ac} g ÷ (14.7 × ${S.lambdaTarget.toFixed(2)}) = ${S.baseFuelMg.toFixed(1)} mg × ${T('trims')} <b>${trim.toFixed(3)}</b>${S.ae > 0.005 ? ` × ${T('accel')} ${(1 + S.ae).toFixed(2)}` : ''} = <b>${S.fuelMg.toFixed(1)} mg</b>`, 'var(--fuel)'));
      h.push(step('5 · Injector pulse', `${S.pw.toFixed(2)} ms · ${(S.injDuty * 100).toFixed(0)} %`, '', T('{half}{mg} mg ÷ {flow} mg/ms + <b>{dt} ms</b> dead-time @ {v} V = <b>{pw} ms</b> · ends {eoi}° after TDC (before intake valve opens)', { half: S.batch ? '½ × ' : '', mg: S.fuelMg.toFixed(1), flow: E.injFlow, dt: S.deadtime.toFixed(2), v: S.vbat.toFixed(1), pw: S.pw.toFixed(2), eoi: S.eoi }), 'var(--fuel)'));
    }

    if (S.sync > 0) {
      const kr = Math.max(...S.knockRetard);
      const parts = [S.idleActive
        ? T('idle base {b}° (MBT − 6°)', { b: S.sparkBase.toFixed(1) })
        : T('map {m}° {c} (MBT {b}°, knock limit {k}°)', { m: (S.sparkMap || 0).toFixed(1), c: `${S.sparkCorr >= 0 ? '+' : '−'} ${Math.abs(S.sparkCorr || 0).toFixed(1)}° ${T('IAT/ECT')}`, b: S.mbtNow.toFixed(1), k: S.klNow.toFixed(1) })];
      if (Math.abs(S.sparkIdle) > 0.2) parts.push(`${S.sparkIdle > 0 ? '+' : '−'} ${T('idle')} ${Math.abs(S.sparkIdle).toFixed(1)}°`);
      if (S.catHeat < -0.2) parts.push(`− ${T('cat heating')} ${(-S.catHeat).toFixed(1)}°`);
      if (kr > 0.2) parts.push(`− ${T('knock')} <b style="color:var(--bad)">${kr.toFixed(1)}°</b>`);
      h.push(step('6 · Spark timing', T('{a}° BTDC', { a: S.spark.toFixed(1) }), '', `${parts.join(' ')} · dwell ${S.dwell.toFixed(1)} ms`, 'var(--spark)'));
    }

    h.push(step('7 · Fuel feedback', S.closedLoop ? T('CLOSED LOOP') : T('OPEN LOOP'),
      S.closedLoop ? T('O2 sensor switching {f} Hz — reads {state}.', { f: S.o2Freq.toFixed(1), state: S.o2v > 0.45 ? T('<b style="color:var(--fuel)">RICH</b> → trimming fuel down') : T('<b style="color:var(--air)">LEAN</b> → trimming fuel up') }) : T('Why open loop: {r}.', { r: S.olReason }),
      `STFT ${(S.stft * 100 >= 0 ? '+' : '')}${(S.stft * 100).toFixed(1)} % · LTFT ${(S.ltft * 100 >= 0 ? '+' : '')}${(S.ltft * 100).toFixed(1)} %`, S.closedLoop ? 'var(--ok)' : 'var(--dim)'));

    const err = S.idleTarget - rpmS;
    h.push(step('8 · Throttle & idle', S.idleActive ? T('idle target {r} rpm', { r: S.idleTarget.toFixed(0) }) : T('pedal {p} %', { p: S.pedal.toFixed(0) }),
      S.idleActive ? T('Driver off the pedal: ECU holds idle by moving the throttle and trimming spark (error {e} rpm).', { e: (err >= 0 ? '+' : '') + err.toFixed(0) }) : S.limp ? T('Throttle sensors disagree: motor off, spring holds limp-home position.') : T('Pedal = torque request → throttle angle.'),
      T('throttle cmd {c} % → actual {a} %', { c: S.throttleCmd.toFixed(1), a: S.throttle.toFixed(1) }), 'var(--accent)'));

    if (E.turbo) {
      const b = (S.boostP - S.baro) / 100;
      h.push(step('9 · Boost control', `${b >= 0 ? '+' : ''}${b.toFixed(2)} / ${(S.boostTargetKpa / 100).toFixed(2)} bar`,
        S.boostTargetKpa < 5 ? T('No boost requested → wastegate open, turbo idling.') : b < (S.boostTargetKpa / 100) * 0.85 ? T('Turbo spooling up (lag) → wastegate held shut so all exhaust drives the turbine.') : T('On target → wastegate modulated to bleed off excess exhaust energy.'),
        T('WG flap {w} % open · turbo {n} krpm · charge {c} °C (compressor out {o} °C)', { w: (S.wgPos * 100).toFixed(0), n: S.turbo.toFixed(0), c: S.chargeT.toFixed(0), o: S.compOutT.toFixed(0) }), 'var(--hot)'));
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
    const I = (f) => ECU.info('sensors', s, f);
    $('#drawerBody').innerHTML = `
      <h2>${I('name')}</h2><div class="tech">${s.abbr} · ${I('tech')}</div>
      <div class="live"><div><span class="lbl">${T('Reading')}</span><span class="mono" id="dwVal">—</span></div><div><span class="lbl">${T('Electrical signal')}</span><span class="mono" id="dwSig" style="font-size:13px">—</span></div></div>
      <canvas id="dwCanvas" height="110"></canvas>
      <h4>${T('What it measures')}</h4><p>${I('what')}</p>
      <h4>${T('How it works')}</h4><p>${I('how')}</p>
      <h4>${T('How the ECU uses it')}</h4><p>${I('ecu')}</p>
      <h4>${T('Typical values')}</h4><p>${I('typical')}</p>
      <h4>${T('When it fails')}</h4><p class="fail">${I('fail')}</p>`;
    this.openDrawer();
  };
  UI.prototype.openActuator = function (id) {
    const a = ECU.ACTUATORS.find((x) => x.id === id);
    if (!a) return;
    this.selected = { type: 'a', id, def: a };
    this.hist = [];
    $('#drawerBody').innerHTML = `<h2>${ECU.info('actuators', a, 'name')}</h2><div class="tech">${T('ECU output')}</div>
      <div class="live"><div style="grid-column:span 2"><span class="lbl">${T('Now')}</span><span class="mono" id="dwVal" style="font-size:14px">—</span></div></div>
      <h4>${T('What it does')}</h4><p>${ECU.info('actuators', a, 'desc')}</p>`;
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
  UI.prototype.updateDrawer = function (S) {
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
    ctx.fillText(T('last ~5 s (normalised)'), 8, 12);
  };

  // ---------- controls ----------
  UI.prototype.bindControls = function () {
    const app = this.app;
    const S = () => app.S;

    document.querySelectorAll('#langSel button').forEach((b) => b.addEventListener('click', () => { if (b.dataset.lang !== ECU.lang) ECU.setLang(b.dataset.lang); }));
    document.querySelectorAll('#engineSel button').forEach((b) => b.addEventListener('click', () => {
      if (app.challenge && app.challenge.active()) {
        if (!window.confirm(T('Switching engines abandons the diagnostic challenge. Continue?'))) return;
        app.challenge.close();
      }
      document.querySelectorAll('#engineSel button').forEach((x) => x.classList.toggle('active', x === b));
      app.setEngine(b.dataset.engine);
      for (const f of ECU.FAULTS) this.faultEls[f.id].classList.remove('on');
    }));
    document.querySelectorAll('#speedSel button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#speedSel button').forEach((x) => x.classList.toggle('active', x === b));
      app.speed = b.dataset.speed === 'auto' ? 'auto' : +b.dataset.speed;
    }));
    $('#pauseBtn').addEventListener('click', () => app.togglePause());
    $('#panelToggle').addEventListener('click', () => this.toggleControls());
    $('#panelCollapse').addEventListener('click', () => (this.isPhone() ? this.setDrawer(false) : this.setControlsCollapsed(true)));
    $('#drawerBackdrop').addEventListener('click', () => this.setDrawer(false));
    this.bindTouchPad();
    let collapsed = false;
    try { collapsed = localStorage.getItem('ecu-controls-collapsed') === '1'; } catch (e) { /* storage unavailable */ }
    this.setControlsCollapsed(collapsed, true);
    if (this.isPhone()) this.setDrawer(false);
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
      ECU.log(S(), +b.dataset.o < 95 ? 'Tank filled with {o} RON fuel. Lower knock resistance — expect knock control to retard spark under load.' : 'Tank filled with {o} RON fuel.', 'info', { o: b.dataset.o });
    }));
    document.querySelectorAll('#ckpSel button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#ckpSel button').forEach((x) => x.classList.toggle('active', x === b));
      S().ckpType = b.dataset.t;
    }));
    const tog = (sel, key) => $(sel).addEventListener('click', (e) => { S()[key] = !S()[key]; e.currentTarget.classList.toggle('on', S()[key]); });
    tog('#acBtn', 'ac');
    tog('#lightsBtn', 'lights');
    $('#coldSoak').addEventListener('click', () => { const s = S(); s.ect = s.oilT = s.iat = s.egt = s.chargeT = s.ambient; s.o2Temp = s.ambient; ECU.log(s, 'Cold soak: engine at ambient {t} °C.', 'info', { t: s.ambient }); });
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
      else if (k === 'c') this.toggleControls();
      else if (e.key === 'Escape') { this.closeDrawer(); this.setDrawer(false); $('#helpModal').classList.remove('open'); }
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
        $('#scopeRead').textContent = T('cursor {a}° · {d}', { a: a.toFixed(0), d: describeAngle(a) });
        if (drag && app.paused) app.theta = a;
      } else $('#scopeRead').textContent = app.scope.hit(p.x, p.y) ? T('click for details') : '';
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

  // phones: the controls are an off-canvas drawer; desktop: a collapsible column
  UI.prototype.isPhone = function () { return window.matchMedia('(max-width: 860px)').matches; };
  UI.prototype.toggleControls = function () {
    if (this.isPhone()) this.setDrawer(!document.body.classList.contains('drawer-open'));
    else this.setControlsCollapsed(!document.body.classList.contains('controls-collapsed'));
  };
  UI.prototype.showControls = function () {
    if (this.isPhone()) this.setDrawer(true);
    else if (document.body.classList.contains('controls-collapsed')) this.setControlsCollapsed(false);
  };
  UI.prototype.setDrawer = function (open) {
    document.body.classList.toggle('drawer-open', open);
    if (this.isPhone()) {
      $('#panelToggle').setAttribute('aria-expanded', String(open));
      $('#panelToggle').classList.toggle('active', open);
    }
  };

  // floating gas / brake / gear / start pad for touch screens
  UI.prototype.bindTouchPad = function () {
    const app = this.app;
    const hold = (el, on, off) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.classList.add('active');
        on();
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* capture is best-effort; the press still works */ }
      });
      const end = () => { if (!el.classList.contains('active')) return; el.classList.remove('active'); off(); };
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => el.addEventListener(ev, end));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    hold($('#tpGas'), () => (app.wHeld = true), () => { app.wHeld = false; app.S.pedal = app.pedalBase; });
    hold($('#tpBrake'), () => (app.S.brake = true), () => (app.S.brake = false));
    $('#tpStart').addEventListener('click', () => app.quickStart());
    document.querySelectorAll('[data-gstep]').forEach((b) => b.addEventListener('click', () => {
      app.S.gear = Math.max(0, Math.min(5, app.S.gear + +b.dataset.gstep));
    }));
  };

  // left control panel show/hide (remembered per browser)
  UI.prototype.setControlsCollapsed = function (collapsed, initial) {
    document.body.classList.toggle('controls-collapsed', collapsed);
    const btn = $('#panelToggle');
    btn.classList.toggle('active', !collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.title = T(collapsed ? 'Show controls (C)' : 'Hide controls (C)');
    $('#controls').setAttribute('aria-hidden', String(collapsed));
    if (!initial) { try { localStorage.setItem('ecu-controls-collapsed', collapsed ? '1' : '0'); } catch (e) { /* ignore */ } }
  };

  function describeAngle(a) {
    const out = [];
    for (let c = 0; c < 4; c++) {
      if (ECU.localAngle(a, c) < 30) out.push(T('cyl {c} power start', { c: c + 1 }));
    }
    const tooth = ECU.ckpTooth(a);
    out.push(tooth.missing ? T('CKP gap') : T('CKP tooth {n}', { n: tooth.idx + 1 }));
    return out.join(' · ');
  }

  ECU.UI = UI;
})();
