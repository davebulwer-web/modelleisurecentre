import { Game, type Controls } from '../src/game/game';

export const quiet = { play: () => undefined };

export function idle(over: Partial<Controls> = {}): Controls {
  return { ax: 0, ay: 0, action: false, took: () => false, ...over };
}

/** A not-very-good skier: follows the piste, dodges what's in front, helps mates, takes calls. */
export function bot(g: Game): Controls {
  const a = g.andy;
  const p = g.piste;
  let aimX = p.centre(a.y + 140);
  let action = false;
  let ay = 0;
  const live = g.scrapes.filter((s) => s.state === 'live');
  const phone = live.find((s) => s.def.kind === 'phone');
  const goal = live.find((s) => s.target && s.target.y > a.y - 20 && s.target.y < a.y + 260);
  if (goal?.target) aimX = goal.target.x;
  for (const o of g.obstacles) {
    if (o.r <= 0 && o.kind !== 'ramp') continue;
    const dy = o.y - a.y;
    if (dy < 0 || dy > 110) continue;
    if (Math.abs(o.x - aimX) < 22) aimX = o.x + (aimX >= o.x ? 26 : -26);
  }
  for (const n of g.npcs) {
    if (n.r <= 0 || n.scrape) continue;
    const dy = n.y - a.y;
    if (dy < 0 || dy > 90) continue;
    if (Math.abs(n.x - aimX) < 20) aimX = n.x + (aimX >= n.x ? 24 : -24);
  }
  const want = Math.atan2(aimX - a.x, 110);
  const ax = Math.abs(want - a.h) > 0.08 ? Math.sign(want - a.h) : 0;
  if (a.v > 230) ay = -1;
  if (g.nearTarget()) { action = true; }
  if (phone) ay = -1;
  return { ax, ay, action, took: () => false };
}

export function playDay(g: Game, maxSeconds = 300): number {
  let t = 0;
  while (g.screen === 'play' && t < maxSeconds) {
    g.update(1 / 60, bot(g));
    t += 1 / 60;
  }
  return t;
}
