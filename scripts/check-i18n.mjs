// Lists translation keys used in the code that have no Croatian entry.
// Usage: node scripts/check-i18n.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
const load = (f) => new Function(readFileSync(join(root, f), 'utf8'))();
['js/i18n.js', 'js/i18n-hr.js', 'js/info.js', 'js/info-hr.js'].forEach(load);
const HR = globalThis.ECU.HR;

const missing = new Map();
const note = (key, where) => { if (key && !(key in HR)) missing.set(key, where); };

// 1) explicit keys: T('..'), ECU.t('..'), log(.., '..'), edge(.., '..'), { k: '..' }, step('..')
const files = ['sim.js', 'main.js', 'ui.js', 'engine-view.js', 'wheel-view.js', 'scope-view.js', 'cluster-view.js', 'trend-view.js', 'diagram-view.js'];
const str = `'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)"`;
const patterns = [
  new RegExp(`\\bT\\(\\s*(?:${str})`, 'g'),
  new RegExp(`ECU\\.t\\(\\s*(?:${str})`, 'g'),
  new RegExp(`\\bk:\\s*(?:${str})`, 'g'),
  new RegExp(`\\bstep\\(\\s*(?:${str})`, 'g'),
  new RegExp(`\\bmode = (?:${str})`, 'g'),
  new RegExp(`\\b(?:title|label|tip|name):\\s*(?:${str})`, 'g'),
  new RegExp(`\\?\\s*(?:${str})\\s*:\\s*(?:${str})`, 'g'), // ternaries inside log()/edge()
];
for (const f of files) {
  const src = readFileSync(join(root, 'js', f), 'utf8');
  src.split('\n').forEach((line, i) => {
    const isLogLine = /\b(log|edge)\(/.test(line);
    patterns.forEach((re, pi) => {
      if (pi === 6 && !isLogLine) return;
      for (const m of line.matchAll(re)) {
        for (const g of m.slice(1)) if (g != null) note(g.replace(/\\'/g, "'"), `${f}:${i + 1}`);
      }
    });
    if (isLogLine) for (const m of line.matchAll(/\b(?:log|edge)\([^,]+,\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g)) note(m[1] ?? m[2], `${f}:${i + 1}`);
    if (/\b(log|edge)\(S, '[^']*', [^,]+, '/.test(line)) for (const m of line.matchAll(/edge\(S, '[^']*', [^,]+, '((?:[^'\\]|\\.)*)'(?:, '((?:[^'\\]|\\.)*)')?/g)) { note(m[1], `${f}:${i + 1}`); if (m[2]) note(m[2], `${f}:${i + 1}`); }
  });
}

// 2) data tables used through T()
const E = globalThis.ECU;
E.STROKES.forEach((s) => note(s.name, 'info.js STROKES'));
['STROKE_WORD', 'STROKE_NAME'].forEach(() => ['POWER', 'EXHAUST', 'INTAKE', 'COMPRESSION'].forEach((w) => note(w, 'stroke words')));
Object.values(E.DTC_TEXT).forEach((t) => note(t, 'DTC_TEXT'));
E.SENSORS.forEach((s) => ['what', 'how', 'ecu', 'typical', 'fail', 'tech', 'name'].forEach((k) => { if (!E.INFO_HR.sensors[s.id]?.[k]) missing.set(`sensor ${s.id}.${k}`, 'info-hr.js'); }));
E.ACTUATORS.forEach((a) => ['name', 'desc'].forEach((k) => { if (!E.INFO_HR.actuators[a.id]?.[k]) missing.set(`actuator ${a.id}.${k}`, 'info-hr.js'); }));
E.FAULTS.forEach((f) => ['name', 'hint'].forEach((k) => { if (!E.INFO_HR.faults[f.id]?.[k]) missing.set(`fault ${f.id}.${k}`, 'info-hr.js'); }));

// 2b) lessons carry their own {en, hr} texts
load('js/lessons.js');
E.LESSONS.forEach((l) => {
  const need = (o, what) => { if (o && (!o.en || !o.hr)) missing.set(`lesson ${l.id} ${what}`, 'lessons.js'); };
  need(l.title, 'title'); need(l.desc, 'desc');
  l.steps.forEach((st, i) => { need(st.text, `step ${i + 1} text`); if (st.until) { if (!st.wait) missing.set(`lesson ${l.id} step ${i + 1} wait`, 'lessons.js'); need(st.wait, `step ${i + 1} wait`); } });
});

// 3) static HTML
const html = readFileSync(join(root, 'index.html'), 'utf8');
for (const m of html.matchAll(/<(\w+)[^>]*\sdata-i18n(?:-html)?(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
  const key = /data-i18n-html/.test(m[0].slice(0, m[0].indexOf('>'))) ? m[2].trim() : m[2].trim().replace(/&amp;/g, '&');
  note(key, 'index.html');
}
for (const m of html.matchAll(/data-i18n-title[^>]*?title="([^"]*)"/g)) note(m[1], 'index.html title');

// identifiers that the patterns pick up but are never shown: log kinds, edge() flags, series keys
const ids = 'ok info warn fault running dfco rev onboost injmax misfire kmh map thr o2 o2dn lam lamT stft ltft spk kr pw duty ect iat egt btgt wg'.split(' ');
const ignore = new Set([...ids, '2.0 NA', '2.0 Turbo', '', 'MAF', 'EPC', 'DFCO', 'ACC', 'CKP', 'CMP', 'rpm', 'km/h', 'MAP kPa', 'STFT %', 'LTFT %', 'ECT °C', 'IAT °C', 'EGT/10', 'SYNC', 'Auto', 'WG %', 'A/C', 'Guided lessons']);
const list = [...missing].filter(([k]) => !ignore.has(k));
if (!list.length) console.log('✓ all translation keys covered');
else { console.log(`${list.length} missing:`); list.forEach(([k, w]) => console.log(`  [${w}] ${k}`)); process.exitCode = 1; }
