import * as THREE from 'three';
import * as tex from './textures';

/**
 * Material library. Ids mirror object-sculpt-spec.json `materials[].id` via
 * `userData.referenceMaterialId`, so a picked mesh can be traced back to its spec entry.
 * `textured` (material pass) adds albedo maps; `surface` (surface pass) adds independent
 * roughness and bump channels.
 */
export interface MaterialLevel {
  textured: boolean;
  surface: boolean;
}

export type HouseMaterials = ReturnType<typeof createMaterials>;

function std(id: string, params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial(params);
  m.name = id;
  m.userData.referenceMaterialId = id;
  return m;
}

function withPbr(m: THREE.MeshStandardMaterial, maps: tex.PbrMaps, level: MaterialLevel, bumpScale: number) {
  if (level.textured) m.map = maps.map;
  if (level.surface) {
    m.roughnessMap = maps.roughnessMap;
    m.bumpMap = maps.bumpMap;
    m.bumpScale = bumpScale;
  }
  return m;
}

/** Surface pass: painted cement render gets a fine trowel/sand bump; albedo stays the flat paint. */
function plaster(m: THREE.MeshStandardMaterial, level: MaterialLevel, bumpScale: number) {
  if (level.surface) {
    m.bumpMap = plasterBump;
    m.bumpScale = bumpScale;
  }
  return m;
}

const plasterBump = (() => {
  const t = tex.concrete(67, '#808080');
  t.colorSpace = THREE.NoColorSpace;
  return t;
})();

export function createMaterials(level: MaterialLevel) {
  const brick = withPbr(std('brick-facade', { color: level.textured ? 0xffffff : 0xb5653c, roughness: 0.88 }), tex.facadeBrick(), level, 0.9);
  const brickOld = withPbr(std('brick-old', { color: level.textured ? 0xffffff : 0x8a5a48, roughness: 0.95 }), tex.oldBrick(), level, 3);
  const paving = withPbr(std('stone-paving', { color: level.textured ? 0xffffff : 0xa7a39a, roughness: 0.92 }), tex.stonePaving(), level, 2.5);

  const lawnMap = tex.lawn();
  const lawn = std('lawn', { color: level.textured ? 0xffffff : 0x4f7a3a, roughness: 0.97, map: level.textured ? lawnMap : null });
  const concreteMap = tex.concrete(41, '#9a9893');
  const terraceFloor = std('terrace-floor', { color: level.textured ? 0xffffff : 0x8f8d88, roughness: 0.9, map: level.textured ? concreteMap : null });
  const kerb = std('kerb-concrete', { color: level.textured ? 0xffffff : 0xc9c6bd, roughness: 0.9, map: level.textured ? tex.concrete(43, '#c8c4ba') : null });
  const soil = std('soil', { color: 0x3b2f24, roughness: 1 });
  const groundOuter = std('ground-outer', { color: level.textured ? 0xffffff : 0x55524b, roughness: 1, map: level.textured ? tex.concrete(47, '#55524b') : null });

  const curtainMap = tex.curtain();
  const blindsMap = tex.blinds();
  return {
    brick,
    brickOld,
    paving,
    lawn,
    terraceFloor,
    kerb,
    soil,
    groundOuter,
    trim: plaster(std('trim-bluegrey', { color: 0x708198, roughness: 0.72 }), level, 0.25),
    soffit: plaster(std('soffit-white', { color: 0xeceff2, roughness: 0.92, emissive: 0xdfe6ff, emissiveIntensity: 0 }), level, 0.15),
    doorWhite: std('door-white', { color: 0xf1f1ec, roughness: 0.45 }),
    steel: std('steel-paint', { color: 0x98b0c2, roughness: 0.5, metalness: 0.2 }),
    grille: std('steel-paint', { color: 0xdfe3e6, roughness: 0.45, metalness: 0.25 }),
    frameDark: std('steel-paint', { color: 0x3b4249, roughness: 0.4, metalness: 0.5 }),
    tube: std('steel-tube', { color: 0xc9ccd0, roughness: 0.32, metalness: 0.9 }),
    glass: (() => {
      const m = new THREE.MeshPhysicalMaterial({ color: 0x9fb4c2, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false });
      m.name = 'glass';
      m.userData.referenceMaterialId = 'glass';
      return m;
    })(),
    curtain: std('curtain', { color: 0xffffff, map: curtainMap, roughness: 0.95, emissive: 0xfff0d6, emissiveMap: curtainMap, emissiveIntensity: 0 }),
    blinds: std('curtain', { color: 0xffffff, map: blindsMap, roughness: 0.9, emissive: 0xfff3dc, emissiveMap: blindsMap, emissiveIntensity: 0 }),
    interior: std('interior-dark', { color: 0x0c1116, roughness: 1, emissive: 0x16202c, emissiveIntensity: 0 }),
    corrugated: std('corrugated-sheet', { color: 0x9aa3a8, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }),
    roofTrim: std('trim-blue', { color: 0x2f5f9e, roughness: 0.6 }),
    tank: std('tank-black', { color: 0x1c1c1e, roughness: 0.55 }),
    stoneCap: std('stone-cap', { color: level.textured ? 0xffffff : 0x86827a, roughness: 0.95, map: level.textured ? tex.concrete(59, '#86827a') : null }),
    wallCap: std('wall-cap', { color: level.textured ? 0xffffff : 0x77736b, roughness: 1, map: level.textured ? tex.concrete(61, '#77736b') : null }),
    moss: std('moss', { map: tex.mossBand(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }),
    gateSteel: std('steel-paint', { color: 0x5f7484, roughness: 0.55, metalness: 0.35 }),
    bulb: (() => {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      m.name = 'bulb-emissive';
      m.userData.referenceMaterialId = 'bulb-emissive';
      return m;
    })(),
    lampGlass: std('lamp-glass', { color: 0xf7f3e8, emissive: 0xfff1d8, emissiveIntensity: 0, roughness: 0.2 }),
    lampBase: std('lamp-base', { color: 0x2b2b2d, roughness: 0.5, metalness: 0.6 }),
    leaf: std('leaf', { color: 0x223d1c, roughness: 0.85 }),
    leafLight: std('leaf', { color: 0x3a5f2a, roughness: 0.85 }),
    leafCard: std('leaf', { map: tex.leafCluster(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 }),
    banana: std('leaf', { color: 0x5d8f3a, roughness: 0.7, side: THREE.DoubleSide }),
    trunk: std('trunk', { color: 0x4a3b2c, roughness: 1 }),
    bananaTrunk: std('trunk', { color: 0x7f8a4a, roughness: 0.9 }),
    flowerOrange: std('flower', { color: 0xff8a10, roughness: 0.8, emissive: 0x401800, emissiveIntensity: 0.2 }),
    flowerYellow: std('flower', { color: 0xffc21a, roughness: 0.8 }),
    flowerPink: std('flower', { color: 0xd9277a, roughness: 0.8 }),
    flowerRed: std('flower', { color: 0xc8202c, roughness: 0.8 }),
    pot: std('terracotta-pot', { color: 0x9c4f2d, roughness: 0.9 }),
  };
}

/** Materials whose emissive is switched on at night (backlit curtains, lamp domes, windows). */
export function nightMaterials(m: HouseMaterials): [THREE.MeshStandardMaterial, number][] {
  return [
    [m.curtain, 0.85],
    [m.blinds, 0.75],
    [m.lampGlass, 0.75],
    [m.soffit, 0.22],
    [m.interior, 0.35],
  ];
}
