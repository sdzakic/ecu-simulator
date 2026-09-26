// Inlines css/*.css and js/*.js referenced by index.html into a single dist/index.html.
// Gists are flat (no folders) and gist preview pages can't resolve relative paths,
// so the deployed page must be fully self-contained. No dependencies.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="([^"]+\.css)" \/>/g, (_, href) => `<style>\n${read(href)}\n</style>`);
html = html.replace(/<script src="([^"]+\.js)"><\/script>/g, (_, src) => {
  const js = read(src).replace(/<\/script/gi, '<\\/script');
  return `<script>/* ${src} */\n${js}\n</script>`;
});

if (/<script src="(?!https?:)|<link rel="stylesheet" href="(?!https?:)/.test(html)) {
  console.error('bundle: a local asset was not inlined');
  process.exit(1);
}

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/index.html'), html);
console.log(`dist/index.html written (${(html.length / 1024).toFixed(1)} KB)`);
