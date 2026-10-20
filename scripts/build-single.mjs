// Inlines the production build (dist/) into one self-contained HTML file.
// Usage: npm run build:single (minified) or npm run build:single-full (readable, unminified)
// Optional args: <dist dir> <output file>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const dist = process.argv[2] ?? 'dist';
const outFile = process.argv[3] ?? 'emberwild-dragon-rush5.html';
const assets = readdirSync(`${dist}/assets`);
const css = readFileSync(`${dist}/assets/${assets.find((f) => f.endsWith('.css'))}`, 'utf8');
const js = readFileSync(`${dist}/assets/${assets.find((f) => f.endsWith('.js'))}`, 'utf8').replaceAll('</script', '<\\/script');

let html = readFileSync(`${dist}/index.html`, 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]*>/, () => `<style>\n${css}\n</style>`);
html = html.replace(/<script type="module" crossorigin src="[^"]*"><\/script>/, '');
html = html.replace('</body>', () => `<script type="module">\n${js}\n</script>\n</body>`);
if (html.includes('assets/')) throw new Error('Unresolved asset reference in single-file build');

writeFileSync(outFile, html);
console.log(`Wrote ${outFile} (${Math.round(html.length / 1024)} KB)`);
