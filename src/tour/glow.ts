import * as THREE from 'three';

/**
 * Additive halo sprites over every Tihar bulb. This is the glow on devices that skip the bloom
 * pass, and a soft twinkle on top of bloom where it runs. One draw call per set of lights.
 */
const vert = /* glsl */ `
attribute vec3 color;
attribute float phase;
uniform float size, scale, time;
varying vec3 vColor;
varying float vTw;
void main() {
  vColor = color;
  vTw = 0.72 + 0.28 * sin(time * (1.3 + phase * 2.4) + phase * 31.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * scale / -mv.z, 1.0, 96.0);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform float intensity;
varying vec3 vColor;
varying float vTw;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  float a = exp(-r * r * 5.0) * (1.0 - smoothstep(0.85, 1.0, r));
  float core = exp(-r * r * 40.0);
  gl_FragColor = vec4((vColor * a + core * 0.6) * intensity * vTw, 1.0);
}`;

export interface BulbGlow {
  points: THREE.Points;
  uniforms: { size: { value: number }; scale: { value: number }; time: { value: number }; intensity: { value: number } };
}

export function createBulbGlow(bulbs: THREE.InstancedMesh): BulbGlow {
  const n = bulbs.count;
  const pts: THREE.Vector3[] = [];
  const cols: THREE.Color[] = [];
  const m = new THREE.Matrix4();
  bulbs.updateWorldMatrix(true, false);
  for (let i = 0; i < n; i++) {
    bulbs.getMatrixAt(i, m);
    pts.push(new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(bulbs.matrixWorld));
    const c = new THREE.Color(1, 0.7, 0.4);
    if (bulbs.instanceColor) bulbs.getColorAt(i, c);
    cols.push(c);
  }
  return createGlow(pts, cols, 0.22);
}

/** Halo sprites at arbitrary points (lanterns, diyas, arch bulbs); colours are normalised. */
export function createGlow(pts: THREE.Vector3[], colors: THREE.Color[], size: number): BulbGlow {
  const n = pts.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const phase = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pts[i].toArray(pos, i * 3);
    const c = colors[i];
    // warm runs are > 1 for bloom; halos read better normalised
    const k = 1 / Math.max(1, c.r, c.g, c.b);
    col.set([c.r * k, c.g * k, c.b * k], i * 3);
    phase[i] = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
  const uniforms = { size: { value: size }, scale: { value: 500 }, time: { value: 0 }, intensity: { value: 0 } };
  const points = new THREE.Points(
    g,
    new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  points.name = 'glow';
  points.frustumCulled = false;
  points.renderOrder = 5;
  return { points, uniforms };
}
