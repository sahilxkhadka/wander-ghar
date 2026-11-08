import * as THREE from 'three';
import { samplePolyline } from './geometry';
import type { HouseMaterials } from './materials';
import { seeded } from './textures';

/**
 * Tihar string lights as one InstancedMesh: warm white runs along parapet tops and multicolour
 * drops + swags hanging from the parapets over the white soffit (as in the photo).
 * Colours are > 1 so the bloom pass picks the bulbs up.
 */
export interface HangingRun {
  /** Outer top edge of the parapet the strings are tied to (y = parapet top). */
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Outward offset direction (unit, in plan). */
  out: THREE.Vector3;
  /** Lowest point the drops reach. */
  minY: number;
  maxY: number;
}

const WARM = new THREE.Color(1.0, 0.62, 0.3).multiplyScalar(1.6);
const PALETTE = [0xff2a2a, 0x22d04a, 0x2a52ff, 0xffd21f, 0xffffff, 0xc02aff, 0x1ae0ff].map((c) => new THREE.Color(c).multiplyScalar(1.15));

export function buildFestiveLights(warmRuns: THREE.Vector3[][], hanging: HangingRun[], mats: HouseMaterials): THREE.InstancedMesh {
  const rnd = seeded(131);
  const pts: THREE.Vector3[] = [];
  const cols: THREE.Color[] = [];
  for (const run of warmRuns) {
    for (const p of samplePolyline(run, 0.11)) {
      pts.push(p);
      cols.push(WARM.clone().multiplyScalar(0.85 + rnd() * 0.3));
    }
  }
  let ci = 0;
  for (const h of hanging) {
    const len = h.from.distanceTo(h.to);
    const drops = Math.max(2, Math.round(len / 0.85) + 1);
    const bottoms: THREE.Vector3[] = [];
    for (let i = 0; i < drops; i++) {
      const top = h.from.clone().lerp(h.to, i / (drops - 1)).addScaledVector(h.out, 0.06);
      const bottom = top.clone();
      bottom.y = h.minY + rnd() * (h.maxY - h.minY);
      bottoms.push(bottom);
      for (const p of samplePolyline([top, bottom], 0.1)) {
        pts.push(p.addScaledVector(h.out, 0.02 * Math.sin(p.y * 7)));
        cols.push(PALETTE[ci++ % PALETTE.length]);
      }
    }
    // swags between neighbouring drops (catenary approximated by a parabola)
    for (let i = 0; i < bottoms.length - 1; i++) {
      const a = bottoms[i], b = bottoms[i + 1];
      const sag = 0.25 + rnd() * 0.25;
      const n = Math.max(4, Math.round(a.distanceTo(b) / 0.1));
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const p = a.clone().lerp(b, t);
        p.y -= sag * 4 * t * (1 - t);
        p.addScaledVector(h.out, 0.05);
        pts.push(p);
        cols.push(PALETTE[ci++ % PALETTE.length]);
      }
    }
  }
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.024, 8, 6), mats.bulb, pts.length);
  const m = new THREE.Matrix4();
  pts.forEach((p, i) => {
    im.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
    im.setColorAt(i, cols[i]);
  });
  im.name = 'string-lights';
  im.userData.partId = 'string-lights';
  im.frustumCulled = false;
  return im;
}

/** Dome ceiling lamp; the light itself is only switched on in night mode. */
export function domeLamp(id: string, pos: [number, number, number], mats: HouseMaterials, hanging = true): THREE.Group {
  const g = new THREE.Group();
  g.name = id;
  g.userData.explodeWithParent = true;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 16), mats.lampBase);
  base.position.set(pos[0], pos[1] + 0.015, pos[2]);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mats.lampGlass);
  dome.position.set(pos[0], pos[1], pos[2]);
  dome.scale.y = hanging ? 0.6 : 1;
  base.name = `${id}-base`;
  dome.name = `${id}-dome`;
  g.add(base, dome);
  const light = new THREE.PointLight(0xffd7a6, 0, 7, 2);
  light.position.set(pos[0], pos[1] - 0.3, pos[2]);
  light.userData.nightIntensity = 1.5;
  light.name = `${id}-light`;
  g.add(light);
  return g;
}
