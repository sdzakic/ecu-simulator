import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ECU } from './helpers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('translation coverage (scripts/check-i18n.mjs)', () => {
  const out = execFileSync(process.execPath, [join(root, 'scripts/check-i18n.mjs')], { encoding: 'utf8' });
  assert.match(out, /all translation keys covered/);
});

test('t() fills placeholders and translates nested keys', () => {
  ECU.lang = 'hr';
  assert.equal(ECU.t('Rev limiter: {r} rpm reached → fuel cut until {r2} rpm.', { r: 6800, r2: 6600 }), 'Graničnik okretaja: dosegnuto 6800 o/min → prekid goriva do 6600 o/min.');
  assert.equal(ECU.t('OPEN LOOP: {ol}.', { ol: { k: 'fuel cut' } }), 'OTVORENA PETLJA: prekid goriva.');
  assert.equal(ECU.t('no such key {x}', { x: 1 }), 'no such key 1');
  ECU.lang = 'en';
  assert.equal(ECU.t('OPEN LOOP: {ol}.', { ol: { k: 'fuel cut' } }), 'OPEN LOOP: fuel cut.');
});
