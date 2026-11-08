import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { seeded } from '../house/textures';

/**
 * Context blocks around the plot so the house doesn't float in an empty plain: flat-roofed
 * 2-5 storey Kathmandu-style boxes, merged into one mesh with one window texture whose lit
 * windows fade in after dusk. Blocks are dropped wherever they would touch the camera rail or
 * hide the house from it.
 */
const TILE = 12; // metres of facade covered by one texture repeat (4 x 4 windows)

function windowTextures(): { map: THREE.CanvasTexture; emissive: THREE.CanvasTexture } {
  const S = 256, cell = S / 4;
  const rnd = seeded(907);
  const make = () => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    return [c, c.getContext('2d')!] as const;
  };
  const [cm, gm] = make();
  const [ce, ge] = make();
  gm.fillStyle = '#ffffff';
  gm.fillRect(0, 0, S, S);
  ge.fillStyle = '#000000';
  ge.fillRect(0, 0, S, S);
  for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 4; k++) {
      // window in the middle of each 3 m bay, leaving the texture corner plain wall
      const x = k * cell + cell * 0.34, y = r * cell + cell * 0.3, w = cell * 0.32, h = cell * 0.38;
      gm.fillStyle = '#3a3f47';
      gm.fillRect(x, y, w, h);
      gm.fillStyle = 'rgba(255,255,255,0.55)';
      gm.fillRect(x - 3, y + h, w + 6, 4);
      if (rnd() < 0.42) {
        const warm = rnd() < 0.75;
        ge.fillStyle = warm ? `hsl(${32 + rnd() * 12}, 90%, ${48 + rnd() * 18}%)` : `hsl(${200 + rnd() * 30}, 60%, ${55 + rnd() * 15}%)`;
        ge.fillRect(x, y, w, h);
      }
    }
  }
  const tex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: tex(cm), emissive: tex(ce) };
}

const ROOF = new THREE.Color(0x6d6a66);
const PALETTE = [0x9a5a44, 0xa89a86, 0xb3a690, 0x8c5545, 0xa07c6e, 0x8a959c, 0xb8ad9c, 0x7d7a74, 0xae8c6c];

function block(w: number, h: number, d: number, color: THREE.Color): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // faces: +x, -x, +y, -y, +z, -z (4 vertices each); scale UVs to metres / TILE
  const dims: [number, number][] = [[d, h], [d, h], [0, 0], [0, 0], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      const [fu, fv] = dims[f];
      uv.setXY(i, fu ? (uv.getX(i) * fu) / TILE : 0.01, fv ? (uv.getY(i) * fv) / TILE : 0.01);
    }
  }
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) color.toArray(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.translate(0, h / 2, 0);
  return g;
}

export interface Neighbourhood {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
}

export function createNeighbourhood(rail: { pos: THREE.Vector3; target: THREE.Vector3 }[], shadows: boolean): Neighbourhood {
  const rnd = seeded(4242);
  const { map, emissive } = windowTextures();
  const material = new THREE.MeshStandardMaterial({ map, emissiveMap: emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 0.92 });
  const geos: THREE.BufferGeometry[] = [];
  const placed: THREE.Box3[] = [];
  const ray = new THREE.Ray();
  const hit = new THREE.Vector3();
  // the plot plus the lane in front of it stays clear
  const plot = new THREE.Box3(new THREE.Vector3(-10, -1, -13), new THREE.Vector3(9.5, 30, 8.5));
  const centre = new THREE.Vector3(-0.5, 0, -4);

  for (let tries = 0; tries < 1400 && geos.length < 64; tries++) {
    const ang = rnd() * Math.PI * 2;
    const dist = 13 + Math.pow(rnd(), 0.8) * 48;
    const x = centre.x + Math.cos(ang) * dist, z = centre.z + Math.sin(ang) * dist;
    const w = 6 + rnd() * 6, d = 6 + rnd() * 6;
    const storeys = 2 + Math.floor(rnd() * 2.6);
    const h = storeys * 3 + 0.4 + rnd() * 0.6;
    const yaw = (rnd() - 0.5) * 0.5;
    const r = Math.hypot(w, d) / 2;
    const box = new THREE.Box3(new THREE.Vector3(x - r, 0, z - r), new THREE.Vector3(x + r, h, z + r));
    if (box.intersectsBox(plot)) continue;
    if (placed.some((b) => b.clone().expandByScalar(0.8).intersectsBox(box))) continue;
    // keep blocks well back from the rail so none looms right in front of a lens
    const near = box.clone().expandByScalar(6);
    let blocked = false;
    for (const s of rail) {
      if (near.containsPoint(s.pos)) { blocked = true; break; }
      ray.origin.copy(s.pos);
      ray.direction.subVectors(s.target, s.pos);
      const len = ray.direction.length();
      ray.direction.divideScalar(len);
      if (ray.intersectBox(box, hit) && hit.distanceTo(s.pos) < len) { blocked = true; break; }
    }
    if (blocked) continue;
    placed.push(box);
    const parts = [block(w, h, d, new THREE.Color(PALETTE[Math.floor(rnd() * PALETTE.length)]).multiplyScalar(0.85 + rnd() * 0.2))];
    // roof slab with a small overhang, and often a stair room ("mumty") on top
    const slab = block(w + 0.5, 0.25, d + 0.5, ROOF);
    slab.translate(0, h, 0);
    parts.push(slab);
    if (rnd() < 0.65) {
      const sw = 2.4 + rnd(), sd = 2.4 + rnd();
      const room = block(sw, 2.6, sd, new THREE.Color(PALETTE[Math.floor(rnd() * PALETTE.length)]).multiplyScalar(0.8));
      room.translate((rnd() - 0.5) * (w - sw - 1), h + 0.25, (rnd() - 0.5) * (d - sd - 1));
      parts.push(room);
    }
    const g = mergeGeometries(parts);
    g.rotateY(yaw);
    g.translate(x, -0.02, z);
    geos.push(g);
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos), material);
  mesh.name = 'neighbourhood';
  mesh.receiveShadow = shadows;
  return { mesh, material };
}
