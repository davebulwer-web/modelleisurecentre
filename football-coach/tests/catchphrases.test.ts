import { describe, it, expect } from 'vitest';
import { PhraseRotator } from '../src/game/catchphrases';
import { makeRng } from '../src/core/rng';
import phrases from '../src/data/catchphrases.json';

describe('catchphrase rotation', () => {
  it('uses every line once before repeating and never repeats back to back', () => {
    const lines = phrases.catchphrases;
    const r = new PhraseRotator(lines, makeRng(42));
    let prev = '';
    for (let round = 0; round < 20; round++) {
      const seen = new Set<string>();
      for (let i = 0; i < lines.length; i++) {
        const l = r.next();
        expect(l).not.toBe(prev);
        seen.add(l);
        prev = l;
      }
      expect(seen.size).toBe(lines.length);
    }
  });

  it('includes the classics', () => {
    expect(phrases.catchphrases).toContain("You don't get the gig!");
    expect(phrases.catchphrases).toContain('Worse than my ex-wife.');
    expect(phrases.catchphrases).toContain('A problem, but not my problem.');
  });
});
