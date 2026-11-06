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
    await page.evaluate(() => { const g = window.__andy.game; g.clock = 120; for (const k of ['trouble', 'trouble', 'spill', 'spill', 'pins', 'treadmill', 'lifeguard', 'vending', 'shower', 'alistair']) g.spawn(k); g.meters.anger = 55; });
    await page.waitForTimeout(9000);
    await page.screenshot({ path: path.join(OUT, '3-busy.png') });
    const want = ['trouble', 'spill', 'pins', 'treadmill', 'lifeguard', 'vending', 'shower', 'alistair'];
    const have = await page.evaluate(() => window.__andy.game.tasks.map((t) => t.type));
    for (const k of want) if (!have.includes(k)) errors.push(`no ${k} task`);

    // deal with each live task by standing on it and holding E
    for (let i = 0; i < 12; i++) {
      const left = await page.evaluate(() => {
        const g = window.__andy.game;
        g.meters.anger = 30; g.meters.bladder = g.meters.thirst = 0;
        const t = g.tasks.find((k) => k.target() && !['membership', 'complaint', 'phone', 'manager'].includes(k.type));
        if (!t) return 0;
        const p = t.target(); g.andy.x = p.x; g.andy.y = p.y + 6;
        for (const k of g.tasks) k.timeLeft = Math.max(k.timeLeft, 20);
        return g.tasks.length;
      });
      if (!left) break;
      await page.keyboard.down('e');
      await page.waitForTimeout(3600);
      await page.keyboard.up('e');
    }
    const stuck = await page.evaluate(() => window.__andy.game.tasks.filter((t) => !['membership', 'complaint', 'phone', 'manager'].includes(t.type)).map((t) => t.type));
    if (stuck.length) errors.push(`could not finish: ${stuck.join(', ')}`);
    if (await page.evaluate(() => window.__andy.game.stats.done) < 8) errors.push('too few tasks done');

    // a membership card at reception
    await page.evaluate(() => { const g = window.__andy.game; g.tasks = []; g.spawn('membership'); });
    await page.waitForFunction(() => { const t = window.__andy.game.tasks.find((k) => k.type === 'membership'); return t && t.target(); }, null, { timeout: 20000 });
    await page.evaluate(() => { const g = window.__andy.game; const p = g.map.point('counterCustomer'); g.andy.x = p.x; g.andy.y = p.y + 14; });
    await page.keyboard.down('e');
    await page.waitForTimeout(900);
    await page.keyboard.up('e');
    await page.screenshot({ path: path.join(OUT, '4-membership.png') });
    if (!(await page.evaluate(() => window.__andy.game.modal?.kind === 'member'))) errors.push('membership check did not open');
    await page.keyboard.press('a');

    // a complaint
    await page.waitForTimeout(3000);
    await page.evaluate(() => { const g = window.__andy.game; g.meters.anger = 30; g.tasks = []; g.spawn('complaint'); });
    await page.waitForFunction(() => { const t = window.__andy.game.tasks.find((k) => k.type === 'complaint'); return t && t.target(); }, null, { timeout: 20000 });
    await page.evaluate(() => { const g = window.__andy.game; const p = g.map.point('counterCustomer'); g.andy.x = p.x; g.andy.y = p.y + 14; });
    await page.keyboard.down('e');
    await page.waitForTimeout(900);
    await page.keyboard.up('e');
    await page.screenshot({ path: path.join(OUT, '5-complaint.png') });
    if (!(await page.evaluate(() => window.__andy.game.modal?.complaint))) errors.push('complaint did not open');
    await page.keyboard.press('d');

    // a cold call on the mobile
    await page.evaluate(() => { const g = window.__andy.game; g.tasks = []; g.defs.phone.coldCallChance = 1; g.defs.phone.mobileChance = 1; g.spawn('phone'); g.defs.phone.coldCallChance = 0.3; g.defs.phone.mobileChance = 0.5; });
    await page.keyboard.down('e');
    await page.waitForTimeout(700);
    await page.keyboard.up('e');
    await page.screenshot({ path: path.join(OUT, '6-coldcall.png') });
    if (!(await page.evaluate(() => window.__andy.game.modal?.caller?.cold))) errors.push('cold call did not open');
    await page.keyboard.press('a');

    // the Area Manager
    await page.evaluate(() => { const g = window.__andy.game; g.tasks = []; g.spawn('manager'); const p = g.map.seat('manager'); g.andy.x = p.x; g.andy.y = p.y; });
    await page.keyboard.down('e');
    await page.waitForTimeout(800);
    await page.keyboard.up('e');
    await page.screenshot({ path: path.join(OUT, '7-manager.png') });
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
