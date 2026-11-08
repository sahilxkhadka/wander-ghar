// Deterministic browser capture through the page's window.__IMG2THREEJS_CAPTURE__ contract.
// usage: node scripts/capture.mjs --out work/renders/<pass> --pass <pass> --views reference,aerial [--mode night] [--lights 1]
//        node scripts/capture.mjs --manifest work/parts.json
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1']);
  return acc;
}, []));
const base = args.url ?? 'http://localhost:5174/viewer.html';
const views = (args.views ?? 'reference').split(',');
const W = Number(args.w ?? 750), H = Number(args.h ?? 999);

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('pageerror', e.message));
const q = new URLSearchParams({ ui: '0', view: 'reference', pass: args.pass ?? 'optimization-pass', mode: args.mode ?? 'night', lights: args.lights ?? '1' });
await page.goto(`${base}?${q}`);
await page.waitForFunction(() => window.__IMG2THREEJS_READY__ === true, null, { timeout: 120000 });

if (args.manifest) {
  const m = await page.evaluate(() => window.__IMG2THREEJS_CAPTURE__.manifest());
  fs.mkdirSync(path.dirname(args.manifest), { recursive: true });
  fs.writeFileSync(args.manifest, JSON.stringify(m, null, 2));
  console.log('manifest', args.manifest, m.parts.length, 'parts');
}
if (args.out) {
  fs.mkdirSync(args.out, { recursive: true });
  for (const v of views) {
    await page.evaluate(async (s) => {
      await window.__IMG2THREEJS_CAPTURE__.setState({ explode: s.explode, matte: s.matte });
      await window.__IMG2THREEJS_CAPTURE__.setCamera({ preset: s.view });
    }, { view: v, explode: args.explode === '1', matte: args.matte === '1' });
    await page.waitForTimeout(150);
    const file = path.join(args.out, `${v}${args.suffix ?? ''}.png`);
    await page.locator('#frame canvas').screenshot({ path: file });
    console.log('wrote', file);
  }
}
await browser.close();
