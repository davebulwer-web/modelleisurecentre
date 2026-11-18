import { type Rng, shuffle } from '../core/rng';

/** Deals lines from a shuffled bag: every line is used once before any repeats, and never twice in a row. */
export class PhraseRotator {
  private bag: string[] = [];
  private last: string | null = null;

  constructor(private readonly lines: readonly string[], private readonly rng: Rng) {
    if (!lines.length) throw new Error('PhraseRotator needs at least one line');
  }

  next(): string {
    if (!this.bag.length) {
      this.bag = shuffle(this.rng, [...this.lines]);
      if (this.bag.length > 1 && this.bag[this.bag.length - 1] === this.last) {
        [this.bag[0], this.bag[this.bag.length - 1]] = [this.bag[this.bag.length - 1], this.bag[0]];
      }
    }
    this.last = this.bag.pop()!;
    return this.last;
  }
}
