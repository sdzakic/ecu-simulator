/* Guided lessons: scripted walkthroughs that drive the simulator, highlight panels and explain.
   Step fields:
     text      {en, hr}   explanation (HTML allowed)
     focus     selector(s) to highlight + scroll to
     action    fn(app)     runs once when the step starts
     until     fn(S, ctx)  step waits until this returns true, then auto-advances
     wait      {en, hr}    what we're waiting for (shown while `until` is false)
     doIt      fn(app)     "Do it for me" shortcut for steps that ask the user to act
     speed     slow-mo setting to apply ('auto' | number) */
(function () {
  const ECU = window.ECU;
  const T = (s, v) => ECU.t(s, v);
  const L = (o) => (o ? o[ECU.lang] || o.en : '');

  // fresh, predictable starting point for a lesson
  function reset(app, { type = 'na', hot = false, octane = 95 } = {}) {
    app.stockMode = true;
    app.selectEngine(type);
    const S = app.S;
    if (hot) { S.ect = 88; S.oilT = 90; }
    S.octane = octane;
    app.pedalBase = 0;
    app.setSpeed('auto');
    if (app.paused) app.togglePause();
    app.ui.syncControls();
  }
  const start = (app) => app.quickStart();
  const running = (S) => S.running && S.runT > 2;
  const setDrive = (app, gear, pedal) => { app.S.gear = gear; app.S.pedal = pedal; app.pedalBase = pedal; };
  const fault = (app, id, on) => { app.S.faults[id] = on; app.ui.syncControls(); };

  const LESSONS = [
    {
      id: 'coldstart', mins: 3,
      title: { en: 'Cold start: from key to closed loop', hr: 'Hladni start: od ključa do zatvorene petlje' },
      desc: { en: 'Bulb check, cranking, crank/cam sync, cold enrichment and the switch to closed loop.', hr: 'Provjera žaruljica, pokretanje, sinkronizacija radilice i bregastog, obogaćivanje i prelazak u zatvorenu petlju.' },
      setup: (app) => reset(app, { type: 'na' }),
      steps: [
        { focus: '.key-wrap', until: (S) => S.ecuOn, doIt: (app) => (app.S.key = 'ON'),
          text: { en: 'The engine is cold and the key is <b>OFF</b> — the ECU is asleep. Turn the key to <b>ON</b>.', hr: 'Motor je hladan, a ključ je na <b>ISKLJ</b> — ECU spava. Okrenite ključ na <b>UKLJ</b>.' },
          wait: { en: 'turn the key to ON', hr: 'okrenite ključ na UKLJ' } },
        { focus: '#cluster', until: (S) => S.bootT > 2.6,
          text: { en: 'The ECU boots. <b>Bulb check</b>: every warning lamp lights for ~2 s to prove the bulbs work. The fuel pump runs briefly to pressurise the rail — see <b>PUMP</b>.', hr: 'ECU se pokreće. <b>Provjera žaruljica</b>: sve lampice svijetle ~2 s kako bi se vidjelo da rade. Pumpa goriva kratko radi da napuni rampu — pogledajte <b>PUMPA</b>.' },
          wait: { en: 'bulb check', hr: 'provjera žaruljica' } },
        { focus: '.wheels', until: (S) => S.cranking || S.rpm > 100, doIt: (app) => (app.S.key = 'START'),
          text: { en: 'Oil and charge lamps stay on: no oil pressure and no charging yet. Now <b>crank</b> the engine (key to START) and watch the crank trigger wheel.', hr: 'Lampice ulja i punjenja ostaju upaljene: još nema tlaka ulja ni punjenja. Sada <b>pokrenite</b> motor (ključ na START) i pratite davački kotač radilice.' },
          wait: { en: 'turn the key to START', hr: 'okrenite ključ na START' } },
        { focus: ['.wheels', '#syncPill'], speed: 0.05, until: (S) => S.sync === 2 && S.running,
          text: { en: 'The ECU counts teeth until the <b>missing-tooth gap</b> passes — now it knows the crank angle. Then the <b>cam pulse</b> tells it which stroke cylinder 1 is on. Only then do spark and injection start.', hr: 'ECU broji zube dok ne prođe <b>praznina</b> — tada zna kut radilice. Zatim mu <b>impuls bregastog</b> kaže u kojem je taktu cilindar 1. Tek tada počinju paljenje i ubrizgavanje.' },
          wait: { en: 'full sync', hr: 'puna sinkronizacija' } },
        { focus: '.brain', speed: 'auto',
          text: { en: 'Running! Look at step 3 on the right: <b>after-start and cold enrichment</b> make the mixture rich (λ below 1), because fuel condenses on cold walls. The idle speed is raised too.', hr: 'Radi! Pogledajte korak 3 desno: <b>obogaćivanje nakon starta i hladnog motora</b> daje bogatu smjesu (λ ispod 1), jer se gorivo kondenzira na hladnim stijenkama. I prazni hod je povišen.' } },
        { focus: '.brain',
          text: { en: 'Step 6 shows <b>cat heating</b>: spark is retarded ~7°. Burning later sends hotter gas into the exhaust, so the catalyst lights off sooner and cleans up the cold-start emissions.', hr: 'Korak 6 prikazuje <b>grijanje katalizatora</b>: paljenje kasni ~7°. Kasnije izgaranje šalje topliji plin u ispuh, pa katalizator brže proradi i čisti emisije hladnog starta.' } },
        { focus: '.trends', until: (S) => S.closedLoop,
          text: { en: 'Now we wait for warm-up (sped up 8×). Closed loop needs coolant above 35 °C and a hot O2 sensor. Watch the <b>Temperatures</b> and <b>Oxygen sensors</b> charts.', hr: 'Sada čekamo zagrijavanje (ubrzano 8×). Za zatvorenu petlju treba rashladna tekućina iznad 35 °C i vruća lambda sonda. Pratite grafove <b>Temperature</b> i <b>Lambda sonde</b>.' },
          wait: { en: 'closed loop', hr: 'zatvorena petlja' } },
        { focus: '.trends',
          text: { en: '<b>Closed loop!</b> The upstream O2 voltage now switches between rich (~0.9 V) and lean (~0.1 V) about once a second — the ECU is trimming fuel around λ = 1, exactly what the catalyst needs.', hr: '<b>Zatvorena petlja!</b> Napon prednje lambda sonde sada se prebacuje između bogatog (~0.9 V) i siromašnog (~0.1 V) otprilike jednom u sekundi — ECU korigira gorivo oko λ = 1, upravo ono što treba katalizatoru.' } },
      ],
    },
    {
      id: 'trims', mins: 3,
      title: { en: 'Closed-loop control & fuel trims', hr: 'Zatvorena petlja i korekcije goriva' },
      desc: { en: 'How the O2 sensor steers fuelling, what STFT/LTFT mean, and how a vacuum leak sets P0171.', hr: 'Kako lambda sonda upravlja gorivom, što znače STFT/LTFT i kako curenje podtlaka postavlja P0171.' },
      setup: (app) => reset(app, { type: 'na', hot: true }),
      steps: [
        { action: start, until: (S) => S.closedLoop && S.runT > 4,
          text: { en: 'Starting a warm engine…', hr: 'Pokrećem topli motor…' }, wait: { en: 'closed loop', hr: 'zatvorena petlja' } },
        { focus: '.trends',
          text: { en: 'Upstream O2 flips between lean and rich. Each flip, the short-term trim (<b>STFT</b>) jumps, then ramps the other way — a sawtooth that keeps the average at λ = 1.', hr: 'Prednja lambda prebacuje između siromašnog i bogatog. Pri svakom prebacivanju kratkoročna korekcija (<b>STFT</b>) skoči, pa se polako mijenja u drugu stranu — pila koja drži prosjek na λ = 1.' } },
        { focus: ['[data-sid="o2up"]', '[data-sid="o2dn"]'],
          text: { en: 'The <b>downstream</b> O2 stays steady around 0.6 V: a healthy catalyst stores and releases oxygen, smoothing out the swings. If it started copying the upstream sensor, the catalyst would be worn (P0420).', hr: '<b>Stražnja</b> lambda ostaje stabilna oko 0.6 V: ispravan katalizator sprema i otpušta kisik te izglađuje oscilacije. Kad bi počela kopirati prednju sondu, katalizator bi bio istrošen (P0420).' } },
        { focus: '.trends', action: (app) => fault(app, 'vacleak', true), until: (S) => S.ltft > 0.1,
          text: { en: 'We just split a vacuum hose. Air now enters <b>after</b> the MAF, so the ECU never measured it — the mixture goes lean. Watch STFT climb, then the long-term trim (<b>LTFT</b>) slowly learn the offset.', hr: 'Upravo je pukla cijev podtlaka. Zrak sada ulazi <b>iza</b> MAF-a, pa ga ECU nikad nije izmjerio — smjesa postaje siromašna. Pratite kako STFT raste, a zatim dugoročna korekcija (<b>LTFT</b>) polako uči odstupanje.' },
          wait: { en: 'LTFT above +10 %', hr: 'LTFT iznad +10 %' } },
        { focus: '.log', until: (S) => !!S.dtc.P0171,
          text: { en: 'The trims compensate, but when the total stays above ~22 % the ECU decides something is wrong and stores <b>P0171 – System too lean</b>.', hr: 'Korekcije to nadoknađuju, ali kad ukupna korekcija ostane iznad ~22 %, ECU zaključuje da nešto nije u redu i sprema <b>P0171 – Sustav presiromašan</b>.' },
          wait: { en: 'P0171', hr: 'P0171' } },
        { focus: '.trends', action: (app) => { fault(app, 'vacleak', false); ECU.clearDTC(app.S); },
          text: { en: 'Hose fixed and codes cleared (which also resets the learned LTFT). A mechanic reads exactly these trims to find leaks: high positive trims at idle that shrink at higher load are a classic vacuum-leak signature.', hr: 'Cijev popravljena i kodovi obrisani (što resetira i naučeni LTFT). Mehaničar čita upravo ove korekcije kako bi pronašao curenja: visoke pozitivne korekcije u praznom hodu koje se smanjuju pod opterećenjem tipičan su znak curenja podtlaka.' } },
      ],
    },
    {
      id: 'knock', mins: 2,
      title: { en: 'Knock and spark timing', hr: 'Detonacija i trenutak paljenja' },
      desc: { en: 'Provoke knock on low-octane fuel, watch per-cylinder retard, then fix it with better fuel.', hr: 'Izazovite detonaciju gorivom niskog oktanskog broja, pratite kašnjenje po cilindru, pa to riješite boljim gorivom.' },
      setup: (app) => reset(app, { type: 'na', hot: true, octane: 91 }),
      steps: [
        { action: start, until: running, text: { en: 'Starting — the tank is filled with <b>91 RON</b> fuel…', hr: 'Pokrećem — spremnik je napunjen gorivom od <b>91 RON</b>…' }, wait: { en: 'engine running', hr: 'motor radi' } },
        { focus: '.engine', action: (app) => { setDrive(app, 3, 100); app.S.grade = 8; app.ui.syncControls(); }, until: (S, c) => S.knockCount > c.k0, speed: 'auto',
          text: { en: 'Full throttle in 3rd, uphill, at low rpm, on low-octane fuel — the worst case. High cylinder pressure and slow piston speed give the end-gas time to <b>auto-ignite</b>.', hr: 'Pun gas u 3. brzini, uzbrdo, na niskim okretajima, s gorivom niskog oktanskog broja — najgori slučaj. Visok tlak u cilindru i spor klip daju zaostaloj smjesi vremena da se <b>samozapali</b>.' },
          wait: { en: 'knock', hr: 'detonacija' } },
        { focus: '.scope',
          text: { en: '<b>Knock!</b> The sensor heard a burst inside one cylinder’s <b>knock window</b> (right after its TDC), so the ECU knows exactly which cylinder it was. It retards spark on <b>that cylinder only</b> — look for “−x° knock” on the coil rows.', hr: '<b>Detonacija!</b> Senzor je čuo prasak unutar <b>prozora za detonaciju</b> jednog cilindra (odmah nakon njegovog GMT), pa ECU točno zna koji je to cilindar. Paljenje kasni <b>samo na tom cilindru</b> — tražite „−x° detonacija” na redovima bobina.' } },
        { focus: '.brain',
          text: { en: 'Step 6: base spark minus knock retard. Less advance means a little less power, but no engine damage. The ECU then creeps the timing back ~0.7°/s to find the limit again.', hr: 'Korak 6: osnovno paljenje minus kašnjenje zbog detonacije. Manje pretpaljenja znači malo manje snage, ali bez oštećenja motora. ECU zatim vraća paljenje ~0.7°/s kako bi ponovno našao granicu.' } },
        { focus: '#octaneSel', action: (app) => { app.S.octane = 98; app.ui.syncControls(); }, until: (S) => S.t - S.lastKnockT > 4 && Math.max(...S.knockRetard) < 0.5,
          text: { en: 'We refuel with <b>98 RON</b>. Higher octane resists auto-ignition, so the knocking stops and the retard fades away.', hr: 'Tankamo gorivo od <b>98 RON</b>. Veći oktanski broj bolje se odupire samozapaljenju, pa detonacija prestaje, a kašnjenje nestaje.' },
          wait: { en: 'no knock for 4 s', hr: '4 s bez detonacije' } },
        { action: (app) => { setDrive(app, 0, 0); app.S.grade = 0; app.ui.syncControls(); },
          text: { en: 'Done. Knock control is why modern engines can run a spark map close to the knock limit for efficiency and still survive bad fuel.', hr: 'Gotovo. Zahvaljujući regulaciji detonacije moderni motori mogu raditi s mapom paljenja blizu granice detonacije radi učinkovitosti, a ipak preživjeti loše gorivo.' } },
      ],
    },
    {
      id: 'turbo', mins: 2,
      title: { en: 'Turbo lag & boost control', hr: 'Turbo rupa i regulacija tlaka punjenja' },
      desc: { en: 'Spool-up, the wastegate holding the target, and the blow-off valve on lift-off.', hr: 'Zavrtanje turbine, wastegate koji drži cilj i blow-off ventil kad pustite gas.' },
      setup: (app) => reset(app, { type: 'turbo', hot: true }),
      steps: [
        { action: start, until: running, text: { en: 'Starting the turbo engine…', hr: 'Pokrećem turbo motor…' }, wait: { en: 'engine running', hr: 'motor radi' } },
        { focus: ['#cluster', '.diagram'], action: (app) => setDrive(app, 3, 100), until: (S) => S.boostP - S.baro > 40,
          text: { en: 'Full throttle in 3rd from low rpm. Boost doesn’t arrive instantly: the turbine needs exhaust energy to spin up, and more boost makes more exhaust. That delay is <b>turbo lag</b>.', hr: 'Pun gas u 3. brzini s niskih okretaja. Tlak punjenja ne dolazi odmah: turbini treba energija ispuha da se zavrti, a veći tlak daje više ispuha. To kašnjenje je <b>turbo rupa</b>.' },
          wait: { en: 'boost building', hr: 'tlak raste' } },
        { focus: '.diagram', until: (S) => S.boostP - S.baro > S.boostTarget * 90,
          text: { en: 'While spooling, the ECU holds the <b>wastegate shut</b> so all the exhaust goes through the turbine. Watch the turbo wheels speed up and the charge air heat up — that’s why there’s an intercooler.', hr: 'Dok se turbina zavrti, ECU drži <b>wastegate zatvorenim</b> kako bi sav ispuh prolazio kroz turbinu. Pratite kako se kola turbine ubrzavaju, a stlačeni zrak zagrijava — zato postoji intercooler.' },
          wait: { en: 'boost target', hr: 'ciljani tlak' } },
        { focus: '.brain',
          text: { en: 'Target reached. Step 9: the ECU now <b>opens the wastegate</b> just enough to bleed off surplus exhaust and hold boost steady. Fuelling goes rich (λ ≈ 0.8) and spark is knock-limited.', hr: 'Cilj dosegnut. Korak 9: ECU sada <b>otvara wastegate</b> taman toliko da ispusti višak ispuha i drži tlak stabilnim. Smjesa postaje bogata (λ ≈ 0.8), a paljenje je ograničeno detonacijom.' } },
        { focus: '.diagram', action: (app) => setDrive(app, 3, 0), until: (S) => S.bovT > 0,
          text: { en: 'Lift off! The throttle slams shut while the charge pipe is full of pressure. With nowhere to go, it would surge back through the compressor — so the <b>blow-off valve</b> vents it. Pssht!', hr: 'Pustite gas! Leptir se naglo zatvara dok je cijev punjenja pod tlakom. Zrak nema kamo pa bi se vratio kroz kompresor — zato ga <b>blow-off ventil</b> ispušta. Pššš!' },
          wait: { en: 'blow-off valve', hr: 'blow-off ventil' } },
        { action: (app) => setDrive(app, 0, 0),
          text: { en: 'Done. Try raising the boost target on the left and repeat — or inject “Wastegate stuck closed” to see overboost protection.', hr: 'Gotovo. Probajte povećati ciljani tlak lijevo i ponoviti — ili uključite kvar „Wastegate zaglavljen zatvoren” da vidite zaštitu od previsokog tlaka.' } },
      ],
    },
    {
      id: 'dfco', mins: 2,
      title: { en: 'Decel fuel cut & rev limiter', hr: 'Prekid goriva i graničnik okretaja' },
      desc: { en: 'Why the injectors switch off when you lift at speed, and how the rev limiter protects the engine.', hr: 'Zašto se brizgaljke gase kad pustite gas u vožnji i kako graničnik okretaja štiti motor.' },
      setup: (app) => reset(app, { type: 'na', hot: true }),
      steps: [
        { action: start, until: running, text: { en: 'Starting…', hr: 'Pokrećem…' }, wait: { en: 'engine running', hr: 'motor radi' } },
        { focus: '#cluster', action: (app) => setDrive(app, 3, 60), until: (S) => S.v * 3.6 > 70,
          text: { en: 'Accelerating in 3rd…', hr: 'Ubrzavam u 3. brzini…' }, wait: { en: '70 km/h', hr: '70 km/h' } },
        { focus: ['.engine', '.brain'], action: (app) => setDrive(app, 3, 0), until: (S) => S.dfco,
          text: { en: 'Foot off at speed. The car’s momentum is turning the engine, so it needs no fuel at all…', hr: 'Gas pušten u vožnji. Zamah vozila okreće motor, pa mu gorivo uopće ne treba…' },
          wait: { en: 'decel fuel cut', hr: 'prekid goriva' } },
        { focus: '.trends',
          text: { en: '<b>DFCO</b>: injectors off (“DFCO” tags in the cylinders). Only air is pumped through, so both O2 sensors drop to lean and the catalyst fills with oxygen. Fuel returns below ~1250 rpm or when you press the pedal.', hr: '<b>DFCO</b>: brizgaljke isključene (oznake „DFCO” u cilindrima). Kroz motor prolazi samo zrak, pa obje lambda sonde padaju na siromašno, a katalizator se puni kisikom. Gorivo se vraća ispod ~1250 o/min ili kad pritisnete gas.' } },
        { focus: '#cluster', action: (app) => setDrive(app, 0, 100), until: (S) => S.revCut,
          text: { en: 'Now neutral and full throttle. With no load, the engine races toward the red line…', hr: 'Sada ler i pun gas. Bez opterećenja motor juri prema crvenom polju…' },
          wait: { en: 'rev limiter', hr: 'graničnik okretaja' } },
        { focus: '.engine', action: (app) => setTimeout(() => setDrive(app, 0, 0), 2500),
          text: { en: '<b>Rev limiter</b>: above 6800 rpm the ECU cuts fuel, and restores it 200 rpm lower. That on/off bouncing is the familiar limiter stutter.', hr: '<b>Graničnik okretaja</b>: iznad 6800 o/min ECU prekida gorivo i vraća ga 200 o/min niže. To paljenje-gašenje je poznato „štucanje” graničnika.' } },
      ],
    },
    {
      id: 'misfire', mins: 2,
      title: { en: 'Misfire detection', hr: 'Otkrivanje izostanka paljenja' },
      desc: { en: 'How the crank sensor detects a dead coil, and why the ECU shuts that injector off.', hr: 'Kako senzor radilice otkriva bobinu u kvaru i zašto ECU gasi tu brizgaljku.' },
      setup: (app) => reset(app, { type: 'na', hot: true }),
      steps: [
        { action: start, until: running, text: { en: 'Starting…', hr: 'Pokrećem…' }, wait: { en: 'engine running', hr: 'motor radi' } },
        { focus: '.scope', action: (app) => fault(app, 'misfire3', true), speed: 0.05,
          text: { en: 'Ignition coil 3 just died. Look at the bottom <b>crank speed</b> row: every power stroke gives the crank a push — except in cylinder 3’s segment, where it slows down.', hr: 'Bobina 3 upravo se pokvarila. Pogledajte donji red <b>brzine radilice</b>: svaki radni takt gurne radilicu — osim u segmentu cilindra 3, gdje ona usporava.' } },
        { focus: '#cluster', speed: 'auto', until: (S) => !!S.dtc.P0303,
          text: { en: 'The ECU measures the time for each segment of CKP teeth. A consistently slow segment means that cylinder isn’t firing. The <b>MIL flashes</b>: raw fuel in the exhaust can overheat the catalyst.', hr: 'ECU mjeri vrijeme za svaki segment zubi CKP kotača. Stalno spor segment znači da taj cilindar ne pali. <b>MIL treperi</b>: sirovo gorivo u ispuhu može pregrijati katalizator.' },
          wait: { en: 'P0303', hr: 'P0303' } },
        { focus: '.engine',
          text: { en: '<b>P0303</b> stored, and the ECU shut off injector 3 (“INJ CUT”). The engine shakes on three cylinders, but the catalyst is safe.', hr: 'Spremljen <b>P0303</b>, a ECU je isključio brizgaljku 3 („BRIZG. ISKLJ”). Motor trese na tri cilindra, ali katalizator je siguran.' } },
        { action: (app) => { fault(app, 'misfire3', false); ECU.clearDTC(app.S); },
          text: { en: 'Coil replaced and codes cleared. Cylinder 3 is back.', hr: 'Bobina zamijenjena i kodovi obrisani. Cilindar 3 ponovno radi.' } },
      ],
    },
  ];
  ECU.LESSONS = LESSONS;

  // ---------------- runner ----------------
  function Lessons(app) {
    this.app = app;
    this.lesson = null;
    this.i = 0;
    this.doneT = null;
    this.ctx = {};
    this.focused = [];
    this.done = {};
    try { this.done = JSON.parse(localStorage.getItem('ecu-lessons-done') || '{}'); } catch (e) { /* ignore */ }
    this.card = document.getElementById('coach');
    this.picker = document.getElementById('lessonModal');
    document.getElementById('lessonsBtn').addEventListener('click', () => this.openPicker());
    this.picker.addEventListener('click', (e) => {
      if (e.target === this.picker || e.target.hasAttribute('data-close')) this.closePicker();
      const b = e.target.closest('[data-lesson]');
      if (b) { this.closePicker(); this.start(b.dataset.lesson); }
    });
    this.card.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const a = act.dataset.act;
      if (a === 'next') this.next();
      else if (a === 'exit') this.stop();
      else if (a === 'doit') { const st = this.step(); if (st && st.doIt) st.doIt(this.app); }
      else if (a === 'restart') this.start(this.lesson.id);
      else if (a === 'min') this.card.classList.toggle('min');
    });
    window.addEventListener('ecu:lang', () => { this.render(); if (this.picker.classList.contains('open')) this.openPicker(); });
  }

  Lessons.prototype.step = function () { return this.lesson && this.lesson.steps[this.i]; };

  Lessons.prototype.openPicker = function () {
    const list = LESSONS.map((l, n) => `
      <button class="lesson-card" data-lesson="${l.id}">
        <span class="ln">${n + 1}</span>
        <span class="lt"><b>${L(l.title)}</b><small>${L(l.desc)}</small></span>
        <span class="lm">${this.done[l.id] ? '<i class="lok">✓</i>' : ''}~${l.mins} min</span>
      </button>`).join('');
    this.picker.querySelector('.lesson-list').innerHTML = list;
    this.picker.querySelector('h2').textContent = T('Guided lessons');
    this.picker.querySelector('.hint').textContent = T('Each lesson drives the simulator for you and pauses to explain. You can still use every control.');
    this.picker.classList.add('open');
  };
  Lessons.prototype.closePicker = function () { this.picker.classList.remove('open'); };

  Lessons.prototype.start = function (id) {
    if (this.app.S.dyno) ECU.abortDyno(this.app.S, 'a lesson started');
    if (this.app.dyno) this.app.dyno.pending = false;
    this.lesson = LESSONS.find((l) => l.id === id);
    this.lesson.setup(this.app);
    this.card.classList.add('open');
    this.card.classList.remove('min');
    document.body.classList.add('lesson-open');
    this.enter(0);
  };

  Lessons.prototype.stop = function () {
    this.clearFocus();
    if (this.app.stockMode) this.app.useStockCal(false); // back to the user's own maps
    this.lesson = null;
    this.card.classList.remove('open');
    document.body.classList.remove('lesson-open');
  };

  Lessons.prototype.enter = function (i) {
    this.i = i;
    this.doneT = null;
    const st = this.step();
    this.ctx = { k0: this.app.S.knockCount, t0: this.app.S.t };
    if (st.speed != null) this.app.setSpeed(st.speed);
    if (st.action) st.action(this.app);
    this.setFocus(st.focus);
    this.render();
  };

  Lessons.prototype.next = function () {
    if (!this.lesson) return;
    if (this.i < this.lesson.steps.length - 1) this.enter(this.i + 1);
    else {
      this.done[this.lesson.id] = true;
      try { localStorage.setItem('ecu-lessons-done', JSON.stringify(this.done)); } catch (e) { /* ignore */ }
      this.stop();
      this.openPicker();
    }
  };

  Lessons.prototype.setFocus = function (sel) {
    this.clearFocus();
    if (!sel) return;
    const sels = Array.isArray(sel) ? sel : [sel];
    this.focused = sels.flatMap((s) => [...document.querySelectorAll(s)]).filter((el) => el.offsetParent !== null);
    this.focused.forEach((el) => el.classList.add('lesson-focus'));
    const first = this.focused[0];
    if (first) {
      // open the side panel / phone drawer if the target lives in it
      if (first.closest('#controls')) this.app.ui.showControls();
      else this.app.ui.setDrawer(false);
      const r = first.getBoundingClientRect();
      if (r.top < 70 || r.bottom > window.innerHeight - 40) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  Lessons.prototype.clearFocus = function () {
    this.focused.forEach((el) => el.classList.remove('lesson-focus'));
    this.focused = [];
  };

  // called every frame
  Lessons.prototype.tick = function (S) {
    const st = this.step();
    if (!st || !st.until) return;
    if (this.doneT == null && st.until(S, this.ctx)) {
      this.doneT = performance.now();
      this.render();
    }
    if (this.doneT != null && performance.now() - this.doneT > 1400 && this.step() === st) this.next();
  };

  Lessons.prototype.render = function () {
    if (!this.lesson) return;
    const st = this.step();
    const n = this.lesson.steps.length;
    const waiting = st.until && this.doneT == null;
    const last = this.i === n - 1;
    this.card.innerHTML = `
      <div class="coach-h">
        <span class="coach-badge">🎓 ${T('Lesson')}</span>
        <b class="coach-title">${L(this.lesson.title)}</b>
        <button class="coach-x" data-act="min" title="${T('Minimise')}">–</button>
        <button class="coach-x" data-act="exit" title="${T('Exit lesson')}">×</button>
      </div>
      <div class="coach-prog"><i style="width:${((this.i + (waiting ? 0.5 : 1)) / n) * 100}%"></i></div>
      <div class="coach-body">
        <div class="coach-step">${T('Step {n} of {m}', { n: this.i + 1, m: n })}</div>
        <p>${L(st.text)}</p>
        ${st.until ? `<div class="coach-wait ${waiting ? '' : 'ok'}"><span class="dot"></span>${waiting ? T('Waiting for: {w}', { w: L(st.wait) }) : '✓ ' + T('Done')}</div>` : ''}
      </div>
      <div class="coach-f">
        <button class="btn ghost sm" data-act="restart">↺ ${T('Restart')}</button>
        <span style="flex:1"></span>
        ${waiting && st.doIt ? `<button class="btn sm" data-act="doit">${T('Do it for me')}</button>` : ''}
        ${!waiting ? `<button class="btn primary sm" data-act="next">${last ? T('Finish') : T('Next') + ' →'}</button>` : `<button class="btn ghost sm" data-act="next">${T('Skip')}</button>`}
      </div>`;
  };

  ECU.Lessons = Lessons;
})();
