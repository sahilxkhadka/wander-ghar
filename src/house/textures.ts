import * as THREE from 'three';

/**
 * Procedural canvas textures. Every tiled texture is authored for geometry whose UVs are in
 * metres, so `repeat` = 1 / tile size and texel density stays constant across parts.
 * All randomness is seeded: the same layout always renders the same bricks.
 */

export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, color: boolean, tileW = 1, tileH = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tileW, 1 / tileH);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${h.toFixed(1)}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%)`;
}

function grey(v: number): string {
  const c = Math.max(0, Math.min(255, Math.round(v)));
  return `rgb(${c},${c},${c})`;
}

/** Speckle noise: many tiny translucent dots, used to break up flat fills. */
function speckle(g: CanvasRenderingContext2D, w: number, h: number, count: number, rnd: () => number, dark: string, light: string, size = 2) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = rnd() < 0.5 ? dark : light;
    g.globalAlpha = 0.05 + rnd() * 0.12;
    g.fillRect(rnd() * w, rnd() * h, size * (0.5 + rnd()), size * (0.5 + rnd()));
  }
  g.globalAlpha = 1;
}

export interface PbrMaps {
  map: THREE.Texture;
  roughnessMap: THREE.Texture;
  bumpMap: THREE.Texture;
}

/** Wraps a rectangle draw across the tile edge so stretcher bond tiles seamlessly. */
function wrapRect(gs: CanvasRenderingContext2D[], fills: string[], x: number, y: number, w: number, h: number, W: number) {
  for (let k = 0; k < gs.length; k++) {
    gs[k].fillStyle = fills[k];
    gs[k].fillRect(x, y, w, h);
    if (x + w > W) gs[k].fillRect(x - W, y, w, h);
    if (x < 0) gs[k].fillRect(x + W, y, w, h);
  }
}

/**
 * Facade brick: machine-made, stretcher bond, 0.25 x 0.0625 m modules, light recessed mortar.
 * Tile = 2.0 m x 1.0 m (8 bricks x 16 courses), 512 px / m.
 */
export function facadeBrick(seed = 7): PbrMaps {
  const W = 1024, H = 512, PX = 512;
  const rnd = seeded(seed);
  const [cc, gc] = canvas(W, H);
  const [cr, gr] = canvas(W, H);
  const [cb, gb] = canvas(W, H);
  gc.fillStyle = '#c9b49c';
  gc.fillRect(0, 0, W, H);
  gr.fillStyle = grey(246);
  gr.fillRect(0, 0, W, H);
  gb.fillStyle = grey(30);
  gb.fillRect(0, 0, W, H);
  const course = 0.0625 * PX, brick = 0.25 * PX, joint = 0.011 * PX;
  for (let r = 0; r < 16; r++) {
    const off = (r % 2) * brick / 2;
    for (let i = -1; i < 9; i++) {
      const x = i * brick + off + joint / 2;
      const y = r * course + joint / 2;
      const l = 0.43 + (rnd() - 0.5) * 0.09;
      const h = 19 + (rnd() - 0.5) * 6;
      const s = 0.52 + (rnd() - 0.5) * 0.14;
      wrapRect([gc, gr, gb], [hsl(h, s, l), grey(205 + rnd() * 25), grey(200 + rnd() * 40)], x, y, brick - joint, course - joint, W);
      // face mottling inside the brick
      for (let k = 0; k < 6; k++) {
        gc.globalAlpha = 0.12;
        gc.fillStyle = hsl(h + (rnd() - 0.5) * 8, s, l + (rnd() - 0.5) * 0.12);
        const bx = x + rnd() * (brick - joint - 20), by = y + rnd() * (course - joint - 8);
        gc.fillRect(bx, by, 8 + rnd() * 24, 3 + rnd() * 8);
        gc.globalAlpha = 1;
      }
    }
  }
  speckle(gc, W, H, 9000, rnd, '#5a2a14', '#e0a27a', 2);
  speckle(gb, W, H, 6000, rnd, '#202020', '#ffffff', 2);
  return {
    map: toTexture(cc, true, 2, 1),
    roughnessMap: toTexture(cr, false, 2, 1),
    bumpMap: toTexture(cb, false, 2, 1),
  };
}

/** Aged hand-made compound-wall brick: irregular courses, grey mortar, soot and efflorescence. */
export function oldBrick(seed = 11): PbrMaps {
  const W = 1024, H = 512, PX = 512;
  const rnd = seeded(seed);
  const [cc, gc] = canvas(W, H);
  const [cr, gr] = canvas(W, H);
  const [cb, gb] = canvas(W, H);
  gc.fillStyle = '#8f8a80';
  gc.fillRect(0, 0, W, H);
  gr.fillStyle = grey(250);
  gr.fillRect(0, 0, W, H);
  gb.fillStyle = grey(20);
  gb.fillRect(0, 0, W, H);
  const rows = 14;
  const courseH = H / rows;
  for (let r = 0; r < rows; r++) {
    let x = -rnd() * 60;
    const y = r * courseH;
    while (x < W) {
      const bw = (0.19 + rnd() * 0.07) * PX;
      const j = 3 + rnd() * 4;
      const tone = rnd();
      let fill: string;
      // photo reads grey-brown: low-chroma reds, many grey/soot-dark bricks, few pale ones
      if (tone < 0.45) fill = hsl(12 + rnd() * 10, 0.16 + rnd() * 0.08, 0.34 + rnd() * 0.09);
      else if (tone < 0.8) fill = hsl(20, 0.06 + rnd() * 0.06, 0.33 + rnd() * 0.1);
      else if (tone < 0.9) fill = hsl(24, 0.16, 0.46 + rnd() * 0.08);
      else fill = hsl(30, 0.05, 0.24 + rnd() * 0.08);
      const top = y + j / 2 + (rnd() - 0.5) * 2;
      wrapRect([gc, gr, gb], [fill, grey(225 + rnd() * 25), grey(150 + rnd() * 90)], x + j / 2, top, bw - j, courseH - j, W);
      // chipped corners
      if (rnd() < 0.3) {
        gc.fillStyle = '#7d776d';
        gc.fillRect(x + j / 2, top, 6 + rnd() * 8, 4 + rnd() * 5);
      }
      x += bw;
    }
  }
  // soot / efflorescence blotches
  // rain streaks run down from the coping: tall, faint, vertical
  for (let i = 0; i < 40; i++) {
    gc.globalAlpha = 0.04 + rnd() * 0.07;
    gc.fillStyle = rnd() < 0.7 ? '#1f1d1a' : '#d6d2c6';
    const sx = rnd() * W, sw = 12 + rnd() * 50, sh = H * (0.3 + rnd() * 0.7);
    gc.fillRect(sx, 0, sw, sh);
    if (sx + sw > W) gc.fillRect(sx - W, 0, sw, sh);
  }
  gc.globalAlpha = 1;
  // grey lime wash over the whole wall (the photo's compound wall reads grey-brown, low contrast)
  gc.globalAlpha = 0.24;
  gc.fillStyle = '#9d978c';
  gc.fillRect(0, 0, W, H);
  gc.globalAlpha = 1;
  speckle(gc, W, H, 14000, rnd, '#1a1410', '#d9c3ad', 2);
  speckle(gb, W, H, 9000, rnd, '#000000', '#ffffff', 3);
  return { map: toTexture(cc, true, 2, 1), roughnessMap: toTexture(cr, false, 2, 1), bumpMap: toTexture(cb, false, 2, 1) };
}

/** Stone-slab lane paving: irregular rectangular setts in loose rows with wide light joints. 3 m tile. */
export function stonePaving(seed = 23): PbrMaps {
  const W = 1024, H = 1024, PX = W / 3;
  const rnd = seeded(seed);
  const [cc, gc] = canvas(W, H);
  const [cr, gr] = canvas(W, H);
  const [cb, gb] = canvas(W, H);
  gc.fillStyle = '#9c988f';
  gc.fillRect(0, 0, W, H);
  speckle(gc, W, H, 20000, rnd, '#6e6a62', '#c9c4b8', 3);
  gr.fillStyle = grey(240);
  gr.fillRect(0, 0, W, H);
  gb.fillStyle = grey(60);
  gb.fillRect(0, 0, W, H);
  let y = 0;
  while (y < H - 1) {
    const rh = Math.min((0.18 + rnd() * 0.12) * PX, H - y);
    let x = -rnd() * 80;
    while (x < W) {
      const sw = (0.2 + rnd() * 0.26) * PX;
      const j = 0.035 * PX * (0.6 + rnd() * 0.8);
      const t = rnd();
      // worn grey stone; only a faint warm cast on a few slabs (no orange tiles)
      const fill = t < 0.55 ? hsl(38, 0.05, 0.6 + rnd() * 0.12) : t < 0.85 ? hsl(30, 0.04, 0.52 + rnd() * 0.12) : hsl(28, 0.12, 0.58 + rnd() * 0.1);
      // irregular quad (each corner jittered independently): hand-laid stone, not tiles
      const c = 0.07 * PX;
      const x0 = x + j / 2, y0 = y + j / 2, x1 = x + sw - j / 2, y1 = y + rh - j / 2;
      const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([px, py]) => [px + (rnd() - 0.5) * c, py + (rnd() - 0.5) * c]);
      for (const [ctx, f] of [[gc, fill], [gr, grey(200 + rnd() * 40)], [gb, grey(170 + rnd() * 60)]] as [CanvasRenderingContext2D, string][]) {
        ctx.fillStyle = f;
        for (const dx of [0, -W, W]) {
          ctx.beginPath();
          pts.forEach(([px, py], k) => (k ? ctx.lineTo(px + dx, py) : ctx.moveTo(px + dx, py)));
          ctx.closePath();
          ctx.fill();
        }
      }
      for (let k = 0; k < 5; k++) {
        gc.globalAlpha = 0.15;
        gc.fillStyle = rnd() < 0.5 ? '#6f6a60' : '#cfc7b6';
        gc.fillRect(x + j + rnd() * (sw - 3 * j), y + j + rnd() * (rh - 3 * j), 10 + rnd() * 30, 6 + rnd() * 20);
        gc.globalAlpha = 1;
      }
      x += sw;
    }
    y += rh;
  }
  speckle(gc, W, H, 16000, rnd, '#4a4640', '#e8e2d4', 2);
  speckle(gb, W, H, 9000, rnd, '#000', '#fff', 2);
  return { map: toTexture(cc, true, 3, 3), roughnessMap: toTexture(cr, false, 3, 3), bumpMap: toTexture(cb, false, 3, 3) };
}

/** Lawn: layered green noise with blade strokes. 2 m tile. */
export function lawn(seed = 31): THREE.Texture {
  const W = 512;
  const rnd = seeded(seed);
  const [c, g] = canvas(W, W);
  g.fillStyle = '#4b7436';
  g.fillRect(0, 0, W, W);
  for (let i = 0; i < 9000; i++) {
    g.strokeStyle = hsl(85 + rnd() * 30, 0.4 + rnd() * 0.25, 0.22 + rnd() * 0.22);
    g.globalAlpha = 0.5;
    const x = rnd() * W, y = rnd() * W;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 4, y - 3 - rnd() * 7);
    g.stroke();
  }
  g.globalAlpha = 1;
  return toTexture(c, true, 2, 2);
}

/** Generic concrete / screed. 2 m tile. */
export function concrete(seed = 41, base = '#8d8b86'): THREE.Texture {
  const W = 512;
  const rnd = seeded(seed);
  const [c, g] = canvas(W, W);
  g.fillStyle = base;
  g.fillRect(0, 0, W, W);
  speckle(g, W, W, 12000, rnd, '#3d3b38', '#d8d5ce', 3);
  for (let i = 0; i < 30; i++) {
    g.globalAlpha = 0.07;
    g.fillStyle = rnd() < 0.5 ? '#2e2c29' : '#ffffff';
    g.beginPath();
    g.ellipse(rnd() * W, rnd() * W, 20 + rnd() * 80, 20 + rnd() * 60, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  return toTexture(c, true, 2, 2);
}

/** Curtain folds (UV 0..1 across the opening). */
export function curtain(): THREE.Texture {
  const [c, g] = canvas(256, 64);
  for (let x = 0; x < 256; x++) {
    const v = 0.82 + 0.18 * Math.sin(x / 256 * Math.PI * 2 * 9) * Math.sin(x / 256 * Math.PI * 2 * 2.3 + 1);
    g.fillStyle = `rgb(${Math.round(236 * v)},${Math.round(226 * v)},${Math.round(206 * v)})`;
    g.fillRect(x, 0, 1, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Vertical blinds behind grilles (UV 0..1). */
export function blinds(): THREE.Texture {
  const [c, g] = canvas(256, 32);
  for (let x = 0; x < 256; x++) {
    const p = (x % 16) / 16;
    const v = 0.78 + 0.22 * Math.sin(p * Math.PI);
    g.fillStyle = `rgb(${Math.round(238 * v)},${Math.round(234 * v)},${Math.round(222 * v)})`;
    g.fillRect(x, 0, 1, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Moss / damp band: dark green at v=0 fading to transparent by v=1 (alpha in texture). */
export function mossBand(seed = 53): THREE.Texture {
  const W = 512, H = 128;
  const rnd = seeded(seed);
  const [c, g] = canvas(W, H);
  // damp/moss climbs unevenly: dense at the foot, sparse fingers higher up
  for (let i = 0; i < 1800; i++) {
    const y = H - Math.pow(rnd(), 2.6) * H;
    g.fillStyle = rnd() < 0.5 ? `rgba(44,54,30,${0.1 + rnd() * 0.22})` : `rgba(26,27,22,${0.1 + rnd() * 0.22})`;
    g.beginPath();
    g.ellipse(rnd() * W, y, 3 + rnd() * 14, 2 + rnd() * 6, 0, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Large broad-leaf texture with alpha for tree / banana cards. */
export function leafCluster(seed = 61, hue = 105): THREE.Texture {
  const W = 256;
  const rnd = seeded(seed);
  const [c, g] = canvas(W, W);
  // many small dark leaves with a few pale, flash-lit ones (as the ivy over the wall reads at night)
  for (let i = 0; i < 150; i++) {
    const x = 24 + rnd() * (W - 48), y = 24 + rnd() * (W - 48);
    const r = 8 + rnd() * 14;
    g.save();
    g.translate(x, y);
    g.rotate(rnd() * Math.PI * 2);
    g.fillStyle = rnd() < 0.15 ? hsl(hue - 10, 0.25, 0.5 + rnd() * 0.15) : hsl(hue + (rnd() - 0.5) * 20, 0.3 + rnd() * 0.15, 0.12 + rnd() * 0.16);
    g.beginPath();
    g.ellipse(0, 0, r, r * 0.62, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(200,230,170,0.25)';
    g.beginPath();
    g.moveTo(-r, 0);
    g.lineTo(r, 0);
    g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
