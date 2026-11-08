/**
 * The scroll tour, one entry per stop. World frame matches src/house/layout.json:
 * x = east, y = up, z = south (street side), origin at the south-east corner of the main block.
 *
 * Camera framings are authored for a square-ish viewport; `fitCamera` in cameraPath.ts widens or
 * dollies them for portrait phones. Text placements sit on real surfaces of the model: the lane,
 * the gate piers, the lawn, the balcony handrail, the terrace slab and the compound wall caps.
 */
export type Vec3 = [number, number, number];

export type Reveal = 'rise' | 'flip' | 'drop' | 'swing';

export interface TextSpec {
  id: string;
  text: string;
  /** Cap height-ish glyph size in metres. */
  size: number;
  depth: number;
  /** Baseline centre of the line. */
  position: Vec3;
  /** Euler (x, y, z) in radians; y turns the line, x tilts it back. */
  rotation: Vec3;
  /** Lay letters on a circular arc of this radius (centre below the line). */
  arc?: number;
  letterSpacing?: number;
  /** Turn every letter about its own vertical axis (radians), louvre-style, to face an oblique camera. */
  letterYaw?: number;
  reveal: Reveal;
  style: 'gold' | 'ivory' | 'brass';
  /** Several lines, each offset (local x, y, z) from the group origin; replaces `text`. */
  lines?: { text: string; offset: Vec3 }[];
  /** Narrow (portrait) screens: overrides, e.g. a smaller size or a line break. */
  portrait?: Partial<Omit<TextSpec, 'id' | 'portrait'>>;
}

export interface CameraKey {
  position: Vec3;
  target: Vec3;
  /** Vertical fov (deg) for a square viewport. */
  fov: number;
  /** Width (m) at the target that must stay on screen; narrow viewports dolly back for it. */
  fit?: number;
}

export interface Chapter {
  id: string;
  /** Short name (dot-nav label); the caption copy lives in index.html. */
  eyebrow: string;
  camera: CameraKey;
  /** Time of day: 0 bright day, 0.3 evening tint, 0.6 sunset, 1 night. */
  tod: number;
  /** Text ids shown at this stop. */
  texts: string[];
  /** Scroll length of the leg arriving at this stop, in chapter spans (default 1). */
  span?: number;
  /** Waypoints flown through on the way *to* this chapter from the previous one (no dwell). */
  via?: CameraKey[];
  /** Portrait-screen framing of this stop and its waypoints (defaults to the landscape ones). */
  portrait?: CameraKey;
  portraitVia?: CameraKey[];
}

// wall line of the street-side compound wall east of the gate: z = 1.34 + 0.1852 (x + 0.33)
const WALL_ANGLE = -Math.atan2(1.45, 7.83); // rotation.y that runs a line along that wall
const wallZ = (x: number) => 1.34 + 0.1852 * (x + 0.33);
// outward (street) normal of that wall
const OUT: [number, number] = [-0.1822, 0.9833];
const onStreet = (x: number, off: number, y: number): Vec3 => [x + OUT[0] * off, y, wallZ(x) + OUT[1] * off];
const onWall = (x: number, y: number): Vec3 => [x - OUT[0] * 0.115, y, wallZ(x) - OUT[1] * 0.115];

// arc centre of the gate banner: midway between the two pier centres, on the pier cap tops
export const BANNER_POS: Vec3 = [0.652, 2.16, 1.4];
export { WALL_ANGLE };

export interface PlaqueSpec {
  id: string;
  /** Lines in the slab plane: `y` runs from the lane toward the house. */
  lines: { text: string; size: number; y: number; tracking?: number }[];
  /** Minimum slab size [along the lane, across it] in metres; it grows to fit the lines. */
  slab: [number, number];
  /** Centre of the slab's underside. */
  position: Vec3;
  rotationY: number;
  portrait?: Partial<Omit<PlaqueSpec, 'id' | 'portrait'>>;
}

// the name, cut into a granite slab set in the lane in front of the gate
export const PLAQUES: PlaqueSpec[] = [
  {
    id: 'name', slab: [6, 2.2], position: onStreet(0.65, 2.7, 0.302), rotationY: WALL_ANGLE,
    lines: [{ text: 'WANDER GHAR', size: 0.8, y: 0.2, tracking: 0.1 }, { text: 'A WANDER PIXELS HOME', size: 0.22, y: -0.68, tracking: 0.3 }],
    portrait: {
      slab: [3.6, 3.2],
      lines: [{ text: 'WANDER', size: 0.86, y: 0.72, tracking: 0.08 }, { text: 'GHAR', size: 0.86, y: -0.34, tracking: 0.14 }, { text: 'A WANDER PIXELS HOME', size: 0.19, y: -1.12, tracking: 0.26 }],
    },
  },
];

export const TEXTS: TextSpec[] = [
  // gold letters on the enamel arch board over the gate (gateBanner.ts), just proud of its face
  { id: 'welcome', text: 'WELCOME', size: 0.19, depth: 0.035, position: BANNER_POS, rotation: [0, WALL_ANGLE, 0], arc: 0.8, letterSpacing: 0.1, lines: [{ text: 'WELCOME', offset: [0, 0, 0.045] }], reveal: 'swing', style: 'brass' },
  // standing across the lawn, between the east wing and the east wall, facing the gate
  { id: 'garden', text: 'THE GARDEN', size: 0.5, depth: 0.15, position: [4.4, 0.02, -5.2], rotation: [0, 0, 0], letterSpacing: 0.04, reveal: 'rise', style: 'ivory',
    portrait: { size: 0.52, lines: [{ text: 'THE', offset: [0, 0, -0.7] }, { text: 'GARDEN', offset: [0, 0, 0.6] }] } },
  // perched on the balcony handrail (east rail, top at 4.21 m)
  { id: 'balcony', text: 'THE BALCONY', size: 0.22, depth: 0.06, position: [1.34, 4.235, -2.3], rotation: [0, Math.PI / 2, 0], reveal: 'flip', style: 'gold' },
  // standing on the open terrace slab, turned toward the south-east
  { id: 'rooftop', text: 'THE ROOFTOP', size: 0.62, depth: 0.18, position: [-0.6, 6.43, -6.2], rotation: [0, 0.42, 0], reveal: 'rise', style: 'gold' },
  // on the street-wall cap east of the gate, lit by the strings above
  { id: 'tihar', text: 'TIHAR NIGHTS', size: 0.33, depth: 0.1, position: onWall(4.25, 1.95), rotation: [0, WALL_ANGLE, 0], letterYaw: 0.6, letterSpacing: 0.36, reveal: 'swing', style: 'gold',
    portrait: { size: 0.34, letterYaw: 0.5, letterSpacing: 0.42, lines: [{ text: 'TIHAR', offset: [0, 0.46, 0] }, { text: 'NIGHTS', offset: [0, 0, 0] }] } },
];

export const CHAPTERS: Chapter[] = [
  {
    id: 'home', eyebrow: 'Wander Ghar',
    // the whole house from across the lane, the name plaque in the foreground
    camera: { position: [8.4, 5.6, 12.2], target: [-1.1, 3.2, -1.6], fov: 54 },
    portrait: { position: [7.5, 13.5, 24.0], target: [-1.6, 3.6, -2.8], fov: 54 },
    tod: 0, texts: ['name'],
  },
  {
    id: 'gate', eyebrow: 'The gate',
    camera: { position: [-0.1, 2.3, 5.8], target: [0.62, 2.6, 1.3], fov: 52, fit: 2.7 },
    tod: 0.04, texts: ['welcome', 'name'], span: 1.6,
    // down to the far end of the lane, then glide along the road over the plaque to the gate
    via: [
      { position: [11.0, 2.5, 6.4], target: [2.6, 1.5, 4.3], fov: 54 },
      { position: [5.6, 2.3, 5.9], target: [0.6, 0.9, 3.6], fov: 54 },
      { position: [2.2, 2.9, 7.0], target: [0.2, 0.4, 3.2], fov: 54 },
    ],
  },
  {
    id: 'garden', eyebrow: 'The garden',
    camera: { position: [3.3, 2.9, 1.2], target: [4.7, 0.75, -5.2], fov: 52 },
    portrait: { position: [3.7, 3.9, 1.5], target: [4.4, 0.35, -5.2], fov: 52 },
    tod: 0.1, texts: ['garden'],
    via: [{ position: [2.2, 3.9, 3.6], target: [4.6, 1.4, -4.0], fov: 52 }],
  },
  {
    id: 'balcony', eyebrow: 'The balcony',
    camera: { position: [4.7, 4.55, -0.9], target: [1.15, 4.0, -2.4], fov: 50, fit: 2.4 },
    portrait: { position: [4.5, 4.7, -1.35], target: [1.2, 4.05, -2.35], fov: 50 },
    tod: 0.18, texts: ['balcony'],
  },
  {
    id: 'rooftop', eyebrow: 'The rooftop',
    camera: { position: [8.6, 12.4, 6.6], target: [-1.2, 6.6, -4.4], fov: 50, fit: 8 },
    tod: 0.32, texts: ['rooftop'],
    via: [{ position: [6.8, 8.0, 1.8], target: [0.2, 6.2, -3.4], fov: 50 }],
  },
  {
    id: 'night', eyebrow: 'The night view',
    camera: { position: [7.4, 1.75, 6.4], target: [-0.3, 4.6, -2.0], fov: 60, fit: 5 },
    portrait: { position: [7.7, 2.45, 7.6], target: [0.8, 4.2, -1.6], fov: 58 },
    tod: 0.94, texts: ['tihar'], span: 1.4,
    // down the lit front of the house while the sun sets (the back of the house stays unvisited)
    via: [
      { position: [12.5, 9.0, 12.5], target: [-0.8, 4.4, -2.2], fov: 48 },
      { position: [10.0, 3.6, 9.4], target: [-0.4, 4.4, -2.0], fov: 54 },
    ],
  },
  {
    id: 'finale', eyebrow: 'Goodnight',
    camera: { position: [3.4, 11.6, 14.6], target: [0.0, 1.4, 1.6], fov: 52 },
    portrait: { position: [0.6, 12.8, 13.6], target: [0.2, 1.6, 1.0], fov: 54 },
    tod: 1, texts: ['name'],
  },
];
