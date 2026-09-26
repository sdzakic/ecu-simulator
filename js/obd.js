/* OBD-II scan tool (SAE J1979 style). The pure part — PID table, byte encoding/decoding,
   DTC encoding, readiness — is DOM-free and tested; ScanToolUI is the panel. Values are the
   ECU's own view (sensed values), exactly what a real scan tool would read. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const ECU = (root.ECU = root.ECU || {});
  const T = (s, v) => ECU.t(s, v);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const b1 = (x) => [clamp(Math.round(x), 0, 255)];
  const b2 = (x) => { const v = clamp(Math.round(x), 0, 65535); return [v >> 8, v & 255]; };
  const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');

  // encode: engine state → data bytes;  dec: data bytes → value (the formula a scan tool applies)
  const PIDS = [
    { pid: 0x04, name: 'Calculated engine load', unit: '%', f: 'A×100/255', enc: (S) => b1(clamp(S.loadPct, 0, 100) * 2.55), dec: (A) => (A * 100) / 255 },
    { pid: 0x05, name: 'Coolant temperature', unit: '°C', f: 'A − 40', enc: (S) => b1(S.sens.ect + 40), dec: (A) => A - 40 },
    { pid: 0x06, name: 'Short-term fuel trim B1', unit: '%', f: '(A−128)×100/128', enc: (S) => b1(128 + S.stft * 128), dec: (A) => ((A - 128) * 100) / 128 },
    { pid: 0x07, name: 'Long-term fuel trim B1', unit: '%', f: '(A−128)×100/128', enc: (S) => b1(128 + S.ltft * 128), dec: (A) => ((A - 128) * 100) / 128 },
    { pid: 0x0A, only: ['na', 'turbo'], name: 'Fuel pressure (gauge)', unit: 'kPa', f: '3×A', enc: (S) => b1((S.fuelP * 100) / 3), dec: (A) => 3 * A },
    { pid: 0x0B, name: 'Intake manifold pressure', unit: 'kPa', f: 'A', enc: (S) => b1(S.sens.map), dec: (A) => A },
    { pid: 0x0C, name: 'Engine speed', unit: 'rpm', f: '((A×256)+B)/4', enc: (S) => b2(S.sens.rpm * 4), dec: (A, B) => (A * 256 + B) / 4 },
    { pid: 0x0D, name: 'Vehicle speed', unit: 'km/h', f: 'A', enc: (S) => b1(S.v * 3.6), dec: (A) => A },
    { pid: 0x0E, only: ['na', 'turbo'], name: 'Timing advance', unit: '° BTDC', f: 'A/2 − 64', enc: (S) => b1((S.spark + 64) * 2), dec: (A) => A / 2 - 64 },
    { pid: 0x0F, name: 'Intake air temperature', unit: '°C', f: 'A − 40', enc: (S) => b1(S.sens.iat + 40), dec: (A) => A - 40 },
    { pid: 0x10, name: 'MAF air flow rate', unit: 'g/s', f: '((A×256)+B)/100', enc: (S) => b2(S.sens.maf * 100), dec: (A, B) => (A * 256 + B) / 100 },
    { pid: 0x11, name: 'Throttle position', unit: '%', f: 'A×100/255', enc: (S) => b1(S.throttle * 2.55), dec: (A) => (A * 100) / 255 },
    { pid: 0x14, only: ['na', 'turbo'], name: 'O2 sensor B1S1 voltage', unit: 'V', f: 'A/200', enc: (S) => [...b1(S.o2v * 200), ...b1(128 + S.stft * 128)], dec: (A) => A / 200 },
    { pid: 0x15, only: ['na', 'turbo'], name: 'O2 sensor B1S2 voltage', unit: 'V', f: 'A/200', enc: (S) => [...b1(S.o2dn * 200), 0xff], dec: (A) => A / 200 },
    { pid: 0x1F, name: 'Run time since start', unit: 's', f: '(A×256)+B', enc: (S) => b2(S.running ? S.runT : 0), dec: (A, B) => A * 256 + B },
    { pid: 0x21, name: 'Distance with MIL on', unit: 'km', f: '(A×256)+B', enc: (S) => b2(S.distMil), dec: (A, B) => A * 256 + B },
    { pid: 0x2F, name: 'Fuel tank level', unit: '%', f: 'A×100/255', enc: (S) => b1(S.fuelLevel * 2.55), dec: (A) => (A * 100) / 255 },
    { pid: 0x33, name: 'Barometric pressure', unit: 'kPa', f: 'A', enc: (S) => b1(S.baro), dec: (A) => A },
    { pid: 0x42, name: 'Control module voltage', unit: 'V', f: '((A×256)+B)/1000', enc: (S) => b2(S.vbat * 1000), dec: (A, B) => (A * 256 + B) / 1000 },
    { pid: 0x44, only: ['na', 'turbo'], name: 'Commanded equivalence ratio (λ)', unit: '', f: '((A×256)+B)×2/65536', enc: (S) => b2(((S.running ? S.lambdaTarget : 1) * 65536) / 2), dec: (A, B) => ((A * 256 + B) * 2) / 65536 },
    { pid: 0x46, name: 'Ambient air temperature', unit: '°C', f: 'A − 40', enc: (S) => b1(S.ambient + 40), dec: (A) => A - 40 },
    { pid: 0x5C, name: 'Engine oil temperature', unit: '°C', f: 'A − 40', enc: (S) => b1(S.oilT + 40), dec: (A) => A - 40 },
    { pid: 0x23, only: ['diesel'], name: 'Fuel rail pressure (diesel)', unit: 'kPa', f: '((A×256)+B)×10', enc: (S) => b2(S.rail * 10), dec: (A, B) => (A * 256 + B) * 10 },
    { pid: 0x24, only: ['diesel'], name: 'Wideband λ B1S1', unit: '', f: '((A×256)+B)×2/65536', enc: (S) => b2((Math.min(Number.isNaN(S.lambdaWB) ? 1 : S.lambdaWB, 1.99) * 65536) / 2), dec: (A, B) => ((A * 256 + B) * 2) / 65536 },
    { pid: 0x2C, only: ['diesel'], name: 'Commanded EGR', unit: '%', f: 'A×100/255', enc: (S) => b1(S.egrCmd * 255), dec: (A) => (A * 100) / 255 },
    { pid: 0x5D, only: ['diesel'], name: 'Fuel injection timing', unit: '°', f: '((A×256)+B)/128 − 210', enc: (S) => b2((S.soi + 210) * 128), dec: (A, B) => (A * 256 + B) / 128 - 210 },
    { pid: 0x5E, name: 'Engine fuel rate', unit: 'L/h', f: '((A×256)+B)/20', enc: (S) => b2(((S.fuelRateGs * 3600) / 740) * 20), dec: (A, B) => (A * 256 + B) / 20 },
  ];
  const byPid = Object.fromEntries(PIDS.map((p) => [p.pid, p]));

  // PID 03 fuel system status (bit field): 1 OL cold · 2 CL · 4 OL load/decel · 8 OL system fault
  function fuelStatus(S) {
    if (!S.running) return 0;
    if (S.E.diesel) return 4; // compression ignition: always "open loop" in the λ = 1 sense
    if (S.closedLoop) return 2;
    if (S.o2Dead) return 8;
    if (S.ect < 35 || S.o2Temp < 350) return 1;
    return 4;
  }

  // PID 01 monitor status: A = MIL bit + DTC count; C/D = spark-engine monitors supported / incomplete
  const MONITORS = [
    { key: 'misfire', name: 'Misfire', continuous: true },
    { key: 'fuel', name: 'Fuel system' },
    { key: 'comp', name: 'Comprehensive components', continuous: true },
    { key: 'cat', name: 'Catalyst', bit: 0 },
    { key: 'o2', name: 'Oxygen sensor', bit: 5 },
    { key: 'o2heater', name: 'Oxygen sensor heater', bit: 6 },
  ];
  // compression-ignition monitors (PID 01 byte B bit 3 = 1 switches the meaning of C/D)
  const MONITORS_D = [
    { key: 'misfire', name: 'Misfire', continuous: true },
    { key: 'fuel', name: 'Fuel system' },
    { key: 'comp', name: 'Comprehensive components', continuous: true },
    { key: 'cat', name: 'NMHC catalyst (DOC)', bit: 0 },
    { key: 'boost', name: 'Boost pressure system', bit: 3 },
    { key: 'exhaust', name: 'Exhaust gas sensor', bit: 5 },
    { key: 'pm', name: 'Particulate filter', bit: 6 },
    { key: 'egr', name: 'EGR system', bit: 7 },
  ];
  const monitorsFor = (S) => (S.E.diesel ? MONITORS_D : MONITORS);
  function monitorStatus(S) {
    const dtcs = Object.values(S.dtc);
    const mil = dtcs.some((d) => d.mil) ? 0x80 : 0;
    const A = mil | Math.min(dtcs.length, 127);
    // B: bit0-2 misfire/fuel/components supported, bit4-6 incomplete; bit3 = 0 (spark ignition)
    const inc = (k) => (S.monitors[k] ? 0 : 1);
    const B = 0b0111 | (S.E.diesel ? 0b1000 : 0) | (inc('misfire') << 4) | (inc('fuel') << 5) | (inc('comp') << 6);
    let C = 0, D = 0;
    for (const m of monitorsFor(S)) if (m.bit != null) { C |= 1 << m.bit; D |= inc(m.key) << m.bit; }
    return [A, B, C, D];
  }

  // DTC "P0303" → 2 bytes: bits 15-14 system (P=00), 13-12 first digit, then 3 hex digits
  function dtcBytes(code) {
    const sys = { P: 0, C: 1, B: 2, U: 3 }[code[0]];
    const v = (sys << 14) | (parseInt(code[1], 16) << 12) | parseInt(code.slice(2), 16);
    return [v >> 8, v & 255];
  }
  function dtcFromBytes(a, b) {
    const v = (a << 8) | b;
    return 'PCBU'[v >> 14] + ((v >> 12) & 3) + ((v & 0xfff).toString(16).toUpperCase().padStart(3, '0'));
  }

  // full mode 01 exchange for one PID: { req, resp, bytes, value }
  function mode01(S, pid) {
    let data;
    if (pid === 0x01) data = monitorStatus(S);
    else if (pid === 0x03) data = [fuelStatus(S), 0];
    else data = byPid[pid].enc(S);
    if (S.E.diesel && pid === 0x03) data = [fuelStatus(S), 0];
    const p = byPid[pid];
    const value = p ? p.dec(data[0], data[1]) : null;
    return { req: `01 ${hex(pid)}`, resp: ['41', hex(pid), ...data.map(hex)].join(' '), bytes: data, value };
  }

  ECU.OBD = { PIDS, MONITORS, MONITORS_D, monitorsFor, byPid, hex, mode01, monitorStatus, fuelStatus, dtcBytes, dtcFromBytes, VIN: { na: 'SIMECU20NA0000001', turbo: 'SIMECU20TB0000001', diesel: 'SIMECU20TD0000001' } };

  // ================= browser UI =================
  const TABS = [
    { id: 'live', label: '01 · Live data' },
    { id: 'ready', label: '01 · Readiness' },
    { id: 'freeze', label: '02 · Freeze frame' },
    { id: 'codes', label: '03/04 · Codes' },
    { id: 'info', label: '09 · Vehicle info' },
  ];
  const FUEL_STATUS = { 0: 'engine off', 1: 'open loop — not warm yet', 2: 'closed loop (O2 feedback)', 4: 'open loop — load / decel', 8: 'open loop — system fault' };

  function ScanToolUI(app) {
    this.app = app;
    this.tab = 'live';
    this.sel = 0x0C;
    this.traffic = [];
    this.poll = 0;
    this.last = 0;
    this.body = document.getElementById('scanBody');
    this.term = document.getElementById('scanTerm');
    this.decodeEl = document.getElementById('scanDecode');
    this.tabsEl = document.getElementById('scanTabs');
    this.tabsEl.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { this.tab = b.dataset.tab; this.renderTabs(); this.render(this.app.S, true); } });
    this.body.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('ecu:lang', () => { this.renderTabs(); this.render(this.app.S, true); });
    this.renderTabs();
  }

  ScanToolUI.prototype.renderTabs = function () {
    this.tabsEl.innerHTML = TABS.map((t) => `<button data-tab="${t.id}" class="${t.id === this.tab ? 'active' : ''}">${T(t.label)}</button>`).join('');
  };

  ScanToolUI.prototype.log = function (req, resp, note) {
    this.traffic.push({ req, resp, note });
    if (this.traffic.length > 14) this.traffic.shift();
  };

  // what the challenge allows: 'ok' | 'paid' (medium, not yet read) | 'locked' (hard)
  ScanToolUI.prototype.codeAccess = function () {
    const ch = this.app.challenge;
    if (!ch || !ch.active() || ch.codesVisible()) return 'ok';
    return ch.c.codes === 'paid' ? 'paid' : 'locked';
  };

  ScanToolUI.prototype.onClick = function (e) {
    const row = e.target.closest('[data-pid]');
    if (row) { this.sel = +row.dataset.pid; this.render(this.app.S, true); return; }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const S = this.app.S, O = ECU.OBD;
    if (b.dataset.act === 'read') {
      const codes = Object.keys(S.dtc);
      this.log('03', ['43', O.hex(codes.length), ...codes.flatMap((c) => O.dtcBytes(c)).map(O.hex)].join(' '), T('{n} stored code(s)', { n: codes.length }));
      this.codesRead = true;
    } else if (b.dataset.act === 'clear') {
      if (!window.confirm(T('Clear all fault codes? This also resets the freeze frame and readiness monitors.'))) return;
      ECU.clearDTC(S);
      this.log('04', '44', T('codes cleared, monitors reset'));
      this.app.ui.dtcSig = null;
    } else if (b.dataset.act === 'pay') {
      this.app.challenge.c.codesRead = true;
      this.app.challenge.render();
      this.app.ui.dtcSig = null;
    }
    this.render(S, true);
  };

  // called every frame
  ScanToolUI.prototype.render = function (S, force) {
    const now = performance.now();
    if (!force && now - this.last < 120) return;
    this.last = now;
    const O = ECU.OBD;
    const alive = S.ecuOn;
    let html = '';
    if (!alive) {
      html = `<p class="scan-off">${T('No response — turn the ignition ON so the ECU can answer.')}</p>`;
    } else if (this.tab === 'live') {
      // round-robin polling like a real tool (one request per tick), all rows refreshed from state
      const list = O.PIDS.filter((q) => ECU.appliesTo(q, S.type));
      const p = list[this.poll++ % list.length];
      const ex = O.mode01(S, p.pid);
      this.log(ex.req, ex.resp);
      html = `<table class="scan-t"><thead><tr><th>PID</th><th>${T('Parameter')}</th><th>${T('Value')}</th><th>${T('Raw')}</th></tr></thead><tbody>` +
        list.map((q) => {
          const x = O.mode01(S, q.pid);
          const v = q.pid === 0x44 ? x.value.toFixed(3) : Math.abs(x.value) >= 100 || Number.isInteger(x.value) ? x.value.toFixed(0) : x.value.toFixed(q.unit === 'V' ? 3 : 1);
          return `<tr data-pid="${q.pid}" class="${q.pid === this.sel ? 'sel' : ''}"><td class="mono">${O.hex(q.pid)}</td><td>${T(q.name)}</td><td class="mono v">${v} <small>${q.unit}</small></td><td class="mono raw">${x.bytes.map(O.hex).join(' ')}</td></tr>`;
        }).join('') + '</tbody></table>';
      const sp = O.byPid[this.sel];
      if (sp) {
        const x = O.mode01(S, sp.pid);
        const [A, B] = x.bytes;
        this.decodeEl.innerHTML = `<b>${T(sp.name)}</b><div class="mono">→ ${x.req}</div><div class="mono">← ${x.resp}</div>
          <div class="mono">A = 0x${O.hex(A)} = ${A}${B != null ? ` · B = 0x${O.hex(B)} = ${B}` : ''}</div>
          <div class="mono">${sp.f} = <b>${x.value.toFixed(sp.pid === 0x44 ? 3 : 2)} ${sp.unit}</b></div>`;
      }
    } else if (this.tab === 'ready') {
      const ms = O.mode01(S, 0x01);
      if (now - (this.lastReady || 0) > 1000) { this.log(ms.req, ms.resp, T('monitor status')); this.lastReady = now; }
      const fs = O.mode01(S, 0x03);
      const access = this.codeAccess();
      const [A] = ms.bytes;
      const incomplete = O.monitorsFor(S).filter((m) => !S.monitors[m.key]).length;
      html = `<div class="scan-kv"><span>MIL</span><b class="${A & 0x80 ? 'bad' : 'ok'}">${A & 0x80 ? T('ON') : T('off')}</b>
          <span>${T('Stored codes')}</span><b>${access === 'ok' ? A & 0x7f : '🔒'}</b>
          <span>${T('Fuel system')}</span><b>${T(FUEL_STATUS[fs.bytes[0]])}</b></div>
        <table class="scan-t"><thead><tr><th>${T('Monitor')}</th><th>${T('Type')}</th><th>${T('Status')}</th></tr></thead><tbody>` +
        O.monitorsFor(S).map((m) => `<tr><td>${T(m.name)}</td><td>${m.continuous ? T('continuous') : T('once per drive')}</td><td class="${S.monitors[m.key] ? 'ok' : 'warn'}">${S.monitors[m.key] ? '✓ ' + T('complete') : '… ' + T('incomplete')}</td></tr>`).join('') +
        `</tbody></table><p class="hint">${incomplete ? T('{n} monitor(s) not yet run — an inspection station would reject the car until they complete.', { n: incomplete }) : T('All monitors complete — ready for inspection.')}</p>`;
      this.decodeEl.innerHTML = `<b>${T('Monitor status (PID 01)')}</b><div class="mono">← ${ms.resp}</div><div class="mono">A bit7 = MIL · A bits0–6 = ${T('code count')}</div>` + (S.E.diesel
        ? `<div class="mono">B bit3 = 1 → ${T('compression ignition')} · C/D: bit0 NMHC, bit3 ${T('boost')}, bit5 ${T('exhaust sensor')}, bit6 PM, bit7 EGR</div>`
        : `<div class="mono">C = ${T('supported')} · D = ${T('incomplete')} (bit0 ${T('catalyst')}, bit5 O2, bit6 ${T('O2 heater')})</div>`);
    } else if (this.tab === 'freeze') {
      const access = this.codeAccess();
      const f = S.freeze;
      if (access !== 'ok') html = this.lockedHtml(access);
      else if (!f) html = `<p class="scan-off">${T('No freeze frame stored — it is captured when the first fault code is set.')}</p>`;
      else {
        const rows = [[T('Code that triggered it'), f.code], [T('Engine speed'), `${f.rpm.toFixed(0)} rpm`], [T('Calculated engine load'), `${f.load.toFixed(0)} %`], [T('Coolant temperature'), `${f.ect.toFixed(0)} °C`], [T('Intake air temperature'), `${f.iat.toFixed(0)} °C`], [T('Intake manifold pressure'), `${f.map.toFixed(0)} kPa`], [T('MAF air flow rate'), `${f.maf.toFixed(1)} g/s`], [T('Vehicle speed'), `${f.vss.toFixed(0)} km/h`], [T('Short-term fuel trim B1'), `${(f.stft * 100).toFixed(1)} %`], [T('Long-term fuel trim B1'), `${(f.ltft * 100).toFixed(1)} %`], [T('Timing advance'), `${f.spark.toFixed(1)}°`], [T('Fuel system'), f.closedLoop ? T('closed loop (O2 feedback)') : T('open loop')]];
        html = `<table class="scan-t"><tbody>${rows.map(([k, v]) => `<tr><td>${k}</td><td class="mono v">${v}</td></tr>`).join('')}</tbody></table><p class="hint">${T('A snapshot taken the moment the first code was stored: the conditions help reproduce the fault.')}</p>`;
      }
      this.decodeEl.innerHTML = `<b>${T('Mode 02 — freeze frame')}</b><div class="mono">→ 02 02 00 · 02 0C 00 · …</div><div>${T('Same PIDs as mode 01, but the values saved when the code was set.')}</div>`;
    } else if (this.tab === 'codes') {
      const access = this.codeAccess();
      if (access !== 'ok') html = this.lockedHtml(access);
      else {
        const codes = Object.values(S.dtc);
        html = `<div class="scan-actions"><button class="btn sm" data-act="read">📥 ${T('Read codes (mode 03)')}</button><button class="btn ghost sm" data-act="clear">🧹 ${T('Clear codes (mode 04)')}</button></div>` +
          (this.codesRead ? (codes.length ? codes.map((d) => { const [a, b] = O.dtcBytes(d.code); return `<div class="dtc"><b>${d.code}</b><span>${T(d.text)}</span><span class="mono raw">${O.hex(a)} ${O.hex(b)}</span></div>`; }).join('') : `<p class="scan-off">${T('No fault codes stored.')}</p>`) : `<p class="hint">${T('Press “Read codes” to request stored DTCs.')}</p>`);
      }
      this.decodeEl.innerHTML = `<b>${T('How a code is encoded')}</b><div>${T('Two bytes per code: 2 bits system (P/C/B/U), 2 bits first digit, then three hex digits.')}</div><div class="mono">P0303 → 03 03 · P0420 → 04 20 · P0171 → 01 71</div>`;
    } else {
      const vin = O.VIN[S.type];
      if (now - (this.lastVin || 0) > 1500) { this.log('09 02', '49 02 01 ' + vin.split('').map((c) => O.hex(c.charCodeAt(0))).join(' ').slice(0, 29) + '…', 'VIN'); this.lastVin = now; }
      html = `<div class="scan-kv"><span>VIN</span><b class="mono">${vin}</b><span>${T('Calibration ID')}</span><b class="mono">ECUSIM-${S.type === 'turbo' ? '20T' : S.type === 'diesel' ? '20D' : '20N'}-${ECU.CAL_AXES.rpm.length}${Object.keys(S.cal).length}</b>
        <span>${T('ECU name')}</span><b>ECM-EngineControl</b><span>${T('Protocol')}</span><b class="mono">ISO 15765-4 CAN 11/500</b><span>${T('OBD standard')}</span><b>EOBD</b></div>`;
      this.decodeEl.innerHTML = `<b>${T('Mode 09 — vehicle information')}</b><div>${T('The VIN comes back as ASCII bytes spread over several CAN frames.')}</div>`;
    }
    if (html !== this.lastHtml) { this.body.innerHTML = html; this.lastHtml = html; }
    this.term.innerHTML = this.traffic.map((t) => `<div><span class="rq">→ ${t.req}</span> <span class="rs">← ${t.resp}</span>${t.note ? ` <span class="nt">${t.note}</span>` : ''}</div>`).join('');
    this.term.scrollTop = this.term.scrollHeight;
  };

  ScanToolUI.prototype.lockedHtml = function (access) {
    if (access === 'paid') return `<p class="scan-off">🔒 ${T('Reading codes costs 20 points in this challenge.')}</p><button class="btn sm" data-act="pay">${T('Read codes (−{p})', { p: ECU.CHALLENGE.PTS.codes })}</button>`;
    return `<p class="scan-off">🔒 ${T('Fault codes are hidden in this challenge — diagnose from live data.')}</p>`;
  };

  ECU.ScanToolUI = ScanToolUI;
})();
