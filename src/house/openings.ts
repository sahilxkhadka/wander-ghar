import * as THREE from 'three';
import { bakedBox, holeRect, Opening, SURROUND } from './geometry';
import type { HouseMaterials } from './materials';

/** Geometry gathered from every opening and merged into one mesh per repetition system. */
export interface RepetitionSink {
  grille: THREE.BufferGeometry[];
}

const PROUD = 0.05; // surround projection beyond the brick face
const SET_BACK = -0.08; // sash / door plane inside the reveal
const BAR_PITCH = 0.11; // grille bar spacing measured on the east windows

function local(name: string, mat: THREE.Material, w: number, h: number, d: number, cx: number, cy: number, cz: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(cx, cy, cz);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.explodeWithParent = true;
  return m;
}

function plane(name: string, mat: THREE.Material, w: number, h: number, cx: number, cy: number, cz: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(cx, cy, cz);
  m.name = name;
  m.userData.explodeWithParent = true;
  return m;
}

function surround(g: THREE.Group, op: Opening, mats: HouseMaterials, withSill: boolean) {
  const [u0, u1] = op.u;
  const [y0, y1] = op.y;
  const s = SURROUND;
  const d = PROUD + 0.03;
  const cz = PROUD - d / 2;
  g.add(local('surround-top', mats.trim, u1 - u0, s, d, (u0 + u1) / 2, y1 - s / 2, cz));
  const sideBottom = withSill ? y0 + s : y0;
  g.add(local('surround-left', mats.trim, s, y1 - s - sideBottom, d, u0 + s / 2, (y1 - s + sideBottom) / 2, cz));
  g.add(local('surround-right', mats.trim, s, y1 - s - sideBottom, d, u1 - s / 2, (y1 - s + sideBottom) / 2, cz));
  if (withSill) g.add(local('sill', mats.trim, u1 - u0 + 0.08, s, d + 0.03, (u0 + u1) / 2, y0 + s / 2, cz + 0.015));
}

/** Blue-grey lining on the four reveal faces of the hole (wall depth `depth`). */
function reveals(g: THREE.Group, hole: number[], mats: HouseMaterials, depth: number, bottom: boolean) {
  const [hu0, hv0, hu1, hv1] = hole;
  const t = 0.012, cz = -depth / 2;
  g.add(local('reveal-top', mats.trim, hu1 - hu0, t, depth, (hu0 + hu1) / 2, hv1 - t / 2 + 0.002, cz));
  if (bottom) g.add(local('reveal-bottom', mats.trim, hu1 - hu0, t, depth, (hu0 + hu1) / 2, hv0 + t / 2 - 0.002, cz));
  g.add(local('reveal-left', mats.trim, t, hv1 - hv0, depth, hu0 + t / 2 - 0.002, (hv0 + hv1) / 2, cz));
  g.add(local('reveal-right', mats.trim, t, hv1 - hv0, depth, hu1 - t / 2 + 0.002, (hv0 + hv1) / 2, cz));
}

function sashes(g: THREE.Group, hole: number[], leaves: number, frameMat: THREE.Material, mats: HouseMaterials) {
  const [hu0, hv0, hu1, hv1] = hole;
  const w = hu1 - hu0, h = hv1 - hv0;
  const f = 0.045;
  const z = SET_BACK;
  g.add(plane('glass', mats.glass, w, h, (hu0 + hu1) / 2, (hv0 + hv1) / 2, z - 0.01));
  g.add(local('frame-top', frameMat, w, f, 0.05, (hu0 + hu1) / 2, hv1 - f / 2, z));
  g.add(local('frame-bottom', frameMat, w, f, 0.05, (hu0 + hu1) / 2, hv0 + f / 2, z));
  g.add(local('frame-left', frameMat, f, h, 0.05, hu0 + f / 2, (hv0 + hv1) / 2, z));
  g.add(local('frame-right', frameMat, f, h, 0.05, hu1 - f / 2, (hv0 + hv1) / 2, z));
  for (let i = 1; i < leaves; i++) {
    g.add(local('mullion', frameMat, 0.06, h, 0.06, hu0 + (w * i) / leaves, (hv0 + hv1) / 2, z + (i % 2 ? 0.02 : -0.02)));
  }
}

function backdrop(g: THREE.Group, hole: number[], mat: THREE.Material) {
  const [hu0, hv0, hu1, hv1] = hole;
  g.add(plane('backdrop', mat, hu1 - hu0, hv1 - hv0, (hu0 + hu1) / 2, (hv0 + hv1) / 2, -0.2));
}

function grille(hole: number[], m: THREE.Matrix4, sink: RepetitionSink, opts: { flats?: boolean } = {}) {
  const [hu0, hv0, hu1, hv1] = hole;
  const w = hu1 - hu0, h = hv1 - hv0;
  const n = Math.max(2, Math.round(w / BAR_PITCH));
  const z = -0.03;
  for (let i = 1; i < n; i++) sink.grille.push(bakedBox(0.017, h, 0.017, m, hu0 + (w * i) / n, (hv0 + hv1) / 2, z));
  if (opts.flats !== false) {
    for (const fy of [hv0 + 0.08, hv1 - 0.08]) sink.grille.push(bakedBox(w, 0.03, 0.012, m, (hu0 + hu1) / 2, fy, z - 0.012));
  }
}

function doorLeaf(g: THREE.Group, u0: number, u1: number, v0: number, v1: number, mats: HouseMaterials) {
  const w = u1 - u0, h = v1 - v0;
  const z = SET_BACK;
  g.add(local('door-leaf', mats.doorWhite, w, h, 0.045, (u0 + u1) / 2, (v0 + v1) / 2, z));
  const pw = (w - 0.24) / 2;
  const rows = [0.28, 0.32, 0.4].map((r) => r * (h - 0.3));
  let y = v0 + 0.1;
  for (const ph of rows) {
    for (let c = 0; c < 2; c++) {
      g.add(local('door-panel', mats.doorWhite, pw, ph, 0.014, u0 + 0.08 + pw / 2 + c * (pw + 0.08), y + ph / 2, z + 0.028));
    }
    y += ph + 0.05;
  }
  g.add(local('door-handle', mats.lampBase, 0.03, 0.14, 0.04, u1 - 0.09, v0 + 1.0, z + 0.04));
  // white door frame inside the reveal
  const f = 0.05;
  g.add(local('door-frame-l', mats.doorWhite, f, h, 0.1, u0 - f / 2 + 0.001, (v0 + v1) / 2, z));
  g.add(local('door-frame-r', mats.doorWhite, f, h, 0.1, u1 + f / 2 - 0.001, (v0 + v1) / 2, z));
}

/**
 * Builds one opening unit in facade-local space (u along the facade, y up, +z outward) and
 * returns it transformed into the world. Grille bars are baked straight into `sink`.
 */
export function buildOpening(op: Opening, m: THREE.Matrix4, mats: HouseMaterials, sink: RepetitionSink): THREE.Group | null {
  if (op.kind === 'void') return null;
  const g = new THREE.Group();
  g.name = op.id;
  g.userData.partId = op.id;
  g.userData.evidence = op.evidence ?? 'measured';
  const hole = holeRect(op);
  const [hu0, hv0, hu1, hv1] = hole;
  const isDoor = op.kind.startsWith('door');
  surround(g, op, mats, !isDoor);
  reveals(g, hole, mats, 0.23, !isDoor);

  switch (op.kind) {
    case 'slide3-curtain':
      backdrop(g, hole, mats.curtain);
      sashes(g, hole, 3, mats.frameDark, mats);
      break;
    case 'grille-slide2-curtain':
      backdrop(g, hole, mats.curtain);
      sashes(g, hole, 2, mats.grille, mats);
      grille(hole, m, sink);
      break;
    case 'grille-slide2':
      backdrop(g, hole, mats.interior);
      sashes(g, hole, 2, mats.grille, mats);
      grille(hole, m, sink);
      break;
    case 'grille-blinds':
      backdrop(g, hole, mats.blinds);
      sashes(g, hole, 2, mats.grille, mats);
      grille(hole, m, sink);
      break;
    case 'louvre': {
      backdrop(g, hole, mats.interior);
      const n = 5;
      for (let i = 0; i < n; i++) {
        const slat = local('louvre-slat', mats.glass, hu1 - hu0, (hv1 - hv0) / n, 0.006, (hu0 + hu1) / 2, hv0 + ((i + 0.5) * (hv1 - hv0)) / n, SET_BACK);
        slat.rotation.x = -0.5;
        g.add(slat);
      }
      sashes(g, hole, 1, mats.grille, mats);
      break;
    }
    case 'door-grille-transom':
    case 'door-glass-transom': {
      const tH = 0.42;
      const split = hv1 - tH;
      doorLeaf(g, hu0 + 0.05, hu1 - 0.05, hv0, split - 0.05, mats);
      g.add(local('transom-bar', mats.doorWhite, hu1 - hu0, 0.06, 0.08, (hu0 + hu1) / 2, split - 0.025, SET_BACK));
      const th = [hu0 + 0.05, split, hu1 - 0.05, hv1 - 0.03];
      if (op.kind === 'door-grille-transom') {
        backdrop(g, th, mats.blinds);
        sashes(g, th, 2, mats.doorWhite, mats);
        grille(th, m, sink, { flats: false });
      } else {
        backdrop(g, th, mats.curtain);
        sashes(g, th, 1, mats.doorWhite, mats);
      }
      break;
    }
    case 'door-plain':
      doorLeaf(g, hu0 + 0.05, hu1 - 0.05, hv0, hv1 - 0.03, mats);
      break;
    default:
      throw new Error(`unknown opening kind ${op.kind}`);
  }
  g.applyMatrix4(m);
  return g;
}
