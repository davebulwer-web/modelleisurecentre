#!/usr/bin/env node
// Draws every placeholder PNG the game uses, plus public/assets/manifest.json.
//
//   npm run art
//
// No dependencies: pixels are drawn into RGBA buffers and written with a tiny PNG
// encoder (node:zlib). Character looks come from src/data/characters.json.
//
// To use real art instead, replace the PNGs in public/assets with files of the same
// name and layout (see ASSETS.md). Re-running this script overwrites them, so keep
// your replacements somewhere safe or stop running it.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'assets');

// ---------------------------------------------------------------- PNG + canvas

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

class Img {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = new Uint8Array(w * h * 4);
  }
  set(x, y, c) {
    x = Math.round(x);
    y = Math.round(y);
    if (c == null || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const [r, g, b, a] = rgba(c);
    const i = (y * this.w + x) * 4;
    if (a === 255) {
      this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = 255;
    } else if (a > 0) {
      const t = a / 255;
      this.d[i] = Math.round(r * t + this.d[i] * (1 - t));
      this.d[i + 1] = Math.round(g * t + this.d[i + 1] * (1 - t));
      this.d[i + 2] = Math.round(b * t + this.d[i + 2] * (1 - t));
      this.d[i + 3] = Math.max(this.d[i + 3], a);
    }
  }
  get(x, y) {
    const i = (y * this.w + x) * 4;
    return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]];
  }
  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  hline(x0, x1, y, c) { for (let x = x0; x <= x1; x++) this.set(x, y, c); }
  vline(x, y0, y1, c) { for (let y = y0; y <= y1; y++) this.set(x, y, c); }
  frame(x, y, w, h, c) {
    this.hline(x, x + w - 1, y, c); this.hline(x, x + w - 1, y + h - 1, c);
    this.vline(x, y, y + h - 1, c); this.vline(x + w - 1, y, y + h - 1, c);
  }
  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
  }
  blit(src, dx, dy, flipX = false) {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const p = src.get(flipX ? src.w - 1 - x : x, y);
        if (p[3]) this.set(dx + x, dy + y, p);
      }
  }
  outline(c) {
    // 1px dark outline around opaque pixels (on transparent neighbours)
    const add = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)[3]) continue;
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => {
          const X = x + a, Y = y + b;
          return X >= 0 && Y >= 0 && X < this.w && Y < this.h && this.get(X, Y)[3] > 200;
        });
        if (n) add.push([x, y]);
      }
    for (const [x, y] of add) this.set(x, y, c);
  }
  png() {
    const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 4 + 1)] = 0;
      Buffer.from(this.d.buffer, y * this.w * 4, this.w * 4).copy(raw, y * (this.w * 4 + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
  save(rel) {
    const p = join(OUT, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, this.png());
  }
}

function rgba(c) {
  if (Array.isArray(c)) return c.length === 4 ? c : [...c, 255];
  let s = c.replace('#', '');
  if (s.length === 3 || s.length === 4) s = [...s].map((ch) => ch + ch).join('');
  const n = parseInt(s.slice(0, 6), 16);
  const a = s.length === 8 ? parseInt(s.slice(6, 8), 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}
function shade(c, f) {
  const [r, g, b, a] = rgba(c);
  const m = (v) => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f))));
  return [m(r), m(g), m(b), a];
}
function mix(c1, c2, t) {
  const a = rgba(c1), b = rgba(c2);
  return [0, 1, 2].map((i) => Math.round(a[i] * (1 - t) + b[i] * t)).concat(255);
}
let seed = 1234;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

const OUTLINE = '#1a1420';

// ---------------------------------------------------------------- characters
// Sheet layout (every character): 16x24 frames, 3 columns x 6 rows
//   row 0 walk down (stand, step A, step B)   row 1 walk up
//   row 2 walk left                            row 3 walk right
//   row 4 work (seen from behind, typing)      row 5 shout / laugh (facing down)
const FW = 16, FH = 24;

function drawPerson(L, dir, frame, opts = {}) {
  const f = new Img(FW, FH);
  const skin = opts.skin || L.skin;
  const hairC = L.hairColor || '#333';
  const shirt = L.hoodie || L.shirt;
  const large = L.build === 'large';
  const step = frame === 1 ? 1 : frame === 2 ? -1 : 0;
  const bob = frame === 0 ? 0 : 1;
  const tx0 = large ? 3 : 4, tx1 = large ? 12 : 11;

  // legs & shoes
  const legC = L.trousers;
  if (dir === 'down' || dir === 'up' || dir === 'work' || dir === 'shout') {
    const liftL = dir !== 'work' && step === 1 ? 1 : 0, liftR = dir !== 'work' && step === -1 ? 1 : 0;
    if (L.skirt) {
      f.rect(tx0, 17, tx1 - tx0 + 1, 3, L.trousers);
      f.rect(5, 20, 2, 2 - liftL, skin); f.rect(9, 20, 2, 2 - liftR, skin);
    } else {
      f.rect(4, 18, 4, 4 - liftL, legC); f.rect(8, 18, 4, 4 - liftR, legC);
      f.vline(8, 18, 21 - liftR, shade(legC, -0.3));
    }
    f.rect(4, 22 - liftL, 3, 2, L.shoes || '#222'); f.rect(9, 22 - liftR, 3, 2, L.shoes || '#222');
  } else {
    // side view: right facing; left is mirrored later
    const s = step;
    if (L.skirt) {
      f.rect(5, 17, 6, 3, L.trousers);
      f.rect(6 - s, 20, 2, 2, skin); f.rect(8 + s, 20, 2, 2, skin);
    } else {
      f.rect(6 - s, 18, 3, 4, shade(legC, -0.2));
      f.rect(8 + s, 18, 3, 4, legC);
    }
    f.rect(6 - s, 22, 3, 2, L.shoes || '#222'); f.rect(8 + s, 22, 4, 2, L.shoes || '#222');
  }

  const by = bob; // body bob offset (down 1px on step frames)
  // torso
  if (dir === 'left' || dir === 'right') {
    f.rect(5, 10 + by, 6, 8 - by, shirt);
    if (large) f.rect(10, 13 + by, 2, 4, shirt);
    f.hline(5, 10, 17, '#222'); // belt
    if (L.tie && !L.hoodie) f.vline(10, 11 + by, 14 + by, L.tie);
    // arm
    const sw = step;
    f.rect(7 + sw, 11 + by, 2, 5, shade(shirt, -0.15));
    f.rect(7 + sw, 16 + by, 2, 1, skin);
  } else {
    f.rect(tx0, 10 + by, tx1 - tx0 + 1, 8 - by, shirt);
    if (large) f.rect(tx0 + 1, 15, tx1 - tx0 - 1, 2, shade(shirt, -0.1));
    f.hline(tx0, tx1, 17, '#222');
    f.hline(tx0 + 1, tx1 - 1, 10 + by, shade(shirt, 0.15));
    if (dir === 'down' || dir === 'shout') {
      if (L.hoodie) {
        f.vline(7, 11 + by, 16, shade(shirt, -0.3)); f.vline(8, 11 + by, 16, shade(shirt, -0.3));
        f.set(6, 12 + by, '#ddd'); f.set(9, 12 + by, '#ddd');
      } else {
        f.set(7, 10 + by, '#fff'); f.set(8, 10 + by, '#fff');
        if (L.tie) { f.rect(7, 11 + by, 2, 5, L.tie); f.rect(7, 11 + by, 2, 1, shade(L.tie, -0.3)); }
      }
      if (L.lanyard) {
        f.set(5, 11 + by, '#c22'); f.set(6, 12 + by, '#c22'); f.set(6, 13 + by, '#c22');
        f.rect(5, 14 + by, 2, 2, '#f4f4f4'); f.set(5, 14 + by, '#5577aa');
      }
    } else {
      f.set(7, 10 + by, shade(shirt, -0.2)); f.set(8, 10 + by, shade(shirt, -0.2));
    }
    // arms
    const ax0 = tx0 - 2, ax1 = tx1 + 1;
    if (dir === 'work') {
      const k = frame; // hands up at different heights = typing
      f.rect(ax0, 11 + by, 2, 3, shade(shirt, -0.15)); f.rect(ax1, 11 + by, 2, 3, shade(shirt, -0.15));
      f.rect(ax0 + 1, 10 + (k === 1 ? 0 : 1), 2, 1, skin); f.rect(ax1 - 1, 10 + (k === 2 ? 0 : 1), 2, 1, skin);
    } else if (dir === 'shout') {
      f.rect(ax0, 11, 2, 5, shade(shirt, -0.15)); f.rect(ax0, 16, 2, 1, skin);
      if (frame === 2) { f.rect(ax1, 6, 2, 5, shade(shirt, -0.15)); f.rect(ax1, 4, 2, 2, skin); }
      else { f.rect(ax1, 11, 3, 2, shade(shirt, -0.15)); f.rect(ax1 + 2, 10 + frame, 2, 2, skin); }
    } else {
      const sl = dir === 'down' || dir === 'up' ? step : 0;
      f.rect(ax0, 11 + by, 2, 5 - sl, shade(shirt, -0.15)); f.rect(ax0, 16 + by - sl, 2, 1, skin);
      f.rect(ax1, 11 + by, 2, 5 + sl, shade(shirt, -0.15)); f.rect(ax1, 16 + by + sl, 2, 1, skin);
    }
  }

  // head
  const hy = by;
  drawHead16(f, L, dir === 'shout' ? 'down' : dir === 'work' ? 'up' : dir, hy, skin, hairC, opts, dir === 'shout' ? frame : -1);
  if (opts.marks || (dir === 'shout' && opts.shoutMarks)) {
    const m = opts.marksColor || '#ff3030';
    f.set(1, 2, m); f.set(2, 3, m); f.set(1, 4, m);
    f.set(14, 2, m); f.set(13, 3, m); f.set(14, 4, m);
  }

  if (dir === 'left') {
    const g = new Img(FW, FH);
    g.blit(f, 0, 0, true);
    g.outline(OUTLINE);
    return g;
  }
  f.outline(OUTLINE);
  return f;
}

function drawHead16(f, L, dir, hy, skin, hairC, opts, shoutFrame) {
  const style = L.hair;
  const y = (v) => v + hy;
  if (dir === 'left' || dir === 'right') {
    // side head, facing right
    f.rect(5, y(3), 7, 7, skin); f.rect(6, y(2), 5, 1, skin);
    f.set(12, y(7), skin); // nose
    f.set(7, y(6), shade(skin, -0.2)); // ear
    if (style === 'bald') { f.rect(5, y(4), 2, 4, hairC); f.set(7, y(4), hairC); f.set(9, y(3), shade(skin, 0.35)); }
    else if (style === 'helmet') { f.rect(4, y(1), 8, 4, hairC); f.hline(5, 11, y(1), shade(hairC, 0.3)); }
    else if (style === 'cap') { f.rect(5, y(1), 7, 3, hairC); f.rect(11, y(3), 3, 1, hairC); f.rect(5, y(4), 2, 3, '#3a2a1a'); }
    else {
      f.rect(5, y(2), 6, 2, hairC); f.rect(5, y(3), 2, 4, hairC);
      if (style === 'long' || style === 'bob') f.rect(4, y(3), 3, style === 'long' ? 8 : 6, hairC);
      if (style === 'ponytail') f.rect(3, y(4), 2, 5, hairC);
      if (style === 'bun') f.rect(3, y(2), 3, 3, hairC);
      if (style === 'curly') { f.rect(4, y(1), 7, 3, hairC); f.rect(4, y(3), 3, 5, hairC); }
      if (style === 'spiky') { f.set(6, y(1), hairC); f.set(8, y(1), hairC); f.set(10, y(1), hairC); }
    }
    f.set(10, y(6), '#1a1a1a');
    if (L.glasses) { f.hline(9, 11, y(5), '#333'); f.set(11, y(6), '#333'); f.set(9, y(6), '#333'); }
    if (L.beard) { f.rect(7, y(7), 5, 3, hairC); f.set(11, y(8), shade(hairC, -0.4)); }
    else f.set(11, y(8), shade(skin, -0.35));
    f.set(8, y(10), skin); f.set(9, y(10), skin);
    return;
  }
  // front / back head
  f.rect(4, y(3), 8, 7, skin); f.rect(5, y(2), 6, 1, skin);
  f.set(3, y(5), skin); f.set(3, y(6), skin); f.set(12, y(5), skin); f.set(12, y(6), skin);
  f.rect(7, y(10), 2, 1, skin);
  if (dir === 'up') {
    if (style === 'bald') { f.rect(4, y(5), 8, 3, hairC); f.set(7, y(3), shade(skin, 0.35)); }
    else if (style === 'helmet') { f.rect(3, y(1), 10, 5, hairC); f.rect(4, y(6), 8, 2, hairC); }
    else if (style === 'cap') { f.rect(4, y(1), 8, 4, hairC); f.rect(5, y(5), 6, 3, '#3a2a1a'); }
    else {
      f.rect(4, y(2), 8, 7, hairC); f.rect(5, y(1), 6, 1, hairC);
      if (style === 'long') f.rect(3, y(3), 10, 9, hairC);
      if (style === 'bob') f.rect(3, y(3), 10, 6, hairC);
      if (style === 'ponytail') f.rect(7, y(9), 2, 4, hairC);
      if (style === 'bun') f.rect(6, y(0), 4, 2, hairC);
      if (style === 'curly') f.rect(3, y(1), 10, 8, hairC);
      if (style === 'spiky') { f.set(5, y(0), hairC); f.set(8, y(0), hairC); f.set(10, y(0), hairC); }
    }
    return;
  }
  // facing down
  if (style === 'bald') {
    f.rect(4, y(4), 1, 4, hairC); f.rect(11, y(4), 1, 4, hairC); f.set(3, y(4), hairC); f.set(12, y(4), hairC);
    f.set(6, y(3), shade(skin, 0.4)); f.set(7, y(3), shade(skin, 0.3));
  } else if (style === 'cap') {
    f.rect(4, y(1), 8, 3, hairC); f.rect(3, y(4), 10, 1, shade(hairC, -0.3)); f.set(4, y(5), '#3a2a1a'); f.set(11, y(5), '#3a2a1a');
  } else if (style === 'helmet') {
    f.rect(3, y(1), 10, 3, hairC); f.hline(4, 11, y(1), shade(hairC, 0.35)); f.set(3, y(4), hairC); f.set(12, y(4), hairC);
  } else {
    f.rect(5, y(2), 6, 1, hairC); f.rect(4, y(3), 8, 1, hairC); f.set(4, y(4), hairC); f.set(11, y(4), hairC);
    if (style === 'long') { f.rect(3, y(3), 1, 9, hairC); f.rect(12, y(3), 1, 9, hairC); f.rect(4, y(4), 1, 6, hairC); f.rect(11, y(4), 1, 6, hairC); }
    if (style === 'bob') { f.rect(3, y(3), 1, 6, hairC); f.rect(12, y(3), 1, 6, hairC); f.rect(4, y(4), 1, 4, hairC); f.rect(11, y(4), 1, 4, hairC); }
    if (style === 'bun') f.rect(6, y(0), 4, 2, hairC);
    if (style === 'curly') { f.rect(3, y(1), 10, 3, hairC); f.rect(3, y(4), 1, 5, hairC); f.rect(12, y(4), 1, 5, hairC); }
    if (style === 'spiky') { f.set(5, y(1), hairC); f.set(7, y(1), hairC); f.set(9, y(1), hairC); f.set(10, y(1), hairC); }
    if (style === 'ponytail') { f.set(12, y(4), hairC); f.set(13, y(5), hairC); }
  }
  // brows & eyes
  const browC = style === 'bald' ? '#8a8a8a' : shade(hairC, -0.1);
  if (opts.angry) { f.set(5, y(4), browC); f.set(6, y(5), browC); f.set(10, y(4), browC); f.set(9, y(5), browC); }
  else { f.hline(5, 6, y(5), browC); f.hline(9, 10, y(5), browC); }
  if (L.glasses) {
    f.hline(5, 7, y(6), '#2a2a2a'); f.hline(8, 10, y(6), '#2a2a2a');
    f.set(6, y(6), '#e8f4ff'); f.set(9, y(6), '#e8f4ff');
    f.set(6, y(7), '#1a1a1a'); f.set(9, y(7), '#1a1a1a');
  } else {
    f.set(6, y(6), '#1a1a1a'); f.set(9, y(6), '#1a1a1a');
  }
  f.set(8, y(7), shade(skin, -0.2));
  if (L.beard) { f.rect(4, y(7), 8, 3, hairC); f.rect(5, y(10), 6, 1, hairC); }
  // mouth
  if (shoutFrame >= 0 && shoutFrame !== 0) { f.rect(7, y(8), 2, 2, '#5a0e12'); }
  else if (opts.angry) { f.hline(6, 9, y(9), '#7a2020'); f.set(6, y(8), '#7a2020'); }
  else f.hline(7, 8, y(9), shade(skin, -0.4));
}

function personSheet(L, opts = {}) {
  const sheet = new Img(FW * 3, FH * 6);
  const rows = ['down', 'up', 'left', 'right', 'work', 'shout'];
  rows.forEach((dir, r) => {
    for (let c = 0; c < 3; c++) sheet.blit(drawPerson(L, dir, c, opts), c * FW, r * FH);
  });
  return sheet;
}

// 32x32 head-and-shoulders portrait. mood: 0 neutral .. 5 shouting
function portrait(L, mood = 0, bg = '#3a4a6a') {
  const p = new Img(32, 32);
  p.rect(0, 0, 32, 32, bg);
  p.rect(1, 1, 30, 30, shade(bg, 0.12));
  const reds = ['#000000', '#000000', '#e09080', '#e86a5a', '#e04838', '#e04838'];
  const skin = mood >= 2 ? mix(L.skin, reds[mood], [0, 0, 0.25, 0.45, 0.65, 0.7][mood]) : rgba(L.skin);
  const hairC = L.hairColor || '#333';
  // shoulders
  const sh = L.hoodie || L.shirt;
  p.ellipse(16, 33, 14, 7, sh);
  if (L.tie && !L.hoodie) { p.rect(14, 26, 4, 2, '#fff'); p.rect(15, 27, 2, 5, L.tie); }
  p.rect(14, 23, 4, 4, skin);
  // head
  p.ellipse(16, 15, 8.5, 10, skin);
  p.ellipse(7.5, 16, 1.6, 2.4, skin); p.ellipse(24.5, 16, 1.6, 2.4, skin);
  const st = L.hair;
  if (st === 'bald') {
    p.ellipse(8.5, 15, 2, 4.5, hairC); p.ellipse(23.5, 15, 2, 4.5, hairC);
    p.rect(12, 7, 3, 2, shade(skin, 0.35));
  } else if (st === 'cap') {
    p.ellipse(16, 8, 9, 5.5, hairC); p.rect(6, 9, 20, 2, shade(hairC, -0.3)); p.rect(8, 11, 2, 4, '#3a2a1a'); p.rect(22, 11, 2, 4, '#3a2a1a');
  } else if (st === 'helmet') {
    p.ellipse(16, 8, 11, 6, hairC); p.rect(5, 8, 22, 2, hairC); p.hline(9, 22, 4, shade(hairC, 0.4));
  } else {
    p.ellipse(16, 8, 8.5, 4.5, hairC);
    p.rect(8, 8, 2, 5, hairC); p.rect(22, 8, 2, 5, hairC);
    if (st === 'long') { p.rect(6, 9, 4, 18, hairC); p.rect(22, 9, 4, 18, hairC); }
    if (st === 'bob') { p.rect(6, 9, 4, 12, hairC); p.rect(22, 9, 4, 12, hairC); }
    if (st === 'bun') p.ellipse(16, 3.5, 4, 3, hairC);
    if (st === 'curly') { for (let i = 0; i < 9; i++) p.ellipse(7 + i * 2.2, 7 + (i % 2), 2.4, 2.4, hairC); p.rect(6, 9, 3, 12, hairC); p.rect(23, 9, 3, 12, hairC); }
    if (st === 'spiky') for (let i = 0; i < 6; i++) p.rect(9 + i * 3, 2 + (i % 2), 2, 4, hairC);
    if (st === 'ponytail') p.ellipse(25, 12, 2.5, 5, hairC);
  }
  // brows
  const bc = st === 'bald' ? '#7a7a7a' : shade(hairC, -0.15);
  const browTilt = [0, 1, 1, 2, 2, 2][mood];
  for (let i = 0; i < 4; i++) {
    p.set(10 + i, 11 + (browTilt ? Math.floor((i * browTilt) / 3) : 0), bc);
    p.set(21 - i, 11 + (browTilt ? Math.floor((i * browTilt) / 3) : 0), bc);
    p.set(10 + i, 10 + (browTilt ? Math.floor((i * browTilt) / 3) : 0), bc);
    p.set(21 - i, 10 + (browTilt ? Math.floor((i * browTilt) / 3) : 0), bc);
  }
  // eyes
  const eyeY = 14;
  if (L.glasses) {
    p.frame(9, 12, 6, 5, '#222'); p.frame(17, 12, 6, 5, '#222'); p.hline(15, 16, 13, '#222');
    p.rect(10, 13, 4, 3, '#dff0ff'); p.rect(18, 13, 4, 3, '#dff0ff');
  }
  p.rect(11, eyeY, 2, 2, '#1a1a1a'); p.rect(19, eyeY, 2, 2, '#1a1a1a');
  // nose
  p.vline(16, 15, 18, shade(skin, -0.2)); p.set(15, 19, shade(skin, -0.25));
  if (L.beard) { p.ellipse(16, 22, 8, 4.5, hairC); p.rect(8, 15, 2, 7, hairC); p.rect(22, 15, 2, 7, hairC); }
  if (L.headset) {
    for (let k = 0; k < 18; k++) { const t = Math.PI + (k / 17) * Math.PI; p.set(16 + Math.cos(t) * 9.5, 13 + Math.sin(t) * 9.5, '#222'); }
    p.rect(5, 12, 3, 6, '#333'); p.rect(24, 12, 3, 6, '#333');
    p.hline(8, 13, 20, '#333'); p.rect(13, 19, 2, 2, '#555');
  }
  // mouth by mood
  const mc = '#6a1a1a';
  if (mood === 0) p.hline(13, 18, 21, mc);
  else if (mood === 1) { p.hline(13, 18, 21, mc); p.set(13, 22, mc); }
  else if (mood === 2) { p.hline(13, 18, 21, mc); p.set(12, 22, mc); p.set(19, 22, mc); }
  else if (mood === 3) { p.hline(13, 18, 20, mc); p.set(12, 21, mc); p.set(19, 21, mc); p.set(11, 22, mc); p.set(20, 22, mc); }
  else if (mood === 4) { p.rect(12, 20, 8, 3, mc); p.hline(13, 18, 20, '#fff'); p.hline(13, 18, 22, '#fff'); }
  else { p.ellipse(16, 22, 4, 3, '#4a0a0a'); p.hline(14, 18, 20, '#fff'); p.ellipse(16, 23.5, 2, 1, '#c04040'); }
  if (mood >= 3) { // veins / steam
    p.set(21, 6, '#ff2020'); p.set(22, 7, '#ff2020'); p.set(23, 6, '#ff2020'); p.set(22, 5, '#ff2020');
  }
  if (mood >= 4) {
    for (const [x, y] of [[2, 4], [3, 3], [4, 5], [27, 3], [28, 5], [29, 4]]) p.set(x, y, '#ff4040');
    p.set(10, 6, '#ff2020'); p.set(9, 7, '#ff2020'); p.set(11, 7, '#ff2020');
  }
  p.frame(0, 0, 32, 32, OUTLINE);
  return p;
}

// ---------------------------------------------------------------- tiles (16x16)

const TILE_NAMES = [
  'wall_top', 'wall_front', 'door', 'carpet_blue', 'carpet_grey', 'carpet_green', 'lino',
  'tile_blue', 'tile_white', 'server', 'stairs', 'pavement', 'bay', 'road', 'grass', 'tarmac',
  'water', 'lane', 'gym_mat', 'wood', 'carpet_red',
];
function tileImg(name) {
  const t = new Img(16, 16);
  const noise = (base, amt, spread = 0.06) => {
    t.rect(0, 0, 16, 16, base);
    for (let i = 0; i < amt; i++) t.set(Math.floor(rnd() * 16), Math.floor(rnd() * 16), shade(base, (rnd() - 0.5) * spread * 2));
  };
  switch (name) {
    case 'wall_top':
      t.rect(0, 0, 16, 16, '#4a4458'); t.rect(1, 1, 14, 14, '#5c5670'); t.hline(1, 14, 1, '#6e6884'); break;
    case 'wall_front':
      t.rect(0, 0, 16, 16, '#d8cfc0'); t.rect(0, 0, 16, 5, '#5c5670'); t.hline(0, 15, 5, '#3e3a4c');
      t.hline(0, 15, 14, '#a89e8c'); t.hline(0, 15, 15, '#8a8070'); break;
    case 'door':
      noise('#b8a07a', 20); t.hline(0, 15, 0, '#8a7454'); t.hline(0, 15, 15, '#8a7454'); break;
    case 'carpet_blue': noise('#5d6f99', 60, 0.08); break;
    case 'carpet_grey': noise('#7a7b84', 60, 0.08); break;
    case 'carpet_green': noise('#557a62', 60, 0.08); break;
    case 'lino':
      t.rect(0, 0, 16, 16, '#d9d2bf');
      t.rect(0, 0, 8, 8, '#cbc3ad'); t.rect(8, 8, 8, 8, '#cbc3ad'); break;
    case 'tile_blue':
      t.rect(0, 0, 16, 16, '#9cc8dc'); t.hline(0, 15, 7, '#7eaec4'); t.vline(7, 0, 15, '#7eaec4'); t.hline(0, 15, 15, '#7eaec4'); t.vline(15, 0, 15, '#7eaec4'); break;
    case 'tile_white':
      t.rect(0, 0, 16, 16, '#eceff0'); t.hline(0, 15, 7, '#c8cdd0'); t.vline(7, 0, 15, '#c8cdd0'); t.hline(0, 15, 15, '#c8cdd0'); t.vline(15, 0, 15, '#c8cdd0'); break;
    case 'server':
      t.rect(0, 0, 16, 16, '#9aa0a8');
      for (let i = 0; i < 16; i += 4) { t.hline(0, 15, i, '#8a9098'); t.vline(i, 0, 15, '#8a9098'); }
      break;
    case 'stairs':
      t.rect(0, 0, 16, 16, '#8c7a62');
      for (let y = 0; y < 16; y += 4) { t.hline(0, 15, y, '#b09a7c'); t.hline(0, 15, y + 3, '#5e5040'); }
      break;
    case 'pavement':
      t.rect(0, 0, 16, 16, '#b4b0a8'); t.hline(0, 15, 15, '#96928a'); t.vline(15, 0, 15, '#96928a'); t.vline(7, 0, 15, '#a6a29a'); break;
    case 'bay': noise('#4a4c52', 40, 0.1); break;
    case 'road': noise('#3e4046', 40, 0.1); break;
    case 'grass': noise('#5a8a3c', 70, 0.15); for (let i = 0; i < 6; i++) t.set(Math.floor(rnd() * 16), Math.floor(rnd() * 16), '#7aaa4c'); break;
    case 'tarmac': noise('#4a4c52', 40, 0.1); break;
    case 'water':
      t.rect(0, 0, 16, 16, '#3a9ad8');
      for (let i = 0; i < 5; i++) { const x = Math.floor(rnd() * 12), y = Math.floor(rnd() * 16); t.hline(x, x + 3, y, '#6ac0f0'); }
      break;
    case 'lane':
      t.rect(0, 0, 16, 16, '#d8a868');
      for (let y = 1; y < 16; y += 3) t.hline(0, 15, y, '#c89858');
      t.hline(0, 15, 0, '#3a3440'); // gutter edge
      break;
    case 'gym_mat': noise('#3a3c44', 50, 0.12); t.hline(0, 15, 15, '#2e3038'); t.vline(15, 0, 15, '#2e3038'); break;
    case 'wood':
      t.rect(0, 0, 16, 16, '#b88a5a');
      for (let y = 0; y < 16; y += 4) t.hline(0, 15, y, '#a07448');
      t.vline(5, 0, 3, '#a07448'); t.vline(12, 4, 7, '#a07448'); t.vline(3, 8, 11, '#a07448'); t.vline(10, 12, 15, '#a07448');
      break;
    case 'carpet_red':
      noise('#6a2a4a', 40, 0.08);
      for (const [x, y, c] of [[3, 3, '#f0d040'], [11, 5, '#40c0f0'], [6, 11, '#f060c0'], [13, 13, '#60e060']]) t.set(x, y, c);
      break;
  }
  return t;
}

// ---------------------------------------------------------------- objects

function desk() {
  const d = new Img(32, 24);
  d.rect(0, 10, 32, 12, '#a8794a'); d.rect(0, 10, 32, 2, '#c4935e'); d.rect(0, 20, 32, 2, '#7a5530');
  d.rect(1, 22, 2, 2, '#5a3e22'); d.rect(29, 22, 2, 2, '#5a3e22');
  // monitor (screen faces viewer; screen area x10..21, y1..8)
  d.rect(9, 0, 14, 10, '#2a2a30'); d.rect(10, 1, 12, 8, '#1c2a3a');
  d.rect(15, 10, 2, 2, '#2a2a30'); d.rect(13, 12, 6, 1, '#2a2a30');
  // keyboard, mouse, mug, papers
  d.rect(10, 15, 12, 3, '#d8d8d8'); d.hline(11, 20, 16, '#b0b0b0');
  d.rect(24, 15, 2, 3, '#e8e8e8');
  d.rect(3, 13, 5, 6, '#f4f4f4'); d.hline(4, 6, 15, '#aaa'); d.hline(4, 6, 17, '#aaa');
  d.outline(OUTLINE);
  return d;
}
function screen(kind) {
  // 12x8, drawn over the desk monitor at (10,1)
  const s = new Img(12, 8);
  if (kind === 'work') {
    s.rect(0, 0, 12, 8, '#e8eef4'); s.rect(0, 0, 12, 1, '#3a6ab0');
    for (let y = 2; y < 8; y += 2) s.hline(1, 3 + ((y * 7) % 8), y, '#8a9ab0');
  } else if (kind === 'game') {
    s.rect(0, 0, 12, 8, '#101830'); s.rect(2, 5, 2, 2, '#40e040'); s.rect(8, 2, 2, 2, '#e04040');
    s.set(5, 3, '#ffff60'); s.set(6, 3, '#ffff60'); s.hline(0, 11, 7, '#3a3a8a');
  } else if (kind === 'football') {
    s.rect(0, 0, 12, 8, '#2e8a3a'); s.vline(6, 0, 7, '#e8f8e8'); s.frame(0, 2, 2, 4, '#e8f8e8'); s.frame(10, 2, 2, 4, '#e8f8e8');
    s.set(4, 4, '#fff'); s.set(8, 3, '#e03030'); s.set(3, 2, '#3030e0');
  } else if (kind === 'call') {
    s.rect(0, 0, 12, 8, '#202830');
    const faces = ['#e8c0a0', '#a87050', '#f0d0b0', '#c89070'];
    faces.forEach((c, i) => { const x = (i % 2) * 6, y = Math.floor(i / 2) * 4; s.rect(x, y, 5, 3, '#3a4a5a'); s.rect(x + 2, y + 1, 2, 2, c); });
  } else if (kind === 'error') {
    s.rect(0, 0, 12, 8, '#1a4ab8'); s.hline(1, 4, 1, '#fff'); s.hline(1, 9, 3, '#c8d8ff'); s.hline(1, 7, 5, '#c8d8ff'); s.rect(9, 5, 2, 2, '#fff');
  } else if (kind === 'off') {
    s.rect(0, 0, 12, 8, '#1c2a3a'); s.set(2, 1, '#2c3a4a');
  }
  return s;
}
function rack() {
  const r = new Img(16, 28);
  r.rect(1, 0, 14, 28, '#2a2c34'); r.rect(2, 1, 12, 25, '#3a3d48');
  for (let y = 3; y < 25; y += 4) { r.hline(3, 12, y, '#22242c'); r.set(4, y + 1, '#40ff60'); r.set(6, y + 1, y % 8 ? '#ffb030' : '#40ff60'); }
  r.outline(OUTLINE);
  return r;
}
function counter(withKettle) {
  const c = new Img(16, 22);
  c.rect(0, 6, 16, 16, '#c8c4bc'); c.rect(0, 6, 16, 3, '#e8e4dc'); c.rect(2, 11, 12, 9, '#b0aca4'); c.set(12, 15, '#666');
  if (withKettle) {
    c.rect(4, 0, 7, 7, '#e8e8f0'); c.rect(5, 1, 5, 5, '#d0d0dc'); c.rect(11, 2, 2, 3, '#e8e8f0'); c.rect(5, 0, 4, 1, '#333');
    c.rect(1, 3, 2, 3, '#f4f4f4'); // mug
  }
  c.outline(OUTLINE);
  return c;
}
function fridge() {
  const f = new Img(16, 28);
  f.rect(1, 0, 14, 28, '#e8ecf0'); f.hline(1, 14, 10, '#b8bcc0'); f.rect(12, 3, 1, 5, '#888'); f.rect(12, 13, 1, 7, '#888');
  f.rect(4, 14, 3, 3, '#e0c040');
  f.outline(OUTLINE);
  return f;
}
function toilet() {
  const t = new Img(16, 16);
  t.rect(4, 0, 8, 5, '#f4f4f8'); t.ellipse(8, 10, 5, 5, '#f4f4f8'); t.ellipse(8, 10, 3, 3, '#a8d0e0'); t.rect(6, 1, 4, 1, '#ccc');
  t.outline(OUTLINE);
  return t;
}
function sink() {
  const s = new Img(16, 16);
  s.rect(2, 2, 12, 10, '#f4f4f8'); s.ellipse(8, 7, 4, 3, '#b8d8e8'); s.rect(7, 2, 2, 3, '#aaa');
  s.outline(OUTLINE);
  return s;
}
function shower() {
  const s = new Img(32, 32);
  s.rect(2, 2, 28, 28, '#dff0f8'); s.frame(2, 2, 28, 28, '#9ab8c8');
  for (let i = 0; i < 6; i++) s.set(14 + (i % 3) * 2, 13 + Math.floor(i / 3) * 2, '#7a98a8');
  s.rect(2, 0, 2, 32, '#c8c8d0'); // rail
  for (let y = 2; y < 30; y += 3) s.rect(0, y, 3, 2, '#e0a0c0'); // curtain
  s.outline(OUTLINE);
  return s;
}
function printer() {
  const p = new Img(16, 22);
  p.rect(1, 6, 14, 14, '#d8d8dc'); p.rect(1, 6, 14, 3, '#f0f0f4'); p.rect(3, 2, 10, 5, '#f8f8f8'); p.rect(3, 14, 10, 2, '#555');
  p.set(12, 10, '#40e040'); p.rect(1, 20, 14, 2, '#9a9aa0');
  p.outline(OUTLINE);
  return p;
}
function cooler() {
  const c = new Img(16, 26);
  c.rect(4, 0, 8, 10, '#8ac8f0'); c.rect(5, 1, 3, 8, '#b0e0ff');
  c.rect(3, 10, 10, 16, '#e8e8ec'); c.rect(5, 13, 2, 2, '#3070e0'); c.rect(9, 13, 2, 2, '#e04030');
  c.outline(OUTLINE);
  return c;
}
function plant() {
  const p = new Img(16, 24);
  p.rect(4, 16, 8, 8, '#b0603a'); p.hline(3, 12, 16, '#c87048');
  for (const [x, y, r] of [[8, 9, 5], [5, 7, 3], [11, 6, 3], [8, 3, 3]]) p.ellipse(x, y, r, r, '#3a8a3a');
  for (const [x, y] of [[6, 6], [9, 3], [11, 8], [7, 11]]) p.set(x, y, '#5aba5a');
  p.outline(OUTLINE);
  return p;
}
function filing() {
  const f = new Img(16, 24);
  f.rect(2, 0, 12, 24, '#8a909a'); for (let y = 2; y < 22; y += 7) { f.rect(3, y, 10, 6, '#9aa0aa'); f.rect(6, y + 2, 4, 1, '#555'); }
  f.outline(OUTLINE);
  return f;
}
function beanbag() {
  const b = new Img(16, 16);
  b.ellipse(8, 9, 7, 6, '#d04a3a'); b.ellipse(7, 7, 3, 2, '#e86a5a');
  b.outline(OUTLINE);
  return b;
}
function bin() {
  const b = new Img(16, 16);
  b.rect(4, 4, 8, 11, '#5a5a62'); b.rect(3, 3, 10, 2, '#707078'); b.set(6, 2, '#fff'); b.set(8, 1, '#fff');
  b.outline(OUTLINE);
  return b;
}
function whiteboard() {
  const w = new Img(16, 24);
  w.rect(1, 2, 14, 12, '#f8f8f8'); w.frame(1, 2, 14, 12, '#888'); w.hline(3, 10, 5, '#3060c0'); w.hline(3, 8, 8, '#c03030'); w.hline(3, 11, 11, '#3060c0');
  w.vline(3, 14, 23, '#666'); w.vline(12, 14, 23, '#666');
  w.outline(OUTLINE);
  return w;
}
function mess() {
  const m = new Img(16, 10);
  m.ellipse(8, 5, 7, 4, '#7a5a2a'); m.ellipse(6, 4, 3, 2, '#9a7a3a'); m.set(12, 2, '#5a3a1a');
  return m;
}
function sign() {
  const s = new Img(16, 16);
  s.rect(1, 2, 14, 10, '#f4e040'); s.frame(1, 2, 14, 10, '#222'); s.rect(3, 5, 10, 1, '#c02020'); s.rect(3, 8, 7, 1, '#c02020');
  s.vline(7, 12, 15, '#444'); s.vline(8, 12, 15, '#444');
  return s;
}
function dartboard() {
  const d = new Img(16, 16);
  d.ellipse(8, 8, 7.5, 7.5, '#1a1a1a');
  d.ellipse(8, 8, 6.5, 6.5, '#e8dcb8');
  for (let a = 0; a < 20; a += 2) {
    const t = (a / 20) * Math.PI * 2;
    for (let r = 2; r < 6.5; r += 0.5) d.set(8 + Math.cos(t) * r, 8 + Math.sin(t) * r, '#1a1a1a');
  }
  for (let k = 0; k < 40; k++) { const t = (k / 40) * Math.PI * 2; d.set(8 + Math.cos(t) * 6, 8 + Math.sin(t) * 6, k % 2 ? '#c02020' : '#208a40'); }
  for (let k = 0; k < 24; k++) { const t = (k / 24) * Math.PI * 2; d.set(8 + Math.cos(t) * 3.5, 8 + Math.sin(t) * 3.5, k % 2 ? '#c02020' : '#208a40'); }
  d.rect(7, 7, 2, 2, '#c02020'); d.set(8, 8, '#208a40');
  return d;
}
function dart() {
  const d = new Img(3, 7);
  d.set(1, 0, '#ddd'); d.vline(1, 1, 4, '#c8a030'); d.rect(0, 5, 3, 2, '#2060d0');
  return d;
}
function callscreen() {
  // wall TV; the renderer writes "OPEN CALLS" and the live number on the screen area (x2..21, y2..11)
  const s = new Img(24, 14);
  s.rect(0, 0, 24, 14, '#1a1a1e'); s.rect(2, 2, 20, 10, '#0c1a2a'); s.hline(2, 21, 2, '#1c3048');
  s.set(22, 12, '#40e060');
  s.outline(OUTLINE);
  return s;
}
function deskphone() {
  const p = new Img(10, 8);
  p.rect(1, 3, 8, 5, '#d8cfb0'); p.rect(2, 4, 6, 3, '#c4ba98');
  p.rect(0, 0, 10, 3, '#3a3a3a'); p.rect(0, 0, 2, 4, '#3a3a3a'); p.rect(8, 0, 2, 4, '#3a3a3a');
  for (const [x, y] of [[3, 5], [5, 5], [7, 5]]) p.set(x, y, '#666');
  return p;
}
function stairsArrow() {
  const s = new Img(16, 16);
  s.rect(6, 6, 4, 8, '#f8f0c0'); for (let i = 0; i < 5; i++) s.hline(8 - i, 7 + i, 2 + i, '#f8f0c0');
  s.outline('#5a4a2a');
  return s;
}


// ---------------------------------------------------------------- leisure centre objects

function treadmill() {
  const t = new Img(16, 24);
  t.rect(2, 8, 12, 15, '#2a2a30'); t.rect(4, 10, 8, 12, '#4a4a54');
  for (let y = 11; y < 22; y += 2) t.hline(4, 11, y, '#3a3a44');
  t.rect(1, 2, 2, 8, '#888'); t.rect(13, 2, 2, 8, '#888'); t.rect(1, 1, 14, 3, '#9aa0a8'); t.rect(5, 1, 6, 2, '#204060');
  t.outline(OUTLINE);
  return t;
}
function bench() {
  const b = new Img(16, 16);
  b.rect(2, 4, 12, 6, '#202024'); b.rect(3, 5, 10, 4, '#c03030'); b.rect(3, 10, 2, 4, '#888'); b.rect(11, 10, 2, 4, '#888');
  b.hline(0, 15, 2, '#b0b0b8'); b.rect(0, 0, 2, 5, '#303030'); b.rect(14, 0, 2, 5, '#303030');
  b.outline(OUTLINE);
  return b;
}
function weights() {
  const w = new Img(16, 24);
  w.rect(2, 2, 2, 20, '#555'); w.rect(12, 2, 2, 20, '#555');
  for (let i = 0; i < 4; i++) { const y = 5 + i * 5; w.hline(3, 12, y, '#9aa0a8'); w.rect(4, y - 1, 2, 3, '#202020'); w.rect(10, y - 1, 2, 3, '#202020'); }
  w.outline(OUTLINE);
  return w;
}
function mirror() {
  const m = new Img(16, 12);
  m.rect(0, 0, 16, 10, '#c8e0f0'); m.frame(0, 0, 16, 10, '#888'); for (let i = 0; i < 4; i++) m.set(3 + i, 6 - i, '#fff');
  return m;
}
function lockers() {
  const l = new Img(16, 24);
  l.rect(0, 0, 16, 24, '#4a7ab0'); l.vline(7, 0, 23, '#2a4a70'); l.hline(0, 15, 11, '#2a4a70');
  for (const [x, y] of [[3, 4], [11, 4], [3, 16], [11, 16]]) { l.rect(x - 1, y, 3, 1, '#2a4a70'); l.set(x + 1, y + 3, '#f0d040'); }
  l.outline(OUTLINE);
  return l;
}
function benchWood() {
  const b = new Img(16, 16);
  b.rect(0, 5, 16, 5, '#b88a5a'); b.hline(0, 15, 5, '#d0a070'); b.rect(1, 10, 2, 4, '#7a5530'); b.rect(13, 10, 2, 4, '#7a5530');
  b.outline(OUTLINE);
  return b;
}
function counterWith(top) {
  const c = new Img(16, 22);
  c.rect(0, 6, 16, 16, '#9a6a3a'); c.rect(0, 6, 16, 3, '#c8a070'); c.rect(1, 10, 14, 10, '#8a5a2a'); c.vline(8, 10, 19, '#7a4a20');
  top?.(c);
  c.outline(OUTLINE);
  return c;
}
function deskFront(pc) {
  const d = new Img(16, 22);
  d.rect(0, 6, 16, 16, '#2a5a8a'); d.rect(0, 6, 16, 3, '#e8e8f0'); d.rect(0, 12, 16, 2, '#f0d040');
  if (pc) { d.rect(3, 0, 10, 7, '#2a2a30'); d.rect(4, 1, 8, 5, '#3a7ab0'); d.hline(5, 9, 3, '#9cf'); }
  d.outline(OUTLINE);
  return d;
}
function cafeTable() {
  const t = new Img(16, 20);
  t.ellipse(8, 7, 7, 4, '#f0ece0'); t.ellipse(8, 7, 5, 2.5, '#e0dcd0'); t.rect(7, 10, 2, 7, '#555'); t.rect(4, 17, 8, 2, '#555');
  t.rect(5, 4, 2, 3, '#fff'); t.set(6, 5, '#6a3a1a'); t.rect(10, 5, 3, 2, '#e0b040');
  t.outline(OUTLINE);
  return t;
}
function vending() {
  const v = new Img(16, 28);
  v.rect(0, 0, 16, 28, '#c02a2a'); v.rect(2, 2, 9, 18, '#1a2a3a');
  for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) v.rect(3 + k * 3, 3 + r * 4, 2, 3, ['#f0d040', '#40c040', '#4080f0', '#f080c0'][(r + k) % 4]);
  v.rect(12, 4, 3, 6, '#ddd'); v.set(13, 6, '#222'); v.rect(3, 22, 8, 3, '#111'); v.hline(1, 14, 0, '#e04040');
  v.outline(OUTLINE);
  return v;
}
function turnstile() {
  const t = new Img(16, 16);
  t.rect(1, 4, 4, 10, '#9aa0a8'); t.rect(1, 4, 4, 2, '#c8ccd0'); t.rect(5, 7, 9, 2, '#c8ccd0'); t.set(3, 8, '#40e040');
  t.outline(OUTLINE);
  return t;
}
function leaflets() {
  const l = new Img(16, 24);
  l.rect(2, 4, 12, 18, '#7a5530');
  for (let i = 0; i < 3; i++) { l.rect(3, 6 + i * 5, 4, 4, ['#f04040', '#40a0f0', '#f0d040'][i]); l.rect(9, 6 + i * 5, 4, 4, ['#40c040', '#f080c0', '#fff'][i]); }
  l.outline(OUTLINE);
  return l;
}
function ballRack() {
  const b = new Img(16, 24);
  b.rect(1, 6, 14, 16, '#3a3a44'); b.rect(2, 7, 12, 1, '#5a5a64');
  ['#c03030', '#3050c0', '#30a050', '#f0d040', '#8a3ac8', '#202020'].forEach((c, i) => b.ellipse(4.5 + (i % 3) * 3.5, 10 + Math.floor(i / 3) * 6, 1.8, 1.8, c));
  b.outline(OUTLINE);
  return b;
}
function pins() {
  // pins at the end of a lane, seen from above at an angle (16x32, covers two lane rows)
  const p = new Img(16, 32);
  p.rect(9, 0, 7, 32, '#1a1a20'); // pinsetter
  const pos = [[3, 16], [5, 12], [5, 20], [7, 8], [7, 16], [7, 24]];
  for (const [x, y] of pos) { p.rect(x, y - 2, 2, 4, '#f4f4f4'); p.set(x, y - 1, '#c02020'); p.set(x + 1, y - 1, '#c02020'); }
  return p;
}
function scoreboard() {
  const s = new Img(48, 12);
  s.rect(0, 0, 48, 12, '#101018'); s.frame(0, 0, 48, 12, '#444');
  for (let i = 0; i < 6; i++) s.rect(3 + i * 7, 3, 5, 6, i % 2 ? '#30c0f0' : '#f0d040');
  return s;
}
function lifeguardChair() {
  const c = new Img(16, 32);
  c.vline(2, 8, 31, '#f4f4f4'); c.vline(13, 8, 31, '#f4f4f4'); c.hline(2, 13, 20, '#f4f4f4'); c.hline(2, 13, 27, '#f4f4f4');
  c.rect(2, 10, 12, 3, '#d83030'); c.rect(3, 2, 10, 8, '#d83030'); c.rect(4, 3, 8, 2, '#f06060');
  c.outline(OUTLINE);
  return c;
}
function lounger() {
  const l = new Img(16, 16);
  l.rect(3, 1, 10, 14, '#f4f4f4'); l.rect(4, 2, 8, 4, '#40a0e0'); for (let y = 7; y < 14; y += 2) l.hline(4, 11, y, '#40a0e0');
  l.outline(OUTLINE);
  return l;
}
function poolSign() {
  const s = new Img(16, 16);
  s.rect(0, 1, 16, 10, '#f4f4f4'); s.frame(0, 1, 16, 10, '#c02020');
  s.ellipse(8, 6, 3.5, 3.5, '#c02020'); s.ellipse(8, 6, 2.2, 2.2, '#f4f4f4'); for (let i = 0; i < 6; i++) s.set(5 + i, 3 + i, '#c02020');
  return s;
}
function noticeboard() {
  const n = new Img(24, 14);
  n.rect(0, 0, 24, 14, '#b08050'); n.rect(1, 1, 22, 12, '#c8a070');
  n.rect(3, 2, 6, 7, '#fff'); n.rect(11, 3, 5, 5, '#f0d040'); n.rect(17, 2, 5, 8, '#9cf'); n.set(5, 2, '#c02020'); n.set(13, 3, '#2050c0');
  return n;
}
function spill(kind) {
  const m = new Img(16, 10);
  if (kind === 'puddle') { m.ellipse(8, 5, 7, 4, '#6ab8e8a0'); m.ellipse(6, 4, 3, 1.5, '#c8ecffc0'); }
  else if (kind === 'sick') { m.ellipse(8, 5, 7, 4, '#9ab83a'); m.ellipse(6, 4, 3, 2, '#c0d860'); m.set(11, 6, '#e8c040'); m.set(4, 6, '#e8c040'); m.set(9, 3, '#e8c040'); }
  else { m.rect(2, 3, 5, 4, '#e03030'); m.rect(3, 4, 3, 1, '#f0d040'); m.rect(9, 5, 5, 4, '#3060e0'); m.rect(10, 6, 3, 1, '#fff'); m.set(7, 1, '#f0d040'); m.set(13, 2, '#c8a060'); }
  return m;
}

// ---------------------------------------------------------------- UI icons (16x16)

const ICONS = ['car', 'toilet', 'rant', 'fun', 'video', 'boss', 'shower', 'tea', 'bladder', 'check', 'cross', 'clock', 'warning', 'sound_on', 'sound_off', 'star', 'invoice', 'darts', 'window', 'phone', 'mobile', 'walk', 'screen', 'ai', 'jam', 'fix', 'thief', 'card', 'complaint', 'whistle', 'mop', 'pins', 'coin'];
function icon(name) {
  const i = new Img(16, 16);
  switch (name) {
    case 'car': i.rect(2, 6, 12, 5, '#e04040'); i.rect(4, 3, 8, 4, '#e04040'); i.rect(5, 4, 6, 2, '#9cd'); i.rect(3, 11, 3, 2, '#222'); i.rect(10, 11, 3, 2, '#222'); break;
    case 'toilet': i.rect(4, 1, 8, 5, '#fff'); i.ellipse(8, 10, 5, 4, '#fff'); i.ellipse(8, 10, 3, 2, '#8cd'); break;
    case 'rant': i.rect(2, 6, 4, 4, '#ddd'); for (let k = 0; k < 6; k++) i.vline(6 + k, 6 - k, 9 + k, '#e8c040'); i.set(14, 3, '#f44'); i.set(14, 8, '#f44'); i.set(14, 13, '#f44'); break;
    case 'fun': i.rect(1, 5, 14, 7, '#7a7a8a'); i.rect(3, 7, 3, 1, '#222'); i.rect(4, 6, 1, 3, '#222'); i.set(11, 7, '#e33'); i.set(12, 9, '#3a3'); break;
    case 'video': i.rect(1, 4, 10, 8, '#4a8ae0'); for (let k = 0; k < 4; k++) i.vline(11 + k, 6 - k, 9 + k, '#4a8ae0'); i.rect(3, 6, 3, 3, '#fff'); break;
    case 'boss': i.rect(4, 2, 8, 7, '#efc6a4'); i.rect(4, 2, 8, 2, '#ddd'); i.set(6, 5, '#222'); i.set(9, 5, '#222'); i.rect(3, 10, 10, 6, '#2a2a3a'); i.rect(7, 10, 2, 5, '#c8a030'); break;
    case 'shower': i.rect(3, 1, 8, 2, '#aaa'); i.rect(9, 1, 2, 4, '#aaa'); for (let k = 0; k < 8; k++) i.set(5 + (k % 4) * 2, 6 + Math.floor(k / 4) * 3 + (k % 2), '#6ac'); break;
    case 'tea': i.rect(3, 5, 8, 8, '#f4f4f4'); i.rect(4, 6, 6, 2, '#a0602a'); i.rect(11, 7, 2, 4, '#f4f4f4'); i.set(5, 2, '#ccc'); i.set(7, 1, '#ccc'); i.set(9, 3, '#ccc'); break;
    case 'bladder': i.ellipse(8, 10, 5, 5, '#f0d040'); for (let k = 0; k < 5; k++) i.hline(8 - k, 8 + k, 1 + k + 1, '#f0d040'); break;
    case 'check': i.rect(1, 1, 14, 14, '#2a8a3a'); for (let k = 0; k < 3; k++) i.set(4 + k, 8 + k, '#fff'); for (let k = 0; k < 6; k++) i.set(7 + k, 9 - k, '#fff'); break;
    case 'cross': i.rect(1, 1, 14, 14, '#c83030'); for (let k = 0; k < 8; k++) { i.set(4 + k, 4 + k, '#fff'); i.set(11 - k, 4 + k, '#fff'); } break;
    case 'clock': i.ellipse(8, 8, 7, 7, '#f4f4f4'); i.vline(8, 3, 8, '#222'); i.hline(8, 11, 8, '#222'); break;
    case 'warning': for (let k = 0; k < 7; k++) i.hline(8 - k, 7 + k, 2 + k * 2, '#f0c020'), i.hline(8 - k, 7 + k, 3 + k * 2, '#f0c020'); i.rect(7, 6, 2, 5, '#222'); i.rect(7, 12, 2, 1, '#222'); break;
    case 'sound_on': i.rect(2, 6, 3, 4, '#ddd'); for (let k = 0; k < 4; k++) i.vline(5 + k, 6 - k, 9 + k, '#ddd'); i.vline(11, 5, 10, '#ddd'); i.vline(13, 3, 12, '#ddd'); break;
    case 'sound_off': i.rect(2, 6, 3, 4, '#888'); for (let k = 0; k < 4; k++) i.vline(5 + k, 6 - k, 9 + k, '#888'); for (let k = 0; k < 5; k++) { i.set(10 + k, 5 + k, '#e44'); i.set(14 - k, 5 + k, '#e44'); } break;
    case 'invoice': i.rect(3, 1, 10, 14, '#f8f8f8'); i.hline(5, 10, 4, '#999'); i.hline(5, 10, 6, '#999'); i.hline(5, 8, 8, '#999'); for (let k = 0; k < 7; k++) i.set(4 + k, 12 - (k % 3 === 1 ? 1 : 0), '#2040c0'); i.set(11, 10, '#2040c0'); break;
    case 'darts': i.ellipse(7, 9, 6, 6, '#1a1a1a'); i.ellipse(7, 9, 4.5, 4.5, '#e8dcb8'); i.ellipse(7, 9, 2.5, 2.5, '#c02020'); i.set(7, 9, '#208a40'); for (let k = 0; k < 5; k++) i.set(8 + k, 8 - k, '#c8a030'); i.rect(13, 1, 2, 2, '#2060d0'); break;
    case 'window': i.rect(1, 2, 14, 12, '#7aa8d8'); i.frame(1, 2, 14, 12, '#e8e8e8'); i.vline(8, 2, 13, '#e8e8e8'); i.hline(1, 14, 8, '#e8e8e8'); i.rect(4, 4, 2, 2, '#f0d070'); i.rect(4, 6, 2, 2, '#f2a0b8'); break;
    case 'phone': i.rect(2, 3, 12, 3, '#222'); i.rect(2, 3, 3, 5, '#222'); i.rect(11, 3, 3, 5, '#222'); i.rect(4, 9, 8, 5, '#d8cfb0'); i.rect(6, 10, 4, 3, '#999'); i.set(1, 1, '#f44'); i.set(14, 1, '#f44'); break;
    case 'mobile': i.rect(4, 1, 8, 14, '#222'); i.rect(5, 2, 6, 10, '#6ac8f0'); i.rect(7, 13, 2, 1, '#888'); i.set(2, 5, '#f44'); i.set(1, 7, '#f44'); i.set(13, 5, '#f44'); i.set(14, 7, '#f44'); break;
    case 'walk': i.rect(3, 8, 9, 4, '#8a5a32'); i.rect(9, 6, 4, 6, '#8a5a32'); i.rect(2, 12, 12, 2, '#3a2a1a'); i.hline(4, 8, 9, '#c8a070'); i.set(1, 4, '#9cd'); i.set(3, 3, '#9cd'); break;
    case 'screen': i.rect(1, 2, 14, 10, '#222'); i.rect(2, 3, 12, 8, '#2a4a6a'); i.hline(3, 9, 5, '#9cf'); i.hline(3, 7, 8, '#9cf'); i.rect(7, 12, 2, 2, '#555'); i.ellipse(13, 3, 2.6, 2.6, '#e03030'); break;
    case 'ai': i.rect(2, 4, 12, 8, '#333'); i.rect(3, 5, 10, 6, '#7a5ac8'); i.rect(1, 12, 14, 2, '#888'); i.set(8, 6, '#fff'); i.set(7, 7, '#fff'); i.set(9, 7, '#fff'); i.set(8, 8, '#fff'); i.set(12, 2, '#f0d040'); i.set(13, 1, '#f0d040'); break;
    case 'jam': i.rect(1, 5, 11, 8, '#d8d8dc'); i.rect(3, 2, 7, 4, '#f8f8f8'); i.rect(3, 10, 7, 1, '#555'); i.rect(13, 2, 2, 7, '#e03030'); i.rect(13, 11, 2, 2, '#e03030'); break;
    case 'fix': for (let k = 0; k < 9; k++) i.rect(3 + k, 12 - k, 2, 2, '#b8b8c0'); i.rect(10, 1, 5, 5, '#b8b8c0'); i.rect(12, 2, 2, 2, [0, 0, 0, 0]); i.rect(1, 12, 4, 3, '#b8b8c0'); break;
    case 'thief': i.rect(3, 6, 8, 8, '#f4f4f4'); i.rect(11, 8, 2, 4, '#f4f4f4'); i.rect(4, 7, 6, 2, '#6a3a1a'); i.rect(2, 2, 12, 3, '#222'); i.rect(4, 3, 2, 1, '#fff'); i.rect(10, 3, 2, 1, '#fff'); break;
    case 'card': i.rect(1, 3, 14, 10, '#2a7ab0'); i.rect(1, 5, 14, 2, '#f0d040'); i.rect(3, 8, 4, 4, '#efc6a4'); i.hline(8, 13, 9, '#fff'); i.hline(8, 11, 11, '#fff'); break;
    case 'complaint': i.rect(1, 2, 14, 9, '#fff'); for (let k = 0; k < 3; k++) i.set(4 + k, 11 + k, '#fff'); i.rect(7, 3, 2, 5, '#e03030'); i.rect(7, 9, 2, 1, '#e03030'); break;
    case 'whistle': i.ellipse(9, 9, 5, 4, '#c8ccd0'); i.rect(1, 6, 7, 3, '#c8ccd0'); i.ellipse(9, 9, 2, 2, '#888'); i.set(12, 3, '#ff4040'); i.set(14, 5, '#ff4040'); i.set(13, 1, '#ff4040'); break;
    case 'mop': for (let k = 0; k < 9; k++) i.set(10 - k * 0.6, 1 + k, '#b08050'); i.rect(1, 10, 9, 3, '#e8e8e8'); for (let k = 0; k < 4; k++) i.vline(2 + k * 2, 13, 15, '#d0d0d0'); i.ellipse(12, 13, 3, 1.5, '#6ab8e8'); break;
    case 'pins': for (const x of [3, 7, 11]) { i.rect(x, 4, 2, 9, '#f4f4f4'); i.rect(x, 6, 2, 1, '#e03030'); i.rect(x, 3, 2, 1, '#f4f4f4'); } i.ellipse(8, 14, 3, 1.5, '#303030'); break;
    case 'coin': i.ellipse(8, 8, 6, 6, '#e8c040'); i.ellipse(8, 8, 4, 4, '#f4d860'); i.rect(7, 5, 2, 6, '#c8a030'); break;
    case 'star': for (let k = 0; k < 6; k++) i.hline(8 - k, 7 + k, 7, '#f0d040'); i.rect(6, 2, 4, 12, '#f0d040'); i.rect(2, 6, 12, 3, '#f0d040'); break;
  }
  i.outline(OUTLINE);
  return i;
}

// ---------------------------------------------------------------- build everything

function packRow(items, pad = 1) {
  const w = items.reduce((s, it) => s + it.img.w + pad, 0);
  const h = Math.max(...items.map((it) => it.img.h));
  const sheet = new Img(w, h);
  const frames = {};
  let x = 0;
  for (const it of items) {
    sheet.blit(it.img, x, 0);
    frames[it.name] = { x, y: 0, w: it.img.w, h: it.img.h, ox: it.ox ?? 0, oy: it.oy ?? 0 };
    x += it.img.w + pad;
  }
  return { sheet, frames };
}

const characters = JSON.parse(readFileSync(join(ROOT, 'src/data/characters.json'), 'utf8')).characters;
const manifest = {
  _comment: 'Generated by tools/make-placeholder-art.mjs. See ASSETS.md for how to replace any image.',
  characterLayout: {
    frameW: FW, frameH: FH,
    anims: {
      down: { row: 0, frames: [1, 0, 2, 0] }, up: { row: 1, frames: [1, 0, 2, 0] },
      left: { row: 2, frames: [1, 0, 2, 0] }, right: { row: 3, frames: [1, 0, 2, 0] },
      work: { row: 4, frames: [0, 1, 0, 2] }, shout: { row: 5, frames: [0, 1, 2, 1] },
    },
    standFrame: 0,
  },
  characters: {},
  portraits: {},
  tiles: { file: 'tiles/tiles.png', size: 16, names: TILE_NAMES },
  objects: { file: 'sprites/objects.png', frames: {} },
  icons: { file: 'ui/icons.png', size: 16, names: ICONS },
};

for (const ch of characters) {
  if (ch.group === 'portrait') continue; // the Area Manager and cold callers are only ever portraits
  personSheet(ch.look).save(`sprites/${ch.id}.png`);
  manifest.characters[ch.id] = { file: `sprites/${ch.id}.png` };
}
// Andy gets two extra sheets as his anger rises
const andy = characters.find((c) => c.id === 'andy');
personSheet({ ...andy.look, skin: '#f09a84' }, { angry: true, shoutMarks: true }).save('sprites/andy_angry.png');
personSheet({ ...andy.look, skin: '#e8604e' }, { angry: true, marks: true }).save('sprites/andy_furious.png');
manifest.characters.andy = { file: 'sprites/andy.png', angry: 'sprites/andy_angry.png', furious: 'sprites/andy_furious.png' };

// portraits
const moods = ['neutral', 'annoyed', 'irritated', 'angry', 'furious', 'shouting'];
moods.forEach((m, i) => {
  portrait(andy.look, i, ['#3a5a7a', '#4a5a7a', '#6a5a6a', '#7a4a4a', '#8a3030', '#9a2020'][i]).save(`portraits/andy_${m}.png`);
  manifest.portraits[`andy_${m}`] = `portraits/andy_${m}.png`;
});
for (const ch of characters) {
  if (ch.id === 'andy') continue;
  portrait(ch.look, 0, ch.id === 'manager' ? '#5a4a2a' : '#3a4a5a').save(`portraits/${ch.id}.png`);
  manifest.portraits[ch.id] = `portraits/${ch.id}.png`;
}

// tiles
const tiles = new Img(16 * TILE_NAMES.length, 16);
TILE_NAMES.forEach((n, i) => tiles.blit(tileImg(n), i * 16, 0));
tiles.save('tiles/tiles.png');

// objects (ox/oy = draw offset from the object's tile top-left)
const objs = packRow([
  { name: 'desk', img: desk(), oy: -8 },
  { name: 'screen_off', img: screen('off') }, { name: 'screen_work', img: screen('work') },
  { name: 'screen_game', img: screen('game') }, { name: 'screen_football', img: screen('football') },
  { name: 'screen_call', img: screen('call') }, { name: 'screen_error', img: screen('error') },
  { name: 'rack', img: rack(), oy: -12 },
  { name: 'counter', img: counter(false), oy: -6 }, { name: 'kettle', img: counter(true), oy: -6 },
  { name: 'fridge', img: fridge(), oy: -12 },
  { name: 'toilet', img: toilet() }, { name: 'sink', img: sink() }, { name: 'shower', img: shower() },
  { name: 'printer', img: printer(), oy: -6 }, { name: 'cooler', img: cooler(), oy: -10 },
  { name: 'plant', img: plant(), oy: -8 }, { name: 'filing', img: filing(), oy: -8 },
  { name: 'beanbag', img: beanbag() }, { name: 'bin', img: bin() }, { name: 'whiteboard', img: whiteboard(), oy: -8 },
  { name: 'deskphone', img: deskphone() },
  { name: 'callscreen', img: callscreen(), oy: 1 },
  { name: 'dartboard', img: dartboard(), oy: 2 }, { name: 'dart', img: dart() },
  { name: 'mess', img: mess(), oy: 4 }, { name: 'out_of_order', img: sign() }, { name: 'stairs_up', img: stairsArrow() },
  { name: 'treadmill', img: treadmill(), oy: -8 }, { name: 'bench', img: bench() }, { name: 'weights', img: weights(), oy: -8 },
  { name: 'mirror', img: mirror(), oy: -4 }, { name: 'lockers', img: lockers(), oy: -8 }, { name: 'bench_wood', img: benchWood() },
  { name: 'coffee_machine', img: counterWith((c) => { c.rect(3, 0, 10, 8, '#303038'); c.rect(4, 1, 8, 3, '#c0c0c8'); c.rect(7, 4, 2, 2, '#888'); c.rect(6, 6, 4, 1, '#fff'); c.set(10, 2, '#e03030'); }), oy: -6 },
  { name: 'till', img: counterWith((c) => { c.rect(4, 2, 8, 5, '#303038'); c.rect(5, 3, 6, 2, '#40c060'); }), oy: -6 },
  { name: 'cakes', img: counterWith((c) => { c.rect(2, 3, 12, 4, '#e8f0ff'); c.rect(3, 4, 3, 2, '#c87040'); c.rect(7, 4, 3, 2, '#f0a0c0'); c.rect(11, 4, 2, 2, '#e0c060'); }), oy: -6 },
  { name: 'cafe_counter', img: counterWith(), oy: -6 },
  { name: 'desk_front', img: deskFront(false), oy: -6 }, { name: 'reception_pc', img: deskFront(true), oy: -6 },
  { name: 'cafe_table', img: cafeTable(), oy: -2 }, { name: 'vending', img: vending(), oy: -12 }, { name: 'turnstile', img: turnstile() },
  { name: 'leaflets', img: leaflets(), oy: -8 }, { name: 'ball_rack', img: ballRack(), oy: -8 }, { name: 'pins', img: pins() },
  { name: 'scoreboard', img: scoreboard(), oy: 2 }, { name: 'lifeguard_chair', img: lifeguardChair(), oy: -16 }, { name: 'lounger', img: lounger() },
  { name: 'sign_pool', img: poolSign(), oy: 1 }, { name: 'noticeboard', img: noticeboard(), oy: 1 },
  { name: 'puddle', img: spill('puddle'), oy: 3 }, { name: 'sick', img: spill('sick'), oy: 3 }, { name: 'litter', img: spill('litter'), oy: 3 },
]);
objs.sheet.save('sprites/objects.png');
manifest.objects.frames = objs.frames;


// icons
const icons = new Img(16 * ICONS.length, 16);
ICONS.forEach((n, i) => icons.blit(icon(n), i * 16, 0));
icons.save('ui/icons.png');

writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${Object.keys(manifest.characters).length} character sheets, ${Object.keys(manifest.portraits).length} portraits, tiles, objects and icons to public/assets`);
