// Framing check for every chapter's 3D text. Run in the page: agent-browser eval "$(cat scripts/tour-check.js)"
(async () => {
  const T = window.__TOUR__;
  const ids = [['name'], ['welcome'], ['garden'], ['balcony'], ['rooftop'], ['tihar'], ['name']];
  const out = [];
  const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
  for (let i = 0; i < ids.length; i++) {
    T.setProgress(i);
    for (let k = 0; k < 4; k++) await raf();
    for (const id of ids[i]) {
      const r = T.inspectText(id);
      // flag text that leaves the frame, hides behind the model or runs under the caption card
      const c = document.querySelectorAll('.card')[i].getBoundingClientRect();
      const cx0 = c.left / innerWidth, cx1 = c.right / innerWidth, cy0 = c.top / innerHeight, cy1 = c.bottom / innerHeight;
      const underCard = r && r.maxY > cy0 && r.minY < cy1 && r.minX < cx1 && r.maxX > cx0;
      const bad = !r || r.minX < 0.02 || r.maxX > 0.98 || r.minY < 0.06 || r.maxY > 0.98 || r.visible < 0.9 || underCard;
      out.push(`${i} ${id} ${bad ? 'FAIL' : 'ok'}${underCard ? ' (card)' : ''} ${JSON.stringify(r)} cardTop=${cy0.toFixed(2)}`);
    }
  }
  // opening view: the whole house must be in frame
  T.setProgress(0);
  for (let k = 0; k < 4; k++) await raf();
  const h = T.houseBounds();
  const hb = h.minX < 0 || h.maxX > 1 || h.minY < 0 || h.maxY > 1;
  out.push(`0 house ${hb ? 'FAIL' : 'ok'} ${JSON.stringify(h)}`);
  T.release();
  return out.join('\n');
})()
