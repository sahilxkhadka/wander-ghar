import * as THREE from 'three';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cormorant-garamond/600.css';
import gsap from 'gsap';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createHouseModel } from '../house/createHouseModel';
import { nightMaterials } from '../house/materials';
import { AdaptiveResolution, detectTier, settingsFor } from './quality';
import { BANNER_POS, CHAPTERS, PLAQUES, TEXTS, WALL_ANGLE } from './chapters';
import { CameraPath, fitCamera } from './cameraPath';
import { createTextMaterials, Text3D } from './text3d';
import { createSky } from './sky';
import { BulbGlow, createBulbGlow } from './glow';
import { createPlaqueMaterials, EngravedPlaque } from './engrave';
import { createGateBanner, GateBanner } from './gateBanner';
import { createGardenExtras, GardenExtras } from './gardenExtras';
import { initOutro } from './outro';
import { createNeighbourhood } from './neighbourhood';

declare global {
  interface Window {
    /** Test hook: jump/inspect the tour without scrolling (used by scripts/verify-tour.mjs). */
    __TOUR__?: {
      ready: boolean; tier: string; chapters: number; progress(): number; setProgress(p: number): void; release(): void; fps(): number; dpr(): number;
      /** Screen bounds (0..1, y down) of a text's letters and the share of letters not hidden by the model. */
      inspectText(id: string): { minX: number; maxX: number; minY: number; maxY: number; visible: number; letters: number } | null;
      camera(): { pos: number[]; fov: number };
      /** Screen bounds (0..1, y down) of the house itself (walls, slabs, stair room). */
      houseBounds(): { minX: number; maxX: number; minY: number; maxY: number };
    };
  }
}

const params = new URLSearchParams(location.search);
const q = settingsFor(detectTier());
document.documentElement.dataset.tier = q.tier;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEG = Math.PI / 180;

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance', stencil: false });
renderer.setPixelRatio(q.dprCap);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = q.shadows;
renderer.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
// the scene is static: shadow maps re-render only when the sun moves or the gate swings
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
scene.fog = new THREE.Fog(0x000000, 24, 84);

// ------------------------------------------------------------------ lights
const CENTER = new THREE.Vector3(-1.5, 3, -4);
const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = q.shadows;
sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
Object.assign(sun.shadow.camera, { left: -19, right: 19, top: 19, bottom: -19, near: 1, far: 90 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
sun.target.position.copy(CENTER);
// street lamp across the lane, as in the photo; casts only on the high tier
const streetLamp = new THREE.SpotLight(0xffe2bd, 0, 40, 0.75, 0.6, 1.6);
streetLamp.position.set(9.5, 4.2, 8.2);
streetLamp.target.position.set(0, 1.5, 0);
streetLamp.castShadow = q.tier === 'high';
streetLamp.shadow.mapSize.set(1024, 1024);
streetLamp.shadow.bias = -0.0005;
scene.add(hemi, sun, sun.target, streetLamp, streetLamp.target);
const spill: THREE.PointLight[] = [];
if (q.spillLights) {
  const s = [[0xff3a3a, -2.4, 6.4, 1.2], [0x3a5bff, 0.9, 6.3, -1.2], [0x2cff6a, -0.6, 6.6, 1.1]];
  for (const [c, x, y, z] of s) {
    const l = new THREE.PointLight(c, 0, 5, 2);
    l.position.set(x, y, z);
    spill.push(l);
    scene.add(l);
  }
}

// ------------------------------------------------------------------ sky, model, context
const sky = createSky();
scene.add(sky.dome, sky.hills);
// portrait phones ride their own rail (authored framings); switched on orientation change
const PORTRAIT = 0.85;
let path = new CameraPath(CHAPTERS, innerWidth / innerHeight < PORTRAIT);

const pmrem = new THREE.PMREMGenerator(renderer);
const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();
const textMats = createTextMaterials(envMap);
const plaqueMats = createPlaqueMaterials(envMap);

let houseRoot: THREE.Group;
let houseMats: ReturnType<typeof createHouseModel>['materials'];
let night: [THREE.MeshStandardMaterial, number][] = [];
let lampLights: THREE.PointLight[] = [];
let gate: THREE.Object3D | undefined;
let glow: BulbGlow | null = null;
let hood: ReturnType<typeof createNeighbourhood>;
/** Anything the scroll reveals: extruded lettering or the engraved floor plaque. */
interface Revealable { group: THREE.Group; setReveal(r: number): void; dispose(): void }
const texts = new Map<string, Revealable>();
let banner: GateBanner;
let extras: GardenExtras;
/** Every halo set, so the night pass and the point-size scale reach all of them. */
const glows: BulbGlow[] = [];

function build() {
  const model = createHouseModel('optimization-pass');
  houseRoot = model.root;
  houseMats = model.materials;
  night = nightMaterials(houseMats);
  houseRoot.traverse((o) => {
    const l = o as THREE.PointLight;
    if (l.isPointLight && l.userData.nightIntensity) {
      // low tier: the lamp domes still glow, but the per-fragment point lights are dropped
      if (q.lampLights) lampLights.push(l);
      else l.visible = false;
    }
    if (!q.shadows) { o.castShadow = false; o.receiveShadow = false; }
  });
  if (q.tier === 'low') {
    // weak GPUs: keep albedo, drop the bump + roughness maps (two thirds of the texture memory,
    // and bump mapping's derivative work in every fragment)
    const seen = new Set<THREE.Material>();
    houseRoot.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      for (const m of (Array.isArray(mats) ? mats : mats ? [mats] : []) as THREE.MeshStandardMaterial[]) {
        if (seen.has(m) || !m.isMeshStandardMaterial) continue;
        seen.add(m);
        if (m.bumpMap || m.roughnessMap) {
          m.bumpMap?.dispose();
          m.roughnessMap?.dispose();
          m.bumpMap = m.roughnessMap = null;
          m.needsUpdate = true;
        }
      }
    });
  }
  scene.add(houseRoot);
  // the neighbour's wall across the lane (context only) would hide the street lettering from the
  // hero shot: keep it as a knee-high kerb wall
  const street = houseRoot.getObjectByName('street');
  street?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material === houseMats.brickOld) m.scale.y = 0.4;
  });
  gate = houseRoot.getObjectByName('gate');
  if (gate?.userData.action) gate.rotation.y = gate.userData.action.closedY;
  const strings = houseRoot.getObjectByName('string-lights') as THREE.InstancedMesh | undefined;
  const bulbs = strings && ((strings as THREE.InstancedMesh).isInstancedMesh ? strings : (strings.children.find((c) => (c as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh));
  if (bulbs) {
    glow = createBulbGlow(bulbs);
    scene.add(glow.points);
    glows.push(glow);
  }
  banner = createGateBanner(envMap, q.shadows);
  banner.group.position.fromArray(BANNER_POS);
  banner.group.rotation.y = WALL_ANGLE;
  scene.add(banner.group);
  extras = createGardenExtras(q.shadows);
  scene.add(extras.group);
  glows.push(banner.glow, ...extras.glows);
  // context blocks keep clear of both rails, so rotating the phone never parks the camera in one
  hood = createNeighbourhood([...new CameraPath(CHAPTERS, false).samples(0.04), ...new CameraPath(CHAPTERS, true).samples(0.04)], q.shadows);
  scene.add(hood.mesh);
  buildTexts(path.portrait);
}

function buildTexts(portrait: boolean) {
  for (const t of texts.values()) t.dispose();
  texts.clear();
  for (const spec of TEXTS) {
    const t = new Text3D(spec, textMats, q, portrait);
    texts.set(spec.id, t);
    scene.add(t.group);
  }
  for (const spec of PLAQUES) {
    const t = new EngravedPlaque(spec, plaqueMats, q, portrait, q.shadows);
    texts.set(spec.id, t);
    scene.add(t.group);
  }
}

// ------------------------------------------------------------------ time of day
interface Look { top: number; horizon: number; sunColor: number; sunI: number; sunElev: number; hemiSky: number; hemiGround: number; hemiI: number; exposure: number; lights: number; stars: number; moon: number }
// stops at tod = 0 (bright day), 0.3 (evening tint), 0.45, 0.6 (sunset), 0.78 (blue hour), 1 (night)
const LOOKS: [number, Look][] = [
  [0, { top: 0x3c79cc, horizon: 0xcfe2f2, sunColor: 0xfff4e4, sunI: 3.3, sunElev: 52, hemiSky: 0xd6e6ff, hemiGround: 0x7a6550, hemiI: 1.2, exposure: 0.92, lights: 0, stars: 0, moon: 0 }],
  [0.3, { top: 0x4a78b8, horizon: 0xf4c08e, sunColor: 0xffc489, sunI: 3.2, sunElev: 24, hemiSky: 0xc4d6f2, hemiGround: 0x6a5240, hemiI: 1.05, exposure: 0.95, lights: 0, stars: 0, moon: 0 }],
  [0.45, { top: 0x40609f, horizon: 0xf7a76c, sunColor: 0xffa560, sunI: 2.7, sunElev: 12, hemiSky: 0xb3c0e0, hemiGround: 0x5e4536, hemiI: 0.95, exposure: 0.98, lights: 0.12, stars: 0, moon: 0 }],
  [0.6, { top: 0x2c3d73, horizon: 0xf07a4d, sunColor: 0xff7a3c, sunI: 1.5, sunElev: 3, hemiSky: 0x9aa2cc, hemiGround: 0x4a382f, hemiI: 1.05, exposure: 1.02, lights: 0.45, stars: 0, moon: 0 }],
  [0.78, { top: 0x141d3d, horizon: 0x5a4a78, sunColor: 0xff6a3a, sunI: 0, sunElev: -4, hemiSky: 0x5b6894, hemiGround: 0x2a2026, hemiI: 0.85, exposure: 1.06, lights: 0.85, stars: 0.35, moon: 0.4 }],
  [1, { top: 0x03060f, horizon: 0x111a30, sunColor: 0x000000, sunI: 0, sunElev: -12, hemiSky: 0x6f7ea0, hemiGround: 0x221a14, hemiI: 0.85, exposure: 1.08, lights: 1, stars: 1, moon: 1 }],
];
const SUN_AZIMUTH = 38 * DEG; // from +z (street) toward +x (east): low sun over the lane
const MOON_DIR = new THREE.Vector3(12, 7, 13).normalize();
// how far the sun may drift before the shadow map re-renders (each re-render is a full scene pass)
const SHADOW_STEP = (q.tier === 'high' ? 0.6 : 1.5) * DEG;
const cA = new THREE.Color(), cB = new THREE.Color();
const lerpHex = (a: number, b: number, t: number, out: THREE.Color) => out.copy(cA.setHex(a)).lerp(cB.setHex(b), t);
const look = { ...LOOKS[0][1] };
const colors = { top: new THREE.Color(), horizon: new THREE.Color(), sun: new THREE.Color(), hemiSky: new THREE.Color(), hemiGround: new THREE.Color() };
const lightDir = new THREE.Vector3();
const shadowDir = new THREE.Vector3();
let shadowDirty = true;

function applyTimeOfDay(t: number, time: number) {
  let i = 0;
  while (i < LOOKS.length - 2 && t > LOOKS[i + 1][0]) i++;
  const [ta, a] = LOOKS[i], [tb, b] = LOOKS[i + 1];
  const u = THREE.MathUtils.clamp((t - ta) / (tb - ta), 0, 1);
  for (const k of Object.keys(look) as (keyof Look)[]) look[k] = a[k] + (b[k] - a[k]) * u;
  lerpHex(a.top, b.top, u, colors.top);
  lerpHex(a.horizon, b.horizon, u, colors.horizon);
  lerpHex(a.sunColor, b.sunColor, u, colors.sun);
  lerpHex(a.hemiSky, b.hemiSky, u, colors.hemiSky);
  lerpHex(a.hemiGround, b.hemiGround, u, colors.hemiGround);

  const el = look.sunElev * DEG;
  const sunDir = new THREE.Vector3(Math.sin(SUN_AZIMUTH) * Math.cos(el), Math.sin(el), Math.cos(SUN_AZIMUTH) * Math.cos(el));
  sky.uniforms.top.value.copy(colors.top);
  sky.uniforms.horizon.value.copy(colors.horizon);
  sky.uniforms.sunDir.value.copy(sunDir);
  sky.uniforms.sunColor.value.copy(colors.sun).multiplyScalar(Math.min(1, look.sunI / 1.5) * (el > -0.05 ? 1 : 0));
  sky.uniforms.stars.value = look.stars;
  sky.uniforms.time.value = time;
  // haze: the far ground and the sky below the horizon melt into one colour
  const haze = colors.horizon.clone().lerp(colors.top, 0.25).multiplyScalar(0.9);
  (scene.fog as THREE.Fog).color.copy(haze);
  sky.uniforms.ground.value.copy(haze);
  sky.hillMaterial.color.copy(colors.top).lerp(haze, 0.55).multiplyScalar(0.62);

  // one directional light plays the sun, then the moon; its direction only swaps while it's dim
  const moonMix = THREE.MathUtils.smoothstep(t, 0.66, 0.8);
  lightDir.copy(sunDir).lerp(MOON_DIR, moonMix).normalize();
  if (lightDir.y < 0.12) lightDir.y = 0.12;
  lightDir.normalize();
  sun.position.copy(CENTER).addScaledVector(lightDir, 40);
  sun.color.copy(colors.sun).lerp(cA.setHex(0xbfd0ff), moonMix);
  sun.intensity = look.sunI * (1 - moonMix) + look.moon * 0.75;
  if (q.shadows && shadowDir.angleTo(lightDir) > SHADOW_STEP) {
    shadowDir.copy(lightDir);
    shadowDirty = true;
  }
  hemi.color.copy(colors.hemiSky);
  hemi.groundColor.copy(colors.hemiGround);
  hemi.intensity = look.hemiI;
  renderer.toneMappingExposure = look.exposure;

  const L = look.lights;
  streetLamp.intensity = 70 * L * L;
  for (const [m, k] of night) m.emissiveIntensity = k * L;
  for (const l of lampLights) l.intensity = l.userData.nightIntensity * L;
  for (const s of spill) s.intensity = 0.8 * L;
  houseMats.bulb.color.setScalar(0.3 + 0.7 * L);
  const halo = THREE.MathUtils.smoothstep(L, 0.15, 0.9) * (bloomPass?.enabled ? 0.65 : 1);
  for (const g of glows) {
    g.uniforms.intensity.value = halo;
    g.uniforms.time.value = time;
  }
  banner.bulbs.color.setRGB(1, 0.82, 0.55).multiplyScalar(0.35 + 1.1 * L);
  extras.flame.color.setRGB(1, 0.7, 0.28).multiplyScalar(0.15 + 1.6 * L);
  for (const [m, k] of extras.night) m.emissiveIntensity = k * L;
  hood.material.emissiveIntensity = 1.1 * THREE.MathUtils.smoothstep(L, 0.3, 1);
  bloomStrength = 0.55 * THREE.MathUtils.smoothstep(L, 0.2, 0.9);
}

// ------------------------------------------------------------------ post (high tier only)
let composer: EffectComposer | null = null;
let bloomPass: UnrealBloomPass | null = null;
let bloomStrength = 0;
if (q.bloom) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.2, 0.92);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
}

// ------------------------------------------------------------------ sizing
let W = 0, H = 0;
function resize(force = false) {
  // the canvas is sized to the *large* viewport (CSS 100lvh), so mobile toolbars sliding in and out
  // don't resize the drawing buffer mid-scroll
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!force && w === W && Math.abs(h - H) < 2) return;
  W = w;
  H = h;
  renderer.setSize(w, h, false);
  composer?.setSize(w, h);
  bloomPass?.resolution.set(w / 2, h / 2);
  camera.aspect = w / h;
  const portrait = camera.aspect < PORTRAIT;
  if (portrait !== path.portrait) {
    path = new CameraPath(CHAPTERS, portrait);
    if (texts.size) buildTexts(portrait);
    first = true;
    shadowDirty = true;
  }
}
const adaptive = new AdaptiveResolution(q, (dpr) => {
  renderer.setPixelRatio(dpr);
  composer?.setPixelRatio(dpr);
  resize(true);
}, () => {
  if (bloomPass) bloomPass.enabled = false;
});

// ------------------------------------------------------------------ DOM: captions + dots
const cards = [...document.querySelectorAll<HTMLElement>('.card')];
const dotsEl = document.getElementById('dots')!;
const dots = CHAPTERS.map((c, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('aria-label', c.eyebrow);
  b.onclick = () => goTo(i);
  dotsEl.append(b);
  return b;
});
const bar = document.getElementById('bar')!;
const footer = document.getElementById('footer')!;
const hint = document.getElementById('hint')!;
const heroLinks = document.getElementById('herolinks')!;
let activeDot = -1;

function envelope(local: number): number {
  // ramps in while arriving, holds through the dwell, ramps out while leaving
  return THREE.MathUtils.smoothstep(local, -0.55, -0.16) * (1 - THREE.MathUtils.smoothstep(local, 0.2, 0.55));
}

/** 0 while on the tour, rising to 1 as the closing section scrolls up over the last stop. */
function outroAmount(): number {
  const start = track.offsetHeight - innerHeight;
  return THREE.MathUtils.clamp((lenis.scroll - start) / (innerHeight * 0.35), 0, 1);
}

function updateDom(p: number) {
  const last = CHAPTERS.length - 1;
  const outro = frozenProgress === null ? outroAmount() : 0;
  cards.forEach((el, i) => {
    let e = envelope(p - i);
    if (i === 0 && p < 0) e = 1;
    if (i === last && p > last) e = 1;
    // the last caption hands over to the closing section as it scrolls in
    const o = +(i === last ? Math.min(1, THREE.MathUtils.smoothstep(p - i, -0.4, -0.08)) * (1 - outro) : e).toFixed(3);
    if (el.dataset.o !== String(o)) {
      el.dataset.o = String(o);
      el.style.opacity = String(o);
      el.style.transform = `translate3d(0, ${((1 - o) * 18).toFixed(1)}px, 0)`;
      el.style.visibility = o < 0.01 ? 'hidden' : 'visible';
    }
  });
  const a = Math.round(THREE.MathUtils.clamp(p, 0, last));
  if (a !== activeDot) {
    dots.forEach((d, i) => d.classList.toggle('on', i === a));
    activeDot = a;
  }
  bar.style.transform = `scaleX(${(p / last).toFixed(4)})`;
  // the footer (Wander Pixels + portfolio links) arrives with the last stop and leaves with it
  const f = cards[last].dataset.o ?? '0';
  if (footer.dataset.o !== f) {
    footer.dataset.o = f;
    footer.style.opacity = f;
    footer.style.visibility = Number(f) < 0.01 ? 'hidden' : 'visible';
  }
  hint.style.opacity = String(Math.max(0, 1 - p * 4));
  // corner links belong to the opening view only
  const hl = cards[0].dataset.o ?? '1';
  if (heroLinks.dataset.o !== hl) {
    heroLinks.dataset.o = hl;
    heroLinks.style.opacity = hl;
    heroLinks.style.visibility = Number(hl) < 0.01 ? 'hidden' : 'visible';
  }
}

// ------------------------------------------------------------------ scroll
// touch stays native (Lenis leaves it alone unless syncTouch is on, so touchMultiplier would be a no-op)
const lenis = new Lenis({ duration: 1.25, smoothWheel: !reduceMotion, wheelMultiplier: 0.9 });
lenis.stop();
// one chapter span = SPAN small-viewport heights (this sets #track's height); measured against svh so
// mobile toolbars collapsing don't shift the progress. A wheel notch is a fixed ~100px whatever the
// screen, but a swipe moves the page by finger travel, which is a fraction of a phone's height, so
// touch gets a shorter span to keep one chapter to roughly one swipe
const SPAN = matchMedia('(pointer: coarse)').matches ? 0.8 : 1.35;
const svh = document.getElementById('svh')!;
const track = document.getElementById('track')!;
// scroll position (in chapter spans) at which each stop sits; long flights get a longer span
const stopAt = CHAPTERS.reduce<number[]>((a, c, i) => (a.push(i ? a[i - 1] + (c.span ?? 1) : 0), a), []);
const totalSpan = stopAt[stopAt.length - 1];
const trackVh = +(totalSpan * SPAN * 100).toFixed(1);
track.style.height = `calc(100vh + ${trackVh}vh)`;
if (CSS.supports('height', '100svh')) track.style.height = `calc(100svh + ${trackVh}svh)`;
const chapterSpan = () => svh.offsetHeight * SPAN;
function goTo(i: number) {
  lenis.scrollTo(stopAt[i] * chapterSpan(), { duration: reduceMotion ? 0 : 1.6 + Math.abs(i - progress) * 0.35, easing: (t) => 1 - Math.pow(1 - t, 3) });
}
/** Scroll offset to chapter progress: stop i at i, linear within each span. */
const rawProgress = () => {
  const u = THREE.MathUtils.clamp(lenis.scroll / chapterSpan(), 0, totalSpan);
  let i = 0;
  while (i < stopAt.length - 2 && u > stopAt[i + 1]) i++;
  return i + (u - stopAt[i]) / (stopAt[i + 1] - stopAt[i]);
};
document.getElementById('replay')!.onclick = () => goTo(0);
let progress = Number(params.get('p') ?? 0);

// ------------------------------------------------------------------ frame
const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3();
const smoothPos = new THREE.Vector3(), smoothTarget = new THREE.Vector3();
let smoothFov = 45;
let first = true;
let elapsed = 0;
const pointer = new THREE.Vector2(), pointerSmooth = new THREE.Vector2();
addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
}, { passive: true });
const right = new THREE.Vector3(), up = new THREE.Vector3();
let gateShadowFrames = 0;
const facingN = new THREE.Vector3(), facingV = new THREE.Vector3();
let fpsAvg = 60;
let frozenProgress: number | null = params.has('p') ? progress : null;

function frame(dt: number) {
  elapsed += dt;
  resize();
  const target = frozenProgress ?? rawProgress();
  // second stage of smoothing on top of Lenis: frame-rate independent exponential follow
  progress = first ? target : THREE.MathUtils.damp(progress, target, reduceMotion ? 30 : 5.5, dt);
  const p = progress;

  // camera on the rail, adapted to the viewport, with a slow idle drift and mouse parallax
  const { fov, fit } = path.sample(p, camPos, camTarget);
  const vfov = fitCamera(fov, fit, camera.aspect, camPos, camTarget);
  if (!reduceMotion) {
    pointerSmooth.lerp(pointer, 1 - Math.exp(-dt * 3));
    const dist = camPos.distanceTo(camTarget);
    right.subVectors(camTarget, camPos).cross(camera.up).normalize();
    up.set(0, 1, 0);
    const k = Math.min(0.35, dist * 0.02);
    camPos.addScaledVector(right, (Math.sin(elapsed * 0.31) * 0.6 + pointerSmooth.x) * k);
    camPos.addScaledVector(up, (Math.sin(elapsed * 0.23 + 1) * 0.4 - pointerSmooth.y * 0.6) * k);
  }
  if (first) {
    smoothPos.copy(camPos);
    smoothTarget.copy(camTarget);
    smoothFov = vfov;
  } else {
    const a = 1 - Math.exp(-dt * 9);
    smoothPos.lerp(camPos, a);
    smoothTarget.lerp(camTarget, a);
    smoothFov += (vfov - smoothFov) * a;
  }
  camera.position.copy(smoothPos);
  camera.lookAt(smoothTarget);
  camera.fov = smoothFov;
  camera.updateProjectionMatrix();
  // lens shift: captions sit bottom-left, so push the subject right on wide screens and up on
  // tall ones (shifts the frustum, no perspective change)
  const e = camera.projectionMatrix.elements;
  e[8] -= camera.aspect > 1.9 ? 0.26 : camera.aspect > 1.1 ? 0.12 : 0;
  e[9] -= camera.aspect < 0.9 ? 0.2 : camera.aspect > 1.1 ? 0.06 : 0.1;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();

  // time of day follows the chapter stops
  const last = CHAPTERS.length - 1;
  const ci = Math.min(last - 1, Math.floor(THREE.MathUtils.clamp(p, 0, last)));
  const tod = THREE.MathUtils.lerp(CHAPTERS[ci].tod, CHAPTERS[ci + 1].tod, THREE.MathUtils.smoothstep(p - ci, 0.15, 0.85));
  applyTimeOfDay(tod, elapsed);

  // 3D lettering: each text takes the strongest envelope among the chapters that show it
  for (const [id, t] of texts) {
    let r = 0;
    CHAPTERS.forEach((c, i) => {
      if (!c.texts.includes(id)) return;
      let e = envelope(p - i);
      if (i === 0 && p <= 0.0001) e = 1;
      if (i === last && p >= last - 0.16) e = Math.max(e, THREE.MathUtils.smoothstep(p - i, -0.55, -0.16));
      r = Math.max(r, e);
    });
    // shown at two consecutive stops (the plaque from the opening view down the lane to the
    // gate): stay fully revealed for the whole leg between them
    if (ci + 1 <= last && CHAPTERS[ci].texts.includes(id) && CHAPTERS[ci + 1].texts.includes(id)) r = 1;
    // standing lettering folds away when the camera swings round behind it (no mirrored text)
    if (t instanceof Text3D && r > 0) {
      t.group.getWorldDirection(facingN);
      facingV.subVectors(camera.position, t.group.position).normalize();
      r *= THREE.MathUtils.smoothstep(facingN.dot(facingV), 0.0, 0.25);
    }
    t.setReveal(r);
  }
  // night glow on the lettering, strongest at the finale
  const g = THREE.MathUtils.smoothstep(tod, 0.45, 1);
  const finaleGlow = 1 + THREE.MathUtils.smoothstep(p, last - 0.6, last);
  for (const m of textMats.glowing) m.emissiveIntensity = (m.metalness > 0.5 ? 0.22 : 0.05) * g * finaleGlow;
  // gold leaf catches a little light by day and glows after dark
  plaqueMats.gold.emissiveIntensity = 0.06 + 0.55 * g * finaleGlow;

  // gate swings open as the camera walks up to it
  if (gate?.userData.action) {
    const ga = gate.userData.action;
    const open = THREE.MathUtils.smoothstep(p, 0.55, 1.25) * (1 - THREE.MathUtils.smoothstep(p, 1.6, 2.4));
    const y = THREE.MathUtils.lerp(ga.closedY, ga.openY, open);
    if (Math.abs(gate.rotation.y - y) > 1e-4) {
      gate.rotation.y = y;
      gateShadowFrames++;
      if (q.shadows && gateShadowFrames % (q.tier === 'high' ? 2 : 6) === 0) shadowDirty = true;
    } else if (gateShadowFrames) {
      gateShadowFrames = 0;
      shadowDirty = q.shadows;
    }
  }

  const haloScale = (renderer.getPixelRatio() * H) / (2 * Math.tan((camera.fov * DEG) / 2));
  for (const gl of glows) gl.uniforms.scale.value = haloScale;
  if (shadowDirty) {
    renderer.shadowMap.needsUpdate = true;
    shadowDirty = false;
  }
  if (composer && bloomPass?.enabled && bloomStrength > 0.01) {
    bloomPass.strength = bloomStrength;
    composer.render(dt);
  } else {
    renderer.render(scene, camera);
  }
  updateDom(p);
  first = false;

  fpsAvg += (1 / Math.max(dt, 1e-3) - fpsAvg) * 0.05;
  if (!params.has('noadapt')) adaptive.tick(dt);
}

// ------------------------------------------------------------------ test hook: text framing
const ray = new THREE.Raycaster();
function inspectText(id: string) {
  const t = texts.get(id);
  if (!t || !t.group.visible) return null;
  scene.updateMatrixWorld(true);
  const occluders = [houseRoot, hood.mesh];
  const v = new THREE.Vector3();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, seen = 0, n = 0;
  t.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.name.startsWith('letter-') || !m.visible) return;
    n++;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!;
    for (let k = 0; k < 8; k++) {
      v.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(m.matrixWorld).project(camera);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, -v.y); maxY = Math.max(maxY, -v.y);
    }
    // a letter counts as visible when the model doesn't block the ray to its centre
    const c = bb.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld);
    ray.set(camera.position, c.clone().sub(camera.position).normalize());
    ray.far = camera.position.distanceTo(c) - 0.05;
    const hit = ray.intersectObjects(occluders, true).find((h) => (h.object as THREE.Mesh).material !== houseMats.glass);
    if (!hit) seen++;
  });
  const s = (x: number) => +((x + 1) / 2).toFixed(3);
  return { minX: s(minX), maxX: s(maxX), minY: s(minY), maxY: s(maxY), visible: n ? +(seen / n).toFixed(2) : 0, letters: n };
}

// ------------------------------------------------------------------ boot
const loader = document.getElementById('loader')!;
const loaderBar = document.getElementById('loader-bar')!;

async function boot() {
  loaderBar.style.transform = 'scaleX(0.15)';
  await new Promise((r) => setTimeout(r, 30));
  build();
  loaderBar.style.transform = 'scaleX(0.6)';
  await new Promise((r) => setTimeout(r, 0));
  resize(true);
  applyTimeOfDay(CHAPTERS[0].tod, 0);
  // compile every material up front (letters included) so the first scroll never hitches
  for (const t of texts.values()) { t.group.visible = true; t.setReveal(1); }
  camera.position.set(...CHAPTERS[0].camera.position);
  camera.lookAt(...CHAPTERS[0].camera.target);
  try {
    await renderer.compileAsync(scene, camera);
  } catch {
    renderer.compile(scene, camera);
  }
  // warm the night look too: bloom passes, bulb halos and the shadow pass compile on first use
  applyTimeOfDay(1, 0);
  shadowDirty = true;
  renderer.shadowMap.needsUpdate = true;
  if (composer) composer.render(0.016);
  else renderer.render(scene, camera);
  applyTimeOfDay(CHAPTERS[0].tod, 0);
  for (const t of texts.values()) t.setReveal(0);
  loaderBar.style.transform = 'scaleX(1)';

  let last = performance.now();
  gsap.ticker.lagSmoothing(0);
  gsap.ticker.add((time) => {
    lenis.raf(time * 1000);
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    frame(dt);
  });
  window.__TOUR__ = {
    ready: false, tier: q.tier, chapters: CHAPTERS.length,
    progress: () => progress,
    setProgress: (p: number) => { frozenProgress = p; progress = p; first = true; },
    release: () => { frozenProgress = null; },
    fps: () => Math.round(fpsAvg),
    dpr: () => renderer.getPixelRatio(),
    inspectText,
    houseBounds: () => {
      const b = new THREE.Box3().setFromObject(houseRoot.getObjectByName('house-shell')!);
      const v = new THREE.Vector3();
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let k = 0; k < 8; k++) {
        v.set(k & 1 ? b.max.x : b.min.x, k & 2 ? b.max.y : b.min.y, k & 4 ? b.max.z : b.min.z).project(camera);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, -v.y); maxY = Math.max(maxY, -v.y);
      }
      const s = (x: number) => +((x + 1) / 2).toFixed(3);
      return { minX: s(minX), maxX: s(maxX), minY: s(minY), maxY: s(maxY) };
    },
    camera: () => ({ pos: camera.position.toArray().map((v) => +v.toFixed(2)), fov: +camera.fov.toFixed(1) }),
  };
  // let a couple of frames land before revealing
  await new Promise((r) => setTimeout(r, 120));
  gsap.to(loader, { autoAlpha: 0, duration: reduceMotion ? 0 : 0.9, ease: 'power2.out', onComplete: () => loader.remove() });
  gsap.from('.brand', { y: -12, autoAlpha: 0, duration: 1.1, delay: 0.25, ease: 'power3.out' });
  lenis.start();
  window.__TOUR__.ready = true;
}

initOutro();
addEventListener('resize', () => resize(), { passive: true });
// mobile browsers may drop the GL context under memory pressure; rebuild cleanly when it returns
canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
canvas.addEventListener('webglcontextrestored', () => location.reload());
document.addEventListener('visibilitychange', () => { if (!document.hidden) first = true; });
boot();
