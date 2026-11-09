/**
 * World v2 — THE TOWN'S VEHICLES AS MODELS: small low-poly shapes in code,
 * rendered offline into a sheet by `dev/bake-cars.ts`. A car in the game is a
 * sprite from that sheet; nothing here runs while it plays. @see plans/baked-cars.md
 *
 * IN METRES, as a car is measured: `l` forward from the middle, `w` across
 * (left positive), `z` up from the road. The bake turns them into tiles and
 * half steps by `TILES_PER_M` and `HALF_STEPS_PER_M`, so a 4 m hatchback is
 * as long as the old box car was.
 *
 * A model is a list of SLABS — a box whose top can be inset, so a cabin rakes
 * back to its roof — and WHEELS. Each face of a slab is a material; a window
 * or a light is a thin slab standing just proud of the body, so the depth test
 * puts it in front. Paint is white here and tinted in the game.
 */

/** What a face is made of. `paint` is the tinted layer; the rest are baked in their own colours. */
export type Mat =
  | "paint" | "glass" | "tyre" | "hub" | "trim" | "chrome" | "lamp" | "tail" | "indicator"
  | "plate" | "rearPlate" | "grille" | "roof" | "livery" | "liveryAlt" | "light" | "bed";

export type Faces = { side?: Mat; top?: Mat; front?: Mat; back?: Mat };

/**
 * A box from `l0` (front) back to `l1`, `w` either side of `wc`, from `z0` up
 * to `z1`. Its top is inset by `inF` from the front, `inB` from the back and
 * `inS` from each side: a raked windscreen, a sloped tail, a tumblehome.
 */
export type Slab = {
  l0: number; l1: number; w: number; wc?: number; z0: number; z1: number;
  inF?: number; inB?: number; inS?: number;
  mat: Mat; faces?: Faces;
};

/** A wheel: its centre along the car, out to `w` from the middle (both sides), radius and tyre width. */
export type Wheel = { l: number; w: number; r: number; width: number };

export type Model = {
  id: string;
  /** Length and width overall, metres: the game reads them for spacing and for the band. */
  length: number;
  width: number;
  slabs: Slab[];
  wheels: Wheel[];
};

/** Tiles to a metre: a 4.3 m car is 0.39 tiles, as the old box car was. */
export const TILES_PER_M = 0.09;
/**
 * Half steps to a metre, from the projection: a tile's side is 93 px of true
 * length on screen's 2:1 dimetric and a half step stands 16.5 px at 30°, so a
 * half step is 0.204 tiles tall — and a metre up is 0.09 / 0.204 of one.
 */
export const HALF_STEPS_PER_M = TILES_PER_M / 0.2041;

// ─── PARTS ───────────────────────────────────────────────────────────────────

/** Lamps, plates and bumpers at both ends of a body from `front` back to `back`, `w` half wide. */
function ends(front: number, back: number, w: number, lampZ: number, opts: { bumperZ?: number; lampW?: number } = {}): Slab[] {
  const bz = opts.bumperZ ?? 0.32, lw = opts.lampW ?? 0.32, d = 0.03;
  const lampAt = (l0: number, l1: number, mat: Mat): Slab[] => [1, -1].map((s) => ({
    l0, l1, w: lw / 2, wc: s * (w - lw / 2 - 0.06), z0: lampZ, z1: lampZ + 0.13, mat,
  }));
  return [
    // Bumpers: a band of trim across each end, a little proud of the body.
    { l0: front + d, l1: front - 0.15, w: w + 0.01, z0: bz - 0.14, z1: bz + 0.12, mat: "trim" },
    { l0: back + 0.15, l1: back - d, w: w + 0.01, z0: bz - 0.14, z1: bz + 0.12, mat: "trim" },
    ...lampAt(front + d * 1.2, front - 0.05, "lamp"),
    ...lampAt(back + 0.05, back - d * 1.2, "tail"),
    // Plates, white at the front and yellow at the back, as on British cars.
    { l0: front + d * 1.6, l1: front, w: 0.26, z0: bz - 0.06, z1: bz + 0.06, mat: "plate" },
    { l0: back, l1: back - d * 1.6, w: 0.26, z0: bz + 0.18, z1: bz + 0.3, mat: "rearPlate" },
  ];
}

/** Door mirrors, either side at `l`. */
const mirrors = (l: number, w: number, z: number): Slab[] => [1, -1].map((s) => ({
  l0: l, l1: l - 0.12, w: 0.06, wc: s * (w + 0.06), z0: z, z1: z + 0.13, mat: "paint" as Mat,
}));

/** Four wheels at `front` and `back` axles, `w` out to the middle of each tyre: its outer wall a touch proud of the body. */
const wheels = (front: number, back: number, w: number, r = 0.31, width = 0.2): Wheel[] => [
  { l: front, w, r, width }, { l: back, w, r, width },
];

// ─── THE MODELS ──────────────────────────────────────────────────────────────

/** A five-door hatchback: a short bonnet, a cabin running nearly to the tail, an upright hatch. */
const hatchback: Model = {
  id: "hatchback", length: 4.0, width: 1.76,
  slabs: [
    // The body to the waist, its top edges eased.
    { l0: 2.0, l1: -2.0, w: 0.88, z0: 0.2, z1: 0.86, inF: 0.12, inB: 0.05, inS: 0.03, mat: "paint" },
    // The glasshouse: a raked screen, a near-upright hatch, a painted roof.
    { l0: 0.95, l1: -1.92, w: 0.85, z0: 0.86, z1: 1.46, inF: 0.82, inB: 0.28, inS: 0.13, mat: "glass", faces: { top: "paint" } },
    ...mirrors(0.82, 0.85, 0.86),
    ...ends(2.0, -2.0, 0.88, 0.62),
  ],
  wheels: wheels(1.3, -1.28, 0.8),
};

/** A saloon: a long bonnet, a cabin in the middle, a boot of its own. */
const saloon: Model = {
  id: "saloon", length: 4.65, width: 1.8,
  slabs: [
    { l0: 2.32, l1: -2.32, w: 0.9, z0: 0.2, z1: 0.82, inF: 0.14, inB: 0.1, inS: 0.03, mat: "paint" },
    // The boot lid stands a little over the waist.
    { l0: -1.3, l1: -2.28, w: 0.87, z0: 0.82, z1: 0.92, inB: 0.12, inS: 0.02, mat: "paint" },
    { l0: 0.9, l1: -1.4, w: 0.86, z0: 0.82, z1: 1.42, inF: 0.8, inB: 0.62, inS: 0.13, mat: "glass", faces: { top: "paint" } },
    ...mirrors(0.75, 0.86, 0.82),
    ...ends(2.32, -2.32, 0.9, 0.6),
  ],
  wheels: wheels(1.45, -1.45, 0.82, 0.32),
};

/** A panel van: a short nose, a tall box of a body, glass only in the cab. */
const panelVan: Model = {
  id: "panelVan", length: 5.2, width: 2.0,
  slabs: [
    // The nose, to the bonnet.
    { l0: 2.6, l1: 1.6, w: 1.0, z0: 0.25, z1: 1.05, inF: 0.2, inS: 0.03, mat: "paint" },
    // The box: the cab and the load space in one, its screen raked at the front.
    { l0: 1.75, l1: -2.6, w: 1.0, z0: 0.25, z1: 2.45, inF: 0.55, inS: 0.04, inB: 0.02, mat: "paint" },
    // The windscreen and cab windows, standing just proud of the box.
    { l0: 1.72, l1: 1.0, w: 1.0, z0: 1.2, z1: 2.25, inF: 0.48, inS: 0.04, mat: "glass", faces: { top: "paint", back: "paint" } },
    { l0: 1.0, l1: 0.35, w: 1.005, z0: 1.3, z1: 2.2, inS: 0.04, mat: "glass", faces: { top: "paint", front: "paint", back: "paint" } },
    // Rear doors' seam and handles, dark.
    { l0: -2.6, l1: -2.62, w: 0.015, z0: 0.4, z1: 2.3, mat: "trim" },
    ...mirrors(1.55, 1.0, 1.35),
    ...ends(2.6, -2.6, 1.0, 0.82, { bumperZ: 0.4, lampW: 0.3 }),
  ],
  wheels: wheels(1.7, -1.75, 0.9, 0.34, 0.22),
};

export const MODELS: readonly Model[] = [hatchback, saloon, panelVan];
export const modelById = new Map(MODELS.map((m) => [m.id, m]));
