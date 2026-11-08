// Action-ready evidence: per-part action profiles, gate hinge toggle, click-to-pick and explode.
// usage: node scripts/verify-actions.mjs [pass]  -> work/renders/actions.json + work/renders/explode.png
import { chromium } from 'playwright';
import fs from 'node:fs';
const pass = process.argv[2] ?? 'optimization-pass';
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 750, height: 999 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(`http://localhost:5174/viewer.html?ui=0&pass=${pass}`);
await p.waitForFunction(() => window.__IMG2THREEJS_READY__ === true, null, { timeout: 120000 });
const cap = (fn, arg) => p.evaluate(fn, arg);
const actions = await cap(() => window.__IMG2THREEJS_CAPTURE__.actions());
const closedY = await cap(() => window.__IMG2THREEJS_CAPTURE__.toggle('gate'));
const reopenedY = await cap(() => window.__IMG2THREEJS_CAPTURE__.toggle('gate'));
// click the facade above the balcony in the reference view and read the pick label
const canvas = await p.locator('#frame canvas').boundingBox();
const picks = [];
for (const [fx, fy] of [[0.55, 0.22], [0.5, 0.78], [0.3, 0.33]]) {
  await p.mouse.click(canvas.x + canvas.width * fx, canvas.y + canvas.height * fy);
  await p.waitForTimeout(100);
  picks.push({ at: [fx, fy], label: await p.locator('#pick').innerText().catch(() => '') });
}
await cap(() => window.__IMG2THREEJS_CAPTURE__.setState({ explode: true }));
await cap(() => window.__IMG2THREEJS_CAPTURE__.setCamera({ preset: 'aerial' }));
await p.locator('#frame canvas').screenshot({ path: 'work/renders/explode.png' });
const out = {
  pass, errors,
  actionProfiles: actions.length,
  withCollider: actions.filter((a) => a.action.collider).length,
  withSockets: actions.filter((a) => a.action.sockets?.length).map((a) => a.id),
  fractureGroups: [...new Set(actions.map((a) => a.action.destruction?.fractureGroup).filter(Boolean))],
  gateToggle: { closedY, reopenedY },
  picks,
  actions,
};
fs.writeFileSync('work/renders/actions.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, actions: undefined }));
await b.close();
