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
import { makeMemberCheck, isCorrectDecision, type MemberCheck } from './membership';
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
}

export type TroubleKind = 'bombing' | 'running' | 'bowling' | 'cafe' | 'gym';
export type SpillKind = 'puddle' | 'sick' | 'litter';

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
  variant?: string;
  /** Who is on the other end of a phone call. */
  caller?: Caller;
  /** The membership card being checked at reception. */
  check?: MemberCheck;
  /** Where a spill is. */
  spot?: Vec;
  /** Bowling lane (1-3) or treadmill (1-4) number. */
  num?: number;
}

/** Someone on the phone. */
export interface Caller { name: string; portrait?: string; cold: boolean }

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

const SPILL_ROOMS: Record<SpillKind, string[]> = {
  puddle: ['pool', 'changing', 'corridor'],
  sick: ['bowling', 'cafe', 'corridor', 'reception'],
  litter: ['cafe', 'reception', 'bowling', 'corridor', 'gym'],
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
  intruderInside: Npc | null = null;
  slowed = false;
  lastPhrase = '';
  /** Fob-offs (phone and complaints) since the Area Manager last visited. */
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
      catchphrases: P.catchphrases, grumbles: P.grumbles, excuses: P.excuses, manager: P.manager, complaints: P.complaints, vending: P.vending,
      alSneak: P.alistair.sneaking, alCaught: P.alistair.caught, alExcuses: P.alistair.excuses, alEscaped: P.alistair.escaped,
      requests: C.requests, callers: C.callers, brushOffs: C.brushOffs, ticketLines: C.ticketLines,
      coldCallers: C.coldCallers, coldCalls: C.coldCalls, hangUps: C.hangUpLines, hearOuts: C.hearOutLines,
    };
    for (const [k, v] of Object.entries(lists)) this.lines[k] = new PhraseRotator(v, this.rng);
    this.trouble = {} as Record<TroubleKind, PhraseRotator>;
    for (const [k, v] of Object.entries(P.trouble)) this.trouble[k as TroubleKind] = new PhraseRotator(v, this.rng);
    try { this.best = Number(localStorage.getItem('andyLC.best') || 0); } catch { /* storage blocked */ }
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
    this.andy.say(this.day === 1 ? 'Right. Doors open...' : 'Back again. Marvellous.', 3, 'andy');
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
      const speed = (c.group === 'teen' ? this.tuning.teenSpeed : this.tuning.npcSpeed) * range(this.rng, 0.9, 1.1);
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
    this.intruderInside = null;
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

    // the world waits while Andy reads a card or is on the phone
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
    const live = this.tasks.length;
    const type = this.spawner.update(dt, this.dayFrac, live, (k) => this.canSpawn(k));
    if (type) this.spawn(type);

    if (this.modal?.kind === 'manager') {
      this.modal.t -= dt;
      if (this.modal.t <= 0) {
        const task = this.modal.task;
        this.modal = null;
        const p = this.map.seat('manager');
        this.andy.hidden = false;
        this.andy.x = p.x;
        this.andy.y = p.y + 4;
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
    if (dist(a, loo) <= r && this.meters.bladder >= this.tuning.needMinimumToUse && this.toiletOutOfOrder <= 0 && !this.intruderInside)
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
    const loud = it.task && ['trouble', 'toilet', 'shower', 'alistair', 'lifeguard', 'vending'].includes(it.task.type);
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
      if (n && !n.hidden && dist(n, a) < 30) { n.stopped = 0.25; n.face(a.x - n.x, a.y - n.y); }
      if (t.type === 'trouble' && t.variant === 'running' && n) n.stopped = 0.25;
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
        this.sfx('ring');
      }
      if (t.timeLeft <= 0) this.failTask(t);
    }
  }

  /** People not already caught up in a task. */
  private free(filter: (n: Npc) => boolean): Npc[] {
    return this.npcs.filter((n) => !n.busy && filter(n) && !this.tasks.some((t) => t.npc === n));
  }
  /** Off-site people (teens, members, visitors) who could walk in. */
  private outside(group: string | string[], except: string[] = []): Npc[] {
    const gs = Array.isArray(group) ? group : [group];
    return this.free((n) => n.hidden && gs.includes(n.group) && !except.includes(n.id));
  }
  private has(k: EventType) {
    return this.tasks.some((t) => t.type === k);
  }
  /** The reception counter only serves one customer at a time. */
  private counterBusy() {
    return this.tasks.some((t) => t.type === 'membership' || t.type === 'complaint') || this.npcs.some((n) => !n.hidden && dist(n, this.map.point('counterCustomer')) < 6);
  }

  canSpawn(type: EventType): boolean {
    if (this.dayFrac > 0.97) return false;
    switch (type) {
      case 'membership': return !this.counterBusy() && this.outside('member', ['alfie']).length > 0;
      case 'complaint': return !this.counterBusy() && this.outside('member', ['alfie']).length > 0;
      case 'trouble': return this.tasks.filter((t) => t.type === 'trouble').length < 2 && this.troubleKinds().length > 0;
      case 'spill': return this.tasks.filter((t) => t.type === 'spill').length < 2;
      case 'alistair': return !this.has('alistair') && this.outside('visitor').some((n) => n.id === 'alistair');
      case 'pins': return this.tasks.filter((t) => t.type === 'pins').length < 2;
      case 'treadmill': return !this.has('treadmill');
      case 'lifeguard': return !this.has('lifeguard') && this.free((n) => n.id === 'gaz' && n.seated).length > 0;
      case 'vending': return !this.has('vending') && this.outside('member').some((n) => n.id === 'alfie');
      case 'phone': return !this.has('phone') && !this.modal;
      case 'shower': return !this.has('shower') && this.outside('visitor').some((n) => n.id === 'lee');
      case 'toilet': return !this.has('toilet') && this.toiletOutOfOrder <= 0 && this.toiletCulprits().length > 0;
      case 'manager': return !this.has('manager') && !this.modal;
    }
  }

  spawn(type: EventType) {
    switch (type) {
      case 'membership': this.spawnMembership(); break;
      case 'complaint': this.spawnComplaint(); break;
      case 'trouble': this.spawnTrouble(); break;
      case 'spill': this.spawnSpill(); break;
      case 'alistair': this.spawnAlistair(); break;
      case 'pins': this.spawnPins(); break;
      case 'treadmill': this.spawnTreadmill(); break;
      case 'lifeguard': this.spawnLifeguard(); break;
      case 'vending': this.spawnVending(); break;
      case 'phone': this.spawnPhone(); break;
      case 'shower': this.spawnShower(); break;
      case 'toilet': this.spawnToilet(); break;
      case 'manager': this.spawnManager(); break;
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

  /** Walk someone in through the front doors (or from the left along the pavement). */
  private walkIn(n: Npc, to: Vec, onArrive: () => void, from = 'frontOutside') {
    const p = from === 'frontOutside' ? { x: 23.5 * this.map.ts, y: 22.8 * this.map.ts } : this.map.point(from);
    n.hidden = false;
    n.busy = true;
    n.activity = null;
    n.x = p.x;
    n.y = p.y;
    n.goTo(this.map, to, onArrive);
  }

  /** Send someone home: out of the front doors and off the map. */
  private leave(n: Npc, fast = false) {
    n.busy = true;
    n.activity = null;
    if (fast) n.speed *= 1.6;
    const sp = n.speed;
    n.goTo(this.map, this.map.point(this.rng() < 0.5 ? 'outsideLeft' : 'outsideRight'), () => {
      n.hidden = true;
      n.busy = false;
      n.speed = fast ? sp / 1.6 : sp;
    });
  }

  // ---- reception: membership cards and complaints

  private spawnMembership() {
    const n = pick(this.rng, this.outside('member', ['alfie']));
    const others = this.characters.filter((c) => c.group === 'member' && c.id !== n.id && c.id !== 'alfie').map((c) => c.id);
    const check = makeMemberCheck(this.rng, this.today(), this.defs.membership.legitChance ?? 0.55, n, others);
    this.walkIn(n, this.map.point('counterCustomer'), () => { n.dir = 'up'; n.say(`Here for ${check.activity === 'swim' ? 'a swim' : check.activity === 'gym' ? 'the gym' : 'bowling'}!`, 2.5); });
    this.baseTask('membership', {
      title: 'Customer at reception',
      detail: `${n.name} wants to come in`,
      icon: 'card',
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
      const door = check.activity === 'swim' ? 'changingIn' : check.activity === 'gym' ? 'gymIn' : 'bowlingIn';
      n.say(pick(this.rng, ['Ta!', 'Cheers!', 'Lovely.']), 1.6);
      n.goTo(this.map, this.map.point(door), () => { n.hidden = true; n.busy = false; });
    } else {
      n.say(pick(this.rng, ['Unbelievable!', "I'll be back!", 'I want the manager! Oh...']), 2);
      this.leave(n);
    }
    if (isCorrectDecision(check, choice)) {
      this.completeTask(task, choice ? 'In you go.' : 'Not today, sunshine!', false);
    } else {
      this.stats.failed++;
      addAnger(this.meters, this.defs.membership.angerOnWrong ?? 10);
      this.sfx('wrong');
      const why = check.legit ? 'Their card was fine!' : check.problem ?? 'Dodgy card!';
      this.toast(`Wrong call! ${why}`, this.andy, '#f88');
      this.andy.say(this.line('grumbles'), 2, 'andy');
    }
  }

  private spawnComplaint() {
    const pool = this.outside('member', ['alfie']);
    const mrsP = pool.find((n) => n.id === 'pemberton');
    const n = mrsP && this.rng() < 0.6 ? mrsP : pick(this.rng, pool);
    const text = this.line('complaints');
    this.walkIn(n, this.map.point('counterCustomer'), () => { n.dir = 'up'; n.activity = 'complain'; });
    this.baseTask('complaint', {
      title: 'Complaint at reception',
      detail: `${n.name} wants a word`,
      icon: 'complaint',
      portrait: n.id,
      verb: 'Hear the complaint',
      npc: n,
      variant: text,
      radius: 26,
      target: () => (n.path ? null : { x: n.x, y: n.y }),
    });
  }

  // ---- the phone in Andy's office (or his mobile)

  private spawnPhone() {
    const d = this.defs.phone;
    const cold = this.rng() < (d.coldCallChance ?? 0.3);
    let caller: Caller;
    if (cold) caller = { name: this.line('coldCallers'), portrait: 'coldcaller', cold: true };
    else {
      const name = this.line('callers');
      caller = { name, portrait: name === 'Head Office' ? 'manager' : name.startsWith('Sharon') ? 'sharon' : undefined, cold: false };
    }
    const mobile = this.rng() < (d.mobileChance ?? 0.5);
    const seat = this.map.seat('andy');
    this.ringT = 0;
    this.baseTask('phone', {
      title: mobile ? 'Mobile ringing' : 'Office phone ringing',
      detail: cold ? 'Unknown number...' : `${caller.name} is calling`,
      icon: mobile ? 'mobile' : 'phone',
      portrait: caller.portrait,
      verb: mobile ? 'Answer mobile' : 'Answer the phone',
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
   * The left choice: fob someone off (calming, but too many and the Area Manager turns up)
   * or hang up on a cold caller (calming, nobody minds). The right choice: sort it out / give a
   * free swim voucher (safe, a bit annoying) or hear a cold caller out (annoying).
   */
  answerCall(brushOff: boolean) {
    const m = this.modal as Extract<Modal, { kind: 'call' }>;
    this.modal = null;
    const d = m.complaint ? this.defs.complaint : this.defs.phone;
    const who = m.task.npc;
    if (m.caller.cold) {
      this.completeTask(m.task, brushOff ? this.line('hangUps') : this.line('hearOuts'));
      addAnger(this.meters, brushOff ? -(d.hangUpCalm ?? 6) : d.hearOutAnger ?? 6);
      return;
    }
    if (brushOff) {
      const managerComing = this.has('manager');
      this.completeTask(m.task, this.line('brushOffs'));
      addAnger(this.meters, managerComing ? d.ticketAnger ?? 3 : -(d.brushOffCalm ?? 8));
      who?.say(pick(this.rng, ['Charming!', 'Well!', "I'm writing to the council!"]), 2);
      this.brushOffsToday++;
      if (this.brushOffsToday >= (this.defs.manager.brushOffsBeforeManager ?? 3) && !managerComing) {
        this.brushOffsToday = 0;
        this.spawnManager();
        this.banner = { text: 'Too many complaints! The Area Manager is coming.', t: 3 };
      }
    } else {
      this.completeTask(m.task, m.complaint ? 'Have a free swim. On us.' : this.line('ticketLines'));
      addAnger(this.meters, d.ticketAnger ?? 3);
      who?.say('That\'s more like it.', 2);
    }
  }

  // ---- troublemakers

  private troubleKinds(): { kind: TroubleKind; n: Npc }[] {
    const out: { kind: TroubleKind; n: Npc }[] = [];
    const teens = this.outside('teen', ['steve']);
    const busy = (k: TroubleKind) => this.tasks.some((t) => t.type === 'trouble' && t.variant === k);
    if (teens.length) {
      if (!busy('bombing')) out.push({ kind: 'bombing', n: pick(this.rng, teens) });
      if (!busy('running')) out.push({ kind: 'running', n: pick(this.rng, teens) });
      if (!busy('cafe')) out.push({ kind: 'cafe', n: pick(this.rng, teens) });
    }
    const steve = this.outside('teen').find((n) => n.id === 'steve');
    if (steve && !busy('bowling')) out.push({ kind: 'bowling', n: steve });
    const gary = this.free((n) => n.id === 'gary' && n.seated && !n.hidden)[0];
    if (gary && !busy('gym')) out.push({ kind: 'gym', n: gary });
    return out;
  }

  private spawnTrouble() {
    const { kind, n } = pick(this.rng, this.troubleKinds());
    const shout = () => n.say(this.trouble[kind].next(), 2);
    const settle = (dir: Dir, act: Activity) => () => { n.dir = dir; n.activity = act; shout(); };
    const info: Record<TroubleKind, { title: string; detail: string; verb: string; icon: string }> = {
      bombing: { title: 'Dive-bombing!', detail: `${n.name} is soaking the aqua aerobics`, verb: 'Blow the whistle', icon: 'whistle' },
      running: { title: 'Running by the pool!', detail: `${n.name} won't stop running`, verb: 'Catch him', icon: 'whistle' },
      bowling: { title: 'Stag do kicking off', detail: 'Bowling balls down the wrong lane', verb: 'Calm them down', icon: 'rant' },
      cafe: { title: 'Chip fight in the cafe', detail: `${n.name} is lobbing chips`, verb: 'Have a word', icon: 'rant' },
      gym: { title: "Gary's dropping weights", detail: 'CLANG. CLANG. CLANG.', verb: 'Tell him to re-rack', icon: 'rant' },
    };
    if (kind === 'gym') {
      n.busy = true;
      n.goTo(this.map, this.map.point('weightsSpot'), settle('right', 'gym'));
    } else if (kind === 'bombing') {
      const edge = pick(this.rng, ['poolEdge1', 'poolEdge2', 'poolEdge3', 'poolEdge4']);
      this.walkIn(n, this.map.point(edge), settle(edge === 'poolEdge1' || edge === 'poolEdge2' ? 'down' : 'up', 'bombing'));
    } else if (kind === 'running') {
      const loop = ['poolRun1', 'poolRun2', 'poolRun3', 'poolRun4'].map((k) => this.map.point(k));
      let i = 0;
      const lap = () => {
        if (!n.busy || n.hidden) return;
        n.activity = 'running';
        i = (i + 1) % loop.length;
        n.path = [loop[i]];
        n.onArrive = lap;
        if (this.rng() < 0.4) shout();
      };
      this.walkIn(n, loop[0], lap);
    } else if (kind === 'bowling') {
      this.walkIn(n, this.map.point('bowlingTrouble'), settle('right', 'bowling'));
    } else {
      this.walkIn(n, this.map.point('cafeTrouble'), settle('left', 'cafe'));
    }
    const i = info[kind];
    this.baseTask('trouble', {
      ...i,
      portrait: n.id,
      npc: n,
      variant: kind,
      radius: this.tuning.interactRadius + 4,
      target: () => ({ x: n.x, y: n.y }),
    });
  }

  // ---- cleaning

  private spawnSpill() {
    const kind = pick(this.rng, ['puddle', 'puddle', 'sick', 'litter', 'litter'] as SpillKind[]);
    const spot = this.findSpillSpot(SPILL_ROOMS[kind]);
    if (!spot) return;
    const room = this.map.roomAt(spot)?.name ?? 'centre';
    const info: Record<SpillKind, { title: string; detail: string; verb: string; hold: number }> = {
      puddle: { title: 'Wet floor', detail: `Puddle in the ${room}. Someone will slip!`, verb: 'Mop it up', hold: 1 },
      sick: { title: "Someone's been sick", detail: `In the ${room}. Lovely.`, verb: 'Clean it up', hold: 1.4 },
      litter: { title: 'Litter everywhere', detail: `Crisp packets all over the ${room}`, verb: 'Pick it up', hold: 0.6 },
    };
    const i = info[kind];
    this.baseTask('spill', {
      title: i.title,
      detail: i.detail,
      verb: i.verb,
      icon: 'mop',
      variant: kind,
      spot,
      hold: this.defs.spill.hold * i.hold,
      target: () => spot,
    });
  }

  private findSpillSpot(rooms: string[]): Vec | null {
    const m = this.map, ts = m.ts;
    const reach = m.reachable(m.seat('andy'));
    const tiles: Vec[] = [];
    for (let ty = 0; ty < m.h; ty++)
      for (let tx = 0; tx < m.w; tx++) {
        const p = { x: (tx + 0.5) * ts, y: (ty + 0.5) * ts };
        const r = m.roomAt(p);
        if (!r || !rooms.includes(r.id) || !reach.has(ty * m.w + tx) || m.blocked(tx, ty)) continue;
        if (m.blocked(tx, ty - 1) && m.blocked(tx, ty + 1)) continue; // not in a doorway
        if (this.tasks.some((t) => t.spot && dist(t.spot, p) < 48)) continue;
        if (this.npcs.some((n) => n.post && dist(n.post, p) < 20)) continue;
        tiles.push(p);
      }
    return tiles.length ? pick(this.rng, tiles) : null;
  }

  // ---- Alistair, banned, after a free coffee

  private spawnAlistair() {
    const al = this.npc('alistair');
    this.walkIn(al, this.map.point('coffeeSpot'), () => { al.dir = 'up'; al.activity = 'coffee'; }, 'outsideLeft');
    al.say(this.line('alSneak'), 2.5);
    this.baseTask('alistair', {
      title: "Alistair's back!",
      detail: "He's banned! Stop him nicking a coffee",
      icon: 'thief',
      portrait: 'alistair',
      verb: 'Throw Alistair out',
      npc: al,
      target: () => ({ x: al.x, y: al.y }),
    });
    this.banner = { text: 'Alistair is heading for the coffee machine...', t: 2.5 };
  }

  // ---- broken kit

  jammedLanes(): number[] {
    return this.tasks.filter((t) => t.type === 'pins').map((t) => t.num!);
  }

  private spawnPins() {
    const free = [1, 2, 3].filter((k) => !this.jammedLanes().includes(k));
    if (!free.length) return;
    const lane = pick(this.rng, free);
    const bowler = this.npcs.find((n) => n.id === (lane === 3 ? 'brian' : 'barry') && !n.hidden);
    bowler?.say('The pins are stuck!', 2.5);
    const spot = this.map.point(`lane${lane}`);
    this.baseTask('pins', {
      title: `Lane ${lane} pins jammed`,
      detail: 'The pinsetter has packed up again',
      icon: 'pins',
      verb: 'Reset the pinsetter',
      num: lane,
      target: () => spot,
    });
  }

  brokenTreadmill(): number | null {
    return this.tasks.find((t) => t.type === 'treadmill')?.num ?? null;
  }

  private spawnTreadmill() {
    const num = pick(this.rng, [1, 3]);
    const p = this.map.point(`treadmill${num}`);
    const spot = { x: p.x, y: p.y + 10 };
    this.baseTask('treadmill', {
      title: 'Treadmill broken',
      detail: `Treadmill ${num} says ERROR 404`,
      icon: 'fix',
      verb: 'Fix the treadmill',
      num,
      target: () => spot,
    });
  }

  private spawnLifeguard() {
    const gaz = this.npc('gaz');
    gaz.busy = true;
    gaz.activity = 'sleep';
    this.baseTask('lifeguard', {
      title: 'Lifeguard asleep!',
      detail: 'Gaz has nodded off on the chair',
      icon: 'whistle',
      portrait: 'gaz',
      verb: 'Wake Gaz up',
      npc: gaz,
      radius: 26,
      target: () => ({ x: gaz.x, y: gaz.y }),
    });
    this.banner = { text: 'Nobody is watching the pool!', t: 2.5 };
  }

  private spawnVending() {
    const alfie = this.npc('alfie');
    this.walkIn(alfie, this.map.point('vendingSpot'), () => { alfie.dir = 'left'; alfie.activity = 'vending'; });
    this.baseTask('vending', {
      title: 'Vending machine ate a pound',
      detail: 'Little Alfie wants his crisps',
      icon: 'coin',
      portrait: 'alfie',
      verb: 'Thump the machine',
      npc: alfie,
      target: () => (alfie.path ? null : { x: alfie.x - 6, y: alfie.y }),
    });
  }

  // ---- Lycra Lee and the loo

  private spawnShower() {
    const lee = this.npc('lee');
    this.walkIn(lee, this.map.point('showerSpot'), () => { lee.activity = 'shower'; lee.dir = 'down'; }, 'outsideLeft');
    lee.say('Just did 40 miles!', 2.5);
    this.baseTask('shower', {
      title: 'Shower hog',
      detail: "Lycra Lee isn't even a member",
      icon: 'shower',
      portrait: 'lee',
      verb: 'Evict Lee',
      npc: lee,
      target: () => ({ x: lee.x, y: lee.y }),
    });
  }

  private toiletCulprits(): Npc[] {
    return this.free((n) => n.group === 'regular' && n.seated && !n.hidden);
  }

  private spawnToilet() {
    const pool = this.toiletCulprits();
    const gary = pool.find((n) => n.id === 'gary');
    const n = gary && this.rng() < (this.defs.toilet.garyChance ?? 0.7) ? gary : pick(this.rng, pool);
    n.busy = true;
    n.activity = null;
    n.goTo(this.map, this.map.point('toilet'), () => {
      this.intruderInside = n;
      n.activity = 'toilet';
      n.dir = 'down';
    });
    n.say(n.id === 'gary' ? 'Protein shake kicking in...' : 'Nature calls...', 2);
    this.baseTask('toilet', {
      title: 'Loo alert!',
      detail: `${n.name} is off to make a mess`,
      icon: 'toilet',
      portrait: n.id,
      verb: `Stop ${first(n.name)}`,
      npc: n,
      target: () => ({ x: n.x, y: n.y }),
    });
  }

  // ---- the Area Manager

  private spawnManager() {
    const seat = this.map.seat('manager');
    this.baseTask('manager', {
      title: 'Area Manager visit',
      detail: 'Meeting in the office. Now.',
      icon: 'boss',
      portrait: 'manager',
      verb: 'Sit through the meeting',
      radius: 18,
      target: () => seat,
    });
    this.banner = { text: 'The Area Manager wants a meeting...', t: 2.5 };
  }

  /** Andy has finished holding the action on a task. */
  private finishHold(t: Task) {
    switch (t.type) {
      case 'membership':
        this.modal = { kind: 'member', task: t, check: t.check! };
        this.sfx('click');
        return;
      case 'phone': {
        const caller = t.caller!;
        this.modal = { kind: 'call', task: t, caller, text: caller.cold ? this.line('coldCalls') : this.line('requests'), complaint: false };
        this.sfx('click');
        return;
      }
      case 'complaint':
        this.modal = { kind: 'call', task: t, caller: { name: t.npc!.name, portrait: t.npc!.id, cold: false }, text: t.variant!, complaint: true };
        t.npc!.activity = null;
        this.sfx('click');
        return;
      case 'manager':
        this.andy.hidden = true;
        this.sfx('boss');
        this.modal = { kind: 'manager', t: this.tuning.managerMeetingSeconds, total: this.tuning.managerMeetingSeconds, line: this.line('manager'), task: t };
        this.tasks = this.tasks.filter((k) => k !== t);
        return;
      case 'alistair':
        this.completeTask(t, this.line('alCaught'));
        return;
      case 'pins':
        this.completeTask(t, pick(this.rng, ['Ten pins. Again.', 'Who designed this thing?!', 'Pinsetters. Worse than my ex-wife.']));
        return;
      case 'treadmill':
        this.completeTask(t, pick(this.rng, ['Turned it off and on again.', 'Fixed. Stop running on it.', 'ERROR 404: my patience.']));
        return;
      case 'lifeguard':
        this.completeTask(t, 'WAKE UP, GAZ!');
        return;
      case 'vending':
        this.sfx('thump');
        this.completeTask(t, pick(this.rng, ['*THUMP* There. Crisps.', 'Very therapeutic, that.', 'Take that, machine!']));
        return;
      case 'spill':
        this.completeTask(t, pick(this.rng, ['Who does this?!', 'Model Leisure Centre...', 'Thirty five years I\'ve been doing this.']));
        return;
      case 'trouble':
        this.sfx(t.variant === 'bombing' || t.variant === 'running' ? 'whistle' : 'rant');
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
    if (t.type !== 'trouble' && t.type !== 'vending') this.sfx('done');
    this.toast(`+${pts}`, this.andy, '#ff6');
    if (release) this.releaseNpc(t, true);
    if (line) this.andy.say(line, 2.4, 'andy');
    else if (t.type === 'trouble' || this.rng() < 0.45) this.sayCatchphrase();
  }

  private failTask(t: Task) {
    this.tasks = this.tasks.filter((k) => k !== t);
    const d = this.defs[t.type];
    addAnger(this.meters, d.angerOnFail);
    this.stats.failed++;
    this.sfx('fail');
    const msgs: Record<EventType, string> = {
      membership: 'Queue out the door!', complaint: 'Mrs P is writing to the council', trouble: 'Complaints all round',
      spill: t.variant === 'puddle' ? 'Someone slipped!' : 'Health and safety!', alistair: 'Alistair nicked a latte!',
      pins: 'Bowlers want a refund', treadmill: 'Gym-goers are fuming', lifeguard: 'Near miss in the pool!',
      vending: 'Alfie is crying', phone: 'Missed call', shower: 'Lee used all the hot water',
      toilet: 'Toilets out of order!', manager: 'Area Manager is NOT happy',
    };
    this.toast(`${msgs[t.type]} +${d.angerOnFail} anger`, this.andy, '#f88');
    if (!this.andy.hidden) this.andy.say(this.line('grumbles'), 2, 'andy');
    if (t.type === 'toilet') this.toiletOutOfOrder = this.tuning.toiletOutOfOrderSeconds;
    this.releaseNpc(t, false);
  }

  private releaseNpc(t: Task, scolded: boolean) {
    const n = t.npc;
    if (!n) return;
    if (this.intruderInside === n) this.intruderInside = null;
    if (t.type === 'alistair') n.say(scolded ? this.line('alExcuses') : this.line('alEscaped'), 2.4);
    else if (t.type === 'vending') n.say(scolded ? 'Cheers mister!' : 'I\'m telling my mum!', 2.2);
    else if (t.type === 'lifeguard') n.say(scolded ? 'I was resting my eyes!' : '*yawn* What did I miss?', 2.2);
    else if (t.type === 'membership') n.say(scolded ? 'Ta.' : 'Forget it!', 2);
    else if (t.type === 'complaint') n.say(scolded ? 'Hmph.' : 'I\'m writing to the council!', 2.2);
    else if (scolded) n.say(this.line('excuses'), 2);
    if (n.group === 'staff' || n.group === 'regular') {
      if (t.type === 'lifeguard') { n.busy = false; n.sitDown(); }
      else n.goHome(this.map);
    } else this.leave(n, scolded && (t.type === 'alistair' || t.type === 'trouble'));
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
      try { localStorage.setItem('andyLC.best', String(this.best)); } catch { /* ignore */ }
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
}

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
const first = (name: string) => name.split(' ').slice(-1)[0];
export const inRect = (p: Vec, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;

/** Card-check and phone-call button rectangles in logical screen coords (shared by renderer and input). */
export function modalButtons() {
  return {
    allow: { x: 200, y: 318, w: 150, h: 34 },
    deny: { x: 370, y: 318, w: 150, h: 34 },
  };
}
