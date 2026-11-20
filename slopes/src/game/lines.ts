import type { Rng } from '../core/rng';

/** Picks lines from a list without repeating the last few. */
export class Lines {
  private recent = new Map<string, string[]>();
  constructor(private readonly rng: Rng) {}

  pick(key: string, list: readonly string[]): string {
    if (!list.length) return '';
    const recent = this.recent.get(key) ?? [];
    const keep = Math.min(recent.length, Math.max(0, list.length - 1), 4);
    const fresh = list.filter((l) => !recent.slice(-keep).includes(l));
    const choice = fresh[Math.floor(this.rng() * fresh.length)] ?? list[0];
    recent.push(choice);
    if (recent.length > 6) recent.shift();
    this.recent.set(key, recent);
    return choice;
  }
}
