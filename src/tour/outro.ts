/**
 * The closing section below the tour: a marigold garland, a faint rangoli behind the text and a
 * row of flickering diyas, all drawn as inline SVG so they stay crisp and cost no requests.
 * Content fades up once it scrolls into view.
 */
const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** A swag of marigold heads hanging between two tie points, with short drops at both ends. */
function garland(host: Element) {
  const W = 640, H = 92;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', class: 'garland' });
  const cols = ['#ff8a10', '#ffb000', '#e8601a'];
  const n = 34;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = 20 + t * (W - 40);
    const y = 14 + 52 * 4 * t * (1 - t);
    svg.append(el('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 8.5, fill: cols[i % 3] }));
    svg.append(el('circle', { cx: (x - 2).toFixed(1), cy: (y - 2.5).toFixed(1), r: 3, fill: '#ffd67a', opacity: 0.55 }));
  }
  for (const x of [20, W - 20]) {
    for (let k = 1; k <= 3; k++) svg.append(el('circle', { cx: x, cy: 14 + k * 15, r: 7, fill: cols[k % 3] }));
    svg.append(el('path', { d: `M${x - 6} ${14 + 3 * 15 + 9} l6 10 l6 -10 z`, fill: '#3f7a2e' }));
  }
  host.append(svg);
}

/** Eight-fold rangoli of petals and dots, drawn very faintly behind the message. */
function rangoli(host: Element) {
  const svg = el('svg', { viewBox: '-100 -100 200 200', 'aria-hidden': 'true', class: 'rangoli' });
  const petal = (r: number, len: number, w: number, fill: string, rot: number) =>
    el('path', { d: `M0 ${-r} C ${w} ${-r - len * 0.4}, ${w} ${-r - len * 0.8}, 0 ${-r - len} C ${-w} ${-r - len * 0.8}, ${-w} ${-r - len * 0.4}, 0 ${-r} Z`, fill, transform: `rotate(${rot})` });
  for (let i = 0; i < 16; i++) svg.append(petal(46, 44, 14, i % 2 ? '#e8601a' : '#f2c46a', i * 22.5));
  for (let i = 0; i < 8; i++) svg.append(petal(20, 28, 11, '#c2185b', i * 45 + 22.5));
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    svg.append(el('circle', { cx: (Math.cos(a) * 96).toFixed(1), cy: (Math.sin(a) * 96).toFixed(1), r: 2.6, fill: '#f6efe4' }));
  }
  svg.append(el('circle', { cx: 0, cy: 0, r: 16, fill: '#ffb000' }));
  svg.append(el('circle', { cx: 0, cy: 0, r: 7, fill: '#5e1420' }));
  host.append(svg);
}

/** A clay diya with a flickering flame (the flicker is CSS, see .diya in index.html). */
function diya(host: Element) {
  const svg = el('svg', { viewBox: '0 0 60 60', 'aria-hidden': 'true', class: 'diya' });
  svg.append(el('ellipse', { cx: 30, cy: 26, rx: 14, ry: 14, fill: 'url(#diya-glow)' }));
  svg.append(el('path', { class: 'flame', d: 'M30 12 C 35 20, 35 27, 30 31 C 25 27, 25 20, 30 12 Z', fill: '#ffc24d' }));
  svg.append(el('path', { class: 'flame', d: 'M30 19 C 32.5 24, 32.5 28, 30 30.5 C 27.5 28, 27.5 24, 30 19 Z', fill: '#fff3c4' }));
  svg.append(el('path', { d: 'M8 34 Q 30 33 52 34 Q 49 50 30 51 Q 11 50 8 34 Z', fill: '#a4532d' }));
  svg.append(el('path', { d: 'M8 34 Q 30 39 52 34', fill: 'none', stroke: '#e0ac55', 'stroke-width': 1.6 }));
  svg.append(el('path', { d: 'M14 42 Q 30 46 46 42', fill: 'none', stroke: '#e0ac55', 'stroke-width': 1, opacity: 0.7 }));
  host.append(svg);
}

export function initOutro() {
  const root = document.getElementById('outro');
  if (!root) return;
  // shared gradient for every diya halo
  const defs = el('svg', { width: 0, height: 0, 'aria-hidden': 'true', style: 'position:absolute' });
  const grad = el('radialGradient', { id: 'diya-glow' });
  grad.append(el('stop', { offset: '0', 'stop-color': '#ffb347', 'stop-opacity': 0.75 }), el('stop', { offset: '1', 'stop-color': '#ffb347', 'stop-opacity': 0 }));
  defs.append(grad);
  root.prepend(defs);
  root.querySelectorAll('[data-garland]').forEach(garland);
  root.querySelectorAll('[data-rangoli]').forEach(rangoli);
  root.querySelectorAll('[data-diya]').forEach(diya);

  const items = root.querySelectorAll<HTMLElement>('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach((e) => e.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { threshold: 0.2 });
  items.forEach((e) => io.observe(e));
}
