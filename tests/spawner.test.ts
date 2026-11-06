import { describe, it, expect } from 'vitest';
import { Spawner, type EventDefs } from '../src/game/spawner';
import { makeRng } from '../src/core/rng';
import tuning from '../src/data/tuning.json';
import events from '../src/data/events.json';

const defs = events as unknown as EventDefs;

describe('spawner', () => {
  it('ramps up through the day and across days', () => {
    const d1 = new Spawner(makeRng(1), tuning, defs, 1);
    const d3 = new Spawner(makeRng(1), tuning, defs, 3);
    expect(d1.interval(0)).toBeGreaterThan(d1.interval(1));
    expect(d1.maxActive(0)).toBeLessThan(d1.maxActive(1));
    expect(d3.interval(0.5)).toBeLessThan(d1.interval(0.5));
    expect(d3.timeLimit('membership')).toBeLessThan(d1.timeLimit('membership'));
    expect(d1.maxActive(0)).toBe(tuning.spawn.maxActiveStart);
    expect(d1.maxActive(1)).toBe(tuning.spawn.maxActiveEnd);
  });

  it('never spawns past the active cap and only allowed types', () => {
    const s = new Spawner(makeRng(7), tuning, defs, 1);
    let active = 0;
    const counts: Record<string, number> = {};
    for (let i = 0; i < 6000; i++) {
      const frac = i / 6000;
      const t = s.update(0.05, frac, active, (k) => k !== 'manager');
      if (t) {
        expect(active).toBeLessThan(s.maxActive(frac));
        expect(t).not.toBe('manager');
        counts[t] = (counts[t] ?? 0) + 1;
        active++;
      }
      if (active && i % 200 === 0) active--;
    }
    expect(Object.keys(counts).length).toBeGreaterThan(3);
  });
});
