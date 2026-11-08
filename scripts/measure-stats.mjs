// Optimization-pass evidence: draw calls, triangles and fps through the capture contract.
// usage: node scripts/measure-stats.mjs <pass> <out.json>
import { chromium } from 'playwright';
import fs from 'node:fs';
const [pass = 'optimization-pass', out = 'work/renders/stats.json'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
await p.goto(`http://localhost:5174/viewer.html?ui=0&pass=${pass}`);
await p.waitForFunction(() => window.__IMG2THREEJS_READY__ === true, null, { timeout: 120000 });
const r = {};
for (const view of ['reference', 'aerial']) {
  await p.evaluate((v) => window.__IMG2THREEJS_CAPTURE__.setCamera({ preset: v }), view);
  r[view] = await p.evaluate(() => window.__IMG2THREEJS_CAPTURE__.stats());
}
fs.writeFileSync(out, JSON.stringify({ pass, viewport: [1280, 800], ...r }, null, 1));
console.log(JSON.stringify(r));
await b.close();
