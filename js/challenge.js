/* Diagnostic challenge: a random fault is injected secretly and the player diagnoses it from the
   symptoms, like a mechanic. Pure logic (cases, options, scoring) is DOM-free and tested headlessly;
   the ChallengeUI part only runs in the browser. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const ECU = (root.ECU = root.ECU || {});
  const T = (s, v) => ECU.t(s, v);
  const L = (o) => (o ? o[ECU.lang] || o.en : '');

  // complaint = what the customer says; hints[0] = where to look; hints[1] = the key clue (also the explanation)
  const CASES = {
    ckp: {
      complaint: { en: 'It just died on the road. Now it cranks and cranks but won’t start.', hr: 'Ugasio se u vožnji. Sada anlaser vrti, ali motor ne pali.' },
      hints: [{ en: 'Crank it and watch the trigger wheels and the sync status.', hr: 'Pokrenite ga i pratite davačke kotače i status sinkronizacije.' },
        { en: 'The crank sensor signal is flat. Without CKP the ECU never finds the gap, never syncs — so there is no fuel and no spark.', hr: 'Signal senzora radilice je ravan. Bez CKP-a ECU nikad ne pronađe prazninu i ne sinkronizira se — pa nema ni goriva ni iskre.' }],
    },
    cmp: {
      complaint: { en: 'The check-engine light is on. It runs, but fuel economy seems a bit worse.', hr: 'Svijetli lampica motora. Radi, ali čini se da troši malo više.' },
      hints: [{ en: 'Look at the timing scope: how often does each injector and coil fire per cycle?', hr: 'Pogledajte vremenski dijagram: koliko puta po ciklusu rade brizgaljke i bobine?' },
        { en: 'Injectors fire twice per cycle in pairs and every coil sparks twice (wasted spark): the batch fallback used when the cam signal is missing.', hr: 'Brizgaljke rade dvaput po ciklusu u parovima, a svaka bobina pali dvaput (izgubljena iskra): rezervni način kad nema signala bregastog.' }],
    },
    misfire3: {
      complaint: { en: 'It shakes badly at idle and the check-engine light is flashing.', hr: 'Jako trese u praznom hodu, a lampica motora treperi.' },
      hints: [{ en: 'Watch the crank-speed row at the bottom of the timing scope.', hr: 'Pratite red brzine radilice na dnu vremenskog dijagrama.' },
        { en: 'One segment of the crank always slows down — cylinder 3 is not firing. The ECU even cut injector 3 to protect the catalyst.', hr: 'Jedan segment radilice stalno usporava — cilindar 3 ne pali. ECU je čak isključio brizgaljku 3 da zaštiti katalizator.' }],
    },
    maf: {
      complaint: { en: 'Check-engine light on, but it drives almost normally.', hr: 'Lampica motora svijetli, ali se vozi gotovo normalno.' },
      hints: [{ en: 'Look at the air-flow reading and step 2 of “What the ECU is thinking”.', hr: 'Pogledajte očitanje protoka zraka i korak 2 u „Što ECU trenutno računa”.' },
        { en: 'The MAF reads 0 g/s even at idle. The ECU fell back to speed-density: air is calculated from MAP, rpm and temperature.', hr: 'MAF pokazuje 0 g/s čak i u praznom hodu. ECU je prešao na speed-density: zrak se računa iz MAP-a, okretaja i temperature.' }],
    },
    map: {
      complaint: { en: 'Check-engine light on; no noticeable drivability problem.', hr: 'Lampica motora svijetli; nema primjetnog problema u vožnji.' },
      hints: [{ en: 'Compare the manifold pressure reading with what the engine is doing.', hr: 'Usporedite očitanje tlaka u usisnoj grani s onim što motor radi.' },
        { en: 'MAP reads 0 kPa (0.00 V) even at idle — physically impossible. The sensor circuit is dead; the ECU keeps using the MAF.', hr: 'MAP pokazuje 0 kPa (0.00 V) čak i u praznom hodu — fizički nemoguće. Krug senzora je u kvaru; ECU i dalje koristi MAF.' }],
    },
    tps: {
      complaint: { en: 'It won’t rev — the pedal barely does anything, and the EPC light is on.', hr: 'Ne diže okretaje — papučica gotovo ništa ne radi, a svijetli lampica EPC.' },
      hints: [{ en: 'Compare the pedal position with the throttle position and both throttle track voltages.', hr: 'Usporedite položaj papučice s položajem leptira i naponima oba kanala.' },
        { en: 'The two throttle tracks disagree, so the ECU disabled the throttle motor. The spring holds ~7 % opening: limp-home mode.', hr: 'Dva kanala leptira se ne slažu, pa je ECU isključio motor leptira. Opruga ga drži na ~7 %: nužni način rada.' }],
    },
    ect: {
      complaint: { en: 'The radiator fan runs all the time, even on a cold engine.', hr: 'Ventilator hladnjaka stalno radi, čak i kad je motor hladan.' },
      hints: [{ en: 'Look at the coolant temperature reading and its signal voltage.', hr: 'Pogledajte temperaturu rashladne tekućine i napon njenog signala.' },
        { en: 'ECT reads −40 °C at 4.98 V: an open circuit. The ECU substitutes 80 °C and forces the fan on as a failsafe.', hr: 'ECT pokazuje −40 °C na 4.98 V: prekid kruga. ECU koristi zamjenskih 80 °C i sigurnosno stalno pali ventilator.' }],
    },
    iat: {
      complaint: { en: 'Check-engine light on; the car drives fine.', hr: 'Lampica motora svijetli; auto se vozi normalno.' },
      hints: [{ en: 'Check all the temperature readings for anything impossible.', hr: 'Provjerite sva očitanja temperature — ima li nešto nemoguće?' },
        { en: 'Intake air reads −40 °C at 4.98 V while it’s 20 °C outside — an open circuit. The ECU substitutes 25 °C.', hr: 'Usisni zrak pokazuje −40 °C na 4.98 V, a vani je 20 °C — prekid kruga. ECU koristi zamjenskih 25 °C.' }],
    },
    o2: {
      complaint: { en: 'Fuel economy got worse and the check-engine light is on.', hr: 'Potrošnja je porasla i svijetli lampica motora.' },
      hints: [{ en: 'Watch the Oxygen sensors chart and the fuel trims.', hr: 'Pratite graf lambda sondi i korekcije goriva.' },
        { en: 'The upstream O2 is stuck at ~0.06 V and never switches. The trims run up to +25 %, then the ECU gives up and fuels open loop.', hr: 'Prednja lambda je zaglavljena na ~0.06 V i nikad ne prebacuje. Korekcije idu do +25 %, a zatim ECU odustaje i radi u otvorenoj petlji.' }],
    },
    cat: {
      complaint: { en: 'It failed the emissions test. The engine feels completely fine.', hr: 'Pao je na ispitivanju ispušnih plinova. Motor se čini potpuno ispravnim.' },
      hints: [{ en: 'Compare the upstream and downstream O2 sensors in the Oxygen sensors chart.', hr: 'Usporedite prednju i stražnju lambda sondu na grafu lambda sondi.' },
        { en: 'The downstream sensor copies the upstream switching. A healthy catalyst would smooth it to a steady ~0.6 V — this one no longer stores oxygen.', hr: 'Stražnja sonda kopira prebacivanje prednje. Ispravan katalizator bi ga izgladio na stalnih ~0.6 V — ovaj više ne sprema kisik.' }],
    },
    knocksensor: {
      complaint: { en: 'Check-engine light on and it feels a bit down on power.', hr: 'Svijetli lampica motora i čini se da ima malo manje snage.' },
      hints: [{ en: 'Look at spark timing (step 6) and the knock row of the timing scope.', hr: 'Pogledajte trenutak paljenja (korak 6) i red detonacije na dijagramu.' },
        { en: 'The knock sensor signal is completely flat. Unable to hear knock, the ECU applies a safe, retarded spark map (−5°), which costs power.', hr: 'Signal senzora detonacije je potpuno ravan. Kako ne čuje detonaciju, ECU primjenjuje sigurnu, kasniju mapu paljenja (−5°), što smanjuje snagu.' }],
    },
    vacleak: {
      complaint: { en: 'It idles a little high and the check-engine light came on.', hr: 'U praznom hodu radi malo više, a upalila se lampica motora.' },
      hints: [{ en: 'Look at the fuel trims at idle, then at higher load.', hr: 'Pogledajte korekcije goriva u praznom hodu, a zatim pod većim opterećenjem.' },
        { en: 'Large positive trims at idle: air is entering that the MAF never measured. They shrink at higher load, where the leak is a smaller share — a vacuum leak.', hr: 'Velike pozitivne korekcije u praznom hodu: ulazi zrak koji MAF nikad nije izmjerio. Pod većim opterećenjem se smanjuju jer je curenje manji udio — curenje podtlaka.' }],
    },
    fuelpump: {
      complaint: { en: 'It hesitates and loses power at full throttle; fine when cruising.', hr: 'Zastaje i gubi snagu pri punom gasu; u krstarenju je dobro.' },
      hints: [{ en: 'Do a full-throttle pull (the dyno helps) and watch fuel pressure and λ.', hr: 'Napravite ubrzanje punim gasom (dinamometar pomaže) i pratite tlak goriva i λ.' },
        { en: 'Rail pressure sags under load and the mixture goes lean at wide-open throttle: the pump can’t deliver enough fuel.', hr: 'Tlak u rampi pada pod opterećenjem i smjesa postaje siromašna pri punom gasu: pumpa ne može dobaviti dovoljno goriva.' }],
    },
    alt: {
      complaint: { en: 'The battery light is on, and after a while things start acting strangely.', hr: 'Svijetli lampica akumulatora, a nakon nekog vremena stvari se počnu čudno ponašati.' },
      hints: [{ en: 'Check the system voltage with the engine running.', hr: 'Provjerite napon sustava dok motor radi.' },
        { en: 'Voltage keeps falling below 12.5 V with the engine running — the alternator isn’t charging. Injector dead-time grows as voltage drops.', hr: 'Napon stalno pada ispod 12.5 V dok motor radi — alternator ne puni. Mrtvo vrijeme brizgaljki raste kako napon pada.' }],
    },
    oil: {
      complaint: { en: 'The oil warning light flickers at idle.', hr: 'Lampica ulja treperi u praznom hodu.' },
      hints: [{ en: 'Compare the oil pressure at idle with the pressure at 3000 rpm.', hr: 'Usporedite tlak ulja u praznom hodu s tlakom na 3000 o/min.' },
        { en: 'Oil pressure is only ~0.4 bar at idle. There’s no fault code — just the lamp. Check the oil level before the engine is damaged!', hr: 'Tlak ulja je samo ~0.4 bar u praznom hodu. Nema koda greške — samo lampica. Provjerite razinu ulja prije nego se motor ošteti!' }],
    },
    thermostat: {
      complaint: { en: 'The temperature gauge stays low and the heater is only lukewarm.', hr: 'Pokazivač temperature ostaje nisko, a grijanje je tek mlako.' },
      hints: [{ en: 'Watch the coolant temperature for a few minutes.', hr: 'Pratite temperaturu rashladne tekućine nekoliko minuta.' },
        { en: 'The engine never reaches ~88 °C, even idling: coolant flows through the radiator all the time. The thermostat is stuck open.', hr: 'Motor nikad ne dosegne ~88 °C, čak ni u praznom hodu: tekućina stalno prolazi kroz hladnjak. Termostat je zaglavljen otvoren.' }],
    },
    wgstuck: {
      complaint: { en: 'At full throttle it pulls very hard — then suddenly cuts out.', hr: 'Pri punom gasu jako vuče — a onda se naglo prekine.' },
      hints: [{ en: 'Do a full-throttle pull and watch boost and the wastegate position.', hr: 'Napravite ubrzanje punim gasom i pratite tlak punjenja i položaj wastegatea.' },
        { en: 'Boost overshoots the target while the wastegate stays at 0 % open, so overboost protection cuts the fuel. The wastegate is stuck closed.', hr: 'Tlak punjenja prelazi cilj dok wastegate ostaje 0 % otvoren, pa zaštita od previsokog tlaka prekida gorivo. Wastegate je zaglavljen zatvoren.' }],
      turbo: true,
    },
    boostleak: {
      complaint: { en: 'It feels sluggish — nowhere near the power it used to have.', hr: 'Djeluje tromo — nema ni blizu snage koju je imao.' },
      hints: [{ en: 'Compare actual boost with the target at full throttle (a dyno pull helps).', hr: 'Usporedite stvarni tlak punjenja s ciljem pri punom gasu (dinamometar pomaže).' },
        { en: 'Boost never gets past ~0.5 bar even with the wastegate shut, and air the MAF measured escapes, so it runs rich. A split boost hose.', hr: 'Tlak nikad ne prelazi ~0.5 bar čak ni sa zatvorenim wastegateom, a izmjereni zrak bježi, pa radi bogato. Pukla cijev tlaka punjenja.' }],
      turbo: true,
    },
  };

  const DIFFS = {
    easy: { options: 4, codes: 'visible', title: { en: 'Easy', hr: 'Lako' }, desc: { en: '4 possible answers. Fault codes are visible — read them like a scan tool would.', hr: '4 moguća odgovora. Kodovi grešaka su vidljivi — čitajte ih kao dijagnostički uređaj.' } },
    medium: { options: 6, codes: 'paid', title: { en: 'Medium', hr: 'Srednje' }, desc: { en: '6 possible answers. Reading the fault codes costs 20 points.', hr: '6 mogućih odgovora. Čitanje kodova grešaka košta 20 bodova.' } },
    hard: { options: 99, codes: 'hidden', title: { en: 'Hard', hr: 'Teško' }, desc: { en: 'Every fault is a possible answer and the codes are hidden. Symptoms only.', hr: 'Svaki kvar je mogući odgovor, a kodovi su skriveni. Samo simptomi.' } },
  };
  const PTS = { base: 100, hint: 15, codes: 20, wrong: 25, graceSec: 60, perSec: 0.1, maxTime: 30, guesses: 3 };

  const applicable = (type) => ECU.FAULTS.filter((f) => CASES[f.id] && (!CASES[f.id].turbo || type === 'turbo')).map((f) => f.id);

  // correct answer + random distractors, shuffled; rng is injectable for tests
  function makeOptions(faultId, type, diff, rng = Math.random) {
    const pool = applicable(type).filter((id) => id !== faultId);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const opts = [faultId, ...pool.slice(0, Math.max(0, DIFFS[diff].options - 1))];
    for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
    return opts;
  }

  function score({ seconds = 0, hints = 0, codesRead = false, wrong = 0, solved = true }) {
    if (!solved) return 0;
    const timePen = Math.min(PTS.maxTime, Math.max(0, seconds - PTS.graceSec) * PTS.perSec);
    return Math.max(0, Math.round(PTS.base - timePen - hints * PTS.hint - (codesRead ? PTS.codes : 0) - wrong * PTS.wrong));
  }

  ECU.CHALLENGE = { CASES, DIFFS, PTS, applicable, makeOptions, score };

  // ================= browser UI =================
  function ChallengeUI(app) {
    this.app = app;
    this.c = null; // current challenge
    this.stats = {};
    try { this.stats = JSON.parse(localStorage.getItem('ecu-challenge-stats') || '{}'); } catch (e) { /* ignore */ }
    this.card = document.getElementById('challengeCard');
    this.modal = document.getElementById('challengeModal');
    document.getElementById('challengeBtn').addEventListener('click', () => this.openPicker());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal || e.target.hasAttribute('data-close')) this.modal.classList.remove('open');
      const b = e.target.closest('[data-diff]');
      if (b) { this.modal.classList.remove('open'); this.start(b.dataset.diff); }
    });
    this.card.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('ecu:lang', () => { this.render(); if (this.modal.classList.contains('open')) this.openPicker(); });
  }

  ChallengeUI.prototype.active = function () { return !!(this.c && !this.c.done); };
  ChallengeUI.prototype.codesVisible = function () { return !this.active() || this.c.codes === 'visible' || this.c.codesRead; };

  ChallengeUI.prototype.openPicker = function () {
    const type = this.app.S.type;
    const cards = Object.keys(DIFFS).map((k) => {
      const st = this.stats[k] || {};
      const rec = st.played ? T('solved {s}/{p} · best {b}', { s: st.solved || 0, p: st.played, b: st.best || 0 }) : T('not played yet');
      return `<button class="lesson-card" data-diff="${k}"><span class="ln">${k === 'easy' ? '★' : k === 'medium' ? '★★' : '★★★'}</span>
        <span class="lt"><b>${L(DIFFS[k].title)}</b><small>${L(DIFFS[k].desc)}</small></span><span class="lm">${rec}</span></button>`;
    }).join('');
    this.modal.querySelector('h2').textContent = T('Diagnostic challenge');
    this.modal.querySelector('.hint').textContent = T('A random fault is hidden in the {e}. Read the customer’s complaint, investigate with everything on screen, then name the fault. {n} possible faults on this engine.', { e: T(type === 'turbo' ? 'turbo engine' : 'NA engine'), n: applicable(type).length });
    this.modal.querySelector('.lesson-list').innerHTML = cards;
    this.modal.classList.add('open');
  };

  ChallengeUI.prototype.start = function (diff) {
    const app = this.app;
    if (app.lessons && app.lessons.lesson) app.lessons.stop();
    if (app.S.dyno) ECU.abortDyno(app.S, 'a challenge started');
    const type = app.S.type;
    const ids = applicable(type);
    const fault = ids[Math.floor(Math.random() * ids.length)];
    app.stockMode = true;
    app.selectEngine(type);
    const S = app.S;
    S.ect = 88; S.oilT = 90; S.octane = 95;
    S.faults[fault] = true; // secretly — nothing is logged
    app.pedalBase = 0;
    this.c = { diff, fault, codes: DIFFS[diff].codes, codesRead: false, hints: 0, wrong: [], t0: performance.now(), done: false, picking: false, options: makeOptions(fault, type, diff) };
    ECU.hideTruth = true;
    app.ui.lockFaults(true); // lock first so syncControls never marks the secret fault's switch
    app.ui.syncControls();
    app.ui.dtcSig = null;
    document.body.classList.add('lesson-open');
    app.quickStart();
    this.card.classList.add('open');
    this.card.classList.remove('min');
    this.render();
  };

  ChallengeUI.prototype.seconds = function () { return this.c ? ((this.c.doneAt || performance.now()) - this.c.t0) / 1000 : 0; };
  ChallengeUI.prototype.currentScore = function () {
    const c = this.c;
    return score({ seconds: this.seconds(), hints: c.hints, codesRead: c.codesRead, wrong: c.wrong.length });
  };

  ChallengeUI.prototype.finish = function (solved) {
    const c = this.c;
    c.done = true; c.solved = solved; c.doneAt = performance.now();
    c.final = solved ? this.currentScore() : 0;
    const st = this.stats[c.diff] || (this.stats[c.diff] = { played: 0, solved: 0, best: 0 });
    st.played++;
    if (solved) { st.solved++; st.best = Math.max(st.best || 0, c.final); }
    try { localStorage.setItem('ecu-challenge-stats', JSON.stringify(this.stats)); } catch (e) { /* ignore */ }
    ECU.hideTruth = false; // reveal everything now
    this.app.ui.dtcSig = null;
    this.render();
  };

  // repair the car and hand the controls back
  ChallengeUI.prototype.close = function () {
    const app = this.app;
    if (this.c) { app.S.faults[this.c.fault] = false; ECU.clearDTC(app.S); }
    this.c = null;
    ECU.hideTruth = false;
    app.ui.lockFaults(false);
    app.ui.syncControls();
    app.ui.dtcSig = null;
    document.body.classList.remove('lesson-open');
    if (app.stockMode) app.useStockCal(false);
    this.card.classList.remove('open');
  };

  ChallengeUI.prototype.onClick = function (e) {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const c = this.c, a = b.dataset.act;
    if (a === 'min') { this.card.classList.toggle('min'); return; }
    if (!c) return;
    if (a === 'hint') { if (c.hints < 2) c.hints++; }
    else if (a === 'codes') { c.codesRead = true; this.app.ui.dtcSig = null; }
    else if (a === 'diagnose') c.picking = !c.picking;
    else if (a === 'pick') {
      const id = b.dataset.fault;
      if (id === c.fault) this.finish(true);
      else { c.wrong.push(id); if (c.wrong.length >= PTS.guesses) this.finish(false); }
    }
    else if (a === 'giveup') { if (window.confirm(T('Give up and reveal the fault?'))) this.finish(false); }
    else if (a === 'repair') this.close();
    else if (a === 'again') { const d = c.diff; this.close(); this.start(d); return; }
    this.render();
  };

  ChallengeUI.prototype.tick = function () {
    if (!this.active()) return;
    const el = this.card.querySelector('[data-live]');
    if (el) el.textContent = this.liveLine();
  };
  ChallengeUI.prototype.liveLine = function () {
    const s = Math.floor(this.seconds());
    return T('⏱ {m}:{s} · score now {p}', { m: Math.floor(s / 60), s: String(s % 60).padStart(2, '0'), p: this.currentScore() });
  };

  ChallengeUI.prototype.render = function () {
    const c = this.c;
    if (!c) return;
    const cs = CASES[c.fault];
    const name = (id) => ECU.info('faults', ECU.FAULTS.find((f) => f.id === id), 'name');
    let body, foot;
    if (!c.done) {
      const hints = cs.hints.slice(0, c.hints).map((h, i) => `<div class="ch-hint"><b>${T('Hint {n}', { n: i + 1 })}</b> ${L(h)}</div>`).join('');
      const opts = c.picking ? `<div class="ch-opts">${c.options.map((id) => `<button class="ch-opt ${c.wrong.includes(id) ? 'wrong' : ''}" data-act="pick" data-fault="${id}" ${c.wrong.includes(id) ? 'disabled' : ''}>${name(id)}</button>`).join('')}</div>
        <div class="ch-note">${T('{n} guess(es) left · each wrong guess −{p}', { n: PTS.guesses - c.wrong.length, p: PTS.wrong })}</div>` : '';
      body = `<div class="ch-complaint"><span>${T('Customer says')}</span>“${L(cs.complaint)}”</div>
        <div class="ch-live" data-live>${this.liveLine()}</div>${hints}${opts}`;
      foot = `<button class="btn ghost sm" data-act="giveup">${T('Give up')}</button><span style="flex:1"></span>
        ${c.codes === 'paid' && !c.codesRead ? `<button class="btn sm" data-act="codes">${T('Read codes (−{p})', { p: PTS.codes })}</button>` : ''}
        ${c.hints < 2 ? `<button class="btn sm" data-act="hint">${T('Hint (−{p})', { p: PTS.hint })}</button>` : ''}
        <button class="btn primary sm" data-act="diagnose">${c.picking ? T('Keep investigating') : T('Diagnose…')}</button>`;
    } else {
      const codes = Object.keys(this.app.S.dtc);
      body = `<div class="ch-result ${c.solved ? 'ok' : 'bad'}">${c.solved ? T('Correct! Score {p}', { p: c.final }) : T('Not solved')}</div>
        <p><b>${T('The fault was:')}</b> ${name(c.fault)}${ECU.FAULTS.find((f) => f.id === c.fault).dtc ? ` <span class="mono">(${ECU.FAULTS.find((f) => f.id === c.fault).dtc})</span>` : ''}</p>
        <div class="ch-hint"><b>${T('Where to look')}</b> ${L(cs.hints[0])}</div>
        <div class="ch-hint"><b>${T('The key clue')}</b> ${L(cs.hints[1])}</div>
        <div class="ch-note">${codes.length ? T('Codes the ECU stored: {c}', { c: codes.join(', ') }) : T('The ECU stored no fault codes.')}${c.wrong.length ? ' · ' + T('wrong guesses: {n}', { n: c.wrong.length }) : ''}</div>`;
      foot = `<span style="flex:1"></span><button class="btn sm" data-act="again">↺ ${T('New challenge')}</button><button class="btn primary sm" data-act="repair">🔧 ${T('Repair & finish')}</button>`;
    }
    this.card.innerHTML = `
      <div class="coach-h"><span class="coach-badge">🩺 ${T('Challenge')}</span><b class="coach-title">${L(DIFFS[c.diff].title)}</b>
        <button class="coach-x" data-act="min" title="${T('Minimise')}">–</button></div>
      <div class="coach-body">${body}</div>
      <div class="coach-f">${foot}</div>`;
  };

  ECU.ChallengeUI = ChallengeUI;
})();
