
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
const CAST = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'characters.json'), 'utf8')).characters;

function line(img, x0, y0, x1, y1, c, thick = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
    for (let t = 0; t < thick; t++) img.set(x + (Math.abs(y1 - y0) > Math.abs(x1 - x0) ? t : 0), y + (Math.abs(y1 - y0) > Math.abs(x1 - x0) ? 0 : t), c);
  }
}

// ---------------------------------------------------------------- skiers
// Sheet layout (every character): 24x32 frames in one row, feet near the bottom centre.
//   0 down (straight down the hill, facing camera)  1 slight right  2 diagonal right
//   3 side right (traversing / stopped)  4 crashed in the snow  5 jumping  6 tuck
//   7 standing, poles planted  8 shouting / waving  9 sitting in the snow
// Left-facing poses are the right ones mirrored by the game.
const FW = 24, FH = 32;
const FRAMES = ['down', 'slight', 'diag', 'side', 'crash', 'jump', 'tuck', 'stand', 'shout', 'sit'];

function headColours(L, mood) {
  const skin = mood ? mix(L.skin, '#e02818', Math.min(0.55, mood * 0.11)) : rgba(L.skin);
  return { skin, hair: L.hairColor || '#333' };
}

/** 8x8 head. facing: 0 front, 1 slight right, 2 three-quarter right, 3 profile right. */
function drawHead(f, L, cx, top, facing, mood = 0, shouting = false) {
  const { skin, hair } = headColours(L, mood);
  const x0 = cx - 4;
  f.rect(x0 + 1, top, 6, 1, skin);
  f.rect(x0, top + 1, 8, 6, skin);
  f.rect(x0 + 1, top + 7, 6, 1, skin);
  const shiftEye = [0, 1, 2, 3][facing];
  const eyes = facing === 3 ? [x0 + 6] : [x0 + 2 + shiftEye, x0 + 5 + shiftEye].filter((x) => x <= x0 + 7);
  // hair styles
  const h = L.hair;
  if (h === 'bald') {
    f.rect(x0, top + 2, 1, 3, hair); f.rect(x0 + 7, top + 2, 1, 3, hair);
    if (facing >= 2) f.rect(x0, top + 1, 2, 4, hair);
    f.set(x0 + 2 + (facing > 1 ? 1 : 0), top + 1, shade(skin, 0.35));
  } else if (h === 'slick' || h === 'short') {
    f.rect(x0, top, 8, 2, hair); f.set(x0 + 1, top - 1, hair); f.rect(x0 + 2, top - 1, 4, 1, hair);
    f.rect(x0, top + 2, 1, 2, hair); f.rect(x0 + 7, top + 2, 1, 2, hair);
    if (facing >= 2) f.rect(x0, top, 3, 5, hair);
    if (h === 'slick') f.set(x0 + 5, top, shade(hair, 0.4));
  } else if (h === 'ginger') {
    f.rect(x0 - 1, top - 1, 10, 3, hair); f.set(x0 + 1, top - 2, hair); f.set(x0 + 4, top - 2, hair); f.set(x0 + 6, top - 2, hair);
    f.rect(x0 - 1, top + 2, 2, 3, hair); f.rect(x0 + 7, top + 2, 2, 3, hair);
    if (facing >= 2) f.rect(x0 - 1, top, 4, 5, hair);
  } else if (h === 'beanie' || h === 'bobble') {
    const under = L.hairUnder || hair;
    if (h === 'bobble') f.rect(x0 + 1, top + 2, 6, 1, under);
    f.rect(x0, top - 2, 8, 4, hair); f.rect(x0 + 1, top - 3, 6, 1, hair);
    f.hline(x0 - 1, x0 + 8, top + 1, shade(hair, -0.25));
    if (h === 'bobble') { f.rect(x0 + 3, top - 5, 2, 2, L.bobble || '#fff'); f.set(x0 + 2, top - 4, L.bobble || '#fff'); f.set(x0 + 5, top - 4, L.bobble || '#fff'); }
    if (h === 'bobble' && L.hairUnder) { f.rect(x0 - 1, top + 2, 1, 4, under); f.rect(x0 + 8, top + 2, 1, 4, under); }
  } else if (h === 'cap') {
    f.rect(x0, top + 2, 1, 2, L.hairUnder || '#432'); f.rect(x0 + 7, top + 2, 1, 2, L.hairUnder || '#432');
    f.rect(x0, top - 1, 8, 3, hair); f.rect(x0 + 1, top - 2, 6, 1, hair);
    if (facing === 3) f.rect(x0 + 6, top + 1, 4, 1, shade(hair, -0.3));
    else f.rect(x0 - 1 + facing, top + 1, 10 - facing, 1, shade(hair, -0.3));
  } else if (h === 'rocker') {
    f.rect(x0 - 1, top - 1, 10, 3, hair); f.rect(x0 + 1, top - 2, 6, 1, hair);
    f.rect(x0 - 2, top + 1, 2, 10, hair); f.rect(x0 + 8, top + 1, 2, 10, hair);
    f.set(x0 - 2, top + 11, hair); f.set(x0 + 9, top + 11, hair);
    if (facing >= 2) f.rect(x0 - 2, top, 5, 11, hair);
  } else if (h === 'helmet') {
    f.rect(x0 - 1, top - 2, 10, 4, hair); f.rect(x0, top - 3, 8, 1, hair);
    f.rect(x0 - 1, top + 2, 1, 3, hair); f.rect(x0 + 8, top + 2, 1, 3, hair);
    f.set(x0 + 2, top - 2, shade(hair, 0.5));
  } else if (h === 'long') {
    f.rect(x0 - 1, top - 1, 10, 3, hair); f.rect(x0 - 1, top + 2, 2, 6, hair); f.rect(x0 + 7, top + 2, 2, 6, hair);
  }
  if (L.goggles) { f.rect(x0, top + 1, 8, 1, '#f08a20'); f.rect(x0 + 1, top + 1, 2, 1, '#ffd060'); }

  // eyes, glasses, shades
  const ey = top + 4;
  if (L.shades) {
    if (facing === 3) f.rect(x0 + 5, ey, 3, 1, '#111');
    else f.rect(x0 + 1 + shiftEye, ey, Math.min(7, 8 - shiftEye), 1, '#111');
  } else {
    for (const x of eyes) f.set(x, ey, '#1a1a22');
    if (L.glasses) {
      for (const x of eyes) { f.set(x - 1, ey, '#cfe4f4'); f.set(x + 1, ey, '#cfe4f4'); f.set(x, ey - 1, '#556'); f.set(x - 1, ey - 1, '#556'); f.set(x + 1, ey - 1, '#556'); }
    }
  }
  // brows
  if (mood >= 2 && facing !== 3 && !L.shades) {
    for (const x of eyes) { f.set(x - 1, ey - 2, '#222'); f.set(x + 1, ey - 1 - (mood >= 3 ? 0 : 1), '#222'); }
  }
  // mouth
  const mx = facing === 3 ? x0 + 5 : x0 + 3 + shiftEye;
  const my = top + 6;
  if (L.beard) {
    f.rect(x0, top + 5, 8, 3, L.hairColor); f.rect(x0 + 1, top + 8, 6, 1, L.hairColor);
    if (facing >= 2) f.rect(x0, top + 5, 5, 4, L.hairColor);
  }
  if (shouting || mood >= 5) { f.rect(mx, my - 1, 2, 2, '#5a1010'); f.set(mx, my - 1, '#a02020'); }
  else if (mood >= 3) { f.hline(mx, mx + 1, my, '#5a2020'); f.set(mx - 1, my + 1, '#5a2020'); f.set(mx + 2, my + 1, '#5a2020'); }
  else f.hline(mx, mx + 1, my, '#7a3a2a');
  if (L.moustache) f.hline(mx - 1, mx + 2, my - 1, L.hairColor);
  if (facing === 3) f.set(x0 + 8, top + 4, skin); // nose
}

function jacketAt(f, L, x, y, w, h) {
  f.rect(x, y, w, h, L.jacket);
  f.hline(x, x + w - 1, y + h - 1, shade(L.jacket, -0.25));
  if (L.trim) f.hline(x + 1, x + w - 2, y, L.trim);
  if (L.stripe) f.hline(x, x + w - 1, y + 3, L.stripe);
  if (L.spots) for (let i = 0; i < Math.floor((w * h) / 9); i++) f.set(x + Math.floor(rnd() * w), y + Math.floor(rnd() * h), L.spots);
}

function legsFront(f, L, y0, y1, xl, xr) {
  f.rect(xl, y0, 4, y1 - y0, L.trousers); f.rect(xr, y0, 4, y1 - y0, L.trousers);
  if (L.spots) for (let i = 0; i < 4; i++) f.set(xl + Math.floor(rnd() * 8) + (rnd() < 0.5 ? 0 : xr - xl - 4), y0 + Math.floor(rnd() * (y1 - y0)), L.spots);
  f.vline(xl + 3, y0, y1 - 1, shade(L.trousers, -0.25));
  f.rect(xl, y1, 3, 2, '#303040'); f.rect(xr + 1, y1, 3, 2, '#303040');
}

const POLE = '#a8a8b8';
function pole(f, x0, y0, x1, y1) { line(f, x0, y0, x1, y1, POLE); f.set(x1, y1, '#555'); }

function skier(L, pose, mood = 0) {
  const f = new Img(FW, FH);
  const large = L.build === 'large', slim = L.slim;
  const tw = large ? 12 : slim ? 8 : 10;
  const tx = 12 - tw / 2;
  const glove = '#26262e';
  const board = L.board;
  if (pose === 'down' || pose === 'stand' || pose === 'shout' || pose === 'slight') {
    const s = pose === 'slight' ? 1 : 0;
    // skis first (behind boots)
    if (board) f.rect(5, 28, 14, 3, L.skis);
    else if (s) { line(f, 9, 27, 12, 31, L.skis, 2); line(f, 14, 27, 17, 31, L.skis, 2); }
    else { f.rect(8, 27, 2, 5, L.skis); f.rect(14, 27, 2, 5, L.skis); f.set(8, 31, shade(L.skis, 0.4)); f.set(14, 31, shade(L.skis, 0.4)); }
    legsFront(f, L, 21, 27, 8 + s, 12 + s);
    jacketAt(f, L, tx + s, 12, tw, 10);
    f.vline(12 + s, 13, 20, shade(L.jacket, -0.35));
    // arms
    f.rect(tx - 2 + s, 13, 2, 7, shade(L.jacket, -0.15)); f.rect(tx - 2 + s, 20, 2, 1, glove);
    if (pose === 'shout') { f.rect(tx + tw + s, 5, 2, 8, shade(L.jacket, -0.15)); f.rect(tx + tw + s, 3, 2, 2, glove); }
    else { f.rect(tx + tw + s, 13, 2, 7, shade(L.jacket, -0.15)); f.rect(tx + tw + s, 20, 2, 1, glove); }
    if (pose === 'stand' || pose === 'shout') { pole(f, tx - 2 + s, 20, tx - 5 + s, 31); if (pose === 'stand') pole(f, tx + tw + 1 + s, 20, tx + tw + 4 + s, 31); }
    else { pole(f, tx - 2 + s, 20, tx - 4 + s, 26); pole(f, tx + tw + 1 + s, 20, tx + tw + 3 + s, 26); }
    drawHead(f, L, 12 + s, 4, s, mood, pose === 'shout');
  } else if (pose === 'diag') {
    line(f, 4, 25, 16, 31, L.skis, 2); line(f, 8, 23, 20, 29, L.skis, 2);
    legsFront(f, L, 21, 26, 9, 12);
    jacketAt(f, L, tx + 1, 12, tw - 1, 10);
    f.rect(tx - 1, 13, 2, 7, shade(L.jacket, -0.15)); f.rect(tx - 1, 20, 2, 1, glove);
    f.rect(tx + tw, 13, 2, 7, shade(L.jacket, -0.15)); f.rect(tx + tw, 20, 2, 1, glove);
    pole(f, tx - 1, 20, tx - 5, 27); pole(f, tx + tw + 1, 20, tx + tw - 1, 28);
    drawHead(f, L, 13, 4, 2, mood);
  } else if (pose === 'side') {
    if (board) f.rect(2, 28, 20, 3, L.skis);
    else { f.rect(1, 29, 21, 2, L.skis); f.set(22, 28, L.skis); f.set(23, 27, L.skis); f.hline(2, 21, 29, shade(L.skis, 0.3)); }
    f.rect(9, 21, 5, 6, L.trousers); f.rect(11, 24, 4, 3, shade(L.trousers, -0.2));
    f.rect(9, 27, 6, 2, '#303040');
    jacketAt(f, L, 9, 12, large ? 7 : 6, 10);
    f.rect(11, 14, 3, 6, shade(L.jacket, -0.2)); f.rect(12, 20, 2, 1, glove);
    pole(f, 12, 20, 5, 30);
    drawHead(f, L, 12, 4, 3, mood);
  } else if (pose === 'tuck') {
    f.rect(8, 27, 2, 5, L.skis); f.rect(14, 27, 2, 5, L.skis);
    legsFront(f, L, 23, 27, 8, 12);
    jacketAt(f, L, tx - 1, 16, tw + 2, 8);
    f.rect(tx - 2, 19, 2, 4, shade(L.jacket, -0.15)); f.rect(tx + tw, 19, 2, 4, shade(L.jacket, -0.15));
    f.rect(tx - 1, 23, 2, 1, glove); f.rect(tx + tw - 1, 23, 2, 1, glove);
    pole(f, tx - 1, 23, tx - 5, 15); pole(f, tx + tw, 23, tx + tw + 4, 15);
    drawHead(f, L, 12, 9, 0, mood);
  } else if (pose === 'jump') {
    line(f, 10, 24, 5, 30, L.skis, 2); line(f, 13, 24, 18, 30, L.skis, 2);
    f.rect(8, 20, 4, 3, L.trousers); f.rect(12, 20, 4, 3, L.trousers);
    f.rect(8, 23, 3, 2, '#303040'); f.rect(13, 23, 3, 2, '#303040');
    jacketAt(f, L, tx, 11, tw, 10);
    f.rect(1, 12, tx - 1, 2, shade(L.jacket, -0.15)); f.rect(tx + tw, 12, 23 - tx - tw, 2, shade(L.jacket, -0.15));
    f.rect(0, 11, 2, 2, glove); f.rect(22, 11, 2, 2, glove);
    pole(f, 1, 12, 0, 3); pole(f, 22, 12, 23, 3);
    drawHead(f, L, 12, 3, 0, Math.max(mood, 0), true);
  } else if (pose === 'crash') {
    // flat on the back, skis everywhere
    line(f, 11, 10, 22, 21, L.skis, 2); line(f, 11, 21, 21, 9, L.skis, 2);
    f.rect(14, 15, 4, 8, L.trousers); f.rect(18, 15, 3, 4, L.trousers); f.rect(20, 13, 3, 3, '#303040');
    jacketAt(f, L, 5, 21, 11, 6);
    f.rect(3, 19, 3, 2, shade(L.jacket, -0.15)); f.rect(2, 17, 2, 2, glove);
    pole(f, 16, 26, 23, 31);
    drawHead(f, L, 5, 20, 0, mood, true);
    for (const [x, y] of [[1, 28], [3, 30], [9, 29], [20, 26], [22, 24], [0, 25]]) f.set(x, y, '#ffffff');
  } else if (pose === 'sit') {
    if (board) f.rect(3, 28, 18, 3, L.skis);
    else { f.rect(8, 28, 2, 4, L.skis); f.rect(14, 28, 2, 4, L.skis); }
    f.rect(8, 23, 4, 5, L.trousers); f.rect(12, 23, 4, 5, L.trousers);
    f.rect(8, 27, 3, 2, '#303040'); f.rect(13, 27, 3, 2, '#303040');
    jacketAt(f, L, tx, 15, tw, 9);
    f.rect(tx - 2, 17, 2, 6, shade(L.jacket, -0.15)); f.rect(tx + tw, 17, 2, 6, shade(L.jacket, -0.15));
    f.rect(tx - 2, 23, 2, 1, glove); f.rect(tx + tw, 23, 2, 1, glove);
    drawHead(f, L, 12, 7, 0, mood);
  }
  f.outline(OUTLINE);
  if (L.kid) return shrink(f, 0.72);
  return f;
}

function shrink(src, k) {
  const out = new Img(FW, FH);
  const w = Math.round(FW * k), h = Math.round(FH * k);
  const ox = Math.round((FW - w) / 2), oy = FH - h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = src.get(Math.floor(x / k), Math.floor(y / k));
    if (p[3]) out.set(ox + x, oy + y, p);
  }
  return out;
}

function sheet(L, mood = 0) {
  const s = new Img(FW * FRAMES.length, FH);
  FRAMES.forEach((p, i) => { seed = 99 + i; s.blit(skier(L, p, mood), i * FW, 0); });
  return s;
}

function portrait(L, mood = 0, bg = '#3a4a6a') {
  const p = new Img(32, 32);
  p.rect(0, 0, 32, 32, bg);
  for (let y = 0; y < 32; y += 4) p.hline(0, 31, y, shade(bg, 0.06));
  seed = 7;
  const f = new Img(FW, FH);
  // head and shoulders, drawn at 2x
  jacketAt(f, L, 4, 12, 16, 8);
  if (L.trim) f.rect(10, 12, 4, 2, L.trim);
  drawHead(f, L, 12, 3, 0, mood, mood >= 5);
  f.outline(OUTLINE);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const px = f.get(x + 4, y + 1);
    if (px[3]) p.rect(x * 2, y * 2, 2, 2, px);
  }
  if (mood >= 4) { p.rect(1, 2, 2, 2, '#fff'); p.rect(3, 0, 2, 2, '#ddd'); p.rect(27, 1, 2, 2, '#fff'); p.rect(29, 3, 2, 2, '#ddd'); }
  p.frame(0, 0, 32, 32, OUTLINE);
  return p;
}

// ---------------------------------------------------------------- objects

const SNOW = '#f4f8ff', SNOW_SH = '#d4e0f0', SNOW_DEEP = '#b8c8e0';
const objects = {};

function tree(h = 40, w = 24, snowy = true) {
  const f = new Img(w, h);
  const cx = w / 2;
  f.rect(cx - 2, h - 7, 4, 6, '#5a3a20');
  const tiers = Math.round(h / 11);
  for (let t = 0; t < tiers; t++) {
    const top = 1 + t * ((h - 9) / tiers), bot = top + (h - 9) / tiers + 4;
    const half0 = 1 + t * 2, half1 = Math.min(w / 2, 4 + (t + 1) * ((w / 2 - 3) / tiers) + 1);
    for (let y = Math.floor(top); y < bot; y++) {
      const k = (y - top) / (bot - top);
      const hw = half0 + (half1 - half0) * k;
      f.hline(Math.round(cx - hw), Math.round(cx + hw - 1), y, y % 3 === 0 ? '#1f5a3a' : '#2a6a42');
      f.set(Math.round(cx + hw - 1), y, '#184a30');
    }
    if (snowy) { const y = Math.floor(top) + 1; f.hline(Math.round(cx - half0 - 1), Math.round(cx + half0), y, SNOW); f.hline(Math.round(cx - half1 + 2), Math.round(cx - half1 + 5), Math.floor(bot) - 1, SNOW); }
  }
  f.outline(OUTLINE);
  return f;
}
objects.tree = tree(40, 24);
objects.tree_small = tree(26, 16);
objects.tree_big = tree(52, 30);
objects.rock = (() => { const f = new Img(18, 12); f.ellipse(9, 7, 8, 5, '#7a7a86'); f.ellipse(7, 6, 5, 3, '#9a9aa6'); f.rect(4, 2, 8, 2, SNOW); f.rect(6, 1, 4, 1, SNOW); f.outline(OUTLINE); return f; })();
objects.stump = (() => { const f = new Img(12, 12); f.rect(2, 4, 8, 7, '#6a4a2a'); f.ellipse(6, 4, 4, 2, '#a07a4a'); f.rect(3, 2, 6, 2, SNOW); f.outline(OUTLINE); return f; })();
objects.mogul = (() => { const f = new Img(26, 10); f.ellipse(13, 6, 12, 4, SNOW); f.ellipse(14, 8, 11, 2, SNOW_SH); f.ellipse(11, 5, 7, 2, '#ffffff'); return f; })();
objects.ramp = (() => { const f = new Img(28, 18); for (let y = 0; y < 14; y++) f.hline(2 + Math.floor(y / 3), 25 - Math.floor(y / 3), 3 + y, mix('#ffffff', SNOW_SH, y / 14)); f.rect(2, 16, 24, 2, SNOW_DEEP); f.rect(8, 1, 12, 2, '#f08a20'); f.rect(8, 1, 2, 3, '#f08a20'); f.rect(18, 1, 2, 3, '#f08a20'); return f; })();
function flag(c) { const f = new Img(8, 18); f.vline(1, 1, 17, '#222'); f.rect(2, 1, 6, 6, c); f.rect(2, 1, 6, 1, shade(c, 0.3)); return f; }
objects.flag_red = flag('#e02a2a');
objects.flag_blue = flag('#2a5ae0');
objects.pylon = (() => { const f = new Img(16, 60); f.rect(6, 6, 4, 54, '#8a8a96'); f.vline(6, 6, 59, '#b0b0bc'); f.rect(0, 2, 16, 4, '#6a6a76'); f.rect(0, 0, 3, 3, '#3a3a46'); f.rect(13, 0, 3, 3, '#3a3a46'); f.rect(4, 56, 8, 4, SNOW_SH); f.outline(OUTLINE); return f; })();
objects.cannon = (() => { const f = new Img(20, 22); f.vline(9, 8, 21, '#555'); f.vline(10, 8, 21, '#777'); f.ellipse(10, 6, 7, 5, '#e8e030'); f.ellipse(10, 6, 4, 3, '#333'); f.rect(6, 19, 9, 3, '#555'); f.outline(OUTLINE); return f; })();
objects.hut = (() => {
  const f = new Img(76, 60);
  f.rect(6, 26, 64, 32, '#8a5a32');
  for (let y = 28; y < 58; y += 4) f.hline(6, 69, y, '#6a4224');
  for (let i = 0; i < 26; i++) f.hline(38 - 6 - i * 1.4, 38 + 5 + i * 1.4, i + 2, i < 3 ? SNOW : i % 2 ? '#7a3020' : '#8a3a28');
  for (let i = 0; i < 7; i++) f.hline(38 - 6 - i * 1.4 - 1, 38 + 5 + i * 1.4 + 1, i + 1, SNOW);
  f.hline(1, 75, 27, SNOW); f.hline(0, 75, 28, SNOW_SH);
  f.rect(32, 40, 12, 18, '#3a2410'); f.set(41, 49, '#e8c040');
  f.rect(12, 36, 12, 10, '#f0d080'); f.frame(12, 36, 12, 10, '#3a2410'); f.vline(18, 36, 45, '#3a2410');
  f.rect(52, 36, 12, 10, '#f0d080'); f.frame(52, 36, 12, 10, '#3a2410'); f.vline(58, 36, 45, '#3a2410');
  f.rect(54, 6, 6, 12, '#7a7a7a'); f.rect(53, 4, 8, 3, SNOW);
  f.outline(OUTLINE);
  return f;
})();
objects.cocoa = (() => {
  const f = new Img(36, 34);
  f.rect(2, 16, 32, 16, '#a0582a'); f.rect(2, 16, 32, 3, '#c07040');
  for (let x = 2; x < 34; x += 6) { f.rect(x, 2, 3, 6, '#e03030'); f.rect(x + 3, 2, 3, 6, '#f4f4f4'); }
  f.rect(1, 8, 34, 2, '#e03030'); f.vline(3, 8, 16, '#555'); f.vline(32, 8, 16, '#555');
  f.rect(8, 20, 20, 7, '#f4ead0'); // sign
  for (let x = 10; x < 26; x += 3) f.rect(x, 22, 2, 3, '#6a3a1a');
  f.rect(5, 12, 4, 4, '#f4f4f4'); f.rect(6, 13, 2, 2, '#5a2a10'); f.set(6, 10, '#ddd'); f.set(7, 9, '#ddd');
  f.rect(26, 12, 4, 4, '#f4f4f4'); f.rect(27, 13, 2, 2, '#5a2a10');
  f.outline(OUTLINE);
  return f;
})();
function sign(c, shape) {
  const f = new Img(14, 22);
  f.vline(6, 8, 21, '#5a3a20'); f.vline(7, 8, 21, '#7a5a30');
  if (shape === 'diamond') { for (let i = 0; i < 6; i++) { f.hline(7 - i, 6 + i, 1 + i, c); f.hline(7 - i, 6 + i, 12 - i, c); } }
  else if (shape === 'square') f.rect(2, 1, 10, 10, c);
  else f.ellipse(7, 6, 5, 5, c);
  f.outline(OUTLINE);
  return f;
}
objects.sign_green = sign('#2ab04a', 'circle');
objects.sign_blue = sign('#2a6ae0', 'circle');
objects.sign_red = sign('#e02a2a', 'square');
objects.sign_black = sign('#141418', 'diamond');
objects.ice = (() => { const f = new Img(40, 18); f.ellipse(20, 9, 19, 8, [170, 220, 255, 170]); f.ellipse(16, 7, 9, 3, [235, 250, 255, 200]); f.hline(24, 32, 11, [255, 255, 255, 220]); return f; })();
objects.snowball = (() => { const f = new Img(6, 6); f.ellipse(3, 3, 2.6, 2.6, '#ffffff'); f.set(2, 2, SNOW_SH); f.outline('#8090b0'); return f; })();
objects.chair = (() => { const f = new Img(22, 26); f.vline(11, 0, 9, '#333'); f.hline(3, 19, 9, '#333'); f.vline(3, 9, 18, '#333'); f.vline(19, 9, 18, '#333'); f.rect(3, 17, 17, 3, '#2a4a8a'); f.rect(3, 12, 17, 2, '#2a4a8a'); f.hline(3, 19, 23, '#555'); f.outline(OUTLINE); return f; })();
objects.ski = (() => { const f = new Img(16, 16); line(f, 2, 13, 13, 2, '#30c0c0', 2); f.set(14, 1, '#30c0c0'); f.outline(OUTLINE); return f; })();
objects.pass = (() => { const f = new Img(12, 10); f.rect(1, 1, 10, 8, '#f4f4f4'); f.rect(1, 1, 10, 2, '#2a6ae0'); f.rect(2, 4, 3, 4, '#c0a080'); f.hline(6, 9, 5, '#555'); f.hline(6, 8, 7, '#555'); f.outline(OUTLINE); return f; })();
objects.suncream = (() => { const f = new Img(8, 14); f.rect(1, 3, 6, 10, '#f4c020'); f.rect(2, 0, 4, 3, '#e04020'); f.rect(2, 6, 4, 3, '#f4f4f4'); f.outline(OUTLINE); return f; })();
objects.deepheat = (() => { const f = new Img(14, 8); f.rect(1, 2, 10, 4, '#e03020'); f.rect(11, 3, 2, 2, '#f4f4f4'); f.rect(3, 3, 5, 2, '#f4d020'); f.outline(OUTLINE); return f; })();
objects.map = (() => { const f = new Img(14, 12); f.rect(1, 1, 12, 10, '#f4ead0'); f.vline(5, 1, 10, '#c0b090'); f.vline(9, 1, 10, '#c0b090'); line(f, 2, 9, 11, 3, '#2a6ae0'); line(f, 3, 3, 10, 9, '#e02a2a'); f.outline(OUTLINE); return f; })();
objects.speaker = (() => { const f = new Img(12, 14); f.rect(1, 1, 10, 12, '#222'); f.ellipse(6, 9, 3, 3, '#555'); f.ellipse(6, 4, 2, 2, '#555'); f.outline('#888'); return f; })();
objects.goggles_item = (() => { const f = new Img(14, 8); f.rect(1, 2, 12, 4, '#f08a20'); f.rect(2, 3, 4, 2, '#60c0f0'); f.rect(8, 3, 4, 2, '#60c0f0'); f.outline(OUTLINE); return f; })();
objects.basher = (() => {
  const f = new Img(56, 36);
  f.rect(2, 22, 52, 12, '#2a2a2a'); for (let x = 3; x < 54; x += 4) f.rect(x, 24, 2, 8, '#555');
  f.rect(8, 8, 36, 16, '#e02a2a'); f.rect(22, 2, 18, 12, '#e02a2a'); f.rect(24, 4, 14, 7, '#90c8f0');
  f.rect(44, 14, 10, 8, '#bbb'); f.rect(0, 18, 4, 10, '#999'); f.rect(36, 0, 3, 2, '#f0a020');
  f.outline(OUTLINE);
  return f;
})();
objects.fence = (() => { const f = new Img(34, 14); f.vline(1, 0, 13, '#555'); f.vline(32, 0, 13, '#555'); for (let y = 2; y < 11; y += 2) f.hline(2, 31, y, '#f07a20'); for (let x = 3; x < 32; x += 3) f.vline(x, 2, 10, '#f07a20'); return f; })();
objects.yard = (() => { const f = new Img(28, 14); line(f, 1, 10, 14, 4, '#30c0c0', 2); line(f, 12, 12, 26, 8, '#30c0c0', 2); line(f, 4, 3, 20, 12, POLE); f.ellipse(22, 3, 3, 2, '#c02a2a'); f.rect(6, 9, 6, 3, '#f08a20'); f.outline(OUTLINE); return f; })();
objects.snowman = (() => { const f = new Img(16, 24); f.ellipse(8, 17, 6, 6, '#ffffff'); f.ellipse(8, 7, 4.5, 4.5, '#ffffff'); f.set(6, 6, '#111'); f.set(9, 6, '#111'); f.rect(8, 8, 3, 1, '#f08a20'); f.rect(4, 1, 8, 2, '#222'); f.rect(5, 0, 6, 1, '#222'); f.set(8, 15, '#111'); f.set(8, 18, '#111'); f.hline(3, 12, 11, '#1f3f8a'); f.outline('#8090b0'); return f; })();
objects.powder = (() => { const f = new Img(10, 6); f.ellipse(5, 3, 4.5, 2.5, '#ffffff'); f.ellipse(3, 2, 2, 1.5, SNOW_SH); return f; })();
objects.marker = (() => { const f = new Img(4, 18); f.rect(1, 0, 2, 18, '#f4f4f4'); for (let y = 1; y < 12; y += 4) f.rect(1, y, 2, 2, '#e07a20'); return f; })();
objects.bar = (() => {
  const f = new Img(96, 64);
  f.rect(4, 26, 88, 36, '#7a4a28');
  for (let y = 28; y < 62; y += 4) f.hline(4, 91, y, '#5e3818');
  for (let i = 0; i < 26; i++) f.hline(48 - 10 - i * 1.7, 48 + 9 + i * 1.7, i + 2, i < 4 ? SNOW : i % 2 ? '#6a2a1a' : '#7a3422');
  f.hline(0, 95, 27, SNOW); f.hline(0, 95, 28, SNOW_SH);
  f.rect(20, 32, 56, 10, '#2a1a10'); // sign board, the game writes the name
  f.rect(42, 46, 14, 16, '#3a2410');
  for (const x of [10, 64]) { f.rect(x, 46, 18, 10, '#f8d870'); f.frame(x, 46, 18, 10, '#3a2410'); }
  f.outline(OUTLINE);
  return f;
})();
objects.tape = (() => { const f = new Img(12, 12); f.ellipse(6, 6, 5, 5, '#a0a0a8'); f.ellipse(6, 6, 2, 2, '#e8e8f0'); f.rect(8, 9, 4, 2, '#a0a0a8'); f.outline(OUTLINE); return f; })();
objects.zzz = (() => { const f = new Img(10, 10); for (const [x, y] of [[0, 6], [5, 2]]) { f.hline(x, x + 3, y, '#3a5ad0'); f.set(x + 2, y + 1, '#3a5ad0'); f.set(x + 1, y + 2, '#3a5ad0'); f.hline(x, x + 3, y + 3, '#3a5ad0'); } return f; })();
objects.phone = (() => { const f = new Img(8, 14); f.rect(1, 1, 6, 12, '#222'); f.rect(2, 2, 4, 8, '#60c0f0'); f.set(4, 11, '#888'); f.outline('#888'); return f; })();
objects.marmot = (() => { const f = new Img(12, 12); f.ellipse(6, 8, 4, 3.5, '#8a6a4a'); f.ellipse(6, 4, 3, 3, '#9a7a5a'); f.set(5, 3, '#111'); f.set(7, 3, '#111'); f.set(6, 5, '#f4f4f4'); f.outline(OUTLINE); return f; })();

// ---------------------------------------------------------------- write everything

const manifest = { frame: { w: FW, h: FH, names: FRAMES }, characters: {}, portraits: {}, objects: { file: 'sprites/objects.png', frames: {} } };

for (const c of CAST) {
  seed = 4242;
  sheet(c.look).save(`sprites/${c.id}.png`);
  manifest.characters[c.id] = { file: `sprites/${c.id}.png` };
  if (c.mate || ['lee', 'alistair', 'bob', 'mireille'].includes(c.id)) {
    portrait(c.look, 0, c.mate ? '#3a4a6a' : '#5a3a4a').save(`portraits/${c.id}.png`);
    manifest.portraits[c.id] = `portraits/${c.id}.png`;
  }
}
const andy = CAST.find((c) => c.id === 'andy').look;
sheet(andy, 3).save('sprites/andy_angry.png');
sheet(andy, 5).save('sprites/andy_furious.png');
Object.assign(manifest.characters.andy, { angry: 'sprites/andy_angry.png', furious: 'sprites/andy_furious.png' });
['andy_neutral', 'andy_annoyed', 'andy_irritated', 'andy_angry', 'andy_furious', 'andy_shouting'].forEach((n, i) => {
  portrait(andy, i, ['#3a6a4a', '#4a6a3a', '#6a6a3a', '#7a4a2a', '#8a2a2a', '#a01818'][i]).save(`portraits/${n}.png`);
  manifest.portraits[n] = `portraits/${n}.png`;
});
portrait({ skin: '#e8c0a0', hair: 'short', hairColor: '#666', glasses: true, jacket: '#2a2a3a', trim: '#c02020' }, 0, '#4a4a5a').save('portraits/chairman.png');
manifest.portraits.chairman = 'portraits/chairman.png';

// pack objects in one row
const names = Object.keys(objects);
const W = names.reduce((s, n) => s + objects[n].w + 1, 0), H = Math.max(...names.map((n) => objects[n].h));
const pack = new Img(W, H);
let x = 0;
for (const n of names) {
  const o = objects[n];
  pack.blit(o, x, 0);
  manifest.objects.frames[n] = { x, y: 0, w: o.w, h: o.h };
  x += o.w + 1;
}
pack.save('sprites/objects.png');
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
console.log(`Wrote ${CAST.length} skier sheets, ${Object.keys(manifest.portraits).length} portraits and ${names.length} objects to public/assets/`);
