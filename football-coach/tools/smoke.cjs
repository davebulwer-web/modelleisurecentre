// Headless browser smoke test: starts Vite, plays a little, saves screenshots.
//   npm run smoke            (screenshots go to smoke-output/)
// Uses the Playwright + Chromium already installed on the machine.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(require('child_process').execSync('npm root -g').toString().trim(), 'playwright'))); }

const OUT = process.argv[2] || path.join(__dirname, '..', 'smoke-output');
const PORT = 5199;

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
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, '1-title.png') });

    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(900);
    await page.keyboard.up('ArrowDown');
    await page.screenshot({ path: path.join(OUT, '2-start.png') });

    // jump the clock forward so lots is going on
    await page.evaluate(() => { const g = window.__andy.game; g.clock = 120; for (const k of ['drill', 'dog', 'trouble', 'trouble', 'changing', 'ball', 'parent', 'injury', 'net', 'balls', 'alistair', 'lee', 'assistant', 'poo']) g.spawn(k); g.meters.anger = 55; });
    await page.waitForTimeout(9000);
    await page.screenshot({ path: path.join(OUT, '3-busy.png') });
    const want = ['drill', 'dog', 'trouble', 'changing', 'ball', 'parent', 'injury', 'net', 'balls', 'alistair', 'lee', 'assistant', 'poo'];
    const have = await page.evaluate(() => window.__andy.game.tasks.map((t) => t.type));
    for (const k of want) if (!have.includes(k)) errors.push(`no ${k} task`);

    // deal with each live task by standing on it and holding E
    for (let i = 0; i < 24; i++) {
      const left = await page.evaluate(() => {
        const g = window.__andy.game;
        g.meters.anger = 30; g.meters.bladder = g.meters.thirst = 0;
        const t = g.tasks.find((k) => k.target() && !['signin', 'neighbour', 'phone', 'chairman'].includes(k.type));
        if (!t) return 0;
        // keep Andy on top of it (dogs and cyclists move)
        window.__follow && clearInterval(window.__follow);
        window.__follow = setInterval(() => { const p = t.target(); if (p) { g.andy.x = p.x; g.andy.y = p.y + 6; } }, 16);
        for (const k of g.tasks) k.timeLeft = Math.max(k.timeLeft, 20);
        return g.tasks.length;
      });
      if (!left) break;
      await page.keyboard.down('e');
      await page.waitForTimeout(3000);
      await page.keyboard.up('e');
      await page.evaluate(() => clearInterval(window.__follow));
      if (i === 1) await page.screenshot({ path: path.join(OUT, '3b-coaching.png') });
    }
    const stuck = await page.evaluate(() => window.__andy.game.tasks.filter((t) => !['signin', 'neighbour', 'phone', 'chairman'].includes(t.type)).map((t) => t.type));
    if (stuck.length) errors.push(`could not finish: ${stuck.join(', ')}`);
    if (await page.evaluate(() => window.__andy.game.stats.done) < 8) errors.push('too few tasks done');

    // a registration card at the sign-in table
    await page.evaluate(() => { const g = window.__andy.game; g.tasks = []; g.spawn('signin'); });
    await page.waitForFunction(() => { const t = window.__andy.game.tasks.find((k) => k.type === 'signin'); return t && t.target(); }, null, { timeout: 20000 });
    await page.evaluate(() => { const g = window.__andy.game; const p = g.map.point('signinSpot'); g.andy.x = p.x - 16; g.andy.y = p.y + 4; });
    await page.keyboard.down('e');
    await page.waitForTimeout(900);
    await page.keyboard.up('e');
    await page.screenshot({ path: path.join(OUT, '4-signin.png') });
    if (!(await page.evaluate(() => window.__andy.game.modal?.kind === 'member'))) errors.push('sign-in check did not open');
    await page.keyboard.press('a');

    // a neighbour at the gate
    await page.waitForTimeout(3000);
    await page.evaluate(() => { const g = window.__andy.game; g.meters.anger = 30; g.tasks = []; g.spawn('neighbour'); });
    await page.waitForFunction(() => { const t = window.__andy.game.tasks.find((k) => k.type === 'neighbour'); return t && t.target(); }, null, { timeout: 20000 });
    await page.evaluate(() => { const g = window.__andy.game; const p = g.tasks[0].target(); g.andy.x = p.x; g.andy.y = p.y + 28; });
    await page.keyboard.down('e');
    await page.waitForTimeout(900);
    await page.keyboard.up('e');
    await page.screenshot({ path: path.join(OUT, '5-neighbour.png') });
    if (!(await page.evaluate(() => window.__andy.game.modal?.complaint))) errors.push('neighbour complaint did not open');
    await page.keyboard.press('d');

    // the parents' WhatsApp group on the mobile
    await page.evaluate(() => { const g = window.__andy.game; g.tasks = []; g.defs.phone.whatsappChance = 1; g.defs.phone.mobileChance = 1; g.spawn('phone'); g.defs.phone.whatsappChance = 0.35; g.defs.phone.mobileChance = 0.6; });
    await page.waitForTimeout(500);
    await page.keyboard.down('e');
    await page.waitForTimeout(700);
    await page.keyboard.up('e');
    await page.screenshot({ path: path.join(OUT, '6-whatsapp.png') });
    if (!(await page.evaluate(() => window.__andy.game.modal?.caller?.whatsapp))) errors.push('WhatsApp did not open');
    await page.keyboard.press('a');

    // the Club Chairman
    await page.evaluate(() => { const g = window.__andy.game; g.tasks = []; g.spawn('chairman'); const p = g.map.point('meetingSpot'); g.andy.x = p.x; g.andy.y = p.y; });
    await page.keyboard.down('e');
    await page.waitForTimeout(800);
    await page.keyboard.up('e');
    await page.screenshot({ path: path.join(OUT, '7-chairman.png') });
    if (!(await page.evaluate(() => window.__andy.game.modal?.kind === 'manager'))) errors.push('meeting did not start');
    await page.evaluate(() => { window.__andy.game.meters.anger = 100; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, '8-meltdown.png') });
    const screen = await page.evaluate(() => window.__andy.game.screen);
    if (screen !== 'gameover') errors.push(`expected gameover, got ${screen}`);
  } finally {
    await browser.close();
    vite.kill();
  }
  if (errors.length) {
    console.error('Errors:\n' + errors.join('\n'));
    process.exit(1);
  }
  console.log(`Smoke test passed. Screenshots in ${OUT}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
