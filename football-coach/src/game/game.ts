import mapJson from '../data/map.json';
import charactersJson from '../data/characters.json';
import tuningJson from '../data/tuning.json';
import eventsJson from '../data/events.json';
import phrasesJson from '../data/catchphrases.json';
import callsJson from '../data/phonecalls.json';
import { TileMap, type MapData, type Vec } from '../world/map';
import { makeRng, pick, range, type Rng } from '../core/rng';
import { Andy, Npc, type Activity, type Dir } from '../entities/person';
import { PhraseRotator } from './catchphrases';
import { addAnger, tickNeeds, type Meters } from './meters';
import { Spawner, type EventDefs, type EventType } from './spawner';
import { makeMemberCheck, isCorrectDecision, squadName, type MemberCheck, type Activity as Squad } from './membership';
import type { Audio, Sfx } from '../core/audio';
import type { Input } from '../core/input';

export type Tuning = typeof tuningJson;
export type Screen = 'title' | 'playing' | 'paused' | 'dayEnd' | 'gameover';

export interface CharacterDef {
  id: string;
  name: string;
  role: string;
  group: string;
  desk?: string;
  post?: string;
  facing?: Dir;
  activity?: string;
  squad?: Squad;
}

export type TroubleKind = 'goal' | 'window' | 'scrap' | 'icecream';
export type MessKind = 'mud' | 'kitpile' | 'puddle' | 'blocked';

export interface Task {
  id: number;
  type: EventType;
  title: string;
  detail: string;
  icon: string;
  portrait?: string;
  verb: string;
  timeLeft: number;
  timeLimit: number;
  hold: number;
  progress: number;
  phase: 'live';
  radius: number;
  target: () => Vec | null;
  npc?: Npc;
  /** Someone else caught up in it (the dog's owner). */
  helper?: Npc;
  variant?: string;
  /** Who is on the other end of a phone call. */
  caller?: Caller;
  /** The registration card being checked at the sign-in table. */
  check?: MemberCheck;
  /** Where a mess or a lost ball is. */
  spot?: Vec;
  /** Which goal (1 left, 2 right). */
  num?: number;
  /** Which training group. */
  squad?: Squad;
}

/** Someone on the phone (or the parents' WhatsApp group). */
export interface Caller { name: string; portrait?: string; cold: boolean; whatsapp?: boolean }

export interface Interactable {
  key: string;
  label: string;
  pos: Vec;
  hold: number;
  progress: number;
  task?: Task;
  kind: 'task' | 'toilet' | 'tea';
}

export type Modal =
  | { kind: 'member'; task: Task; check: MemberCheck }
  | { kind: 'call'; task: Task; caller: Caller; text: string; complaint: boolean }
  | { kind: 'manager'; t: number; total: number; line: string; task: Task };

export interface Toast { text: string; x: number; y: number; t: number; colour: string }

export interface DayStats { done: number; failed: number; score: number }

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const SQUADS: Squad[] = ['u8', 'u10', 'u12'];
const STATION: Record<Squad, string> = { u8: 'stationU8', u10: 'stationU10', u12: 'stationU12' };
const DRILL: Record<Squad, string> = { u8: 'passing drill', u10: 'shooting practice', u12: 'dribbling drill' };

const MESS_ROOMS: Record<Exclude<MessKind, 'blocked'>, string[]> = {
  mud: ['changing', 'corridor'],
  kitpile: ['changing'],
  puddle: ['changing', 'toilets'],
};

/** Which garden each neighbour lives in, and its gate. */
const GARDENS: Record<string, { room: string; gate: string }> = {
  grimshaw: { room: 'gardenA', gate: 'gateA' },
  pemberton: { room: 'gardenB', gate: 'gateB' },
  nigel: { room: 'gardenC', gate: 'gateC' },
};

export class Game {
  readonly map: TileMap;
  readonly tuning: Tuning = tuningJson;
  readonly defs = eventsJson as unknown as EventDefs;
  readonly characters = charactersJson.characters as CharacterDef[];
  rng: Rng;
  screen: Screen = 'title';
  day = 1;
  clock = 0; // seconds since opening time
  score = 0;
  best = 0;
  stats: DayStats = { done: 0, failed: 0, score: 0 };
  meters: Meters = { anger: 0, bladder: 0, thirst: 0 };
  andy!: Andy;
  npcs: Npc[] = [];
  tasks: Task[] = [];
  modal: Modal | null = null;
  toasts: Toast[] = [];
  banner: { text: string; t: number } | null = null;
  near: Interactable | null = null;
  holding = false;
  toiletOutOfOrder = 0;
  slowed = false;
  lastPhrase = '';
  /** Fob-offs (phone, WhatsApp and neighbours) since the Chairman last wanted a word. */
  brushOffsToday = 0;

  private spawner!: Spawner;
  private nextId = 1;
  private ringT = 0;
  private teaProgress = 0;
  private looProgress = 0;
  private mutterT = 20;
  private stepT = 0;
  private readonly lines: Record<string, PhraseRotator> = {};
  private readonly trouble: Record<TroubleKind, PhraseRotator>;

  constructor(private readonly audio: Audio | null, seed = Date.now()) {
    this.map = new TileMap(mapJson as unknown as MapData);
    this.rng = makeRng(seed);
    const P = phrasesJson, C = callsJson;
    const lists: Record<string, string[]> = {
      catchphrases: P.catchphrases, grumbles: P.grumbles, excuses: P.excuses, chairman: P.chairman, drills: P.drills,
      parents: P.parents, dogs: P.dogs, owner: P.owner, neighbours: P.neighbours, whatsapp: P.whatsapp,
      alSneak: P.alistair.sneaking, alCaught: P.alistair.caught, alExcuses: P.alistair.excuses, alEscaped: P.alistair.escaped,
      requests: C.requests, callers: C.callers, brushOffs: C.brushOffs, ticketLines: C.ticketLines,
      coldCallers: C.coldCallers, coldCalls: C.coldCalls, hangUps: C.hangUpLines, hearOuts: C.hearOutLines,
    };
    for (const [k, v] of Object.entries(lists)) this.lines[k] = new PhraseRotator(v, this.rng);
    this.trouble = {} as Record<TroubleKind, PhraseRotator>;
    for (const [k, v] of Object.entries(P.trouble)) this.trouble[k as TroubleKind] = new PhraseRotator(v, this.rng);
    try { this.best = Number(localStorage.getItem('andyFC.best') || 0); } catch { /* storage blocked */ }
    this.resetWorld();
  }

  private line(k: string): string {
    return this.lines[k].next();
  }

  // ------------------------------------------------------------ lifecycle

  newGame() {
    this.day = 1;
    this.score = 0;
    this.meters = { anger: this.tuning.startAnger, bladder: 0, thirst: 0 };
    this.startDay();
  }

  startDay() {
    this.resetWorld();
    this.clock = 0;
    this.stats = { done: 0, failed: 0, score: 0 };
    this.meters.bladder = this.tuning.needsStartBladder;
    this.meters.thirst = this.tuning.needsStartThirst;
    this.spawner = new Spawner(this.rng, this.tuning, this.defs, this.day);
    this.brushOffsToday = 0;
    this.screen = 'playing';
    this.banner = { text: `DAY ${this.day} - ${this.dateLabel()}`, t: 3 };
    this.andy.say(this.day === 1 ? 'Right. Boots on...' : 'Back again. Marvellous.', 3, 'andy');
  }

  nextDay() {
    this.day++;
    this.meters.anger *= this.tuning.angerCarryOver;
    this.startDay();
  }

  private resetWorld() {
    const seat = this.map.seat('andy');
    this.andy = new Andy(seat.x, seat.y + 2);
    this.andy.dir = 'up';
    this.npcs = [];
    const out = this.map.point('outsideLeft');
    for (const c of this.characters) {
      if (c.group === 'andy' || c.group === 'portrait') continue;
      const post = c.post ? this.map.point(c.post) : null;
      const base = c.group === 'dog' ? this.tuning.dogSpeed : c.group === 'kid' || c.group === 'arrival' ? this.tuning.kidSpeed : this.tuning.npcSpeed;
      const speed = base * range(this.rng, 0.9, 1.1);
      const p = post ?? out;
      const n = new Npc(c.id, c.name, p.x, p.y, post, c.facing ?? 'down', c.group, (c.activity as Activity) ?? null, speed);
      if (post) n.sitDown();
      else n.hidden = true;
      this.npcs.push(n);
    }
    this.tasks = [];
    this.modal = null;
    this.toasts = [];
    this.toiletOutOfOrder = 0;
    this.near = null;
  }

  dateLabel(): string {
    return DAYS[(this.day - 1) % 7];
  }

  today(): Date {
    return new Date(2026, 10, 1 + this.day); // day 1 = Monday 2 November 2026
  }

  get dayFrac(): number {
    return Math.min(1, this.clock / this.tuning.dayLengthSeconds);
  }

  clockLabel(): string {
    const mins = this.tuning.dayStartHour * 60 + this.dayFrac * (this.tuning.dayEndHour - this.tuning.dayStartHour) * 60;
    const h = Math.floor(mins / 60), m = Math.floor(mins % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  npc(id: string): Npc {
    const n = this.npcs.find((k) => k.id === id);
    if (!n) throw new Error(`No npc ${id}`);
    return n;
  }

  squadOf(n: Npc): Squad | undefined {
    return this.characters.find((c) => c.id === n.id)?.squad;
  }

  private sfx(s: Sfx) {
    this.audio?.play(s);
  }

  toast(text: string, at: Vec, colour = '#fff') {
    this.toasts.push({ text, x: at.x, y: at.y - 28, t: 1.6, colour });
  }

  // ------------------------------------------------------------ main update

  update(dt: number, input: Input) {
    if (input.took('mute')) this.audio?.toggleMute();
    if (this.screen === 'playing' && input.took('pause')) {
      this.screen = 'paused';
      return;
    }
    if (this.screen === 'paused') {
      if (input.took('pause') || input.took('action') || input.clicks.length) this.screen = 'playing';
      return;
    }
    if (this.screen !== 'playing') return;

    // the world waits while Andy reads a registration card or is on the phone
    if (this.modal?.kind === 'member') { this.updateMemberModal(input); return; }
    if (this.modal?.kind === 'call') { this.updateCallModal(input); return; }

    this.clock += dt;
    for (const t of this.toasts) { t.t -= dt; t.y -= 14 * dt; }
    this.toasts = this.toasts.filter((t) => t.t > 0);
    if (this.banner && (this.banner.t -= dt) <= 0) this.banner = null;
    if (this.toiletOutOfOrder > 0) this.toiletOutOfOrder -= dt;

    const needs = tickNeeds(this.meters, dt, this.tuning);
    this.slowed = needs.bladderFull || needs.thirstFull;

    this.updateAndy(dt, input);
    for (const n of this.npcs) n.update(dt, this.map, this.rng);

    this.updateTasks(dt);
    const type = this.spawner.update(dt, this.dayFrac, this.tasks.length, (k) => this.canSpawn(k));
    if (type) this.spawn(type);

    if (this.modal?.kind === 'manager') {
      this.modal.t -= dt;
      if (this.modal.t <= 0) {
        const task = this.modal.task;
        this.modal = null;
        const p = this.map.point('meetingSpot');
        this.andy.hidden = false;
        this.andy.x = p.x;
        this.andy.y = p.y;
        this.andy.dir = 'down';
        this.completeTask(task, 'Never again.');
      }
    }

    if (this.meters.anger >= 100) this.meltdown();
    else if (this.clock >= this.tuning.dayLengthSeconds) this.endDay();
  }

  private updateAndy(dt: number, input: Input) {
    const a = this.andy;
    a.tickBubble(dt);
    if (a.hidden) return;
    this.near = this.findInteractable();
    this.holding = false;
    if (input.action && this.near) {
      this.holding = true;
      this.doHold(this.near, dt);
      return;
    }
    if (!input.action) { this.teaProgress = 0; this.looProgress = 0; }
    const speed = this.tuning.andySpeed * (this.slowed ? this.tuning.andySlowFactor : 1);
    if (input.ax || input.ay) {
      a.move(input.ax * speed * dt, input.ay * speed * dt, this.map);
      a.face(input.ax, input.ay);
      a.pose = 'walk';
      this.stepT -= dt;
      if (this.stepT <= 0) { this.stepT = 0.3; this.sfx('step'); }
      this.mutterT -= dt;
      if (this.mutterT <= 0 && !a.bubble) {
        const [lo, hi] = this.tuning.muttersEverySeconds;
        this.mutterT = range(this.rng, lo, hi);
        this.sayCatchphrase();
      }
    } else {
      a.pose = 'stand';
    }
  }

  sayCatchphrase() {
    this.lastPhrase = this.line('catchphrases');
    this.andy.say(this.lastPhrase, 2.8, 'andy');
  }

  private findInteractable(): Interactable | null {
    const a = { x: this.andy.x, y: this.andy.y };
    const r = this.tuning.interactRadius;
    const cands: Interactable[] = [];
    for (const t of this.tasks) {
      const p = t.target();
      if (!p || dist(a, p) > t.radius) continue;
      cands.push({ key: `task${t.id}`, label: t.verb, pos: p, hold: t.hold, progress: t.progress, task: t, kind: 'task' });
    }
    const loo = this.map.point('toilet');
    if (dist(a, loo) <= r && this.meters.bladder >= this.tuning.needMinimumToUse && this.toiletOutOfOrder <= 0 && !this.tasks.some((t) => t.variant === 'blocked'))
      cands.push({ key: 'loo', label: 'Use the loo', pos: loo, hold: this.tuning.toiletSeconds, progress: this.looProgress, kind: 'toilet' });
    const kettle = this.map.point('kettle');
    if (dist(a, kettle) <= r && this.meters.thirst >= this.tuning.needMinimumToUse)
      cands.push({ key: 'tea', label: 'Make tea', pos: kettle, hold: this.tuning.teaSeconds, progress: this.teaProgress, kind: 'tea' });
    if (!cands.length) return null;
    const rank = (c: Interactable) => (c.task?.type === 'phone' && c.task.variant === 'mobile' ? 1e6 : dist(a, c.pos));
    cands.sort((p, q) => rank(p) - rank(q));
    return cands[0];
  }

  private doHold(it: Interactable, dt: number) {
    const a = this.andy;
    a.face(it.pos.x - a.x, it.pos.y - a.y);
    const loud = it.task && ['trouble', 'parent', 'dog', 'lee', 'alistair', 'assistant', 'drill'].includes(it.task.type);
    a.pose = loud ? 'shout' : a.dir === 'up' ? 'work' : 'stand';
    const inc = dt / it.hold;
    if (it.kind === 'tea') {
      this.teaProgress += inc;
      it.progress = this.teaProgress;
      if (this.teaProgress >= 1) {
        this.teaProgress = 0;
        this.meters.thirst = 0;
        addAnger(this.meters, -this.tuning.teaCalm);
        this.sfx('tea');
        a.say('Ahh. Proper tea.', 2, 'andy');
        this.toast(`-${this.tuning.teaCalm} anger`, a, '#8f8');
      }
    } else if (it.kind === 'toilet') {
      this.looProgress += inc;
      it.progress = this.looProgress;
      if (this.looProgress >= 1) {
        this.looProgress = 0;
        this.meters.bladder = 0;
        this.sfx('flush');
        a.say("That's better.", 2, 'andy');
      }
    } else if (it.task) {
      const t = it.task;
      // whoever Andy is dealing with stops where they are until he's done
      const n = t.npc;
      if (n && !n.hidden && dist(n, a) < 34) { n.stopped = 0.25; n.face(a.x - n.x, a.y - n.y); }
      if ((t.type === 'dog' || t.type === 'lee') && n) n.stopped = 0.25;
      if (t.type === 'drill' && Math.floor((t.progress + inc) * 3) > Math.floor(t.progress * 3)) {
        this.sfx('whistle');
        a.say(this.line('drills'), 1.2, 'andy');
      }
      t.progress += inc;
      it.progress = t.progress;
      if (t.progress >= 1) {
        t.progress = 1;
        this.finishHold(t);
      }
    }
  }

  // ------------------------------------------------------------ tasks

  private updateTasks(dt: number) {
    for (const t of [...this.tasks]) {
      t.timeLeft -= dt;
      if (t.type === 'phone' && (this.ringT -= dt) <= 0) {
        this.ringT = 1.3;
        this.sfx(t.caller?.whatsapp ? 'ping' : 'ring');
      }
      if (t.type === 'dog' && t.npc && !t.npc.hidden && this.rng() < dt * 0.25) this.sfx('bark');
      if (t.timeLeft <= 0) this.failTask(t);
    }
  }

  /** People not already caught up in a task. */
  private free(filter: (n: Npc) => boolean): Npc[] {
    return this.npcs.filter((n) => !n.busy && filter(n) && !this.tasks.some((t) => t.npc === n || t.helper === n));
  }
  /** Off-site people (arrivals, parents, visitors, dogs) who could turn up. */
  private outside(group: string | string[], except: string[] = []): Npc[] {
    const gs = Array.isArray(group) ? group : [group];
    return this.free((n) => n.hidden && !n.path && gs.includes(n.group) && !except.includes(n.id));
  }
  /** Kids at their station, free to get into bother. */
  private kidsAtPost(squad?: Squad): Npc[] {
    return this.free((n) => n.group === 'kid' && n.seated && !n.hidden && (!squad || this.squadOf(n) === squad));
  }
  private has(k: EventType) {
    return this.tasks.some((t) => t.type === k);
  }
  private count(k: EventType) {
    return this.tasks.filter((t) => t.type === k).length;
  }
  /** The sign-in table only deals with one kid at a time. */
  private tableBusy() {
    return this.has('signin') || this.npcs.some((n) => !n.hidden && dist(n, this.map.point('signinSpot')) < 6);
  }
  /** Training groups that are happily playing (so can get bored). */
  drillableSquads(): Squad[] {
    return SQUADS.filter((s) => !this.tasks.some((t) => t.type === 'drill' && t.squad === s) && this.kidsAtPost(s).length >= 2);
  }

  canSpawn(type: EventType): boolean {
    if (this.dayFrac > 0.97) return false;
    switch (type) {
      case 'signin': return !this.tableBusy() && this.outside('arrival').length > 0;
      case 'drill': return this.drillableSquads().length > 0;
      case 'dog': return this.count('dog') < 2 && this.outside('dog').length > 0;
      case 'poo': return this.count('poo') < 2;
      case 'changing': return this.count('changing') < 2;
      case 'neighbour': return !this.has('neighbour') && this.free((n) => n.group === 'neighbour' && n.seated).length > 0;
      case 'ball': return this.count('ball') < 2;
      case 'parent': return this.count('parent') < 2 && this.outside('parent').length > 0;
      case 'trouble': return this.count('trouble') < 2 && this.troubleKinds().length > 0;
      case 'injury': return !this.has('injury') && this.kidsAtPost().length > 0;
      case 'net': return this.count('net') < 2;
      case 'balls': return !this.has('balls');
      case 'alistair': return !this.has('alistair') && this.outside('visitor').some((n) => n.id === 'alistair');
      case 'lee': return !this.has('lee') && this.outside('visitor').some((n) => n.id === 'lee');
      case 'assistant': return !this.has('assistant') && this.free((n) => n.id === 'gaz' && n.seated).length > 0;
      case 'phone': return !this.has('phone') && !this.modal;
      case 'chairman': return !this.has('chairman') && !this.modal;
    }
  }

  spawn(type: EventType) {
    switch (type) {
      case 'signin': this.spawnSignin(); break;
      case 'drill': this.spawnDrill(); break;
      case 'dog': this.spawnDog(); break;
      case 'poo': this.spawnPoo(); break;
      case 'changing': this.spawnChanging(); break;
      case 'neighbour': this.spawnNeighbour(); break;
      case 'ball': this.spawnBall(); break;
      case 'parent': this.spawnParent(); break;
      case 'trouble': this.spawnTrouble(); break;
      case 'injury': this.spawnInjury(); break;
      case 'net': this.spawnNet(); break;
      case 'balls': this.spawnBalls(); break;
      case 'alistair': this.spawnAlistair(); break;
      case 'lee': this.spawnLee(); break;
      case 'assistant': this.spawnAssistant(); break;
      case 'phone': this.spawnPhone(); break;
      case 'chairman': this.spawnChairman(); break;
    }
  }

  private baseTask(type: EventType, fields: Partial<Task> & Pick<Task, 'title' | 'detail' | 'icon' | 'verb' | 'target'>): Task {
    const d = this.defs[type];
    const limit = this.spawner.timeLimit(type);
    const t: Task = {
      id: this.nextId++,
      type,
      timeLeft: limit,
      timeLimit: limit,
      hold: d.hold,
      progress: 0,
      phase: 'live',
      radius: this.tuning.interactRadius,
      ...fields,
    };
    this.tasks.push(t);
    this.sfx('alert');
    return t;
  }

  /** Walk someone in from the car park gate (or the park gate, or wherever). */
  private walkIn(n: Npc, to: Vec, onArrive: () => void, from = 'carParkGate') {
    const p = this.map.point(from);
    n.hidden = false;
    n.busy = true;
    n.activity = null;
    n.x = p.x;
    n.y = p.y;
    n.goTo(this.map, to, onArrive);
  }

  /** Send someone home: off through the car park, or back out of the park gate. */
  private leave(n: Npc, fast = false, via: 'carpark' | 'park' = 'carpark') {
    n.busy = true;
    n.activity = null;
    const sp = n.speed;
    if (fast) n.speed *= 1.6;
    const to = via === 'park' ? this.map.point('parkGate') : this.map.point(this.rng() < 0.5 ? 'outsideLeft' : 'outsideRight');
    const done = () => {
      n.hidden = true;
      n.busy = false;
      n.speed = sp;
    };
    if (!n.goTo(this.map, to, done)) done();
  }

  /** A random open spot in one of these rooms, away from other tasks and people's posts. */
  private findSpot(rooms: string[], avoid = 40): Vec | null {
    const m = this.map, ts = m.ts;
    const reach = m.reachable(m.seat('andy'));
    const tiles: Vec[] = [];
    for (let ty = 0; ty < m.h; ty++)
      for (let tx = 0; tx < m.w; tx++) {
        const p = { x: (tx + 0.5) * ts, y: (ty + 0.5) * ts };
        const r = m.roomAt(p);
        if (!r || !rooms.includes(r.id) || !reach.has(ty * m.w + tx) || m.blocked(tx, ty)) continue;
        if (m.blocked(tx, ty - 1) && m.blocked(tx, ty + 1)) continue; // not in a doorway
        if (this.tasks.some((t) => t.spot && dist(t.spot, p) < avoid)) continue;
        if (this.npcs.some((n) => n.post && dist(n.post, p) < 20)) continue;
        tiles.push(p);
      }
    return tiles.length ? pick(this.rng, tiles) : null;
  }

  /** Somewhere on the pitch for a dog or a cyclist to run to. */
  private pitchPoint(): Vec {
    const ts = this.map.ts;
    for (let i = 0; i < 30; i++) {
      const tx = 2 + Math.floor(this.rng() * 24), ty = 7 + Math.floor(this.rng() * 13);
      if (!this.map.blocked(tx, ty)) return { x: (tx + 0.5) * ts, y: (ty + 0.5) * ts };
    }
    return this.map.point('scrapSpot');
  }

  // ---- the sign-in table: registration cards

  private spawnSignin() {
    const n = pick(this.rng, this.outside('arrival'));
    const others = this.characters.filter((c) => c.group === 'arrival' && c.id !== n.id).map((c) => c.id);
    const check = makeMemberCheck(this.rng, this.today(), this.defs.signin.legitChance ?? 0.55, n, others);
    this.walkIn(n, this.map.point('signinSpot'), () => { n.dir = 'up'; n.say(`I'm here for the ${squadName(check.activity)}!`, 2.5); });
    this.baseTask('signin', {
      title: 'New kid to sign in',
      detail: `${n.name} wants to train`,
      icon: 'clipboard',
      portrait: n.id,
      verb: 'Check their card',
      npc: n,
      check,
      radius: 34,
      target: () => (n.path ? null : { x: n.x, y: n.y }),
    });
  }

  private updateMemberModal(input: Input) {
    const m = this.modal as Extract<Modal, { kind: 'member' }>;
    const choice = this.modalChoice(input);
    if (choice === null) return;
    this.modal = null;
    const { task, check } = m;
    const n = task.npc!;
    this.tasks = this.tasks.filter((k) => k !== task);
    if (choice) {
      n.say(pick(this.rng, ['Yesss!', 'Cheers Coach!', 'Where do I get changed?']), 1.6);
      n.goTo(this.map, this.map.point('changingIn'), () => { n.hidden = true; n.busy = false; });
    } else {
      n.say(pick(this.rng, ["That's SO unfair!", "I'm telling my mum!", 'My dad will sort you out!']), 2);
      this.leave(n);
    }
    if (isCorrectDecision(check, choice)) {
      this.completeTask(task, choice ? 'Go on then. Boots on.' : 'Not today, sunshine!', false);
    } else {
      this.stats.failed++;
      addAnger(this.meters, this.defs.signin.angerOnWrong ?? 10);
      this.sfx('wrong');
      const why = check.legit ? 'Their card was fine!' : check.problem ?? 'Dodgy card!';
      this.toast(`Wrong call! ${why}`, this.andy, '#f88');
      this.andy.say(this.line('grumbles'), 2, 'andy');
    }
  }

  // ---- coaching: a training group is bored

  private spawnDrill() {
    const squad = pick(this.rng, this.drillableSquads());
    for (const k of this.kidsAtPost(squad)) k.activity = 'bored';
    const spot = this.map.point(STATION[squad]);
    this.baseTask('drill', {
      title: `${squadName(squad)} are bored`,
      detail: `They need a ${DRILL[squad]}`,
      icon: 'cone',
      verb: `Run the ${DRILL[squad]}`,
      squad,
      spot,
      radius: 30,
      target: () => spot,
    });
  }

  private endDrill(t: Task) {
    for (const k of this.npcs) if (k.group === 'kid' && this.squadOf(k) === t.squad && k.activity === 'bored') k.activity = 'play';
  }

  // ---- dogs on the pitch

  private spawnDog() {
    const dog = pick(this.rng, this.outside('dog'));
    const owner = this.outside('visitor').find((n) => n.id === 'doreen');
    const zoom = () => {
      if (!dog.busy || dog.hidden) return;
      dog.activity = 'zoomies';
      dog.path = [this.pitchPoint()];
      dog.onArrive = zoom;
      if (this.rng() < 0.35) dog.say(this.line('dogs'), 1.4);
    };
    this.walkIn(dog, this.pitchPoint(), zoom, 'parkGate');
    dog.say('WOOF!', 1.5);
    if (owner) {
      const spot = this.map.point('parkGate');
      this.walkIn(owner, { x: spot.x + 18, y: spot.y + 4 }, () => { owner.dir = 'right'; owner.activity = 'owner'; owner.say(this.line('owner'), 2.4); }, 'parkGate');
    }
    this.baseTask('dog', {
      title: `${dog.name} is on the pitch!`,
      detail: 'Loose dog chasing the ball',
      icon: 'dog',
      portrait: dog.id,
      verb: `Chase ${dog.name} off`,
      npc: dog,
      helper: owner,
      radius: this.tuning.interactRadius + 6,
      target: () => ({ x: dog.x, y: dog.y }),
    });
    this.banner = { text: 'Dog on the pitch!', t: 2.5 };
    this.sfx('bark');
  }

  // ---- mess

  private spawnPoo(at?: Vec) {
    const spot = at ?? this.findSpot(['pitch']);
    if (!spot) return;
    this.baseTask('poo', {
      title: 'Dog mess on the pitch',
      detail: 'Somebody will slide in it',
      icon: 'poo',
      verb: 'Scoop the poop',
      variant: 'poo',
      spot,
      target: () => spot,
    });
  }

  private spawnChanging() {
    const blockedFree = this.toiletOutOfOrder <= 0 && !this.tasks.some((t) => t.variant === 'blocked');
    const kind = pick(this.rng, ['mud', 'mud', 'kitpile', 'puddle', ...(blockedFree ? ['blocked'] : [])] as MessKind[]);
    const spot = kind === 'blocked' ? this.map.point('toilet') : this.findSpot(MESS_ROOMS[kind]);
    if (!spot) return;
    const room = this.map.roomAt(spot)?.name ?? 'clubhouse';
    const info: Record<MessKind, { title: string; detail: string; verb: string; icon: string; hold: number }> = {
      mud: { title: 'Mud everywhere', detail: `Boot prints all over the ${room}`, verb: 'Mop it up', icon: 'mop', hold: 1 },
      kitpile: { title: 'Lost property mountain', detail: 'Whose are these pants?!', verb: 'Bag up the kit', icon: 'kit', hold: 0.8 },
      puddle: { title: 'Tap left running', detail: `The ${room} is flooding`, verb: 'Turn it off and mop', icon: 'mop', hold: 1.1 },
      blocked: { title: 'Loo blocked!', detail: "Somebody's flushed a shin pad", verb: 'Plunge the loo', icon: 'toilet', hold: 1.3 },
    };
    const i = info[kind];
    this.baseTask('changing', {
      title: i.title,
      detail: i.detail,
      verb: i.verb,
      icon: i.icon,
      variant: kind,
      spot,
      hold: this.defs.changing.hold * i.hold,
      target: () => spot,
    });
  }

  // ---- the neighbours

  private spawnNeighbour() {
    const n = pick(this.rng, this.free((k) => k.group === 'neighbour' && k.seated));
    const text = this.line('neighbours');
    n.busy = true;
    n.activity = null;
    n.goTo(this.map, this.map.point(GARDENS[n.id].gate), () => { n.dir = 'down'; n.activity = 'complain'; });
    this.baseTask('neighbour', {
      title: 'Neighbour complaining',
      detail: `${n.name} is at the gate`,
      icon: 'house',
      portrait: n.id,
      verb: 'Hear them out',
      npc: n,
      variant: text,
      radius: 34,
      target: () => (n.path ? null : { x: n.x, y: n.y }),
    });
  }

  private spawnBall() {
    const taken = this.tasks.filter((t) => t.type === 'ball').map((t) => t.variant);
    const owners = Object.keys(GARDENS).filter((k) => !taken.includes(k));
    if (!owners.length) return;
    const who = pick(this.rng, owners);
    const spot = this.findSpot([GARDENS[who].room], 24);
    if (!spot) return;
    const n = this.npc(who);
    n.say(pick(this.rng, ['Not AGAIN!', "That's MY ball now!", 'My begonias!']), 2.4);
    const kid = pick(this.rng, this.kidsAtPost().concat([this.npc('kyle')]));
    kid.say('Sorry Coach!', 1.8);
    this.sfx('kick');
    this.baseTask('ball', {
      title: 'Ball over the fence',
      detail: `It's in ${n.name}'s garden`,
      icon: 'ball',
      portrait: who,
      verb: 'Get the ball back',
      variant: who,
      spot,
      target: () => spot,
    });
  }

  // ---- touchline parents

  private spawnParent() {
    const n = pick(this.rng, this.outside('parent'));
    const used = this.tasks.filter((t) => t.type === 'parent').map((t) => t.variant);
    const where = pick(this.rng, ['touch1', 'touch2', 'touch3'].filter((k) => !used.includes(k)));
    const shout = () => n.say(this.line('parents'), 2.2);
    this.walkIn(n, this.map.point(where), () => { n.dir = 'up'; n.activity = 'shouting'; shout(); });
    this.baseTask('parent', {
      title: 'Touchline parent',
      detail: `${n.name} is "coaching" from the side`,
      icon: 'rant',
      portrait: n.id,
      verb: 'Have a word',
      npc: n,
      variant: where,
      radius: this.tuning.interactRadius + 4,
      target: () => (n.path ? null : { x: n.x, y: n.y }),
    });
  }

  // ---- kids being kids

  private troubleKinds(): { kind: TroubleKind; n: Npc }[] {
    const kids = this.kidsAtPost();
    if (!kids.length) return [];
    const busy = (k: TroubleKind) => this.tasks.some((t) => t.type === 'trouble' && t.variant === k);
    return (['goal', 'window', 'scrap', 'icecream'] as TroubleKind[]).filter((k) => !busy(k)).map((kind) => ({ kind, n: pick(this.rng, kids) }));
  }

  private spawnTrouble() {
    const { kind, n } = pick(this.rng, this.troubleKinds());
    const shout = () => n.say(this.trouble[kind].next(), 2);
    const info: Record<TroubleKind, { title: string; detail: string; verb: string; icon: string; to: string; dir: Dir }> = {
      goal: { title: 'Climbing the goal!', detail: `${n.name} is swinging on the crossbar`, verb: 'Get them down', icon: 'warning', to: 'goalClimb', dir: 'up' },
      window: { title: 'Balls at the clubhouse', detail: `${n.name} is aiming for the windows`, verb: 'Confiscate the ball', icon: 'ball', to: 'windowSpot', dir: 'right' },
      scrap: { title: 'Scrap in the centre circle', detail: `${n.name} has lost it`, verb: 'Break it up', icon: 'whistle', to: 'scrapSpot', dir: 'down' },
      icecream: { title: 'Ice cream van!', detail: `${n.name} has legged it to the van`, verb: 'Drag them back', icon: 'icecream', to: 'iceCream', dir: 'down' },
    };
    const i = info[kind];
    n.busy = true;
    n.activity = null;
    n.goTo(this.map, this.map.point(i.to), () => { n.dir = i.dir; n.activity = kind; shout(); });
    if (kind === 'icecream') this.sfx('chimes');
    this.baseTask('trouble', {
      title: i.title,
      detail: i.detail,
      verb: i.verb,
      icon: i.icon,
      portrait: n.id,
      npc: n,
      variant: kind,
      radius: this.tuning.interactRadius + 4,
      target: () => ({ x: n.x, y: n.y }),
    });
  }

  private spawnInjury() {
    const n = pick(this.rng, this.kidsAtPost());
    n.busy = true;
    n.activity = 'injured';
    n.say('OWWWW!', 2);
    this.baseTask('injury', {
      title: 'Man down!',
      detail: `${n.name} has gone down holding everything`,
      icon: 'sponge',
      portrait: n.id,
      verb: 'Magic sponge',
      npc: n,
      radius: 26,
      target: () => ({ x: n.x, y: n.y }),
    });
    this.banner = { text: 'Injury! Get the magic sponge!', t: 2.5 };
  }

  // ---- broken kit

  rippedNets(): number[] {
    return this.tasks.filter((t) => t.type === 'net').map((t) => t.num!);
  }

  private spawnNet() {
    const free = [1, 2].filter((k) => !this.rippedNets().includes(k));
    if (!free.length) return;
    const num = pick(this.rng, free);
    const spot = this.map.point(num === 1 ? 'netLeft' : 'netRight');
    this.baseTask('net', {
      title: `${num === 1 ? 'Left' : 'Right'} goal net ripped`,
      detail: 'Every goal is going straight through',
      icon: 'net',
      verb: 'Fix the net',
      num,
      target: () => spot,
    });
  }

  private spawnBalls() {
    const spot = this.map.point('pumpSpot');
    this.baseTask('balls', {
      title: 'All the balls are flat',
      detail: 'The kit room. Again.',
      icon: 'pump',
      verb: 'Pump up the balls',
      target: () => spot,
    });
  }

  // ---- visitors: Alistair, Lycra Lee and Gaz

  private spawnAlistair() {
    const al = this.npc('alistair');
    this.walkIn(al, this.map.point('hatch'), () => { al.dir = 'up'; al.activity = 'tea'; }, 'outsideRight');
    al.say(this.line('alSneak'), 2.5);
    this.baseTask('alistair', {
      title: "Alistair's back!",
      detail: "He's banned! Stop him nicking the biscuits",
      icon: 'thief',
      portrait: 'alistair',
      verb: 'Throw Alistair out',
      npc: al,
      target: () => ({ x: al.x, y: al.y }),
    });
    this.banner = { text: 'Alistair is heading for the tea hut...', t: 2.5 };
  }

  private spawnLee() {
    const lee = this.npc('lee');
    const loop = ['lee1', 'lee2', 'lee3', 'lee4'].map((k) => this.map.point(k));
    let i = 0;
    const lap = () => {
      if (!lee.busy || lee.hidden) return;
      lee.activity = 'cycling';
      i = (i + 1) % loop.length;
      lee.path = [loop[i]];
      lee.onArrive = lap;
      if (this.rng() < 0.4) lee.say(pick(this.rng, ['On your left!', 'Strava segment!', '*ding ding*', 'Personal best!']), 1.6);
    };
    this.walkIn(lee, loop[0], lap, 'parkGate');
    lee.speed = this.tuning.leeSpeed;
    lee.say('Just did 40 miles!', 2.5);
    this.baseTask('lee', {
      title: 'Cyclist on the pitch!',
      detail: 'Lycra Lee is doing laps of the touchline',
      icon: 'bike',
      portrait: 'lee',
      verb: 'Stop Lee',
      npc: lee,
      radius: this.tuning.interactRadius + 6,
      target: () => ({ x: lee.x, y: lee.y }),
    });
  }

  private spawnAssistant() {
    const gaz = this.npc('gaz');
    gaz.busy = true;
    gaz.activity = 'phone';
    this.baseTask('assistant', {
      title: 'Gaz is on his phone',
      detail: 'Nobody is watching the kids',
      icon: 'mobile',
      portrait: 'gaz',
      verb: 'Tell Gaz to WATCH',
      npc: gaz,
      radius: 26,
      target: () => ({ x: gaz.x, y: gaz.y }),
    });
    this.banner = { text: 'Assistant coach Gaz has gone AWOL...', t: 2.5 };
  }

  // ---- the phone in the office (or Andy's mobile, or the parents' WhatsApp)

  private spawnPhone() {
    const d = this.defs.phone;
    const mobile = this.rng() < (d.mobileChance ?? 0.5);
    const whatsapp = mobile && this.rng() < (d.whatsappChance ?? 0.3) / (d.mobileChance ?? 0.5);
    const cold = !whatsapp && this.rng() < (d.coldCallChance ?? 0.3);
    let caller: Caller;
    if (whatsapp) caller = { name: 'Parents WhatsApp group', cold: false, whatsapp: true };
    else if (cold) caller = { name: this.line('coldCallers'), portrait: 'coldcaller', cold: true };
    else {
      const name = this.line('callers');
      caller = { name, portrait: name === 'The Club Chairman' ? 'chairman' : name.startsWith('Brenda') ? 'brenda' : undefined, cold: false };
    }
    const seat = this.map.seat('andy');
    this.ringT = 0;
    this.baseTask('phone', {
      title: whatsapp ? 'Parents WhatsApp' : mobile ? 'Mobile ringing' : 'Office phone ringing',
      detail: whatsapp ? `${20 + Math.floor(this.rng() * 60)} new messages` : cold ? 'Unknown number...' : `${caller.name} is calling`,
      icon: whatsapp ? 'whatsapp' : mobile ? 'mobile' : 'phone',
      portrait: caller.portrait,
      verb: whatsapp ? 'Read the group' : mobile ? 'Answer mobile' : 'Answer the phone',
      variant: mobile ? 'mobile' : 'desk',
      caller,
      radius: mobile ? 1e6 : 16,
      target: () => (mobile ? { x: this.andy.x, y: this.andy.y } : seat),
    });
  }

  private modalChoice(input: Input): boolean | null {
    let c: boolean | null = null;
    if (input.took('allow') || input.took('left')) c = true;
    if (input.took('deny') || input.took('right')) c = false;
    const b = modalButtons();
    for (const k of input.clicks) {
      if (inRect(k, b.allow)) c = true;
      if (inRect(k, b.deny)) c = false;
    }
    return c;
  }

  private updateCallModal(input: Input) {
    const c = this.modalChoice(input);
    if (c !== null) this.answerCall(c);
  }

  /**
   * The left choice: fob someone off / mute the WhatsApp group (calming, but too many and the
   * Chairman wants a word) or hang up on a cold caller (calming, nobody minds). The right choice:
   * sort it out / say sorry / reply nicely (safe, a bit annoying) or hear a cold caller out (annoying).
   */
  answerCall(brushOff: boolean) {
    const m = this.modal as Extract<Modal, { kind: 'call' }>;
    this.modal = null;
    const d = m.complaint ? this.defs.neighbour : this.defs.phone;
    const who = m.task.npc;
    if (m.caller.cold) {
      this.completeTask(m.task, brushOff ? this.line('hangUps') : this.line('hearOuts'));
      addAnger(this.meters, brushOff ? -(d.hangUpCalm ?? 6) : d.hearOutAnger ?? 6);
      return;
    }
    if (brushOff) {
      const chairmanComing = this.has('chairman');
      this.completeTask(m.task, m.caller.whatsapp ? 'Muted. For a year.' : this.line('brushOffs'));
      addAnger(this.meters, chairmanComing ? d.ticketAnger ?? 3 : -(d.brushOffCalm ?? 8));
      who?.say(pick(this.rng, ['Charming!', 'Well!', "I'm writing to the council!"]), 2);
      this.brushOffsToday++;
      if (this.brushOffsToday >= (this.defs.chairman.brushOffsBeforeManager ?? 3) && !chairmanComing) {
        this.brushOffsToday = 0;
        this.spawnChairman();
        this.banner = { text: 'Too many complaints! The Chairman wants a word.', t: 3 };
      }
    } else {
      this.completeTask(m.task, m.complaint ? 'Sorry. It won\'t happen again. (It will.)' : m.caller.whatsapp ? '"Thanks all! :)" *dies inside*' : this.line('ticketLines'));
      addAnger(this.meters, d.ticketAnger ?? 3);
      who?.say('That\'s more like it.', 2);
    }
  }

  // ---- the Club Chairman

  private spawnChairman() {
    const spot = this.map.point('meetingSpot');
    this.baseTask('chairman', {
      title: 'The Chairman wants a word',
      detail: 'Meeting in the office. Now.',
      icon: 'boss',
      portrait: 'chairman',
      verb: 'Sit through the meeting',
      radius: 18,
      target: () => spot,
    });
    this.banner = { text: 'The Club Chairman wants a meeting...', t: 2.5 };
  }

  /** Andy has finished holding the action on a task. */
  private finishHold(t: Task) {
    switch (t.type) {
      case 'signin':
        this.modal = { kind: 'member', task: t, check: t.check! };
        this.sfx('click');
        return;
      case 'phone': {
        const caller = t.caller!;
        const text = caller.whatsapp ? this.line('whatsapp') : caller.cold ? this.line('coldCalls') : this.line('requests');
        this.modal = { kind: 'call', task: t, caller, text, complaint: false };
        this.sfx('click');
        return;
      }
      case 'neighbour':
        this.modal = { kind: 'call', task: t, caller: { name: t.npc!.name, portrait: t.npc!.id, cold: false }, text: t.variant!, complaint: true };
        t.npc!.activity = null;
        this.sfx('click');
        return;
      case 'chairman':
        this.andy.hidden = true;
        this.sfx('boss');
        this.modal = { kind: 'manager', t: this.tuning.chairmanMeetingSeconds, total: this.tuning.chairmanMeetingSeconds, line: this.line('chairman'), task: t };
        this.tasks = this.tasks.filter((k) => k !== t);
        return;
      case 'drill':
        this.endDrill(t);
        this.sfx('whistle');
        this.completeTask(t, pick(this.rng, ['Better. Ish.', 'Again! And this time with feeling.', 'Pelé never had to put up with this.']));
        return;
      case 'dog':
        this.sfx('whistle');
        this.completeTask(t, pick(this.rng, ['GO ON! OUT!', 'Shoo! SHOO!', 'Not on my pitch, pal.']));
        return;
      case 'lee':
        this.completeTask(t, pick(this.rng, ["It's a football pitch, not a velodrome!", 'Off. Now. And take your Strava with you.']));
        return;
      case 'alistair':
        this.completeTask(t, this.line('alCaught'));
        return;
      case 'assistant':
        this.completeTask(t, 'Phone. Away. NOW, Gaz.');
        return;
      case 'injury':
        this.sfx('splash');
        this.completeTask(t, pick(this.rng, ['Magic sponge! Up you get.', 'Run it off!', 'Is it hanging off? No? Then play on.']));
        return;
      case 'net':
        this.completeTask(t, pick(this.rng, ['Cable ties. The answer to everything.', 'Fixed. Stop scoring.', 'Thirty five years I\'ve been doing this.']));
        return;
      case 'balls':
        this.sfx('pump');
        this.completeTask(t, pick(this.rng, ['Pumped. Unlike me.', 'Who keeps letting them down?!', 'Sixteen balls. SIXTEEN.']));
        return;
      case 'poo':
        this.completeTask(t, pick(this.rng, ['Why is it always me?', 'Model Rovers...', 'Bag it and bin it. Lovely.']));
        return;
      case 'changing':
        this.completeTask(t, pick(this.rng, ['Who does this?!', 'It smells like feet and Lynx Africa.', 'Thirty five years I\'ve been doing this.']));
        return;
      case 'ball': {
        const n = this.npc(t.variant!);
        n.say(pick(this.rng, ["And STAY out!", "I'm calling the council!", 'Mind my roses!']), 2.2);
        this.completeTask(t, pick(this.rng, ['Sorry! Lovely roses...', 'Got it. Back over the fence.', 'Ball. Mine. Thank you.']));
        return;
      }
      case 'trouble':
      case 'parent':
        this.sfx(t.variant === 'scrap' || t.variant === 'goal' ? 'whistle' : 'rant');
        this.completeTask(t);
        return;
      default:
        this.completeTask(t);
    }
  }

  private completeTask(t: Task, line?: string, release = true) {
    this.tasks = this.tasks.filter((k) => k !== t);
    const d = this.defs[t.type];
    addAnger(this.meters, -d.calm);
    const pts = Math.round(d.score * (0.5 + 0.5 * Math.max(0, t.timeLeft) / t.timeLimit));
    this.score += pts;
    this.stats.score += pts;
    this.stats.done++;
    if (!['trouble', 'parent', 'balls', 'injury', 'dog', 'drill'].includes(t.type)) this.sfx('done');
    this.toast(`+${pts}`, this.andy, '#ff6');
    if (release) this.releaseNpc(t, true);
    if (line) this.andy.say(line, 2.4, 'andy');
    else if (t.type === 'trouble' || t.type === 'parent' || this.rng() < 0.45) this.sayCatchphrase();
  }

  private failTask(t: Task) {
    this.tasks = this.tasks.filter((k) => k !== t);
    const d = this.defs[t.type];
    addAnger(this.meters, d.angerOnFail);
    this.stats.failed++;
    this.sfx('fail');
    const owner = t.variant && GARDENS[t.variant] ? this.npc(t.variant).name : 'The neighbour';
    const msgs: Record<EventType, string> = {
      signin: 'Queue at the table!', drill: `The ${t.squad ? squadName(t.squad) : 'kids'} have wandered off`, dog: 'Dog ran off with the ball!',
      poo: 'Someone slid in it!', changing: t.variant === 'blocked' ? 'Loo out of order!' : 'Health and safety!', neighbour: 'Letter to the council!',
      ball: `${owner} kept the ball!`, parent: 'Parents are fighting!', trouble: 'Chaos!', injury: 'Off to A&E...', net: 'Goal disallowed!',
      balls: 'Training with flat balls...', alistair: 'Alistair ate ALL the biscuits!', lee: 'Lee ran over a cone!',
      assistant: 'Kids climbed the floodlights!', phone: 'Missed call', chairman: 'The Chairman is NOT happy',
    };
    this.toast(`${msgs[t.type]} +${d.angerOnFail} anger`, this.andy, '#f88');
    if (!this.andy.hidden) this.andy.say(this.line('grumbles'), 2, 'andy');
    if (t.type === 'changing' && t.variant === 'blocked') this.toiletOutOfOrder = this.tuning.toiletOutOfOrderSeconds;
    if (t.type === 'drill') this.endDrill(t);
    if (t.type === 'dog' && t.npc && this.rng() < (this.defs.dog.pooChance ?? 0.5) && this.count('poo') < 3) {
      const at = { x: t.npc.x, y: t.npc.y };
      this.spawnPoo(this.map.roomAt(at)?.id === 'pitch' && !this.map.blockedPx(at.x, at.y) ? at : undefined);
    }
    this.releaseNpc(t, false);
  }

  private releaseNpc(t: Task, scolded: boolean) {
    const h = t.helper;
    if (h) { h.say(scolded ? 'Come on Biscuit. Hmph.' : 'Good boy!', 2); this.leave(h, false, 'park'); }
    const n = t.npc;
    if (!n) return;
    if (t.type === 'alistair') n.say(scolded ? this.line('alExcuses') : this.line('alEscaped'), 2.4);
    else if (t.type === 'dog') n.say(scolded ? '*whimper*' : '*runs off with the ball*', 2);
    else if (t.type === 'assistant') n.say(scolded ? 'Sorry Andy. Watching now.' : 'What did I miss?', 2.2);
    else if (t.type === 'injury') n.say(scolded ? "I'm OK now!" : 'Mum! MUUUM!', 2.2);
    else if (t.type === 'signin') n.say(scolded ? 'Ta.' : 'Forget it!', 2);
    else if (t.type === 'neighbour') n.say(scolded ? 'Hmph.' : "I'm writing to the council!", 2.2);
    else if (t.type === 'parent') n.say(scolded ? 'Alright, alright. Keep your hair on.' : 'My kid should be CAPTAIN!', 2);
    else if (t.type === 'lee') n.say(scolded ? 'Bit rude. Off to the cafe.' : 'New PB! Cheers!', 2);
    else if (scolded) n.say(this.line('excuses'), 2);
    if (t.type === 'lee') n.speed = this.tuning.npcSpeed;
    if (n.post) {
      if (t.type === 'assistant' || t.type === 'injury') { n.busy = false; n.sitDown(); }
      else n.goHome(this.map);
    } else this.leave(n, scolded && (t.type === 'alistair' || t.type === 'dog' || t.type === 'lee'), t.type === 'dog' || t.type === 'lee' ? 'park' : 'carpark');
  }

  private meltdown() {
    this.meters.anger = 100;
    this.screen = 'gameover';
    this.sfx('meltdown');
    this.saveBest();
  }

  private endDay() {
    this.score += this.tuning.dayEndBonus;
    this.stats.score += this.tuning.dayEndBonus;
    this.screen = 'dayEnd';
    this.sfx('dayEnd');
    this.saveBest();
  }

  private saveBest() {
    if (this.score > this.best) {
      this.best = this.score;
      try { localStorage.setItem('andyFC.best', String(this.best)); } catch { /* ignore */ }
    }
  }

  // ------------------------------------------------------------ helpers for the renderer

  liveTargets(): { task: Task; pos: Vec }[] {
    const out: { task: Task; pos: Vec }[] = [];
    for (const t of this.tasks) {
      const p = t.target();
      if (p) out.push({ task: t, pos: p });
    }
    return out;
  }

  /** True while a kid is down at the ice cream van (the renderer draws the van). */
  iceCreamVan(): boolean {
    return this.tasks.some((t) => t.type === 'trouble' && t.variant === 'icecream');
  }

  flatBalls(): boolean {
    return this.has('balls');
  }
}

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const inRect = (p: Vec, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;

/** Card-check and phone-call button rectangles in logical screen coords (shared by renderer and input). */
export function modalButtons() {
  return {
    allow: { x: 200, y: 318, w: 150, h: 34 },
    deny: { x: 370, y: 318, w: 150, h: 34 },
  };
}
