export interface Meters {
  anger: number;
  bladder: number;
  thirst: number;
}

export interface NeedsTuning {
  bladderPerSec: number;
  thirstPerSec: number;
  needsAngerPerSec: number;
  passiveAngerPerSec: number;
}

export const clamp100 = (v: number) => Math.max(0, Math.min(100, v));

/** Advance bladder and thirst; a full meter makes Andy's anger climb. Returns which needs are maxed. */
export function tickNeeds(m: Meters, dt: number, t: NeedsTuning): { bladderFull: boolean; thirstFull: boolean } {
  m.bladder = clamp100(m.bladder + t.bladderPerSec * dt);
  m.thirst = clamp100(m.thirst + t.thirstPerSec * dt);
  const bladderFull = m.bladder >= 100;
  const thirstFull = m.thirst >= 100;
  const full = (bladderFull ? 1 : 0) + (thirstFull ? 1 : 0);
  m.anger = clamp100(m.anger + (t.passiveAngerPerSec + full * t.needsAngerPerSec) * dt);
  return { bladderFull, thirstFull };
}

export function addAnger(m: Meters, amount: number): void {
  m.anger = clamp100(m.anger + amount);
}

/** 0 neutral, 1 annoyed, 2 irritated, 3 angry, 4 furious, 5 shouting */
export function moodIndex(anger: number): number {
  return Math.min(5, Math.floor(anger / (100 / 6)));
}

export const MOODS = ['neutral', 'annoyed', 'irritated', 'angry', 'furious', 'shouting'] as const;
