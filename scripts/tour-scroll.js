// Scroll smoothness check. Run in the page: agent-browser eval "$(cat scripts/tour-scroll.js)"
// Native-style scroll (what a touch fling produces: scroll events without wheel), page top to bottom
// over 14 s, recording frame times and per-frame camera travel to catch jumps.
(async () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  const ft = [], step = [];
  let last = performance.now(), prev = __TOUR__.camera().pos;
  const t0 = performance.now(), D = 14000;
  await new Promise((done) => {
    (function f() {
      const now = performance.now();
      ft.push(now - last); last = now;
      const u = Math.min(1, (now - t0) / D);
      window.scrollTo(0, max * (0.5 - 0.5 * Math.cos(Math.PI * u)));
      const c = __TOUR__.camera().pos;
      step.push(Math.hypot(c[0] - prev[0], c[1] - prev[1], c[2] - prev[2])); prev = c;
      if (u < 1) requestAnimationFrame(f); else setTimeout(done, 2500);
    })();
  });
  const s = ft.slice(3).sort((a, b) => a - b), q = (p) => s[Math.floor(s.length * p)].toFixed(1);
  const raw = step.slice(3), mi = raw.indexOf(Math.max(...raw)); window.__around = raw.slice(mi - 4, mi + 5).map((x) => +x.toFixed(2));
  const st = raw.slice().sort((a, b) => a - b);
  return JSON.stringify({ frames: s.length, p50: q(0.5), p95: q(0.95), max: s[s.length - 1].toFixed(1), over33: s.filter((x) => x > 33).length,
    camStepMedian: st[Math.floor(st.length / 2)].toFixed(3), camStepMax: st[st.length - 1].toFixed(3), endProgress: __TOUR__.progress().toFixed(2), around: window.__around });
})()
