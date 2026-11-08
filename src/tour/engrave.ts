import * as THREE from 'three';
import { Font, FontData } from 'three/examples/jsm/loaders/FontLoader.js';
import cinzelJson from './fonts/cinzel-bold.typeface.json';
import { seeded } from '../house/textures';
import type { PlaqueSpec } from './chapters';

/**
 * A polished granite slab set into the lane with lettering cut into it. The cut is real
 * geometry: the slab's top layer is extruded from an outline with every glyph (and a border
 * groove) as a hole, so the walls of each letter are bevelled stone; the floor of the cut is a
 * gilded layer underneath. Scroll "pours" the gold into the letters left to right with a bright
 * leading edge; with no gold the cuts read as plain carved stone.
 */
const font = new Font(cinzelJson as unknown as FontData);
type Glyphs = Record<string, { ha: number; x_min: number; x_max: number }>;
const glyphData = (font as unknown as { data: FontData & { glyphs: Glyphs } }).data;

const CUT = 0.026; // depth of the engraving
const BASE = 0.018; // gilded layer below the cut
const DIV = 6; // curve subdivisions when flattening glyph outlines

function graniteTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rnd = seeded(5150);
  g.fillStyle = '#2b2a2c';
  g.fillRect(0, 0, S, S);
  // soft clouds, then mineral flecks: black mica, grey feldspar, a little white quartz
  for (let i = 0; i < 90; i++) {
    const x = rnd() * S, y = rnd() * S, r = 20 + rnd() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const v = 40 + Math.floor(rnd() * 22);
    grd.addColorStop(0, `rgba(${v},${v},${v + 3},0.35)`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const fleck = (n: number, col: () => string, s: number) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = col();
      const w = s * (0.4 + rnd());
      g.fillRect(rnd() * S, rnd() * S, w, w * (0.5 + rnd()));
    }
  };
  fleck(5200, () => `rgba(12,12,14,${0.5 + rnd() * 0.5})`, 2.6);
  fleck(3800, () => { const v = 95 + Math.floor(rnd() * 60); return `rgba(${v},${v},${v + 4},${0.35 + rnd() * 0.4})`; }, 2.2);
  fleck(700, () => `rgba(225,222,215,${0.4 + rnd() * 0.5})`, 1.6);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Glyph outlines of one line, flattened to polygons and laid out centred at (0, y). */
function lineOutlines(text: string, size: number, y: number, tracking: number): { outer: THREE.Vector2[][]; counters: THREE.Vector2[][] } {
  const scale = size / glyphData.resolution;
  const chars = [...text];
  const adv = chars.map((c) => (glyphData.glyphs[c]?.ha ?? glyphData.glyphs[' '].ha) * scale);
  const spacing = tracking * size;
  const total = adv.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  // optical centring: the cap height of Cinzel sits at ~0.7 em
  const dy = y - size * 0.35;
  let pen = -total / 2;
  const outer: THREE.Vector2[][] = [], counters: THREE.Vector2[][] = [];
  chars.forEach((c, i) => {
    if (c !== ' ' && glyphData.glyphs[c]) {
      for (const shape of font.generateShapes(c, size)) {
        outer.push(shape.getPoints(DIV).map((p) => new THREE.Vector2(p.x + pen, p.y + dy)));
        for (const h of shape.holes) counters.push(h.getPoints(DIV).map((p) => new THREE.Vector2(p.x + pen, p.y + dy)));
      }
    }
    pen += adv[i] + spacing;
  });
  return { outer, counters };
}

const rect = (w: number, h: number) => [new THREE.Vector2(-w / 2, -h / 2), new THREE.Vector2(w / 2, -h / 2), new THREE.Vector2(w / 2, h / 2), new THREE.Vector2(-w / 2, h / 2)];

export interface PlaqueMaterials {
  stone: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  /** 0..1 how far the gold has run along the line (and 1 + a little to clear the highlight). */
  reveal: { value: number };
}

export function createPlaqueMaterials(envMap: THREE.Texture | null): PlaqueMaterials {
  const map = graniteTexture();
  map.repeat.set(0.5, 0.5);
  const stone = new THREE.MeshStandardMaterial({ map, color: 0xffffff, roughness: 0.32, metalness: 0.05, envMap, envMapIntensity: 0.55 });
  const reveal = { value: 1 };
  // gold leaf: part metal, part diffuse, so it still reads gold where it reflects only dark sky
  const gold = new THREE.MeshStandardMaterial({ color: 0xf2c46a, metalness: 0.65, roughness: 0.32, envMap, envMapIntensity: 1.4, emissive: 0xffa53a, emissiveIntensity: 0 });
  gold.onBeforeCompile = (sh) => {
    sh.uniforms.uReveal = reveal;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRun;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRun = position.x;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRun;\nuniform float uReveal;')
      // run along local x (slab spans roughly -5..5 m); the gold front sweeps left to right
      .replace('#include <color_fragment>', `#include <color_fragment>
        float front = mix(-6.0, 6.0, uReveal) - vRun;
        float fill = smoothstep(0.0, 0.35, front);
        float edge = smoothstep(0.0, 0.12, front) * (1.0 - smoothstep(0.12, 0.6, front));
        diffuseColor.rgb = mix(vec3(0.07, 0.065, 0.07), diffuseColor.rgb, fill);`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= fill;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = totalEmissiveRadiance * fill + vec3(1.0, 0.72, 0.35) * edge * 1.6;');
  };
  return { stone, gold, reveal };
}

export class EngravedPlaque {
  readonly group = new THREE.Group();
  private geos: THREE.BufferGeometry[] = [];

  constructor(spec: PlaqueSpec, private mats: PlaqueMaterials, quality: { bevelSegments: number }, portrait = false, shadows = true) {
    const s = portrait && spec.portrait ? { ...spec, ...spec.portrait } : spec;
    this.group.name = `plaque-${spec.id}`;
    const holes: THREE.Vector2[][] = [];
    const islands: THREE.Vector2[][] = [];
    for (const l of s.lines) {
      const o = lineOutlines(l.text, l.size, l.y, l.tracking ?? 0.08);
      holes.push(...o.outer);
      islands.push(...o.counters);
    }
    // the slab grows to keep a margin around the lettering (lines are centred on x = 0)
    const box = new THREE.Box2();
    for (const h of holes) for (const p of h) box.expandByPoint(p);
    const W = Math.max(s.slab[0], 2 * Math.max(-box.min.x, box.max.x) + 1.0);
    const D = Math.max(s.slab[1], 2 * Math.max(-box.min.y, box.max.y) + 0.8);
    // border groove: a thin rectangular ring cut inside the slab edge
    const inset = 0.12, groove = 0.035;
    const outerShape = new THREE.Shape(rect(W, D));
    outerShape.holes.push(new THREE.Path(rect(W - inset * 2, D - inset * 2)));
    const field = new THREE.Shape(rect(W - (inset + groove) * 2, D - (inset + groove) * 2));
    for (const h of holes) field.holes.push(new THREE.Path(h));
    const shapes = [outerShape, field, ...islands.map((p) => new THREE.Shape(p))];

    const bevel = 0.006;
    const top = new THREE.ExtrudeGeometry(shapes, { depth: CUT - bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelOffset: -bevel * 0.8, bevelSegments: Math.max(1, quality.bevelSegments), curveSegments: 1 });
    top.translate(0, 0, BASE);
    const base = new THREE.ExtrudeGeometry(new THREE.Shape(rect(W, D)), { depth: BASE, bevelEnabled: false });
    for (const g of [top, base]) g.rotateX(-Math.PI / 2); // shape +y points away from the street, toward the house
    this.geos.push(top, base);

    const topMesh = new THREE.Mesh(top, mats.stone);
    topMesh.name = 'letter-plaque';
    topMesh.castShadow = shadows;
    topMesh.receiveShadow = shadows;
    // the cut floor: gilded caps, stone sides
    const baseMesh = new THREE.Mesh(base, [mats.gold, mats.stone]);
    baseMesh.name = 'plaque-gold';
    baseMesh.receiveShadow = shadows;
    this.group.add(topMesh, baseMesh);
    this.group.position.fromArray(s.position);
    this.group.rotation.y = s.rotationY;
  }

  /** The slab is part of the lane and always shows; scroll only runs the gold into the cuts. */
  setReveal(r: number) {
    this.mats.reveal.value = Math.min(1.08, Math.max(0, r) * 1.08);
  }

  dispose() {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
  }
}
