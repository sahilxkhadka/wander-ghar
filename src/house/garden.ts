import * as THREE from 'three';
import { boxAt, floorFromOutline, V2 } from './geometry';
import type { HouseMaterials } from './materials';
import { seeded } from './textures';

/**
 * The garden inside the compound wall. Not visible in the photo (the wall hides it); the owner
 * states it exists, so its layout is an assumption: lawn, marigold beds along the wall,
 * bougainvillea at the gate, a broad-leaf tree at the east, banana plants and a stone path.
 */
export interface GardenInput {
  innerOutline: V2[];
  frontInnerZ: (x: number) => number;
  tree: { pos: V2; height: number; crown: number };
  bougainvillea: V2;
  banana: V2[];
  gateX: V2;
}

const dummy = new THREE.Object3D();

function instanced(name: string, geo: THREE.BufferGeometry, mat: THREE.Material, items: { p: THREE.Vector3; s: number; r?: number; c?: THREE.Color }[]): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    dummy.position.copy(it.p);
    dummy.rotation.set(0, it.r ?? 0, 0);
    dummy.scale.setScalar(it.s);
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
    if (it.c) im.setColorAt(i, it.c);
  });
  im.name = name;
  im.castShadow = true;
  im.receiveShadow = true;
  im.userData.explodeWithParent = true;
  return im;
}

export function buildGarden(g: GardenInput, mats: HouseMaterials, detail: number): THREE.Group {
  const root = new THREE.Group();
  root.name = 'garden';
  const rnd = seeded(97);

  const lawn = floorFromOutline('lawn', g.innerOutline, 0.005, mats.lawn);
  lawn.userData.explodeWithParent = true;
  root.add(lawn);

  // stone path: gate -> notch, entrance landing under the balcony, stepping stones to the east lawn
  const [gx0, gx1] = g.gateX;
  const path = [
    boxAt('path-gate', mats.paving, gx0 + 0.05, 0, -0.05, gx1 - gx0 - 0.1, 0.03, g.frontInnerZ((gx0 + gx1) / 2) + 0.05),
    boxAt('path-notch', mats.paving, 0, 0, -3.86, 1.55, 0.03, 3.86),
  ];
  for (let i = 0; i < 6; i++) path.push(boxAt('stepping-stone', mats.paving, 1.9 + i * 0.75, 0, -1.2 - (i % 2) * 0.2, 0.45, 0.04, 0.35));
  // entrance steps up to the 0.45 m plinth at the door on the notch face
  path.push(boxAt('step-1', mats.kerb, 0, 0, -3.86, 1.05, 0.15, 1.16));
  path.push(boxAt('step-2', mats.kerb, 0, 0.15, -3.86, 0.75, 0.15, 1.16));
  path.push(boxAt('step-3', mats.kerb, 0, 0.3, -3.86, 0.45, 0.15, 1.16));
  path.forEach((p) => { p.userData.explodeWithParent = true; root.add(p); });
  if (detail < 2) return root;

  // marigold beds along the inside of the front wall (Tihar marigolds)
  const bushGeo = new THREE.IcosahedronGeometry(0.2, 2);
  const bloomGeo = new THREE.IcosahedronGeometry(0.055, 0);
  const bushes: { p: THREE.Vector3; s: number; r: number }[] = [];
  const blooms: { p: THREE.Vector3; s: number; c: THREE.Color }[] = [];
  const marigold = [new THREE.Color(0xff8c0a), new THREE.Color(0xffb000), new THREE.Color(0xe8601a)];
  const bed = (x0: number, x1: number, off: number) => {
    for (let x = x0; x <= x1; x += 0.38) {
      const p = new THREE.Vector3(x + (rnd() - 0.5) * 0.1, 0.12, g.frontInnerZ(x) - off - rnd() * 0.12);
      bushes.push({ p, s: 0.8 + rnd() * 0.5, r: rnd() * 6 });
      for (let k = 0; k < 6; k++) {
        blooms.push({ p: p.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.3, 0.12 + rnd() * 0.12, (rnd() - 0.5) * 0.3)), s: 0.8 + rnd() * 0.6, c: marigold[Math.floor(rnd() * 3)] });
      }
    }
  };
  bed(-7.0, gx0 - 0.4, 0.22);
  bed(gx1 + 0.9, 7.0, 0.25);
  bed(gx1 + 1.2, 6.8, 0.65);
  // shrubs along the east boundary and rear
  // kept clear of the boundary walls (inner faces at x = 7.27, z = -10.77)
  for (let z = 0.6; z > -10.2; z -= 1.3) bushes.push({ p: new THREE.Vector3(6.6 + (rnd() - 0.5) * 0.15, 0.35, z), s: 2.0 + rnd() * 0.9, r: rnd() * 6 });
  for (let x = -7.5; x < 6.0; x += 1.6) bushes.push({ p: new THREE.Vector3(x, 0.3, -10.25), s: 1.8 + rnd() * 0.8, r: rnd() * 6 });
  root.add(instanced('shrubs', bushGeo, mats.leaf, bushes));
  root.add(instanced('marigolds', bloomGeo, mats.flowerOrange, blooms));

  // bougainvillea climbing over the wall beside the right gate pier
  const [bx, bz] = g.bougainvillea;
  const bouBlobs: { p: THREE.Vector3; s: number; r: number }[] = [];
  const bouFlowers: { p: THREE.Vector3; s: number; c: THREE.Color }[] = [];
  for (let i = 0; i < 26; i++) {
    const h = rnd() * 1.55;
    const p = new THREE.Vector3(bx + (rnd() - 0.3) * 1.4, 0.3 + h, bz - 0.2 + (rnd() - 0.5) * 0.5 + (h > 1.7 ? 0.25 : 0));
    bouBlobs.push({ p, s: 1.1 + rnd() * 0.8, r: rnd() * 6 });
    for (let k = 0; k < 4; k++) bouFlowers.push({ p: p.clone().add(new THREE.Vector3((rnd() - 0.5) * 0.4, (rnd() - 0.3) * 0.3, (rnd() - 0.5) * 0.4)), s: 1.1, c: new THREE.Color(rnd() < 0.8 ? 0xd9277a : 0xf06aa8) });
  }
  root.add(instanced('bougainvillea', bushGeo, mats.leaf, bouBlobs));
  root.add(instanced('bougainvillea-flowers', bloomGeo, mats.flowerPink, bouFlowers));

  // broad-leaf tree at the east (its leaves hang over the wall at the right of the photo)
  const t = g.tree;
  const tree = new THREE.Group();
  tree.name = 'tree';
  tree.userData.explodeWithParent = true;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.17, t.height * 0.55, 8), mats.trunk);
  trunk.position.set(t.pos[0], (t.height * 0.55) / 2, t.pos[1]);
  trunk.castShadow = true;
  trunk.name = 'tree-trunk';
  tree.add(trunk);
  // crown = a dark core plus many crossed leaf cards (alpha-tested broad leaves)
  const core: { p: THREE.Vector3; s: number; r: number }[] = [];
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * t.crown * 0.6;
    core.push({ p: new THREE.Vector3(t.pos[0] + Math.cos(a) * r, t.height * 0.6 + rnd() * t.height * 0.3, t.pos[1] + Math.sin(a) * r), s: 1.0 + rnd() * 0.5, r: rnd() * 6 });
  }
  tree.add(instanced('tree-crown-core', new THREE.IcosahedronGeometry(0.28, 2), mats.leaf, core));
  const cards = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mats.leafCard, 260);
  for (let i = 0; i < 260; i++) {
    const low = i > 190; // lower branches leaning south over the wall
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * t.crown;
    const p = low
      ? new THREE.Vector3(t.pos[0] - 0.6 + rnd() * 1.4, 1.5 + rnd() * 1.5, t.pos[1] + 0.5 + rnd() * 1.1)
      : new THREE.Vector3(t.pos[0] + Math.cos(a) * r, t.height * 0.45 + rnd() * t.height * 0.55, t.pos[1] + Math.sin(a) * r);
    dummy.position.copy(p);
    dummy.rotation.set(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI);
    dummy.scale.setScalar(0.8 + rnd() * 0.7);
    dummy.updateMatrix();
    cards.setMatrixAt(i, dummy.matrix);
  }
  cards.name = 'tree-leaves';
  cards.castShadow = true;
  cards.userData.explodeWithParent = true;
  tree.add(cards);
  root.add(tree);

  // banana plants
  for (const [x, z] of g.banana) {
    const b = new THREE.Group();
    b.name = 'banana-plant';
    b.userData.explodeWithParent = true;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 1.8, 8), mats.bananaTrunk);
    stem.position.set(x, 0.9, z);
    stem.castShadow = true;
    b.add(stem);
    for (let k = 0; k < 7; k++) {
      // leaf blade in the XZ plane running out along +x, rising then drooping
      const geo = new THREE.PlaneGeometry(1.5, 0.42, 6, 1);
      geo.translate(0.75, 0, 0);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const s = pos.getX(i) / 1.5;
        pos.setY(i, 0.5 * s - 0.75 * s * s);
      }
      geo.computeVertexNormals();
      const leaf = new THREE.Mesh(geo, mats.banana);
      leaf.position.set(x, 1.7 + rnd() * 0.35, z);
      leaf.rotation.y = (k / 7) * Math.PI * 2 + rnd() * 0.4;
      leaf.castShadow = true;
      b.add(leaf);
    }
    root.add(b);
  }

  // clay pots by the entrance
  const potGeo = new THREE.CylinderGeometry(0.17, 0.12, 0.3, 12);
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(potGeo, mats.pot);
    p.position.set(1.3, 0.15, -3.6 + i * 0.42);
    p.name = 'pot';
    p.castShadow = true;
    p.userData.explodeWithParent = true;
    root.add(p);
    const plant = new THREE.Mesh(bushGeo, i === 1 ? mats.flowerRed : mats.leaf);
    plant.position.set(1.3, 0.42, -3.6 + i * 0.42);
    plant.scale.setScalar(1.1);
    plant.name = 'pot-plant';
    plant.userData.explodeWithParent = true;
    root.add(plant);
  }
  return root;
}
