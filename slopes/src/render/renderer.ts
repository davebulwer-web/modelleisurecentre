import type { Assets } from '../core/assets';
import type { Audio } from '../core/audio';
import { Game, DAYS, NAMES, PHYS, type Npc, type Pose, type Scrape } from '../game/game';
import { MOODS, moodIndex } from '../game/meters';
import phrases from '../data/catchphrases.json';

export const VIEW_W = 800;
export const VIEW_H = 424;
export const HUD_H = 40;
export const WORLD_W = 640;
export const WORLD_H = VIEW_H - HUD_H;
export const PANEL_X = 640;
export const MUTE_RECT = { x: 770, y: 10, w: 22, h: 20 };

const FONT = '"VT323", ui-monospace, monospace';
const TITLE_FONT = '"Press Start 2P", ui-monospace, monospace';
const POSES: Pose[] = ['down', 'slight', 'diag', 'side', 'crash', 'jump', 'tuck', 'stand', 'shout', 'sit'];

const C = {
  hud: '#1c1a26',
  panel: '#24212f',
  card: '#2f2b3d',
  text: '#f2efe6',
  dim: '#a39fb4',
  anger: '#e0483a',
  cold: '#6ac0f0',
  good: '#5ccf6a',
  warn: '#f0c030',
  bad: '#ff4a3a',
  piste: '#f7faff',
  piste2: '#eef3fb',
  powder: '#e4ecf8',
  sparkle: '#ffffff',
  shadow: 'rgba(60,80,130,0.25)',
};
const GRADE: Record<string, string> = { green: '#2ab04a', blue: '#2a6ae0', red: '#e02a2a', black: '#141418', offpiste: '#f07a20', race: '#e02a2a' };

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  scale = 1;
  private t = 0;
  private camY = 0;

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
  }

  toLogical(cx: number, cy: number) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((cx - r.left) / r.width) * VIEW_W, y: ((cy - r.top) / r.height) * VIEW_H };
  }

  // ---------------------------------------------------------------- frame

  draw(g: Game, audio: Audio, dt: number) {
    this.t += dt;
    const ctx = this.ctx;
    const k = this.canvas.width / VIEW_W;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    if (g.screen === 'title') {
      this.drawTitle(g);
    } else {
      ctx.save();
      ctx.translate(0, HUD_H);
      ctx.beginPath();
      ctx.rect(0, 0, WORLD_W, WORLD_H);
      ctx.clip();
      this.drawWorld(g);
      this.drawToasts(g);
      ctx.restore();
      this.drawHud(g);
      this.drawPanel(g);
      if (g.screen === 'dayIntro') this.drawDayIntro(g);
      if (g.screen === 'dayEnd') this.drawDayEnd(g);
      if (g.screen === 'gameover') this.drawGameOver(g);
      if (g.screen === 'holidayOver') this.drawHolidayOver(g);
      if (g.paused && g.screen === 'play') this.modal(['PAUSED', '', 'Press P to carry on'], 220);
    }
    this.drawMute(audio.muted);
  }

  // ---------------------------------------------------------------- the mountain

  private sy(_g: Game, y: number) {
    return Math.round(y - this.camY);
  }

  private drawWorld(g: Game) {
    const ctx = this.ctx;
    const a = g.andy;
    this.camY = Math.round(a.y - PHYS.andyScreenY);
    const p = g.piste;
    const top = this.camY, bottom = this.camY + WORLD_H;

    // powder everywhere, then the groomed piste
    ctx.fillStyle = C.powder;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    for (let y = Math.floor(top / 4) * 4; y < bottom; y += 4) {
      const c = p.centre(y), h = p.half(y);
      ctx.fillStyle = (y / 4) % 2 === 0 ? C.piste : C.piste2;
      ctx.fillRect(Math.round(c - h), this.sy(g, y), Math.round(h * 2), 4);
    }
    // sparkles in the powder
    ctx.fillStyle = '#ffffff';
    for (let y = Math.floor(top / 16) * 16; y < bottom; y += 16) {
      for (let i = 0; i < 6; i++) {
        const hsh = hash(y * 13 + i * 7919);
        const x = hsh % WORLD_W;
        if (p.onPiste(x, y, -6)) continue;
        ctx.fillRect(x, this.sy(g, y + (hsh % 13)), 1, 1);
        if (hsh % 5 === 0) { ctx.fillStyle = '#c8d6ea'; ctx.fillRect(x + 3, this.sy(g, y + (hsh % 11)), 2, 1); ctx.fillStyle = '#ffffff'; }
      }
    }
    // start and finish
    if (top < 120) this.banner(g, 60, 'START', '#1f3f8a');
    const len = g.dayDef.length;
    if (bottom > len - 40 && top < len + 200) {
      this.banner(g, len, 'FINISH', '#e02a2a');
      this.drawBar(g, len + 150);
    }

    // ski tracks
    ctx.fillStyle = 'rgba(150,170,205,0.55)';
    const tr = a.trail;
    for (let i = 1; i < tr.length; i++) {
      const p0 = tr[i - 1], p1 = tr[i];
      if (p1.gap) continue;
      const steps = Math.max(1, Math.ceil(Math.hypot(p1.x - p0.x, p1.y - p0.y) / 2));
      for (let s = 0; s < steps; s++) {
        const x = p0.x + ((p1.x - p0.x) * s) / steps, y = p0.y + ((p1.y - p0.y) * s) / steps;
        ctx.fillRect(Math.round(x - 4), this.sy(g, y), 1, 1);
        ctx.fillRect(Math.round(x + 3), this.sy(g, y), 1, 1);
      }
    }

    // flat things first (ice, moguls, ramps), then everything that stands up, sorted by depth
    const flat = new Set(['ice', 'mogul', 'ramp']);
    for (const o of g.obstacles) {
      if (!flat.has(o.kind) || o.y < top - 40 || o.y > bottom + 40) continue;
      this.obj(o.sprite, o.x, this.sy(g, o.y), 'centre', false);
    }
    type D = { y: number; draw: () => void };
    const list: D[] = [];
    for (const o of g.obstacles) {
      if (flat.has(o.kind) || o.y < top - 10 || o.y > bottom + 70) continue;
      if (o.kind === 'gate') {
        list.push({ y: o.y, draw: () => { this.obj(o.sprite, o.x, this.sy(g, o.y), 'base', false); this.obj(o.sprite, o.x2 ?? o.x, this.sy(g, o.y), 'base', false); } });
      } else list.push({ y: o.y, draw: () => this.obj(o.sprite, o.x, this.sy(g, o.y), 'base', !!o.flip && o.kind !== 'hut' && o.kind !== 'cocoa' && o.kind !== 'sign') });
    }
    for (const n of g.npcs) {
      if (n.role === 'chair' || n.role === 'snowball') continue;
      if (n.y < top - 10 || n.y > bottom + 40) continue;
      list.push({ y: n.y, draw: () => this.npc(g, n) });
    }
    list.push({ y: a.y, draw: () => this.drawAndy(g) });
    list.sort((p1, p2) => p1.y - p2.y);
    for (const d of list) d.draw();

    // snow spray
    ctx.fillStyle = '#ffffff';
    for (const pt of g.particles) ctx.fillRect(Math.round(pt.x), this.sy(g, pt.y), 2, 2);

    // chairlift overhead
    this.drawLift(g);
    for (const n of g.npcs) if (n.role === 'snowball') this.obj('snowball', n.x, this.sy(g, n.y), 'centre', false);

    // pop-ups, bubbles, prompts
    for (const pu of g.popups) this.outlinedText(pu.text, pu.x, this.sy(g, pu.y), pu.color, 16);
    for (const n of g.npcs) if (n.bubble && n.y > top - 20 && n.y < bottom + 10) this.bubble(n.bubble.text, n.x, this.sy(g, n.y) - (n.role === 'chair' ? 70 : 36), n.role === 'target' || n.role === 'chair');
    if (a.bubble) this.bubble(a.bubble.text, a.x, this.sy(g, a.y) - 38 - a.z, true, '#fff4c8');
    this.drawPrompts(g);
    this.drawPointers(g);
  }

  private banner(g: Game, y: number, text: string, color: string) {
    const ctx = this.ctx;
    const c = g.piste.centre(y), h = Math.min(g.piste.half(y), 200);
    const sy = this.sy(g, y);
    ctx.fillStyle = '#555';
    ctx.fillRect(c - h, sy - 46, 3, 46);
    ctx.fillRect(c + h - 3, sy - 46, 3, 46);
    ctx.fillStyle = color;
    ctx.fillRect(c - h + 3, sy - 46, h * 2 - 6, 14);
    ctx.fillStyle = '#fff';
    ctx.font = `10px ${TITLE_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, c, sy - 38);
    // chequered line in the snow
    for (let x = c - h; x < c + h; x += 6) {
      ctx.fillStyle = Math.floor((x - c) / 6) % 2 ? '#222' : '#ddd';
      ctx.fillRect(Math.round(x), sy, 6, 2);
    }
  }

  private drawBar(g: Game, y: number) {
    const sy = this.sy(g, y);
    const x = WORLD_W / 2;
    this.obj('bar', x, sy, 'base', false);
    const ctx = this.ctx;
    ctx.font = `16px ${FONT}`;
    ctx.fillStyle = '#f8d870';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(g.dayDef.bar, x, sy - 64 + 37);
  }

  private drawLift(g: Game) {
    const ctx = this.ctx;
    const lx = g.piste.liftX;
    const top = this.camY;
    ctx.fillStyle = 'rgba(40,40,50,0.55)';
    ctx.fillRect(lx - 7, 0, 1, WORLD_H);
    ctx.fillRect(lx + 7, 0, 1, WORLD_H);
    // the chairs going round: up on the right cable, down on the left one
    const gap = 150;
    const upOff = (this.t * 70) % gap;
    for (let y = Math.floor(top / gap) * gap - gap; y < top + WORLD_H + gap; y += gap) {
      this.obj('chair', lx + 7, Math.round(y - top - upOff) + 26, 'base', false, 0.85);
      this.obj('chair', lx - 7, Math.round(y - top + upOff + gap / 2) + 26, 'base', false, 0.85);
    }
    for (const n of g.npcs) {
      if (n.role !== 'chair') continue;
      const sy = this.sy(g, n.y);
      // the rider sits in the chair, drawn on top of it
      if (n.rider) this.skier(n.rider, 'sit', n.x + 7, sy - 6, false);
      this.obj('chair', n.x + 7, sy + 4, 'base', false);
      if (n.zzz) this.obj('zzz', n.x + 22, sy - 34 + Math.sin(this.t * 3) * 2, 'centre', false);
      // its shadow on the snow, a little below
      ctx.fillStyle = C.shadow;
      ctx.beginPath();
      ctx.ellipse(n.x + 7, sy + 30, 9, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private npc(g: Game, n: Npc) {
    const sy = this.sy(g, n.y);
    if (n.isObject) {
      if (n.role === 'item') {
        // items bob and glint so they stand out
        const bob = Math.round(Math.sin(this.t * 5 + n.id) * 2);
        this.ctx.fillStyle = C.shadow;
        this.ctx.beginPath();
        this.ctx.ellipse(n.x, sy, 7, 2.5, 0, 0, Math.PI * 2);
        this.ctx.fill();
        this.obj(n.sprite, n.x, sy - 4 + bob, 'base', false);
        if (Math.floor(this.t * 4) % 2) { this.ctx.fillStyle = '#fff'; this.ctx.fillRect(n.x + 5, sy - 14 + bob, 2, 2); }
      } else this.obj(n.sprite, n.x, sy, 'base', n.flip);
      return;
    }
    this.shadow(n.x, sy);
    this.skier(n.sprite, n.pose, n.x, sy, n.flip);
    if (n.zzz) this.obj('zzz', n.x + 12, sy - 32 + Math.sin(this.t * 3) * 2, 'centre', false);
    // a live scrape: a marker over their head
    if (n.scrape && n.scrape.state === 'live') {
      const bob = Math.sin(this.t * 6) * 2;
      this.ctx.fillStyle = '#f0c020';
      this.ctx.fillRect(n.x - 1, sy - 44 + bob, 3, 7);
      this.ctx.fillRect(n.x - 1, sy - 35 + bob, 3, 2);
    }
  }

  private drawAndy(g: Game) {
    const a = g.andy;
    const sy = this.sy(g, a.y);
    const { pose, flip } = g.andyPose();
    if (a.invuln > 0 && Math.floor(this.t * 12) % 2) return;
    this.shadow(a.x, sy, a.z);
    const mood = moodIndex(g.meters.anger);
    const m = this.assets.manifest.characters.andy;
    const sheet = mood >= 4 && m.furious ? m.furious : mood >= 3 && m.angry ? m.angry : m.file;
    this.sheetFrame(sheet, pose, a.x, sy - Math.round(a.z), flip);
    if (g.scrapes.some((s) => s.state === 'live' && s.def.kind === 'phone')) {
      this.obj('phone', a.x + 13, sy - 22 + (Math.floor(this.t * 16) % 2), 'centre', false);
    }
  }

  private shadow(x: number, sy: number, z = 0) {
    const ctx = this.ctx;
    ctx.fillStyle = C.shadow;
    ctx.beginPath();
    const s = Math.max(0.4, 1 - z / 80);
    ctx.ellipse(x, sy, 10 * s, 3 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  skier(id: string, pose: Pose, x: number, sy: number, flip: boolean) {
    const c = this.assets.manifest.characters[id];
    if (!c) return;
    this.sheetFrame(c.file, pose, x, sy, flip);
  }

  private sheetFrame(file: string, pose: Pose, x: number, sy: number, flip: boolean, scale = 1) {
    const ctx = this.ctx;
    const { w, h } = this.assets.manifest.frame;
    const i = Math.max(0, POSES.indexOf(pose));
    const img = this.assets.img(file);
    const dx = Math.round(x - (w * scale) / 2), dy = Math.round(sy - (h - 2) * scale);
    if (flip) {
      ctx.save();
      ctx.translate(dx + w * scale, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, i * w, 0, w, h, 0, 0, w * scale, h * scale);
      ctx.restore();
    } else ctx.drawImage(img, i * w, 0, w, h, dx, dy, w * scale, h * scale);
  }

  /** draws an object frame. anchor 'base' = (x, y) is the bottom centre; 'centre' = middle. */
  private obj(name: string, x: number, y: number, anchor: 'base' | 'centre', flip: boolean, scale = 1) {
    const f = this.assets.manifest.objects.frames[name];
    if (!f) return;
    const ctx = this.ctx;
    const img = this.assets.img(this.assets.manifest.objects.file);
    const w = f.w * scale, h = f.h * scale;
    const dx = Math.round(x - w / 2), dy = Math.round(anchor === 'base' ? y - h : y - h / 2);
    if (flip) {
      ctx.save();
      ctx.translate(dx + w, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, w, h);
      ctx.restore();
    } else ctx.drawImage(img, f.x, f.y, f.w, f.h, dx, dy, w, h);
  }

  private drawPrompts(g: Game) {
    const a = g.andy;
    const near = g.nearTarget();
    if (near && near.target && a.state === 'ski') {
      const t = near.target;
      const sy = this.sy(g, t.y) + (near.def.kind === 'lift' ? 40 : 14);
      const label = near.def.kind === 'help' || near.def.kind === 'lift' ? 'HOLD SPACE' : 'GRAB! SPACE';
      this.ctx.fillStyle = 'rgba(28,26,38,0.85)';
      this.ctx.fillRect(t.x - 36, sy - 8, 72, 18);
      this.ctx.fillStyle = C.good;
      this.ctx.fillRect(t.x - 34, sy + 6, 68 * Math.min(1, near.hold), 2);
      this.text(label, t.x, sy + 1, C.text, 14, 'center');
    }
    const phone = g.scrapes.find((s) => s.state === 'live' && s.def.kind === 'phone');
    if (phone) {
      const sy = this.sy(g, a.y) + 26;
      this.ctx.fillStyle = 'rgba(28,26,38,0.85)';
      this.ctx.fillRect(a.x - 62, sy - 8, 124, 18);
      this.ctx.fillStyle = C.good;
      this.ctx.fillRect(a.x - 60, sy + 6, 120 * Math.min(1, phone.still / 1.3), 2);
      this.text('STOP to answer (hold UP)', a.x, sy + 1, C.warn, 14, 'center');
    }
  }

  /** arrows at the screen edge pointing at scrapes you can't see yet */
  private drawPointers(g: Game) {
    for (const s of g.scrapes) {
      if (s.state !== 'live' || !s.target) continue;
      const t = s.target;
      const sy = this.sy(g, t.y);
      if (sy > 20 && sy < WORLD_H - 4) continue;
      const below = sy >= WORLD_H - 4;
      const x = Math.max(24, Math.min(WORLD_W - 24, t.x));
      const y = below ? WORLD_H - 20 : 20;
      const ctx = this.ctx;
      ctx.fillStyle = 'rgba(28,26,38,0.8)';
      ctx.fillRect(x - 22, y - 12, 44, 24);
      const port = this.assets.manifest.portraits[s.def.who];
      if (port) ctx.drawImage(this.assets.img(port), x - 20, y - 10, 20, 20);
      else if (s.def.item) this.obj(s.def.item, x - 10, y, 'centre', false);
      ctx.fillStyle = C.warn;
      ctx.beginPath();
      if (below) { ctx.moveTo(x + 4, y - 4); ctx.lineTo(x + 18, y - 4); ctx.lineTo(x + 11, y + 6); }
      else { ctx.moveTo(x + 4, y + 4); ctx.lineTo(x + 18, y + 4); ctx.lineTo(x + 11, y - 6); }
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------- HUD and panel

  private drawHud(g: Game) {
    const ctx = this.ctx;
    ctx.fillStyle = C.hud;
    ctx.fillRect(0, 0, VIEW_W, HUD_H);
    const mood = moodIndex(g.meters.anger);
    ctx.drawImage(this.assets.img(this.assets.manifest.portraits[MOODS[mood]]), 4, 4, 32, 32);
    this.meter(42, 7, 150, 'ANGER', g.meters.anger, C.anger, g.meters.anger > 75 && Math.floor(this.t * 4) % 2 === 0);
    this.meter(42, 23, 150, 'COLD', g.meters.cold, C.cold, g.meters.cold >= 100 && Math.floor(this.t * 4) % 2 === 0);

    const d = g.dayDef;
    ctx.fillStyle = GRADE[d.grade];
    ctx.fillRect(206, 9, 8, 8);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(205.5, 8.5, 9, 9);
    this.text(`${d.day.toUpperCase()}: ${d.run}`, 220, 13, C.text, 16);
    // progress down the run
    const px = 206, pw = 236;
    ctx.fillStyle = '#3a3650';
    ctx.fillRect(px, 27, pw, 4);
    ctx.fillStyle = GRADE[d.grade] === '#141418' ? '#888' : GRADE[d.grade];
    ctx.fillRect(px, 27, pw * g.progress, 4);
    ctx.fillStyle = '#fff';
    ctx.fillRect(px + pw * g.progress - 1, 24, 3, 10);
    this.text(`${g.metres(d.length - g.andy.y)}m to the bar`, px + pw + 8, 29, C.dim, 14);

    this.text(`${fmtTime(g.time)}`, 600, 13, g.time > d.par ? C.bad : C.text, 16);
    this.text(`par ${fmtTime(d.par)}`, 600, 29, C.dim, 14);
    this.text(`${g.score}`, 690, 13, C.warn, 18);
    this.text(`best ${Math.max(g.best, g.score)}`, 690, 29, C.dim, 14);
  }

  private meter(x: number, y: number, w: number, label: string, v: number, color: string, flash: boolean) {
    const ctx = this.ctx;
    ctx.fillStyle = '#3a3650';
    ctx.fillRect(x + 44, y, w - 44, 10);
    ctx.fillStyle = flash ? '#fff' : color;
    ctx.fillRect(x + 44, y, ((w - 44) * v) / 100, 10);
    this.text(label, x, y + 5, C.dim, 14);
    this.text(`${Math.round(v)}%`, x + w - 3, y + 5, C.text, 12, 'right');
  }

  private drawPanel(g: Game) {
    const ctx = this.ctx;
    ctx.fillStyle = C.panel;
    ctx.fillRect(PANEL_X, HUD_H, VIEW_W - PANEL_X, WORLD_H);
    this.text('SCRAPES', PANEL_X + 8, HUD_H + 12, C.warn, 16);
    let y = HUD_H + 24;
    const show = g.scrapes.filter((s) => s.state === 'live' || s.t < 2.5).slice(-5);
    if (!show.some((s) => s.state === 'live')) this.text('All quiet. For now.', PANEL_X + 8, y + 8, C.dim, 14);
    for (const s of show) {
      y = this.card(g, s, y) + 4;
      if (y > VIEW_H - 90) break;
    }
    // controls
    const cy = VIEW_H - 74;
    ctx.fillStyle = '#1c1a26';
    ctx.fillRect(PANEL_X, cy - 6, VIEW_W - PANEL_X, 80);
    const lines = ['LEFT/RIGHT  steer', 'DOWN  tuck (faster)', 'UP  snowplough', 'SPACE  jump / help', 'P pause   M mute'];
    lines.forEach((l, i) => this.text(l, PANEL_X + 8, cy + 4 + i * 14, C.dim, 14));
  }

  private card(g: Game, s: Scrape, y: number): number {
    const ctx = this.ctx;
    const x = PANEL_X + 4, w = VIEW_W - PANEL_X - 8, h = 52;
    ctx.fillStyle = s.state === 'done' ? '#24452c' : s.state === 'missed' ? '#4a2424' : C.card;
    ctx.fillRect(x, y, w, h);
    const port = this.assets.manifest.portraits[s.def.who];
    if (port) ctx.drawImage(this.assets.img(port), x + 3, y + 3, 28, 28);
    const lines = wrap(ctx, s.def.short, w - 40, `14px ${FONT}`);
    lines.slice(0, 2).forEach((l, i) => this.text(l, x + 36, y + 9 + i * 12, C.text, 14));
    this.text(NAMES[s.def.who] ?? '', x + 3, y + 40, C.dim, 12);
    if (s.state === 'done') this.text('SORTED', x + w - 4, y + 42, C.good, 14, 'right');
    else if (s.state === 'missed') this.text('MISSED', x + w - 4, y + 42, C.bad, 14, 'right');
    else if (s.timeMax) {
      const k = Math.max(0, s.timeLeft / s.timeMax);
      ctx.fillStyle = '#3a3650';
      ctx.fillRect(x + 70, y + 38, w - 74, 6);
      ctx.fillStyle = k < 0.3 ? C.bad : C.warn;
      ctx.fillRect(x + 70, y + 38, (w - 74) * k, 6);
    } else if (s.target) {
      const dy = s.target.y - g.andy.y;
      const dx = s.target.x - g.andy.x;
      const arrow = Math.abs(dx) < 30 ? '' : dx < 0 ? ' <' : ' >';
      this.text(dy > 0 ? `${g.metres(dy)}m${arrow}` : 'HERE!', x + w - 4, y + 42, dy > 0 ? C.warn : C.good, 14, 'right');
    }
    return y + h;
  }

  private drawToasts(g: Game) {
    const ctx = this.ctx;
    let y = 4;
    for (const t of [...g.toasts].reverse().slice(0, 2)) {
      const lines = wrap(ctx, t.text, WORLD_W - 110, `16px ${FONT}`);
      const h = Math.max(26, lines.length * 14 + 8);
      ctx.globalAlpha = Math.min(1, t.t * 2) * 0.95;
      ctx.fillStyle = t.good ? 'rgba(30,60,36,0.9)' : 'rgba(28,26,38,0.9)';
      ctx.fillRect(50, y, WORLD_W - 100, h);
      const port = t.who && this.assets.manifest.portraits[t.who];
      if (port) ctx.drawImage(this.assets.img(port), 53, y + 3, 20, 20);
      lines.forEach((l, i) => this.text(l, 78, y + 11 + i * 14, C.text, 16));
      ctx.globalAlpha = 1;
      y += h + 3;
    }
  }

  // ---------------------------------------------------------------- screens

  private drawTitle(g: Game) {
    const ctx = this.ctx;
    // a snowy slope with the lads lined up
    const sky = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    sky.addColorStop(0, '#2a4a8a');
    sky.addColorStop(0.45, '#8ab0e0');
    sky.addColorStop(0.46, '#f4f8ff');
    sky.addColorStop(1, '#dce6f4');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // mountains
    ctx.fillStyle = '#c8d8f0';
    ctx.beginPath();
    ctx.moveTo(0, 196);
    [[90, 110], [170, 160], [260, 70], [360, 150], [450, 90], [560, 170], [660, 80], [760, 140], [800, 120], [800, 196]].forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    for (const [x, y] of [[260, 70], [450, 90], [660, 80], [90, 110]]) {
      ctx.beginPath(); ctx.moveTo(x - 22, y + 24); ctx.lineTo(x, y); ctx.lineTo(x + 22, y + 24); ctx.fill();
    }
    this.text('ANGRY ANDY', VIEW_W / 2, 36, '#fff', 28, 'center', TITLE_FONT, '#1c1a26');
    this.text('ON THE SLOPES', VIEW_W / 2, 74, '#f0c020', 18, 'center', TITLE_FONT, '#1c1a26');
    this.text('A week in the Alps with the lads. What could possibly go wrong?', VIEW_W / 2, 104, '#fff', 18, 'center', FONT, '#1c1a26');

    const cast = ['steve', 'jimmy', 'plug', 'andy', 'kft', 'sid', 'rocker'];
    const poses: Pose[] = ['shout', 'stand', 'crash', 'stand', 'shout', 'sit', 'jump'];
    cast.forEach((id, i) => {
      const x = 100 + i * 100, y = 290;
      ctx.fillStyle = C.shadow;
      ctx.beginPath();
      ctx.ellipse(x, y, 22, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      const file = this.assets.manifest.characters[id].file;
      this.sheetFrame(file, poses[i], x, y, false, 2.4);
      this.text(id === 'andy' ? 'ANDY' : NAMES[id], x, y + 16, id === 'andy' ? '#e0483a' : '#1c1a26', 16, 'center');
    });
    const blink = Math.floor(this.t * 2) % 2 === 0;
    if (blink) this.text('Press SPACE or tap to start', VIEW_W / 2, 344, '#1c1a26', 20, 'center');
    this.text('Steer with LEFT/RIGHT. DOWN to tuck, UP to snowplough. SPACE jumps, and sorts out the lads when you are next to them.', VIEW_W / 2, 372, '#3a3650', 16, 'center');
    this.text('Get down six runs without Andy\'s anger hitting 100%.', VIEW_W / 2, 390, '#3a3650', 16, 'center');
    if (g.best) this.text(`Best score: ${g.best}`, VIEW_W / 2, 410, '#1f3f8a', 16, 'center');
  }

  private drawDayIntro(g: Game) {
    const d = g.dayDef;
    const intro = (phrases.dayIntro as Record<string, string>)[d.grade] ?? '';
    const gradeName = d.grade === 'offpiste' ? 'off-piste' : d.grade === 'race' ? 'the race' : `${d.grade} run`;
    this.modal([
      `${d.day.toUpperCase()}${g.week > 1 ? `  (week ${g.week})` : ''}`,
      d.run,
      `(${gradeName}, ${Math.round(d.length / 10)}m)`,
      '',
      intro,
      '',
      `Par time ${fmtTime(d.par)}. Tonight's bar: ${d.bar}.`,
      '',
      'Press SPACE to set off',
    ], 300, GRADE[d.grade]);
  }

  private drawDayEnd(g: Game) {
    const s = g.stats;
    const last = g.day >= DAYS.length - 1;
    this.modal([
      `MADE IT TO ${g.dayDef.bar.toUpperCase()}`,
      '',
      `Time ${fmtTime(s.time)} (par ${fmtTime(g.dayDef.par)})   time bonus +${s.timeBonus}`,
      `Scrapes sorted ${s.done}, missed ${s.missed}   Crashes ${s.crashes}`,
      `Gates ${s.gates}/${s.gatesSeen}   Big air ${s.air}   Hot chocolates ${s.cocoa}`,
      `Points today ${s.dayScore}   Total ${g.score}`,
      '',
      'APRES-SKI:',
      s.apres,
      '',
      last ? 'Press SPACE for the end of the holiday' : 'Press SPACE for tomorrow (half the anger carries over)',
    ], 300);
  }

  private drawGameOver(g: Game) {
    this.modal(['MELTDOWN!', '', g.meltdownLine, '', `"${phrases.catchphrases[0]}"`, '', `Made it to ${g.dayDef.day}. Score ${g.score}   Best ${g.best}`, '', 'Press SPACE to try again'], 280, C.bad);
  }

  private drawHolidayOver(g: Game) {
    this.modal(['HOLIDAY OVER!', '', 'Andy survived a whole week in the Alps with the lads.', 'Nobody died. Plug broke a ski. Sid is still asleep.', '', `Final score ${g.score}   Best ${g.best}`, '', 'Same again next year? Press SPACE (it gets harder)'], 280, C.good);
  }

  private modal(lines: string[], _h: number, accent = '#f0c020') {
    const ctx = this.ctx;
    let h = 44;
    lines.forEach((l, i) => { h += i === 0 ? 0 : !l ? 8 : wrap(ctx, l, 520, `18px ${FONT}`).length * 18; });
    const w = 560, x = (WORLD_W - w) / 2, y = HUD_H + Math.max(4, (WORLD_H - h) / 2);
    ctx.fillStyle = 'rgba(12,10,18,0.55)';
    ctx.fillRect(0, HUD_H, WORLD_W, WORLD_H);
    ctx.fillStyle = C.hud;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = accent;
    ctx.fillRect(x, y, w, 4);
    let ly = y + 26;
    lines.forEach((l, i) => {
      if (i === 0) { this.text(l, x + w / 2, ly, accent === '#141418' ? '#fff' : accent, 14, 'center', TITLE_FONT); ly += 24; return; }
      if (!l) { ly += 8; return; }
      for (const wl of wrap(ctx, l, w - 40, `18px ${FONT}`)) { this.text(wl, x + w / 2, ly, i === 1 ? '#fff' : C.text, i === 1 ? 22 : 18, 'center'); ly += 18; }
    });
  }

  private drawMute(muted: boolean) {
    const ctx = this.ctx;
    const r = MUTE_RECT;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = '#f2efe6';
    ctx.fillRect(r.x + 4, r.y + 7, 4, 6);
    ctx.beginPath();
    ctx.moveTo(r.x + 8, r.y + 7); ctx.lineTo(r.x + 13, r.y + 3); ctx.lineTo(r.x + 13, r.y + 17); ctx.lineTo(r.x + 8, r.y + 13);
    ctx.fill();
    if (muted) { ctx.fillStyle = C.bad; ctx.fillRect(r.x + 15, r.y + 9, 6, 2); }
    else { ctx.fillRect(r.x + 15, r.y + 6, 1, 8); ctx.fillRect(r.x + 18, r.y + 4, 1, 12); }
  }

  // ---------------------------------------------------------------- text

  private bubble(text: string, x: number, y: number, important: boolean, bg = '#ffffff') {
    const ctx = this.ctx;
    const lines = wrap(ctx, text, 150, `15px ${FONT}`);
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 10;
    const h = lines.length * 13 + 6;
    const bx = Math.round(Math.max(2, Math.min(WORLD_W - w - 2, x - w / 2)));
    const by = Math.round(y - h);
    ctx.fillStyle = important ? bg : 'rgba(255,255,255,0.85)';
    ctx.fillRect(bx, by, w, h);
    ctx.fillStyle = '#1c1a26';
    ctx.fillRect(bx, by + h, w, 1);
    ctx.fillRect(bx - 1, by, 1, h);
    ctx.fillRect(bx + w, by, 1, h);
    ctx.fillRect(bx, by - 1, w, 1);
    ctx.fillStyle = important ? bg : 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(x - 3, by + h); ctx.lineTo(x + 3, by + h); ctx.lineTo(x, by + h + 5);
    ctx.fill();
    lines.forEach((l, i) => this.text(l, bx + 5, by + 9 + i * 13, '#1c1a26', 15));
  }

  private outlinedText(t: string, x: number, y: number, color: string, size: number) {
    this.text(t, x, y, color, size, 'center', FONT, '#1c1a26');
  }

  private text(t: string, x: number, y: number, color: string, size: number, align: CanvasTextAlign = 'left', font = FONT, outline?: string) {
    const ctx = this.ctx;
    ctx.font = `${size}px ${font}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (outline) {
      ctx.fillStyle = outline;
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [2, 2]]) ctx.fillText(t, x + dx, y + dy);
    }
    ctx.fillStyle = color;
    ctx.fillText(t, x, y);
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, font: string): string[] {
  ctx.font = font;
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > max && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function hash(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

