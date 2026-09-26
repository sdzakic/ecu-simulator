/* SVG system diagram: intake → (turbo/intercooler) → throttle → manifold → engine → exhaust → cat.
   Sensors are clickable nodes with live value tags. */
(function () {
  const ECU = window.ECU;

  // id, x, y, tag offset, flags
  const NODES = [
    { id: 'amb', x: 55, y: 34, tx: 16, ty: -2 },
    { id: 'maf', x: 145, y: 90, tx: -30, ty: -30 },
    { id: 'turbo', x: 250, y: 50, tx: 16, ty: -12, turbo: 1 },
    { id: 'boost', x: 446, y: 66, tx: -20, ty: -30, turbo: 1 },
    { id: 'cat', x: 446, y: 114, tx: -24, ty: 30, turbo: 1 },
    { id: 'tps', x: 492, y: 58, tx: -10, ty: -26 },
    { id: 'iat', x: 575, y: 66, tx: -22, ty: -28 },
    { id: 'map', x: 850, y: 66, tx: -36, ty: -28 },
    { id: 'cmp', x: 610, y: 160, tx: -64, ty: 4 },
    { id: 'fuelp', x: 846, y: 140, tx: 14, ty: -10 },
    { id: 'ect', x: 852, y: 196, tx: 14, ty: 4 },
    { id: 'knock', x: 546, y: 232, tx: -78, ty: 4 },
    { id: 'oilp', x: 852, y: 262, tx: 14, ty: 4 },
    { id: 'oilt', x: 800, y: 312, tx: 14, ty: 10 },
    { id: 'ckp', x: 700, y: 312, tx: -66, ty: 14 },
    { id: 'egt', x: 540, y: 352, tx: -20, ty: 30 },
    { id: 'o2up', x: 470, y: 352, tx: -26, ty: 30 },
    { id: 'wgpos', x: 250, y: 420, tx: 16, ty: 8, turbo: 1 },
    { id: 'o2dn', x: 92, y: 352, tx: -30, ty: 30 },
    { id: 'vbat', x: 955, y: 64, tx: -20, ty: -24 },
    { id: 'acsw', x: 1045, y: 64, tx: -30, ty: -24 },
    { id: 'baro', x: 1040, y: 186, tx: -52, ty: -16 },
    { id: 'app', x: 930, y: 322, tx: -16, ty: 32 },
    { id: 'brake', x: 990, y: 322, tx: -12, ty: 32 },
    { id: 'vss', x: 1052, y: 322, tx: -20, ty: 32 },
    { id: 'fuellvl', x: 1010, y: 404, tx: -26, ty: 34 },
    // diesel
    { id: 'rail', x: 846, y: 140, tx: 14, ty: -10 },
    { id: 'lam', x: 470, y: 352, tx: -26, ty: 30 },
    { id: 'egrpos', x: 520, y: 206, tx: -74, ty: 4 },
    { id: 'vgtpos', x: 250, y: 420, tx: 16, ty: 8 },
    { id: 'egt2', x: 200, y: 318, tx: -18, ty: -18 },
    { id: 'dpfdp', x: 108, y: 316, tx: -34, ty: -18 },
    { id: 'fueltemp', x: 940, y: 372, tx: -84, ty: 4 },
  ];

  const T = (s, v) => ECU.t(s, v);
  const COL = { air: '#3fc6ff', hot: '#ff9f43', fuel: '#ffb020', exh: '#b0876a' };

  function build(type) {
    const s = [];
    s.push(`<svg class="diag" viewBox="0 0 1100 470" xmlns="http://www.w3.org/2000/svg">`);
    s.push(`<defs>
      <linearGradient id="gEng" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b2839"/><stop offset="1" stop-color="#111a26"/></linearGradient>
      <linearGradient id="gIC" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#3a2a1a"/><stop offset="1" stop-color="#132c3a"/></linearGradient>
      <filter id="fGlow"><feGaussianBlur stdDeviation="3"/></filter>
      <radialGradient id="gFire"><stop offset="0" stop-color="#fff3c0"/><stop offset=".5" stop-color="#ff9a3a"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></radialGradient>
    </defs>`);

    // ---------- pipes (base) ----------
    const pipe = (d, w, cls) => `<path class="pipe ${cls || ''}" d="${d}" stroke-width="${w}"/>`;
    const P = {
      airNA: 'M90 90 L470 90',
      airT: 'M90 90 L222 90',
      chargeHot: 'M278 90 L322 90',
      chargeCool: 'M418 90 L470 90',
      mani: 'M510 90 L540 90',
      run: [590, 660, 730, 800].map((x) => `M${x} 110 L${x} 150`).join(' '),
      exhRun: [590, 660, 730, 800].map((x) => `M${x} 300 Q${x} 330 ${Math.min(x, 600)} 350`).join(' '),
      exhNA: 'M600 350 L180 350',
      exhT1: 'M600 350 L282 350',
      exhT2: 'M218 350 L180 350',
      tail: 'M110 350 L22 350',
      wg: 'M300 350 Q300 400 250 400 Q200 400 200 350',
      fuel: 'M985 395 L985 370 L880 370 L880 136 L826 136',
      rail: 'M572 136 L826 136',
    };
    s.push(pipe(P.airNA, 20, 'na-only'));
    s.push(pipe(P.airT, 20, 'turbo-only'));
    s.push(pipe(P.chargeHot, 18, 'turbo-only'));
    s.push(pipe(P.chargeCool, 18, 'turbo-only'));
    s.push(pipe(P.mani, 20));
    s.push(pipe(P.run, 14));
    s.push(pipe(P.exhRun, 14));
    s.push(pipe(P.exhNA, 18, 'na-only'));
    s.push(pipe(P.exhT1, 18, 'turbo-only'));
    s.push(pipe(P.exhT2, 18, 'turbo-only'));
    s.push(pipe('M180 350 L110 350', 18));
    s.push(pipe(P.tail, 16));
    s.push(pipe(P.wg, 9, 'pturbo-only'));
    s.push(pipe(P.fuel, 6));
    s.push(pipe(P.rail, 8));

    // ---------- animated flows ----------
    const flow = (id, d, col, w, cls) => `<path id="${id}" class="flow ${cls || ''}" d="${d}" stroke="${col}" stroke-width="${w}"/>`;
    s.push(flow('fAirNA', P.airNA, COL.air, 5, 'na-only'));
    s.push(flow('fAirT', P.airT, COL.air, 5, 'turbo-only'));
    s.push(flow('fHot', P.chargeHot, COL.hot, 5, 'turbo-only'));
    s.push(flow('fCool', P.chargeCool, '#7fd8ff', 5, 'turbo-only'));
    s.push(flow('fMani', P.mani, COL.air, 5));
    s.push(flow('fRun', P.run, COL.air, 4));
    s.push(flow('fExhRun', P.exhRun, COL.exh, 4));
    s.push(flow('fExhNA', P.exhNA, COL.exh, 5, 'na-only'));
    s.push(flow('fExhT1', P.exhT1, COL.exh, 5, 'turbo-only'));
    s.push(flow('fExhT2', P.exhT2, COL.exh, 5, 'turbo-only'));
    s.push(flow('fExh3', 'M180 350 L110 350', COL.exh, 5));
    s.push(flow('fTail', P.tail, '#8a8f96', 5));
    s.push(flow('fWg', P.wg, COL.exh, 3, 'pturbo-only'));
    s.push(flow('fFuel', P.fuel, COL.fuel, 2.5));
    s.push(flow('fRail', P.rail, COL.fuel, 3));

    // ---------- components ----------
    // air filter
    s.push(`<g><rect class="comp" x="18" y="58" width="72" height="64" rx="10"/>
      ${Array.from({ length: 7 }, (_, i) => `<line x1="${28 + i * 9}" y1="66" x2="${28 + i * 9}" y2="114" stroke="#2a3a4e" stroke-width="2"/>`).join('')}
      <text class="lbl-s" x="54" y="140" text-anchor="middle">${T('Air filter')}</text></g>`);
    s.push(`<text class="lbl-s" x="145" y="126" text-anchor="middle">MAF</text>`);

    // turbo compressor + turbine + shaft
    const snail = (cx, cy, id, col) => `<g class="turbo-only"><circle class="comp" cx="${cx}" cy="${cy}" r="30"/><path d="M${cx + 30} ${cy} q0 -34 -30 -34" fill="none" stroke="${col}" stroke-width="2" opacity=".5"/>
      <g id="${id}" transform="translate(${cx} ${cy})">${Array.from({ length: 8 }, (_, i) => `<path d="M0 0 Q6 -9 2 -22" transform="rotate(${i * 45})" stroke="${col}" stroke-width="2.4" fill="none"/>`).join('')}<circle r="5" fill="${col}"/></g></g>`;
    s.push(snail(250, 90, 'compWheel', '#7fd8ff'));
    s.push(snail(250, 350, 'turbWheel', '#ff9a5a'));
    s.push(`<g class="turbo-only"><line x1="250" y1="122" x2="250" y2="318" stroke="#3a4a5e" stroke-width="5" stroke-dasharray="2 5"/>
      <text class="lbl-s" x="258" y="215">${T('turbo shaft')}</text>
      <text class="lbl-c" x="250" y="146" text-anchor="middle" dx="-58">${T('Compressor')}</text>
      <text class="lbl-c" x="250" y="306" text-anchor="middle" dx="-50">${T('Turbine')}</text></g>`);
    // intercooler
    s.push(`<g class="turbo-only"><rect x="322" y="58" width="96" height="64" rx="8" fill="url(#gIC)" stroke="#2a3a4e" stroke-width="1.5"/>
      ${Array.from({ length: 10 }, (_, i) => `<line x1="${330 + i * 9}" y1="62" x2="${330 + i * 9}" y2="118" stroke="#35506a" stroke-width="1.5"/>`).join('')}
      <text class="lbl-s" x="370" y="140" text-anchor="middle">${T('Intercooler')}</text></g>`);
    // BOV
    s.push(`<g class="pturbo-only"><rect class="comp" x="455" y="96" width="14" height="16" rx="3"/><circle id="bovPuff" cx="462" cy="124" r="4" fill="#cfe9ff" opacity="0"/>
      <text class="lbl-s" x="462" y="150" text-anchor="middle" font-size="9">BOV</text></g>`);
    // wastegate flap
    s.push(`<g class="pturbo-only"><circle class="comp" cx="250" cy="400" r="9"/><line id="wgFlap" x1="250" y1="400" x2="250" y2="391" stroke="#ff9a5a" stroke-width="3" stroke-linecap="round"/>
      <text class="lbl-s" x="250" y="446" text-anchor="middle">${T('Wastegate')}</text></g>`);

    // throttle body
    s.push(`<g><rect class="comp" x="470" y="70" width="40" height="40" rx="6"/><line id="thrPlate" x1="490" y1="74" x2="490" y2="106" stroke="#c7d2de" stroke-width="3" stroke-linecap="round"/>
      <text class="lbl-s" x="490" y="126" text-anchor="middle">${T('Throttle')}</text></g>`);
    // plenum
    s.push(`<g><rect class="comp" x="540" y="70" width="320" height="40" rx="14"/><text class="lbl-c" x="700" y="95" text-anchor="middle">${T('Intake manifold')}</text></g>`);
    // engine block
    s.push(`<g><rect x="560" y="150" width="280" height="150" rx="14" fill="url(#gEng)" stroke="#2a3a4e" stroke-width="1.5"/>
      <rect x="560" y="150" width="280" height="30" rx="10" fill="#1c2a3c"/>
      ${[590, 660, 730, 800].map((x, i) => `<g><rect x="${x - 24}" y="186" width="48" height="96" rx="8" fill="#0d141d" stroke="#2a3a4e"/><circle id="cylFire${i}" cx="${x}" cy="206" r="20" fill="url(#gFire)" opacity="0"/><rect id="cylPiston${i}" x="${x - 20}" y="230" width="40" height="14" rx="3" fill="#8796a8"/><text class="lbl-s" x="${x}" y="296" text-anchor="middle">${i + 1}</text>
        <path id="injSpray${i}" d="M${x - 10} 140 l-6 12 l12 0 z" fill="#ffb020" opacity=".25"/></g>`).join('')}
      <text class="lbl-c" x="700" y="170" text-anchor="middle">${T('Cylinder head · DOHC 16V')}</text></g>`);
    // catalyst
    s.push(`<g class="petrol-only"><rect class="comp" x="110" y="330" width="70" height="40" rx="14"/>
      ${Array.from({ length: 6 }, (_, i) => `<line x1="${120 + i * 10}" y1="336" x2="${120 + i * 10}" y2="364" stroke="#3a4a5e" stroke-width="1.5"/>`).join('')}
      <rect id="catGlow" x="110" y="330" width="70" height="40" rx="14" fill="#ff7a3d" opacity="0"/>
      <text class="lbl-s" x="145" y="390" text-anchor="middle">${T('Catalyst')}</text></g>`);
    s.push(`<text class="lbl-s" x="22" y="330">${T('Tailpipe')}</text>`);
    s.push(`<text class="lbl-s na-only" x="380" y="376">${T('Exhaust')}</text>`);

    // ---------- diesel: EGR loop, DOC + DPF, high-pressure pump, glow plugs, smoke ----------
    const pEgr = 'M596 336 C 548 336 520 312 520 262 L520 150 Q520 118 548 110';
    s.push(`<g class="diesel-only">
      <path class="pipe" d="${pEgr}" stroke-width="10"/>
      <path id="fEgr" class="flow" d="${pEgr}" stroke="${COL.exh}" stroke-width="3.5"/>
      <rect class="comp" x="507" y="234" width="26" height="46" rx="6"/>
      ${[0, 1, 2, 3].map((k) => `<line x1="509" y1="${243 + k * 9}" x2="531" y2="${243 + k * 9}" stroke="#2f5d7a" stroke-width="2"/>`).join('')}
      <text class="lbl-s" x="540" y="262">${T('EGR cooler')}</text>
      <text class="lbl-s" x="540" y="150">${T('EGR valve')}</text>
      <text class="lbl-c" x="250" y="320" text-anchor="middle" dx="-50">VGT</text>
      <rect class="comp" x="150" y="332" width="40" height="36" rx="10"/><text class="lbl-s" x="170" y="390" text-anchor="middle">DOC</text>
      <rect class="comp" x="70" y="330" width="74" height="40" rx="12"/>
      <rect id="dpfSoot" x="72" y="332" width="0" height="36" rx="10" fill="#1a1a1a" opacity=".85"/>
      <rect id="dpfGlow" x="70" y="330" width="74" height="40" rx="12" fill="#ff7a3d" opacity="0"/>
      ${Array.from({ length: 6 }, (_, k) => `<line x1="${80 + k * 10}" y1="336" x2="${80 + k * 10}" y2="364" stroke="#3a4a5e" stroke-width="1.5"/>`).join('')}
      <text class="lbl-s" x="107" y="390" text-anchor="middle">DPF</text>
      <circle id="smokePuff" cx="26" cy="350" r="6" fill="#222" opacity="0"/>
      <rect class="comp" x="866" y="156" width="30" height="26" rx="5"/><text class="lbl-s" x="881" y="198" text-anchor="middle">${T('HP pump')}</text>
      ${[590, 660, 730, 800].map((x, i2) => `<circle id="glowDot${i2}" cx="${x + 12}" cy="196" r="4" fill="#ff9a3d" opacity="0"/>`).join('')}
    </g>`);

    // ECU
    s.push(`<g id="ecuBox"><rect x="905" y="150" width="170" height="120" rx="14" fill="#0e1622" stroke="#2ee6c5" stroke-opacity=".45" stroke-width="1.5"/>
      <rect x="950" y="182" width="56" height="56" rx="6" fill="#152233" stroke="#2a3a4e"/>
      ${Array.from({ length: 6 }, (_, i) => `<line x1="${956 + i * 9}" y1="176" x2="${956 + i * 9}" y2="182" stroke="#3a4a5e" stroke-width="2"/><line x1="${956 + i * 9}" y1="238" x2="${956 + i * 9}" y2="244" stroke="#3a4a5e" stroke-width="2"/>`).join('')}
      <text x="978" y="215" text-anchor="middle" font-family="JetBrains Mono" font-weight="700" font-size="13" fill="#2ee6c5">ECU</text>
      <circle id="ecuLed" cx="1060" cy="164" r="4" fill="#3ee07a" opacity=".2"/>
      <text class="lbl-s" x="918" y="262">${T('32-bit · 1 kHz loop')}</text></g>`);
    // chassis
    s.push(`<g><rect class="comp" x="915" y="40" width="80" height="48" rx="8"/><text class="lbl-s" x="955" y="102" text-anchor="middle">${T('Battery')}</text>
      <text class="lbl-s" x="1045" y="102" text-anchor="middle">${T('A/C')}</text>
      <text class="lbl-s" x="930" y="300" text-anchor="middle">${T('Pedal')}</text><text class="lbl-s" x="990" y="300" text-anchor="middle">${T('Brake')}</text><text class="lbl-s" x="1052" y="300" text-anchor="middle">${T('Wheel')}</text>
      <rect class="comp" x="935" y="385" width="140" height="56" rx="10"/><rect id="fuelLvlRect" x="937" y="420" width="136" height="19" rx="8" fill="#ffb020" opacity=".25"/>
      <text class="lbl-s" x="1005" y="460" text-anchor="middle">${T('Fuel tank + pump')}</text></g>`);
    // sensor wires to ECU (subtle)
    s.push(`<path d="M905 210 C860 210 880 210 860 210" stroke="#1d2836" stroke-width="2" fill="none"/>`);

    // nodes
    const byId = Object.fromEntries(ECU.SENSORS.map((x) => [x.id, x]));
    for (const n of NODES) {
      const def = byId[n.id];
      if (def && !ECU.appliesTo(def, type)) continue; // only this engine's sensors
      const cls = '';
      s.push(`<g class="snode ${cls}" data-id="${n.id}" transform="translate(${n.x} ${n.y})">
        <g class="tag" transform="translate(${n.tx} ${n.ty})"><rect class="tag-bg" x="-4" y="-11" rx="5" height="16" width="60"/><text class="val" id="dv_${n.id}" x="0" y="1">—</text></g>
        <circle class="ring" r="9" stroke="#3ee07a"/><text class="ab" id="da_${n.id}" fill="#dbe6f3"></text></g>`);
    }
    s.push(`</svg>`);
    return s.join('');
  }

  function DiagramView(wrap, onPick) {
    this.type = (window.app && window.app.S && window.app.S.type) || 'na';
    wrap.innerHTML = build(this.type);
    this.svg = wrap.querySelector('svg');
    this.off = {};
    this.turbAng = 0;
    this.els = {};
    ['fAirNA', 'fAirT', 'fHot', 'fCool', 'fMani', 'fRun', 'fExhRun', 'fExhNA', 'fExhT1', 'fExhT2', 'fExh3', 'fTail', 'fWg', 'fFuel', 'fRail',
      'compWheel', 'turbWheel', 'bovPuff', 'wgFlap', 'thrPlate', 'catGlow', 'ecuLed', 'fuelLvlRect', 'fEgr', 'dpfSoot', 'dpfGlow', 'smokePuff'].forEach((id) => (this.els[id] = this.svg.getElementById(id)));
    this.cyl = [0, 1, 2, 3].map((i) => ({ fire: this.svg.getElementById('cylFire' + i), piston: this.svg.getElementById('cylPiston' + i), inj: this.svg.getElementById('injSpray' + i) }));
    this.nodes = {};
    const byId = Object.fromEntries(ECU.SENSORS.map((s) => [s.id, s]));
    this.svg.querySelectorAll('.snode').forEach((g) => {
      const id = g.dataset.id;
      const def = byId[id];
      g.querySelector('.ab').textContent = def ? def.abbr.replace(' ', '').slice(0, 5) : id;
      const tip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      tip.textContent = def ? ECU.info('sensors', def, 'name') : id;
      g.appendChild(tip);
      this.nodes[id] = { g, ring: g.querySelector('.ring'), val: g.querySelector('.val'), bg: g.querySelector('.tag-bg') };
      g.addEventListener('click', () => onPick(id));
    });
  }

  DiagramView.prototype.select = function (id) {
    for (const k in this.nodes) this.nodes[k].g.classList.toggle('sel', k === id);
  };

  DiagramView.prototype.animate = function (S, theta, dt) {
    const E = S.E;
    const air = S.airGs;
    const setFlow = (id, speed, vis) => {
      const el = this.els[id];
      if (!el) return;
      this.off[id] = ((this.off[id] || 0) - speed * dt) % 1000;
      el.style.strokeDashoffset = this.off[id];
      el.style.opacity = vis;
    };
    const aSpeed = 8 + air * 1.6, aVis = S.rpm > 20 ? Math.min(1, 0.35 + air / 25) : 0;
    const exhVis = S.rpm > 20 ? Math.min(1, 0.35 + air / 25) : 0;
    setFlow('fAirNA', aSpeed, aVis);
    setFlow('fAirT', aSpeed, aVis);
    setFlow('fHot', aSpeed * 1.1, aVis);
    setFlow('fCool', aSpeed * 1.1, aVis);
    setFlow('fMani', aSpeed, aVis);
    setFlow('fRun', aSpeed * 0.6, aVis);
    const eSpeed = 10 + air * 2;
    const wgFrac = E.turbo ? S.wgPos : 0;
    setFlow('fExhRun', eSpeed * 0.6, exhVis);
    setFlow('fExhNA', eSpeed, exhVis);
    setFlow('fExhT1', eSpeed, exhVis);
    setFlow('fExhT2', eSpeed, exhVis * (1 - wgFrac * 0.6));
    setFlow('fWg', eSpeed * 0.8, exhVis * wgFrac);
    setFlow('fExh3', eSpeed, exhVis);
    setFlow('fTail', eSpeed, exhVis);
    const fuelFlow = S.fuelPump ? 6 + S.fuelRateGs * 12 : 0;
    setFlow('fFuel', fuelFlow, S.fuelPump ? 0.9 : 0.1);
    setFlow('fRail', fuelFlow, S.fuelP > 0.5 ? 0.9 : 0.1);

    // hot charge colour intensity
    if (E.turbo && this.els.fHot) {
      const t = Math.min(1, Math.max(0, (S.compOutT - S.ambient) / 90));
      this.els.fHot.setAttribute('stroke', t > 0.15 ? '#ff9f43' : '#3fc6ff');
    }
    // exhaust colour by EGT
    const egtT = Math.min(1, Math.max(0, (S.egt - 250) / 650));
    const exCol = ECU.draw.mix('#8a7a6e', '#ff6a2a', egtT);
    ['fExhRun', 'fExhNA', 'fExhT1'].forEach((id) => this.els[id] && this.els[id].setAttribute('stroke', exCol));

    // turbo wheels
    this.turbAng = (this.turbAng + S.turbo * dt * 18) % 360;
    if (this.els.compWheel) this.els.compWheel.setAttribute('transform', `translate(250 90) rotate(${this.turbAng})`);
    if (this.els.turbWheel) this.els.turbWheel.setAttribute('transform', `translate(250 350) rotate(${-this.turbAng})`);
    if (this.els.wgFlap) this.els.wgFlap.setAttribute('transform', `rotate(${-S.wgPos * 80} 250 400)`);
    if (this.els.bovPuff) {
      const on = S.bovT > 0;
      const ph = (performance.now() / 300) % 1;
      this.els.bovPuff.setAttribute('r', on ? 4 + ph * 14 : 4);
      this.els.bovPuff.setAttribute('opacity', on ? 0.7 * (1 - ph) : 0);
    }
    // throttle plate (0% = vertical/closed → 100% = horizontal/open)
    const ang = (S.throttle / 100) * 80 + 4;
    this.els.thrPlate.setAttribute('transform', `rotate(${ang} 490 90)`);
    // catalyst glow (light-off)
    this.els.catGlow.setAttribute('opacity', Math.max(0, Math.min(0.35, (S.egt - 350) / 1500)));
    // ECU heartbeat
    this.els.ecuLed.setAttribute('opacity', S.ecuOn ? (Math.sin(performance.now() / 120) > 0 ? 1 : 0.3) : 0.1);
    this.els.fuelLvlRect.setAttribute('width', Math.max(8, 136 * S.fuelLevel / 100));

    // diesel extras
    if (S.E.diesel) {
      setFlow('fEgr', 8 + (S.egrGs || 0) * 2, S.egrPos > 0.03 && S.rpm > 200 ? Math.min(1, 0.3 + S.egrPos) : 0);
      this.els.dpfSoot.setAttribute('width', Math.max(0, Math.min(70, (S.soot / 45) * 70)));
      this.els.dpfGlow.setAttribute('opacity', S.regen ? 0.18 + 0.12 * Math.sin(performance.now() / 250) : Math.max(0, Math.min(0.2, (S.dpfT - 450) / 800)));
      const sm = S.smoke || 0, ph = (performance.now() / 500) % 1;
      this.els.smokePuff.setAttribute('r', 5 + ph * 16);
      this.els.smokePuff.setAttribute('opacity', S.rpm > 300 ? Math.min(0.85, sm * 0.6) * (1 - ph) : 0);
      this.els.smokePuff.setAttribute('fill', S.ignQ < 0.9 ? '#e8e8e8' : '#1c1c1c'); // white = unburnt (cold), black = soot
      for (let c = 0; c < 4; c++) { const g = this.svg.getElementById('glowDot' + c); if (g) g.setAttribute('opacity', (S.glowTemp || 0) * 0.95); }
    }

    // cylinders
    for (let c = 0; c < 4; c++) {
      const L = ECU.localAngle(theta, c);
      const burn = S.ecuOn && S.sync > 0 && S.pw > 0 && !S.fuelCutAll && !S.injCut[c] && !(S.faults.misfire3 && c === 2);
      const fireOp = burn && L < 70 ? 1 - L / 70 : 0;
      this.cyl[c].fire.setAttribute('opacity', fireOp);
      const a = ((L % 360) * Math.PI) / 180;
      const y = 238 - Math.cos(a) * 18 - 16;
      this.cyl[c].piston.setAttribute('y', y + 8);
      const inj = S.pw > 0 && !S.injCut[c] && !S.fuelCutAll && L > 300 && L < 345;
      this.cyl[c].inj.setAttribute('opacity', inj ? 1 : 0.15);
    }
  };

  DiagramView.prototype.updateValues = function (readings) {
    for (const id in this.nodes) {
      const r = readings[id];
      if (!r) continue;
      const n = this.nodes[id];
      n.val.textContent = r.short;
      const wdt = Math.max(30, r.short.length * 6.9 + 8);
      n.bg.setAttribute('width', wdt);
      const col = r.status === 'bad' ? '#ff4d5e' : r.status === 'warn' ? '#ffc043' : r.status === 'off' ? '#4d5d72' : r.status === 'live' ? '#62a8ff' : '#3ee07a';
      n.ring.setAttribute('stroke', col);
    }
  };

  ECU.DiagramView = DiagramView;
})();
