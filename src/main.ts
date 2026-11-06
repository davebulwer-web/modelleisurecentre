import { Assets } from './core/assets';
import { Input } from './core/input';
import { Audio } from './core/audio';
import { Game, inRect } from './game/game';
import { Renderer, MUTE_RECT } from './render/renderer';

async function boot() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const loading = document.getElementById('loading')!;
  const assets = new Assets();
  try {
    await Promise.all([
      assets.load((d, t) => (loading.textContent = `Opening the leisure centre... ${d}/${t}`)),
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

  // handy for testing from the console: __andy.game.clock = 280
  (window as unknown as { __andy: unknown }).__andy = { game, input };

  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    input.update();

    for (const c of input.clicks) if (inRect(c, MUTE_RECT)) audio.toggleMute();
    const menu = game.screen === 'title' || game.screen === 'dayEnd' || game.screen === 'gameover';
    if (menu) {
      const go = input.took('action') || input.clicks.some((c) => !inRect(c, MUTE_RECT));
      if (input.took('mute')) audio.toggleMute();
      if (go) game.screen === 'dayEnd' ? game.nextDay() : game.newGame();
    } else game.update(dt, input);

    renderer.draw(game, input, audio, dt);
    input.endFrame();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void boot();
