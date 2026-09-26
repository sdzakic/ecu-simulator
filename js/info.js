/* Sensor, actuator and fault definitions + educational text.
   Pure data — no DOM access. */
(function () {
  const ECU = (window.ECU = window.ECU || {});

  // group ids are used for the sensor panel sections
  ECU.SENSOR_GROUPS = [
    { id: 'position', name: 'Engine position & speed' },
    { id: 'air', name: 'Air metering' },
    { id: 'turbo', name: 'Turbo / charge air' },
    { id: 'exhaust', name: 'Combustion & exhaust' },
    { id: 'temp', name: 'Temperatures & lubrication' },
    { id: 'fuel', name: 'Fuel system' },
    { id: 'driver', name: 'Driver & chassis' },
  ];

  ECU.SENSORS = [
    {
      id: 'ckp', group: 'position', abbr: 'CKP', name: 'Crankshaft position', unit: 'rpm', tech: 'Variable reluctance or Hall effect',
      what: 'The exact rotational position and speed of the crankshaft. It is the single most important input — no CKP signal means no spark and no injection.',
      how: 'A 60-2 toothed "trigger wheel" is bolted to the crankshaft. The sensor sees each tooth pass by. A VR (inductive) sensor generates an AC voltage whose amplitude rises with speed; a Hall sensor outputs a clean 0/5 V square wave. Two teeth are missing — that long gap is a reference mark so the ECU knows where TDC is.',
      ecu: 'Counts teeth to know the crank angle to within ~6° (interpolated to <0.5°). Tooth-to-tooth timing gives RPM. Tiny speed changes during each power stroke are used to detect misfires. Every injection and spark event is scheduled in crank degrees.',
      typical: 'Cranking 200–300 rpm · Idle 750–900 rpm · Signal: 60 pulses/rev minus 2',
      fail: 'Engine will not start or stalls instantly. Tachometer drops to zero. DTC P0335.',
    },
    {
      id: 'cmp', group: 'position', abbr: 'CMP', name: 'Camshaft position', unit: '', tech: 'Hall effect',
      what: 'Which of the two crank revolutions the engine is in. The cam turns once per two crank turns, so it separates the compression stroke from the exhaust stroke.',
      how: 'A Hall sensor reads a tab on the intake camshaft. It produces one pulse every 720° of crank rotation. Comparing the pulse to the CKP gap also measures how far the variable valve timing (VVT) has shifted the cam.',
      ecu: 'With CKP alone the ECU knows cylinders 1 & 4 are at TDC — but not which one is firing. Once the cam pulse arrives it switches to full sequential injection and individual coil-on-plug spark. It also closes the VVT control loop.',
      typical: '1 pulse per 720° · Cam phase 0–40° advance',
      fail: 'Engine still runs in "batch fire / wasted spark" fallback — injectors fire in pairs, both coils of a pair spark. Slightly worse economy. DTC P0340.',
    },
    {
      id: 'maf', group: 'air', abbr: 'MAF', name: 'Mass air flow', unit: 'g/s', tech: 'Hot-film anemometer',
      what: 'The mass of air entering the engine every second — the most direct measure of engine load.',
      how: 'A heated film sits in the intake stream. Air flowing past cools it; the electronics increase current to keep it at a fixed temperature above intake air. That current is converted to a voltage or frequency proportional to air mass (not volume, so altitude and temperature are automatically accounted for).',
      ecu: 'Air per cylinder = MAF ÷ (RPM ÷ 30). That number ("load") selects fuel quantity and spark advance from the calibration maps.',
      typical: 'Idle 2–4 g/s · Cruise 10–25 g/s · 2.0 NA at redline ≈ 120 g/s',
      fail: 'ECU falls back to speed-density (MAP + RPM + temperature). DTC P0101/P0102.',
    },
    {
      id: 'map', group: 'air', abbr: 'MAP', name: 'Manifold absolute pressure', unit: 'kPa', tech: 'Piezo-resistive silicon strain gauge',
      what: 'Absolute pressure inside the intake manifold, after the throttle. Low (vacuum) at idle, near atmospheric at wide-open throttle, above atmospheric under boost.',
      how: 'A silicon diaphragm with a vacuum reference on one side flexes with pressure. Strain gauges printed on it form a Wheatstone bridge; an amplifier outputs 0.5–4.5 V.',
      ecu: 'Used for speed-density air calculation (backup to MAF, or primary on many turbo cars), barometric reading at key-on, and for checking MAF plausibility.',
      typical: 'Idle 28–40 kPa · WOT NA ≈ 98 kPa · Boost 150–250 kPa',
      fail: 'ECU uses MAF + throttle angle. DTC P0107/P0108.',
    },
    {
      id: 'tps', group: 'air', abbr: 'TPS', name: 'Throttle position (dual track)', unit: '%', tech: 'Hall / potentiometer, redundant tracks',
      what: 'The actual opening of the electronic throttle plate.',
      how: 'Two independent sensors with opposite slopes (one rises 0.5→4.5 V, the other falls). Both must agree at all times — this is a safety requirement for drive-by-wire.',
      ecu: 'Closed-loop control of the throttle motor, idle detection, acceleration enrichment, and plausibility checks against the pedal sensor.',
      typical: 'Idle 3–8 % (idle air is metered by the throttle itself) · WOT 100 %',
      fail: 'Tracks disagree → throttle motor disabled, spring holds ~7 % opening ("limp home"), EPC lamp. DTC P0121.',
    },
    {
      id: 'app', group: 'driver', abbr: 'APP', name: 'Accelerator pedal position', unit: '%', tech: 'Dual-track Hall',
      what: 'How far the driver presses the pedal — this is a torque request, not a direct throttle command.',
      how: 'Two Hall sensors in the pedal assembly, second track at half voltage, cross-checked continuously.',
      ecu: 'The ECU converts pedal % into a throttle angle (progressive map), adds idle air, and limits it for protection (overboost, limp mode, traction control).',
      typical: '0–100 %',
      fail: 'Limp mode, engine at raised idle only.',
    },
    {
      id: 'baro', group: 'air', abbr: 'BARO', name: 'Barometric pressure', unit: 'kPa', tech: 'Silicon strain gauge (inside ECU)',
      what: 'Ambient air pressure (altitude and weather).',
      how: 'Usually a pressure sensor soldered on the ECU board; also re-learned from MAP at key-on before cranking.',
      ecu: 'Corrects fuel and spark for altitude, calculates boost (= MAP − baro), and scales the turbo speed limit.',
      typical: 'Sea level 101.3 kPa · 2000 m ≈ 80 kPa',
      fail: 'Default 101.3 kPa used.',
    },
    {
      id: 'o2up', group: 'exhaust', only: ['na', 'turbo'], abbr: 'O2 S1', name: 'Upstream oxygen sensor (B1S1)', unit: 'V', tech: 'Zirconia (narrowband), heated',
      what: 'Whether the exhaust is richer or leaner than stoichiometric (14.7 : 1 air-fuel ratio, λ = 1).',
      how: 'A zirconia ceramic thimble conducts oxygen ions when hot (>350 °C). The difference in oxygen between exhaust and outside air produces a voltage: ~0.9 V rich, ~0.1 V lean, with a steep switch right at λ = 1. A built-in heater gets it to temperature within seconds of starting.',
      ecu: 'The heart of CLOSED-LOOP fuel control. When the voltage reads rich the ECU ramps fuel down; when it reads lean it ramps fuel up. This makes the signal oscillate 1–2 times per second around λ = 1 — exactly what the catalyst needs.',
      typical: 'Switching 0.1 ↔ 0.9 V at 0.5–2 Hz in closed loop',
      fail: 'No switching → open-loop fuelling, MIL. DTC P0134.',
    },
    {
      id: 'o2dn', group: 'exhaust', only: ['na', 'turbo'], abbr: 'O2 S2', name: 'Downstream oxygen sensor (B1S2)', unit: 'V', tech: 'Zirconia (narrowband), heated',
      what: 'Oxygen content after the catalytic converter.',
      how: 'Same sensor type as upstream. A healthy catalyst stores and releases oxygen, smoothing out the upstream oscillation, so this sensor reads a steady ~0.6–0.7 V.',
      ecu: 'Catalyst efficiency monitor: if the downstream signal starts copying the upstream switching, the catalyst has lost its oxygen storage. Also used for a slow "outer" trim of the upstream loop.',
      typical: 'Steady 0.55–0.75 V',
      fail: 'DTC P0420 (catalyst efficiency below threshold).',
    },
    {
      id: 'knock', group: 'exhaust', only: ['na', 'turbo'], abbr: 'KS', name: 'Knock sensor', unit: 'mV', tech: 'Piezoelectric accelerometer',
      what: 'Engine block vibration in the 5–15 kHz band — the "ping" of detonation, when unburnt mixture explodes spontaneously instead of burning smoothly.',
      how: 'A piezo crystal bolted to the block produces a voltage when shaken. The ECU only listens during a "knock window" (roughly 10–60° after each cylinder\'s TDC) and filters for the knock frequency, so it knows which cylinder knocked.',
      ecu: 'Individual-cylinder knock control: retards that cylinder\'s spark by 1.5–3° immediately, then creeps it back 0.5–1°/s. This lets the base map run close to the knock limit for efficiency.',
      typical: 'Background noise grows with RPM; knock shows as a sharp burst',
      fail: 'ECU applies a safe, heavily retarded spark map. DTC P0325.',
    },
    {
      id: 'egt', group: 'exhaust', abbr: 'EGT', name: 'Exhaust gas temperature', unit: '°C', tech: 'Thermocouple / PTC',
      what: 'Temperature of the exhaust leaving the cylinders (before the turbine on turbo engines).',
      how: 'A thermocouple (two dissimilar metals) produces a few millivolts proportional to temperature.',
      ecu: 'Component protection: above ~900 °C the ECU enriches the mixture (extra fuel cools the charge) to save the turbine and catalyst. Lean mixtures and retarded spark both raise EGT.',
      typical: 'Idle 300–450 °C · WOT 800–950 °C',
      fail: 'Modelled protection only.',
    },
    {
      id: 'ect', group: 'temp', abbr: 'ECT', name: 'Engine coolant temperature', unit: '°C', tech: 'NTC thermistor',
      what: 'Engine temperature, measured in the coolant.',
      how: 'An NTC thermistor: resistance falls as temperature rises (~2.5 kΩ at 20 °C, ~200 Ω at 90 °C). It forms a voltage divider with a resistor in the ECU, so voltage falls as the engine warms.',
      ecu: 'Cold-start enrichment, warm-up idle speed, spark retard for catalyst heating, closed-loop enable (>35 °C), radiator fan control, and the dashboard gauge.',
      typical: 'Operating 88–98 °C (thermostat opens ~88 °C)',
      fail: 'Open circuit reads −40 °C → ECU substitutes 80 °C and runs the fan permanently. DTC P0118.',
    },
    {
      id: 'iat', group: 'air', abbr: 'IAT', name: 'Intake air temperature', unit: '°C', tech: 'NTC thermistor',
      what: 'Temperature of the air in the intake manifold.',
      how: 'Small, fast-responding NTC thermistor in the air stream (often combined with MAP in one "TMAP" sensor).',
      ecu: 'Air density correction for speed-density calculation, and knock protection — hot intake air is more prone to knock, so spark is retarded.',
      typical: 'Ambient + 5–20 °C',
      fail: 'Reads −40 °C → substitute 25 °C. DTC P0113.',
    },
    {
      id: 'oilp', group: 'temp', abbr: 'OIL P', name: 'Oil pressure', unit: 'bar', tech: 'Pressure switch / transducer',
      what: 'Lubrication oil pressure in the main gallery.',
      how: 'A diaphragm switch (closes below ~0.4 bar) or a strain-gauge transducer.',
      ecu: 'Warning lamp and, on some engines, variable oil pump control. Pressure rises with RPM and falls as oil thins when hot.',
      typical: 'Hot idle 1–2 bar · 3000 rpm 3–4.5 bar',
      fail: 'Red oil lamp — stop the engine immediately.',
    },
    {
      id: 'oilt', group: 'temp', abbr: 'OIL T', name: 'Oil temperature', unit: '°C', tech: 'NTC thermistor',
      what: 'Engine oil temperature — lags coolant temperature.',
      how: 'NTC thermistor in the oil sump or filter housing.',
      ecu: 'Friction and viscosity estimation, service interval calculation, rev limit reduction when cold.',
      typical: '90–120 °C',
      fail: 'Substitute value.',
    },
    {
      id: 'fuelp', group: 'fuel', only: ['na', 'turbo'], abbr: 'FRP', name: 'Fuel rail pressure', unit: 'bar', tech: 'Strain-gauge transducer',
      what: 'Fuel pressure feeding the injectors.',
      how: 'Diaphragm transducer on the fuel rail, 0.5–4.5 V output.',
      ecu: 'Injector flow depends on the pressure difference across it. The regulator keeps rail pressure a fixed amount above manifold pressure, so flow per millisecond is constant. If pressure drops, the ECU sees it and the engine runs lean.',
      typical: 'Port injection 3–4 bar above manifold',
      fail: 'Weak pump → pressure falls under load, lean at WOT. DTC P0087.',
    },
    {
      id: 'vbat', group: 'driver', abbr: 'VBAT', name: 'Battery / system voltage', unit: 'V', tech: 'ECU internal ADC',
      what: 'Supply voltage.',
      how: 'Measured directly by the ECU through a voltage divider.',
      ecu: 'Injector dead-time compensation (injectors open slower at low voltage), ignition coil dwell time (longer dwell at low voltage), alternator control.',
      typical: 'Engine off 12.4–12.7 V · Cranking 9.5–10.5 V · Running 13.8–14.5 V',
      fail: 'Alternator failure → voltage slowly drops, battery lamp. DTC P0562.',
    },
    {
      id: 'fuellvl', group: 'fuel', abbr: 'FUEL', name: 'Fuel level', unit: '%', tech: 'Float + potentiometer',
      what: 'Fuel in the tank.',
      how: 'A float arm moves a wiper along a resistor track.',
      ecu: 'Gauge, low-fuel warning, EVAP leak test enable, and misfire monitor disable when very low (fuel starvation).',
      typical: '0–100 %',
      fail: 'Gauge error.',
    },
    {
      id: 'boost', group: 'turbo', only: ['turbo', 'diesel'], abbr: 'BOOST', name: 'Boost / charge pressure', unit: 'kPa', tech: 'Silicon strain gauge (TMAP)',
      what: 'Pressure in the charge pipe after the intercooler, before the throttle.',
      how: 'Same technology as MAP but with a 0–300 kPa range.',
      ecu: 'Closed-loop boost control: compares actual boost to the target and drives the wastegate solenoid. Also detects overboost (safety cut) and underboost (leaks).',
      typical: '100 kPa idle · up to 250 kPa at full boost',
      fail: 'Boost control disabled — wastegate held open.',
    },
    {
      id: 'cat', group: 'turbo', only: ['turbo', 'diesel'], abbr: 'CAT', name: 'Charge air temperature', unit: '°C', tech: 'NTC thermistor',
      what: 'Air temperature after the intercooler.',
      how: 'NTC thermistor in the charge pipe.',
      ecu: 'Compressing air heats it (≈120 °C at 1 bar boost). The intercooler removes most of that heat. The ECU uses this for air density and knock protection, and reduces boost if charge air gets too hot.',
      typical: 'Ambient + 10–40 °C',
      fail: 'Substitute value, reduced boost.',
    },
    {
      id: 'turbo', group: 'turbo', abbr: 'NT', name: 'Turbocharger speed', unit: 'krpm', tech: 'Eddy-current sensor', turboOnly: true,
      what: 'Shaft speed of the turbocharger.',
      how: 'An eddy-current sensor in the compressor housing counts compressor blade tips passing by.',
      ecu: 'Protects the turbo from overspeed (especially at altitude) and helps model turbo lag.',
      typical: 'Idle 10–20 krpm · full boost 160–220 krpm',
      fail: 'Conservative boost limit.',
    },
    {
      id: 'wgpos', group: 'turbo', abbr: 'WG', name: 'Wastegate position', unit: '%', tech: 'Hall position sensor', turboOnly: true,
      what: 'How far the wastegate flap is open.',
      how: 'Hall sensor on the wastegate actuator rod.',
      ecu: 'The wastegate lets exhaust bypass the turbine. Open = less turbine power = less boost. The ECU closes it to build boost and opens it to hold the target.',
      typical: 'Open (100 %) off-boost · 20–60 % holding boost',
      fail: 'Stuck closed → overboost → safety fuel cut. DTC P0234.',
    },
    {
      id: 'vss', group: 'driver', abbr: 'VSS', name: 'Vehicle speed', unit: 'km/h', tech: 'Hall / ABS wheel sensors',
      what: 'Road speed.',
      how: 'Hall or magneto-resistive sensor reading a tone ring on the gearbox output or the ABS wheel sensors.',
      ecu: 'Idle control strategy, decel fuel cut enable, gear detection, speed limiter and cruise control.',
      typical: '0–250 km/h',
      fail: 'Speedometer and cruise inoperative.',
    },
    {
      id: 'brake', group: 'driver', abbr: 'BRK', name: 'Brake pedal switch', unit: '', tech: 'Dual switch',
      what: 'Whether the brake pedal is pressed.',
      how: 'Two contacts (normally open + normally closed) for plausibility.',
      ecu: 'Brake-throttle override (brake wins), cruise cancel, torque converter lock-up release.',
      typical: 'On/off',
      fail: 'Cruise disabled.',
    },
    {
      id: 'acsw', group: 'driver', abbr: 'A/C', name: 'A/C request & pressure', unit: '', tech: 'Switch + pressure transducer',
      what: 'The driver asks for air conditioning.',
      how: 'Button signal plus refrigerant pressure sensor.',
      ecu: 'Raises idle speed and opens the throttle slightly before engaging the compressor clutch (prevents stalling), switches on the radiator fan.',
      typical: 'On/off',
      fail: 'Compressor disabled.',
    },
    {
      id: 'amb', group: 'temp', abbr: 'AMB', name: 'Ambient temperature', unit: '°C', tech: 'NTC thermistor',
      what: 'Outside air temperature.',
      how: 'Thermistor behind the front bumper.',
      ecu: 'Cold-start strategies, intercooler efficiency estimates, and dashboard display.',
      typical: '−30 to +50 °C',
      fail: 'Substitute value.',
    },
  ];

  // diesel-only sensors (2.0 TDI-style common rail)
  ECU.SENSORS.push(
    {
      id: 'rail', group: 'fuel', only: ['diesel'], abbr: 'RP', name: 'Rail pressure (high pressure)', unit: 'bar', tech: 'Strain-gauge transducer, 0–2000 bar',
      what: 'Fuel pressure in the common rail that feeds all four injectors — 250 bar at idle, up to 1800 bar at full load.',
      how: 'A thick steel diaphragm with strain gauges, screwed into the end of the rail. Output 0.5–4.5 V.',
      ecu: 'Closed-loop rail-pressure control: the ECU compares actual with target pressure and drives the pressure-control valve / metering unit. Higher pressure atomises the fuel finer (less soot) and lets the same quantity be injected in less time.',
      typical: 'Idle 250–350 bar · cruise 600–1000 bar · full load 1600–1800 bar',
      fail: 'Rail pressure deviation → limp mode. Low pressure under load points to the supply pump or a leaking injector (P0087 / P0093).',
    },
    {
      id: 'fueltemp', group: 'fuel', only: ['diesel'], abbr: 'FT', name: 'Fuel temperature', unit: '°C', tech: 'NTC thermistor',
      what: 'Temperature of the diesel in the high-pressure system.',
      how: 'NTC thermistor in the fuel return or pump housing. Compressing fuel to 1800 bar heats it.',
      ecu: 'Fuel density falls as it warms, so the ECU corrects the injected quantity. Very hot fuel reduces the rail pressure allowed.',
      typical: 'Ambient + 20–50 °C',
      fail: 'Substitute value.',
    },
    {
      id: 'lam', group: 'exhaust', only: ['diesel'], abbr: 'λ WB', name: 'Wideband lambda sensor', unit: 'λ', tech: 'Planar wideband (pump cell)',
      what: 'The exact air-fuel ratio of the lean diesel exhaust — λ 1.2 at full load up to λ 5+ at idle.',
      how: 'A pump cell moves oxygen ions to hold a reference cell at λ = 1; the pump current is proportional to the exhaust oxygen content, so it measures any λ, not just rich/lean.',
      ecu: 'Corrects the MAF reading and the smoke limiter, and checks injector quantity drift. A diesel never runs at λ = 1 — there is no switching closed loop.',
      typical: 'Idle λ 3–6 · full load λ 1.2–1.4',
      fail: 'Substitute air model, reduced torque.',
    },
    {
      id: 'egt2', group: 'exhaust', only: ['diesel'], abbr: 'EGT2', name: 'DPF inlet temperature', unit: '°C', tech: 'Thermocouple / PTC',
      what: 'Exhaust temperature after the oxidation catalyst (DOC), just before the particulate filter.',
      how: 'Same type of sensor as the pre-turbine EGT.',
      ecu: 'Controls active regeneration: post-injected fuel burns on the DOC and raises this temperature to ~600 °C so the soot in the DPF burns off.',
      typical: 'Normal driving 200–450 °C · regeneration 580–650 °C',
      fail: 'Regeneration disabled.',
    },
    {
      id: 'dpfdp', group: 'exhaust', only: ['diesel'], abbr: 'ΔP', name: 'DPF differential pressure', unit: 'mbar', tech: 'Differential pressure sensor',
      what: 'The pressure drop across the diesel particulate filter.',
      how: 'Two hoses — before and after the filter — go to one differential sensor. The more soot, the higher the pressure drop for a given exhaust flow.',
      ecu: 'Estimates the soot load (together with a soot-production model). When the filter is ~24 g full, the ECU starts an active regeneration; above ~45 g it lights the DPF lamp and limits power.',
      typical: 'Idle 5–20 mbar · full load 50–250 mbar (rises with soot)',
      fail: 'Soot estimated from the model only. DTC P2463 if the filter is overloaded.',
    },
    {
      id: 'egrpos', group: 'air', only: ['diesel'], abbr: 'EGR', name: 'EGR valve position', unit: '%', tech: 'Hall position sensor',
      what: 'How far the exhaust gas recirculation valve is open.',
      how: 'Hall sensor on the valve shaft; the valve is moved by an electric motor.',
      ecu: 'EGR feeds cooled exhaust back into the intake. It displaces oxygen, lowering combustion temperature and NOx. The ECU opens the valve until the MAF reading drops to its fresh-air setpoint.',
      typical: 'Idle / part load 20–60 % · full load 0 %',
      fail: 'Stuck open → smoke and low power (P0402). Stuck closed → high NOx, MAF above target (P0401).',
    },
    {
      id: 'vgtpos', group: 'turbo', only: ['diesel'], abbr: 'VGT', name: 'VGT vane position', unit: '% open', tech: 'Position sensor on the vane actuator',
      what: 'The position of the variable-geometry turbine vanes.',
      how: 'Movable vanes around the turbine wheel change the effective nozzle size. Closed vanes speed up the exhaust flow onto the wheel → more boost at low rpm; open vanes reduce back-pressure at high rpm.',
      ecu: 'Closed-loop boost control: like a wastegate, but instead of dumping exhaust it changes how hard the exhaust drives the turbine — so there is almost no turbo lag.',
      typical: 'Idle open · low-rpm full load mostly closed · high rpm partly open',
      fail: 'Stuck closed → overboost and limp mode (P0234); stuck open → no boost (P0299).',
    },
  );
  ECU.SENSORS.find((s) => s.id === 'turbo').only = ['turbo'];
  ECU.SENSORS.find((s) => s.id === 'wgpos').only = ['turbo'];

  ECU.ACTUATORS = [
    { id: 'inj', name: 'Fuel injectors ×4', only: ['na', 'turbo'], desc: 'Solenoid valves spraying fuel into each intake port. The ECU controls how long they stay open (pulse width) and when (injection timing, in crank degrees). Sequential: each cylinder injects once per cycle, just before its intake valve opens.' },
    { id: 'coil', name: 'Ignition coils ×4', only: ['na', 'turbo'], desc: 'Coil-on-plug. The ECU switches current through the primary winding for the "dwell" time to build a magnetic field, then cuts it — the collapsing field induces 25–40 kV in the secondary and the plug sparks. Spark advance = degrees before TDC.' },
    { id: 'etc', name: 'Electronic throttle (ETC)', desc: 'A DC motor positions the throttle plate. The ECU closes a position loop using the dual TPS tracks. At idle the ECU itself opens the throttle a few percent to hold the target idle speed.' },
    { id: 'pump', name: 'Fuel pump relay', desc: 'Primes the rail for 2 s at key-on, then only runs while the ECU sees crank pulses (safety: stops fuel if the engine stalls or after a crash).' },
    { id: 'fan', name: 'Radiator fan', desc: 'Switched on above ~98 °C coolant, off below ~93 °C (hysteresis), and whenever the A/C is on.' },
    { id: 'vvt', name: 'VVT oil control valve', only: ['na', 'turbo'], desc: 'Directs oil pressure to the cam phaser to advance or retard the intake camshaft. More advance at mid RPM/load improves torque and adds internal EGR.' },
    { id: 'wg', name: 'Wastegate solenoid', desc: 'PWM valve controlling the wastegate actuator. Higher duty holds the wastegate shut to build boost.', turboOnly: true },
    { id: 'bov', name: 'Blow-off / diverter valve', desc: 'When the throttle snaps shut under boost, the pressurised air has nowhere to go. The valve vents it to prevent compressor surge (the classic "pssht").', turboOnly: true },
    { id: 'o2h', name: 'O2 sensor heaters', only: ['na', 'turbo'], desc: 'Resistive heaters bring the zirconia elements to 600–750 °C within seconds so closed-loop control can start early.' },
    { id: 'alt', name: 'Alternator field control', desc: 'Regulates charging voltage around 14 V; charging adds torque load on the crankshaft.' },
    { id: 'acc', name: 'A/C compressor clutch', desc: 'Engaged after the idle speed has been raised.' },
    { id: 'mil', name: 'MIL (check-engine lamp)', desc: 'Lit by emissions-relevant faults. Flashes during catalyst-damaging misfire.' },
  ];

  // diesel actuators are appended after the list below
  ECU.FAULTS = [
    { id: 'ckp', name: 'CKP sensor open circuit', dtc: 'P0335', hint: 'No crank signal → no spark, no fuel. Engine dies.' },
    { id: 'cmp', name: 'CMP sensor failure', dtc: 'P0340', hint: 'Falls back to batch-fire & wasted spark. Watch the scope.' },
    { id: 'misfire3', only: ['na', 'turbo'], name: 'Ignition coil #3 dead', dtc: 'P0303', hint: 'Misfire detected via crank speed dips, injector 3 cut, MIL flashes.' },
    { id: 'maf', name: 'MAF sensor failure', dtc: 'P0102', hint: 'ECU switches to speed-density (MAP-based) air calculation.' },
    { id: 'map', name: 'MAP sensor failure', dtc: 'P0107', hint: 'MAF still used; plausibility code only.' },
    { id: 'tps', only: ['na', 'turbo'], name: 'Throttle sensors disagree', dtc: 'P0121', hint: 'Throttle motor disabled — limp home at fixed opening.' },
    { id: 'ect', name: 'ECT sensor open circuit', dtc: 'P0118', hint: 'Reads −40 °C. ECU substitutes 80 °C, fan forced on.' },
    { id: 'iat', name: 'IAT sensor open circuit', dtc: 'P0113', hint: 'Reads −40 °C. ECU substitutes 25 °C.' },
    { id: 'o2', only: ['na', 'turbo'], name: 'O2 sensor dead (stuck lean)', dtc: 'P0134', hint: 'Trims run to +25 % then ECU gives up → open loop.' },
    { id: 'cat', only: ['na', 'turbo'], name: 'Catalyst worn out', dtc: 'P0420', hint: 'Downstream O2 starts copying upstream switching.' },
    { id: 'knocksensor', only: ['na', 'turbo'], name: 'Knock sensor failure', dtc: 'P0325', hint: 'Safe (retarded) spark map applied everywhere.' },
    { id: 'vacleak', only: ['na', 'turbo'], name: 'Vacuum leak (unmetered air)', dtc: 'P0171', hint: 'MAF misses the extra air → lean → fuel trims go positive.' },
    { id: 'fuelpump', name: 'Weak fuel pump', dtc: 'P0087', hint: 'Rail pressure sags under load → lean at WOT.' },
    { id: 'alt', name: 'Alternator failure', dtc: 'P0562', hint: 'Battery voltage drops, injector dead-time grows.' },
    { id: 'oil', name: 'Low oil level', dtc: '', hint: 'Oil pressure lamp at idle.' },
    { id: 'thermostat', name: 'Thermostat stuck open', dtc: 'P0128', hint: 'Engine never reaches operating temperature.' },
    { id: 'wgstuck', name: 'Wastegate stuck closed', dtc: 'P0234', hint: 'Boost runs away → overboost cut.', turboOnly: true },
    { id: 'boostleak', only: ['turbo', 'diesel'], name: 'Boost leak (split hose)', dtc: 'P0299', hint: 'Can\'t reach boost target; metered air escapes → rich.' },
  ];

  ECU.ACTUATORS.find((x) => x.id === 'wg').only = ['turbo'];
  ECU.ACTUATORS.find((x) => x.id === 'bov').only = ['turbo'];
  ECU.ACTUATORS.push(
    { id: 'dinj', only: ['diesel'], name: 'Piezo injectors ×4', desc: 'Direct injection straight into the cylinder at up to 1800 bar. Piezo stacks open the nozzle in ~0.1 ms, so several injections per cycle are possible: a small pilot (quieter combustion), the main injection (torque), and late post-injections to heat the DPF during regeneration.' },
    { id: 'pcv', only: ['diesel'], name: 'Rail pressure control valve', desc: 'Meters how much fuel the high-pressure pump delivers into the rail and bleeds off excess, holding the rail at the ECU\'s target pressure.' },
    { id: 'vgt', only: ['diesel'], name: 'VGT vane actuator', desc: 'Moves the turbine vanes. Closing them raises boost; the ECU closes the loop on the boost pressure sensor.' },
    { id: 'egr', only: ['diesel'], name: 'EGR valve', desc: 'Lets cooled exhaust back into the intake to lower NOx. The ECU opens it until the MAF drops to the fresh-air setpoint; it closes at full load where every gram of oxygen is needed.' },
    { id: 'glow', only: ['diesel'], name: 'Glow plugs ×4', desc: 'Heater rods in each cylinder. A cold diesel may not reach auto-ignition temperature by compression alone, so the plugs pre-heat the chambers before cranking and keep glowing for a while after start (less smoke and noise).' },
  );
  ECU.FAULTS.find((f) => f.id === 'wgstuck').only = ['turbo'];
  ECU.FAULTS.push(
    { id: 'glowplug', only: ['diesel'], name: 'Glow plugs failed', dtc: 'P0670', hint: 'Detected at key-on; hard cold starts with white smoke.' },
    { id: 'egropen', only: ['diesel'], name: 'EGR valve stuck open', dtc: 'P0402', hint: 'Too little fresh air: smoke limiter cuts fuel → low power, soot.' },
    { id: 'egrclosed', only: ['diesel'], name: 'EGR valve stuck closed', dtc: 'P0401', hint: 'MAF stays above its setpoint; NOx rises.' },
    { id: 'dpfclog', only: ['diesel'], name: 'DPF clogged with ash', dtc: 'P2463', hint: 'Pressure drop far too high; regeneration can’t clear it → limp.' },
    { id: 'injleak3', only: ['diesel'], name: 'Injector #3 leaking', dtc: 'P0093', hint: 'Fuel dribbles into cylinder 3: rough idle, smoke, pump delivers more than is injected.' },
    { id: 'vgtstuck', only: ['diesel'], name: 'VGT vanes stuck closed', dtc: 'P0234', hint: 'Boost overshoots under load → overboost protection.' },
  );

  // which engines a sensor / actuator / fault / lamp belongs to
  ECU.appliesTo = function (def, type) {
    if (def.only) return def.only.includes(type);
    if (def.turboOnly) return type === 'turbo';
    return true;
  };

  ECU.DTC_TEXT = {
    P0335: 'Crankshaft position sensor A circuit',
    P0340: 'Camshaft position sensor A circuit',
    P0303: 'Cylinder 3 misfire detected',
    P0102: 'Mass air flow circuit low',
    P0107: 'MAP sensor circuit low',
    P0121: 'Throttle position sensor A/B correlation',
    P0118: 'Engine coolant temperature circuit high',
    P0113: 'Intake air temperature circuit high',
    P0134: 'O2 sensor B1S1 no activity detected',
    P0420: 'Catalyst efficiency below threshold (B1)',
    P0325: 'Knock sensor 1 circuit',
    P0171: 'System too lean (B1)',
    P0172: 'System too rich (B1)',
    P0087: 'Fuel rail pressure too low',
    P0562: 'System voltage low',
    P0128: 'Coolant below thermostat regulating temperature',
    P0234: 'Turbocharger overboost condition',
    P0299: 'Turbocharger underboost condition',
    P0670: 'Glow plug control circuit',
    P0401: 'EGR flow insufficient',
    P0402: 'EGR flow excessive',
    P2463: 'DPF soot accumulation',
    P0093: 'Fuel system leak detected — large leak',
  };

  // Stroke colors shared by views
  ECU.STROKES = [
    { id: 'power', name: 'Power', color: '#ff7a3d' },
    { id: 'exhaust', name: 'Exhaust', color: '#a08a7a' },
    { id: 'intake', name: 'Intake', color: '#3fc6ff' },
    { id: 'compression', name: 'Compression', color: '#b98cff' },
  ];
})();
