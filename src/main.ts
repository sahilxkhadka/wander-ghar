import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createHouseModel, layout, partsManifest, PASS_ORDER, PassId, HouseModel } from './house/createHouseModel';
import { nightMaterials } from './house/materials';

type Mode = 'night' | 'day';
interface CameraSpec { preset?: string; position?: number[]; target?: number[]; fov?: number }

declare global {
  interface Window {
    __IMG2THREEJS_READY__?: boolean;
    __IMG2THREEJS_CAPTURE__?: {
      setCamera(spec: CameraSpec): Promise<void>;
      setState(s: { mode?: Mode; lights?: boolean; pass?: PassId; explode?: boolean; matte?: boolean }): Promise<void>;
      manifest(): ReturnType<typeof partsManifest>;
      actions(): { id: string; action: unknown }[];
      toggle(name: string): Promise<number | null>;
      stats(): Promise<{ calls: number; triangles: number; geometries: number; textures: number; instancedMeshes: number; meshes: number; shadowCasters: number; topNames: [string, number][]; fps: number }>;
    };
  }
}

const params = new URLSearchParams(location.search);
if (params.get('ui') === '0') document.body.classList.add('capture');
const REF_ASPECT = layout.camera.aspect;
const MODEL_CENTER = new THREE.Vector3(-1.5, 3.2, -4.2);

// ------------------------------------------------------------------ renderer
const frame = document.getElementById('frame')!;
const overlay = document.getElementById('overlay') as HTMLImageElement;
// the reference photo is kept out of the public repo; without it the compare slider just hides
let hasPhoto = true;
overlay.addEventListener('error', () => {
  hasPhoto = false;
  overlay.style.display = 'none';
  document.getElementById('compare-wrap')!.style.display = 'none';
});
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// the scene is static: shadow maps re-render only when something moves or the lighting changes
renderer.shadowMap.autoUpdate = false;
frame.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 3;
controls.maxDistance = 80;
let interactive = false;
controls.addEventListener('start', () => { interactive = true; setActiveView(''); });

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.15, 0.95);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ------------------------------------------------------------------ lights
const hemi = new THREE.HemisphereLight(0x6f7f99, 0x1a1410, 0.4);
const key = new THREE.DirectionalLight(0xfff1df, 1);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 80 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
key.target.position.copy(MODEL_CENTER);
const spill = [
  new THREE.PointLight(0xff3a3a, 0, 5, 2),
  new THREE.PointLight(0x3a5bff, 0, 5, 2),
  new THREE.PointLight(0x2cff6a, 0, 4, 2),
];
spill[0].position.set(-2.4, 6.4, 1.2);
spill[1].position.set(0.9, 6.3, -1.2);
spill[2].position.set(-0.6, 6.6, 1.1);
// street lamp behind the photographer: the photo's lane and wall are lit from the camera side
const streetLamp = new THREE.SpotLight(0xfff1dc, 0, 40, 0.75, 0.6, 1.6);
streetLamp.position.set(9.5, 4.2, 8.2);
streetLamp.target.position.set(0, 1.5, 0);
streetLamp.castShadow = true;
streetLamp.shadow.mapSize.set(1024, 1024);
streetLamp.shadow.bias = -0.0005;
scene.add(hemi, key, key.target, streetLamp, streetLamp.target, ...spill);

// ------------------------------------------------------------------ state
const state = {
  mode: (params.get('mode') as Mode) || 'night',
  lights: params.get('lights') !== '0',
  pass: (params.get('pass') as PassId) || 'optimization-pass',
  explode: params.get('explode') === '1',
  matte: params.get('matte') === '1',
  view: params.get('view') || 'reference',
};
let model: HouseModel | null = null;

function applyMode() {
  renderer.shadowMap.needsUpdate = true;
  const night = state.mode === 'night';
  const detail = model?.detail ?? 7;
  const lit = detail >= 5;
  // practical lamps (soffit domes, backlit curtains) light the reference photo itself, so material
  // colour is judged under them from material-pass on; festive bloom/spill waits for lighting-pass
  const practical = detail >= 3;
  scene.background = new THREE.Color(night ? 0x04060b : 0xb9d1e6);
  renderer.toneMappingExposure = night ? 1.05 : 0.95;
  hemi.color.set(night ? 0x7d8aa6 : 0xdfeeff);
  hemi.groundColor.set(night ? 0x241a12 : 0x6b5a45);
  hemi.intensity = night ? (lit ? 0.95 : 1.4) : 1.25;
  key.color.set(night ? 0xfff0e2 : 0xfff2dc);
  key.intensity = night ? (lit ? 2.3 : 2.0) : 3.0;
  key.position.copy(night ? new THREE.Vector3(12, 7, 13) : new THREE.Vector3(-6, 20, 14));
  streetLamp.intensity = night ? 70 : 0;
  if (night) key.intensity *= 0.55;
  const lightsOn = night && lit && state.lights;
  bloom.enabled = lightsOn;
  spill.forEach((s) => (s.intensity = lightsOn ? 0.8 : 0));
  if (!model) return;
  for (const [m, k] of nightMaterials(model.materials)) m.emissiveIntensity = night && practical ? k : 0;
  model.root.traverse((o) => {
    const l = o as THREE.PointLight;
    if (l.isPointLight && l.userData.nightIntensity) l.intensity = night && practical ? l.userData.nightIntensity : 0;
  });
  const strings = model.root.getObjectByName('string-lights');
  if (strings) strings.visible = state.lights;
  applyMatte();
}

// Silhouette matte for the Tier-1 gate: built structure white, sky / lane / outer ground black.
const matteMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
function applyMatte() {
  if (!model) return;
  scene.overrideMaterial = state.matte ? matteMaterial : null;
  if (state.matte) { scene.background = new THREE.Color(0x000000); bloom.enabled = false; }
  const street = model.root.getObjectByName('street');
  if (street) street.visible = !state.matte;
  model.root.traverse((o) => { if (o.name === 'string-lights') o.visible = !state.matte && state.lights; });
}

// ------------------------------------------------------------------ explode (layout scale)
const explodeTargets: { o: THREE.Object3D; base: THREE.Vector3; offset: THREE.Vector3 }[] = [];
let explodeT = 0;
function prepareExplode() {
  explodeTargets.length = 0;
  if (!model) return;
  model.root.updateMatrixWorld(true);
  const centre = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  model.root.traverse((o) => {
    if (!o.userData.partId || o === model!.root) return;
    let p = o.parent;
    while (p && !p.userData.partId) p = p.parent;
    if (!p) return;
    const box = new THREE.Box3().setFromObject(o);
    if (box.isEmpty()) return;
    const d = centre(o).sub(centre(p));
    const offset = new THREE.Vector3(d.x * 0.7, Math.max(0, d.y) * 0.9 + 0.6, d.z * 0.7);
    if (['street', 'garden', 'compound-wall'].includes(o.userData.partId)) offset.set(0, 0, 0);
    explodeTargets.push({ o, base: o.position.clone(), offset });
  });
}
function applyExplode(t: number) {
  renderer.shadowMap.needsUpdate = true;
  for (const e of explodeTargets) e.o.position.copy(e.base).addScaledVector(e.offset, t);
}

// ------------------------------------------------------------------ build / rebuild
function build() {
  if (model) {
    scene.remove(model.root);
    model.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.geometry.dispose(); });
  }
  model = createHouseModel(state.pass);
  scene.add(model.root);
  prepareExplode();
  applyExplode(state.explode ? 1 : 0);
  explodeT = state.explode ? 1 : 0;
  applyMode();
}

// ------------------------------------------------------------------ views
const VIEWS: Record<string, { label: string; position: number[]; target: number[]; fov: number }> = {
  reference: { label: 'Photo', position: [], target: [], fov: layout.camera.fovVerticalDeg },
  aerial: { label: 'Aerial', position: [15, 15, 17], target: [-1.5, 2.5, -4], fov: 45 },
  street: { label: 'Street', position: [-4.5, 1.6, 6.4], target: [-0.5, 3.6, -1], fov: 60 },
  garden: { label: 'Garden', position: [6.6, 2.6, -2.5], target: [0.5, 2.0, -1.5], fov: 62 },
  rear: { label: 'Rear', position: [-14, 10, -24], target: [-2, 3, -5], fov: 45 },
};
for (let a = 0; a < 360; a += 90) {
  const r = 26, rad = THREE.MathUtils.degToRad(a);
  VIEWS[`turntable-${a}`] = { label: '', position: [MODEL_CENTER.x + r * Math.sin(rad + 0.7), 9, MODEL_CENTER.z + r * Math.cos(rad + 0.7)], target: MODEL_CENTER.toArray(), fov: 45 };
}

function resize() {
  const W = window.innerWidth, H = window.innerHeight;
  let w = W, h = H;
  if (state.view === 'reference') {
    if (W / H > REF_ASPECT) w = Math.round(H * REF_ASPECT);
    else h = Math.round(W / REF_ASPECT);
  }
  frame.style.width = `${w}px`;
  frame.style.height = `${h}px`;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = state.view === 'reference' ? REF_ASPECT : w / h;
  camera.updateProjectionMatrix();
}

function setCamera(spec: CameraSpec) {
  interactive = false;
  const name = spec.preset ?? '';
  state.view = name || 'custom';
  if (name === 'reference') {
    const c = layout.camera;
    camera.position.fromArray(c.position);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(c.eulerYXZ[0], c.eulerYXZ[1], c.eulerYXZ[2]);
    camera.fov = c.fovVerticalDeg;
    const fwd = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
    controls.target.copy(camera.position).addScaledVector(fwd, 10);
  } else {
    const v = VIEWS[name] ?? { position: spec.position!, target: spec.target!, fov: spec.fov ?? 50 };
    camera.position.fromArray(spec.position ?? v.position);
    controls.target.fromArray(spec.target ?? v.target);
    camera.fov = spec.fov ?? v.fov;
    camera.lookAt(controls.target);
  }
  document.getElementById('compare-wrap')!.style.display = name === 'reference' && hasPhoto ? '' : 'none';
  overlay.style.display = name === 'reference' && hasPhoto ? '' : 'none';
  setActiveView(name);
  resize();
}

// ------------------------------------------------------------------ UI
const viewRow = document.getElementById('views')!;
for (const [id, v] of Object.entries(VIEWS)) {
  if (!v.label) continue;
  const b = document.createElement('button');
  b.textContent = v.label;
  b.dataset.view = id;
  b.onclick = () => setCamera({ preset: id });
  viewRow.append(b);
}
function setActiveView(id: string) {
  viewRow.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.view === id));
}
const btn = (id: string) => document.getElementById(id) as HTMLButtonElement;
function syncButtons() {
  btn('night').classList.toggle('on', state.mode === 'night');
  btn('day').classList.toggle('on', state.mode === 'day');
  btn('lights').classList.toggle('on', state.lights);
  btn('explode').classList.toggle('on', state.explode);
}
btn('night').onclick = () => { state.mode = 'night'; applyMode(); syncButtons(); };
btn('day').onclick = () => { state.mode = 'day'; applyMode(); syncButtons(); };
btn('lights').onclick = () => { state.lights = !state.lights; applyMode(); syncButtons(); };
btn('explode').onclick = () => { state.explode = !state.explode; syncButtons(); };
(document.getElementById('compare') as HTMLInputElement).oninput = (e) => {
  overlay.style.opacity = String(Number((e.target as HTMLInputElement).value) / 100);
};

// click-to-identify: nearest ancestor that is a named part
const pickLabel = document.getElementById('pick')!;
const box = new THREE.BoxHelper(new THREE.Object3D(), 0xf0a04b);
box.visible = false;
scene.add(box);
const ray = new THREE.Raycaster();
let downAt = [0, 0];
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || !model) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObject(model.root, true).find((h) => h.object.visible && (h.object as THREE.Mesh).material !== model!.materials.glass);
  let o: THREE.Object3D | null = hit?.object ?? null;
  // clicking the gate leaf swings it on its hinge
  for (let g = o; g; g = g.parent) if (g.userData.action?.animationRole === 'hinged-door') { g.userData.action.open = !g.userData.action.open; break; }
  while (o && !o.userData.partId) o = o.parent;
  if (!o || o === model.root) { box.visible = false; pickLabel.style.display = 'none'; return; }
  box.setFromObject(o);
  box.visible = true;
  const ev = o.userData.evidence ? ` · ${o.userData.evidence}` : '';
  pickLabel.innerHTML = `<b>${o.userData.partId}</b>${ev}`;
  pickLabel.style.display = 'block';
});

// ------------------------------------------------------------------ loop + capture contract
let frames = 0;
function loop() {
  requestAnimationFrame(loop);
  const gate = model?.root.getObjectByName('gate');
  const ga = gate?.userData.action;
  if (gate && ga) {
    const to = ga.open ? ga.openY : ga.closedY;
    if (Math.abs(gate.rotation.y - to) > 1e-3) {
      gate.rotation.y += (to - gate.rotation.y) * 0.1;
      renderer.shadowMap.needsUpdate = true;
    }
  }
  const target = state.explode ? 1 : 0;
  if (Math.abs(explodeT - target) > 1e-3) {
    explodeT += (target - explodeT) * 0.12;
    applyExplode(explodeT);
    if (box.visible) box.update();
  }
  if (interactive) controls.update();
  composer.render();
  if (++frames === 3) window.__IMG2THREEJS_READY__ = true;
}

const nextFrames = (n = 3) => new Promise<void>((res) => {
  const start = frames;
  const tick = () => (frames - start >= n ? res() : requestAnimationFrame(tick));
  tick();
});

window.__IMG2THREEJS_CAPTURE__ = {
  async setCamera(spec) { setCamera(spec); await nextFrames(); },
  async setState(s) {
    let rebuild = false;
    if (s.pass && s.pass !== state.pass) { state.pass = s.pass; rebuild = true; }
    if (s.mode) state.mode = s.mode;
    if (s.lights !== undefined) state.lights = s.lights;
    if (s.explode !== undefined) state.explode = s.explode;
    if (s.matte !== undefined) state.matte = s.matte;
    if (rebuild) build(); else applyMode();
    explodeT = state.explode ? 1 : 0;
    applyExplode(explodeT);
    syncButtons();
    await nextFrames();
  },
  manifest() { return partsManifest(model!.root); },
  /** Interaction-pass evidence: per-part action profiles (pivot, collider, fracture group, sockets). */
  actions() {
    const out: { id: string; action: unknown }[] = [];
    model?.root.traverse((o) => { if (o.userData.action) out.push({ id: o.userData.partId ?? o.name, action: o.userData.action }); });
    return out;
  },
  /** Optimization-pass evidence: draw calls / triangles of one composed frame, plus measured fps. */
  async stats() {
    renderer.info.autoReset = false;
    renderer.info.reset();
    composer.render();
    const { calls, triangles } = renderer.info.render;
    const { geometries, textures } = renderer.info.memory;
    renderer.info.autoReset = true;
    let instancedMeshes = 0, meshes = 0, shadowCasters = 0;
    const names: Record<string, number> = {};
    model?.root.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      meshes++;
      if (o.castShadow) shadowCasters++;
      if ((o as THREE.InstancedMesh).isInstancedMesh) instancedMeshes++;
      const stem = o.name.replace(/[-_]?\d+$/, '');
      names[stem] = (names[stem] ?? 0) + 1;
    });
    const topNames = Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const f0 = frames, t0 = performance.now();
    await nextFrames(120);
    const fps = ((frames - f0) * 1000) / (performance.now() - t0);
    return { calls, triangles, geometries, textures, instancedMeshes, meshes, shadowCasters, topNames, fps: Math.round(fps) };
  },
  /** Flip a hinged part and let the loop settle; returns its final rotation.y. */
  async toggle(name) {
    const o = model?.root.getObjectByName(name);
    if (!o?.userData.action) return null;
    o.userData.action.open = !o.userData.action.open;
    await nextFrames(90);
    return o.rotation.y;
  },
};

if (!PASS_ORDER.includes(state.pass)) state.pass = 'optimization-pass';
build();
syncButtons();
setCamera({ preset: state.view });
window.addEventListener('resize', resize);
loop();
