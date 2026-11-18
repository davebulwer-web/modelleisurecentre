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
  | null | 'play' | 'bored' | 'watch' | 'phone' | 'garden' | 'complain' | 'shouting' | 'zoomies' | 'owner'
  | 'tea' | 'cycling' | 'goal' | 'window' | 'scrap' | 'icecream' | 'injured' | 'shirts' | 'wander' | 'banter';

const LINES: Record<Exclude<Activity, null>, string[]> = {
  play: ['Pass it!', 'Mine!', 'Man on!', 'Goooal!', 'To me!'],
  bored: ['Coach! What do we do?', 'This is BORING.', 'Can we have a match?', '*sits on ball*', "I'm hungry."],
  watch: ['*yawn*', 'Good effort lads.', '*checks watch*'],
  phone: ['*scrolling*', 'Ha! Look at this video...', '*taps phone*'],
  garden: ['*snip snip*', '*tuts*', '*twitches curtain*'],
  complain: ['Excuse me! EXCUSE ME!', 'Disgraceful!', "I'll write to the council!"],
  shouting: ['GET STUCK IN!', 'REF!', 'SHOOOT!', 'Man on!!'],
  zoomies: ['WOOF!', 'Woof woof!', '*zoomies*'],
  owner: ["He's FRIENDLY!", "He's only playing!", 'Come HERE!'],
  tea: ['*slurp*', 'Lovely custard creams...', "Don't mind me..."],
  cycling: ['On your left!', 'Strava segment!', '*ding ding*'],
  goal: ["I'm the king of the castle!", 'Wheee!', 'Look Coach!'],
  window: ['Top bins!', 'Watch this!', '*THWACK*'],
  scrap: ['He started it!', 'Did NOT!', 'Give it BACK!'],
  icecream: ['Sprinkles please!', 'Ninety-nine!', 'Mum gave me a pound!'],
  injured: ['OWWW!', 'My leg!', "I can't feel my toe!", '*sobs*'],
  shirts: ['Ooh, a size 6...', 'Is this one signed?', '*sniffs shirt*', 'Forty quid. Cash.'],
  wander: ['*on the phone*', 'Just cutting through!', '*la la la*'],
  banter: ['Leeds are going down!', 'Dirty Leeds!', 'Leeds? Pub team!', '1992 called!'],
};

/** Someone at the rec ground. Staff, kids and neighbours stand at their post; everyone else is walked about by the game. */
const SHOUTY: Activity[] = ['complain', 'shouting', 'owner', 'goal', 'window', 'scrap', 'bored', 'injured', 'banter'];

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
    this.pose = this.activity && SHOUTY.includes(this.activity) ? 'shout' : 'stand';
    if (this.activity) {
      this.funT -= dt;
      if (this.funT <= 0) {
        const ambient = this.activity === 'play' || this.activity === 'watch' || this.activity === 'garden';
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
