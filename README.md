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

## Files

- `js/sim.js` contains the engine physics and ECU strategy. It doesn't touch the DOM, so it also runs headless in Node.
- `js/info.js` holds the sensor, actuator and fault definitions and all the explanatory text.
- `js/*-view.js` are the canvas and SVG renderers.
- `js/ui.js` handles the DOM panels and controls. `js/main.js` runs the loop.

Physics runs in real time. The crank-angle views run in slow motion (Auto / 1 % / 5 % / 20 % / Real) so you can follow each event. Pause with `P` and drag across the timing scope to scrub the crank angle.

## Deploying to a Gist

`.github/workflows/deploy-gist.yml` runs on every push to `main`. It bundles the app into one self-contained `index.html` (`node scripts/bundle.mjs`, which writes `dist/`) and pushes it to a GitHub Gist.

Setup: create a gist and a token with the `gist` scope, then add the repo secrets `GIST_ID` and `GIST_TOKEN`. The page is then live at `https://gistpreview.github.io/?<GIST_ID>`.
