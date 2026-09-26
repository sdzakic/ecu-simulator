// Loads the browser scripts into Node (they attach to window.ECU) and provides sim helpers.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
for (const f of ['i18n', 'i18n-hr', 'info', 'info-hr', 'sim', 'diesel', 'lessons', 'challenge', 'sound', 'obd']) {
  new Function(readFileSync(join(root, 'js', f + '.js'), 'utf8'))();
}
export const ECU = globalThis.ECU;
ECU.lang = 'en';

export const DT = 1 / 240;
export function run(S, sec, each) {
  for (let i = 0; i < sec / DT; i++) { if (each) each(S); ECU.step(S, DT); }
}
// key ON → START, warm engine by default
export function started(type = 'na', { warm = true, octane = 95 } = {}) {
  const S = ECU.createState(type);
  if (warm) { S.ect = 88; S.oilT = 90; }
  S.octane = octane;
  S.key = 'ON'; run(S, 0.5);
  S.key = 'START'; run(S, 4);
  return S;
}
