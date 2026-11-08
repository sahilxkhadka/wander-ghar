/**
 * Device quality tiers. The tier is picked once at startup (it decides which lights and shadow
 * maps exist, which fixes the shader variants), then `AdaptiveResolution` trims the pixel ratio at
 * runtime if the device still can't hold a smooth frame rate.
 */
export type Tier = 'low' | 'mid' | 'high';

export interface QualitySettings {
  tier: Tier;
  /** Upper bound for renderer pixel ratio. */
  dprCap: number;
  /** Lowest pixel ratio the adaptive scaler may fall back to. */
  dprFloor: number;
  antialias: boolean;
  shadows: boolean;
  softShadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  /** Per-lamp point lights under the soffits (each one costs every lit fragment). */
  lampLights: boolean;
  /** Coloured spill lights from the Tihar strings. */
  spillLights: boolean;
  /** Bevel/curve detail of the extruded letters. */
  curveSegments: number;
  bevelSegments: number;
}

const coarse = () => matchMedia('(pointer: coarse)').matches;

function gpuName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(name ?? '');
  } catch {
    return '';
  }
}

export function detectTier(): Tier {
  const forced = new URLSearchParams(location.search).get('q');
  if (forced === 'low' || forced === 'mid' || forced === 'high') return forced;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const gpu = gpuName().toLowerCase();
  const mobile = coarse() || /android|iphone|ipad|ipod/i.test(navigator.userAgent);
  // entry-level mobile GPUs: Mali-4xx/T6xx/G31/G51/G52, Adreno 3xx-5xx, PowerVR, software renderers
  const weakGpu = /mali-(4|t6|t7|g31|g51|g52)|adreno \(tm\) [345]\d\d|powervr|swiftshader|llvmpipe|software/.test(gpu);
  if (weakGpu || cores <= 4 || mem <= 2) return 'low';
  if (mobile) return mem >= 6 || /apple gpu|adreno \(tm\) (6[4-9]|7)\d\d|mali-g7[1-9]|mali-g[67]1\d|immortalis/.test(gpu) ? 'mid' : 'low';
  return 'high';
}

export function settingsFor(tier: Tier): QualitySettings {
  const dpr = window.devicePixelRatio || 1;
  switch (tier) {
    case 'high':
      return { tier, dprCap: Math.min(dpr, 2), dprFloor: 1, antialias: dpr < 2, shadows: true, softShadows: true, shadowMapSize: 2048, bloom: true, lampLights: true, spillLights: true, curveSegments: 8, bevelSegments: 3 };
    case 'mid':
      return { tier, dprCap: Math.min(dpr, 1.6), dprFloor: 0.9, antialias: dpr < 1.5, shadows: true, softShadows: false, shadowMapSize: 1024, bloom: false, lampLights: true, spillLights: false, curveSegments: 6, bevelSegments: 2 };
    default:
      return { tier, dprCap: Math.min(dpr, 1.25), dprFloor: 0.7, antialias: false, shadows: false, softShadows: false, shadowMapSize: 512, bloom: false, lampLights: false, spillLights: false, curveSegments: 4, bevelSegments: 1 };
  }
}

/**
 * Watches frame times and steps the pixel ratio down while the average frame takes longer than
 * the budget. It never steps back up, so the resolution can't oscillate mid-scroll.
 */
export class AdaptiveResolution {
  private acc = 0;
  private n = 0;
  private cooldown = 1.5;
  dpr: number;

  constructor(private q: QualitySettings, private apply: (dpr: number) => void, private onBloomOff: () => void) {
    this.dpr = q.dprCap;
  }

  /** Feed the last frame's duration in seconds. Long stalls (tab switch, GC) are ignored. */
  tick(dt: number) {
    if (dt > 0.25) return;
    this.cooldown -= dt;
    this.acc += dt;
    this.n++;
    if (this.cooldown > 0 || this.acc < 1.2) return;
    const avg = this.acc / this.n;
    this.acc = 0;
    this.n = 0;
    if (avg <= 1 / 48) return;
    this.cooldown = 1.5;
    if (this.q.bloom) {
      this.q.bloom = false;
      this.onBloomOff();
      return;
    }
    const next = Math.max(this.q.dprFloor, +(this.dpr * 0.85).toFixed(2));
    if (next < this.dpr) {
      this.dpr = next;
      this.apply(next);
    }
  }
}
