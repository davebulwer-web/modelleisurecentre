import { Assets } from './core/assets';
import { Input } from './core/input';
import { Audio } from './core/audio';
import { Game } from './game/game';
import { Renderer, MUTE_RECT } from './render/renderer';

const inRect = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h;

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const loading = document.getElementById('loading')!;
  const assets = new Assets();
  try {
    await Promise.all([
      assets.load((d, t) => (loading.textContent = `Waxing the skis... ${d}/${t}`)),
      document.fonts?.load('12px "Press Start 2P"').catch(() => undefined),
      document.fonts?.load('12px "VT323"').catch(() => undefined),
    ]);
  } catch (e) {
    loading.textContent = String(e);
    return;
  }
  loading.remove();

  const seedParam = new URLSearchParams(location.search).get('seed');
  const audio = new Audio();
  const game = new Game(audio, seedParam ? Number(seedParam) : Date.now());
  const renderer = new Renderer(canvas, assets);
  const input = new Input(canvas, (x, y) => renderer.toLogical(x, y));
  const unlock = () => audio.unlock();
  window.addEventListener('keydown', unlock);
  window.addEventListener('pointerdown', unlock);

  // handy for testing from the console: __andy.game.spawnScrape('plug_ski')
  (window as unknown as { __andy: unknown }).__andy = { game, input };

  let last = performance.now();
  let menuDelay = 0;
  const frame = (now: number) => {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    input.update();

    for (const c of input.clicks) if (inRect(c, MUTE_RECT)) audio.toggleMute();
    if (input.took('mute')) audio.toggleMute();
    const menu = game.screen !== 'play';
    if (menu) {
      menuDelay = Math.max(0, menuDelay - dt);
      const go = input.took('action') || input.clicks.some((c) => !inRect(c, MUTE_RECT));
      if (go && menuDelay <= 0) {
        menuDelay = 0.4;
        if (game.screen === 'title' || game.screen === 'gameover') game.newGame();
        else if (game.screen === 'dayIntro') game.begin();
        else if (game.screen === 'dayEnd') game.nextDay();
        else if (game.screen === 'holidayOver') game.nextWeek();
      }
    } else {
      // on a touch screen, a tap on the world counts as the action button
      if (input.clicks.some((c) => !inRect(c, MUTE_RECT) && c.x < 640)) input.tap();
      game.update(dt, input);
      if (game.screen !== 'play') menuDelay = 0.8;
    }

    renderer.draw(game, audio, dt);
    input.endFrame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void boot();
