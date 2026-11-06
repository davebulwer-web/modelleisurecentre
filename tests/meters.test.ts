import { describe, it, expect } from 'vitest';
import { tickNeeds, addAnger, moodIndex, type Meters } from '../src/game/meters';

const T = { bladderPerSec: 1, thirstPerSec: 0.5, needsAngerPerSec: 2, passiveAngerPerSec: 0 };

describe('meters', () => {
  it('needs rise over time and clamp at 100', () => {
    const m: Meters = { anger: 0, bladder: 0, thirst: 0 };
    tickNeeds(m, 10, T);
    expect(m.bladder).toBe(10);
    expect(m.thirst).toBe(5);
    tickNeeds(m, 500, T);
    expect(m.bladder).toBe(100);
  });

  it('full needs make anger rise, empty ones do not', () => {
    const m: Meters = { anger: 10, bladder: 0, thirst: 0 };
    tickNeeds(m, 1, T);
    expect(m.anger).toBe(10);
    m.bladder = 100;
    m.thirst = 100;
    const r = tickNeeds(m, 1, T);
    expect(r).toEqual({ bladderFull: true, thirstFull: true });
    expect(m.anger).toBe(14);
  });

  it('anger stays within 0..100', () => {
    const m: Meters = { anger: 95, bladder: 0, thirst: 0 };
    addAnger(m, 20);
    expect(m.anger).toBe(100);
    addAnger(m, -500);
    expect(m.anger).toBe(0);
  });

  it('maps anger to six moods', () => {
    expect(moodIndex(0)).toBe(0);
    expect(moodIndex(50)).toBe(3);
    expect(moodIndex(100)).toBe(5);
  });
});
