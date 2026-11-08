import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import layoutJson from './layout.json';
import {
  boxAt, bakedBox, cornerTrims, Facade, facadeMatrix, facadeWall, floorFromOutline, inwardNormal, mergedMesh,
  metricBox, segmentBox, slabFromOutline, V2,
} from './geometry';
import { createMaterials, HouseMaterials } from './materials';
import { buildOpening, RepetitionSink } from './openings';
import { buildGarden } from './garden';
import { buildFestiveLights, domeLamp, HangingRun } from './festiveLights';

/**
 * Wander Ghar — procedural Three.js reconstruction of a Kathmandu house from one night photo.
 *
 * Every dimension comes from src/house/layout.json (also the source of object-sculpt-spec.json),
 * which records whether each value was measured from the photo (camera + dimension fit) or
 * assumed (rear / west facades, garden). Part names match spec component ids.
 */
export const layout = layoutJson;
export type Layout = typeof layoutJson;

export const PASS_ORDER = [
  'blockout', 'structural-pass', 'form-refinement', 'material-pass',
  'surface-pass', 'lighting-pass', 'interaction-pass', 'optimization-pass',
] as const;
export type PassId = (typeof PASS_ORDER)[number];

export interface HouseModel {
  root: THREE.Group;
  materials: HouseMaterials;
  detail: number;
}

function part(id: string, parent: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.name = id;
  g.userData.partId = id;
  parent.add(g);
  return g;
}

function flag<T extends THREE.Object3D>(o: T): T {
  o.userData.explodeWithParent = true;
  return o;
}

const v2 = (p: number[]): V2 => [p[0], p[1]];

/** z of the street face of the compound wall at x (piecewise linear along the fitted polyline). */
function wallFrontZ(poly: V2[], x: number): number {
  for (let i = 0; i < poly.length - 1; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[i + 1];
    if (x <= bx || i === poly.length - 2) return az + ((x - ax) * (bz - az)) / (bx - ax);
  }
  return poly[0][1];
}

export function createHouseModel(pass: PassId = 'optimization-pass'): HouseModel {
  const detail = PASS_ORDER.indexOf(pass);
  const L = layout.levels;
  const T = layout.wallThickness;
  const mats = createMaterials({ textured: detail >= 3, surface: detail >= 4 });
  const root = part('wander-ghar', new THREE.Group());
  root.removeFromParent();
  root.userData.pass = pass;
  root.userData.layoutProvenance = layout.provenance;

  const footprint = layout.footprint.map(v2);
  const slabOutline = layout.slab2Outline.map(v2);
  const facades = (layout.facades as unknown as Facade[]).map((f) => ({ ...f, openings: [...f.openings] }));

  // ---------------------------------------------------------------- house shell
  const house = part('house-shell', root);
  if (detail === 0) {
    house.add(flag(slabFromOutline('house-mass', footprint, 0, L.soffit2, [mats.brick, mats.brick])));
  } else {
    const trims = cornerTrims(facades, T);
    facades.forEach((f, i) => house.add(flag(facadeWall(f, 0, L.soffit2, T, mats.brick, mats.brick, trims[i]))));
    // open porch under the west bay: back wall with door, side returns, ceiling, raised floor
    const porch = layout.porch;
    const porchBack: Facade = { id: 'porch-back', start: [porch.x[0], porch.backZ], end: [porch.x[1], porch.backZ], normal: [0, 1], openings: [{ id: 'porch-door', u: [0.45, 1.35], y: [0.45, 2.55], kind: 'door-plain', evidence: 'assumed' }] };
    // the returns start behind the south wall: inside its thickness the opening's own brick reveal
    // shows, and sharing that plane made the two surfaces z-fight
    const porchWest: Facade = { id: 'porch-west', start: [porch.x[0], -T], end: [porch.x[0], porch.backZ], normal: [1, 0], openings: [] };
    const porchEast: Facade = { id: 'porch-east', start: [porch.x[1], porch.backZ], end: [porch.x[1], -T], normal: [-1, 0], openings: [] };
    for (const f of [porchBack, porchWest, porchEast]) house.add(flag(facadeWall(f, 0, 3.25, T, mats.soffit, mats.soffit)));
    house.add(flag(boxAt('porch-ceiling', mats.soffit, porch.x[0], 3.05, porch.backZ, porch.x[1] - porch.x[0], 0.2, -porch.backZ)));
    house.add(flag(boxAt('porch-floor', mats.kerb, porch.x[0], 0, porch.backZ, porch.x[1] - porch.x[0], 0.45, -porch.backZ)));
    facades.push(porchBack);

    // interior core: dark volume just inside the walls so no opening ever looks through the house
    const core = part('interior-core', house);
    const k = T + 0.01;
    const [fx0] = footprint[0];
    const coreBoxes: [number, number, number, number][] = [
      [fx0 + k, -9.6 + k, -k, porch.backZ - k],
      [porch.x[1] + k, porch.backZ - k, -k, -k],
      [fx0 + k, porch.backZ - k, porch.x[0] - k, -k],
      [-k, -9.6 + k, 2.49 - k, -3.86 - k],
    ];
    for (const [x0, z0, x1, z1] of coreBoxes) core.add(flag(boxAt('core', mats.interior, x0, 0.05, z0, x1 - x0, L.soffit2 - 0.1, z1 - z0)));
    core.add(flag(boxAt('core-room', mats.interior, layout.stairRoom.x[0] + k, L.slab2Top + 0.01, layout.stairRoom.z[0] + k, layout.stairRoom.x[1] - layout.stairRoom.x[0] - 2 * k, L.roomEave - L.slab2Top - 0.05, layout.stairRoom.z[1] - layout.stairRoom.z[0] - 2 * k)));

    // plinth band and first-floor string course wrap every facade
    const plinth = part('plinth-band', house);
    const band = part('band-1f', house);
    for (const f of facades) {
      if (f.id === 'porch-back') continue;
      const n: V2 = [f.normal[0], f.normal[1]];
      plinth.add(flag(segmentBox(`plinth-${f.id}`, mats.trim, f.start, f.end, 0, L.plinthTop, 0.05, n, -0.02, 0.03)));
      band.add(flag(segmentBox(`band-${f.id}`, mats.trim, f.start, f.end, L.band1Bottom, L.band1Top, 0.08, n, -0.03, 0.05)));
    }
    const pil = layout.pilaster;
    part('pilaster-west', house).add(flag(boxAt('pilaster', mats.trim, pil.x[0], pil.y[0], -0.02, pil.x[1] - pil.x[0], pil.y[1] - pil.y[0], 0.06)));
    if (detail >= 2) {
      const col = part('porch-column', house);
      col.add(flag(boxAt('porch-column-shaft', mats.trim, porch.column[0] - 0.12, 0.45, porch.column[1] - 0.12, 0.24, 2.6, 0.24)));
      col.add(flag(boxAt('porch-column-base', mats.trim, porch.column[0] - 0.16, 0.45, porch.column[1] - 0.16, 0.32, 0.12, 0.32)));
    }

    // painted panel framing the stacked doors (same holes as the doors, 2 cm proud)
    const dp = layout.doorPanel;
    const notch = facades.find((f) => f.id === 'east-notch')!;
    const panelFacade: Facade = {
      id: 'door-panel', start: [0, dp.z[1]], end: [0, dp.z[0]], normal: [1, 0],
      openings: notch.openings.filter((o) => o.kind.startsWith('door')).map((o) => ({ ...o, u: [o.u[0] + dp.z[1], o.u[1] + dp.z[1]] as V2 })),
    };
    const panel = facadeWall(panelFacade, dp.y[0], dp.y[1], 0.02, mats.trim, mats.trim);
    panel.position.x += 0.02;
    part('door-panel', house).add(flag(panel));
  }

  // ---------------------------------------------------------------- openings
  const sink: RepetitionSink = { grille: [] };
  if (detail >= 2) {
    const windows = part('windows', house);
    const doors = part('doors', house);
    for (const f of facades) {
      const { m } = facadeMatrix(f);
      for (const op of f.openings) {
        const unit = buildOpening(op, m, mats, sink);
        if (unit) (op.kind.startsWith('door') ? doors : windows).add(unit);
      }
    }
  }

  // ---------------------------------------------------------------- balcony in the notch
  if (detail >= 1) {
    const b = layout.balcony;
    const bal = part('balcony', house);
    const w = b.x[1] - b.x[0], d = b.z[1] - b.z[0];
    bal.add(flag(boxAt('balcony-slab', [mats.trim, mats.trim, mats.terraceFloor, mats.soffit, mats.trim, mats.trim], b.x[0] - 0.05, b.slab[0], b.z[0] - 0.02, w + 0.05, b.slab[1] - b.slab[0], d + 0.02)));
    const rail: THREE.BufferGeometry[] = [];
    const I = new THREE.Matrix4();
    const top = b.railTop, base = b.slab[1];
    const southZ = b.z[1] - 0.04, eastX = b.x[1] - 0.04;
    for (let x = b.x[0] + 0.1; x < eastX - 0.05; x += 0.11) rail.push(bakedBox(0.025, top - base - 0.05, 0.025, I, x, (top + base) / 2 - 0.02, southZ));
    for (let z = southZ - 0.11; z > b.z[0] + 0.05; z -= 0.11) rail.push(bakedBox(0.025, top - base - 0.05, 0.025, I, eastX, (top + base) / 2 - 0.02, z));
    rail.push(bakedBox(eastX - b.x[0], 0.045, 0.06, I, (b.x[0] + eastX) / 2, top - 0.022, southZ));
    rail.push(bakedBox(0.06, 0.045, southZ - b.z[0], I, eastX, top - 0.022, (southZ + b.z[0]) / 2));
    rail.push(bakedBox(eastX - b.x[0], 0.035, 0.035, I, (b.x[0] + eastX) / 2, base + 0.08, southZ));
    rail.push(bakedBox(0.035, 0.035, southZ - b.z[0], I, eastX, base + 0.08, (southZ + b.z[0]) / 2));
    rail.push(bakedBox(0.06, top - base, 0.06, I, eastX, (top + base) / 2, southZ));
    const balusters = mergedMesh('balusters', rail, mats.steel)!;
    balusters.userData.partId = 'balusters';
    bal.add(balusters);
  }

  // ---------------------------------------------------------------- second-floor slab + terrace
  const slab2 = part('slab-2f', house);
  slab2.add(flag(slabFromOutline('slab-2f-concrete', slabOutline, L.soffit2, L.slab2Top, [mats.soffit, mats.trim])));
  slab2.add(flag(floorFromOutline('terrace-floor', slabOutline, L.slab2Top + 0.004, mats.terraceFloor)));

  const parapets = part('terrace-parapets', slab2);
  const tubes: THREE.BufferGeometry[] = [];
  const tubeGeo = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, 10, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    return g;
  };
  for (const p of layout.parapets) {
    const a = v2(p.from), bb = v2(p.to);
    const side = inwardNormal(a, bb, slabOutline);
    if (p.kind === 'solid' || detail === 0) {
      parapets.add(flag(segmentBox(p.id, mats.brick, a, bb, L.slab2Top, L.parapetHighTop, 0.15, side, 0, 0.075)));
      continue;
    }
    parapets.add(flag(segmentBox(p.id, mats.brick, a, bb, L.slab2Top, L.parapetLowTop, 0.23, side, 0, 0.115)));
    const off = 0.115;
    const A = new THREE.Vector3(a[0] + side[0] * off, 0, a[1] + side[1] * off);
    const B = new THREE.Vector3(bb[0] + side[0] * off, 0, bb[1] + side[1] * off);
    for (const h of L.railHeights) tubes.push(tubeGeo(A.clone().setY(h), B.clone().setY(h), 0.021));
    const len = A.distanceTo(B);
    const posts = Math.max(1, Math.ceil(len / 1.6));
    for (let i = 0; i <= posts; i++) {
      const P = A.clone().lerp(B, i / posts);
      tubes.push(tubeGeo(P.clone().setY(L.parapetLowTop), P.clone().setY(L.railHeights[2] + 0.02), 0.024));
    }
  }
  if (tubes.length) {
    const rails = mergedMesh('rail-tubes', tubes, mats.tube)!;
    rails.userData.partId = 'rail-tubes';
    parapets.add(rails);
  }
  for (const [px, pz] of layout.piers) {
    parapets.add(flag(boxAt('terrace-pier', mats.brick, px - 0.4, L.slab2Top, pz - 0.4, 0.4, L.parapetHighTop + 0.05 - L.slab2Top, 0.4)));
  }

  // stair room ("mumty") with mono-pitch corrugated roof
  const sr = layout.stairRoom;
  const room = part('stair-room', slab2);
  const [rx0, rx1] = sr.x, [rz0, rz1] = sr.z;
  const roomFacades: Facade[] = [
    { id: 'room-south', start: [rx0, rz1], end: [rx1, rz1], normal: [0, 1], openings: [] },
    { id: 'room-east', start: [rx1, rz1], end: [rx1, rz0], normal: [1, 0], openings: [] },
    { id: 'room-north', start: [rx1, rz0], end: [rx0, rz0], normal: [0, -1], openings: [] },
    { id: 'room-west', start: [rx0, rz0], end: [rx0, rz1], normal: [-1, 0], openings: [] },
  ];
  for (const o of sr.openings) roomFacades.find((f) => f.id === `room-${o.face}`)!.openings.push({ ...o, u: v2(o.u), y: v2(o.y) });
  const eave = L.roomEave, ridge = L.roomRidge;
  if (detail === 0) {
    room.add(flag(boxAt('room-mass', mats.brick, rx0, L.slab2Top, rz0, rx1 - rx0, eave - L.slab2Top, rz1 - rz0)));
  } else {
    const roomTrims = cornerTrims(roomFacades, T);
    for (const [i, f] of roomFacades.entries()) {
      room.add(flag(facadeWall(f, L.slab2Top, eave, T, mats.brick, mats.brick, roomTrims[i])));
      if (detail >= 2) {
        const { m } = facadeMatrix(f);
        for (const op of f.openings) {
          const unit = buildOpening(op, m, mats, sink);
          if (unit) room.add(flag(unit));
        }
      }
    }
    // gables: wall rises from the eave (east) to the ridge (west)
    for (const f of [roomFacades[0], roomFacades[2]]) {
      const { m, length } = facadeMatrix(f);
      const tri = new THREE.Shape();
      const westEnd = f.id === 'room-south' ? 0 : length;
      tri.moveTo(0, eave);
      tri.lineTo(length, eave);
      tri.lineTo(westEnd, ridge);
      tri.lineTo(0, eave);
      const g = new THREE.ExtrudeGeometry(tri, { depth: T, bevelEnabled: false });
      g.translate(0, 0, -T);
      const mesh = new THREE.Mesh(g, [mats.brick, mats.brick]);
      mesh.applyMatrix4(m);
      mesh.name = `${f.id}-gable`;
      mesh.castShadow = true;
      room.add(flag(mesh));
    }
    room.add(flag(boxAt('room-west-top', mats.brick, rx0, eave, rz0, T, ridge - eave, rz1 - rz0)));
  }
  const roof = part('stair-room-roof', room);
  {
    const ov = sr.roof.overhang;
    const x0 = rx0 - ov.west, x1 = rx1 + ov.east, z0 = rz0 - ov.north, z1 = rz1 + ov.south;
    const slope = (ridge - eave) / (rx1 - rx0);
    const run = (x1 - x0) * Math.sqrt(1 + slope * slope);
    const depth = z1 - z0;
    const segs = detail >= 2 ? Math.round(depth / 0.019) : 1;
    const g = new THREE.PlaneGeometry(run, depth, 1, segs);
    g.rotateX(-Math.PI / 2);
    if (detail >= 2) {
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) pos.setY(i, 0.018 * Math.sin((pos.getZ(i) / 0.076) * Math.PI * 2));
      g.computeVertexNormals();
    }
    g.rotateZ(-Math.atan(slope));
    const xc = (x0 + x1) / 2;
    g.translate(xc, eave + (rx1 - xc) * slope + 0.1, (z0 + z1) / 2);
    const sheet = new THREE.Mesh(g, mats.corrugated);
    sheet.name = 'roof-sheet';
    sheet.castShadow = true;
    sheet.receiveShadow = true;
    roof.add(flag(sheet));
    if (detail >= 2) {
      const yAt = (x: number) => eave + (rx1 - x) * slope + 0.1;
      const trim = (name: string, a: V2, b: V2, ya: number, yb: number) => {
        const A = new THREE.Vector3(a[0], ya, a[1]), B = new THREE.Vector3(b[0], yb, b[1]);
        const len = A.distanceTo(B);
        const mesh = new THREE.Mesh(metricBox(len, 0.12, 0.03), mats.roofTrim);
        mesh.position.copy(A.clone().add(B).multiplyScalar(0.5)).add(new THREE.Vector3(0, -0.03, 0));
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), B.clone().sub(A).normalize());
        mesh.name = name;
        roof.add(flag(mesh));
      };
      trim('roof-trim-east', [x1, z1], [x1, z0], yAt(x1), yAt(x1));
      trim('roof-trim-south', [x0, z1], [x1, z1], yAt(x0), yAt(x1));
      trim('roof-trim-north', [x0, z0], [x1, z0], yAt(x0), yAt(x1));
    }
  }

  if (detail >= 2) {
    // black polyethylene water tank on a steel stand (assumed; typical of Kathmandu roofs)
    const wt = layout.waterTank;
    const tank = part('water-tank', slab2);
    const [tx, tz] = wt.center;
    const standTop = L.slab2Top + 0.35;
    tank.add(flag(boxAt('tank-stand', mats.gateSteel, tx - 0.6, standTop - 0.05, tz - 0.6, 1.2, 0.05, 1.2)));
    for (const [sx, sz] of [[-0.55, -0.55], [0.5, -0.55], [-0.55, 0.5], [0.5, 0.5]]) tank.add(flag(boxAt('tank-leg', mats.gateSteel, tx + sx, L.slab2Top, tz + sz, 0.05, 0.3, 0.05)));
    const body = new THREE.Mesh(new THREE.CylinderGeometry(wt.radius, wt.radius, wt.height, 32), mats.tank);
    body.position.set(tx, standTop + wt.height / 2, tz);
    body.name = 'tank-body';
    body.castShadow = true;
    tank.add(flag(body));
    for (let i = 1; i < 4; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(wt.radius + 0.005, 0.015, 6, 32), mats.tank);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(tx, standTop + (wt.height * i) / 4, tz);
      ring.name = 'tank-rib';
      tank.add(flag(ring));
    }
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 20), mats.tank);
    lid.position.set(tx, standTop + wt.height + 0.03, tz);
    lid.name = 'tank-lid';
    tank.add(flag(lid));

    // potted plants on the terrace, seen through the rails at P1-P3
    const plants = part('terrace-plants', slab2);
    const potGeo = new THREE.CylinderGeometry(0.16, 0.11, 0.28, 12);
    const leafGeo = new THREE.IcosahedronGeometry(0.22, 1);
    for (const [px, pz] of [[-0.35, 0.3], [-0.35, -0.25], [0.5, -1.05], [1.05, -1.05], [1.05, -2.0]]) {
      const pot = new THREE.Mesh(potGeo, mats.pot);
      pot.position.set(px, L.slab2Top + 0.14, pz);
      pot.name = 'terrace-pot';
      pot.castShadow = true;
      const leaves = new THREE.Mesh(leafGeo, mats.leaf);
      leaves.position.set(px, L.slab2Top + 0.5, pz);
      leaves.scale.set(1.2, 1.5, 1.2);
      leaves.name = 'terrace-plant';
      leaves.castShadow = true;
      plants.add(flag(pot), flag(leaves));
    }

    const lamps = part('lamps', slab2);
    for (const l of layout.lamps) lamps.add(domeLamp(l.id, l.pos as [number, number, number], mats));
  }

  if (sink.grille.length) {
    const grille = mergedMesh('grille-bars', sink.grille, mats.grille)!;
    grille.userData.partId = 'grille-bars';
    (house.getObjectByName('windows') ?? house).add(grille);
  }

  // ---------------------------------------------------------------- compound wall, gate, street
  const c = layout.compound;
  const front = c.frontPolyline.map(v2);
  const wallGroup = part('compound-wall', root);
  const wallSegs: [V2, V2][] = [];
  const [gL, gR] = c.gatePiersX;
  const half = c.pierSize / 2;
  // wall runs: west end -> left pier (via the bend), right pier -> east boundary
  wallSegs.push([front[0], front[1]]);
  wallSegs.push([front[1], [gL + half, wallFrontZ(front, gL + half)]]);
  wallSegs.push([[gR, wallFrontZ(front, gR)], front[2]]);
  wallSegs.push([front[2], [c.eastX, c.rearZ]]);
  wallSegs.push([[c.eastX, c.rearZ], [footprint[0][0], c.rearZ]]);
  wallSegs.push([[footprint[0][0], c.rearZ], [footprint[0][0], -9.6]]);
  wallSegs.push([[footprint[0][0], 0], front[0]]);
  const inward = (a: V2, b: V2): V2 => {
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    return [dz / l, -dx / l];
  };
  wallSegs.forEach(([a, b], i) => {
    const side = inward(a, b);
    wallGroup.add(flag(segmentBox(`compound-wall-${i}`, mats.brickOld, a, b, 0, c.topY, c.thickness, side, 0, 0.02)));
    if (detail >= 2) wallGroup.add(flag(segmentBox(`compound-cap-${i}`, mats.wallCap, a, b, c.topY, c.topY + 0.05, c.thickness + 0.04, side, -0.02, 0.04)));
    if (detail >= 4 && i < 3) {
      // moss / damp band on the street face
      const A = new THREE.Vector3(a[0], 0, a[1]), B = new THREE.Vector3(b[0], 0, b[1]);
      const len = A.distanceTo(B);
      const moss = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.35), mats.moss);
      const uv = moss.geometry.getAttribute('uv') as THREE.BufferAttribute;
      for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * len / 2);
      moss.position.set((a[0] + b[0]) / 2 - side[0] * 0.006, L.street + 0.175, (a[1] + b[1]) / 2 - side[1] * 0.006);
      moss.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
      moss.name = 'moss-band';
      wallGroup.add(flag(moss));
    }
  });
  const piers = part('gate-piers', wallGroup);
  const eastAngle = Math.atan2(front[2][1] - front[1][1], front[2][0] - front[1][0]);
  for (const px of [gL, gR]) {
    const pz = wallFrontZ(front, px);
    const n = inward(front[1], front[2]);
    const cx = px + n[0] * (half - 0.12), cz = pz + n[1] * (half - 0.12);
    const pier = new THREE.Mesh(metricBox(c.pierSize, c.pierTopY, c.pierSize), mats.brickOld);
    pier.position.set(cx, c.pierTopY / 2, cz);
    pier.rotation.y = -eastAngle;
    pier.name = 'gate-pier';
    pier.castShadow = true;
    pier.receiveShadow = true;
    piers.add(flag(pier));
    if (detail >= 2) {
      const slabCap = new THREE.Mesh(metricBox(c.pierSize + 0.14, 0.07, c.pierSize + 0.14), mats.stoneCap);
      slabCap.position.set(cx, c.pierTopY + 0.035, cz);
      slabCap.rotation.y = -eastAngle;
      slabCap.name = 'pier-cap-slab';
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), mats.stoneCap);
      dome.scale.y = 0.42;
      dome.position.set(cx, c.pierTopY + 0.07, cz);
      dome.name = 'pier-cap-dome';
      slabCap.castShadow = dome.castShadow = true;
      piers.add(flag(slabCap), flag(dome));
    }
  }
  if (detail >= 2) {
    // narrow steel gate leaf, swung inward against the right pier
    const hingeX = gR - half, hingeZ = wallFrontZ(front, hingeX) - 0.2;
    const hinge = new THREE.Group();
    hinge.position.set(hingeX, 0.05, hingeZ);
    hinge.rotation.y = -eastAngle - 1.25;
    const leaf = boxAt('gate-leaf', mats.gateSteel, -0.9, 0, -0.02, 0.9, 1.55, 0.035);
    hinge.add(leaf);
    hinge.name = 'gate';
    // interaction: hinge pivot on the pier face; main.ts toggles `open` on click
    hinge.userData.action = { animationRole: 'hinged-door', axis: [0, 1, 0], closedY: -eastAngle, openY: hinge.rotation.y, open: true };
    wallGroup.add(flag(hinge));
  }

  const street = part('street', root);
  const ext = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const lane: V2[] = [ext(front[1], front[0], 2.1), front[1], ext(front[1], front[2], 1.6)];
  for (let i = 0; i < lane.length - 1; i++) {
    const a = lane[i], b = lane[i + 1];
    const out: V2 = [-inward(a, b)[0], -inward(a, b)[1]];
    // tiny per-segment lift keeps the overlapping lane slabs from z-fighting at the bend
    const setts = segmentBox('paving-setts', mats.paving, a, b, 0, L.street + i * 0.002, layout.street.width, out, 0, 0.3);
    setts.userData.partId = 'paving-setts';
    street.add(setts);
    street.add(flag(segmentBox('kerb', mats.kerb, a, b, L.street, L.street + 0.02, 0.32, out, 0, 0.3)));
    // the far side of the lane: neighbour's boundary wall (context only)
    street.add(flag(segmentBox('neighbour-wall', mats.brickOld, a, b, 0, 2.2, 0.3, out, layout.street.width, 0.3)));
  }
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), mats.groundOuter);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  const guv = ground.geometry.getAttribute('uv') as THREE.BufferAttribute;
  for (let k = 0; k < guv.count; k++) guv.setXY(k, guv.getX(k) * 140, guv.getY(k) * 140);
  ground.receiveShadow = true;
  ground.name = 'outer-ground';
  street.add(flag(ground));

  // ---------------------------------------------------------------- garden inside the walls
  const slopeLen = (a: V2, b: V2) => Math.hypot(b[0] - a[0], b[1] - a[1]) / Math.abs(b[0] - a[0]);
  const frontInnerZ = (x: number) => {
    const seg = x < front[1][0] ? [front[0], front[1]] : [front[1], front[2]];
    return wallFrontZ(front, x) - c.thickness * slopeLen(seg[0] as V2, seg[1] as V2);
  };
  const xw = footprint[0][0];
  const innerOutline: V2[] = [
    [xw, frontInnerZ(xw)], [front[1][0], frontInnerZ(front[1][0])], [c.eastX - c.thickness, frontInnerZ(c.eastX - c.thickness)],
    [c.eastX - c.thickness, c.rearZ + c.thickness], [xw, c.rearZ + c.thickness],
  ];
  const gd = layout.garden;
  const garden = buildGarden({
    innerOutline, frontInnerZ,
    tree: { pos: v2(gd.tree.pos), height: gd.tree.height, crown: gd.tree.crown },
    bougainvillea: v2(gd.bougainvillea), banana: gd.banana.map(v2), gateX: [gL + half, gR - half],
  }, mats, detail);
  garden.userData.partId = 'garden';
  root.add(garden);

  // ---------------------------------------------------------------- Tihar lights
  if (detail >= 5) {
    const P = layout.slab2Outline.map(v2);
    const y = L.parapetLowTop + 0.02;
    const warmRuns = [
      [new THREE.Vector3(rx1, L.parapetHighTop + 0.02, 0.62), new THREE.Vector3(P[1][0] + 0.01, L.parapetHighTop + 0.02, 0.62)],
      [P[1], P[2], P[3], P[4], P[5]].map(([x, z]) => new THREE.Vector3(x + 0.01, y, z + 0.01)),
    ];
    const hanging: HangingRun[] = [
      { from: new THREE.Vector3(rx1 + 0.2, L.parapetHighTop, 0.6), to: new THREE.Vector3(P[1][0] - 0.1, L.parapetHighTop, 0.6), out: new THREE.Vector3(0, 0, 1), minY: 4.5, maxY: 5.5 },
      { from: new THREE.Vector3(P[2][0] + 0.05, y, P[2][1]), to: new THREE.Vector3(P[3][0], y, P[3][1]), out: new THREE.Vector3(0, 0, 1), minY: 4.9, maxY: 5.5 },
      { from: new THREE.Vector3(P[3][0], y, P[3][1] - 0.05), to: new THREE.Vector3(P[4][0], y, P[4][1] + 0.1), out: new THREE.Vector3(1, 0, 0), minY: 4.7, maxY: 5.6 },
      { from: new THREE.Vector3(P[4][0] + 0.15, y, P[4][1]), to: new THREE.Vector3(P[5][0] - 0.1, y, P[5][1]), out: new THREE.Vector3(0, 0, 1), minY: 5.0, maxY: 5.6 },
    ];
    const lights = part('string-lights', root);
    lights.add(buildFestiveLights(warmRuns, hanging, mats));
  }

  if (detail >= 7) mergeStaticMeshes(root);
  if (detail >= 6) attachActionProfiles(root);
  root.userData.sculptRuntime = runtimeSummary(root);
  return { root, materials: mats, detail };
}

/**
 * Optimization pass: inside each part pivot, bake static plain meshes that share a material and
 * shadow flags into one mesh. Part pivots (explode / pick / action metadata) survive untouched;
 * instanced meshes, animated subtrees (userData.action) and nested parts are left alone.
 */
function mergeStaticMeshes(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const parts: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.userData.partId) parts.push(o); });
  const inv = new THREE.Matrix4(), rel = new THREE.Matrix4();
  for (const P of parts) {
    inv.copy(P.matrixWorld).invert();
    const buckets = new Map<string, THREE.Mesh[]>();
    const walk = (o: THREE.Object3D) => {
      for (const c of o.children) {
        if (c.userData.partId || c.userData.action) continue;
        const m = c as THREE.Mesh;
        if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material)) {
          const attrs = Object.keys(m.geometry.attributes).sort().join(',');
          const key = `${(m.material as THREE.Material).uuid}|${m.castShadow}|${m.receiveShadow}|${attrs}`;
          (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(m);
        }
        walk(c);
      }
    };
    walk(P);
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const geos = meshes.map((m) => {
        rel.multiplyMatrices(inv, m.matrixWorld);
        const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(rel);
        g.morphAttributes = {};
        return g;
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, meshes[0].material);
      mesh.name = `${P.userData.partId}-merged-${(meshes[0].material as THREE.Material).name}`;
      mesh.castShadow = meshes[0].castShadow;
      mesh.receiveShadow = meshes[0].receiveShadow;
      mesh.userData.explodeWithParent = true;
      mesh.userData.mergedFrom = meshes.length;
      for (const m of meshes) {
        m.removeFromParent();
        m.geometry.dispose();
      }
      P.add(mesh);
    }
  }
  // drop groups emptied by the merge (no meshes left below them)
  const empty: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o === root || o.userData.partId || o.userData.action || (o as THREE.Mesh).isMesh || (o as THREE.Light).isLight) return;
    let has = false;
    o.traverse((c) => { if ((c as THREE.Mesh).isMesh || (c as THREE.Light).isLight) has = true; });
    if (!has) empty.push(o);
  });
  empty.forEach((o) => o.removeFromParent());
}

const FRACTURE_GROUPS: Record<string, string[]> = {
  house: ['house-shell'],
  compound: ['compound-wall', 'gate-piers'],
  terrace: ['slab-2f', 'terrace-parapets', 'stair-room'],
};

/**
 * Interaction pass: every part pivot gets the spec's actionProfile shape (base pivot, box collider
 * proxy in root space, fracture group, sockets) so runtime actions need no geometry rebuild.
 */
function attachActionProfiles(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const groupOf = (id: string) => Object.keys(FRACTURE_GROUPS).find((k) => FRACTURE_GROUPS[k].includes(id)) ?? null;
  root.traverse((o) => {
    const id = o.userData.partId as string | undefined;
    if (!id) return;
    const b = new THREE.Box3().setFromObject(o, true);
    if (b.isEmpty()) return;
    const c = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3());
    const sockets: { id: string; position: number[] }[] = [];
    if (id === 'lamps') {
      o.children.forEach((l) => {
        const p = new THREE.Box3().setFromObject(l).getCenter(new THREE.Vector3());
        sockets.push({ id: `${l.name}-mount`, position: p.toArray().map((v) => +v.toFixed(3)) });
      });
    }
    const gate = o.getObjectByName('gate');
    if (gate) sockets.push({ id: 'gate-hinge', position: gate.getWorldPosition(new THREE.Vector3()).toArray().map((v) => +v.toFixed(3)) });
    const fg = groupOf(id);
    o.userData.action = {
      animationRole: o === root ? 'root' : 'static-part',
      pivot: { mode: 'base', position: [c.x, b.min.y, c.z].map((v) => +v.toFixed(3)), axis: [0, 1, 0] },
      collider: { type: 'box', center: c.toArray().map((v) => +v.toFixed(3)), size: size.toArray().map((v) => +v.toFixed(3)) },
      destruction: { breakable: fg !== null, fractureGroup: fg ?? id },
      sockets,
    };
  });
}

/** Part tree published for explode / pick and for forge/stage4_review/check_part_coverage.py. */
export function runtimeSummary(root: THREE.Object3D) {
  const nodes: string[] = [];
  let meshes = 0;
  root.traverse((o) => {
    if (o.userData.partId) nodes.push(o.userData.partId);
    if ((o as THREE.Mesh).isMesh) meshes++;
  });
  return { nodes, meshes, destructionGroups: FRACTURE_GROUPS };
}

export function partsManifest(root: THREE.Object3D) {
  const parts: { name: string; kind: string; module: string; triangles: number }[] = [];
  let unnamed = 0, integral = 0;
  const unnamedPaths: string[] = [];
  const tris = (o: THREE.Object3D) => {
    let t = 0;
    o.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry;
      const n = g.index ? g.index.count / 3 : g.getAttribute('position').count / 3;
      t += n * ((mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1);
    });
    return Math.round(t);
  };
  root.traverse((o) => {
    if (o.userData.partId) {
      let module = o.userData.partId;
      let p = o.parent;
      while (p && !p.userData.partId) p = p.parent;
      if (p) module = p.userData.partId;
      parts.push({ name: o.userData.partId, kind: 'part', module, triangles: tris(o) });
    }
    if ((o as THREE.Mesh).isMesh) {
      if (!o.name) {
        unnamed++;
        unnamedPaths.push(`${o.parent?.name ?? '?'}/${(o as THREE.Mesh).geometry.type}`);
      }
      if (o.userData.explodeWithParent) integral++;
    }
  });
  return { model: 'wander-ghar', parts, unnamedMeshes: unnamed, unnamedPaths, integralMeshes: integral };
}
