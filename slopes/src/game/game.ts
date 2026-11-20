import { makeRng, pick, range, type Rng } from '../core/rng';
import type { Audio } from '../core/audio';
import tuning from '../data/tuning.json';
import scrapeData from '../data/scrapes.json';
import phrases from '../data/catchphrases.json';
import cast from '../data/characters.json';
import { Meters, clamp } from './meters';
import { Lines } from './lines';
import { CHUNK, makeChunk, Piste, VIEW_WIDTH, pickKid, type DayDef, type Obstacle } from './world';

export const DAYS = tuning.days as DayDef[];
export const PHYS = tuning.physics;
export const ANGER = tuning.anger;
export const POINTS = tuning.points;

export type Screen = 'title' | 'dayIntro' | 'play' | 'dayEnd' | 'gameover' | 'holidayOver';
export type Pose = 'down' | 'slight' | 'diag' | 'side' | 'crash' | 'jump' | 'tuck' | 'stand' | 'shout' | 'sit';

export interface ScrapeDef {
  id: string;
  who: string;
  kind: 'help' | 'fetch' | 'chase' | 'snowball' | 'wild' | 'lift' | 'phone';
  title: string;
  short: string;
  say: string[];
  andy: string[];
  thanks: string[];
  pose?: Pose;
  item?: string;
  slides?: boolean;
  time?: number;
  weight?: number;
  from?: number;
  with?: string;
  tree?: boolean;
  zzz?: boolean;
  edge?: boolean;
  leeds?: boolean;
  fast?: boolean;
}
export const SCRAPES = scrapeData.scrapes as ScrapeDef[];
export const NAMES: Record<string, string> = Object.fromEntries(cast.characters.map((c) => [c.id, c.name]));
NAMES.chairman = 'The Club Chairman';
export const MATES = cast.characters.filter((c) => (c as { mate?: boolean }).mate).map((c) => c.id);

export interface Bubble { text: string; t: number }

/** Anyone or anything moving about on the mountain that isn't a fixed obstacle. */
export interface Npc {
  id: number;
  role: 'tourist' | 'school' | 'boarder' | 'basher' | 'target' | 'item' | 'chair' | 'snowball' | 'extra';
  /** a character id (skier sheet) or an object frame name when isObject */
  sprite: string;
  isObject: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pose: Pose;
  flip: boolean;
  /** collision radius; 0 = harmless */
  r: number;
  t: number;
  phase: number;
  bubble?: Bubble;
  down?: number;
  /** someone riding on it (the chairlift) */
  rider?: string;
  gone?: boolean;
  scrape?: Scrape;
  zzz?: boolean;
}

export interface Scrape {
  id: number;
  def: ScrapeDef;
  target: Npc | null;
  timeLeft: number;
  timeMax: number;
  hold: number;
  state: 'live' | 'done' | 'missed';
  t: number;
  /** the phone: seconds spent stood still */
  still: number;
  throwT: number;
}

export interface Toast { text: string; who?: string; t: number; good?: boolean }
export interface Popup { x: number; y: number; text: string; color: string; t: number }
export interface Particle { x: number; y: number; vx: number; vy: number; t: number }

export interface Andy {
  x: number;
  y: number;
  /** heading: 0 = straight down the hill, + = towards the right of the screen */
  h: number;
  v: number;
  z: number;
  vz: number;
  state: 'ski' | 'crash' | 'drink';
  t: number;
  invuln: number;
  tuck: boolean;
  brake: boolean;
  onIce: boolean;
  inPowder: boolean;
  airTime: number;
  bubble?: Bubble;
  trail: { x: number; y: number; gap?: boolean }[];
  lastTrail: number;
}

export interface Controls {
  ax: number;
  ay: number;
  action: boolean;
  took(k: string): boolean;
}

export interface DayStats {
  time: number;
  crashes: number;
  gates: number;
  gatesSeen: number;
  done: number;
  missed: number;
  air: number;
  cocoa: number;
  dayScore: number;
  timeBonus: number;
  apres: string;
}

const STAND_REACH = 26;
const HOLD_HELP = 0.6;
const HOLD_CATCH = 0.3;

export class Game {
  screen: Screen = 'title';
  paused = false;
  rng: Rng;
  lines: Lines;
  seed: number;
  day = 0;
  week = 1;
  score = 0;
  best = 0;
  meters = new Meters();
  piste!: Piste;
  obstacles: Obstacle[] = [];
  npcs: Npc[] = [];
  scrapes: Scrape[] = [];
  toasts: Toast[] = [];
  popups: Popup[] = [];
  particles: Particle[] = [];
  andy!: Andy;
  time = 0;
  stats!: DayStats;
  /** the furthest chunk generated so far */
  private chunkHi = -1;
  private nextObId = 1;
  private nextNpcId = 1;
  private nextScrapeAt = 0;
  private nextHazardAt = 0;
  private scrapeCount = 0;
  private gateStreak = 0;
  private cocoaCooldown = 0;
  private coldWarned = false;
  private distPoints = 0;
  private recentScrapes: string[] = [];
  /** what killed the run, for the game over screen */
  meltdownLine = '';

  constructor(private readonly audio: Pick<Audio, 'play'>, seed = Date.now()) {
    this.seed = seed >>> 0;
    this.rng = makeRng(this.seed);
    this.lines = new Lines(this.rng);
    try { this.best = Number(localStorage.getItem('andy.slopes.best') || 0); } catch { /* storage blocked */ }
  }

  get dayDef(): DayDef {
    return DAYS[this.day];
  }

  /** gets harder each lap of the week */
  get hardness(): number {
    return 1 + (this.week - 1) * 0.2;
  }

  newGame() {
    this.day = 0;
    this.score = 0;
    this.meters = new Meters();
    this.startDay();
  }

  startDay() {
    const daySeed = (this.seed + this.day * 7919 + this.week * 104729) >>> 0;
    this.piste = new Piste(this.dayDef, daySeed);
    this.obstacles = [];
    this.npcs = [];
    this.scrapes = [];
    this.toasts = [];
    this.popups = [];
    this.particles = [];
    this.chunkHi = -1;
    this.time = 0;
    this.scrapeCount = 0;
    this.gateStreak = 0;
    this.cocoaCooldown = 0;
    this.coldWarned = false;
    this.distPoints = 0;
    this.meters.cold = 0;
    this.nextScrapeAt = 700;
    this.nextHazardAt = 600;
    this.andy = { x: this.piste.centre(40), y: 40, h: 0, v: 0, z: 0, vz: 0, state: 'ski', t: 0, invuln: 0, tuck: false, brake: false, onIce: false, inPowder: false, airTime: 0, trail: [], lastTrail: 40 };
    this.stats = { time: 0, crashes: 0, gates: 0, gatesSeen: 0, done: 0, missed: 0, air: 0, cocoa: 0, dayScore: 0, timeBonus: 0, apres: '' };
    this.ensureWorld();
    this.screen = 'dayIntro';
  }

  begin() {
    this.screen = 'play';
    this.audio.play('whistle');
    this.say(this.andy, this.dayDef.grade === 'race' ? 'Last one to the bar buys the rounds!' : this.lines.pick('cp', phrases.catchphrases));
  }

  nextDay() {
    this.day++;
    this.meters.anger *= ANGER.carryOver;
    if (this.day >= DAYS.length) {
      this.screen = 'holidayOver';
      this.saveBest();
      return;
    }
    this.startDay();
  }

  nextWeek() {
    this.week++;
    this.newGame();
  }

  // ---------------------------------------------------------------- frame

  update(dt: number, input: Controls) {
    if (this.screen !== 'play') return;
    if (input.took('pause')) this.paused = !this.paused;
    if (this.paused) return;
    this.time += dt;
    this.stats.time = this.time;
    this.updateAndy(dt, input);
    this.ensureWorld();
    this.collideObstacles();
    this.updateNpcs(dt);
    this.spawnStuff();
    this.updateScrapes(dt, input);
    this.updateMeters(dt);
    this.updateFx(dt);

    if (this.meters.meltdown) {
      this.screen = 'gameover';
      this.meltdownLine = pick(this.rng, [
        'Andy has snapped his poles over his knee and is getting the coach home.',
        'Andy has thrown his skis off the chairlift and gone to find a cup of tea.',
        'Andy has declared the holiday OVER and locked himself in the chalet.',
      ]);
      this.audio.play('meltdown');
      this.saveBest();
      return;
    }
    if (this.andy.y >= this.dayDef.length && this.andy.state !== 'crash') this.finishDay();
  }

  private finishDay() {
    const st = this.stats;
    st.timeBonus = Math.max(0, Math.round((this.dayDef.par - this.time) * POINTS.timeBonus));
    this.addScore(st.timeBonus);
    st.apres = this.lines.pick('apres', phrases.apres);
    for (const s of this.scrapes) if (s.state === 'live') this.missScrape(s, true);
    this.screen = 'dayEnd';
    this.audio.play('dayEnd');
    this.saveBest();
  }

  private saveBest() {
    if (this.score > this.best) {
      this.best = this.score;
      try { localStorage.setItem('andy.slopes.best', String(this.best)); } catch { /* ignore */ }
    }
  }

  addScore(n: number) {
    this.score += n;
    this.stats.dayScore += n;
  }

  // ---------------------------------------------------------------- Andy

  private updateAndy(dt: number, input: Controls) {
    const a = this.andy;
    const P = PHYS;
    a.invuln = Math.max(0, a.invuln - dt);
    if (a.bubble) { a.bubble.t -= dt; if (a.bubble.t <= 0) a.bubble = undefined; }
    if (a.state === 'crash' || a.state === 'drink') {
      a.t -= dt;
      a.v = Math.max(0, a.v - 600 * dt);
      a.y += a.v * dt * 0.3;
      if (a.t <= 0) {
        a.state = 'ski';
        a.h = 0;
        a.v = 20;
        if (this.andyWasCrashed) a.invuln = P.invulnerable;
        this.andyWasCrashed = false;
      }
      return;
    }
    const airborne = a.z > 0 || a.vz > 0;
    // steering
    const turn = P.turnRate * (a.onIce ? 0.35 : 1) * (airborne ? 0.6 : 1);
    if (Math.abs(input.ax) > 0.2) a.h += Math.sign(input.ax) * Math.min(1, Math.abs(input.ax) * 1.3) * turn * dt;
    a.h = clamp(a.h, -Math.PI / 2, Math.PI / 2);
    a.tuck = input.ay > 0.4 && !airborne;
    a.brake = (input.ay < -0.4 || this.helping) && !airborne;
    if (a.tuck && Math.abs(input.ax) < 0.2 && Math.abs(a.h) < 0.6) a.h *= 1 - Math.min(1, dt * 2.5);

    // speed
    const powder = !this.piste.onPiste(a.x, a.y, -4) && !airborne;
    a.inPowder = powder;
    let drag = P.drag * (a.tuck ? P.tuckDrag : 1) * (powder ? P.powderDrag : 1);
    let fric = a.onIce ? 0 : powder ? P.powderFriction : P.friction;
    if (airborne) { drag *= 0.6; fric = 0; }
    let acc = P.gravity * Math.cos(a.h) * (a.tuck ? P.tuckBoost : 1) * (airborne ? 0.4 : 1) - fric - drag * a.v * a.v;
    if (a.brake) acc -= P.brake;
    if (Math.abs(a.h) > 1.25 && !airborne) acc -= P.sideways * (Math.abs(a.h) - 1.25) / 0.32;
    // a push with the poles when stood still
    if (a.v < 40 && input.ay > 0.4) acc = Math.max(acc, 140);
    a.v = Math.max(0, a.v + acc * dt);
    const vx = a.v * Math.sin(a.h), vy = a.v * Math.cos(a.h);
    a.x += vx * dt;
    a.y += vy * dt;
    if (a.x < 8) { a.x = 8; a.h = Math.max(a.h, 0.2); a.v *= 0.9; }
    if (a.x > VIEW_WIDTH - 8) { a.x = VIEW_WIDTH - 8; a.h = Math.min(a.h, -0.2); a.v *= 0.9; }

    // jumping
    if (input.took('action') && !airborne && !this.nearTarget()) this.launch(P.jump, false);
    if (airborne) {
      a.vz -= P.gravityZ * dt;
      a.z += a.vz * dt;
      a.airTime += dt;
      if (a.z <= 0) {
        a.z = 0;
        a.vz = 0;
        this.land();
      }
    }

    // spray and tracks
    if (!airborne && a.v > 60 && (a.brake || Math.abs(input.ax) > 0.2 || powder)) {
      for (let i = 0; i < (a.brake ? 3 : 1); i++)
        this.particles.push({ x: a.x + range(this.rng, -6, 6), y: a.y, vx: -vx * 0.2 + range(this.rng, -40, 40), vy: -vy * 0.3 + range(this.rng, -30, 10), t: 0.5 });
    }
    if (a.y - a.lastTrail > 5 || Math.abs(a.x - (a.trail.at(-1)?.x ?? a.x)) > 5) {
      a.trail.push({ x: a.x, y: a.y, gap: airborne });
      a.lastTrail = a.y;
      if (a.trail.length > 160) a.trail.shift();
    }
    // distance points
    const d = Math.floor(a.y / 100);
    if (d > this.distPoints) { this.addScore((d - this.distPoints) * POINTS.per100px); this.distPoints = d; }
  }

  private andyWasCrashed = false;

  private launch(vz: number, ramp: boolean) {
    const a = this.andy;
    a.vz = vz;
    a.z = 0.01;
    a.airTime = 0;
    this.audio.play('jump');
    if (ramp && this.rng() < 0.6) this.say(a, this.lines.pick('air', phrases.air));
  }

  private land() {
    const a = this.andy;
    const air = a.airTime;
    a.airTime = 0;
    if (Math.abs(a.h) > 1.15 && a.v > 110) { this.crash('Landed sideways. Classic.'); return; }
    this.audio.play('land');
    if (air > 0.65) {
      const pts = Math.round((air * POINTS.air) / 10) * 10;
      this.addScore(pts);
      this.stats.air++;
      this.popup(a.x, a.y - 30, `AIR! +${pts}`, '#f0c020');
      this.meters.addAnger(-1);
    }
  }

  crash(why?: string, person = false) {
    const a = this.andy;
    if (a.state === 'crash' || a.invuln > 0) return;
    a.state = 'crash';
    a.t = PHYS.crashTime;
    a.z = 0;
    a.vz = 0;
    this.andyWasCrashed = true;
    this.stats.crashes++;
    this.gateStreak = 0;
    this.meters.addAnger(person ? ANGER.crashPerson : ANGER.crash);
    this.audio.play('thump');
    this.say(a, why ?? this.lines.pick('crash', phrases.crash));
    for (let i = 0; i < 14; i++) this.particles.push({ x: a.x, y: a.y, vx: range(this.rng, -90, 90), vy: range(this.rng, -90, 30), t: 0.7 });
    a.trail.push({ x: a.x, y: a.y, gap: true });
  }

  // ---------------------------------------------------------------- world

  private ensureWorld() {
    const want = Math.floor((this.andy.y + 700) / CHUNK);
    while (this.chunkHi < want) {
      this.chunkHi++;
      this.obstacles.push(...makeChunk(this.piste, (this.seed + this.day * 7919 + this.week * 104729) >>> 0, this.chunkHi, () => this.nextObId++));
    }
    const cut = this.andy.y - 300;
    if (this.obstacles.length && this.obstacles[0].y < cut - 200) this.obstacles = this.obstacles.filter((o) => o.y > cut);
  }

  private collideObstacles() {
    const a = this.andy;
    a.onIce = false;
    if (a.state !== 'ski') return;
    for (const o of this.obstacles) {
      const dy = a.y - o.y;
      if (dy < -40 || dy > 40) continue;
      const dx = a.x - o.x;
      switch (o.kind) {
        case 'gate': {
          if (!o.passed && a.y >= o.y && a.y - a.v * 0.05 < o.y + 8) {
            o.passed = true;
            this.stats.gatesSeen++;
            if (a.x > o.x && a.x < (o.x2 ?? o.x)) {
              this.gateStreak++;
              const pts = POINTS.gate * Math.min(4, this.gateStreak);
              this.addScore(pts);
              this.stats.gates++;
              this.meters.addAnger(-ANGER.calmGate);
              this.popup(a.x, a.y - 30, this.gateStreak > 1 ? `GATE x${Math.min(4, this.gateStreak)} +${pts}` : `GATE +${pts}`, '#7ad0ff');
              this.audio.play('ping');
            } else this.gateStreak = 0;
          }
          break;
        }
        case 'mogul':
          if (!o.hit && Math.abs(dx) < 12 && Math.abs(dy) < 5 && a.z === 0) { o.hit = true; a.vz = 60 + a.v * 0.15; a.z = 0.01; a.v *= 0.93; }
          break;
        case 'ramp':
          if (!o.hit && Math.abs(dx) < 13 && Math.abs(dy) < 6 && a.z === 0) { o.hit = true; this.launch(PHYS.jump + a.v * PHYS.rampBoost, true); }
          break;
        case 'ice':
          if ((dx / 19) ** 2 + (dy / 8) ** 2 < 1 && a.z === 0) a.onIce = true;
          break;
        case 'cocoa':
          if (this.cocoaCooldown <= 0 && Math.abs(dx) < 22 && dy > -4 && dy < 14 && a.z === 0) this.drinkCocoa();
          break;
        default:
          if (o.r <= 0 || a.invuln > 0) break;
          if (o.low && a.z > 6) break;
          if (dx * dx + dy * dy < (o.r + 5) ** 2) {
            o.hit = true;
            this.crash(o.kind === 'snowman' ? 'Sorry, Frosty.' : undefined);
            return;
          }
      }
    }
  }

  private drinkCocoa() {
    const a = this.andy;
    a.state = 'drink';
    a.t = 1.3;
    a.h = 0;
    this.cocoaCooldown = 6;
    this.meters.cold = 0;
    this.coldWarned = false;
    this.meters.addAnger(-ANGER.calmCocoa);
    this.addScore(POINTS.cocoa);
    this.stats.cocoa++;
    this.audio.play('tea');
    this.say(a, pick(this.rng, ['Ahhh. Hot chocolate.', "Proper cup of tea? No? Fine.", 'Warming the cockles.', 'Squirty cream, please.']));
    this.popup(a.x, a.y - 30, 'WARM!', '#f0a060');
  }

  // ---------------------------------------------------------------- other people

  private addNpc(n: Partial<Npc> & Pick<Npc, 'role' | 'sprite' | 'x' | 'y'>): Npc {
    const npc: Npc = { id: this.nextNpcId++, isObject: false, vx: 0, vy: 0, pose: 'down', flip: false, r: 6, t: 0, phase: this.rng() * 6.28, ...n };
    this.npcs.push(npc);
    return npc;
  }

  private spawnStuff() {
    const a = this.andy;
    const len = this.dayDef.length;
    const ahead = a.y + 430;
    if (a.y > this.nextHazardAt && ahead < len - 300) {
      this.nextHazardAt = a.y + range(this.rng, 450, 900) / (this.dayDef.density * this.hardness);
      const t = this.rng();
      const y = ahead;
      const c = this.piste.centre(y), h = this.piste.half(y);
      if (t < 0.4) {
        // a tourist pootling down
        this.addNpc({ role: 'tourist', sprite: pick(this.rng, ['tourist1', 'tourist2', 'tourist3']), x: c + range(this.rng, -0.7, 0.7) * h, y, vy: range(this.rng, 70, 130) });
      } else if (t < 0.62) {
        // a ski school crocodile crossing the piste
        const dir = this.rng() < 0.5 ? 1 : -1;
        const x0 = c - dir * (h - 10);
        this.addNpc({ role: 'school', sprite: 'mireille', x: x0, y, vx: dir * 34, vy: 16, flip: dir < 0, pose: 'diag' });
        for (let i = 1; i <= 3; i++) this.addNpc({ role: 'school', sprite: pickKid(this.rng), x: x0 - dir * i * 20, y: y - i * 5, vx: dir * 34, vy: 16, flip: dir < 0, pose: 'diag', r: 5 });
      } else if (t < 0.8) {
        this.addNpc({ role: 'boarder', sprite: 'boarder', x: c + range(this.rng, -0.6, 0.6) * h, y, pose: 'sit', bubble: { text: pick(this.rng, ['Brah.', '...', 'Sick.', 'Just chilling, man.']), t: 99 } });
      } else if (this.day >= 1 && t < 0.92) {
        const dir = this.rng() < 0.5 ? 1 : -1;
        this.addNpc({ role: 'basher', sprite: 'basher', isObject: true, x: c - dir * (h + 40), y, vx: dir * 30, flip: dir < 0, r: 0 });
      } else {
        this.addNpc({ role: 'tourist', sprite: pick(this.rng, ['tourist1', 'tourist2', 'tourist3']), x: c + range(this.rng, -0.5, 0.5) * h, y, vy: range(this.rng, 40, 90) });
      }
    }
    if (a.y > this.nextScrapeAt && ahead < len - 500) {
      const live = this.scrapes.filter((s) => s.state === 'live').length;
      this.nextScrapeAt = a.y + (this.dayDef.scrapeEvery / this.hardness) * range(this.rng, 0.75, 1.25);
      if (live < this.dayDef.maxScrapes) this.spawnScrape();
    }
  }

  pickScrape(): ScrapeDef {
    const live = new Set(this.scrapes.filter((s) => s.state === 'live').map((s) => s.def.who));
    const options = SCRAPES.filter((d) => (d.from ?? 0) <= this.day && !live.has(d.who) && !this.recentScrapes.includes(d.id));
    const list = options.length ? options : SCRAPES;
    const total = list.reduce((s, d) => s + (d.weight ?? 1), 0);
    let r = this.rng() * total;
    for (const d of list) if ((r -= d.weight ?? 1) <= 0) return d;
    return list[list.length - 1];
  }

  /** Starts a scrape: random, or a given one (handy for testing from the console). */
  spawnScrape(id?: string): Scrape {
    const def = (id && SCRAPES.find((d) => d.id === id)) || this.pickScrape();
    this.recentScrapes.push(def.id);
    if (this.recentScrapes.length > 6) this.recentScrapes.shift();
    const a = this.andy;
    const y = a.y + 440;
    const c = this.piste.centre(y), h = this.piste.half(y);
    const s: Scrape = { id: ++this.scrapeCount, def, target: null, timeLeft: def.time ?? 0, timeMax: def.time ?? 0, hold: 0, state: 'live', t: 0, still: 0, throwT: 1.5 };
    const shout = () => pick(this.rng, def.say);
    switch (def.kind) {
      case 'help': {
        const side = this.rng() < 0.5 ? -1 : 1;
        const x = def.edge ? c + side * (h - 18) : c + range(this.rng, -0.6, 0.6) * (h - 30);
        s.target = this.addNpc({ role: 'target', sprite: def.who, x, y, pose: def.pose ?? 'stand', r: def.pose === 'crash' || def.pose === 'sit' ? 7 : 6, scrape: s, zzz: def.zzz, flip: side < 0 && def.edge });
        if (def.with) this.addNpc({ role: 'extra', sprite: def.with, x: x + 20, y: y + 2, pose: 'stand', flip: true });
        if (def.tree) this.obstacles.push({ id: this.nextObId++, kind: 'tree', sprite: 'tree', x: x - 12, y: y - 4, r: 7, low: false });
        break;
      }
      case 'fetch': {
        const x = c + range(this.rng, -0.6, 0.6) * (h - 30);
        s.target = this.addNpc({ role: 'item', sprite: def.item ?? 'pass', isObject: true, x, y, r: 0, scrape: s, vy: def.slides ? 110 : 0 });
        if (def.slides) s.timeLeft = s.timeMax = 18;
        break;
      }
      case 'chase': case 'snowball': case 'wild': {
        const x = c + range(this.rng, -0.5, 0.5) * h;
        s.target = this.addNpc({ role: 'target', sprite: def.who, x, y: a.y - 160, vy: a.v * Math.cos(a.h) + 120, r: def.kind === 'wild' ? 7 : 0, scrape: s, pose: 'down' });
        break;
      }
      case 'lift':
        s.target = this.addNpc({ role: 'chair', sprite: 'chair', isObject: true, x: this.piste.liftX, y: a.y + 420, vy: -70, r: 0, rider: def.who, scrape: s, zzz: true });
        break;
      case 'phone':
        break;
    }
    if (s.target) s.target.bubble = { text: shout(), t: 3 };
    this.scrapes.push(s);
    this.toast(def.title, def.who === 'chairman' ? 'chairman' : def.who);
    this.audio.play(def.kind === 'phone' ? 'ring' : 'alert');
    return s;
  }

  private updateNpcs(dt: number) {
    const a = this.andy;
    for (const n of this.npcs) {
      n.t += dt;
      if (n.bubble) { n.bubble.t -= dt; if (n.bubble.t <= 0) n.bubble = undefined; }
      if (n.down !== undefined) {
        n.down -= dt;
        if (n.down <= 0) { n.down = undefined; n.pose = n.role === 'boarder' ? 'sit' : 'down'; }
        continue;
      }
      if (n.role === 'tourist') {
        n.vx = Math.sin(n.t * 1.3 + n.phase) * 50;
        n.pose = Math.abs(n.vx) > 30 ? 'slight' : 'down';
        n.flip = n.vx < 0;
      } else if (n.role === 'target' && n.scrape && n.scrape.state === 'live' && n.scrape.def.kind !== 'help') this.steerChaser(n, n.scrape, dt);
      else if (n.role === 'target' && n.scrape && n.scrape.state !== 'live' && n.scrape.def.kind !== 'help') {
        // done (or given up): wander off down the hill
        n.vy = 60; n.vx = 0; n.pose = 'down';
      }
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      if (n.role === 'snowball') {
        if (n.t > 1.6) n.gone = true;
        else if (a.state === 'ski' && Math.hypot(n.x - a.x, n.y - (a.y - 10)) < 10 && a.invuln <= 0) {
          n.gone = true;
          this.meters.addAnger(ANGER.snowball);
          a.v *= 0.85;
          this.popup(a.x, a.y - 34, 'SPLAT!', '#ffffff');
          this.audio.play('splat');
        }
        continue;
      }
      // bumping into Andy
      if (a.state === 'ski' && a.z < 10 && a.invuln <= 0) {
        if (n.role === 'basher') {
          if (Math.abs(n.x - a.x) < 28 && a.y > n.y - 10 && a.y < n.y + 4) this.crash("Who parks a snow tractor THERE?!", true);
        } else if (n.r > 0 && Math.hypot(n.x - a.x, n.y - a.y) < n.r + 5) {
          this.crash(undefined, true);
          n.bubble = { text: this.lines.pick('bumped', phrases.bumped), t: 2 };
          if (n.role !== 'target') { n.down = 2; n.pose = 'crash'; }
        }
      }
    }
    // tidy up anyone well behind or off the sides
    this.npcs = this.npcs.filter((n) => !n.gone && n.y > a.y - 320 && n.y < a.y + 1600 && n.x > -120 && n.x < VIEW_WIDTH + 120);
  }

  private steerChaser(n: Npc, s: Scrape, dt: number) {
    const a = this.andy;
    const c = this.piste.centre(n.y), h = this.piste.half(n.y);
    const fast = s.def.fast;
    const wild = s.def.kind === 'wild';
    if (s.def.kind === 'lift') return; // the chair just goes up
    // stay a little way ahead of Andy, weaving about
    const lead = (fast ? 40 : 70) + (fast ? 110 : 45) * Math.sin(n.t * (fast ? 1.1 : 0.7) + n.phase);
    const wantY = a.y + lead;
    const andyVy = a.v * Math.cos(a.h);
    n.vy = clamp(andyVy + (wantY - n.y) * 1.6, -40, 420);
    const weave = (h - 26) * Math.sin(n.t * (wild ? 1.9 : fast ? 1.4 : 0.9) + n.phase);
    const wantX = c + weave;
    n.vx = clamp((wantX - n.x) * 2.2, -220, 220);
    n.pose = Math.abs(n.vx) > 120 ? 'diag' : Math.abs(n.vx) > 40 ? 'slight' : 'down';
    if (s.def.who === 'rocker' && Math.sin(n.t * 3) > 0.6) n.pose = 'shout';
    n.flip = n.vx < 0;
    if (n.t % 2.5 < dt && !n.bubble) n.bubble = { text: pick(this.rng, s.def.say), t: 1.6 };
    if (s.def.kind === 'snowball') {
      s.throwT -= dt;
      if (s.throwT <= 0 && n.y > a.y - 200) {
        s.throwT = range(this.rng, 1.0, 1.7);
        const tx = a.x + Math.sin(a.h) * a.v * 0.4, ty = a.y - 10 + andyVy * 0.4;
        const d = Math.max(1, Math.hypot(tx - n.x, ty - (n.y - 14)));
        const sp = 240;
        this.addNpc({ role: 'snowball', sprite: 'snowball', isObject: true, x: n.x, y: n.y - 14, vx: ((tx - n.x) / d) * sp, vy: ((ty - (n.y - 14)) / d) * sp + andyVy, r: 0 });
        n.pose = 'shout';
        this.audio.play('swish');
      }
    }
  }

  // ---------------------------------------------------------------- scrapes

  get helping(): boolean {
    return this._helping;
  }
  private _helping = false;

  /** a live scrape whose target is close enough to Andy to sort out */
  nearTarget(): Scrape | null {
    const a = this.andy;
    for (const s of this.scrapes) {
      if (s.state !== 'live' || !s.target || s.def.kind === 'fetch') continue;
      const t = s.target;
      if (s.def.kind === 'lift') { if (Math.abs(t.x - a.x) < 30 && Math.abs(t.y - 30 - a.y) < 50) return s; continue; }
      if (Math.hypot(t.x - a.x, t.y - a.y) < STAND_REACH + (s.def.kind === 'help' ? 0 : 6)) return s;
    }
    return null;
  }

  private updateScrapes(dt: number, input: Controls) {
    const a = this.andy;
    const near = a.state === 'ski' ? this.nearTarget() : null;
    this._helping = !!near && input.action;
    for (const s of this.scrapes) {
      if (s.state !== 'live') continue;
      s.t += dt;
      if (s.timeMax) s.timeLeft -= dt;
      const t = s.target;
      switch (s.def.kind) {
        case 'fetch':
          if (t && a.state !== 'crash' && Math.hypot(t.x - a.x, t.y - a.y) < 18) { t.gone = true; this.completeScrape(s); continue; }
          if (t && (a.y > t.y + 70 || (s.timeMax && s.timeLeft <= 0))) { t.gone = true; this.missScrape(s); }
          continue;
        case 'phone':
          if (a.v < 14 && a.state === 'ski') s.still += dt;
          if (s.still >= 1.3) { this.completeScrape(s); continue; }
          if (s.timeLeft <= 0) this.missScrape(s);
          continue;
      }
      if (near === s && input.action) {
        // stood-still scrapes: Andy skids to a halt beside them
        if ((s.def.kind === 'help' || s.def.kind === 'lift') && a.v > 0) {
          if (a.v > 60) for (let i = 0; i < 6; i++) this.particles.push({ x: a.x + range(this.rng, -8, 8), y: a.y, vx: range(this.rng, -60, 60), vy: range(this.rng, -50, 0), t: 0.5 });
          a.v = 0;
        }
        s.hold += dt / (s.def.kind === 'help' ? HOLD_HELP : HOLD_CATCH);
        if (s.hold >= 1) { this.completeScrape(s); continue; }
      } else s.hold = Math.max(0, s.hold - dt);
      if (s.def.kind === 'help' && t && a.y > t.y + 60) this.missScrape(s);
      else if (s.def.kind === 'lift' && t && t.y < a.y - 150) this.missScrape(s);
      else if (s.timeMax && s.timeLeft <= 0) this.missScrape(s);
    }
    if (this.scrapes.length > 12) this.scrapes = this.scrapes.filter((s) => s.state === 'live' || s.t < 6);
  }

  completeScrape(s: Scrape) {
    s.state = 'done';
    s.t = 0;
    this.stats.done++;
    const calm = s.def.leeds ? ANGER.calmLeeds : ANGER.calmScrape;
    this.meters.addAnger(-calm);
    this.addScore(POINTS.scrape);
    this.audio.play('done');
    const a = this.andy;
    this.say(a, pick(this.rng, s.def.andy));
    this.popup(a.x, a.y - 44, `+${POINTS.scrape}`, '#5ccf6a');
    const t = s.target;
    if (t) {
      t.bubble = { text: pick(this.rng, s.def.thanks), t: 2.4 };
      if (t.role === 'chair') { t.zzz = false; }
      if (s.def.kind === 'help') { t.pose = 'stand'; t.zzz = false; t.r = 0; t.scrape = undefined; }
      if (s.def.kind === 'chase' || s.def.kind === 'snowball' || s.def.kind === 'wild') t.r = 0;
    }
    if (!t || t.gone) this.toast(`${NAMES[s.def.who] ?? s.def.who}: "${pick(this.rng, s.def.thanks)}"`, s.def.who, true);
  }

  missScrape(s: Scrape, quiet = false) {
    s.state = 'missed';
    s.t = 0;
    this.stats.missed++;
    this.meters.addAnger(s.def.leeds ? ANGER.missedLeeds : ANGER.missed);
    if (s.target) { s.target.r = 0; if (s.target.role === 'target' && s.def.kind !== 'help') s.target.vy = 40; }
    if (quiet) return;
    this.audio.play('fail');
    this.say(this.andy, this.lines.pick('grumble', phrases.grumbles));
    this.toast(s.def.leeds ? 'Nobody put Banter Bob right about Leeds. Andy is FUMING.' : `Missed: ${s.def.short}.`, s.def.who);
  }

  // ---------------------------------------------------------------- meters and effects

  private updateMeters(dt: number) {
    const m = this.meters;
    m.cold = clamp(m.cold + ANGER.coldRate * dt * this.hardness, 0, 100);
    if (m.cold >= 100) {
      m.addAnger(ANGER.coldAnger * dt);
      if (!this.coldWarned) { this.coldWarned = true; this.toast("Andy's freezing. Ski through a hot chocolate stand!", 'andy_angry'); this.say(this.andy, "I can't feel my FACE."); }
    }
    this.cocoaCooldown -= dt;
  }

  private updateFx(dt: number) {
    for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; p.t -= dt; }
    this.particles = this.particles.filter((p) => p.t > 0);
    for (const p of this.popups) { p.y -= 22 * dt; p.t -= dt; }
    this.popups = this.popups.filter((p) => p.t > 0);
    for (const t of this.toasts) t.t -= dt;
    this.toasts = this.toasts.filter((t) => t.t > 0);
  }

  say(who: { bubble?: Bubble }, text: string) {
    who.bubble = { text, t: 2.6 };
  }

  toast(text: string, who?: string, good = false) {
    this.toasts.push({ text, who, t: 4.5, good });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  popup(x: number, y: number, text: string, color: string) {
    this.popups.push({ x, y, text, color, t: 1.2 });
  }

  /** Andy's sprite pose right now. */
  andyPose(): { pose: Pose; flip: boolean } {
    const a = this.andy;
    const flip = a.h < 0;
    if (a.state === 'crash') return { pose: 'crash', flip: false };
    if (a.state === 'drink' || this.helping) return { pose: 'stand', flip: false };
    if (a.z > 0) return { pose: 'jump', flip: false };
    const ah = Math.abs(a.h);
    if (ah < 0.2) return { pose: a.tuck ? 'tuck' : a.v < 8 ? 'stand' : 'down', flip };
    if (ah < 0.6) return { pose: 'slight', flip };
    if (ah < 1.1) return { pose: 'diag', flip };
    return { pose: 'side', flip };
  }

  /** Metres, as shown on the HUD (1 metre = 10 pixels). */
  metres(px: number): number {
    return Math.max(0, Math.round(px / 10));
  }

  get progress(): number {
    return clamp(this.andy.y / this.dayDef.length, 0, 1);
  }
}

export { CHUNK };
