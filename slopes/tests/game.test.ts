import { describe, it, expect } from 'vitest';
import { Game, DAYS, SCRAPES, PHYS } from '../src/game/game';
import { bot, idle, playDay, quiet } from './helpers';

function started(seed = 3) {
  const g = new Game(quiet, seed);
  g.newGame();
  g.begin();
  return g;
}

describe('skiing', () => {
  it('goes faster straight down than across the hill', () => {
    const g = started();
    for (let i = 0; i < 120; i++) g.update(1 / 60, idle());
    const straight = g.andy.v;
    const g2 = started();
    g2.andy.h = 1.4;
    for (let i = 0; i < 120; i++) g2.update(1 / 60, idle());
    expect(straight).toBeGreaterThan(100);
    expect(g2.andy.v).toBeLessThan(straight / 2);
  });

  it('tucking is faster and the snowplough slows you down', () => {
    const speeds = [0, 1, -1].map((ay) => {
      const g = started();
      g.obstacles = [];
      for (let i = 0; i < 400; i++) { g.obstacles = []; g.npcs = []; g.update(1 / 60, idle({ ay })); }
      return g.andy.v;
    });
    expect(speeds[1]).toBeGreaterThan(speeds[0]);
    expect(speeds[2]).toBeLessThan(speeds[0] / 3);
  });

  it('crashing into a tree knocks Andy over and winds him up', () => {
    const g = started();
    g.andy.v = 150;
    g.obstacles.push({ id: 999, kind: 'tree', sprite: 'tree', x: g.andy.x, y: g.andy.y + 6, r: 7, low: false });
    g.update(1 / 60, idle());
    expect(g.andy.state).toBe('crash');
    expect(g.meters.anger).toBeGreaterThan(0);
    for (let i = 0; i < 60 * (PHYS.crashTime + 0.2); i++) g.update(1 / 60, idle());
    expect(g.andy.state).toBe('ski');
  });

  it('jumping clears a rock', () => {
    const g = started();
    g.andy.v = 160;
    g.andy.vz = 150; g.andy.z = 10;
    g.obstacles.push({ id: 999, kind: 'rock', sprite: 'rock', x: g.andy.x, y: g.andy.y + 3, r: 7, low: true });
    g.update(1 / 60, idle());
    expect(g.andy.state).toBe('ski');
  });

  it('a ramp launches Andy into the air', () => {
    const g = started();
    g.andy.v = 160;
    g.obstacles.push({ id: 999, kind: 'ramp', sprite: 'ramp', x: g.andy.x, y: g.andy.y + 2, r: 0, low: true });
    g.update(1 / 60, idle());
    expect(g.andy.z).toBeGreaterThan(0);
  });
});

describe('scrapes', () => {
  it('every scrape can be sorted out', () => {
    for (const def of SCRAPES) {
      const g = started(11);
      for (let i = 0; i < 60; i++) g.update(1 / 60, idle());
      const s = g.spawnScrape(def.id);
      let sorted = false;
      for (let i = 0; i < 60 * 8 && !sorted; i++) {
        g.meters.anger = 10;
        if (s.target) { g.andy.x = s.target.x; g.andy.y = s.target.y - (def.kind === 'lift' ? 30 : 2); g.andy.state = 'ski'; g.andy.invuln = 1; }
        if (def.kind === 'phone') g.andy.v = 0;
        g.update(1 / 60, idle({ action: true, ay: def.kind === 'phone' ? -1 : 0 }));
        sorted = s.state === 'done';
      }
      expect(sorted, def.id).toBe(true);
    }
  });

  it('ignoring a scrape costs anger, and Leeds costs the most', () => {
    const g = started(5);
    g.spawnScrape('plug_fallen');
    const s = g.scrapes[0];
    g.andy.y = s.target!.y + 100;
    g.update(1 / 60, idle());
    expect(s.state).toBe('missed');
    const plain = g.meters.anger;
    const g2 = started(5);
    const l = g2.spawnScrape('leeds');
    g2.andy.y = l.target!.y + 100;
    g2.update(1 / 60, idle());
    expect(g2.meters.anger).toBeGreaterThan(plain);
  });

  it('timed chases run out', () => {
    const g = started(8);
    const s = g.spawnScrape('jimmy_snowball');
    for (let i = 0; i < 60 * 20 && s.state === 'live'; i++) g.update(1 / 60, idle());
    expect(s.state).toBe('missed');
  });
});

describe('a whole week', () => {
  it('a bot can get through every day without anything breaking', () => {
    for (const seed of [1, 2, 3]) {
      const g = new Game(quiet, seed);
      g.newGame();
      let days = 0;
      while (g.screen === 'dayIntro') {
        g.begin();
        const t = playDay(g);
        expect(Number.isFinite(g.andy.x) && Number.isFinite(g.andy.y)).toBe(true);
        const screen: string = g.screen;
        expect(['dayEnd', 'gameover'], `seed ${seed} day ${g.day} stuck after ${t}s at y=${g.andy.y}`).toContain(screen);
        if (screen === 'gameover') break;
        days++;
        g.meters.anger = Math.min(g.meters.anger, 60); // the bot is not as good as you
        g.nextDay();
      }
      expect(days).toBeGreaterThan(0);
      if (days === DAYS.length) expect(g.screen).toBe('holidayOver');
    }
  });

  it('the bot meets plenty of scrapes and sorts some of them', () => {
    const g = new Game(quiet, 42);
    g.newGame();
    g.begin();
    let done = 0, seen = 0;
    playDay(g);
    done += g.stats.done;
    seen += g.stats.done + g.stats.missed;
    expect(seen).toBeGreaterThan(2);
    expect(done).toBeGreaterThan(0);
  });

  it('runs are the same for the same seed', () => {
    const a = started(77), b = started(77);
    for (let i = 0; i < 600; i++) { a.update(1 / 60, bot(a)); b.update(1 / 60, bot(b)); }
    expect(a.andy.y).toBeCloseTo(b.andy.y);
    expect(a.obstacles.length).toBe(b.obstacles.length);
  });
});
