import { describe, it, expect } from 'vitest';
import mapJson from '../src/data/map.json';
import charactersJson from '../src/data/characters.json';
import { TileMap, type MapData } from '../src/world/map';

const map = new TileMap(mapJson as unknown as MapData);
const tileIdx = (p: { x: number; y: number }) => Math.floor(p.y / map.ts) * map.w + Math.floor(p.x / map.ts);
const near = (reach: Set<number>, p: { x: number; y: number }) => {
  const tx = Math.floor(p.x / map.ts), ty = Math.floor(p.y / map.ts);
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (reach.has((ty + dy) * map.w + tx + dx)) return true;
  return false;
};

describe('leisure centre map', () => {
  it('has rows of the declared size', () => {
    expect(mapJson.rows.length).toBe(map.h);
    for (const r of mapJson.rows) expect(r.length).toBe(map.w);
  });

  it('every named spot can be reached (or stood next to) from Andy\'s desk', () => {
    const reach = map.reachable(map.seat('andy'));
    for (const name of Object.keys(mapJson.points)) expect(near(reach, map.point(name)), name).toBe(true);
    for (const d of mapJson.desks) expect(reach.has(tileIdx(map.seat(d.id))), d.id).toBe(true);
  });

  it('nobody can walk on the pool or the bowling lanes', () => {
    expect(map.blocked(8, 5)).toBe(true);
    expect(map.blocked(34, 16)).toBe(true);
    expect(map.blocked(8, 2)).toBe(false);
  });

  it('a visitor can walk from the car park to every room', () => {
    for (const to of ['coffeeSpot', 'counterCustomer', 'changingIn', 'gymIn', 'bowlingIn', 'toilet', 'poolEdge1', 'showerSpot', 'vendingSpot']) {
      const path = map.findPath({ x: 23.5 * map.ts, y: 22.8 * map.ts }, map.point(to));
      expect(path, to).not.toBeNull();
    }
  });

  it('puts the right rooms in the right places', () => {
    expect(map.roomAt(map.seat('andy'))?.id).toBe('office');
    expect(map.roomAt(map.point('kettle'))?.id).toBe('kitchen');
    expect(map.roomAt(map.point('toilet'))?.id).toBe('toilets');
    expect(map.roomAt(map.point('coffeeSpot'))?.id).toBe('cafe');
    expect(map.roomAt(map.point('counterCustomer'))?.id).toBe('reception');
    expect(map.roomAt(map.point('weightsSpot'))?.id).toBe('gym');
    expect(map.roomAt(map.point('lane1'))?.id).toBe('bowling');
    expect(map.roomAt(map.point('poolEdge1'))?.id).toBe('pool');
    expect(map.roomAt(map.point('showerSpot'))?.id).toBe('changing');
  });

  it('gives everyone with a post a real spot on the map', () => {
    for (const c of charactersJson.characters) if ('post' in c && c.post) expect(() => map.point(c.post!)).not.toThrow();
  });
});
