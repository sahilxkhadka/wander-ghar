import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seeded } from '../house/textures';
import { BulbGlow, createGlow } from './glow';

/**
 * Extra garden furniture for the tour, kept clear of the lawn strip the camera looks down
 * (x 2.6..6.2 between the gate and the "THE GARDEN" lettering at z -5.2):
 * a wooden bench against the east wing, a tulsi math (the household basil shrine), iron lamp
 * posts, terracotta pots, a birdbath, and clay diyas lit for Tihar after dusk.
 * Static parts are merged per material, so the whole set costs a handful of draw calls.
 */
export interface GardenExtras {
  group: THREE.Group;
  /** Materials whose emissive follows the night amount. */
  night: [THREE.MeshStandardMaterial, number][];
  /** Diya flames: unlit wicks by day, bright after dusk (scaled by the night amount). */
  flame: THREE.MeshBasicMaterial;
  glows: BulbGlow[];
}

type Part = [THREE.BufferGeometry, number, number, number, number?];

function place(geo: THREE.BufferGeometry, x: number, y: number, z: number, rotY = 0): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.rotateY(rotY);
  g.translate(x, y, z);
  // merged sets need matching attributes
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  return g;
}

function merged(name: string, parts: Part[], mat: THREE.Material, shadows: boolean): THREE.Mesh {
  const mesh = new THREE.Mesh(mergeGeometries(parts.map(([g, x, y, z, r]) => place(g, x, y, z, r))), mat);
  mesh.name = name;
  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;
  return mesh;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

export function createGardenExtras(shadows: boolean): GardenExtras {
  const rnd = seeded(77);
  const group = new THREE.Group();
  group.name = 'garden-extras';

  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a2a, roughness: 0.75 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.6 });
  const plaster = new THREE.MeshStandardMaterial({ color: 0xf1ebe0, roughness: 0.85 });
  const ochre = new THREE.MeshStandardMaterial({ color: 0xb4532a, roughness: 0.8 });
  const clay = new THREE.MeshStandardMaterial({ color: 0x9c4f2d, roughness: 0.9 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x9a968d, roughness: 0.9 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x2f5a24, roughness: 0.85 });
  const lanternGlass = new THREE.MeshStandardMaterial({ color: 0xfff0d0, roughness: 0.3, emissive: 0xffb45a, emissiveIntensity: 0 });
  const flame = new THREE.MeshBasicMaterial({ color: 0xffb347, toneMapped: false });
  flame.color.setScalar(0);

  // ---------------------------------------------------------------- bench against the east wing
  const bench: Part[] = [];
  const bx = 2.95, bz = -7.7;
  for (let k = 0; k < 4; k++) bench.push([box(0.09, 0.035, 1.5), bx - 0.15 + k * 0.1, 0.45, bz]); // seat slats
  for (let k = 0; k < 3; k++) bench.push([box(0.035, 0.08, 1.5), bx - 0.24, 0.62 + k * 0.12, bz]); // back slats
  for (const dz of [-0.65, 0.65]) {
    bench.push([box(0.06, 0.45, 0.06), bx + 0.15, 0.225, bz + dz]);
    bench.push([box(0.06, 0.88, 0.06), bx - 0.24, 0.44, bz + dz]);
    bench.push([box(0.42, 0.05, 0.06), bx - 0.03, 0.66, bz + dz]); // armrest
  }
  group.add(merged('bench', bench, wood, shadows));

  // ---------------------------------------------------------------- tulsi math (basil shrine)
  const tx = 4.6, tz = -8.5;
  group.add(merged('tulsi-math-plaster', [
    [box(0.9, 0.12, 0.9), tx, 0.06, tz],
    [box(0.55, 0.8, 0.55), tx, 0.52, tz],
    [box(0.72, 0.1, 0.72), tx, 0.97, tz],
  ], plaster, shadows));
  group.add(merged('tulsi-math-ochre', [
    [box(0.57, 0.08, 0.57), tx, 0.3, tz],
    [box(0.6, 0.06, 0.6), tx, 0.88, tz],
    [box(0.26, 0.3, 0.02), tx, 0.55, tz + 0.28], // niche for the lamp
  ], ochre, shadows));
  const tulsi: Part[] = [];
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 0.18;
    tulsi.push([new THREE.IcosahedronGeometry(0.09 + rnd() * 0.05, 0), tx + Math.cos(a) * r, 1.1 + rnd() * 0.35, tz + Math.sin(a) * r]);
  }
  group.add(merged('tulsi', tulsi, leaf, shadows));

  // ---------------------------------------------------------------- lamp posts with lanterns
  const posts: [number, number][] = [[5.95, -2.4], [5.95, -6.9], [3.05, -9.6]];
  const ironParts: Part[] = [];
  const glass: Part[] = [];
  const lanternPts: THREE.Vector3[] = [];
  for (const [x, z] of posts) {
    ironParts.push([new THREE.CylinderGeometry(0.035, 0.05, 1.7, 8), x, 0.85, z]);
    ironParts.push([new THREE.CylinderGeometry(0.11, 0.13, 0.08, 8), x, 0.04, z]);
    ironParts.push([new THREE.ConeGeometry(0.17, 0.14, 4), x, 2.03, z, Math.PI / 4]);
    ironParts.push([box(0.2, 0.03, 0.2), x, 1.71, z]);
    glass.push([box(0.17, 0.24, 0.17), x, 1.84, z]);
    lanternPts.push(new THREE.Vector3(x, 1.84, z));
  }

  // ---------------------------------------------------------------- birdbath
  const stoneParts: Part[] = [
    [new THREE.CylinderGeometry(0.22, 0.26, 0.08, 14), 5.35, 0.04, -9.4],
    [new THREE.CylinderGeometry(0.07, 0.1, 0.7, 10), 5.35, 0.43, -9.4],
    [new THREE.CylinderGeometry(0.34, 0.12, 0.12, 16), 5.35, 0.84, -9.4],
  ];
  group.add(merged('birdbath', stoneParts, stone, shadows));
  group.add(merged('lamp-posts', ironParts, iron, shadows));
  group.add(merged('lanterns', glass, lanternGlass, false));

  // ---------------------------------------------------------------- terracotta pots with flowers
  const pots: Part[] = [];
  const blooms: { p: THREE.Vector3; c: THREE.Color }[] = [];
  const colours = [0xff8a10, 0xffc21a, 0xd9277a, 0xc8202c, 0xf3f0e6].map((c) => new THREE.Color(c));
  const potSpots: [number, number, number][] = [
    [2.82, -2.5, 1], [2.85, -3.0, 0.8], [3.15, -2.75, 0.65], [2.82, -3.5, 0.9],
    [2.85, -8.75, 0.85], [3.2, -8.9, 0.65], [2.82, -6.55, 0.75],
  ];
  for (const [x, z, s] of potSpots) {
    pots.push([new THREE.CylinderGeometry(0.17 * s, 0.12 * s, 0.3 * s, 12), x, 0.15 * s, z]);
    const col = colours[Math.floor(rnd() * colours.length)];
    for (let k = 0; k < 9; k++) {
      const a = rnd() * Math.PI * 2, r = rnd() * 0.13 * s;
      blooms.push({ p: new THREE.Vector3(x + Math.cos(a) * r, 0.3 * s + 0.05 + rnd() * 0.14 * s, z + Math.sin(a) * r), c: col });
    }
  }
  group.add(merged('flower-pots', pots, clay, shadows));
  const bloomMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.055, 0), new THREE.MeshStandardMaterial({ roughness: 0.8 }), blooms.length);
  const m = new THREE.Matrix4();
  blooms.forEach((b, i) => {
    bloomMesh.setMatrixAt(i, m.makeTranslation(b.p.x, b.p.y, b.p.z));
    bloomMesh.setColorAt(i, b.c);
  });
  bloomMesh.name = 'pot-flowers';
  bloomMesh.castShadow = shadows;
  group.add(bloomMesh);

  // ---------------------------------------------------------------- diyas (clay oil lamps)
  const diyaPts: THREE.Vector3[] = [];
  for (let x = 3.0; x <= 5.85; x += 0.41) diyaPts.push(new THREE.Vector3(x, 0.03, -4.25));
  for (const [dx, dz] of [[-0.38, 0.38], [0.38, 0.38], [-0.38, -0.38], [0.38, -0.38]]) diyaPts.push(new THREE.Vector3(tx + dx, 0.13, tz + dz));
  diyaPts.push(new THREE.Vector3(tx, 0.45, tz + 0.3)); // in the shrine niche
  const diyas: Part[] = diyaPts.map((p) => [new THREE.CylinderGeometry(0.055, 0.035, 0.035, 10), p.x, p.y + 0.017, p.z]);
  group.add(merged('diyas', diyas, clay, false));
  const flames: Part[] = diyaPts.map((p) => [new THREE.SphereGeometry(0.018, 6, 4).scale(1, 1.8, 1), p.x, p.y + 0.07, p.z]);
  group.add(merged('diya-flames', flames, flame, false));

  const warm = (n: number, c: number) => Array.from({ length: n }, () => new THREE.Color(c));
  const glows = [
    createGlow(lanternPts, warm(lanternPts.length, 0xffc27a), 0.9),
    createGlow(diyaPts.map((p) => p.clone().setY(p.y + 0.08)), warm(diyaPts.length, 0xffa040), 0.28),
  ];
  for (const g of glows) group.add(g.points);

  return { group, night: [[lanternGlass, 2.2]], flame, glows };
}
