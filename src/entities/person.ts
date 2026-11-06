import type { TileMap, Vec } from '../world/map';
import type { Rng } from '../core/rng';
import { pick, range } from '../core/rng';

export type Dir = 'down' | 'up' | 'left' | 'right';
export type Pose = 'stand' | 'walk' | 'work' | 'shout';

export interface Bubble { text: string; t: number; tone: 'andy' | 'npc' | 'fun' }

export class Person {
  dir: Dir = 'down';
  pose: Pose = 'stand';
  animT = 0;
  hidden = false;
  bubble: Bubble | null = null;

  constructor(public id: string, public name: string, public x: number, public y: number) {}

  say(text: string, secs = 2.6, tone: Bubble['tone'] = 'npc') {
    this.bubble = { text, t: secs, tone };
  }

  face(dx: number, dy: number) {
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
    this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  }

  tickBubble(dt: number) {
    this.animT += dt;
    if (this.bubble && (this.bubble.t -= dt) <= 0) this.bubble = null;
  }
}

export type Activity =
  | null | 'run' | 'sleep' | 'bombing' | 'running' | 'bowling' | 'cafe' | 'gym'
  | 'coffee' | 'shower' | 'toilet' | 'complain' | 'vending' | 'bowl' | 'chat';

const LINES: Record<Exclude<Activity, null>, string[]> = {
  run: ['*pant pant*', 'Feel the burn!', '*pant*'],
  sleep: ['Zzz...', 'Zzzzz...', '*snore*'],
  bombing: ['BOMBS AWAY!', 'CANNONBALL!', 'Watch THIS!'],
  running: ["Can't catch me!", 'Wheeee!', 'Race you!'],
  bowling: ['STRIKE! Wrong lane!', 'Oi oi!', 'Another round!'],
  cafe: ['Chip fight!', '*splat*', 'Ketchup missile!'],
  gym: ['UGHHHH!', '*CLANG*', 'LIGHT WEIGHT BABY!'],
  coffee: ['*glug glug*', 'Lovely latte...', "Don't mind me..."],
  shower: ['La la la!', '*splash*', 'Ahhh...'],
  toilet: ['*grunt*', '...', 'Too much protein...'],
  complain: ['I want the MANAGER!', 'Disgraceful!', "I'll write to the council!"],
  vending: ['It ate my pound!', 'Mister!', '*sniff*'],
  bowl: ['*rumble*', 'Spare!', 'Gutter ball...'],
  chat: ['Ooh, did you hear...', 'No!', 'Another teacake?'],
};

/** Someone in the leisure centre. Staff and regulars stand at their post; everyone else is walked about by the game. */
export class Npc extends Person {
  path: Vec[] | null = null;
  onArrive: (() => void) | null = null;
  /** True while an event is controlling this person. */
  busy = false;
  /** At their post (staff and regulars). */
  seated = false;
  activity: Activity = null;
  /** Seconds this person is held on the spot because Andy is dealing with them. */
  stopped = 0;
  private funT = 0;

  constructor(
    id: string,
    name: string,
    x: number,
    y: number,
    public readonly post: Vec | null,
    public readonly facing: Dir,
    public readonly group: string,
    public readonly homeActivity: Activity,
    public speed: number,
  ) {
    super(id, name, x, y);
  }

  goTo(map: TileMap, to: Vec, onArrive?: () => void): boolean {
    const p = map.findPath({ x: this.x, y: this.y }, to);
    if (!p) return false;
    this.path = p;
    this.seated = false;
    this.onArrive = onArrive ?? null;
    return true;
  }

  goHome(map: TileMap) {
    this.busy = false;
    this.activity = null;
    if (!this.post) return;
    this.goTo(map, this.post, () => this.sitDown());
  }

  /** Arrive at their post and get back to it. */
  sitDown() {
    this.seated = true;
    this.dir = this.facing;
    this.activity = this.homeActivity;
  }

  update(dt: number, map: TileMap, rng: Rng) {
    this.tickBubble(dt);
    if (this.hidden) return;
    if (this.stopped > 0) {
      this.stopped -= dt;
      this.pose = 'stand';
      return;
    }
    if (this.path) {
      this.walk(dt);
      return;
    }
    this.pose = this.activity === 'run' ? 'walk' : this.activity && ['bombing', 'bowling', 'cafe', 'gym', 'complain', 'vending'].includes(this.activity) ? 'shout' : 'stand';
    if (this.activity) {
      this.funT -= dt;
      if (this.funT <= 0) {
        const ambient = this.activity === 'run' || this.activity === 'chat' || this.activity === 'bowl';
        this.funT = ambient ? range(rng, 8, 16) : range(rng, 1.6, 3.2);
        this.say(pick(rng, LINES[this.activity]), 1.5, 'fun');
      }
    }
    if (this.busy || !this.post) return;
    if (!this.seated) this.goHome(map);
  }

  private walk(dt: number) {
    const target = this.path![0];
    const dx = target.x - this.x, dy = target.y - this.y;
    const d = Math.hypot(dx, dy);
    const stepLen = this.speed * dt;
    this.pose = 'walk';
    this.face(dx, dy);
    if (d <= stepLen) {
      this.x = target.x;
      this.y = target.y;
      this.path!.shift();
      if (!this.path!.length) {
        this.path = null;
        this.pose = 'stand';
        const cb = this.onArrive;
        this.onArrive = null;
        cb?.();
      }
    } else {
      this.x += (dx / d) * stepLen;
      this.y += (dy / d) * stepLen;
    }
  }
}

export class Andy extends Person {
  constructor(x: number, y: number) {
    super('andy', 'Andy', x, y);
  }

  /** Move with wall collision; feet box is 10x5 px. */
  move(dx: number, dy: number, map: TileMap) {
    const hw = 5, hh = 5;
    const nx = this.x + dx;
    if (!map.boxBlocked(nx - hw, this.y - hh, nx + hw, this.y)) this.x = nx;
    const ny = this.y + dy;
    if (!map.boxBlocked(this.x - hw, ny - hh, this.x + hw, ny)) this.y = ny;
  }
}
