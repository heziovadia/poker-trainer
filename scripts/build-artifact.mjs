// Packs the production build into one self-contained HTML file for publishing on claude.ai.
// Usage: npm run build && node scripts/build-artifact.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const assets = readdirSync('dist/assets');
const css = assets.filter((f) => f.endsWith('.css')).map((f) => readFileSync(`dist/assets/${f}`, 'utf8')).join('\n');
const jsFiles = assets.filter((f) => f.endsWith('.js'));
if (jsFiles.length !== 1) throw new Error(`Expected one JS bundle, found ${jsFiles.length}`);
const js = readFileSync(`dist/assets/${jsFiles[0]}`, 'utf8').replace(/<\/script/gi, '<\/script');

// The publish step wraps this in <!doctype html><html><head>…<body>, so no document tags here.
const html = `<title>Poker Trainer</title>
<meta name="theme-color" content="#0b1220">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js}</script>
`;
writeFileSync('dist/poker-trainer.html', html);
console.log(`dist/poker-trainer.html  ${(html.length / 1024).toFixed(0)} KB`);
