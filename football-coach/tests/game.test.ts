import { describe, it, expect } from 'vitest';
import { Game } from '../src/game/game';
import type { Input } from '../src/core/input';
import { EVENT_TYPES } from '../src/game/spawner';

type FakeInput = Omit<Input, 'action'> & { action: boolean; pressed: Set<string> };
function fakeInput(): FakeInput {
  const pressed = new Set<string>();
  return {
    ax: 0, ay: 0, action: false, clicks: [], touchMode: false, pressed,
    took: (k: string) => pressed.delete(k), update() {}, endFrame() {},
  } as unknown as FakeInput;
}
const play = (g: Game, input: FakeInput, secs: number) => { for (let i = 0; i < secs * 30; i++) g.update(1 / 30, input as unknown as Input); };

/** A game with needs and anger set so they don't interfere. */
function fresh(seed = 31) {
  const g = new Game(null, seed);
  g.newGame();
  g.meters.anger = 50;
  g.meters.bladder = g.meters.thirst = 0;
  return g;
}
const calm = (g: Game) => { g.meters.anger = 50; g.meters.bladder = g.meters.thirst = 0; };

describe('game simulation', () => {
  it('an idle Andy gets angrier as tasks expire, and lots of task types show up', () => {
    const seen = new Set<string>();
    for (const seed of [123, 7, 99]) {
      const g = new Game(null, seed);
      g.newGame();
      const input = fakeInput();
      let steps = 0;
      while (g.screen === 'playing' && steps < 20000) {
        g.update(1 / 30, input as unknown as Input);
        for (const t of g.tasks) seen.add(t.type);
        steps++;
      }
      expect(g.stats.failed).toBeGreaterThan(3);
      expect(['gameover', 'dayEnd']).toContain(g.screen);
    }
    expect(seen.size).toBeGreaterThanOrEqual(9);
  });

  it('every task type can be spawned on a fresh day', () => {
    for (const k of EVENT_TYPES) {
      const g = fresh(5);
      expect(g.canSpawn(k), k).toBe(true);
      g.spawn(k);
      expect(g.tasks.some((t) => t.type === k), k).toBe(true);
    }
  });

  it('tea and the loo relieve thirst and bladder', () => {
    const g = new Game(null, 5);
    g.newGame();
    const input = fakeInput();
    g.meters.thirst = 80;
    g.meters.bladder = 80;
    const kettle = g.map.point('kettle');
    g.andy.x = kettle.x;
    g.andy.y = kettle.y;
    input.action = true;
    play(g, input, 4);
    expect(g.meters.thirst).toBeLessThan(5);
    const loo = g.map.point('toilet');
    g.andy.x = loo.x;
    g.andy.y = loo.y;
    play(g, input, 3.3);
    expect(g.meters.bladder).toBeLessThan(5);
  });

  it('every hands-on task can be finished by standing on it and holding the action', () => {
    const kinds = ['drill', 'dog', 'poo', 'changing', 'ball', 'parent', 'trouble', 'injury', 'net', 'balls', 'alistair', 'lee', 'assistant', 'matt', 'walker', 'burst', 'leeds'] as const;
    for (const k of kinds) {
      for (const seed of [40, 41, 42]) {
        const g = fresh(seed);
        const input = fakeInput();
        g.spawn(k);
        const t = g.tasks.find((x) => x.type === k)!;
        expect(t, k).toBeTruthy();
        for (let i = 0; i < 40 && !t.target(); i++) play(g, input, 0.5);
        calm(g);
        // stay on top of whatever it is (dogs and cyclists keep moving until Andy gets hold of them)
        input.action = true;
        for (let i = 0; i < 150 && g.tasks.includes(t); i++) {
          const p = t.target()!;
          g.andy.x = p.x;
          g.andy.y = p.y + 4;
          play(g, input, 1 / 30);
        }
        expect(g.tasks.includes(t), k).toBe(false);
        expect(g.stats.done, k).toBe(1);
        expect(g.stats.failed, k).toBe(0);
      }
    }
  });

  it('sorting out a kid calms Andy and sends them back to their training group', () => {
    const g = fresh(9);
    const input = fakeInput();
    g.spawn('trouble');
    const t = g.tasks.find((k) => k.type === 'trouble')!;
    play(g, input, 1);
    calm(g);
    const n = t.npc!;
    g.andy.x = n.x;
    g.andy.y = n.y + 4;
    input.action = true;
    play(g, input, 2);
    expect(g.meters.anger).toBeLessThan(45);
    input.action = false;
    g.andy.x = g.map.seat('andy').x;
    g.andy.y = g.map.seat('andy').y;
    for (let i = 0; i < 40; i++) { play(g, input, 1); calm(g); g.tasks = []; }
    expect(n.seated).toBe(true);
  });

  it('a bored training group plays again once Andy runs the drill', () => {
    const g = fresh(3);
    const input = fakeInput();
    g.spawn('drill');
    const t = g.tasks.find((k) => k.type === 'drill')!;
    const kids = g.npcs.filter((n) => g.squadOf(n) === t.squad);
    expect(kids.every((k) => k.activity === 'bored')).toBe(true);
    const p = t.target()!;
    g.andy.x = p.x;
    g.andy.y = p.y + 4;
    input.action = true;
    play(g, input, 2.5);
    expect(g.tasks.includes(t)).toBe(false);
    expect(kids.every((k) => k.activity === 'play')).toBe(true);
  });

  it('Alistair heads for the tea hut hatch', () => {
    const g = fresh(12);
    const input = fakeInput();
    g.spawn('alistair');
    const al = g.npc('alistair');
    expect(al.hidden).toBe(false);
    for (let i = 0; i < 80 && al.path; i++) { play(g, input, 0.5); calm(g); }
    const spot = g.map.point('hatch');
    expect(Math.hypot(al.x - spot.x, al.y - spot.y)).toBeLessThan(2);
    expect(al.activity).toBe('tea');
  });

  it('a missed blocked loo puts the toilet out of order', () => {
    const g = fresh(14);
    const input = fakeInput();
    for (let i = 0; i < 30 && !g.tasks.some((t) => t.variant === 'blocked'); i++) { g.tasks = []; g.spawn('changing'); }
    const t = g.tasks.find((k) => k.variant === 'blocked')!;
    expect(t).toBeTruthy();
    t.timeLeft = 0.01;
    play(g, input, 0.2);
    expect(g.toiletOutOfOrder).toBeGreaterThan(0);
  });

  it('a dog that gets away can leave a present on the pitch', () => {
    let pooed = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const g = fresh(seed);
      const input = fakeInput();
      g.defs.dog.pooChance = 1;
      g.spawn('dog');
      play(g, input, 3);
      calm(g);
      const t = g.tasks.find((k) => k.type === 'dog')!;
      t.timeLeft = 0.01;
      play(g, input, 0.1);
      g.defs.dog.pooChance = 0.6;
      if (g.tasks.some((k) => k.type === 'poo')) pooed++;
    }
    expect(pooed).toBe(8);
  });

  it('sign-in: the right call scores, the wrong call costs anger', () => {
    for (const legit of [true, false]) {
      for (const letIn of [true, false]) {
        const g = fresh(20);
        g.defs.signin.legitChance = legit ? 1 : 0;
        const input = fakeInput();
        g.spawn('signin');
        g.defs.signin.legitChance = 0.55;
        const t = g.tasks.find((k) => k.type === 'signin')!;
        for (let i = 0; i < 60 && !t.target(); i++) { play(g, input, 0.5); calm(g); }
        const p = t.target()!;
        g.andy.x = p.x - 14;
        g.andy.y = p.y + 4;
        input.action = true;
        play(g, input, 1);
        expect(g.modal?.kind).toBe('member');
        input.action = false;
        input.pressed.add(letIn ? 'allow' : 'deny');
        const before = g.meters.anger;
        play(g, input, 0.1);
        expect(g.modal).toBeNull();
        if (legit === letIn) { expect(g.stats.done).toBe(1); expect(g.meters.anger).toBeLessThan(before); }
        else { expect(g.stats.failed).toBe(1); expect(g.meters.anger).toBeGreaterThan(before); }
      }
    }
  });

  it('a neighbour at the gate can be fobbed off', () => {
    const g = fresh(22);
    const input = fakeInput();
    g.spawn('neighbour');
    const t = g.tasks.find((k) => k.type === 'neighbour')!;
    for (let i = 0; i < 60 && !t.target(); i++) { play(g, input, 0.5); calm(g); }
    const p = t.target()!;
    g.andy.x = p.x;
    g.andy.y = p.y + 28;
    input.action = true;
    play(g, input, 1);
    expect(g.modal?.kind).toBe('call');
    input.action = false;
    input.pressed.add('allow');
    const before = g.meters.anger;
    play(g, input, 0.1);
    expect(g.modal).toBeNull();
    expect(g.meters.anger).toBeLessThan(before);
    expect(g.brushOffsToday).toBe(1);
  });

  it('three fob-offs bring the Chairman, and the meeting hides Andy for a while', () => {
    const g = fresh(30);
    const input = fakeInput();
    g.defs.phone.coldCallChance = 0;
    for (let i = 0; i < 3; i++) {
      g.tasks = g.tasks.filter((k) => k.type !== 'phone');
      g.spawn('phone');
      const t = g.tasks.find((k) => k.type === 'phone')!;
      const p = t.target()!;
      g.andy.x = p.x;
      g.andy.y = p.y;
      input.action = true;
      play(g, input, 0.6);
      expect(g.modal?.kind).toBe('call');
      input.action = false;
      input.pressed.add('allow');
      play(g, input, 0.1);
    }
    g.defs.phone.coldCallChance = 0.25;
    const m = g.tasks.find((k) => k.type === 'chairman')!;
    expect(m).toBeTruthy();
    calm(g);
    const spot = g.map.point('meetingSpot');
    g.andy.x = spot.x;
    g.andy.y = spot.y;
    input.action = true;
    play(g, input, 0.6);
    expect(g.modal?.kind).toBe('manager');
    expect(g.andy.hidden).toBe(true);
    input.action = false;
    play(g, input, 7);
    expect(g.modal).toBeNull();
    expect(g.andy.hidden).toBe(false);
  });

  it('runs the days Monday to Sunday', () => {
    const g = fresh(1);
    expect(g.dateLabel()).toBe('Monday');
    g.day = 7;
    expect(g.dateLabel()).toBe('Sunday');
    g.day = 8;
    expect(g.dateLabel()).toBe('Monday');
  });
});
