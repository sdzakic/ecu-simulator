/* Engine sound, synthesised live with Web Audio from the simulation state.
   ECU.soundParams(S) is a pure mapping (tested headlessly); buildSoundGraph() works on any
   BaseAudioContext (real or offline); SoundUI handles the toggle, volume and one-shot effects. */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const ECU = (root.ECU = root.ECU || {});
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  // simulation state → synth parameters (gains 0..~0.5, frequencies in Hz)
  function soundParams(S) {
    const rpm = S.rpm;
    const turning = rpm > 30;
    const burning = turning && S.torqueInd > 1 && !S.fuelCutAll;
    const comb = burning ? clamp(S.torqueInd / (S.E.turbo ? 340 : 180), 0.05, 1.3) : 0;
    const thr = clamp(S.throttle / 100, 0, 1);
    const dead = S.injCut.filter(Boolean).length + (S.faults.misfire3 && !S.injCut[2] ? 1 : 0);
    const D = S.E.diesel;
    return {
      // diesel clatter: sharp pressure rise at each combustion — louder cold / advanced, softened by the pilot
      clatter: D && burning ? clamp((0.07 + 0.1 * clamp((50 - S.ect) / 60, 0, 1) + (S.soi - 4) * 0.01 - (S.pilot ? 0.035 : 0)) * (1 - 0.45 * clamp(S.qMg / 60, 0, 1)), 0.02, 0.25) : 0,
      fire: rpm / 30, // firing frequency of a 4-cylinder: 2 combustions per revolution
      engine: turning ? (burning ? 0.1 + 0.28 * comb + 0.08 * (rpm / 7000) : 0.05 + 0.04 * (rpm / 7000)) : 0,
      cutoff: D ? 120 + 900 * clamp(S.qMg / 60, 0, 1) + rpm * 0.12 : 160 + 1500 * thr * (burning ? 1 : 0.4) + rpm * 0.22,
      rumble: burning ? 0.08 + 0.25 * comb : 0,
      intake: turning ? clamp(S.airGs / 160, 0, 1) * (D ? 0.06 : 0.05 + 0.15 * thr) : 0,
      intakeFreq: 350 + S.airGs * 7,
      misfire: burning && dead > 0 ? clamp(0.35 * dead, 0, 0.8) : 0,
      cycle: rpm / 120, // one full 720° cycle
      turbo: S.E.turbo && turning ? clamp((S.turbo - 35) / 140, 0, 1) * 0.07 : 0,
      turboFreq: 900 + S.turbo * 30,
      starter: S.cranking && S.ecuOn ? 0.16 : 0,
      starterFreq: 60 + rpm * 0.35,
      pump: S.fuelPump && rpm < 50 ? 0.05 : 0,
      fan: S.fan && S.ecuOn ? 0.025 : 0,
    };
  }
  ECU.soundParams = soundParams;

  function noiseBuffer(ctx, sec) {
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // the synth: returns { set(params, when), knock(when), bov(when), out }
  function buildSoundGraph(ctx, dest) {
    const out = ctx.createGain();
    out.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    out.connect(comp); comp.connect(dest);
    const noise = noiseBuffer(ctx, 2);
    const src = (loop = true) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = loop; return s; };
    const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };

    // engine note: firing-frequency sawtooth + half-order triangle → soft clip → load-dependent low-pass
    const eng = osc('sawtooth', 27), sub = osc('triangle', 13.5);
    const subG = gain(0.6);
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(2.2 * x); }
    shaper.curve = curve;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3; lp.frequency.value = 400;
    const engG = gain();
    eng.connect(shaper); sub.connect(subG); subG.connect(shaper); shaper.connect(lp); lp.connect(engG); engG.connect(out);
    // misfire: a square LFO at cycle frequency modulates the engine gain (one weak beat per cycle)
    const lfo = osc('square', 6.7), lfoG = gain(0);
    lfo.connect(lfoG); lfoG.connect(engG.gain);

    // exhaust rumble (low-passed noise) and intake roar (band-passed noise)
    const rum = src(), rumLp = ctx.createBiquadFilter(), rumG = gain();
    rumLp.type = 'lowpass'; rumLp.frequency.value = 140;
    rum.connect(rumLp); rumLp.connect(rumG); rumG.connect(out);
    const ink = src(), inkBp = ctx.createBiquadFilter(), inkG = gain();
    inkBp.type = 'bandpass'; inkBp.Q.value = 0.9; inkBp.frequency.value = 600;
    ink.connect(inkBp); inkBp.connect(inkG); inkG.connect(out);

    // turbo whistle, starter whine, fuel pump buzz, fan hiss
    const tur = osc('sine', 1500), turG = gain(); tur.connect(turG); turG.connect(out);
    const st = osc('sawtooth', 60), stLp = ctx.createBiquadFilter(), stG = gain();
    stLp.type = 'lowpass'; stLp.frequency.value = 900;
    st.connect(stLp); stLp.connect(stG); stG.connect(out);
    const pump = osc('square', 180), pumpLp = ctx.createBiquadFilter(), pumpG = gain();
    pumpLp.type = 'lowpass'; pumpLp.frequency.value = 500;
    pump.connect(pumpLp); pumpLp.connect(pumpG); pumpG.connect(out);
    const fan = src(), fanBp = ctx.createBiquadFilter(), fanG = gain();
    fanBp.type = 'bandpass'; fanBp.frequency.value = 1800; fanBp.Q.value = 0.5;
    fan.connect(fanBp); fanBp.connect(fanG); fanG.connect(out);

    // diesel clatter: band-passed noise gated by a narrow pulse train at the firing frequency
    const clat = src(), clatBp = ctx.createBiquadFilter(), clatG = gain(0);
    clatBp.type = 'bandpass'; clatBp.frequency.value = 2600; clatBp.Q.value = 1.2;
    clat.connect(clatBp); clatBp.connect(clatG); clatG.connect(out);
    const pulse = osc('sawtooth', 27), gate = ctx.createWaveShaper(), gateG = gain(0);
    const gc = new Float32Array(256);
    for (let i = 0; i < 256; i++) gc[i] = (i / 255) * 2 - 1 > 0.7 ? 1 : 0; // ~15 % duty pulses
    gate.curve = gc;
    pulse.connect(gate); gate.connect(gateG); gateG.connect(clatG.gain);
    [eng, sub, lfo, rum, ink, tur, st, pump, fan, clat, pulse].forEach((n) => n.start());

    const TC = 0.04; // parameter smoothing time constant
    const to = (param, v, t) => param.setTargetAtTime(v, t, TC);
    function set(p, t = ctx.currentTime) {
      to(eng.frequency, Math.max(1, p.fire), t);
      to(sub.frequency, Math.max(0.5, p.fire / 2), t);
      to(engG.gain, p.engine, t);
      to(lp.frequency, clamp(p.cutoff, 80, 8000), t);
      to(lfo.frequency, Math.max(0.3, p.cycle), t);
      to(lfoG.gain, -p.engine * p.misfire, t);
      to(rumG.gain, p.rumble, t);
      to(inkG.gain, p.intake, t);
      to(inkBp.frequency, clamp(p.intakeFreq, 100, 6000), t);
      to(turG.gain, p.turbo, t);
      to(tur.frequency, p.turboFreq, t);
      to(stG.gain, p.starter, t);
      to(st.frequency, p.starterFreq, t);
      to(pumpG.gain, p.pump, t);
      to(fanG.gain, p.fan, t);
      to(pulse.frequency, Math.max(1, p.fire), t);
      to(gateG.gain, p.clatter || 0, t);
    }
    // one-shots
    function burst(when, { type, freq, q, peak, decay }) {
      const s = src(false), f = ctx.createBiquadFilter(), g = gain(0);
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      s.connect(f); f.connect(g); g.connect(out);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(peak, when + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
      s.start(when); s.stop(when + decay + 0.05);
    }
    return {
      out, set,
      knock: (when = ctx.currentTime) => burst(when, { type: 'bandpass', freq: 6500, q: 14, peak: 0.9, decay: 0.07 }),
      bov: (when = ctx.currentTime) => burst(when, { type: 'highpass', freq: 1400, q: 0.7, peak: 0.35, decay: 0.55 }),
    };
  }
  ECU.buildSoundGraph = buildSoundGraph;

  // ---------------- browser UI ----------------
  function SoundUI(app) {
    this.app = app;
    this.ctx = null;
    this.graph = null;
    this.on = false;
    this.vol = 0.5;
    this.lastKnock = 0;
    this.lastBov = 0;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('ecu-sound') || '{}'); } catch (e) { /* ignore */ }
    if (typeof saved.vol === 'number') this.vol = saved.vol;
    this.btn = document.getElementById('soundBtn');
    this.volEl = document.getElementById('soundVol');
    this.volEl.value = Math.round(this.vol * 100);
    this.btn.addEventListener('click', () => this.toggle());
    this.volEl.addEventListener('input', () => { this.vol = this.volEl.value / 100; this.applyVol(); this.save(); });
    window.addEventListener('ecu:lang', () => this.label());
    // browsers only allow audio after a user gesture: re-enable on the first interaction if it was on
    if (saved.on) {
      const resume = () => { this.enable(); window.removeEventListener('pointerdown', resume, true); window.removeEventListener('keydown', resume, true); };
      window.addEventListener('pointerdown', resume, true);
      window.addEventListener('keydown', resume, true);
    }
    this.label();
  }
  SoundUI.prototype.save = function () { try { localStorage.setItem('ecu-sound', JSON.stringify({ on: this.on, vol: this.vol })); } catch (e) { /* ignore */ } };
  SoundUI.prototype.label = function () {
    this.btn.classList.toggle('active', this.on);
    this.btn.querySelector('span').textContent = this.on ? '🔊' : '🔇';
    this.btn.title = ECU.t(this.on ? 'Sound on — click to mute (M)' : 'Engine sound (M)');
    document.body.classList.toggle('sound-on', this.on);
  };
  SoundUI.prototype.applyVol = function () {
    if (this.graph) this.graph.out.gain.setTargetAtTime(this.on ? this.vol * 0.9 : 0, this.ctx.currentTime, 0.05);
  };
  SoundUI.prototype.enable = function () {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) { this.ctx = new AC(); this.graph = buildSoundGraph(this.ctx, this.ctx.destination); }
    this.ctx.resume();
    this.on = true;
    this.applyVol();
    this.label();
    this.save();
  };
  SoundUI.prototype.toggle = function () {
    if (this.on) { this.on = false; this.applyVol(); this.label(); this.save(); }
    else this.enable();
  };
  // called every frame
  SoundUI.prototype.update = function (S) {
    if (!this.on || !this.graph) return;
    const t = this.ctx.currentTime;
    this.graph.set(soundParams(S), t);
    if (S.knockCount > this.lastKnock && S.running) this.graph.knock(t);
    this.lastKnock = S.knockCount;
    if (S.bovT > 0 && this.lastBov <= 0) this.graph.bov(t);
    this.lastBov = S.bovT;
  };

  ECU.SoundUI = SoundUI;
})();
