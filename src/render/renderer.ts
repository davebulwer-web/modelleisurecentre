import type { Assets } from '../core/assets';
import type { Input } from '../core/input';
import type { Audio } from '../core/audio';
import { Game, modalButtons, type Task } from '../game/game';
import type { Person, Npc } from '../entities/person';
import { MOODS, moodIndex } from '../game/meters';
import { fmtDate, PLAN_COVERS, activityLabel } from '../game/membership';
import { DAYS } from '../game/game';

export const VIEW_W = 800;
export const VIEW_H = 424;
export const HUD_H = 40;
export const WORLD_W = 640;
export const PANEL_X = 640;
export const MUTE_RECT = { x: 770, y: 10, w: 22, h: 20 };

const FONT = '"VT323", ui-monospace, monospace';
const TITLE_FONT = '"Press Start 2P", ui-monospace, monospace';

const C = {
  hud: '#1c1a26',
  panel: '#24212f',
  card: '#2f2b3d',
  text: '#f2efe6',
  dim: '#a39fb4',
  anger: '#e0483a',
  bladder: '#e8c840',
  thirst: '#8a5a32',
  good: '#5ccf6a',
  warn: '#f0c030',
  bad: '#ff4a3a',
};

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  scale = 1;
  offX = 0;
  offY = 0;
  private floor: HTMLCanvasElement | null = null;
  private t = 0;

  constructor(readonly canvas: HTMLCanvasElement, private readonly assets: Assets) {
    this.ctx = canvas.getContext('2d')!;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    this.scale = Math.min(w / VIEW_W, h / VIEW_H);
    const cw = Math.floor(VIEW_W * this.scale), ch = Math.floor(VIEW_H * this.scale);
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    this.canvas.width = Math.floor(cw * dpr);
    this.canvas.height = Math.floor(ch * dpr);
    this.offX = (w - cw) / 2;
    this.offY = (h - ch) / 2;
  }

  toLogical(cx: number, cy: number) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * VIEW_W, y: ((cy - r.top) / r.height) * VIEW_H };
  }

  // ---------------------------------------------------------------- frame

  draw(g: Game, input: Input, audio: Audio, dt: number) {
    this.t += dt;
    const ctx = this.ctx;
    const k = this.canvas.width / VIEW_W;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    ctx.translate(0, HUD_H);
    ctx.beginPath();
    ctx.rect(0, 0, WORLD_W, VIEW_H - HUD_H);
    ctx.clip();
    this.drawWorld(g, input);
    ctx.restore();

    this.drawHud(g, audio);
    this.drawPanel(g);
    this.drawOverlays(g);
  }

  // ---------------------------------------------------------------- world

  private buildFloor(g: Game) {
    const m = g.map, ts = m.ts;
    const c = document.createElement('canvas');
    c.width = m.w * ts;
    c.height = m.h * ts;
    const x = c.getContext('2d')!;
    const tiles = this.assets.img(this.assets.manifest.tiles.file);
    const names = this.assets.manifest.tiles.names;
    const tile = (name: string, tx: number, ty: number) => {
      const i = names.indexOf(name);
      if (i >= 0) x.drawImage(tiles, i * ts, 0, ts, ts, tx * ts, ty * ts, ts, ts);
    };
    for (let ty = 0; ty < m.h; ty++)
      for (let tx = 0; tx < m.w; tx++) {
        const ch = m.char(tx, ty);
        if (ch === '#') {
          const below = m.char(tx, ty + 1);
          tile(ty + 1 < m.h && below !== '#' && below !== 'o' ? 'wall_front' : 'wall_top', tx, ty);
        } else if (ch === '.') {
          const r = m.room[ty * m.w + tx];
          tile(r ? r.floor : 'door', tx, ty);
        } else tile(m.data.legend[ch] ?? 'tarmac', tx, ty);
      }
    // pool edge and depth markings
    const pool = { x0: 3, y0: 3, x1: 14, y1: 7 };
    x.strokeStyle = '#f4f8fc';
    x.lineWidth = 2;
    x.strokeRect(pool.x0 * ts - 1, pool.y0 * ts - 1, (pool.x1 - pool.x0 + 1) * ts + 2, (pool.y1 - pool.y0 + 1) * ts + 2);
    x.font = `8px ${FONT}`;
    x.fillStyle = '#1a4a7a';
    x.textAlign = 'center';
    x.textBaseline = 'top';
    x.fillText('0.9m', 3.6 * ts, 8.15 * ts);
    x.fillText('2.0m', 14.4 * ts, 8.15 * ts);
    // bowling: gutters between lanes, foul line, arrows
    x.fillStyle = '#2a2430';
    for (const ly of [14, 16, 18]) x.fillRect(31 * ts, ly * ts, 8 * ts, 2);
    x.fillRect(31 * ts, 20 * ts - 2, 8 * ts, 2);
    x.fillStyle = '#c03030';
    x.fillRect(31 * ts, 14 * ts, 2, 6 * ts);
    x.fillStyle = '#7a4a20';
    for (const ly of [15, 17, 19]) for (let k = 0; k < 3; k++) x.fillRect(33 * ts + 4, ly * ts - 6 + k * 4, 3, 2);
    // road markings
    x.fillStyle = '#e8e8e0';
    for (let px = 4; px < m.w * ts; px += 20) x.fillRect(px, 23 * ts + 7, 10, 2);
    // welcome mat at the front doors
    x.fillStyle = '#3a3a44';
    x.fillRect(22.5 * ts, 20 * ts + 4, 3 * ts, 12);
    x.fillStyle = '#f0d040';
    x.font = `7px ${FONT}`;
    x.fillText('WELCOME', 24 * ts, 20 * ts + 5);
    this.floor = c;
  }

  private drawWorld(g: Game, input: Input) {
    const ctx = this.ctx, ts = g.map.ts;
    if (!this.floor) this.buildFloor(g);
    ctx.drawImage(this.floor!, 0, 0);
    this.drawPool(g);

    // room labels
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelY: Record<string, number> = { pool: 9.2, gym: 9.2, office: 9.2, kitchen: 4.2, toilets: 9.3, changing: 20.2, cafe: 20.2, reception: 19.2, bowling: 20.2 };
    const light = ['pool', 'kitchen', 'toilets', 'changing'];
    for (const r of g.map.data.rooms) {
      if (!(r.id in labelY)) continue;
      ctx.fillStyle = light.includes(r.id) ? 'rgba(20,30,60,0.45)' : 'rgba(255,255,255,0.45)';
      const name = r.id === 'kitchen' ? 'KITCHEN' : r.name.toUpperCase();
      ctx.fillText(name, ((r.x0 + r.x1 + 1) / 2) * ts, labelY[r.id] * ts);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('MODEL LEISURE CENTRE', 23.9 * ts, 22.1 * ts);

    const objImg = this.assets.img(this.assets.manifest.objects.file);
    const frames = this.assets.manifest.objects.frames;
    const obj = (name: string, px: number, py: number) => {
      const f = frames[name];
      if (f) ctx.drawImage(objImg, f.x, f.y, f.w, f.h, Math.round(px + f.ox), Math.round(py + f.oy), f.w, f.h);
    };

    // floor-level things: spills
    for (const t of g.tasks) if (t.type === 'spill' && t.spot) obj(t.variant!, t.spot.x - 8, t.spot.y - 6);

    // y-sorted drawables
    const items: { y: number; draw: () => void }[] = [];
    const wallDecals = ['sign_pool', 'mirror', 'noticeboard', 'scoreboard', 'pins'];
    const jammed = g.jammedLanes();
    const broken = g.brokenTreadmill();
    for (const o of g.map.data.objects) {
      const px = o.x * ts, py = o.y * ts;
      if (wallDecals.includes(o.type)) {
        items.push({ y: -1, draw: () => {
          obj(o.type, px, py);
          if (o.type === 'pins') {
            const lane = (o.y - 14) / 2 + 1;
            if (jammed.includes(lane)) this.flashLabel('JAM', px + 4, py + 2);
          }
        } });
        continue;
      }
      if (o.type === 'shower') { items.push({ y: o.y * ts, draw: () => obj('shower', px, (o.y - 0.4) * ts) }); continue; }
      const sortY = o.type === 'lifeguard_chair' ? (o.y + 0.5) * ts : (o.y + 1) * ts;
      items.push({ y: sortY, draw: () => {
        obj(o.type, px, py);
        if (o.type === 'treadmill' && broken !== null && g.map.point(`treadmill${broken}`).x === px + 8) {
          this.smoke(px + 8, py - 2);
          this.flashLabel('ERR', px + 8, py - 18);
        }
      } });
    }
    for (const d of g.map.data.desks) {
      items.push({
        y: (d.y + 1) * ts,
        draw: () => {
          obj('desk', d.x * ts, d.y * ts);
          obj(d.id === 'andy' ? 'screen_work' : 'screen_off', d.x * ts + 10, d.y * ts - 8 + 1);
          if (d.id === 'andy') {
            const ringing = g.tasks.some((t) => t.type === 'phone' && t.variant === 'desk');
            const shake = ringing ? Math.round(Math.sin(this.t * 40)) : 0;
            obj('deskphone', d.x * ts + 21 + shake, d.y * ts + 1);
            if (ringing && Math.floor(this.t * 4) % 2 === 0) {
              ctx.fillStyle = '#ff4a3a';
              for (const [dx, dy] of [[19, -1], [18, 2], [32, -1], [33, 2]]) ctx.fillRect(d.x * ts + dx, d.y * ts + dy, 1, 2);
            }
          }
        },
      });
    }
    for (const n of g.npcs) if (!n.hidden) items.push({ y: n.y + (n.id === 'gaz' ? 1 : 0), draw: () => this.drawNpc(n) });
    if (!g.andy.hidden) items.push({ y: g.andy.y, draw: () => this.drawAndy(g) });
    if (g.toiletOutOfOrder > 0) items.push({ y: 8 * ts, draw: () => obj('out_of_order', 37 * ts, 7.4 * ts) });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    if (!g.andy.hidden && g.tasks.some((t) => t.type === 'phone' && t.variant === 'mobile')) {
      const buzz = Math.round(Math.sin(this.t * 50));
      this.icon('mobile', g.andy.x + 6 + buzz, g.andy.y - 34);
    }

    // task markers
    for (const { task, pos } of g.liveTargets()) this.drawMarker(task, pos);

    // speech bubbles (on top of everything)
    for (const n of g.npcs) if (!n.hidden && n.bubble) this.drawBubble(n);
    if (!g.andy.hidden && g.andy.bubble) this.drawBubble(g.andy);

    // interaction prompt
    if (g.near && !g.andy.hidden && !g.modal) this.drawPrompt(g, input);

    // toasts
    ctx.font = `12px ${FONT}`;
    ctx.textAlign = 'center';
    for (const t of g.toasts) {
      ctx.globalAlpha = Math.min(1, t.t * 2);
      this.outlinedText(t.text, Math.max(70, Math.min(WORLD_W - 70, t.x)), t.y, t.colour);
    }
    ctx.globalAlpha = 1;

    // need warnings
    if (g.slowed && g.screen === 'playing' && Math.floor(this.t * 2) % 2 === 0) {
      ctx.font = `12px ${FONT}`;
      ctx.textAlign = 'center';
      this.outlinedText(g.meters.bladder >= 100 ? 'BURSTING! Find the loo!' : 'PARCHED! Need tea!', WORLD_W / 2, 330, C.bad);
    }
  }

  /** Rippling water, lane ropes, swimmers going up and down, and splashes from the dive-bombers. */
  private drawPool(g: Game) {
    const ctx = this.ctx, ts = g.map.ts;
    const x0 = 3 * ts, y0 = 3 * ts, w = 12 * ts, h = 5 * ts;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.clip();
    ctx.fillStyle = 'rgba(200,240,255,0.35)';
    for (let i = 0; i < 18; i++) {
      const px = x0 + ((i * 53 + this.t * 9) % w), py = y0 + ((i * 37) % h) + Math.sin(this.t * 2 + i) * 2;
      ctx.fillRect(Math.round(px), Math.round(py), 4, 1);
    }
    // lane ropes
    for (const ly of [4.67, 6.33]) {
      for (let px = x0; px < x0 + w; px += 4) {
        ctx.fillStyle = Math.floor(px / 4) % 2 ? '#e03030' : '#f4f4f4';
        ctx.fillRect(px, Math.round(ly * ts), 3, 2);
      }
    }
    // swimmers: heads with swim caps, arms splashing
    const caps = ['#f0d040', '#e03030', '#f4f4f4', '#30a050', '#f080c0'];
    const lanes = [3.8, 5.5, 7.2, 4.2, 6.8];
    const asleep = g.tasks.some((t) => t.type === 'lifeguard');
    for (let i = 0; i < 5; i++) {
      const sp = 0.18 + i * 0.03;
      const ph = (this.t * sp + i * 0.37) % 2;
      const k = ph < 1 ? ph : 2 - ph;
      const sx = x0 + 10 + k * (w - 20), sy = lanes[i] * ts;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      const arm = Math.sin(this.t * 6 + i) * 4;
      ctx.fillRect(Math.round(sx - 6 + arm), Math.round(sy), 3, 2);
      ctx.fillRect(Math.round(sx + 4 - arm), Math.round(sy + 1), 3, 2);
      ctx.fillStyle = '#e8b890';
      ctx.fillRect(Math.round(sx - 2), Math.round(sy - 1), 5, 4);
      ctx.fillStyle = caps[i];
      ctx.fillRect(Math.round(sx - 2), Math.round(sy - 2), 5, 2);
      if (asleep && i === 2 && Math.floor(this.t * 2) % 2) {
        ctx.font = `9px ${FONT}`;
        ctx.textAlign = 'center';
        this.outlinedText('HELP!', sx, sy - 14, '#fff');
      }
    }
    ctx.restore();
    // dive-bomb splashes
    for (const n of g.npcs) {
      if (n.hidden || n.activity !== 'bombing') continue;
      const wy = n.y < 5 * ts ? 3.6 * ts : 7.4 * ts;
      const ph = (this.t * 1.4) % 1;
      ctx.fillStyle = 'rgba(220,245,255,0.9)';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.fillRect(Math.round(n.x + Math.cos(a) * ph * 14), Math.round(wy + Math.sin(a) * ph * 6 - Math.sin(ph * Math.PI) * 8), 2, 2);
      }
    }
  }

  private smoke(px: number, py: number) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(200,200,200,0.75)';
    for (let i = 0; i < 4; i++) {
      const ph = (this.t * 0.8 + i / 4) % 1;
      ctx.beginPath();
      ctx.arc(px - 3 + Math.sin(ph * 6 + i) * 4, py - ph * 16, 2 + ph * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private flashLabel(text: string, px: number, py: number) {
    if (Math.floor(this.t * 3) % 2) return;
    this.ctx.font = `8px ${TITLE_FONT}`;
    this.ctx.textAlign = 'center';
    this.outlinedText(text, px, py, C.bad);
  }

  private drawNpc(n: Npc) {
    // the lifeguard sits on his high chair; everyone else stands on the floor
    if (n.id === 'gaz' && n.seated) {
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(0, -12);
      this.drawPerson(n, n.id);
      ctx.restore();
      return;
    }
    this.drawPerson(n, n.id);
  }

  private drawPerson(p: Person, sheetId: string, workFps = 6, fileOverride?: string) {
    const m = this.assets.manifest;
    const L = m.characterLayout;
    const file = fileOverride ?? m.characters[sheetId]?.file;
    if (!file || !this.assets.has(file)) return;
    const img = this.assets.img(file);
    let row = L.anims[p.dir].row;
    let frame = L.standFrame;
    if (p.pose === 'walk') frame = L.anims[p.dir].frames[Math.floor(p.animT * 8) % 4];
    else if (p.pose === 'work' && p.dir === 'up') {
      row = L.anims.work.row;
      frame = L.anims.work.frames[Math.floor(p.animT * workFps) % 4];
    } else if (p.pose === 'shout') {
      row = L.anims.shout.row;
      frame = L.anims.shout.frames[Math.floor(p.animT * 6) % 4];
    }
    const x = Math.round(p.x - L.frameW / 2), y = Math.round(p.y - L.frameH);
    // shadow
    this.ctx.fillStyle = 'rgba(0,0,0,0.25)';
    this.ctx.beginPath();
    this.ctx.ellipse(p.x, p.y - 1, 6, 2, 0, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.drawImage(img, frame * L.frameW, row * L.frameH, L.frameW, L.frameH, x, y, L.frameW, L.frameH);
  }

  private drawAndy(g: Game) {
    const a = g.andy;
    const c = this.assets.manifest.characters.andy;
    const anger = g.meters.anger;
    const file = anger >= 80 && c.furious ? c.furious : anger >= 50 && c.angry ? c.angry : c.file;
    this.drawPerson(a, 'andy', 6, file);
    if (anger >= 67) {
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(230,230,230,0.8)';
      for (let i = 0; i < 3; i++) {
        const ph = (this.t * 1.5 + i / 3) % 1;
        ctx.fillRect(Math.round(a.x - 7 + i * 7 + Math.sin(ph * 6 + i) * 2), Math.round(a.y - 26 - ph * 10), 2, 2);
      }
    }
  }

  private drawMarker(task: Task, pos: { x: number; y: number }) {
    const ctx = this.ctx;
    const frac = task.timeLeft / task.timeLimit;
    const col = frac < 0.33 ? C.bad : C.warn;
    const bob = Math.sin(this.t * 6) * 2;
    const y = pos.y - (task.type === 'spill' || task.type === 'pins' || task.type === 'treadmill' ? 22 : 34) + bob;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(pos.x - 6, y - 1); ctx.lineTo(pos.x + 6, y - 1); ctx.lineTo(pos.x, y + 7); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(pos.x - 4, y); ctx.lineTo(pos.x + 4, y); ctx.lineTo(pos.x, y + 5); ctx.closePath();
    ctx.fill();
    this.icon(task.icon, pos.x - 8, y - 17);
    if (task.npc && task.type === 'trouble') {
      ctx.font = `10px ${FONT}`;
      ctx.textAlign = 'center';
      this.outlinedText(task.npc.name, pos.x, y - 26, col);
    }
  }

  private drawBubble(p: Person) {
    const ctx = this.ctx;
    const b = p.bubble!;
    ctx.font = `11px ${FONT}`;
    const lines = wrap(ctx, b.text, 120);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 8;
    const h = lines.length * 10 + 5;
    let x = Math.round(p.x - w / 2);
    x = Math.max(2, Math.min(WORLD_W - w - 2, x));
    const y = Math.round(p.y - 30 - h);
    const bg = b.tone === 'andy' ? '#fff3d0' : b.tone === 'fun' ? '#d8f0ff' : '#ffffff';
    ctx.fillStyle = '#1a1420';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillRect(Math.round(p.x) - 2, y + h, 4, 3);
    ctx.fillStyle = b.tone === 'andy' ? '#8a1010' : '#1a1420';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, x + 4, y + 2 + i * 10));
  }

  private drawPrompt(g: Game, input: Input) {
    const ctx = this.ctx;
    const n = g.near!;
    const a = g.andy;
    const key = input.touchMode ? 'Hold ACT' : 'Hold E';
    const text = `${key}: ${n.label}`;
    ctx.font = `11px ${FONT}`;
    const w = ctx.measureText(text).width + 10;
    const x = Math.max(2, Math.min(WORLD_W - w - 2, Math.round(a.x - w / 2)));
    const y = Math.round(a.y + 4);
    ctx.fillStyle = 'rgba(20,16,30,0.85)';
    ctx.fillRect(x, y, w, 14);
    ctx.fillStyle = C.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text, x + 5, y + 2);
    if (n.progress > 0) {
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y + 14, w, 4);
      ctx.fillStyle = C.good;
      ctx.fillRect(x + 1, y + 15, Math.round((w - 2) * Math.min(1, n.progress)), 2);
    }
  }

  // ---------------------------------------------------------------- HUD + panel

  private drawHud(g: Game, audio: Audio) {
    const ctx = this.ctx;
    ctx.fillStyle = C.hud;
    ctx.fillRect(0, 0, VIEW_W, HUD_H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, HUD_H - 1, VIEW_W, 1);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = C.dim;
    ctx.font = `11px ${FONT}`;
    ctx.fillText(`DAY ${g.day}  ${g.dateLabel().toUpperCase()}`, 8, 4);
    ctx.fillStyle = C.text;
    ctx.font = `14px ${TITLE_FONT}`;
    ctx.fillText(g.clockLabel(), 8, 18);

    // anger
    const mood = MOODS[moodIndex(g.meters.anger)];
    this.portrait(`andy_${mood}`, 104, 4, 32);
    this.bar(140, 8, 130, 10, g.meters.anger / 100, C.anger, 'ANGER');
    ctx.fillStyle = C.dim;
    ctx.font = `10px ${FONT}`;
    ctx.fillText(mood.toUpperCase(), 140, 21);

    this.icon('bladder', 290, 4);
    this.bar(308, 6, 80, 8, g.meters.bladder / 100, C.bladder, 'BLADDER');
    this.icon('tea', 290, 21);
    this.bar(308, 23, 80, 8, g.meters.thirst / 100, C.thirst, 'THIRST');

    ctx.textAlign = 'right';
    ctx.fillStyle = C.text;
    ctx.font = `12px ${TITLE_FONT}`;
    ctx.fillText(String(g.score).padStart(6, '0'), 750, 8);
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = C.dim;
    ctx.fillText(`BEST ${g.best}`, 750, 25);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.dim;
    ctx.fillText(`DONE ${g.stats.done}  MISSED ${g.stats.failed}`, 420, 25);
    ctx.fillStyle = C.text;
    ctx.font = `12px ${FONT}`;
    ctx.fillText(g.screen === 'playing' ? 'P = pause' : '', 420, 6);
    this.icon(audio.muted ? 'sound_off' : 'sound_on', MUTE_RECT.x + 3, MUTE_RECT.y + 2);
  }

  private bar(x: number, y: number, w: number, h: number, v: number, col: string, label: string) {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = '#3a3648';
    ctx.fillRect(x, y, w, h);
    const full = v >= 1;
    ctx.fillStyle = full && Math.floor(this.t * 4) % 2 ? '#fff' : col;
    ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, v))), h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x, y, Math.round(w * Math.max(0, Math.min(1, v))), 1);
    if (h >= 8) {
      ctx.font = `9px ${FONT}`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(label, x + 2, y - 1 + (h - 8) / 2);
    }
  }

  private drawPanel(g: Game) {
    const ctx = this.ctx;
    ctx.fillStyle = C.panel;
    ctx.fillRect(PANEL_X, HUD_H, VIEW_W - PANEL_X, VIEW_H - HUD_H);
    ctx.fillStyle = '#000';
    ctx.fillRect(PANEL_X, HUD_H, 1, VIEW_H - HUD_H);
    ctx.font = `10px ${TITLE_FONT}`;
    ctx.fillStyle = C.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('TASKS', PANEL_X + 8, HUD_H + 8);
    const sorted = [...g.tasks].sort((a, b) => a.timeLeft - b.timeLeft);
    let y = HUD_H + 24;
    if (!sorted.length) {
      ctx.font = `11px ${FONT}`;
      ctx.fillStyle = C.dim;
      ctx.fillText('All quiet. For now...', PANEL_X + 8, y);
    }
    for (const t of sorted.slice(0, 7)) {
      this.card(t, PANEL_X + 4, y);
      y += 48;
    }
    // controls reminder
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = C.dim;
    ctx.fillText('Move: WASD/arrows', PANEL_X + 8, VIEW_H - 26);
    ctx.fillText('Act: hold E/Space  Mute: M', PANEL_X + 8, VIEW_H - 15);
  }

  private card(t: Task, x: number, y: number) {
    const ctx = this.ctx;
    const w = VIEW_W - x - 4, h = 44;
    const frac = Math.max(0, t.timeLeft / t.timeLimit);
    const urgent = frac < 0.33;
    ctx.fillStyle = urgent && Math.floor(this.t * 3) % 2 ? '#4a2a30' : C.card;
    ctx.fillRect(x, y, w, h);
    if (t.portrait) this.portrait(t.portrait, x + 3, y + 3, 24);
    else { ctx.fillStyle = '#1c1a26'; ctx.fillRect(x + 3, y + 3, 24, 24); this.icon(t.icon, x + 7, y + 7); }
    if (t.portrait) this.icon(t.icon, x + 17, y + 17);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = C.text;
    ctx.fillText(clip(ctx, t.title, w - 34), x + 31, y + 3);
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = C.dim;
    ctx.fillText(clip(ctx, t.detail, w - 34), x + 31, y + 16);
    // timer bar
    const bx = x + 3, by = y + 33, bw = w - 6;
    ctx.fillStyle = '#000';
    ctx.fillRect(bx, by, bw, 7);
    {
      ctx.fillStyle = frac < 0.33 ? C.bad : frac < 0.66 ? C.warn : C.good;
      ctx.fillRect(bx + 1, by + 1, Math.round((bw - 2) * frac), 5);
      ctx.fillStyle = '#fff';
      ctx.font = `9px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.ceil(t.timeLeft)}s`, bx + bw - 2, by - 2);
      ctx.textAlign = 'left';
    }
    if (t.progress > 0 && t.progress < 1) {
      ctx.fillStyle = '#7aa8ff';
      ctx.fillRect(bx + 1, by + 5, Math.round((bw - 2) * t.progress), 1);
    }
  }

  // ---------------------------------------------------------------- overlays

  private drawOverlays(g: Game) {
    const ctx = this.ctx;
    if (g.banner && g.screen === 'playing') {
      ctx.font = `10px ${TITLE_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const w = ctx.measureText(g.banner.text).width + 20;
      ctx.globalAlpha = Math.min(1, g.banner.t * 2);
      ctx.fillStyle = 'rgba(20,16,30,0.9)';
      ctx.fillRect(WORLD_W / 2 - w / 2, HUD_H + 6, w, 20);
      ctx.fillStyle = C.warn;
      ctx.fillText(g.banner.text, WORLD_W / 2, HUD_H + 11);
      ctx.globalAlpha = 1;
    }
    if (g.modal?.kind === 'member') this.drawMemberModal(g);
    if (g.modal?.kind === 'manager') this.drawManagerModal(g);
    if (g.modal?.kind === 'call') this.drawCallModal(g);
    if (g.screen === 'title') this.drawTitle(g);
    if (g.screen === 'paused') this.drawCentre(['PAUSED', '', 'Press P or tap to carry on']);
    if (g.screen === 'dayEnd') this.drawDayEnd(g);
    if (g.screen === 'gameover') this.drawGameOver(g);
  }

  private dim(a = 0.65) {
    this.ctx.fillStyle = `rgba(10,8,16,${a})`;
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  private box(x: number, y: number, w: number, h: number) {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = '#2f2b3d';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#4a4560';
    ctx.fillRect(x, y, w, 2);
  }

  private drawMemberModal(g: Game) {
    const ctx = this.ctx;
    const m = g.modal as Extract<typeof g.modal, { kind: 'member' }>;
    const chk = m.check;
    this.dim(0.55);
    this.box(150, 84, 420, 282);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `12px ${TITLE_FONT}`;
    ctx.fillStyle = C.warn;
    ctx.fillText('MEMBERSHIP CHECK', 360, 96);
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = C.dim;
    ctx.fillText(`Today is ${g.dateLabel()} ${fmtDate(g.today())}`, 360, 114);
    // the visitor
    ctx.textAlign = 'left';
    ctx.fillStyle = C.dim;
    ctx.font = `11px ${FONT}`;
    ctx.fillText('AT THE DESK', 170, 134);
    this.portrait(chk.visitor, 170, 148, 64);
    ctx.font = `15px ${FONT}`;
    ctx.fillStyle = C.text;
    wrap(ctx, chk.visitorName, 90).forEach((l, i) => ctx.fillText(l, 170, 218 + i * 14));
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = C.warn;
    wrap(ctx, `"I'm here for ${activityLabel(chk.activity)}."`, 96).forEach((l, i) => ctx.fillText(l, 170, 250 + i * 13));
    // the card
    const cx = 286, cy = 134, cw = 264, ch = 150;
    const c = chk.card;
    if (c.missing) {
      ctx.fillStyle = '#3a3648';
      ctx.fillRect(cx, cy, cw, ch);
      ctx.fillStyle = C.text;
      ctx.font = `15px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('No card.', cx + cw / 2, cy + 50);
      ctx.fillStyle = C.dim;
      ctx.fillText('"I left it in the car, honest."', cx + cw / 2, cy + 72);
    } else {
      ctx.fillStyle = '#e8f0ff';
      ctx.fillRect(cx, cy, cw, ch);
      ctx.fillStyle = '#2a7ab0';
      ctx.fillRect(cx, cy, cw, 24);
      ctx.fillStyle = '#f0d040';
      ctx.fillRect(cx, cy + 24, cw, 3);
      ctx.fillStyle = '#fff';
      ctx.font = `8px ${TITLE_FONT}`;
      ctx.fillText('MODEL LEISURE CENTRE', cx + 10, cy + 8);
      this.portrait(c.photo, cx + 10, cy + 36, 56);
      ctx.fillStyle = '#111';
      ctx.font = `15px ${FONT}`;
      ctx.fillText(c.name, cx + 76, cy + 36);
      ctx.fillStyle = '#555';
      ctx.font = `12px ${FONT}`;
      ctx.fillText('MEMBERSHIP', cx + 76, cy + 58);
      ctx.fillStyle = '#111';
      ctx.font = `15px ${FONT}`;
      ctx.fillText(`${c.plan}`, cx + 76, cy + 70);
      ctx.fillStyle = '#555';
      ctx.font = `11px ${FONT}`;
      ctx.fillText(PLAN_COVERS[c.plan].map((a) => (a === 'swim' ? 'swimming' : a)).join(', '), cx + 76, cy + 86);
      ctx.font = `12px ${FONT}`;
      ctx.fillText('VALID UNTIL', cx + 10, cy + 104);
      ctx.fillStyle = '#111';
      ctx.font = `16px ${FONT}`;
      ctx.fillText(fmtDate(c.expires), cx + 10, cy + 116);
      ctx.fillStyle = '#2a2a30';
      for (let i = 0; i < 26; i++) ctx.fillRect(cx + 140 + i * 4, cy + 110, i % 3 ? 2 : 1, 26);
    }
    const b = modalButtons();
    this.button(b.allow, 'LET IN  [A]', '#2a8a3a');
    this.button(b.deny, 'TURN AWAY [D]', '#b03030');
    ctx.textAlign = 'center';
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = C.dim;
    ctx.fillText('Photo must match, plan must cover it, date not passed.', 360, 296);
  }

  private drawCallModal(g: Game) {
    const ctx = this.ctx;
    const m = g.modal as Extract<typeof g.modal, { kind: 'call' }>;
    this.dim(0.55);
    this.box(170, 110, 380, 254);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `12px ${TITLE_FONT}`;
    ctx.fillStyle = C.warn;
    const cold = m.caller.cold;
    ctx.fillText(m.complaint ? 'COMPLAINT' : cold ? 'UNKNOWN NUMBER' : 'INCOMING CALL', 360, 122);
    if (!m.complaint) this.icon(m.task.variant === 'mobile' ? 'mobile' : 'phone', cold ? 238 : 250, 120);
    if (m.caller.portrait) this.portrait(m.caller.portrait, 190, 150, 48);
    else {
      ctx.fillStyle = '#1c1a26';
      ctx.fillRect(190, 150, 48, 48);
      this.icon('phone', 206, 166);
    }
    ctx.textAlign = 'left';
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = C.text;
    ctx.fillText(m.caller.name, 250, 154);
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = cold ? C.bad : C.dim;
    ctx.fillText(m.complaint ? 'at the reception desk' : cold ? 'Sales call!' : m.task.variant === 'mobile' ? 'on your mobile' : 'on the office phone', 250, 172);
    ctx.fillStyle = '#f2efe6';
    ctx.fillRect(190, 210, 340, 78);
    ctx.fillStyle = '#1a1420';
    ctx.font = `17px ${FONT}`;
    wrap(ctx, `"${m.text}"`, 320).slice(0, 4).forEach((l, i) => ctx.fillText(l, 200, 218 + i * 17));
    const b = modalButtons();
    this.button(b.allow, cold ? 'HANG UP [A]' : 'FOB OFF [A]', '#2a8a3a');
    this.button(b.deny, cold ? 'HEAR OUT [D]' : m.complaint ? 'FREE SWIM [D]' : 'SORT IT [D]', '#2a5ab0');
    ctx.textAlign = 'center';
    ctx.font = `11px ${FONT}`;
    ctx.fillStyle = C.dim;
    ctx.fillText(
      cold ? 'Hanging up is very satisfying. Hearing them out is not.' : `Fob-offs: ${g.brushOffsToday} of ${g.defs.manager.brushOffsBeforeManager ?? 3} before the Area Manager turns up`,
      360,
      298,
    );
  }

  private drawManagerModal(g: Game) {
    const ctx = this.ctx;
    const m = g.modal as Extract<typeof g.modal, { kind: 'manager' }>;
    ctx.fillStyle = 'rgba(10,8,16,0.6)';
    ctx.fillRect(0, HUD_H, WORLD_W, VIEW_H - HUD_H);
    this.box(150, 130, 340, 150);
    this.portrait('manager', 166, 150, 64);
    this.portrait(`andy_${MOODS[Math.min(5, moodIndex(g.meters.anger) + 1)]}`, 410, 190, 64);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = `9px ${TITLE_FONT}`;
    ctx.fillStyle = C.warn;
    ctx.fillText('MEETING: AREA MANAGER', 244, 144);
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = C.text;
    wrap(ctx, `"${m.line}"`, 230).forEach((l, i) => ctx.fillText(l, 244, 166 + i * 14));
    ctx.fillStyle = C.dim;
    ctx.font = `11px ${FONT}`;
    ctx.fillText(`Back in ${Math.ceil(m.t)}s... (tasks keep ticking!)`, 166, 262);
  }

  private button(r: { x: number; y: number; w: number; h: number }, label: string, col: string) {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    ctx.fillStyle = col;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(r.x, r.y, r.w, 3);
    ctx.fillStyle = '#fff';
    ctx.font = `10px ${TITLE_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.textBaseline = 'top';
  }

  private drawCentre(lines: string[], startY = 150) {
    const ctx = this.ctx;
    this.dim();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => {
      ctx.font = i === 0 ? `16px ${TITLE_FONT}` : `14px ${FONT}`;
      ctx.fillStyle = i === 0 ? C.warn : C.text;
      ctx.fillText(l, VIEW_W / 2, startY + i * 18 + (i ? 10 : 0));
    });
  }

  private drawTitle(g: Game) {
    const ctx = this.ctx;
    this.dim(0.72);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `22px ${TITLE_FONT}`;
    ctx.fillStyle = '#000';
    ctx.fillText('ANGRY ANDY', VIEW_W / 2 + 2, 52);
    ctx.fillStyle = C.anger;
    ctx.fillText('ANGRY ANDY', VIEW_W / 2, 50);
    ctx.font = `12px ${TITLE_FONT}`;
    ctx.fillStyle = C.text;
    ctx.fillText('MODEL LEISURE CENTRE', VIEW_W / 2, 82);
    const moods = ['neutral', 'annoyed', 'irritated', 'angry', 'furious', 'shouting'];
    moods.forEach((m, i) => this.portrait(`andy_${m}`, VIEW_W / 2 - 3 * 44 + i * 44 + 4, 108, 36));
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = C.text;
    const lines = [
      'Andy has a new gig: Duty Manager at the leisure centre. He is still annoyed.',
      'Deal with each task before its timer runs out or his ANGER rises.',
      'Check membership cards, sort out troublemakers, mop up spills, throw Alistair out',
      'before he nicks a coffee, fix the pins and the treadmills, wake up Gaz the lifeguard,',
      'thump the vending machine, fob off complaints and survive the Area Manager.',
      'Keep BLADDER (loo) and THIRST (tea in the staff kitchen) under control.',
      'Survive until closing time. If anger hits 100%... MELTDOWN.',
    ];
    lines.forEach((l, i) => ctx.fillText(l, VIEW_W / 2, 160 + i * 16));
    ctx.fillStyle = C.dim;
    ctx.fillText('Move: WASD / arrows / joystick     Act: hold E or Space / ACT button', VIEW_W / 2, 284);
    ctx.fillText('A / D to let in or turn away members, fob off or sort calls     P pause     M mute', VIEW_W / 2, 300);
    if (Math.floor(this.t * 2) % 2 === 0) {
      ctx.font = `12px ${TITLE_FONT}`;
      ctx.fillStyle = C.warn;
      ctx.fillText('PRESS SPACE OR TAP TO START', VIEW_W / 2, 336);
    }
    ctx.font = `12px ${FONT}`;
    ctx.fillStyle = C.dim;
    if (g.best) ctx.fillText(`Best score: ${g.best}`, VIEW_W / 2, 366);
    ctx.fillText('"Model Leisure Centre, my backside."', VIEW_W / 2, 390);
  }

  private drawDayEnd(g: Game) {
    this.drawCentre([
      'CLOSING TIME!',
      `Day ${g.day} survived. The doors are locked. Andy is going home.`,
      `Tasks done: ${g.stats.done}    Missed: ${g.stats.failed}`,
      `Day score: ${g.stats.score} (incl. ${g.tuning.dayEndBonus} bonus)`,
      `Total: ${g.score}`,
      '',
      `Press SPACE or tap for Day ${g.day + 1} (${DAYS[g.day % 7]})`,
    ], 120);
    this.portrait(`andy_${MOODS[moodIndex(g.meters.anger)]}`, VIEW_W / 2 - 24, 290, 48);
  }

  private drawGameOver(g: Game) {
    const ctx = this.ctx;
    this.dim(0.75);
    this.portrait('andy_shouting', VIEW_W / 2 - 48, 70, 96);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `24px ${TITLE_FONT}`;
    ctx.fillStyle = C.bad;
    ctx.fillText('MELTDOWN!', VIEW_W / 2, 182);
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = C.text;
    ctx.fillText(`"${g.lastPhrase || "You don't get the gig!"}"`, VIEW_W / 2, 220);
    ctx.fillText(`Andy lost it on Day ${g.day} at ${g.clockLabel()}.`, VIEW_W / 2, 248);
    ctx.fillText(`Score: ${g.score}     Best: ${g.best}`, VIEW_W / 2, 270);
    ctx.fillStyle = C.warn;
    ctx.font = `12px ${TITLE_FONT}`;
    if (Math.floor(this.t * 2) % 2 === 0) ctx.fillText('SPACE OR TAP TO TRY AGAIN', VIEW_W / 2, 320);
  }

  // ---------------------------------------------------------------- primitives

  icon(name: string, x: number, y: number) {
    const m = this.assets.manifest.icons;
    const i = m.names.indexOf(name);
    if (i < 0) return;
    this.ctx.drawImage(this.assets.img(m.file), i * m.size, 0, m.size, m.size, Math.round(x), Math.round(y), m.size, m.size);
  }

  portrait(id: string, x: number, y: number, size: number) {
    const f = this.assets.manifest.portraits[id];
    if (!f || !this.assets.has(f)) return;
    const img = this.assets.img(f);
    this.ctx.drawImage(img, 0, 0, img.width, img.height, x, y, size, size);
  }

  private outlinedText(text: string, x: number, y: number, col: string) {
    const ctx = this.ctx;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#000';
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) ctx.fillText(text, x + dx, y + dy);
    ctx.fillStyle = col;
    ctx.fillText(text, x, y);
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function clip(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

