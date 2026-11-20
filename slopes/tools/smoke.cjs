// Headless browser smoke test: starts Vite, skis a little, saves screenshots.
//   npm run smoke            (screenshots go to smoke-output/)
// Uses the Playwright + Chromium already installed on the machine.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }

const OUT = process.argv[2] || path.join(__dirname, '..', 'smoke-output');
const PORT = 5198;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = spawn(process.execPath, [path.join(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
  await new Promise((res, rej) => {
    vite.stdout.on('data', (d) => d.toString().includes('Local') && res());
    vite.on('exit', () => rej(new Error('vite exited')));
    setTimeout(() => rej(new Error('vite did not start')), 20000);
  });
  const browser = await chromium.launch();
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 680 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text()) && errors.push(m.text()));
    await page.goto(`http://localhost:${PORT}/?seed=4`);
    await page.waitForFunction(() => window.__andy, null, { timeout: 15000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, '1-title.png') });

    await page.keyboard.press('Space');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, '2-day-intro.png') });
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(1800);
    await page.keyboard.up('ArrowDown');
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(250);
    await page.keyboard.up('ArrowRight');
    await page.screenshot({ path: path.join(OUT, '3-skiing.png') });

    // set off every kind of scrape and let it play out a bit
    await page.evaluate(() => {
      const g = window.__andy.game;
      g.andy.invuln = 99;
      for (const id of ['plug_fallen', 'jimmy_snowball', 'plug_ski']) g.spawnScrape(id);
    });
    await page.waitForTimeout(2600);
    await page.screenshot({ path: path.join(OUT, '4-scrapes.png') });

    // sort each one out by putting Andy on it and holding Space
    const kinds = await page.evaluate(() => window.__andy.game.scrapes.map((s) => s.def.id));
    for (const id of ['sid_lift', 'steve_selfie', 'steve_instructor', 'rocker_guitar', 'kft_map', 'leeds', 'lee', 'chairman']) kinds.push(id);
    for (const id of kinds) {
      const ok = await page.evaluate((id) => {
        const g = window.__andy.game;
        g.meters.anger = 30;
        let s = g.scrapes.find((k) => k.def.id === id && k.state === 'live');
        if (!s) s = g.spawnScrape(id);
        window.__follow && clearInterval(window.__follow);
        window.__follow = setInterval(() => {
          const t = s.target;
          g.andy.invuln = 99;
          if (s.def.kind === 'phone') g.andy.v = 0;
          if (t) { g.andy.x = t.x; g.andy.y = t.y - (s.def.kind === 'lift' ? 30 : 2); g.andy.state = 'ski'; }
        }, 16);
        return true;
      }, id);
      if (!ok) continue;
      await page.keyboard.down('Space');
      if (id === 'steve_instructor' || id === 'leeds') await page.screenshot({ path: path.join(OUT, `5-${id}.png`) });
      await page.waitForTimeout(id === 'chairman' ? 1800 : 1100);
      await page.keyboard.up('Space');
      const state = await page.evaluate((id) => window.__andy.game.scrapes.find((k) => k.def.id === id)?.state, id);
      if (state !== 'done') errors.push(`${id} was not sorted (${state})`);
    }
    await page.evaluate(() => clearInterval(window.__follow));
    await page.screenshot({ path: path.join(OUT, '6-sorted.png') });

    // a ramp
    await page.evaluate(() => { const g = window.__andy.game; g.andy.invuln = 0; g.andy.z = 30; g.andy.vz = 120; });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, '7-air.png') });

    // skip to the finish
    await page.evaluate(() => { const g = window.__andy.game; g.andy.invuln = 99; g.andy.y = g.dayDef.length - 250; g.andy.x = g.piste.centre(g.andy.y); g.andy.h = 0; g.scrapes = []; });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, '8-finish.png') });
    await page.waitForFunction(() => window.__andy.game.screen === 'dayEnd', null, { timeout: 15000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '9-day-end.png') });

    // meltdown
    await page.waitForTimeout(900);
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.__andy.game.meters.anger = 100; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '10-meltdown.png') });

    // phone sized
    const phone = await browser.newPage({ viewport: { width: 740, height: 360 }, hasTouch: true, isMobile: true });
    phone.on('pageerror', (e) => errors.push(String(e)));
    await phone.goto(`http://localhost:${PORT}/?seed=9`);
    await phone.waitForFunction(() => window.__andy, null, { timeout: 15000 });
    await phone.touchscreen.tap(300, 200);
    await phone.waitForTimeout(600);
    await phone.touchscreen.tap(300, 200);
    await phone.waitForTimeout(2500);
    await phone.screenshot({ path: path.join(OUT, '11-phone.png') });
  } finally {
    await browser.close();
    vite.kill();
  }
  if (errors.length) {
    console.error('Smoke test found problems:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log(`Smoke test OK. Screenshots in ${OUT}`);
})().catch((e) => { console.error(e); process.exit(1); });
