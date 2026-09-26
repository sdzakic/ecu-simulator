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

## Guided lessons

Click **🎓 Lessons** in the top bar. Each lesson drives the simulator, highlights the relevant panel and explains what's happening, waiting for the right moment before moving on: cold start and sync, closed loop and fuel trims, knock, turbo lag and boost control, decel fuel cut and the rev limiter, and misfire detection. Lessons live in `js/lessons.js` with English and Croatian text side by side.

## Languages

Croatian is the default; switch with **HR / EN** in the top-right corner (the choice is remembered). English source strings are the translation keys: `js/i18n-hr.js` holds UI strings and `js/info-hr.js` the long sensor/actuator/fault explanations. After changing any text, run `node scripts/check-i18n.mjs` to list strings that still need a Croatian translation.

## Files

- `js/sim.js` contains the engine physics and ECU strategy. It doesn't touch the DOM, so it also runs headless in Node.
- `js/info.js` holds the sensor, actuator and fault definitions and all the explanatory text.
- `js/*-view.js` are the canvas and SVG renderers.
- `js/ui.js` handles the DOM panels and controls. `js/main.js` runs the loop.

Physics runs in real time. The crank-angle views run in slow motion (Auto / 1 % / 5 % / 20 % / Real) so you can follow each event. Pause with `P` and drag across the timing scope to scrub the crank angle.

## Deploying to GitHub Pages

`.github/workflows/deploy-pages.yml` runs on every push to `main`. It checks translation coverage, then publishes `index.html`, `css/` and `js/` to GitHub Pages. No build step is needed; all paths are relative, so the site works under `https://<user>.github.io/<repo>/`.

One-time setup: in the repo go to Settings → Pages → Build and deployment and set Source to **GitHub Actions**.
