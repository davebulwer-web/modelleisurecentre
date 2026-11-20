/** Andy's anger and how cold he is, both 0..100. */
export const MOODS = ['andy_neutral', 'andy_annoyed', 'andy_irritated', 'andy_angry', 'andy_furious', 'andy_shouting'] as const;

export function moodIndex(anger: number): number {
  if (anger >= 92) return 5;
  if (anger >= 75) return 4;
  if (anger >= 55) return 3;
  if (anger >= 35) return 2;
  if (anger >= 15) return 1;
  return 0;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export class Meters {
  anger = 0;
  cold = 0;

  addAnger(n: number) {
    this.anger = clamp(this.anger + n, 0, 100);
  }

  get meltdown(): boolean {
    return this.anger >= 100;
  }
}
