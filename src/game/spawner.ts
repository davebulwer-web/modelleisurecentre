import { type Rng, range } from '../core/rng';

export type EventType = 'membership' | 'trouble' | 'spill' | 'alistair' | 'pins' | 'treadmill' | 'lifeguard' | 'vending' | 'complaint' | 'phone' | 'shower' | 'toilet' | 'manager';
export const EVENT_TYPES: EventType[] = ['membership', 'trouble', 'spill', 'alistair', 'pins', 'treadmill', 'lifeguard', 'vending', 'complaint', 'phone', 'shower', 'toilet', 'manager'];

export interface EventDef {
  weight: number;
  timeLimit: number;
  hold: number;
  angerOnFail: number;
  angerOnWrong?: number;
  calm: number;
  score: number;
  legitChance?: number;
  mobileChance?: number;
  brushOffCalm?: number;
  ticketAnger?: number;
  coldCallChance?: number;
  hangUpCalm?: number;
  hearOutAnger?: number;
  garyChance?: number;
  brushOffsBeforeManager?: number;
}
export type EventDefs = Record<EventType, EventDef>;

export interface SpawnTuning {
  dayLengthSeconds: number;
  spawn: { firstDelay: number; intervalStart: number; intervalEnd: number; maxActiveStart: number; maxActiveEnd: number };
  dayScaling: { interval: number; timeLimit: number; extraMaxActivePerDay: number };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

/**
 * Decides when to start a new random event and which one. Gentle at opening time, busier by the
 * afternoon, and busier again each new day.
 */
export class Spawner {
  private timer: number;

  constructor(private readonly rng: Rng, private readonly t: SpawnTuning, private readonly defs: EventDefs, readonly day: number) {
    this.timer = t.spawn.firstDelay;
  }

  interval(dayFrac: number): number {
    return lerp(this.t.spawn.intervalStart, this.t.spawn.intervalEnd, dayFrac) * Math.pow(this.t.dayScaling.interval, this.day - 1);
  }

  maxActive(dayFrac: number): number {
    const base = lerp(this.t.spawn.maxActiveStart, this.t.spawn.maxActiveEnd, dayFrac);
    return Math.floor(base + this.t.dayScaling.extraMaxActivePerDay * (this.day - 1));
  }

  /** Time limit for an event type on this day (later days are stricter). */
  timeLimit(type: EventType): number {
    return this.defs[type].timeLimit * Math.pow(this.t.dayScaling.timeLimit, this.day - 1);
  }

  /** Call every frame. Returns an event type to start, or null. */
  update(dt: number, dayFrac: number, activeCount: number, canSpawn: (t: EventType) => boolean): EventType | null {
    this.timer -= dt;
    if (this.timer > 0) return null;
    if (activeCount >= this.maxActive(dayFrac)) {
      this.timer = 1; // check again shortly
      return null;
    }
    const type = this.pick(canSpawn);
    this.timer = type ? this.interval(dayFrac) * range(this.rng, 0.75, 1.25) : 1;
    return type;
  }

  pick(canSpawn: (t: EventType) => boolean): EventType | null {
    const options = EVENT_TYPES.filter((k) => this.defs[k].weight > 0 && canSpawn(k));
    const total = options.reduce((s, k) => s + this.defs[k].weight, 0);
    if (!total) return null;
    let r = this.rng() * total;
    for (const k of options) {
      r -= this.defs[k].weight;
      if (r <= 0) return k;
    }
    return options[options.length - 1];
  }
}
