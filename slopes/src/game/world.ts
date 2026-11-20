import { makeRng, type Rng, pick, range } from '../core/rng';

export interface DayDef {
  day: string;
  run: string;
  grade: 'green' | 'blue' | 'red' | 'black' | 'offpiste' | 'race';
  length: number;
  width: [number, number];
  density: number;
  moguls: number;
  ice: number;
  ramps: number;
  scrapeEvery: number;
  maxScrapes: number;
  par: number;
  bar: string;
}

export type ObKind =
  | 'tree' | 'tree_small' | 'tree_big' | 'rock' | 'stump' | 'mogul' | 'ramp' | 'gate' | 'pylon' | 'cannon'
  | 'hut' | 'cocoa' | 'sign' | 'ice' | 'snowman' | 'marker' | 'yard' | 'fence';

export interface Obstacle {
  id: number;
  kind: ObKind;
  sprite: string;
  x: number;
  /** y of the base (where it touches the snow). */
  y: number;
  /** collision radius at the base; 0 = you can ski through it */
  r: number;
  /** low things can be jumped over */
  low: boolean;
  /** gates: x of the second flag */
  x2?: number;
  passed?: boolean;
  hit?: boolean;
  flip?: boolean;
}

export const VIEW_WIDTH = 640;
export const CHUNK = 400;
const START_CLEAR = 650;

/** The groomed piste: a wandering centre line and a width that breathes. */
export class Piste {
  private ph: number[];
  readonly liftX: number;

  constructor(readonly day: DayDef, seed: number) {
    const r = makeRng(seed * 31 + 7);
    this.ph = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28];
    this.liftX = r() < 0.5 ? 92 : VIEW_WIDTH - 92;
  }

  half(y: number): number {
    const [w0, w1] = this.day.width;
    const k = 0.5 + 0.5 * Math.sin(y / 1700 + this.ph[2]);
    return (w0 + (w1 - w0) * k) / 2;
  }

  centre(y: number): number {
    const swing = this.day.grade === 'green' ? 60 : this.day.grade === 'offpiste' ? 150 : 110;
    let c = VIEW_WIDTH / 2 + swing * Math.sin(y / 1300 + this.ph[0]) + swing * 0.45 * Math.sin(y / 470 + this.ph[1]);
    // straight and centred at the start and at the finish
    const blendIn = Math.min(1, Math.max(0, (y - 150) / 600));
    const blendOut = Math.min(1, Math.max(0, (this.day.length - y) / 700));
    c = VIEW_WIDTH / 2 + (c - VIEW_WIDTH / 2) * Math.min(blendIn, blendOut);
    const h = this.half(y);
    return Math.max(h + 14, Math.min(VIEW_WIDTH - h - 14, c));
  }

  onPiste(x: number, y: number, margin = 0): boolean {
    return Math.abs(x - this.centre(y)) <= this.half(y) - margin;
  }
}

/** Makes the obstacles for one 400px slice of the mountain. Same seed + chunk = same slice. */
export function makeChunk(p: Piste, seed: number, chunk: number, nextId: () => number): Obstacle[] {
  const day = p.day;
  const rng: Rng = makeRng((seed ^ Math.imul(chunk + 1, 2654435761)) >>> 0);
  const y0 = chunk * CHUNK, y1 = y0 + CHUNK;
  const out: Obstacle[] = [];
  const finish = day.length;
  const busyStart = Math.max(y0, START_CLEAR);
  const free = (x: number, y: number, d = 20) => out.every((o) => Math.abs(o.x - x) > d || Math.abs(o.y - y) > d);
  const add = (kind: ObKind, x: number, y: number, extra: Partial<Obstacle> = {}) => {
    const base: Record<ObKind, [string, number, boolean]> = {
      tree: ['tree', 7, false], tree_small: ['tree_small', 5, false], tree_big: ['tree_big', 9, false],
      rock: ['rock', 7, true], stump: ['stump', 5, true], mogul: ['mogul', 0, true], ramp: ['ramp', 0, true],
      gate: ['flag_red', 0, true], pylon: ['pylon', 6, false], cannon: ['cannon', 6, false], hut: ['hut', 0, false],
      cocoa: ['cocoa', 0, false], sign: ['sign_green', 3, false], ice: ['ice', 0, true], snowman: ['snowman', 6, false],
      marker: ['marker', 0, true], yard: ['yard', 6, true], fence: ['fence', 0, true],
    };
    const [sprite, r, low] = base[kind];
    const o: Obstacle = { id: nextId(), kind, sprite, x, y, r, low, flip: rng() < 0.5, ...extra };
    out.push(o);
    return o;
  };

  // trees off the piste (and a few in it on the off-piste day)
  const treeCount = Math.round(16 + 10 * day.density);
  for (let i = 0; i < treeCount; i++) {
    const y = range(rng, y0, y1), x = range(rng, -6, VIEW_WIDTH + 6);
    if (y < 80) continue;
    const inside = p.onPiste(x, y, -10);
    if (inside && !(day.grade === 'offpiste' && y > START_CLEAR && y < finish - 300 && rng() < 0.18)) continue;
    if (!free(x, y, 14)) continue;
    const t = rng();
    add(t < 0.2 ? 'tree_big' : t < 0.75 ? 'tree' : 'tree_small', x, y);
  }

  // piste edge markers, coloured by the run's grade
  for (let y = Math.ceil(y0 / 160) * 160; y < y1; y += 160) {
    if (y < 80 || y > finish + 200) continue;
    const c = p.centre(y), h = p.half(y);
    add('marker', c - h - 4, y, { r: 0 });
    add('marker', c + h + 4, y, { r: 0 });
  }

  // chairlift pylons
  for (let y = Math.ceil(y0 / 700) * 700; y < y1; y += 700) if (y > 200 && y < finish + 300) add('pylon', p.liftX, y);

  if (y1 < busyStart || y0 > finish - 250) {
    return out;
  }
  const yRand = () => range(rng, busyStart, Math.min(y1, finish - 300));
  const xOn = (y: number, m = 20) => p.centre(y) + range(rng, -1, 1) * (p.half(y) - m);

  // the odd tree, rock, stump or snowman on the piste
  const bits = Math.round((2 + rng() * 3) * day.density);
  for (let i = 0; i < bits; i++) {
    const y = yRand(), x = xOn(y);
    if (!free(x, y, 26)) continue;
    const t = rng();
    add(t < 0.32 ? 'tree_small' : t < 0.6 ? 'rock' : t < 0.78 ? 'stump' : t < 0.9 ? 'tree' : t < 0.96 ? 'snowman' : 'yard', x, y);
  }
  // snow cannon at the edge
  if (rng() < 0.25) {
    const y = yRand(), side = rng() < 0.5 ? -1 : 1;
    add('cannon', p.centre(y) + side * (p.half(y) - 8), y, { flip: side > 0 });
  }
  // a mogul field
  if (rng() < day.moguls * 0.45) {
    const ys = yRand();
    const rows = 3 + Math.floor(rng() * 3);
    for (let r = 0; r < rows; r++) {
      const y = ys + r * 26;
      if (y > finish - 300) break;
      const c = p.centre(y), h = p.half(y) - 16;
      for (let x = c - h + (r % 2) * 22; x < c + h; x += 44) add('mogul', x, y);
    }
  }
  // ice
  if (rng() < day.ice * 0.4) {
    const y = yRand();
    add('ice', xOn(y, 40), y);
  }
  // a ramp
  if (rng() < day.ramps * 0.32) {
    const y = yRand(), x = xOn(y, 40);
    if (free(x, y, 40)) add('ramp', x, y);
  }
  // slalom gates
  if (rng() < 0.32 && day.grade !== 'offpiste') {
    const ys = yRand();
    let side = rng() < 0.5 ? -1 : 1;
    for (let g = 0; g < 3; g++) {
      const y = ys + g * 140;
      if (y > finish - 320) break;
      const c = p.centre(y), off = side * Math.min(70, p.half(y) - 60);
      const gap = 74;
      const x = c + off - gap / 2;
      if (free(x + gap / 2, y, 34)) add('gate', x, y, { x2: x + gap, sprite: g % 2 ? 'flag_blue' : 'flag_red', r: 0 });
      side = -side;
    }
  }
  // hot chocolate stand at the side of the piste, roughly every 3000px
  if (Math.floor(y1 / 3000) !== Math.floor(y0 / 3000) && y1 > 1500) {
    const y = Math.floor(y1 / 3000) * 3000 - 150, side = rng() < 0.5 ? -1 : 1;
    if (y > busyStart && y < finish - 400) add('cocoa', p.centre(y) + side * (p.half(y) - 22), y);
  }
  // a mountain hut just off the piste
  if (rng() < 0.12) {
    const y = yRand(), side = rng() < 0.5 ? -1 : 1, x = p.centre(y) + side * (p.half(y) + 50);
    if (x > 40 && x < VIEW_WIDTH - 40) {
      for (let i = out.length - 1; i >= 0; i--) if (Math.abs(out[i].x - x) < 46 && Math.abs(out[i].y - y) < 40 && out[i].kind.startsWith('tree')) out.splice(i, 1);
      add('hut', x, y, { r: 0 });
    }
  }
  // grade sign
  if (rng() < 0.4) {
    const y = yRand(), side = rng() < 0.5 ? -1 : 1;
    const grade = day.grade === 'race' ? 'red' : day.grade === 'offpiste' ? 'black' : day.grade;
    add('sign', p.centre(y) + side * (p.half(y) + 14), y, { sprite: `sign_${grade}` });
  }
  return out;
}

export function pickKid(rng: Rng): string {
  return pick(rng, ['kid1', 'kid2', 'kid3']);
}
