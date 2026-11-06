#!/usr/bin/env node
// Packs the built game (dist/) into ONE self-contained file: release/AngryAndyLeisureCentre.html
//
//   npm run package
//
// Send that file to anyone: they double-click it to play in their browser.
// Everything is inside it: code, styles, images and (if they can be downloaded
// at package time) the two pixel fonts, so it also works offline.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'release', 'AngryAndyLeisureCentre.html');

const built = readdirSync(join(DIST, 'assets'));
const jsFile = built.find((f) => /^index-.*\.js$/.test(f));
const cssFile = built.find((f) => /^index-.*\.css$/.test(f));
if (!jsFile || !cssFile) throw new Error('No build found in dist/. Run "npm run build" first.');
const js = readFileSync(join(DIST, 'assets', jsFile), 'utf8');
const css = readFileSync(join(DIST, 'assets', cssFile), 'utf8');
if (js.includes('</script')) throw new Error('Built JS contains </script and cannot be inlined safely');

// images
const manifest = JSON.parse(readFileSync(join(DIST, 'assets', 'manifest.json'), 'utf8'));
const files = new Set([manifest.tiles.file, manifest.objects.file, manifest.icons.file, ...Object.values(manifest.portraits)]);
for (const c of Object.values(manifest.characters)) for (const f of [c.file, c.angry, c.furious]) if (f) files.add(f);
const embedded = {};
for (const f of files) embedded[f] = 'data:image/png;base64,' + readFileSync(join(DIST, 'assets', f)).toString('base64');

// fonts (SIL Open Font License: embedding is allowed)
const GOOGLE = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap';
let fontCss = '';
try {
  const sheet = await (await fetch(GOOGLE, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' } })).text();
  const faces = sheet.split('@font-face').slice(1);
  // keep only the latin subset where Google splits a family into subsets
  for (const face of faces) {
    const range = face.match(/unicode-range:\s*([^;]+);/)?.[1];
    if (range && !range.includes('U+0000-00FF')) continue;
    const url = face.match(/url\((https:[^)]+\.(woff2|ttf))\)/);
    const family = face.match(/font-family:\s*'([^']+)'/)?.[1];
    if (!url || !family) continue;
    const res = await fetch(url[1]);
    if (!res.ok) throw new Error(`${res.status} for ${url[1]}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const fmt = url[2] === 'woff2' ? ['font/woff2', 'woff2'] : ['font/ttf', 'truetype'];
    fontCss += `@font-face{font-family:'${family}';font-style:normal;font-weight:400;font-display:swap;src:url(data:${fmt[0]};base64,${buf.toString('base64')}) format('${fmt[1]}')}\n`;
  }
} catch (e) {
  console.warn('Could not download the fonts; the file will use Google Fonts when online, monospace when offline.', e.message);
}
const fontTag = fontCss ? `<style>${fontCss}</style>` : `<link href="${GOOGLE}" rel="stylesheet">`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#1c1a26">
<title>Angry Andy - Model Leisure Centre</title>
${fontTag}
<style>${css}</style>
</head>
<body>
<canvas id="game" aria-label="Angry Andy - Model Leisure Centre"></canvas>
<div id="loading">Loading Andy...</div>
<div id="touch"><div id="stick"><div id="knob"></div></div><div id="act">ACT</div></div>
<script>window.__ANDY_EMBED = ${JSON.stringify({ manifest, files: embedded })};</script>
<script type="module">
${js}
</script>
</body>
</html>
`;
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`Wrote ${OUT} (${Math.round(html.length / 1024)} KB, ${files.size} images, fonts ${fontCss ? 'embedded' : 'linked'})`);
