import * as THREE from 'three';
import { Font, FontData } from 'three/examples/jsm/loaders/FontLoader.js';
import cinzelJson from './fonts/cinzel-bold.typeface.json';
import type { Reveal, TextSpec } from './chapters';

/**
 * Extruded, bevelled 3D lettering. Every letter is its own mesh pivoted at its baseline centre,
 * so the scroll can raise, flip or drop the letters one after another. Glyph geometries are cached
 * and shared between texts.
 */
const font = new Font(cinzelJson as unknown as FontData);
const glyphCache = new Map<string, THREE.ExtrudeGeometry>();

export interface TextMaterials {
  gold: THREE.MeshStandardMaterial[];
  ivory: THREE.MeshStandardMaterial[];
  brass: THREE.MeshStandardMaterial[];
  /** Everything with an emissive term that should brighten at night. */
  glowing: THREE.MeshStandardMaterial[];
}

export function createTextMaterials(envMap: THREE.Texture | null): TextMaterials {
  const m = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ envMap, envMapIntensity: 1.1, ...p });
  // [front + back caps, extruded sides]
  const gold = [
    m({ color: 0xe8b863, metalness: 0.95, roughness: 0.24, emissive: 0xffa640, emissiveIntensity: 0 }),
    m({ color: 0xa8742f, metalness: 0.9, roughness: 0.38, emissive: 0x7a3c0a, emissiveIntensity: 0 }),
  ];
  const ivory = [
    m({ color: 0xf6efe2, metalness: 0.0, roughness: 0.45, emissive: 0xfff1d6, emissiveIntensity: 0 }),
    m({ color: 0xc9a46a, metalness: 0.85, roughness: 0.3, emissive: 0x6b3a0c, emissiveIntensity: 0 }),
  ];
  const brass = [
    m({ color: 0xf2c46d, metalness: 1, roughness: 0.2, emissive: 0xffb04a, emissiveIntensity: 0 }),
    m({ color: 0x8c5a22, metalness: 0.9, roughness: 0.42, emissive: 0x5a2a06, emissiveIntensity: 0 }),
  ];
  return { gold, ivory, brass, glowing: [...gold, ...ivory, ...brass] };
}

function glyph(ch: string, size: number, depth: number, curveSegments: number, bevelSegments: number): THREE.ExtrudeGeometry {
  const key = `${ch}|${size}|${depth}|${curveSegments}`;
  let g = glyphCache.get(key);
  if (g) return g;
  const shapes = font.generateShapes(ch, size);
  const bevel = Math.min(size * 0.035, depth * 0.3);
  g = new THREE.ExtrudeGeometry(shapes, {
    depth: depth - bevel * 2, curveSegments, bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments,
  });
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  // pivot at the bottom-centre of the glyph, centred in depth
  g.translate(-(bb.min.x + bb.max.x) / 2, 0, -(bb.min.z + bb.max.z) / 2);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  glyphCache.set(key, g);
  return g;
}

interface Letter {
  mesh: THREE.Mesh;
  base: THREE.Vector3;
  baseRot: number;
  yaw: number;
  h: number;
}

export class Text3D {
  readonly group = new THREE.Group();
  private letters: Letter[] = [];
  private shown = -1;

  readonly spec: TextSpec;

  /** `portrait` swaps in the spec's narrow-screen overrides (size, line breaks, placement). */
  constructor(spec: TextSpec, private mats: TextMaterials, private quality: { curveSegments: number; bevelSegments: number }, portrait = false) {
    this.spec = portrait && spec.portrait ? { ...spec, ...spec.portrait } : spec;
    this.group.name = `text-${spec.id}`;
    this.layout();
    this.group.position.fromArray(this.spec.position);
    this.group.rotation.set(this.spec.rotation[0], this.spec.rotation[1], this.spec.rotation[2]);
    this.group.visible = false;
  }

  private layout() {
    const s = this.spec;
    const size = s.size;
    const data = (font as unknown as { data: FontData & { glyphs: Record<string, { ha: number; x_min: number; x_max: number }> } }).data;
    const scale = size / data.resolution;
    const spacing = (s.letterSpacing ?? 0.02) * size;
    const mat = this.mats[s.style] as THREE.MeshStandardMaterial[];
    const lines = s.lines ?? [{ text: s.text, offset: [0, 0, 0] as [number, number, number] }];
    for (const line of lines) {
      const chars = [...line.text];
      const adv = chars.map((c) => (data.glyphs[c]?.ha ?? data.glyphs[' '].ha) * scale);
      const total = adv.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
      let pen = -total / 2;
      chars.forEach((c, i) => {
        const gd = data.glyphs[c];
        const centre = pen + (gd ? ((gd.x_min + gd.x_max) / 2) * scale : adv[i] / 2);
        pen += adv[i] + spacing;
        if (c === ' ' || !gd) return;
        const geo = glyph(c, size, s.depth, this.quality.curveSegments, this.quality.bevelSegments);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = `letter-${c}`;
        const base = new THREE.Vector3(centre, 0, 0);
        let baseRot = 0;
        if (s.arc) {
          // baseline wraps over a circle whose centre sits at the group origin
          const a = centre / s.arc;
          base.set(Math.sin(a) * s.arc, Math.cos(a) * s.arc, 0);
          baseRot = -a;
        }
        base.add(new THREE.Vector3(...line.offset));
        mesh.position.copy(base);
        mesh.rotation.set(0, s.letterYaw ?? 0, baseRot);
        this.group.add(mesh);
        this.letters.push({ mesh, base, baseRot, yaw: s.letterYaw ?? 0, h: geo.boundingBox!.max.y });
      });
    }
  }

  dispose() {
    this.group.removeFromParent();
  }

  /** Width of the laid-out line in metres (for framing checks). */
  get width(): number {
    const b = new THREE.Box3().setFromObject(this.group);
    return b.max.x - b.min.x;
  }

  /**
   * r: 0 hidden .. 1 fully placed. Letters arrive left to right with a short stagger;
   * the motion is a pure function of r, so scrolling backwards plays it in reverse.
   */
  setReveal(r: number) {
    r = THREE.MathUtils.clamp(r, 0, 1);
    if (r === this.shown) return;
    this.shown = r;
    this.group.visible = r > 0.001;
    if (!this.group.visible) return;
    const n = this.letters.length;
    const stagger = 0.55;
    this.letters.forEach((L, i) => {
      const start = n > 1 ? (i / (n - 1)) * stagger : 0;
      const t = THREE.MathUtils.clamp((r - start) / (1 - stagger), 0, 1);
      pose(L, t, this.spec.reveal);
    });
  }
}

const easeOutBack = (t: number) => {
  const c1 = 1.4, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function pose(L: Letter, t: number, mode: Reveal) {
  const m = L.mesh;
  m.visible = t > 0.001;
  if (!m.visible) return;
  const e = easeOutBack(t), c = easeOutCubic(t);
  m.position.copy(L.base);
  m.rotation.set(0, L.yaw, L.baseRot);
  m.scale.setScalar(1);
  switch (mode) {
    case 'rise': // grow up out of the surface, tipping upright
      m.scale.set(1, Math.max(0.001, e), 1);
      m.rotation.x = (1 - c) * -0.5;
      break;
    case 'flip': // hinge up from lying flat on its face
      m.rotation.x = (1 - e) * (Math.PI / 2);
      m.scale.setScalar(Math.max(0.001, c));
      break;
    case 'drop': // fall onto its seat from above, settling with a bounce
      m.position.y += (1 - e) * L.h * 2.2 * Math.cos(L.baseRot);
      m.position.x += (1 - e) * L.h * 2.2 * -Math.sin(L.baseRot);
      m.rotation.y = L.yaw + (1 - c) * 1.6;
      m.scale.setScalar(Math.max(0.001, c));
      break;
    case 'swing': // turn in from edge-on
      m.rotation.y = L.yaw + (1 - e) * (Math.PI / 2);
      m.scale.setScalar(Math.max(0.001, c));
      break;
  }
}
