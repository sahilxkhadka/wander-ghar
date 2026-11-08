// README screenshots in docs/screenshots/: desktop stops, the closing section and a phone strip.
// usage: npm run dev (port 5174), then: node scripts/screenshots.mjs [--url http://localhost:5174/]
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const i = process.argv.indexOf('--url');
const base = i > -1 ? process.argv[i + 1] : 'http://localhost:5174/';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'docs/screenshots');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ready = (pg) => pg.waitForFunction(() => window.__TOUR__?.ready, null, { timeout: 120000 });

// desktop: one frame per stop (progress is frozen with ?p=), captions included
const desktop = [['hero', 0], ['lane', 0.55], ['gate', 1], ['garden', 2], ['rooftop', 4], ['night', 5], ['finale', 6]];
const pg = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
for (const [name, p] of desktop) {
  await pg.goto(`${base}?q=high&noadapt&p=${p}`);
  await ready(pg);
  await pg.waitForTimeout(1600);
  await pg.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 78 });
  console.log('wrote', name);
}
// the closing section: real scroll to the bottom of the page
await pg.goto(`${base}?q=high&noadapt`);
await ready(pg);
await pg.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await pg.waitForTimeout(3000);
await pg.screenshot({ path: path.join(out, 'outro.jpg'), type: 'jpeg', quality: 78 });
console.log('wrote outro');
await pg.close();

// phone: three stops side by side on one card
const phoneShots = [];
const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 2 });
const ph = await ctx.newPage();
for (const p of [0, 1, 5]) {
  await ph.goto(`${base}?noadapt&p=${p}`);
  await ready(ph);
  await ph.waitForTimeout(1600);
  phoneShots.push((await ph.screenshot({ type: 'png' })).toString('base64'));
}
await ctx.close();
const strip = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 });
await strip.setContent(`<body style="margin:0;height:860px;display:flex;gap:56px;align-items:center;justify-content:center;background:radial-gradient(90% 70% at 50% 100%,#2a1d16,#0b0d14 70%)">
  ${phoneShots.map((b) => `<img src="data:image/png;base64,${b}" style="height:660px;border-radius:38px;border:10px solid #1b1c22;box-shadow:0 30px 70px rgba(0,0,0,.55)">`).join('')}
</body>`);
await strip.waitForTimeout(300);
await strip.screenshot({ path: path.join(out, 'mobile.jpg'), type: 'jpeg', quality: 80 });
console.log('wrote mobile');
await browser.close();
