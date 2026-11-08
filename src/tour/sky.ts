import * as THREE from 'three';

/**
 * Gradient sky dome with a sun disc/halo and a hashed star field, plus a ring of distant hill
 * silhouettes (Kathmandu valley rim). Everything is driven by `setColors` each frame, so the
 * time of day can scrub with the page.
 */
export interface Sky {
  dome: THREE.Mesh;
  hills: THREE.Mesh;
  uniforms: {
    top: { value: THREE.Color };
    horizon: { value: THREE.Color };
    ground: { value: THREE.Color };
    sunDir: { value: THREE.Vector3 };
    sunColor: { value: THREE.Color };
    stars: { value: number };
    time: { value: number };
  };
  hillMaterial: THREE.MeshBasicMaterial;
}

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * viewMatrix * vec4((modelMatrix * vec4(position, 1.0)).xyz, 1.0);
  gl_Position = p.xyww; // pinned to the far plane
}`;

const frag = /* glsl */ `
precision highp float;
uniform vec3 top, horizon, ground, sunDir, sunColor;
uniform float stars, time;
varying vec3 vDir;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(horizon, top, pow(smoothstep(-0.02, 0.55, h), 0.65));
  col = mix(col, ground, smoothstep(0.0, -0.12, h));
  float s = max(dot(d, sunDir), 0.0);
  col += sunColor * (pow(s, 900.0) * 6.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.12);
  if (stars > 0.001 && h > 0.0) {
    vec3 p = d * 260.0;
    vec3 c = floor(p);
    float r = hash(c);
    float lum = step(0.988, r) * smoothstep(0.42, 0.0, length(fract(p) - 0.5));
    lum *= 0.55 + 0.45 * sin(time * (1.5 + r * 3.0) + r * 40.0);
    col += vec3(lum) * stars * smoothstep(0.02, 0.25, h);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** Low ring of ridges, seeded so it never changes between loads. */
function hillGeometry(radius: number): THREE.BufferGeometry {
  const seg = 160;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const h =
      7 + 6 * Math.sin(a * 3 + 1.3) * Math.sin(a * 1.7 + 0.4) + 3.2 * Math.sin(a * 7.3 + 2.1) + 1.4 * Math.sin(a * 17.1) + 0.6 * Math.sin(a * 41.7);
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    pos.push(x, -2, z, x, Math.max(2.5, h), z);
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export function createSky(): Sky {
  const uniforms = {
    top: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    ground: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color() },
    stars: { value: 0 },
    time: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  dome.scale.setScalar(300);
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  dome.name = 'sky';

  const hillMaterial = new THREE.MeshBasicMaterial({ color: 0x222222, fog: false, side: THREE.DoubleSide });
  const hills = new THREE.Mesh(hillGeometry(150), hillMaterial);
  hills.renderOrder = -9;
  hills.name = 'hills';
  return { dome, hills, uniforms, hillMaterial };
}
