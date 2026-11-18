import { describe, it, expect } from 'vitest';
import { makeMemberCheck, cardIsValid, isCorrectDecision } from '../src/game/membership';
import { makeRng } from '../src/core/rng';

const today = new Date(2026, 10, 2);

describe('registration cards', () => {
  it('a legit card is valid, and every dodgy one is caught for the reason given', () => {
    const rng = makeRng(4);
    const problems = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const c = makeMemberCheck(rng, today, 0.5, { id: 'noah', name: 'Noah' }, ['isla', 'oscar']);
      expect(cardIsValid(c.card, c.visitor, c.activity, today)).toBe(c.legit);
      expect(isCorrectDecision(c, c.legit)).toBe(true);
      expect(isCorrectDecision(c, !c.legit)).toBe(false);
      if (c.problem) problems.add(c.problem.split(' ')[0]);
    }
    expect(problems.size).toBe(4);
  });

  it('subs are still good on the paid-until date', () => {
    const card = { missing: false, name: 'Isla', plan: 'ALL SQUADS' as const, expires: new Date(2026, 10, 2), photo: 'isla' };
    expect(cardIsValid(card, 'isla', 'u10', today)).toBe(true);
    expect(cardIsValid({ ...card, expires: new Date(2026, 10, 1) }, 'isla', 'u10', today)).toBe(false);
    expect(cardIsValid({ ...card, plan: 'U8s' }, 'isla', 'u10', today)).toBe(false);
    expect(cardIsValid({ ...card, photo: 'noah' }, 'isla', 'u10', today)).toBe(false);
  });
});
