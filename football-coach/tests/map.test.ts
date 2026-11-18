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

describe('rec ground map', () => {
  it('has rows of the declared size', () => {
    expect(mapJson.rows.length).toBe(map.h);
    for (const r of mapJson.rows) expect(r.length).toBe(map.w);
  });

  it('every named spot can be reached (or stood next to) from Andy\'s desk', () => {
    const reach = map.reachable(map.seat('andy'));
    for (const name of Object.keys(mapJson.points)) expect(near(reach, map.point(name)), name).toBe(true);
    for (const d of mapJson.desks) expect(reach.has(tileIdx(map.seat(d.id))), d.id).toBe(true);
  });

  it('nobody can walk through fences, houses or clubhouse walls', () => {
    expect(map.blocked(5, 5)).toBe(true); // garden fence
    expect(map.blocked(6, 5)).toBe(false); // garden gate
    expect(map.blocked(10, 0)).toBe(true); // houses
    expect(map.blocked(33, 11)).toBe(true); // clubhouse wall
    expect(map.blocked(10, 12)).toBe(false); // the pitch
  });

  it('a visitor can walk from the car park to everywhere', () => {
    for (const to of ['signinSpot', 'hatch', 'changingIn', 'toilet', 'kettle', 'gateA', 'gateB', 'gateC', 'touch1', 'iceCream', 'parkGate', 'meetingSpot']) {
      const path = map.findPath(map.point('carParkGate'), map.point(to));
      expect(path, to).not.toBeNull();
    }
  });

  it('puts the right rooms in the right places', () => {
    expect(map.roomAt(map.seat('andy'))?.id).toBe('office');
    expect(map.roomAt(map.point('kettle'))?.id).toBe('kitchen');
    expect(map.roomAt(map.point('toilet'))?.id).toBe('toilets');
    expect(map.roomAt(map.point('pumpSpot'))?.id).toBe('office');
    expect(map.roomAt(map.point('meetingSpot'))?.id).toBe('office');
    expect(map.roomAt(map.point('grimshawPost'))?.id).toBe('gardenA');
    expect(map.roomAt(map.point('pembertonPost'))?.id).toBe('gardenB');
    expect(map.roomAt(map.point('nigelPost'))?.id).toBe('gardenC');
    for (const k of ['stationU8', 'stationU10', 'stationU12', 'scrapSpot', 'netLeft', 'netRight']) expect(map.roomAt(map.point(k))?.id, k).toBe('pitch');
  });

  it('gives everyone with a post a real spot on the map', () => {
    for (const c of charactersJson.characters) if ('post' in c && c.post) expect(() => map.point(c.post!)).not.toThrow();
  });
});
