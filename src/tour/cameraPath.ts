import * as THREE from 'three';
import type { CameraKey, Chapter } from './chapters';

/**
 * One continuous camera rail through every chapter stop and its fly-through waypoints.
 * Position and look-at target each ride a centripetal Catmull-Rom spline (no loops or overshoot),
 * and scroll progress is remapped per segment so the camera eases to a stop and dwells at each
 * chapter, while sweeping through waypoints at speed.
 */
interface Node extends CameraKey {
  /** Scroll progress (in chapter units) at which the camera passes this node. */
  at: number;
  stop: boolean;
}

const DWELL = 0.16;

export class CameraPath {
  private nodes: Node[] = [];
  private pos: THREE.CatmullRomCurve3;
  private tgt: THREE.CatmullRomCurve3;

  constructor(chapters: Chapter[], readonly portrait = false) {
    chapters.forEach((c, i) => {
      const via = i > 0 ? (portrait && c.portraitVia) || c.via : undefined;
      if (via) via.forEach((v, k) => this.nodes.push({ ...v, at: i - 1 + (k + 1) / (via.length + 1), stop: false }));
      // a portrait key is authored for the phone: it never dollies
      this.nodes.push(portrait && c.portrait ? { ...c.portrait, fit: 0, at: i, stop: true } : { ...c.camera, at: i, stop: true });
    });
    const v = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2]);
    this.pos = new THREE.CatmullRomCurve3(this.nodes.map((n) => v(n.position)), false, 'centripetal');
    this.tgt = new THREE.CatmullRomCurve3(this.nodes.map((n) => v(n.target)), false, 'centripetal');
  }

  get length() {
    return this.nodes[this.nodes.length - 1].at;
  }

  /** Curve parameter (0..1) for scroll progress `p` (chapter units). */
  private param(p: number): { s: number; fov: number; fit: number } {
    const N = this.nodes;
    p = THREE.MathUtils.clamp(p, 0, this.length);
    let i = 0;
    while (i < N.length - 2 && p > N[i + 1].at) i++;
    const a = N[i], b = N[i + 1];
    let u = (p - a.at) / (b.at - a.at);
    const d0 = a.stop ? DWELL : 0, d1 = b.stop ? DWELL : 0;
    u = THREE.MathUtils.clamp((u - d0) / (1 - d0 - d1), 0, 1);
    // ease out of a stop / into a stop; pass through waypoints with speed
    if (a.stop && b.stop) u = u * u * (3 - 2 * u);
    else if (a.stop) u = u * u;
    else if (b.stop) u = 1 - (1 - u) * (1 - u);
    return { s: (i + u) / (N.length - 1), fov: THREE.MathUtils.lerp(a.fov, b.fov, u), fit: THREE.MathUtils.lerp(a.fit ?? 0, b.fit ?? 0, u) };
  }

  sample(p: number, outPos: THREE.Vector3, outTarget: THREE.Vector3): { fov: number; fit: number } {
    const { s, fov, fit } = this.param(p);
    this.pos.getPoint(s, outPos);
    this.tgt.getPoint(s, outTarget);
    return { fov, fit };
  }

  /** Dense samples of the rail, used to keep scenery out of the camera's way. */
  samples(step = 0.05): { pos: THREE.Vector3; target: THREE.Vector3 }[] {
    const out = [];
    for (let p = 0; p <= this.length + 1e-6; p += step) {
      const pos = new THREE.Vector3(), target = new THREE.Vector3();
      this.sample(p, pos, target);
      out.push({ pos, target });
    }
    return out;
  }
}

/**
 * Adapt an authored framing (made for aspect ~1) to the real viewport. Portrait screens open the
 * vertical fov a little; if the subject (`fit` metres wide at the target) still doesn't fit
 * across, the camera dollies back along its view line until it does.
 */
export function fitCamera(fov: number, fit: number, aspect: number, pos: THREE.Vector3, target: THREE.Vector3): number {
  let v = fov;
  if (aspect < 1) v = Math.min(fov / Math.pow(aspect, 0.42), fov * 1.32, 74);
  if (fit > 0) {
    const half = Math.atan(Math.tan(THREE.MathUtils.degToRad(v) / 2) * aspect);
    const need = fit / 2 / Math.tan(half);
    const dist = pos.distanceTo(target);
    if (need > dist) pos.sub(target).multiplyScalar(need / dist).add(target);
  }
  return v;
}
