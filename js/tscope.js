/* Time-based oscilloscope: probe two signals on a millisecond axis, like a workshop scope.
   Physics steps at 240 Hz, far too coarse for crank teeth or a coil's flyback, so every physics
   step is captured (crank angle, rpm and what the ECU commanded) and the waveforms are rebuilt
   analytically between steps from the crank angle. The core (capture, signals, trigger,
   measurements) is DOM-free so the tests can run it; TScopeUI is the browser panel. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const ECU = (root.ECU = root.ECU || {});
  const T = (s, v) => ECU.t(s, v);
  const L10N = (o) => (o ? o[ECU.lang] || o.en : '');
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mod = (a, m) => ((a % m) + m) % m;
  const TAU = 2 * Math.PI;
  const hash = (x) => { const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
  const BUF_S = 12; // seconds of history kept (covers the 1 s/div timebase)

  /* ================= capture ================= */
  function Capture() { this.reset(); }
  Capture.prototype.reset = function () { this.snaps = []; this.events = []; this.prevKnock = null; this.type = null; };
  Capture.prototype.push = function (S) {
    let sn = this.snaps;
    if (this.type !== S.type || (sn.length && S.t < sn[sn.length - 1].t)) { this.reset(); sn = this.snaps; } // engine swapped
    this.type = S.type;
    const E = S.E, G = ECU.geom(E), F = S.faults;
    sn.push({
      t: S.t, crank: S.crank, rpm: S.rpm, on: S.ecuOn, sync: S.sync, n: G.n, off: G.off, diesel: !!E.diesel,
      pw: S.pw, eoi: S.eoi, batch: S.batch, cut: S.fuelCutAll, injCut: S.injCut.slice(), spark: S.sparkCyl.slice(), dwell: S.dwell,
      vbat: S.vbat, o2v: S.o2v, o2dn: S.o2dn, maf: S.mafTrue, mafFull: E.mafFull || 260, map: S.map, mapRange: E.turbo ? 300 : 105,
      thr: S.throttle, vvt: S.vvt || 0, cranking: S.cranking, charging: S.charging, ckpType: S.ckpType,
      q: S.qMg || 0, soi: S.soi || 0, pilot: !!S.pilot, pilotSoi: S.pilotSoi || 0, post: S.postMg || 0, rail: S.rail || 0,
      F: { ckp: F.ckp, cmp: F.cmp, maf: F.maf, map: F.map, tps: F.tps, knocksensor: F.knocksensor, misfire3: F.misfire3 },
    });
    // knock: the ringing belongs to the next combustion of the cylinder that knocked
    if (!E.diesel) {
      const pk = this.prevKnock || [];
      for (let c = 0; c < G.n; c++) {
        const k = S.knockTrue[c] || 0;
        if (k > (pk[c] || 0) + 0.05 && S.rpm > 50) {
          const L = mod(S.crank - G.off[c], 720);
          const ev = { t: S.t + (L < 12 ? 12 - L : 732 - L) / (S.rpm * 6), c, amp: k };
          let i = this.events.length;
          while (i > 0 && this.events[i - 1].t > ev.t) i--;
          this.events.splice(i, 0, ev);
        }
      }
      this.prevKnock = S.knockTrue.slice();
    }
    const t0 = S.t - BUF_S;
    let k = 0;
    while (k < sn.length && sn[k].t < t0) k++;
    if (k) sn.splice(0, k);
    while (this.events.length && this.events[0].t < t0 - 0.01) this.events.shift();
  };
  Capture.prototype.span = function () {
    const s = this.snaps;
    return s.length ? [s[0].t, s[s.length - 1].t] : [0, 0];
  };

  /* ================= signals (volts at the sensor / actuator pin) ================= */
  const local = (x, c) => mod(x.th - x.a.off[c], 720);
  const firePhase = (x) => (x.th / (720 / x.a.n)) * TAU; // one period per combustion

  function injPetrol(x) {
    const a = x.a, c = Math.min(x.cyl, a.n - 1);
    if (!a.on) return 0;
    const vb = x.lin('vbat');
    if (!(a.pw > 0) || a.injCut[c] || a.cut || a.sync === 0 || a.rpm < 5) return vb;
    const L = local(x, c), dps = a.rpm * 6;
    const pwDeg = Math.min(700, (a.pw * dps) / 1000);
    const eois = a.batch ? [a.eoi, a.eoi - 360] : [a.eoi];
    for (const eoi of eois) if (mod(L - (eoi - pwDeg), 720) < pwDeg) return 0.35; // driver pulls the injector to ground
    for (const eoi of eois) {
      const tc = mod(L - eoi, 720) / dps; // seconds since the driver let go
      if (tc < 0.0025) {
        // collapsing coil field → flyback spike clamped by the driver, then the pintle-closing hump
        let v = tc < 0.00008 ? 68 : vb + (68 - vb) * Math.exp(-(tc - 0.00008) / 0.00006);
        v += 1.4 * Math.exp(-(((tc - 0.0008) / 0.00012) ** 2));
        return v;
      }
    }
    return vb;
  }

  function injPiezo(x) {
    const a = x.a, c = Math.min(x.cyl, a.n - 1);
    if (!a.on || !(a.q > 0) || a.sync < 2 || a.rpm < 5) return 0;
    const L = local(x, c), dps = a.rpm * 6;
    const pulses = [[720 - a.soi, Math.max(0.0003, a.pw / 1000)]];
    if (a.pilot) pulses.push([720 - a.pilotSoi, 0.00022]);
    if (a.post > 0) pulses.push([70, 0.0003]);
    let v = 0;
    for (const [ang, dur] of pulses) {
      const ts = mod(L - ang, 720) / dps; // seconds since this pulse started
      if (ts < dur) v = Math.max(v, 145 * Math.min(1, ts / 0.00012)); // charging the crystal stack
      else if (ts < dur + 0.00015) v = Math.max(v, 145 * (1 - (ts - dur) / 0.00015)); // discharge closes the nozzle
    }
    return v;
  }

  function coilPrimary(x) {
    const a = x.a, c = Math.min(x.cyl, a.n - 1);
    if (!a.on) return 0;
    const vb = x.lin('vbat');
    if (a.sync === 0 || a.rpm < 5 || a.F.ckp) return vb;
    const L = local(x, c), dps = a.rpm * 6;
    const adv = a.spark[c] || 0;
    const dwellDeg = Math.min(200, (a.dwell * dps) / 1000);
    const dead = a.F.misfire3 && c === 2;
    const sparks = a.sync === 1 ? [720 - adv, 360 - adv] : [720 - adv]; // wasted spark without cam sync
    for (const sa of sparks) {
      const d = mod(sa - L, 720);
      if (d < dwellDeg) { const k = 1 - d / dwellDeg; return 0.5 + 1.3 * k * k; } // transistor on, current building
    }
    for (const sa of sparks) {
      const ts = mod(L - sa, 720) / dps;
      if (ts > 0.006) continue;
      // no spark: the energy rings out in the coil — tall oscillation, no burn line
      if (dead) return clamp(vb + 340 * Math.exp(-ts / 0.00028) * Math.cos(TAU * 9000 * ts), -2, 460);
      const burn = 0.0013;
      if (ts < burn) return 39 + 6 * (ts / burn) + 345 * (ts < 8e-6 ? 1 : Math.exp(-(ts - 8e-6) / 0.000014)) + (hash(x.t * 2e5) - 0.5) * 3;
      const te = ts - burn;
      return Math.max(-0.7, vb + (45 - vb) * Math.exp(-te / 0.00035) * Math.cos(TAU * 3200 * te)); // the driver's diode clamps below ground
    }
    return vb;
  }

  function knockV(x) {
    const a = x.a;
    if (a.F.knocksensor || !a.on) return 0;
    let v = (hash(x.t * 1.3e5) - 0.5) * 0.03;
    if (a.rpm > 50) {
      const g = 0.06 + a.rpm / 40000;
      for (let c = 0; c < a.n; c++) {
        const L = local(x, c);
        if (L > 4 && L < 60) v += (hash(x.t * 2.7e5 + c * 7.1) - 0.5) * g * (1 - (L - 4) / 56); // combustion noise
      }
    }
    const ev = x.ev;
    let lo = 0, hi = ev.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ev[m].t < x.t - 0.005) lo = m + 1; else hi = m; }
    for (let i = lo; i < ev.length && ev[i].t <= x.t; i++) {
      const d = x.t - ev[i].t;
      v += ev[i].amp * 0.8 * Math.sin(TAU * 6400 * d) * Math.exp(-d / 0.0011); // knock rings at the block's resonance
    }
    return v;
  }

  function railV(x) {
    const a = x.a;
    if (!a.on) return 0;
    let bar = x.lin('rail');
    const dip = Math.min(150, a.q * 4);
    if (a.q > 0 && a.sync === 2) {
      for (let c = 0; c < a.n; c++) {
        const d = mod(local(x, c) - (720 - a.soi), 720);
        if (d < 40) bar -= dip * Math.sin((d / 40) * Math.PI) * (d < 20 ? 1 : 0.6);
      }
    }
    if (a.rpm > 30) bar += 10 * Math.sin((x.th / 720) * TAU * 3); // high-pressure pump strokes
    return 0.5 + (4 * Math.max(0, bar)) / 2200;
  }

  function vbatV(x) {
    const a = x.a;
    let v = x.lin('vbat');
    if (a.charging) {
      const fr = ((a.rpm * 2.7) / 60) * 36; // alternator speed × poles × rectifier diodes
      v += 0.06 * Math.sin(TAU * fr * x.t) + 0.025 * Math.sin(TAU * fr * 2 * x.t + 1);
    }
    if (a.cranking && a.rpm > 20) v -= 0.9 * Math.max(0, Math.cos(firePhase(x) + 0.35)) ** 3; // starter current peaks at each compression
    return v;
  }

  const PET = ['na', 'turbo', 'v12'], DSL = ['diesel'];
  // tr = default trigger [level, edge]; bip = symmetric about 0 V; zoom = auto-range around the data
  const SIGNALS = {
    ckp: {
      name: 'Crank sensor (CKP)', bip: true, tr: [0, 'rise'],
      v: (x) => {
        const a = x.a;
        if (a.F.ckp) return 0;
        const v = ECU.ckpSignal(x.th, a.ckpType, a.rpm);
        if (a.ckpType === 'hall') return a.on ? 5 * v : 0;
        return a.rpm < 1 ? 0 : v * Math.min(45, 0.15 + a.rpm * 0.006); // VR: self-generating, amplitude ∝ speed
      },
      rpm: (f) => f, // 60-2 wheel: tooth frequency in Hz ≈ rpm
      desc: {
        en: 'A variable-reluctance sensor makes its own AC voltage: every tooth passing the magnet gives one sine wave, and the amplitude grows with speed (a few volts when cranking, 30 V or more at high rpm). The missing-tooth gap shows as a longer, bigger swing — the ECU\'s reference mark. A Hall sensor gives a clean 0/5 V square wave instead. Look for even teeth, a clear gap once per revolution and no dropouts.',
        hr: 'Induktivni (VR) senzor sam proizvodi izmjenični napon: svaki zub koji prođe pokraj magneta daje jedan sinusni val, a amplituda raste s brzinom (nekoliko volti pri pokretanju, 30 V i više na visokim okretajima). Praznina od dva zuba vidi se kao duži, veći zamah — referentna oznaka za ECU. Hallov senzor umjesto toga daje čisti pravokutni signal 0/5 V. Tražite jednake zube, jasnu prazninu jednom po okretaju i bez ispadanja signala.',
      },
    },
    cmp: {
      name: 'Cam sensor (CMP)', tr: [2.5, 'rise'],
      v: (x) => (x.a.on && !x.a.F.cmp ? 5 * ECU.cmpSignal(x.th, x.a.vvt) : 0),
      rpm: (f) => f * 120,
      desc: {
        en: 'Hall-effect sensor powered by the ECU: 5 V or 0 V depending on whether the cam tab is in front of it. One pulse per two crank revolutions tells the ECU which stroke cylinder 1 is on. Put it next to the crank signal to check timing: if the pulse slides against the crank gap, the cam timing (VVT or belt) has moved.',
        hr: 'Hallov senzor napajan iz ECU-a: 5 V ili 0 V, ovisno o tome je li jezičac bregastog vratila ispred njega. Jedan impuls na dva okretaja radilice govori ECU-u u kojem je taktu cilindar 1. Usporedite ga sa signalom radilice za provjeru razvoda: ako impuls klizi u odnosu na prazninu radilice, pomaknulo se razvodno vratilo (VVT ili remen).',
      },
    },
    inj: {
      name: 'Injector', cyl: true, tr: [6, 'fall'], trD: [70, 'rise'],
      v: (x) => (x.a.diesel ? injPiezo(x) : injPetrol(x)),
      pulse: (d) => (d ? { k: 'Injection time', above: 70, minRun: 0.00005 } : { k: 'Injection time', below: 3, minRun: 0.00025 }),
      desc: {
        en: 'The ECU switches the injector to ground (low side): the line sits at battery voltage, drops to ~0 V while the injector is open — that low section is the injection time — and when the driver lets go, the collapsing coil field kicks up a 60–70 V spike. The small hump a moment later is the pintle hitting its seat: no hump suggests a sticking injector. No pulses on one cylinder = injector cut or open circuit.',
        hr: 'ECU uključuje brizgaljku prema masi (low side): linija stoji na naponu akumulatora, pada na ~0 V dok je brizgaljka otvorena — taj donji dio je vrijeme ubrizgavanja — a kad upravljački tranzistor pusti, magnetsko polje zavojnice koje nestaje izbacuje šiljak od 60–70 V. Mala grba trenutak kasnije je igla koja udara u sjedište: bez grbe brizgaljka možda zapinje. Nema impulsa na jednom cilindru = brizgaljka isključena ili prekid.',
      },
      descD: {
        en: 'Piezo injectors open when the ECU charges a crystal stack to about 150 V: the stack grows a few hundredths of a millimetre and lifts the nozzle needle; discharging it closes the nozzle. You see the short pilot pulse, the main injection near TDC and, during DPF regeneration, a late post-injection. The pulse length is the injection time — far shorter than on a petrol engine because the rail is at 1000+ bar.',
        hr: 'Piezo brizgaljke otvaraju se kad ECU napuni kristalni stupac na oko 150 V: stupac se produlji za nekoliko stotinki milimetra i podigne iglu sapnice; pražnjenjem se sapnica zatvara. Vidi se kratki pilot-impuls, glavno ubrizgavanje blizu GMT-a i, za vrijeme regeneracije DPF-a, kasno naknadno ubrizgavanje. Duljina impulsa je vrijeme ubrizgavanja — mnogo kraće nego kod benzinca jer je u rampi 1000+ bara.',
      },
    },
    coil: {
      name: 'Ignition coil (primary)', cyl: true, only: PET, tr: [30, 'rise'],
      v: coilPrimary,
      pulse: () => ({ k: 'Dwell', below: 3, minRun: 0.00025 }),
      desc: {
        en: 'Primary side of a coil: battery voltage at rest, close to 0 V while the ECU\'s transistor conducts (dwell — current and magnetic field build up), then the transistor opens and the primary flies up to 300–400 V as the spark fires. The flat “burn line” at ~40 V is the spark burning for about 1.3 ms, followed by a few decaying oscillations. No burn line and a tall ringing spike = the spark never jumped: open plug lead or a dead coil.',
        hr: 'Primarna strana bobine: napon akumulatora u mirovanju, blizu 0 V dok tranzistor u ECU-u vodi (dwell — struja i magnetsko polje rastu), zatim se tranzistor otvara i primar skoči na 300–400 V dok iskra preskače. Ravna „linija gorenja” na ~40 V je iskra koja gori oko 1,3 ms, a zatim slijedi nekoliko prigušenih titraja. Nema linije gorenja, a šiljak visoko titra = iskra nije preskočila: prekinut kabel svjećice ili neispravna bobina.',
      },
    },
    knock: {
      name: 'Knock sensor', only: PET, bip: true, tr: [0.3, 'rise'],
      v: knockV,
      desc: {
        en: 'A piezo accelerometer bolted to the block turns engine vibration into a small AC voltage. Each combustion makes a little burst; real knock adds a sharp ringing at about 6–7 kHz right after TDC. The ECU only listens in a short window after each cylinder\'s TDC, so it knows which cylinder knocked.',
        hr: 'Piezo akcelerometar pričvršćen na blok pretvara vibracije motora u mali izmjenični napon. Svako izgaranje stvara mali nalet; pravo detoniranje dodaje oštro zvonjenje na oko 6–7 kHz odmah nakon GMT-a. ECU sluša samo u kratkom prozoru nakon GMT-a svakog cilindra, pa zna koji je cilindar detonirao.',
      },
    },
    o2up: {
      name: 'O2 sensor, upstream', only: PET, tr: [0.45, 'rise'],
      v: (x) => x.lin('o2v'),
      desc: {
        en: 'A narrowband zirconia sensor generates its own voltage: ~0.1 V lean, ~0.9 V rich, with a steep jump at λ = 1. In closed loop the ECU keeps crossing that jump, so a healthy sensor switches once or twice a second. Slow, lazy edges point to an aged sensor; a flat line at 0.1 V is a dead (or very lean) sensor.',
        hr: 'Uskopojasna cirkonijska sonda sama stvara napon: ~0,1 V siromašno, ~0,9 V bogato, sa strmim skokom na λ = 1. U zatvorenoj petlji ECU stalno prelazi preko tog skoka, pa ispravna sonda prebacuje jednom do dvaput u sekundi. Spori, lijeni bridovi upućuju na ostarjelu sondu; ravna linija na 0,1 V znači mrtvu (ili jako siromašnu) sondu.',
      },
    },
    o2dn: {
      name: 'O2 sensor, downstream', only: PET, tr: [0.45, 'rise'],
      v: (x) => x.lin('o2dn'),
      desc: {
        en: 'Behind the catalyst. A working catalyst stores oxygen and smooths out the mixture swings, so this trace stays fairly flat around 0.6–0.7 V. If it starts copying the upstream switching, the catalyst can no longer store oxygen — exactly what the P0420 monitor checks.',
        hr: 'Iza katalizatora. Ispravan katalizator sprema kisik i izglađuje oscilacije smjese, pa ovaj signal ostaje prilično ravan oko 0,6–0,7 V. Ako počne kopirati prebacivanje prednje sonde, katalizator više ne može spremati kisik — upravo to provjerava monitor P0420.',
      },
    },
    maf: {
      name: 'MAF sensor', tr: [2, 'rise'],
      v: (x) => {
        const a = x.a;
        if (!a.on || a.F.maf) return 0;
        const g = Math.max(0, x.lin('maf')) * (1 + 0.07 * Math.sin(firePhase(x)) * Math.min(1, a.rpm / 300));
        return 0.95 + 3.9 * Math.sqrt(g / a.mafFull);
      },
      desc: {
        en: 'Hot-film air-mass meter: about 1 V with no flow, rising with the square root of the airflow towards 4–5 V at full power. At idle the trace ripples at the firing frequency — every intake stroke tugs at the air column. Snap the throttle and the voltage should jump at once; a sluggish or capped trace points to a dirty sensor.',
        hr: 'Mjerač mase zraka s vrućim filmom: oko 1 V bez protoka, raste s drugim korijenom protoka prema 4–5 V pri punoj snazi. Na praznom hodu signal titra na frekvenciji paljenja — svaki usisni takt povuče stupac zraka. Naglo otvorite leptir i napon mora odmah skočiti; trom ili odrezan signal upućuje na prljav senzor.',
      },
    },
    map: {
      name: 'MAP sensor', tr: [1.5, 'rise'],
      v: (x) => {
        const a = x.a;
        if (!a.on || a.F.map) return 0;
        let p = x.lin('map');
        if (a.rpm > 30) p += (1 + 5 * (p / 100)) * (1 - Math.min(0.85, a.rpm / 5000)) * Math.sin(firePhase(x) - 1); // intake pulses
        return 0.5 + (4 * p) / a.mapRange;
      },
      desc: {
        en: 'Piezo-resistive pressure sensor: 0.5 V at vacuum, 4.5 V at the top of its range. At idle the manifold is at deep vacuum (low voltage) with a small pulse from each intake stroke; open the throttle and it rises toward atmospheric — or above it on boost. Uneven pulses can point to a leaking valve on one cylinder.',
        hr: 'Piezootporni senzor tlaka: 0,5 V pri vakuumu, 4,5 V na vrhu mjernog područja. Na praznom hodu u usisnoj grani je dubok podtlak (nizak napon) s malim impulsom od svakog usisnog takta; otvorite leptir i tlak raste prema atmosferskom — ili iznad njega s turbom. Neujednačeni impulsi mogu upućivati na ventil koji propušta na jednom cilindru.',
      },
    },
    tps1: {
      name: 'Throttle position, track 1', tr: [2.5, 'rise'],
      v: (x) => (x.a.on ? 0.5 + (x.lin('thr') / 100) * 4 : 0),
      desc: {
        en: 'Two potentiometers on the throttle shaft. Track 1 rises from 0.5 V closed to 4.5 V wide open; track 2 runs the opposite way. The ECU compares them all the time: if their sum drifts away from 5 V, one track is faulty and the throttle goes into limp mode. You want a clean sweep without gaps.',
        hr: 'Dva potenciometra na osovini leptira. Staza 1 raste od 0,5 V (zatvoreno) do 4,5 V (potpuno otvoreno); staza 2 ide obrnuto. ECU ih stalno uspoređuje: ako im se zbroj udalji od 5 V, jedna je staza neispravna i leptir prelazi u način rada u nuždi. Želite vidjeti čist prijelaz bez prekida.',
      },
    },
    tps2: {
      name: 'Throttle position, track 2', tr: [2.5, 'fall'],
      v: (x) => {
        if (!x.a.on) return 0;
        const t = x.lin('thr');
        return 4.5 - (clamp(x.a.F.tps ? t + 18 : t, 0, 100) / 100) * 4;
      },
      desc: {
        en: 'Second throttle track: falls from 4.5 V to 0.5 V as the throttle opens — the mirror image of track 1. Show both: they must cross in the middle and always add up to about 5 V.',
        hr: 'Druga staza leptira: pada od 4,5 V do 0,5 V dok se leptir otvara — zrcalna slika staze 1. Prikažite obje: moraju se križati u sredini i uvijek davati zbroj od oko 5 V.',
      },
    },
    rail: {
      name: 'Rail pressure sensor', only: DSL, tr: [2.5, 'fall'],
      v: railV,
      desc: {
        en: 'Rail pressure sensor: 0.5 V at zero, about 4.5 V near 2000 bar. Each main injection draws fuel and makes a small dip; the pressure control valve and the pump fill it straight back up. A rail that sags under load, or can\'t hold pressure at idle, points to a weak pump or a leaking injector.',
        hr: 'Senzor tlaka u rampi: 0,5 V pri nuli, oko 4,5 V blizu 2000 bara. Svako glavno ubrizgavanje povuče gorivo i napravi mali pad; ventil za regulaciju tlaka i pumpa ga odmah nadoknade. Rampa koja pada pod opterećenjem ili ne drži tlak na praznom hodu upućuje na slabu pumpu ili brizgaljku koja propušta.',
      },
    },
    vbat: {
      name: 'Battery voltage', zoom: true, tr: [12, 'fall'],
      v: vbatV,
      desc: {
        en: 'Battery voltage, zoomed in. Engine off: about 12.6 V. While cranking it drops to ~10 V and dips at every compression stroke — on a workshop scope that ripple is a quick “relative compression test”: a weak cylinder gives a smaller dip. Running: 13.8–14.5 V from the alternator, with a small ripple from its rectifier diodes.',
        hr: 'Napon akumulatora, uvećano. Motor ugašen: oko 12,6 V. Pri pokretanju pada na ~10 V i propada pri svakom taktu kompresije — na radioničkom osciloskopu ta valovitost je brzi „relativni test kompresije”: slabiji cilindar daje manji pad. Motor radi: 13,8–14,5 V iz alternatora, s malom valovitošću od njegovih diodnih ispravljača.',
      },
    },
  };

  const TIMEBASES = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]; // ms/div
  const VDIV = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]; // volts per division
  const DIVX = 10, PRETRIG = 0.1;
  const ROLL_FROM = 200; // ms/div: slow timebases scroll like a chart recorder instead of triggering

  // a probe walks the capture buffer; reuse one per pass so lookups stay O(1)
  function Probe(cap) { this.s = cap.snaps; this.ev = cap.events; this.i = 0; }
  Probe.prototype.seek = function (t) {
    const s = this.s;
    if (!s.length || t < s[0].t) return -1;
    let i = Math.min(this.i, s.length - 1);
    if (s[i].t > t && i > 0 && s[i - 1].t > t) {
      let lo = 0, hi = i;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m].t <= t) lo = m; else hi = m - 1; }
      i = lo;
    }
    while (i > 0 && s[i].t > t) i--;
    while (i + 1 < s.length && s[i + 1].t <= t) i++;
    this.i = i;
    return i;
  };
  Probe.prototype.value = function (sig, cyl, t) {
    const i = this.seek(t);
    if (i < 0) return null;
    const a = this.s[i], b = this.s[i + 1];
    if (!b && t > a.t + 0.02) return null; // not captured yet
    const f = b ? clamp((t - a.t) / Math.max(b.t - a.t, 1e-6), 0, 1) : 0;
    const x = { a, t, cyl, ev: this.ev, th: mod(a.crank + a.rpm * 6 * (t - a.t), 720), lin: (k) => (b ? a[k] + (b[k] - a[k]) * f : a[k]) };
    return SIGNALS[sig].v(x);
  };

  // min/max envelope per screen column ("peak detect", so short spikes are never lost) + the centre value
  function trace(cap, sig, cyl, t0, W, cols) {
    const p = new Probe(cap);
    const mn = new Float32Array(cols), mx = new Float32Array(cols), mid = new Float32Array(cols), ok = new Uint8Array(cols);
    const K = clamp(Math.ceil(W / cols / 2e-5), 1, 12);
    for (let i = 0; i < cols; i++) {
      let lo = Infinity, hi = -Infinity, m = null;
      for (let k = 0; k < K; k++) {
        const v = p.value(sig, cyl, t0 + ((i + (k + 0.5) / K) / cols) * W);
        if (v == null) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        if (k === K >> 1) m = v;
      }
      if (hi >= lo) { ok[i] = 1; mn[i] = lo; mx[i] = hi; mid[i] = m == null ? (lo + hi) / 2 : m; }
    }
    return { sig, cyl, t0, W, cols, mn, mx, mid, ok };
  }

  // newest crossing of `level` in [tLo, tHi], refined by bisection so the picture doesn't jitter
  function findTrigger(cap, sig, cyl, level, edge, tLo, tHi, step) {
    const p = new Probe(cap);
    p.i = cap.snaps.length - 1;
    const hit = (v0, v1) => (edge === 'rise' ? v0 < level && v1 >= level : v0 > level && v1 <= level);
    let tAfter = tHi, vAfter = p.value(sig, cyl, tHi);
    for (let t = tHi - step; t >= tLo; t -= step) {
      const v = p.value(sig, cyl, t);
      if (v != null && vAfter != null && hit(v, vAfter)) {
        let a = t, b = tAfter;
        for (let k = 0; k < 12; k++) {
          const m = (a + b) / 2, vm = p.value(sig, cyl, m);
          if (vm != null && hit(v, vm) ) b = m; else a = m;
        }
        return b;
      }
      tAfter = t; vAfter = v;
    }
    return null;
  }

  // automatic measurements over the visible trace
  function measure(tr, pulse) {
    let vmax = -Infinity, vmin = Infinity;
    for (let i = 0; i < tr.cols; i++) if (tr.ok[i]) { if (tr.mx[i] > vmax) vmax = tr.mx[i]; if (tr.mn[i] < vmin) vmin = tr.mn[i]; }
    if (!(vmax >= vmin)) return null;
    const pp = vmax - vmin, dt = tr.W / tr.cols;
    const r = { vmax, vmin, pp };
    if (pp < 0.02) return r;
    // column state with hysteresis: high if it reaches the upper threshold, low if it stays under the lower one
    const hiT = vmin + pp * 0.6, loT = vmin + pp * 0.4;
    const rises = [], falls = [];
    let st = null;
    for (let i = 0; i < tr.cols; i++) {
      if (!tr.ok[i]) { st = null; continue; }
      const ns = tr.mx[i] >= hiT ? 1 : tr.mx[i] <= loT ? 0 : st;
      if (st === 0 && ns === 1) rises.push(i);
      if (st === 1 && ns === 0) falls.push(i);
      st = ns;
    }
    if (rises.length >= 2) {
      const period = ((rises[rises.length - 1] - rises[0]) / (rises.length - 1)) * dt;
      r.freq = 1 / period;
      let hiSum = 0, n = 0;
      for (const ri of rises) { const fi = falls.find((f) => f > ri); if (fi != null && fi - ri < period / dt) { hiSum += (fi - ri) * dt; n++; } }
      if (n) r.duty = hiSum / n / period;
    }
    // width of the part that matters (injection time, dwell): complete runs past an absolute threshold
    if (pulse) {
      let run = -1, sum = 0, n = 0;
      for (let i = 0; i < tr.cols; i++) {
        const inP = tr.ok[i] && (pulse.above != null ? tr.mid[i] > pulse.above : tr.mid[i] < pulse.below);
        if (inP && run < 0) run = i;
        if (!inP && run >= 0) { const len = (i - run) * dt; if (run > 0 && len >= (pulse.minRun || 0)) { sum += len; n++; } run = -1; }
      }
      if (n) r.pulse = sum / n;
    }
    return r;
  }

  ECU.TSCOPE = { SIGNALS, TIMEBASES, VDIV, Capture, Probe, trace, findTrigger, measure, ROLL_FROM, DIVX, PRETRIG };

  /* ================= browser UI ================= */
  const fmtT = (s) => {
    const a = Math.abs(s) * (1 + 1e-9);
    if (a < 1e-3) return `${(s * 1e6).toFixed(a < 1e-5 ? 1 : 0)} µs`;
    if (a < 1) return `${(s * 1e3).toFixed(a < 1e-2 ? 2 : a < 0.1 ? 1 : 0)} ms`.replace(/\.0+ ms$/, ' ms');
    return `${s.toFixed(2)} s`;
  };
  const fmtV = (v) => { const a = Math.abs(v); if (a < 1e-9) return '0 V'; return a >= 100 ? `${v.toFixed(0)} V` : a >= 10 ? `${v.toFixed(1)} V` : a >= 1 ? `${v.toFixed(2)} V` : `${(v * 1000).toFixed(0)} mV`; };
  const fmtF = (f) => (f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${f.toFixed(f < 10 ? 2 : 1)} Hz`);
  const fmtTB = (ms) => (ms >= 1000 ? `${ms / 1000} s` : ms < 1 ? `${ms * 1000} µs` : `${ms} ms`);
  const COL = { A: '#ffd166', B: '#3fc6ff' };

  const PRESETS = [
    { id: 'sync', name: 'Crank vs cam', A: ['ckp'], B: ['cmp'], tb: 20, trig: 'B' },
    { id: 'inj', name: 'Injector, cylinder 1', A: ['inj', 0], B: ['off'], tb: 1, trig: 'A', only: PET },
    { id: 'coil', name: 'Coils 1 and 3', A: ['coil', 0], B: ['coil', 2], tb: 10, trig: 'A', only: PET },
    { id: 'spark', name: 'Spark close-up', A: ['coil', 0], B: ['off'], tb: 0.5, trig: 'A', only: PET },
    { id: 'knock', name: 'Knock vs cam', A: ['knock'], B: ['cmp'], tb: 10, trig: 'B', only: PET },
    { id: 'o2', name: 'O2 sensors (catalyst)', A: ['o2up'], B: ['o2dn'], tb: 500, trig: 'off', only: PET },
    { id: 'snap', name: 'Throttle snap (MAF + TPS)', A: ['maf'], B: ['tps1'], tb: 200, trig: 'off' },
    { id: 'tps', name: 'Throttle tracks 1 + 2', A: ['tps1'], B: ['tps2'], tb: 200, trig: 'off' },
    { id: 'piezo', name: 'Piezo injector + rail', A: ['inj', 0], B: ['rail'], tb: 2, trig: 'A', only: DSL },
    { id: 'crank', name: 'Cranking battery', A: ['vbat'], B: ['ckp'], tb: 200, trig: 'off' },
  ];

  function TScopeUI(app) {
    this.app = app;
    this.cap = new Capture();
    this.ch = { A: { sig: 'ckp', cyl: 0, range: 'auto' }, B: { sig: 'cmp', cyl: 0, range: 'auto' } };
    this.tb = 20;
    this.trig = { src: 'B', edge: 'rise', level: 2.5, mode: 'auto' };
    this.running = true;
    this.status = 'auto';
    this.cursors = [];
    this.tr = null; this.meas = null;
    this.last = 0;
    this.type = null;
    this.canvas = document.getElementById('tsCanvas');
    this.side = document.getElementById('tsSide');
    this.measEl = document.getElementById('tsMeas');
    this.statusEl = document.getElementById('tsStatus');
    this.side.addEventListener('change', (e) => this.onChange(e));
    this.side.addEventListener('click', (e) => this.onClick(e));
    this.bindCanvas();
    window.addEventListener('ecu:lang', () => { this.build(); this.draw(); });
  }

  TScopeUI.prototype.avail = function (type) {
    return Object.keys(SIGNALS).filter((k) => ECU.appliesTo(SIGNALS[k], type));
  };

  TScopeUI.prototype.onEngine = function (S) {
    this.type = S.type;
    this.cap.reset();
    const av = this.avail(S.type), n = ECU.geom(S.E).n;
    for (const id of ['A', 'B']) {
      const c = this.ch[id];
      if (c.sig !== 'off' && !av.includes(c.sig)) c.sig = id === 'A' ? 'ckp' : 'cmp';
      if (c.cyl >= n) c.cyl = 0;
    }
    if (this.trig.src !== 'off' && this.ch[this.trig.src].sig === 'off') this.trig.src = 'off';
    this.setTrigDefaults();
    this.tr = null; this.meas = null;
    this.build();
  };

  TScopeUI.prototype.setTrigDefaults = function () {
    const src = this.trig.src;
    if (src === 'off') return;
    const d = SIGNALS[this.ch[src].sig];
    if (!d) return;
    const [lv, edge] = this.app.S.E.diesel && d.trD ? d.trD : d.tr;
    this.trig.level = lv; this.trig.edge = edge;
  };

  TScopeUI.prototype.applyPreset = function (p) {
    const set = (id, arr) => { const c = this.ch[id]; c.sig = arr[0]; c.cyl = arr[1] || 0; c.range = 'auto'; c.vd = c.zvd = null; };
    set('A', p.A); set('B', p.B);
    this.tb = p.tb;
    this.trig.src = p.trig;
    this.trig.mode = 'auto';
    this.setTrigDefaults();
    this.running = true;
    this.cursors = [];
    this.tr = null; this.meas = null;
    this.build();
  };

  TScopeUI.prototype.build = function () {
    const S = this.app.S, av = this.avail(S.type), n = ECU.geom(S.E).n;
    const sigOpts = (cur, allowOff) => (allowOff ? `<option value="off"${cur === 'off' ? ' selected' : ''}>${T('Off')}</option>` : '') +
      av.map((k) => `<option value="${k}"${k === cur ? ' selected' : ''}>${T(SIGNALS[k].name)}</option>`).join('');
    const cylOpts = (cur) => Array.from({ length: n }, (_, i) => `<option value="${i}"${i === cur ? ' selected' : ''}>${T('Cylinder {c}', { c: i + 1 })}</option>`).join('');
    const rangeOpts = (cur) => `<option value="auto"${cur === 'auto' ? ' selected' : ''}>${T('Auto')}</option>` +
      VDIV.map((r) => `<option value="${r}"${String(r) === String(cur) ? ' selected' : ''}>${T('{v}/div', { v: fmtV(r) })}</option>`).join('');
    const chRow = (id) => {
      const c = this.ch[id], d = SIGNALS[c.sig];
      return `<div class="ts-ch" data-ch="${id}"><span class="ts-tag" style="--c:${COL[id]}">${id}</span>
        <select data-k="sig" aria-label="${T('Channel {c}', { c: id })}">${sigOpts(c.sig, id === 'B')}</select>
        ${d && d.cyl ? `<select data-k="cyl">${cylOpts(c.cyl)}</select>` : ''}
        ${d ? `<select data-k="range" title="${T('Range')}">${rangeOpts(c.range)}</select>` : ''}</div>`;
    };
    const seg = (k, opts, cur) => `<div class="seg small">${opts.map(([v, l]) => `<button data-${k}="${v}" class="${String(v) === String(cur) ? 'active' : ''}">${l}</button>`).join('')}</div>`;
    const presets = PRESETS.filter((p) => ECU.appliesTo(p, S.type));
    const help = ['A', 'B'].map((id) => {
      const d = SIGNALS[this.ch[id].sig];
      if (!d) return '';
      return `<p><b style="color:${COL[id]}">${id} · ${T(d.name)}</b> ${L10N(S.E.diesel && d.descD ? d.descD : d.desc)}</p>`;
    }).join('');
    this.side.innerHTML = `
      <div class="ts-presets">${presets.map((p) => `<button class="chip" data-preset="${p.id}">${T(p.name)}</button>`).join('')}</div>
      ${chRow('A')}${chRow('B')}
      <div class="ts-row"><span class="lbl">${T('Timebase')}</span>
        <div class="ts-tb"><button class="btn ghost sm" data-tb="-1" aria-label="−">−</button><b class="mono">${T('{v}/div', { v: fmtTB(this.tb) })}</b><button class="btn ghost sm" data-tb="1" aria-label="+">+</button></div></div>
      <div class="ts-row"><span class="lbl">${T('Trigger')}</span>${seg('tsrc', [['A', 'A'], ['B', 'B'], ['off', T('Off')]], this.trig.src)}
        ${seg('tedge', [['rise', '↑ ' + T('Rising')], ['fall', '↓ ' + T('Falling')]], this.trig.edge)}</div>
      <div class="ts-row"><span class="lbl">${T('Level')}</span><input type="number" class="mset" data-k="level" step="any" value="${+this.trig.level.toFixed(3)}"> <span class="lbl">V</span></div>
      <div class="ts-row">${seg('tmode', [['auto', T('Auto')], ['normal', T('Normal')], ['single', T('Single')]], this.trig.mode)}
        <button class="btn sm ${this.running ? '' : 'primary'}" data-run>${this.running ? '⏸ ' + T('Stop') : '▶ ' + T('Run')}</button></div>
      ${this.tb >= ROLL_FROM ? `<p class="hint">${T('Roll mode: at slow timebases the trace scrolls continuously and the trigger is not used.')}</p>` : ''}
      <div class="ts-help">${help}</div>`;
  };

  TScopeUI.prototype.onChange = function (e) {
    const el = e.target, row = el.closest('[data-ch]');
    if (row) {
      const c = this.ch[row.dataset.ch], k = el.dataset.k;
      if (k === 'sig') {
        c.sig = el.value; c.range = 'auto'; c.vd = c.zvd = null;
        if (this.trig.src === row.dataset.ch) { if (c.sig === 'off') this.trig.src = 'off'; this.setTrigDefaults(); }
      } else if (k === 'cyl') c.cyl = +el.value;
      else if (k === 'range') c.range = el.value;
      this.tr = null; this.meas = null;
      this.build();
    } else if (el.dataset.k === 'level') {
      const v = parseFloat(el.value);
      if (Number.isFinite(v)) this.trig.level = v;
    }
  };

  TScopeUI.prototype.onClick = function (e) {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.preset) { const p = PRESETS.find((x) => x.id === d.preset); if (p) this.applyPreset(p); return; }
    if (d.tb) { const i = clamp(TIMEBASES.indexOf(this.tb) + +d.tb, 0, TIMEBASES.length - 1); this.tb = TIMEBASES[i]; this.cursors = []; this.tr = null; this.meas = null; }
    else if (d.tsrc) { if (d.tsrc !== 'off' && this.ch[d.tsrc].sig === 'off') return; this.trig.src = d.tsrc; this.setTrigDefaults(); }
    else if (d.tedge) this.trig.edge = d.tedge;
    else if (d.tmode) { this.trig.mode = d.tmode; this.running = true; }
    else if (d.run != null) this.running = !this.running;
    else return;
    this.build();
  };

  // click places cursor 1, then 2; later clicks / drags move the nearest one; double-click clears
  TScopeUI.prototype.bindCanvas = function () {
    const cv = this.canvas;
    let drag = -1;
    const fracAt = (e) => { const r = cv.getBoundingClientRect(); const g = this.geo; return g ? clamp((e.clientX - r.left - g.x0) / g.pw, 0, 1) : null; };
    cv.addEventListener('pointerdown', (e) => {
      const f = fracAt(e);
      if (f == null || !this.tr) return;
      if (this.cursors.length < 2) { this.cursors.push(f); drag = this.cursors.length - 1; }
      else { drag = Math.abs(this.cursors[0] - f) < Math.abs(this.cursors[1] - f) ? 0 : 1; this.cursors[drag] = f; }
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* not capturable (synthetic event) */ }
      this.draw();
    });
    cv.addEventListener('pointermove', (e) => { if (drag < 0) return; const f = fracAt(e); if (f != null) { this.cursors[drag] = f; this.draw(); } });
    const end = () => { drag = -1; };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('dblclick', () => { this.cursors = []; this.draw(); });
  };

  // called every frame (throttled to ~30 fps)
  TScopeUI.prototype.render = function (S) {
    if (this.type !== S.type) this.onEngine(S);
    const now = performance.now();
    if (now - this.last < 33) return;
    this.last = now;
    if (!this.canvas.clientWidth) return;
    if (this.running) this.acquire(S);
    this.draw();
  };

  TScopeUI.prototype.acquire = function () {
    const cap = this.cap, [tStart, tNow] = cap.span();
    if (tNow - tStart < 0.02) { this.status = 'wait'; return; }
    const W = (this.tb / 1000) * DIVX;
    const cols = Math.max(100, Math.min(900, Math.round(this.geoW || 600)));
    let t0;
    if (this.tb >= ROLL_FROM || this.trig.src === 'off') { t0 = tNow - W; this.status = this.tb >= ROLL_FROM ? 'roll' : 'free'; }
    else {
      const src = this.ch[this.trig.src];
      const tHi = tNow - W * (1 - PRETRIG), tLo = Math.max(tStart + W * PRETRIG, tHi - Math.max(W * 3, 0.3));
      const tt = tHi > tLo ? findTrigger(cap, src.sig, src.cyl, this.trig.level, this.trig.edge, tLo, tHi, W / 1500) : null;
      if (tt != null) {
        t0 = tt - W * PRETRIG; this.status = 'trig';
        if (this.trig.mode === 'single') { this.running = false; this.build(); }
      } else if (this.trig.mode === 'auto') { t0 = tNow - W; this.status = 'auto'; }
      else { this.status = 'wait'; return; } // normal / single: keep the last trace until a trigger arrives
    }
    const mk = (id, n) => (this.ch[id].sig === 'off' ? null : trace(cap, this.ch[id].sig, this.ch[id].cyl, t0, W, n));
    this.tr = { A: mk('A', cols), B: mk('B', cols), t0, W, trigAt: this.status === 'trig' ? t0 + W * PRETRIG : null, roll: this.status === 'roll' || this.status === 'free' };
    // measurements need finer sampling than the screen (crank teeth alias at screen resolution)
    const now = performance.now();
    if (now - (this.measT || 0) > 150) {
      this.measT = now;
      const S = this.app.S;
      this.meas = {};
      for (const id of ['A', 'B']) {
        const t = mk(id, 3000);
        const d = t && SIGNALS[t.sig];
        this.meas[id] = t ? measure(t, d.pulse ? d.pulse(S.E.diesel) : null) : null;
      }
    }
  };

  // vertical scale in 1-2-5 volts per division: fixed, or auto with hysteresis so it doesn't hunt.
  // Unipolar signals sit one division above the bottom, bipolar ones are centred on 0 V.
  TScopeUI.prototype.scaleFor = function (id, tr, divs) {
    const c = this.ch[id], d = SIGNALS[c.sig];
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < tr.cols; i++) if (tr.ok[i]) { lo = Math.min(lo, tr.mn[i]); hi = Math.max(hi, tr.mx[i]); }
    if (!(hi >= lo)) { lo = 0; hi = 1; }
    if (d.zoom && c.range === 'auto') {
      // zoomed DC window around the data (battery voltage)
      const span = Math.max(0.3, hi - lo) * 1.3;
      const fits = c.zvd && c.zlo <= lo && c.zlo + c.zvd * divs >= hi && c.zvd * divs <= span * 4;
      if (!fits) {
        const vd = VDIV.find((v) => v * divs >= span) || VDIV[VDIV.length - 1];
        c.zvd = vd; c.zlo = Math.round(((lo + hi) / 2 - (vd * divs) / 2) / vd) * vd;
      }
      return { lo: c.zlo, hi: c.zlo + c.zvd * divs, vdiv: c.zvd };
    }
    let vd;
    if (c.range === 'auto') {
      const need = d.bip ? Math.max(Math.abs(lo), Math.abs(hi)) / (divs / 2) : Math.max(hi, 0) / (divs - 1);
      const want = VDIV.find((v) => v * 0.98 >= need) || VDIV[VDIV.length - 1];
      if (!c.vd || want > c.vd) { c.vd = want; c.shrink = 0; }
      else if (want < c.vd) { c.shrink = (c.shrink || 0) + 1; if (c.shrink > 20) { c.vd = want; c.shrink = 0; } }
      else c.shrink = 0;
      vd = c.vd;
    } else vd = +c.range;
    return d.bip ? { lo: (-vd * divs) / 2, hi: (vd * divs) / 2, vdiv: vd } : { lo: -vd, hi: vd * (divs - 1), vdiv: vd };
  };

  TScopeUI.prototype.draw = function () {
    const cv = this.canvas, w = cv.clientWidth;
    if (!w) return;
    const narrow = w < 560;
    const H = narrow ? 260 : 360;
    const { ctx } = ECU.draw.fit(cv, H);
    const x0 = narrow ? 34 : 50, x1 = w - (narrow ? 34 : 50), y0 = 10, y1 = H - 22, pw = x1 - x0, ph = y1 - y0;
    this.geo = { x0, pw };
    this.geoW = pw;
    ctx.clearRect(0, 0, w, H);
    ctx.fillStyle = '#070b10';
    ctx.fillRect(x0, y0, pw, ph);
    // graticule: 10 × 8 divisions with minor ticks
    ctx.strokeStyle = '#1a2533'; ctx.lineWidth = 1;
    for (let i = 0; i <= DIVX; i++) { const x = Math.round(x0 + (pw * i) / DIVX) + 0.5; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); }
    for (let j = 0; j <= 8; j++) { const y = Math.round(y0 + (ph * j) / 8) + 0.5; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke(); }
    ctx.strokeStyle = '#26364a';
    const xm = Math.round(x0 + pw / 2) + 0.5, ym = Math.round(y0 + ph / 2) + 0.5;
    for (let i = 0; i <= DIVX * 5; i++) { const x = x0 + (pw * i) / (DIVX * 5); ctx.beginPath(); ctx.moveTo(x, ym - 3); ctx.lineTo(x, ym + 3); ctx.stroke(); }
    for (let j = 0; j <= 40; j++) { const y = y0 + (ph * j) / 40; ctx.beginPath(); ctx.moveTo(xm - 3, y); ctx.lineTo(xm + 3, y); ctx.stroke(); }

    const tr = this.tr;
    ctx.font = `600 ${narrow ? 8.5 : 9.5}px "JetBrains Mono", monospace`;
    if (!tr) {
      ctx.fillStyle = '#5d6f86'; ctx.textAlign = 'center';
      ctx.fillText(T('Waiting for data — turn the ignition on.'), x0 + pw / 2, y0 + ph / 2 - 8);
      ctx.textAlign = 'left';
      this.renderMeas(null);
      this.renderStatus();
      return;
    }
    const split = !!(tr.A && tr.B);
    const panes = { A: split ? [y0, y0 + ph / 2] : [y0, y1], B: split ? [y0 + ph / 2, y1] : [y0, y1] };
    this.scales = {};
    for (const id of ['A', 'B']) {
      const t = tr[id];
      if (!t) continue;
      const divs = split ? 4 : 8;
      const sc = this.scaleFor(id, t, divs), [pa, pb] = panes[id];
      const yOf = (v) => pb - ((v - sc.lo) / (sc.hi - sc.lo)) * (pb - pa);
      this.scales[id] = { ...sc, yOf, pa, pb };
      // axis labels (A left, B right), one per division
      ctx.fillStyle = COL[id];
      ctx.textAlign = id === 'A' ? 'right' : 'left';
      for (let j = 0; j <= divs; j++) {
        if (split && id === 'B' && j === divs) continue; // shares the line with A's bottom label
        const v = sc.lo + sc.vdiv * j;
        const y = pb - ((pb - pa) * j) / divs;
        ctx.fillText(fmtV(v).replace(' ', ''), id === 'A' ? x0 - 4 : x1 + 4, clamp(y + 3, y0 + 8, y1));
      }
      // zero line
      if (sc.lo < 0 && sc.hi > 0) { ctx.strokeStyle = COL[id] + '44'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(x0, yOf(0)); ctx.lineTo(x1, yOf(0)); ctx.stroke(); ctx.setLineDash([]); }
      // envelope: one vertical stroke per column, joined to its neighbours so edges stay continuous
      ctx.save();
      ctx.beginPath(); ctx.rect(x0, pa, pw, pb - pa); ctx.clip();
      ctx.strokeStyle = COL[id]; ctx.lineWidth = 1.3;
      ctx.shadowColor = COL[id]; ctx.shadowBlur = 5;
      ctx.beginPath();
      const cw = pw / t.cols;
      let prev = -1;
      for (let i = 0; i < t.cols; i++) {
        if (!t.ok[i]) { prev = -1; continue; }
        let lo = t.mn[i], hi = t.mx[i];
        if (prev >= 0) { lo = Math.min(lo, t.mx[prev]); hi = Math.max(hi, t.mn[prev]); }
        const x = x0 + (i + 0.5) * cw;
        ctx.moveTo(x, yOf(hi) - 0.5); ctx.lineTo(x, yOf(lo) + 0.5);
        prev = i;
      }
      ctx.stroke();
      ctx.restore();
      if (split && id === 'A') { ctx.strokeStyle = '#2c3e55'; ctx.beginPath(); ctx.moveTo(x0, pb + 0.5); ctx.lineTo(x1, pb + 0.5); ctx.stroke(); }
    }
    ctx.textAlign = 'left';

    // trigger point + level
    const xOfT = (t) => x0 + ((t - tr.t0) / tr.W) * pw;
    if (tr.trigAt != null) {
      const x = xOfT(tr.trigAt);
      ctx.fillStyle = '#ff9f43';
      ctx.beginPath(); ctx.moveTo(x - 5, y0); ctx.lineTo(x + 5, y0); ctx.lineTo(x, y0 + 7); ctx.closePath(); ctx.fill();
      const sc = this.scales[this.trig.src];
      if (sc) {
        const y = sc.yOf(this.trig.level);
        if (y > sc.pa && y < sc.pb) {
          const xe = this.trig.src === 'A' ? x0 : x1, dir = this.trig.src === 'A' ? 1 : -1;
          ctx.beginPath(); ctx.moveTo(xe, y - 4); ctx.lineTo(xe + 7 * dir, y); ctx.lineTo(xe, y + 4); ctx.closePath(); ctx.fill();
        }
      }
    }
    // time axis: relative to the trigger (or to "now" when rolling)
    ctx.fillStyle = '#7f93ab'; ctx.textAlign = 'center';
    const ref = tr.trigAt != null ? tr.trigAt : tr.t0 + tr.W;
    for (let i = 0; i <= DIVX; i += narrow ? 2 : 1) {
      const t = tr.t0 + (tr.W * i) / DIVX - ref;
      ctx.fillText(Math.abs(t) < 1e-9 ? '0' : fmtT(t).replace(' ', ''), x0 + (pw * i) / DIVX, H - 7);
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9fb1c7';
    ctx.fillText(T('{v}/div', { v: fmtTB(this.tb) }), x0 + 6, y0 + 12);

    // cursors
    const cur = this.cursors.map((f) => tr.t0 + f * tr.W);
    cur.forEach((t, k) => {
      const x = xOfT(t);
      ctx.strokeStyle = '#e8eef6'; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#e8eef6'; ctx.fillRect(x - 6, y1 - 13, 12, 13);
      ctx.fillStyle = '#070b10'; ctx.textAlign = 'center'; ctx.fillText(String(k + 1), x, y1 - 3); ctx.textAlign = 'left';
    });
    this.renderMeas(tr, cur);
    this.renderStatus();
  };

  TScopeUI.prototype.valueAtCursor = function (t, f) {
    const i = clamp(Math.floor(f * t.cols), 0, t.cols - 1);
    return t.ok[i] ? t.mid[i] : null;
  };

  TScopeUI.prototype.renderMeas = function (tr, cur) {
    if (!tr) { this.measEl.innerHTML = ''; return; }
    const S = this.app.S;
    const cells = ['A', 'B'].map((id) => {
      const t = tr[id];
      if (!t) return '';
      const d = SIGNALS[t.sig];
      const pulse = d.pulse ? d.pulse(S.E.diesel) : null;
      const m = (this.meas && this.meas[id]) || measure(t, pulse);
      if (!m) return '';
      const rows = [[T('Max'), fmtV(m.vmax)], [T('Min'), fmtV(m.vmin)], [T('Peak-peak'), fmtV(m.pp)]];
      if (m.freq) { rows.push([T('Frequency'), fmtF(m.freq)]); if (d.rpm) rows.push([T('Engine speed'), `≈ ${Math.round(d.rpm(m.freq))} rpm`]); }
      if (m.duty != null && !pulse) rows.push([T('Duty (high)'), `${(m.duty * 100).toFixed(0)} %`]);
      if (pulse && m.pulse) rows.push([T(pulse.k), fmtT(m.pulse)]);
      if (cur && cur.length) cur.forEach((_, k) => { const v = this.valueAtCursor(t, this.cursors[k]); if (v != null) rows.push([T('at cursor {n}', { n: k + 1 }), fmtV(v)]); });
      const name = T(d.name) + (d.cyl ? ' ' + (t.cyl + 1) : '');
      return `<div class="ts-m" style="--c:${COL[id]}"><b>${id} · ${name}</b>${rows.map(([k, v]) => `<span>${k}</span><span class="mono">${v}</span>`).join('')}</div>`;
    }).join('');
    let cursorBox = `<div class="ts-m"><b>${T('Cursors')}</b>`;
    if (cur && cur.length === 2) {
      const dt = Math.abs(cur[1] - cur[0]);
      cursorBox += `<span>Δt</span><span class="mono">${fmtT(dt)}</span>` + (dt > 0 ? `<span>1/Δt</span><span class="mono">${fmtF(1 / dt)}</span>` : '');
    } else cursorBox += `<span class="ts-hint">${T('Click the screen to place two cursors; double-click clears them.')}</span>`;
    cursorBox += '</div>';
    const html = cells + cursorBox;
    if (html !== this.lastMeas) { this.measEl.innerHTML = html; this.lastMeas = html; }
  };

  TScopeUI.prototype.renderStatus = function () {
    const st = !this.running ? ['STOP', 'bad'] : { trig: ['TRIG', 'ok'], auto: ['AUTO', 'warn'], wait: ['WAIT', 'warn'], roll: ['ROLL', 'ok'], free: ['FREE RUN', 'warn'] }[this.status] || ['', ''];
    const html = `<span class="ts-st ${st[1]}">${T(st[0])}</span> <span>${T('reconstructed from crank angle · physics 240 Hz')}</span>`;
    if (html !== this.lastStatus) { this.statusEl.innerHTML = html; this.lastStatus = html; }
  };

  ECU.TScopeUI = TScopeUI;
})();
