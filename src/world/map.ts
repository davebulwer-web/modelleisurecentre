export interface Vec { x: number; y: number }

export interface RoomDef { id: string; name: string; x0: number; y0: number; x1: number; y1: number; floor: string }
export interface DeskDef { id: string; x: number; y: number }
export interface ObjectDef { type: string; x: number; y: number; solid: boolean }
export interface BayDef { id: string; x: number; y: number }
export interface MapData {
  tileSize: number;
  width: number;
  height: number;
  legend: Record<string, string>;
  rows: string[];
  rooms: RoomDef[];
  desks: DeskDef[];
  objects: ObjectDef[];
  bays: BayDef[];
  points: Record<string, [number, number]>;
  andyStart: string;
}

/** Wall, pool water and bowling lanes: nobody walks on these. */
const SOLID = '#~L';

/** Tile grid with collision, rooms, named points and A* pathfinding. Positions are in pixels. */
export class TileMap {
  readonly ts: number;
  readonly w: number;
  readonly h: number;
  readonly solid: boolean[];
  readonly room: (RoomDef | null)[];

  constructor(readonly data: MapData) {
    this.ts = data.tileSize;
    this.w = data.width;
    this.h = data.height;
    this.solid = [];
    this.room = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        this.solid.push(SOLID.includes(this.char(x, y)));
        this.room.push(null);
      }
    for (const r of data.rooms)
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (this.char(x, y) !== '#') this.room[y * this.w + x] = r;
    for (const o of data.objects) if (o.solid) this.solid[o.y * this.w + o.x] = true;
    for (const d of data.desks) {
      this.solid[d.y * this.w + d.x] = true;
      this.solid[d.y * this.w + d.x + 1] = true;
    }
  }

  char(tx: number, ty: number): string {
    return this.data.rows[ty]?.[tx] ?? '#';
  }

  blocked(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return true;
    return this.solid[ty * this.w + tx];
  }

  blockedPx(x: number, y: number): boolean {
    return this.blocked(Math.floor(x / this.ts), Math.floor(y / this.ts));
  }

  /** True if an axis-aligned box (pixels) overlaps any solid tile. */
  boxBlocked(x0: number, y0: number, x1: number, y1: number): boolean {
    const ts = this.ts;
    for (let ty = Math.floor(y0 / ts); ty <= Math.floor((y1 - 0.001) / ts); ty++)
      for (let tx = Math.floor(x0 / ts); tx <= Math.floor((x1 - 0.001) / ts); tx++) if (this.blocked(tx, ty)) return true;
    return false;
  }

  roomAt(p: Vec): RoomDef | null {
    const tx = Math.floor(p.x / this.ts), ty = Math.floor(p.y / this.ts);
    if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return null;
    return this.room[ty * this.w + tx];
  }

  point(name: string): Vec {
    const p = this.data.points[name];
    if (!p) throw new Error(`Unknown map point ${name}`);
    return { x: p[0] * this.ts, y: p[1] * this.ts };
  }

  desk(id: string): DeskDef {
    const d = this.data.desks.find((k) => k.id === id);
    if (!d) throw new Error(`Unknown desk ${id}`);
    return d;
  }

  /** Where the person sitting at a desk stands (feet), just below the middle of the desk. */
  seat(id: string): Vec {
    const d = this.desk(id);
    return { x: (d.x + 1) * this.ts, y: (d.y + 1) * this.ts + 11 };
  }

  /** A* over walkable tiles (8-way, no corner cutting). Returns pixel waypoints ending at `to`, or null. */
  findPath(from: Vec, to: Vec): Vec[] | null {
    const ts = this.ts;
    const sx = Math.floor(from.x / ts), sy = Math.floor(from.y / ts);
    let gx = Math.floor(to.x / ts), gy = Math.floor(to.y / ts);
    if (this.blocked(gx, gy)) {
      const n = this.nearestOpen(gx, gy);
      if (!n) return null;
      [gx, gy] = n;
    }
    const start = this.blocked(sx, sy) ? this.nearestOpen(sx, sy) : [sx, sy];
    if (!start) return null;
    const W = this.w, idx = (x: number, y: number) => y * W + x;
    const g = new Float64Array(W * this.h).fill(Infinity);
    const came = new Int32Array(W * this.h).fill(-1);
    const closed = new Uint8Array(W * this.h);
    const open: number[] = [];
    const hx = (i: number) => {
      const dx = Math.abs((i % W) - gx), dy = Math.abs(Math.floor(i / W) - gy);
      return Math.max(dx, dy) + 0.414 * Math.min(dx, dy);
    };
    const s = idx(start[0], start[1]), goal = idx(gx, gy);
    g[s] = 0;
    open.push(s);
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (g[open[i]] + hx(open[i]) < g[open[bi]] + hx(open[bi])) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % W, cy = Math.floor(cur / W);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (this.blocked(nx, ny)) continue;
          if (dx && dy && (this.blocked(cx + dx, cy) || this.blocked(cx, cy + dy))) continue;
          const ni = idx(nx, ny);
          const ng = g[cur] + (dx && dy ? 1.414 : 1);
          if (ng < g[ni]) {
            g[ni] = ng;
            came[ni] = cur;
            open.push(ni);
          }
        }
    }
    if (g[goal] === Infinity) return null;
    const tiles: number[] = [];
    for (let c = goal; c !== s; c = came[c]) tiles.push(c);
    tiles.reverse();
    const pts = tiles.map((i) => ({ x: (i % W) * ts + ts / 2, y: Math.floor(i / W) * ts + ts / 2 }));
    if (pts.length) pts.pop();
    pts.push({ x: to.x, y: to.y });
    return pts;
  }

  /** Tiles reachable from p (used by tests to check the floor plan is connected). */
  reachable(p: Vec): Set<number> {
    const seen = new Set<number>();
    const st = [[Math.floor(p.x / this.ts), Math.floor(p.y / this.ts)]];
    while (st.length) {
      const [x, y] = st.pop()!;
      if (this.blocked(x, y) || seen.has(y * this.w + x)) continue;
      seen.add(y * this.w + x);
      st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    return seen;
  }

  private nearestOpen(tx: number, ty: number): [number, number] | null {
    for (let r = 1; r < 4; r++)
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!this.blocked(tx + dx, ty + dy)) return [tx + dx, ty + dy];
    return null;
  }
}
