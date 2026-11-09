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
  | "plate" | "rearPlate" | "grille" | "roof" | "livery" | "liveryAlt" | "light" | "bed"
  | "roofBlack" | "roofWhite" | "seat" | "interior"
  | "liveryWhite" | "liveryBlack" | "liveryRed" | "liveryGreen" | "load" | "brick" | "gravel" | "aiLoad" | "sign" | "violet";

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
  /** Where the roof is, for what goes on it: its front and back, half width and height. */
  roof?: { l0: number; l1: number; w: number; z: number };
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

/**
 * A GLASSHOUSE: the cabin from the waist `z0` to the roof `z1`, a raked screen
 * (`inF`) and rear glass (`inB`), its sides drawn in (`inS`). Cut along its
 * length at each pillar — `[where, how wide]`, inside the roof's span — into
 * windows of glass and pillars of paint. Its roof is `roof`.
 */
function glasshouse(g: {
  l0: number; l1: number; w: number; z0: number; z1: number; inF: number; inB: number; inS: number;
  pillars?: [number, number][]; roof?: Mat;
}): { slabs: Slab[]; roof: NonNullable<Model["roof"]> } {
  const cuts = [g.l0];
  for (const [at, wd] of g.pillars ?? []) cuts.push(at + wd / 2, at - wd / 2);
  cuts.push(g.l1);
  const slabs: Slab[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const first = k === 0, last = k + 2 === cuts.length, pillar = k % 2 === 1;
    slabs.push({
      l0: cuts[k], l1: cuts[k + 1], w: g.w, z0: g.z0, z1: g.z1,
      inF: first ? g.inF : 0, inB: last ? g.inB : 0, inS: g.inS,
      mat: pillar ? "paint" : "glass", faces: { top: g.roof ?? "paint" },
    });
  }
  return { slabs, roof: { l0: g.l0 - g.inF, l1: g.l1 + g.inB, w: g.w - g.inS, z: g.z1 } };
}

/** The lower body to the waist, its top edges eased. */
const body = (l: number, w: number, z0: number, z1: number, inF = 0.12, inB = 0.06): Slab =>
  ({ l0: l, l1: -l, w, z0, z1, inF, inB, inS: 0.03, mat: "paint" });

/** Black plastic round the bottom of the sides and over the arches: an SUV's. */
const cladding = (l: number, w: number, z: number): Slab => ({ l0: l - 0.05, l1: -l + 0.05, w: w + 0.012, z0: z - 0.12, z1: z + 0.12, mat: "trim" });

/** A car from its parts: the body, the glasshouse, mirrors, ends and wheels. */
function car(id: string, length: number, width: number, parts: {
  body: Slab[]; house: ReturnType<typeof glasshouse>; mirrorAt: number; lampZ: number; wheels: Wheel[]; extra?: Slab[];
  bumperZ?: number;
}): Model {
  const w = width / 2;
  return {
    id, length, width, roof: parts.house.roof,
    slabs: [...parts.body, ...parts.house.slabs, ...mirrors(parts.mirrorAt, parts.house.roof.w + 0.08, parts.house.slabs[0].z0),
      ...ends(length / 2, -length / 2, w, parts.lampZ, { bumperZ: parts.bumperZ }), ...(parts.extra ?? [])],
    wheels: parts.wheels,
  };
}

// ─── THE MODELS ──────────────────────────────────────────────────────────────

/** A city car: short, tall for its length, a hatch straight down. */
const cityCar = car("cityCar", 3.55, 1.64, {
  body: [body(1.775, 0.82, 0.2, 0.84, 0.14, 0.04)],
  house: glasshouse({ l0: 0.75, l1: -1.7, w: 0.8, z0: 0.84, z1: 1.5, inF: 0.72, inB: 0.16, inS: 0.12, pillars: [[-0.5, 0.1]] }),
  mirrorAt: 0.62, lampZ: 0.62, wheels: wheels(1.15, -1.15, 0.74, 0.29, 0.18),
});

/** A five-door hatchback: a short bonnet, a cabin running nearly to the tail, an upright hatch. */
const hatchback = car("hatchback", 4.0, 1.76, {
  body: [body(2.0, 0.88, 0.2, 0.86, 0.12, 0.05)],
  house: glasshouse({ l0: 0.95, l1: -1.92, w: 0.85, z0: 0.86, z1: 1.46, inF: 0.82, inB: 0.28, inS: 0.13, pillars: [[-0.45, 0.1]] }),
  mirrorAt: 0.82, lampZ: 0.62, wheels: wheels(1.3, -1.28, 0.8),
});

/** A hot hatch: the hatchback lower, on bigger wheels, a spoiler over the hatch. */
const hotHatch = car("hotHatch", 4.05, 1.8, {
  body: [body(2.02, 0.9, 0.16, 0.8, 0.14, 0.05)],
  house: glasshouse({ l0: 0.9, l1: -1.92, w: 0.86, z0: 0.8, z1: 1.36, inF: 0.84, inB: 0.32, inS: 0.15, pillars: [[-0.45, 0.1]] }),
  mirrorAt: 0.78, lampZ: 0.56, bumperZ: 0.28, wheels: wheels(1.32, -1.28, 0.83, 0.33, 0.22),
  extra: [{ l0: -1.45, l1: -2.02, w: 0.76, z0: 1.3, z1: 1.38, inB: 0.04, mat: "paint" }],
});

/** A saloon: a long bonnet, a cabin in the middle, a boot of its own. */
const saloon = car("saloon", 4.65, 1.8, {
  body: [body(2.32, 0.9, 0.2, 0.82, 0.14, 0.1), { l0: -1.3, l1: -2.28, w: 0.87, z0: 0.82, z1: 0.92, inB: 0.12, inS: 0.02, mat: "paint" }],
  house: glasshouse({ l0: 0.9, l1: -1.4, w: 0.86, z0: 0.82, z1: 1.42, inF: 0.8, inB: 0.62, inS: 0.13, pillars: [[-0.2, 0.11]] }),
  mirrorAt: 0.75, lampZ: 0.6, wheels: wheels(1.45, -1.45, 0.82, 0.32),
});

/** An estate: the saloon's front, its roof carried back to an upright tail. */
const estate = car("estate", 4.8, 1.82, {
  body: [body(2.4, 0.91, 0.2, 0.84, 0.14, 0.05)],
  house: glasshouse({ l0: 0.95, l1: -2.32, w: 0.87, z0: 0.84, z1: 1.46, inF: 0.82, inB: 0.2, inS: 0.13, pillars: [[-0.2, 0.11], [-1.45, 0.16]] }),
  mirrorAt: 0.8, lampZ: 0.62, wheels: wheels(1.5, -1.5, 0.83, 0.32),
});

/** A people carrier: a steep screen running into the bonnet, tall, three rows of windows. */
const mpv = car("mpv", 4.6, 1.84, {
  body: [body(2.3, 0.92, 0.24, 0.92, 0.22, 0.04)],
  house: glasshouse({ l0: 1.45, l1: -2.24, w: 0.89, z0: 0.92, z1: 1.74, inF: 1.0, inB: 0.14, inS: 0.11, pillars: [[0.1, 0.1], [-1.2, 0.12]] }),
  mirrorAt: 1.2, lampZ: 0.7, wheels: wheels(1.45, -1.45, 0.84, 0.32),
});

/** A small SUV: a hatchback stood up on bigger wheels, black cladding round its feet. */
const smallSuv = car("smallSuv", 4.3, 1.82, {
  body: [body(2.15, 0.91, 0.3, 1.0, 0.16, 0.06)],
  house: glasshouse({ l0: 0.85, l1: -2.05, w: 0.88, z0: 1.0, z1: 1.62, inF: 0.75, inB: 0.3, inS: 0.13, pillars: [[-0.45, 0.11]] }),
  mirrorAt: 0.72, lampZ: 0.78, bumperZ: 0.42, wheels: wheels(1.35, -1.35, 0.84, 0.36, 0.22),
  extra: [cladding(2.15, 0.91, 0.38)],
});

/** A large SUV: square, tall and long, three windows a side. */
const largeSuv = car("largeSuv", 4.95, 1.96, {
  body: [body(2.47, 0.98, 0.36, 1.1, 0.12, 0.04)],
  house: glasshouse({ l0: 1.0, l1: -2.4, w: 0.95, z0: 1.1, z1: 1.84, inF: 0.72, inB: 0.16, inS: 0.12, pillars: [[-0.15, 0.12], [-1.45, 0.14]] }),
  mirrorAt: 0.85, lampZ: 0.86, bumperZ: 0.48, wheels: wheels(1.6, -1.55, 0.9, 0.4, 0.26),
  extra: [cladding(2.47, 0.98, 0.44)],
});

/** A coupé: low and long-bonneted, its roof falling all the way to the tail. */
const coupe = car("coupe", 4.5, 1.84, {
  body: [body(2.25, 0.92, 0.17, 0.72, 0.22, 0.12)],
  house: glasshouse({ l0: 0.55, l1: -1.45, w: 0.86, z0: 0.72, z1: 1.28, inF: 0.82, inB: 0.85, inS: 0.17 }),
  mirrorAt: 0.42, lampZ: 0.5, bumperZ: 0.26, wheels: wheels(1.42, -1.38, 0.84, 0.33, 0.22),
});

/** A convertible, roof down: a screen frame, two seats in a dark cockpit, a deck behind. */
const convertible: Model = (() => {
  const L = 2.1, W = 0.89;
  return {
    id: "convertible", length: 4.2, width: 1.78,
    slabs: [
      { l0: L, l1: 0.5, w: W, z0: 0.18, z1: 0.78, inF: 0.2, inS: 0.03, mat: "paint" },
      { l0: 0.5, l1: -1.0, w: W, z0: 0.18, z1: 0.72, inS: 0.03, mat: "paint", faces: { top: "interior" } },
      { l0: -1.0, l1: -L, w: W, z0: 0.18, z1: 0.8, inB: 0.12, inS: 0.03, mat: "paint" },
      // The windscreen in its frame.
      { l0: 0.55, l1: 0.42, w: 0.82, z0: 0.78, z1: 1.18, inF: 0.28, inS: 0.06, mat: "glass", faces: { top: "trim" } },
      // Seat backs, and the roll hoops behind them.
      ...[1, -1].map((s): Slab => ({ l0: -0.45, l1: -0.62, w: 0.24, wc: s * 0.4, z0: 0.72, z1: 1.18, inF: 0.06, mat: "seat" })),
      ...[1, -1].map((s): Slab => ({ l0: -0.72, l1: -0.86, w: 0.2, wc: s * 0.4, z0: 0.8, z1: 1.22, inB: 0.06, mat: "paint" })),
      ...mirrors(0.4, 0.86, 0.78),
      ...ends(L, -L, W, 0.54, { bumperZ: 0.28 }),
    ],
    wheels: wheels(1.35, -1.3, 0.82, 0.33, 0.21),
  };
})();

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
    // Rear doors' seam, dark.
    { l0: -2.6, l1: -2.62, w: 0.015, z0: 0.4, z1: 2.3, mat: "trim" },
    ...mirrors(1.55, 1.0, 1.35),
    ...ends(2.6, -2.6, 1.0, 0.82, { bumperZ: 0.4, lampW: 0.3 }),
  ],
  wheels: wheels(1.7, -1.75, 0.9, 0.34, 0.22),
};

// ─── WORK ────────────────────────────────────────────────────────────────────

/** A pickup: a crew cab, and an open bed behind it with a load of odds and ends. */
const pickup = car("pickup", 5.3, 1.88, {
  body: [
    { l0: 2.65, l1: -0.8, w: 0.94, z0: 0.32, z1: 1.02, inF: 0.16, inS: 0.03, mat: "paint" },
    { l0: -0.8, l1: -2.65, w: 0.94, z0: 0.32, z1: 0.7, mat: "paint", faces: { top: "bed" } },
    ...[1, -1].map((s): Slab => ({ l0: -0.8, l1: -2.65, w: 0.06, wc: s * 0.88, z0: 0.7, z1: 1.02, mat: "paint" })),
    { l0: -2.55, l1: -2.65, w: 0.94, z0: 0.7, z1: 1.02, mat: "paint" },
  ],
  house: glasshouse({ l0: 1.0, l1: -0.8, w: 0.9, z0: 1.02, z1: 1.8, inF: 0.75, inB: 0.05, inS: 0.12, pillars: [[0.05, 0.1]] }),
  mirrorAt: 0.85, lampZ: 0.8, bumperZ: 0.48, wheels: wheels(1.65, -1.6, 0.86, 0.39, 0.25),
  extra: [
    { l0: -0.88, l1: -1.1, w: 0.82, z0: 0.7, z1: 1.0, mat: "trim" },
    { l0: -1.25, l1: -1.85, w: 0.3, wc: 0.38, z0: 0.7, z1: 1.18, mat: "load" },
    { l0: -1.95, l1: -2.45, w: 0.24, wc: -0.4, z0: 0.7, z1: 0.98, mat: "load" },
  ],
});

/** A small van: a car's front, a tall body behind it, windows only in the front doors. */
const smallVan = car("smallVan", 4.55, 1.84, {
  body: [body(2.27, 0.92, 0.26, 0.98, 0.2, 0.03)],
  house: glasshouse({ l0: 1.1, l1: -2.22, w: 0.9, z0: 0.98, z1: 1.86, inF: 0.85, inB: 0.05, inS: 0.06, pillars: [[-1.15, 2.05]] }),
  mirrorAt: 0.95, lampZ: 0.75, bumperZ: 0.4, wheels: wheels(1.45, -1.4, 0.84, 0.32),
});

/** A Luton van: a van's cab, and a tall box over its roof and back to the tail. A removal firm's. */
const lutonVan: Model = {
  id: "lutonVan", length: 6.3, width: 2.12,
  roof: { l0: 1.75, l1: -3.15, w: 1.06, z: 3.2 },
  slabs: [
    { l0: 3.15, l1: 2.2, w: 1.0, z0: 0.3, z1: 1.1, inF: 0.2, inS: 0.03, mat: "paint" },
    { l0: 2.25, l1: 1.15, w: 1.0, z0: 0.3, z1: 2.2, inF: 0.55, inS: 0.05, mat: "paint" },
    { l0: 2.22, l1: 1.75, w: 1.0, z0: 1.2, z1: 2.05, inF: 0.47, inS: 0.05, mat: "glass", faces: { top: "paint", back: "paint" } },
    { l0: 1.75, l1: 1.3, w: 1.005, z0: 1.3, z1: 1.98, inS: 0.05, mat: "glass", faces: { top: "paint", front: "paint", back: "paint" } },
    // The box, over the cab and back to the tail.
    { l0: 1.75, l1: 1.15, w: 1.06, z0: 2.25, z1: 3.2, inF: 0.3, mat: "paint" },
    { l0: 1.15, l1: -3.15, w: 1.06, z0: 0.6, z1: 3.2, mat: "paint" },
    { l0: -3.15, l1: -3.17, w: 0.015, z0: 0.7, z1: 3.05, mat: "trim" },
    ...mirrors(2.0, 1.0, 1.35),
    ...ends(3.15, -3.15, 1.0, 0.85, { bumperZ: 0.45, lampW: 0.3 }),
  ],
  wheels: wheels(2.1, -1.95, 0.92, 0.36, 0.24),
};

/**
 * A LORRY: a flat-fronted cab over the front axle, a chassis behind it, and
 * whatever it carries. `glass: false` blanks the windows, for the Machine's.
 */
function lorry(id: string, length: number, width: number, cabDepth: number, load: Slab[], axles: number[],
  opts: { cab?: Mat; glass?: boolean; cabTop?: number } = {}): Model {
  const L = length / 2, w = width / 2, back = L - cabDepth, z1 = opts.cabTop ?? 2.9, waist = 1.6;
  const mat = opts.cab ?? "paint", glass: Mat = opts.glass === false ? "trim" : "glass";
  return {
    id, length, width, roof: { l0: L, l1: back, w, z: z1 },
    slabs: [
      { l0: L, l1: back, w, z0: 0.55, z1, inB: 0.03, inS: 0.02, mat },
      { l0: L + 0.015, l1: L - 0.2, w: w - 0.1, z0: waist, z1: z1 - 0.2, mat: glass, faces: { top: mat, back: mat } },
      ...[1, -1].map((s): Slab => ({ l0: L - 0.15, l1: back + 0.4, w: 0.02, wc: s * (w + 0.005), z0: waist, z1: z1 - 0.35, mat: glass })),
      { l0: L + 0.015, l1: L - 0.1, w: w - 0.3, z0: 0.85, z1: waist - 0.18, mat: "grille" },
      { l0: back, l1: -L + 0.15, w: w * 0.42, z0: 0.45, z1: 1.0, mat: "trim" },
      ...mirrors(L - 0.12, w, waist + 0.15),
      ...ends(L, -L, w, 0.95, { bumperZ: 0.55, lampW: 0.36 }),
      ...load,
    ],
    wheels: axles.map((l) => ({ l, w: w - 0.2, r: 0.52, width: 0.32 })),
  };
}

/** A flatbed lorry with pallets of bricks and a crate: a builders' merchant's. */
const flatbed = lorry("flatbed", 7.0, 2.4, 2.0, [
  { l0: 1.45, l1: -3.5, w: 1.2, z0: 1.0, z1: 1.18, mat: "bed" },
  { l0: 1.45, l1: 1.35, w: 1.15, z0: 1.18, z1: 2.4, mat: "trim" },
  { l0: 1.15, l1: 0.0, w: 0.55, z0: 1.18, z1: 1.32, mat: "load" },
  { l0: 1.1, l1: 0.05, w: 0.5, z0: 1.32, z1: 1.95, mat: "brick" },
  { l0: -0.25, l1: -1.45, w: 0.6, z0: 1.18, z1: 1.8, mat: "load" },
  { l0: -1.7, l1: -2.85, w: 0.55, z0: 1.18, z1: 1.32, mat: "load" },
  { l0: -1.75, l1: -2.8, w: 0.5, z0: 1.32, z1: 1.7, mat: "brick" },
], [2.4, -1.8]);

/** A box lorry: a white box behind a cab in the firm's colour, a stripe of it down the box. */
const boxLorry = lorry("boxLorry", 7.0, 2.45, 1.9, [
  { l0: 1.5, l1: -3.5, w: 1.22, z0: 1.0, z1: 3.5, mat: "liveryWhite" },
  ...[1, -1].map((s): Slab => ({ l0: 1.4, l1: -3.4, w: 0.006, wc: s * 1.226, z0: 2.35, z1: 2.75, mat: "paint" })),
  { l0: -3.5, l1: -3.52, w: 0.015, z0: 1.1, z1: 3.35, mat: "trim" },
], [2.45, -1.9]);

/** A tipper: a deep steel body, heaped with gravel, on two axles at the back. */
const tipper = lorry("tipper", 6.6, 2.4, 1.9, [
  { l0: 1.3, l1: -3.3, w: 1.18, z0: 1.05, z1: 2.25, inB: 0.15, mat: "paint", faces: { top: "gravel" } },
  { l0: 0.9, l1: -2.6, w: 1.0, z0: 2.25, z1: 2.6, inF: 0.6, inB: 0.6, inS: 0.5, mat: "gravel" },
  { l0: 1.55, l1: 1.3, w: 1.1, z0: 2.25, z1: 2.4, mat: "paint" },
], [2.25, -1.55, -2.65]);

/** The Machine's lorry: white, no windows anyone sits behind, a violet bar of light, dark crates. */
const machineLorry = lorry("machineLorry", 6.6, 2.4, 1.5, [
  { l0: 1.75, l1: -3.3, w: 1.2, z0: 1.0, z1: 1.16, mat: "bed" },
  { l0: 1.5, l1: -0.2, w: 1.0, z0: 1.16, z1: 2.3, mat: "aiLoad" },
  { l0: -0.4, l1: -2.1, w: 1.0, z0: 1.16, z1: 2.0, mat: "aiLoad" },
  { l0: -2.3, l1: -3.15, w: 0.9, z0: 1.16, z1: 1.7, mat: "aiLoad" },
  { l0: 3.05, l1: 2.9, w: 0.9, z0: 2.6, z1: 2.68, mat: "violet" },
], [2.3, -1.9], { glass: false, cabTop: 2.6 });

// ─── SERVICE: liveries, never tinted ─────────────────────────────────────────

/** A model in a livery: every painted face `mat`, which is baked in its colour rather than tinted. */
function livered(m: Model, id: string, mat: Mat, add: Slab[] = []): Model {
  const swap = (x: Mat | undefined) => (x === "paint" ? mat : x);
  return {
    ...m, id,
    slabs: [...m.slabs.map((s) => ({
      ...s, mat: swap(s.mat)!,
      faces: s.faces && { side: swap(s.faces.side), top: swap(s.faces.top), front: swap(s.faces.front), back: swap(s.faces.back) },
    })), ...add],
  };
}

/** Battenburg: two rows of squares, alternately `a` and `b`, down each side from `l0` back to `l1`. */
function battenburg(l0: number, l1: number, w: number, z0: number, z1: number, a: Mat, b: Mat): Slab[] {
  const h = (z1 - z0) / 2, n = Math.max(2, Math.round((l0 - l1) / h)), step = (l0 - l1) / n, out: Slab[] = [];
  for (const s of [1, -1]) for (let k = 0; k < n; k++) for (let r = 0; r < 2; r++) {
    out.push({ l0: l0 - k * step, l1: l0 - (k + 1) * step, w: 0.004, wc: s * (w + 0.004), z0: z0 + r * h, z1: z0 + (r + 1) * h, mat: (k + r) % 2 ? b : a });
  }
  return out;
}

/** A bar of blue lights across the front of a roof. */
const lightBar = (r: NonNullable<Model["roof"]>, at = 0.3): Slab[] => [
  { l0: r.l0 - at, l1: r.l0 - at - 0.24, w: Math.min(0.6, r.w - 0.1), z0: r.z, z1: r.z + 0.05, mat: "trim" },
  { l0: r.l0 - at - 0.02, l1: r.l0 - at - 0.22, w: Math.min(0.58, r.w - 0.12), z0: r.z + 0.05, z1: r.z + 0.14, mat: "light" },
];

/** A taxi: a people carrier in black, its sign lit on the roof. */
const taxi = livered(mpv, "taxi", "liveryBlack", [
  { l0: mpv.roof!.l0 - 0.35, l1: mpv.roof!.l0 - 0.75, w: 0.28, z0: mpv.roof!.z, z1: mpv.roof!.z + 0.17, inF: 0.04, inB: 0.04, mat: "sign" },
]);

/** A police estate: white, yellow and blue Battenburg down its sides, lights on the roof. */
const police = livered(estate, "police", "liveryWhite", [
  ...battenburg(2.15, -2.3, 0.915, 0.4, 0.82, "livery", "liveryAlt"),
  ...lightBar(estate.roof!),
]);

/** An ambulance: a Luton-bodied van in white, yellow and green Battenburg, lights on the cab and the box. */
const ambulance = livered(lutonVan, "ambulance", "liveryWhite", [
  ...battenburg(1.1, -3.1, 1.06, 0.75, 1.55, "livery", "liveryGreen"),
  ...lightBar({ l0: 1.75, l1: -3.15, w: 1.0, z: 3.2 }, 0.05),
]);

/** A postal van: the small van in red. */
const postalVan = livered(smallVan, "postalVan", "liveryRed");

/** A fire engine: a long crew cab and a locker body in red, a ladder on its roof, a reflective band. */
const fireEngine: Model = (() => {
  const base = lorry("fireEngine", 7.6, 2.5, 2.5, [
    { l0: 1.2, l1: -3.8, w: 1.25, z0: 0.75, z1: 2.9, mat: "paint" },
    ...[1, -1].flatMap((s): Slab[] => [
      { l0: 1.15, l1: -3.75, w: 0.004, wc: s * 1.254, z0: 0.95, z1: 1.12, mat: "livery" },
      { l0: 1.15, l1: -3.75, w: 0.004, wc: s * 1.254, z0: 1.3, z1: 2.75, mat: "trim" },
      ...[0.3, -1.0, -2.3].map((l): Slab => ({ l0: l + 0.6, l1: l - 0.6, w: 0.004, wc: s * 1.258, z0: 1.35, z1: 2.7, mat: "liveryRed" })),
      { l0: 2.0, l1: -3.7, w: 0.05, wc: s * 0.45, z0: 2.95, z1: 3.12, mat: "chrome" },
    ]),
    ...Array.from({ length: 12 }, (_, k): Slab => ({ l0: 1.9 - k * 0.48, l1: 1.86 - k * 0.48, w: 0.45, z0: 3.02, z1: 3.08, mat: "chrome" })),
    ...[1, -1].map((s): Slab => ({ l0: 2.1, l1: 1.95, w: 0.06, wc: s * 0.45, z0: 2.9, z1: 3.1, mat: "chrome" })),
  ], [2.6, -1.9], { cabTop: 2.9 });
  return livered(base, "fireEngine", "liveryRed", lightBar(base.roof!, 0.2));
})();

// ─── VARIANTS: the same car with something on its roof, or its roof another colour ──

/** Roof rails along each edge of the roof. */
const rails = (m: Model): Slab[] => {
  const r = m.roof!;
  return [1, -1].map((s) => ({ l0: r.l0 - 0.05, l1: r.l1 + 0.05, w: 0.035, wc: s * (r.w - 0.06), z0: r.z, z1: r.z + 0.08, mat: "trim" as Mat }));
};
/** A roof box on its rails: long, low and rounded. */
const roofBox = (m: Model): Slab => {
  const r = m.roof!, mid = (r.l0 + r.l1) / 2;
  return { l0: mid + 0.75, l1: mid - 0.85, w: Math.min(0.42, r.w - 0.15), z0: r.z + 0.08, z1: r.z + 0.42, inF: 0.3, inB: 0.12, inS: 0.06, mat: "roofBlack" };
};
const variant = (m: Model, tag: string, add: Slab[], roof?: Mat): Model => ({
  ...m, id: `${m.id}+${tag}`,
  slabs: [...m.slabs.map((s) => (roof && s.faces?.top === "paint" && s.z1 === m.roof?.z ? { ...s, faces: { ...s.faces, top: roof } } : s)), ...add],
});

const CARS = [cityCar, hatchback, hotHatch, saloon, estate, mpv, smallSuv, largeSuv, coupe, convertible];
const VARIANTS: Model[] = [
  variant(cityCar, "whiteRoof", [], "roofWhite"), variant(cityCar, "blackRoof", [], "roofBlack"),
  variant(hatchback, "rails", rails(hatchback)), variant(hatchback, "blackRoof", [], "roofBlack"),
  variant(estate, "rails", rails(estate)), variant(estate, "box", [...rails(estate), roofBox(estate)]),
  variant(mpv, "rails", rails(mpv)),
  variant(smallSuv, "rails", rails(smallSuv)), variant(smallSuv, "blackRoof", [], "roofBlack"),
  variant(largeSuv, "rails", rails(largeSuv)), variant(largeSuv, "box", [...rails(largeSuv), roofBox(largeSuv)]),
];

const WORK = [pickup, smallVan, panelVan, lutonVan, flatbed, boxLorry, tipper, machineLorry];
const SERVICE = [taxi, police, ambulance, postalVan, fireEngine];

export const MODELS: readonly Model[] = [...CARS, ...VARIANTS, ...WORK, ...SERVICE];
export const modelById = new Map(MODELS.map((m) => [m.id, m]));

/**
 * HOW OFTEN EACH CAR IS SEEN, as a town's would be: hatchbacks and small SUVs
 * most, the fun ones rarely. A variant takes a share of its model's.
 */
export const CAR_WEIGHTS: Readonly<Record<string, number>> = {
  cityCar: 6, "cityCar+whiteRoof": 2, "cityCar+blackRoof": 2,
  hatchback: 14, "hatchback+rails": 4, "hatchback+blackRoof": 3, hotHatch: 3,
  saloon: 12, estate: 6, "estate+rails": 3, "estate+box": 1.5,
  mpv: 4, "mpv+rails": 2,
  smallSuv: 10, "smallSuv+rails": 3, "smallSuv+blackRoof": 2,
  largeSuv: 5, "largeSuv+rails": 2, "largeSuv+box": 1,
  coupe: 3, convertible: 2,
  pickup: 3, smallVan: 3, taxi: 3, police: 0.8, postalVan: 1, ambulance: 0.4,
};
/** The removal vans the culture's moves hire, and the builders' lorries to the works. */
export const VAN_WEIGHTS: Readonly<Record<string, number>> = { lutonVan: 3, panelVan: 2, smallVan: 1 };
export const LORRY_WEIGHTS: Readonly<Record<string, number>> = { flatbed: 2, boxLorry: 1, tipper: 2 };
