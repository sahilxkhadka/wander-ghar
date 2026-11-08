import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type V2 = [number, number];

export interface Opening {
  id: string;
  u: V2;
  y: V2;
  kind: string;
  evidence?: string;
  face?: string;
}

export interface Facade {
  id: string;
  start: V2;
  end: V2;
  normal: V2;
  openings: Opening[];
}

/** Window surrounds are measured on their outer edge; the hole is inset by this much. */
export const SURROUND = 0.1;

/** Box with UVs in metres on every face (constant brick / paving texel density). */
export function metricBox(w: number, h: number, d: number): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const faceScale: V2[] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * faceScale[f][0], uv.getY(k) * faceScale[f][1]);
    }
  }
  return g;
}

/** Named mesh from a metric box given its min corner (x0,y0,z0) and size. */
export function boxAt(name: string, mat: THREE.Material | THREE.Material[], x0: number, y0: number, z0: number, w: number, h: number, d: number): THREE.Mesh {
  const m = new THREE.Mesh(metricBox(w, h, d), mat);
  m.position.set(x0 + w / 2, y0 + h / 2, z0 + d / 2);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Box geometry (centre, size) baked into a world transform; used for merged repetition sets. */
export function bakedBox(w: number, h: number, d: number, matrix: THREE.Matrix4, cx = 0, cy = 0, cz = 0): THREE.BufferGeometry {
  const g = metricBox(w, h, d);
  g.translate(cx, cy, cz);
  g.applyMatrix4(matrix);
  return g;
}

export function mergedMesh(name: string, geos: THREE.BufferGeometry[], mat: THREE.Material): THREE.Mesh | null {
  if (!geos.length) return null;
  const g = mergeGeometries(geos.map((x) => x.index ? x.toNonIndexed() : x), false);
  geos.forEach((x) => x.dispose());
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Local frame of a facade: X along the facade (start -> end), Y up, Z = outward normal.
 * (dir x up = normal holds for every facade in layout.json.)
 */
export function facadeMatrix(f: Pick<Facade, 'start' | 'end' | 'normal'>, offsetN = 0): { m: THREE.Matrix4; length: number } {
  const [sx, sz] = f.start;
  const [ex, ez] = f.end;
  const length = Math.hypot(ex - sx, ez - sz);
  const dir = new THREE.Vector3((ex - sx) / length, 0, (ez - sz) / length);
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3(f.normal[0], 0, f.normal[1]);
  const m = new THREE.Matrix4().makeBasis(dir, up, n);
  m.setPosition(sx + n.x * offsetN, 0, sz + n.z * offsetN);
  return { m, length };
}

/** Hole rectangle (u0,y0,u1,y1) cut in the wall for an opening. */
export function holeRect(op: Opening): [number, number, number, number] {
  if (op.kind === 'void') return [op.u[0], op.y[0], op.u[1], op.y[1]];
  const isDoor = op.kind.startsWith('door');
  return [op.u[0] + SURROUND, isDoor ? op.y[0] : op.y[0] + SURROUND, op.u[1] - SURROUND, op.y[1] - SURROUND];
}

/**
 * Brick wall for one facade: a Shape in (u, y) with rectangular holes, extruded inward by
 * `thickness`. Openings that touch the wall base (porch void) are cut into the outline instead.
 * Group 0 (front/back caps) gets `capMat`, group 1 (reveals and ends) gets `sideMat`.
 */
export function facadeWall(f: Facade, y0: number, y1: number, thickness: number, capMat: THREE.Material, sideMat: THREE.Material, trim: V2 = [0, 0]): THREE.Mesh {
  const { m, length: fullLength } = facadeMatrix(f);
  // trim[0]/trim[1] pull the wall ends back so a perpendicular wall owns the corner block
  // (two coincident brick faces at a convex corner z-fight)
  const u0 = trim[0], length = fullLength - trim[1];
  const shape = new THREE.Shape();
  // openings reaching the wall base (porch void, doors on a sill-less wall) are notched into the
  // outline: a hole sharing an edge with the outline does not triangulate
  const baseCuts = f.openings.filter((o) => holeRect(o)[1] <= y0 + 1e-3 && holeRect(o)[3] > y0).sort((a, b) => a.u[0] - b.u[0]);
  shape.moveTo(u0, y0);
  for (const c of baseCuts) {
    const [u0, , u1, top] = holeRect(c);
    if (top >= y1) continue;
    shape.lineTo(u0, y0);
    shape.lineTo(u0, top);
    shape.lineTo(u1, top);
    shape.lineTo(u1, y0);
  }
  shape.lineTo(length, y0);
  shape.lineTo(length, y1);
  shape.lineTo(u0, y1);
  shape.lineTo(u0, y0);
  for (const o of f.openings) {
    if (baseCuts.includes(o)) continue;
    const [u0, v0, u1, v1] = holeRect(o);
    if (v1 <= y0 || v0 >= y1) continue;
    const h = new THREE.Path();
    h.moveTo(u0, v0);
    h.lineTo(u0, v1);
    h.lineTo(u1, v1);
    h.lineTo(u1, v0);
    h.lineTo(u0, v0);
    shape.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness);
  const mesh = new THREE.Mesh(g, [capMat, sideMat]);
  mesh.applyMatrix4(m);
  mesh.name = `wall-${f.id}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Corner trims for walls built from consecutive facades of a closed outline: walls running along
 * z give way at convex corners (x-running walls own the corner block). Outline order as in layout.
 */
export function cornerTrims(facades: Facade[], thickness: number): V2[] {
  const n = facades.length;
  const convexAt = (a: Facade, b: Facade) => {
    const e1 = [a.end[0] - a.start[0], a.end[1] - a.start[1]];
    const e2 = [b.end[0] - b.start[0], b.end[1] - b.start[1]];
    return e1[0] * e2[1] - e1[1] * e2[0] < 0;
  };
  return facades.map((f, i) => {
    const alongZ = Math.abs(f.end[1] - f.start[1]) > Math.abs(f.end[0] - f.start[0]);
    if (!alongZ) return [0, 0];
    const prev = facades[(i - 1 + n) % n], next = facades[(i + 1) % n];
    return [convexAt(prev, f) ? thickness : 0, convexAt(f, next) ? thickness : 0];
  });
}

/** Horizontal slab from an (x, z) outline, spanning y0..y1. Group 0 = top/bottom, 1 = edges. */
export function slabFromOutline(name: string, outline: V2[], y0: number, y1: number, mats: THREE.Material | THREE.Material[]): THREE.Mesh {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0, 0);
  const m = new THREE.Mesh(g, mats);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Flat horizontal polygon at height y (facing up), UVs in metres. */
export function floorFromOutline(name: string, outline: V2[], y: number, mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  m.receiveShadow = true;
  return m;
}

export function pointInPolygon(x: number, z: number, poly: V2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Unit inward normal (x, z) of an edge of `poly`, found by probing both sides of its midpoint. */
export function inwardNormal(a: V2, b: V2, poly: V2[]): V2 {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const n: V2 = [-dz / len, dx / len];
  const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  return pointInPolygon(mx + n[0] * 0.05, mz + n[1] * 0.05, poly) ? n : [-n[0], -n[1]];
}

/** Box running from a to b in plan (x, z), offset along `side` normal, between heights y0..y1. */
export function segmentBox(name: string, mat: THREE.Material | THREE.Material[], a: V2, b: V2, y0: number, y1: number, thickness: number, side: V2, inset = 0, extend = 0): THREE.Mesh {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len;
  const off = inset + thickness / 2;
  const cx = (a[0] + b[0]) / 2 + side[0] * off;
  const cz = (a[1] + b[1]) / 2 + side[1] * off;
  const m = new THREE.Mesh(metricBox(len + 2 * extend, y1 - y0, thickness), mat);
  m.position.set(cx, (y0 + y1) / 2, cz);
  m.rotation.y = -Math.atan2(uz, ux);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Points every `step` metres along a polyline (inclusive of the first point). */
export function samplePolyline(pts: THREE.Vector3[], step: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = a.distanceTo(b);
    let t = carry;
    while (t <= len) {
      out.push(a.clone().lerp(b, t / len));
      t += step;
    }
    carry = t - len;
  }
  return out;
}
