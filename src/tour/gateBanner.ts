import * as THREE from 'three';
import { BulbGlow, createGlow } from './glow';

/**
 * Arched welcome board over the gate, resting on the two pier caps: a maroon enamel half-ring
 * with gold rims and a kalash finial, a marigold garland draped over it and swagged between the
 * piers, and a row of warm bulbs along the outer rim that light up after dusk. The lettering
 * itself is a Text3D laid on the same arc (see TEXTS.welcome), so it can animate on its own.
 *
 * Local frame: origin at the arc centre between the piers, x along the wall, y up, z to the lane.
 */
export const BANNER = { inner: 0.72, outer: 1.06, depth: 0.05 };

export interface GateBanner {
  group: THREE.Group;
  bulbs: THREE.MeshBasicMaterial;
  glow: BulbGlow;
}

function annulusSector(r0: number, r1: number, a0: number, a1: number): THREE.Shape {
  const s = new THREE.Shape();
  s.absarc(0, 0, r1, a0, a1, false);
  s.absarc(0, 0, r0, a1, a0, true);
  s.closePath();
  return s;
}

export function createGateBanner(envMap: THREE.Texture | null, shadows: boolean): GateBanner {
  const group = new THREE.Group();
  group.name = 'gate-banner';
  const { inner, outer, depth } = BANNER;

  const enamel = new THREE.MeshStandardMaterial({ color: 0x5e1420, roughness: 0.38, metalness: 0.15, envMap, envMapIntensity: 0.5 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xe0ac55, roughness: 0.25, metalness: 1, envMap, envMapIntensity: 1.2 });
  const board = new THREE.Mesh(
    new THREE.ExtrudeGeometry(annulusSector(inner, outer, 0, Math.PI), { depth, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 40 }),
    enamel,
  );
  board.geometry.translate(0, 0, -depth / 2);
  board.name = 'banner-board';
  board.castShadow = shadows;
  group.add(board);

  // gold rims on both faces, and the kalash (water pot) finial on top
  const rims = [inner + 0.004, outer - 0.004].flatMap((r) => [depth / 2 + 0.01, -depth / 2 - 0.01].map((z) => {
    const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.014, 6, 56, Math.PI), gold);
    t.position.z = z;
    return t;
  }));
  const kalash = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 10), gold);
  pot.scale.y = 0.85;
  pot.position.y = 0.07;
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.06, 12), gold);
  neck.position.y = 0.15;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.11, 12), gold);
  tip.position.y = 0.23;
  kalash.add(pot, neck, tip);
  kalash.position.y = outer;
  group.add(...rims, kalash);

  // marigold garland: draped along the outer rim, swagged between the piers, short drops at the ends
  const blooms: THREE.Vector3[] = [];
  for (let a = 0.12; a < Math.PI - 0.1; a += 0.055) blooms.push(new THREE.Vector3(Math.cos(a) * (outer + 0.03), Math.sin(a) * (outer + 0.03), depth / 2 + 0.035));
  const span = (inner + outer) / 2;
  for (let t = 0; t <= 1.0001; t += 1 / 30) {
    const x = -span + 2 * span * t;
    blooms.push(new THREE.Vector3(x, -0.04 - 0.32 * 4 * t * (1 - t), depth / 2 + 0.05));
  }
  for (const side of [-1, 1]) for (let k = 1; k <= 7; k++) blooms.push(new THREE.Vector3(side * span, -0.04 - k * 0.055, depth / 2 + 0.05));
  const marigold = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.034, 1), new THREE.MeshStandardMaterial({ roughness: 0.8 }), blooms.length);
  const m = new THREE.Matrix4();
  const cols = [0xff8a10, 0xffb000, 0xe8601a].map((c) => new THREE.Color(c));
  blooms.forEach((p, i) => {
    marigold.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
    marigold.setColorAt(i, cols[i % 3]);
  });
  marigold.name = 'banner-marigolds';
  group.add(marigold);

  // warm bulbs just inside the outer rim, on the lane side
  const bulbPts: THREE.Vector3[] = [];
  for (let a = 0.2; a < Math.PI - 0.15; a += 0.13) bulbPts.push(new THREE.Vector3(Math.cos(a) * (outer - 0.05), Math.sin(a) * (outer - 0.05), depth / 2 + 0.02));
  const bulbs = new THREE.MeshBasicMaterial({ color: 0xffd08a, toneMapped: false });
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.016, 8, 6), bulbs, bulbPts.length);
  bulbPts.forEach((p, i) => bulbMesh.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
  bulbMesh.name = 'banner-bulbs';
  group.add(bulbMesh);

  const glow = createGlow(bulbPts, bulbPts.map(() => new THREE.Color(0xffc070)), 0.2);
  group.add(glow.points);
  return { group, bulbs, glow };
}
