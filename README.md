# ECU Simulator

An interactive, animated engine-management simulator that shows what every sensor reads and what the ECU does with it, crank degree by crank degree. You can switch between a naturally aspirated and a turbocharged 2.0 L inline-four.

Open `index.html` in a browser. There is no build step and nothing to install. You can also serve the folder, e.g. `python3 -m http.server`.

## What's inside

| Panel | Shows |
|---|---|
| Instrument cluster | Tach, speedo, MAP/boost gauge, λ, torque, power, 14 warning/status lamps (with bulb check at key-on) |
| Inside the engine | 4 cut-away cylinders: pistons, rods, crank, cams with VVT, valves, injector spray, spark, flame front, knock waves |
| Trigger wheels | 60-2 crank wheel + single-tab cam wheel, their sensors, and rolling VR/Hall signals |
| Engine cycle timing | 720° scope: strokes, CKP, CMP, 4 injectors, 4 coils (dwell + spark), knock sensor windows, crank-speed (misfire) |
| Air, fuel & exhaust path | Live flow diagram with every sensor clickable; turbo, intercooler, wastegate, BOV on the turbo engine |
| What the ECU is thinking | Step-by-step live calculation: sync → air per cylinder → target λ → fuel mass → pulse width → spark → closed loop → idle → boost |
| Sensors (26) | Value, electrical signal (volts / Hz / Ω) and status for each; click one for a full explanation |
| Actuators, live data, event log | ECU outputs, 30 s trends, narrated event log and stored DTCs |

## Phones

On narrow screens the controls become a slide-in drawer (panel button, top left), and a floating pad at the bottom gives you hold-to-accelerate gas, brake, gear ‹ › and a start button, so you can drive while watching the gauges.

## Guided lessons

Click **🎓 Lessons** in the top bar. Each lesson drives the simulator, highlights the relevant panel and explains what's happening, waiting for the right moment before moving on: cold start and sync, closed loop and fuel trims, knock, turbo lag and boost control, decel fuel cut and the rev limiter, and misfire detection. Lessons live in `js/lessons.js` with English and Croatian text side by side.

## Diagnostic challenge

Click **🩺 Challenge**, pick a difficulty, and the simulator secretly injects a random fault into the current engine. You get the customer's complaint and investigate with everything on screen: sensors and their signal voltages, live data, fuel trims, the scope, the dyno. Then you name the fault. Hints, reading codes (on medium), wrong guesses and time cost points. Anything that would give the answer away is hidden during the challenge: fault switches, "fault injected" log lines, "broken" sensor LEDs and labels, and fault codes (depending on difficulty). At the end you see the fault, where to look, the key clue, and a repair button.

| Difficulty | Answer choices | Fault codes |
|---|---|---|
| Easy | 4 | visible |
| Medium | 6 | reading them costs 20 points |
| Hard | all faults | hidden |

## Calibration maps

The ECU runs on real lookup tables: **spark advance** and **target λ** (rpm × load), plus **boost target** (rpm × pedal) on the turbo. A white dot tracks the live operating point, and the four cells it interpolates between light up. Drag across cells to select them, then edit with the buttons or the keyboard (+/−, PgUp/PgDn, arrows, Delete). Edits take effect immediately and are saved per engine in the browser. Lessons always run on the stock maps.

The stock tables are generated from the same models the simulated engine obeys (best-torque timing, knock limit, breathing), so a stock ECU is well calibrated. Edits only change what the ECU *asks for*; the physics stays honest. Too much spark advance knocks, a lean full-load λ runs hot, and extra boost costs spark timing.

## Dyno

An engine-dyno sweep: the dyno holds full throttle in neutral, settles at 1500 rpm, then ramps engine speed at a fixed rate (slow / normal / fast) and records brake torque in 50 rpm bins. Switch the chart between torque & power, boost, spark and λ; hover for values; red ticks mark knock. Up to six runs are overlaid and labelled automatically (engine, fuel, boost scale, stock/modified maps, faults), so you can pull, edit a map, and pull again. Fast sweeps expose turbo lag; low-octane fuel shows up as knock-limited torque.

## Languages

Croatian is the default; switch with **HR / EN** in the top-right corner (the choice is remembered). English source strings are the translation keys: `js/i18n-hr.js` holds UI strings and `js/info-hr.js` the long sensor/actuator/fault explanations. After changing any text, run `node scripts/check-i18n.mjs` to list strings that still need a Croatian translation.

## Files

- `js/sim.js` contains the engine physics and ECU strategy. It doesn't touch the DOM, so it also runs headless in Node.
- `js/info.js` holds the sensor, actuator and fault definitions and all the explanatory text.
- `js/*-view.js` are the canvas and SVG renderers.
- `js/ui.js` handles the DOM panels and controls. `js/main.js` runs the loop.

Physics runs in real time. The crank-angle views run in slow motion (Auto / 1 % / 5 % / 20 % / Real) so you can follow each event. Pause with `P` and drag across the timing scope to scrub the crank angle.

## Tests

```
npm test
```

Runs the headless test suite with Node's built-in test runner; no dependencies needed. It covers the engine physics (start, idle, closed loop, full throttle, boost, rev limiter, knock), every fault and the DTC it should set, the calibration maps, all six lessons (driven through a stub app) and translation coverage.

## Deploying to GitHub Pages

`.github/workflows/ci.yml` runs the tests on every push and pull request. On `main`, once the tests pass, it publishes `index.html`, `css/` and `js/` to GitHub Pages. No build step is needed; all paths are relative.

One-time setup: in the repo go to Settings → Pages → Build and deployment and set Source to **GitHub Actions**.
