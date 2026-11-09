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
  | "liveryWhite" | "liveryBlack" | "liveryRed" | "liveryGreen" | "load" | "brick" | "gravel" | "aiLoad" | "sign" | "violet"
  | "seam" | "arch" | "rim" | "spoke";

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
export type Wheel = { l: number; w: number; r: number; width: number; rim?: "spokes" | "steel" };

/**
 * One cross-section of a HULL, at `l` along the car: from `z0` up to `z1`,
 * `w` half wide at its foot, its sides leaning in by `inS` to the top, its top
 * corners rounded `r`. `crease` keeps the shading from smoothing across it.
 */
export type Section = { l: number; w: number; z0: number; z1: number; inS?: number; r?: number; crease?: boolean };

/**
 * A HULL: a curved body lofted through its sections, front to back, shaded
 * smooth. Each face is `side` or `top` by which way it faces, and either may
 * be chosen by where along the car it is: a cabin's glass and pillars.
 */
export type Hull = {
  sections: Section[]; wc?: number;
  side: Mat | ((l: number) => Mat); top: Mat | ((l: number) => Mat);
  front?: Mat; back?: Mat;
  /** Painted on over the faces, last on top: lamps, grilles, seams, windows. */
  decals?: Decal[];
  /** The cabin, whose roof a variant can paint another colour. */
  cabin?: boolean;
};

/**
 * A DECAL: a region of the model's space, metres (`l` along, `y` across with
 * left positive, `z` up), and the material any hull surface inside it takes.
 * Tested at every sample, so a lamp wraps round a corner and a seam is as
 * fine as a line.
 */
export type Decal = { mat: Mat; at: (l: number, y: number, z: number) => boolean };

/** A flat disc on each side at `w` out, centred `l` along and `z` up, radius `r`, from angle `a0` to `a1` (0 forward, π/2 up). */
export type Disc = { l: number; z: number; w: number; r: number; a0?: number; a1?: number; mat: Mat };

export type Model = {
  id: string;
  /** Where the roof is, for what goes on it: its front and back, half width and height. */
  roof?: { l0: number; l1: number; w: number; z: number };
  /** Length and width overall, metres: the game reads them for spacing and for the band. */
  length: number;
  width: number;
  slabs: Slab[];
  wheels: Wheel[];
  hulls?: Hull[];
  discs?: Disc[];
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

/** Door mirrors, either side at `l`. */
const mirrors = (l: number, w: number, z: number): Slab[] => [1, -1].map((s) => ({
  l0: l, l1: l - 0.12, w: 0.06, wc: s * (w + 0.06), z0: z, z1: z + 0.13, mat: "paint" as Mat,
}));

/** A line through points [l, z], front to back (l falling): its z at `l`, held level past either end. */
const lineAt = (pts: [number, number][], l: number): number => {
  if (l >= pts[0][0]) return pts[0][1];
  for (let k = 0; k + 1 < pts.length; k++) {
    const [la, za] = pts[k], [lb, zb] = pts[k + 1];
    if (l <= la && l >= lb) return la === lb ? zb : za + ((zb - za) * (la - l)) / (la - lb);
  }
  return pts[pts.length - 1][1];
};

/** A soft-cornered rectangle round (0, 0), `ry` by `rz` either way: a lamp's shape. */
const lens = (dy: number, dz: number, ry: number, rz: number) => (dy / ry) ** 4 + (dz / rz) ** 4 <= 1;

/**
 * A CAR, LOFTED. Its body is a hull through the top line `line`, rounded in
 * plan at nose and tail; its cabin a second hull through the screen, the roof
 * and the rear glass, leaning in. On them, as decals: windows in black seals,
 * pillars, shut lines, handles, arches, lamps that wrap the corners, grille,
 * intakes, plates.
 */
export type CarSpec = {
  length: number; width: number;
  /** The sill's height, and the body's top line front to back, [l, z]: the nose, the bonnet, the waist, the boot or tail. */
  sill: number;
  line: [number, number][];
  /** The screen's foot, the roof's front and back, the rear glass's foot; the roof's height; half width at the waist, and the lean in to the roof. */
  cabin?: { foot: number; front: number; back: number; tail: number; roof: number; w: number; inS: number; r?: number; crown?: number };
  /** Side windows, [front, back] along the car; door shut lines; a sliding door's track. */
  windows?: [number, number][];
  doors?: number[];
  axles: [number, number];
  tyre: { r: number; width: number; rim?: "spokes" | "steel" };
  lampZ: number; tailZ: number;
  grille?: "wide" | "slim";
  /** Black plastic round the arches and along the sills: an SUV's. */
  cladding?: boolean;
  slabs?: Slab[]; decals?: Decal[];
  /** More hulls: a van's box. One with no sections only adds its decals to the cabin. */
  hulls?: Hull[];
};

function car(id: string, c: CarSpec): Model {
  const L = c.length / 2, W = c.width / 2, z0 = c.sill, k = c.cabin;
  const end = c.line[c.line.length - 1][0];
  const fromEnd = (l: number) => Math.min(L - l, end > -L + 0.01 ? Infinity : l + L);
  const wAt = (l: number) => W - 0.17 * Math.max(0, 1 - fromEnd(l) / 0.38) ** 2;
  const z0At = (l: number) => z0 + 0.13 * Math.max(0, 1 - fromEnd(l) / 0.32) ** 2;
  const top = (l: number) => lineAt(c.line, l);
  const ls = [...new Set([...c.line.map(([l]) => l), L - 0.04, L - 0.12, L - 0.24, -L + 0.04, -L + 0.12, -L + 0.24])]
    .filter((l) => l <= L && l >= end).sort((a, b) => b - a);
  const tr = c.tyre.r, side = (y: number, inset = 0.1) => Math.abs(y) > W - inset;
  const tailZ = Math.min(c.tailZ + 0.05, top(end) - 0.19);

  const body: Decal[] = [
    // Wheel arches, cut dark round the tyres; a plastic lip round them on an SUV.
    ...c.axles.flatMap((a): Decal[] => [
      ...(c.cladding ? [{ mat: "trim" as Mat, at: (l: number, y: number, z: number) => side(y) && z > tr * 0.2 && (l - a) ** 2 + (z - tr) ** 2 <= (tr + 0.15) ** 2 }] : []),
      { mat: "arch", at: (l, y, z) => side(y, 0.14) && z > tr * 0.15 && (l - a) ** 2 + (z - tr) ** 2 <= (tr + 0.07) ** 2 },
    ]),
    ...(c.cladding ? [{ mat: "trim" as Mat, at: (_l: number, y: number, z: number) => side(y) && z < z0 + 0.16 }] : []),
    // Shut lines: the doors, and the bonnet's front edge.
    ...(c.doors ?? []).map((d): Decal => ({ mat: "seam", at: (l, y, z) => side(y) && Math.abs(l - d) < 0.012 && z > z0 + 0.08 && z < top(l) - 0.03 })),
    { mat: "seam", at: (l, _y, z) => Math.abs(l - (L - 0.34)) < 0.01 && z > top(l) - 0.05 },
    // A handle at the back of each door.
    ...(c.doors ?? []).slice(1).map((d): Decal => ({ mat: "trim", at: (l, y, z) => side(y) && l > d + 0.07 && l < d + 0.21 && Math.abs(z - (top(l) - 0.14)) < 0.025 })),
    // THE FRONT: an intake low down, with fog lamps; the grille between the headlamps; the plate.
    { mat: "grille", at: (l, y, z) => l > L - 0.2 && Math.abs(y) < W - 0.32 && z > z0 + 0.17 && z < z0 + 0.3 },
    ...[1, -1].map((s): Decal => ({ mat: "lamp", at: (l, y, z) => l > L - 0.25 && lens(y - s * (W - 0.24), z - (z0 + 0.235), 0.06, 0.03) })),
    ...(c.grille === "slim"
      ? [{ mat: "grille" as Mat, at: (l: number, y: number, z: number) => l > L - 0.25 && Math.abs(y) < W - 0.38 && z > c.lampZ + 0.02 && z < c.lampZ + 0.08 }]
      : [{ mat: "chrome" as Mat, at: (l: number, y: number, z: number) => l > L - 0.25 && Math.abs(y) < W - 0.36 && z > c.lampZ - 0.11 && z < c.lampZ + 0.1 },
         { mat: "grille" as Mat, at: (l: number, y: number, z: number) => l > L - 0.25 && Math.abs(y) < W - 0.39 && z > c.lampZ - 0.085 && z < c.lampZ + 0.075 }]),
    // Headlamps in dark housings, wrapping round the corners, a bright projector in each and an indicator outboard.
    ...[1, -1].flatMap((s): Decal[] => [
      { mat: "trim", at: (l, y, z) => l > L - 0.3 && lens(y - s * (W - 0.2), z - (c.lampZ + 0.05), 0.19, 0.08) },
      { mat: "lamp", at: (l, y, z) => l > L - 0.3 && lens(y - s * (W - 0.21), z - (c.lampZ + 0.05), 0.16, 0.06) },
      { mat: "chrome", at: (l, y, z) => l > L - 0.5 && (y - s * (W - 0.27)) ** 2 + (z - (c.lampZ + 0.05)) ** 2 < 0.035 ** 2 },
      // Just round the corner: any further back and it runs into the arch.
      { mat: "indicator", at: (l, y, z) => l > L - 0.2 && lens(y - s * (W - 0.05), z - (c.lampZ + 0.05), 0.045, 0.05) },
    ]),
    { mat: "plate", at: (l, y, z) => l > L - 0.15 && Math.abs(y) < 0.25 && z > z0 + 0.31 && z < z0 + 0.42 },
    // THE BACK: a dark diffuser, tail lamps round the corners with a reversing lamp, the plate, an exhaust.
    // The lamps sit on the flat of the tail, under the shoulder: across it they'd fold onto the top.
    { mat: "trim", at: (l, y, z) => l < -L + 0.15 && Math.abs(y) < W - 0.12 && z < z0 + 0.2 },
    ...[1, -1].flatMap((s): Decal[] => [
      { mat: "tail", at: (l, y, z) => l < -L + 0.3 && lens(y - s * (W - 0.19), z - tailZ, 0.165, 0.07) },
      { mat: "lamp", at: (l, y, z) => l < -L + 0.3 && lens(y - s * (W - 0.3), z - (tailZ - 0.02), 0.04, 0.03) },
    ]),
    { mat: "rearPlate", at: (l, y, z) => l < -L + 0.15 && Math.abs(y) < 0.25 && z > tailZ - 0.25 && z < tailZ - 0.13 },
    { mat: "chrome", at: (l, y, z) => l < -L + 0.12 && (y + (W - 0.32)) ** 2 / 0.05 ** 2 + (z - (z0 + 0.12)) ** 2 / 0.035 ** 2 < 1 },
    ...(c.decals ?? []),
  ];
  const hulls: Hull[] = [{
    sections: ls.map((l): Section => ({ l, w: wAt(l), z0: z0At(l), z1: top(l), inS: 0.05, r: 0.1 })),
    side: "paint", top: "paint", decals: body,
  }];

  let roof: Model["roof"];
  if (k) {
    const wz = (l: number) => top(l);
    const crown = k.crown ?? 0.025;
    const roofLine: [number, number][] = [
      [k.foot, wz(k.foot) + 0.02],
      [(k.foot + k.front) / 2, wz(k.foot) + (k.roof - wz(k.foot)) * 0.6],
      [k.front, k.roof - 0.01],
      [(k.front + k.back) / 2, k.roof + crown],
      [k.back, k.roof - 0.01],
      [(k.back + k.tail) / 2, wz(k.tail) + (k.roof - wz(k.tail)) * 0.56],
      [k.tail, wz(k.tail) + 0.02],
    ];
    const roofAt = (l: number) => lineAt(roofLine, l);
    const base = Math.min(...roofLine.map(([l]) => wz(l))) - 0.08;
    const edge = k.w - k.inS, onSide = (y: number) => Math.abs(y) > edge - 0.035;
    const cabin: Decal[] = [
      // Pillars beside the screen and the rear glass.
      { mat: "paint", at: (l, y) => (l > k.front || l < k.back) && Math.abs(y) > edge - 0.09 },
      ...(c.doors ?? []).map((d): Decal => ({ mat: "seam", at: (l, y, z) => onSide(y) && Math.abs(l - d) < 0.012 && z < roofAt(l) - 0.06 })),
      // The side windows, in black seals, their tops following the roof.
      ...(c.windows ?? []).flatMap(([f, b]): Decal[] => [
        { mat: "trim", at: (l, y, z) => onSide(y) && l <= f + 0.025 && l >= b - 0.025 && z >= wz(l) + 0.02 && z <= roofAt(l) - 0.05 },
        { mat: "glass", at: (l, y, z) => onSide(y) && l <= f && l >= b && z >= wz(l) + 0.045 && z <= roofAt(l) - 0.075 },
      ]),
      // A dark band down each side of the screen.
      { mat: "trim", at: (l, y) => l > k.front && l < k.foot - 0.05 && Math.abs(y) > edge - 0.13 && Math.abs(y) <= edge - 0.09 },
    ];
    hulls.push({
      cabin: true,
      sections: roofLine.map(([l, z]): Section => ({ l, w: k.w, z0: base, z1: z, inS: k.inS, r: k.r ?? 0.16 })),
      side: "paint", top: (l) => (l <= k.front + 0.02 && l >= k.back - 0.02 ? "paint" : "glass"),
      decals: cabin,
    });
    roof = { l0: k.front, l1: k.back, w: edge, z: k.roof + crown };
  }
  for (const h of c.hulls ?? []) {
    if (h.sections.length) hulls.push(h);
    else hulls[hulls.length - 1] = { ...hulls[hulls.length - 1], decals: [...(hulls[hulls.length - 1].decals ?? []), ...(h.decals ?? [])] };
  }
  return {
    id, length: c.length, width: c.width, roof, hulls,
    slabs: [...(k ? mirrors(k.foot - 0.1, k.w - 0.02, top(k.foot) + 0.03) : []), ...(c.slabs ?? [])],
    wheels: c.axles.map((l) => ({ l, w: W - c.tyre.width / 2 - 0.01, r: tr, width: c.tyre.width, rim: c.tyre.rim })),
  };
}

// ─── THE MODELS ──────────────────────────────────────────────────────────────

/** A city car: short, tall for its length, a hatch straight down, three doors. */
const cityCar = car("cityCar", {
  length: 3.55, width: 1.64, sill: 0.22,
  line: [[1.775, 0.55], [1.62, 0.72], [1.2, 0.82], [0.78, 0.86], [-1.5, 0.92], [-1.775, 0.88]],
  cabin: { foot: 0.8, front: 0.12, back: -1.48, tail: -1.74, roof: 1.5, w: 0.76, inS: 0.12 },
  windows: [[0.6, -0.5], [-0.6, -1.42]], doors: [0.72, -0.55],
  axles: [1.15, -1.15], tyre: { r: 0.29, width: 0.18, rim: "steel" }, lampZ: 0.6, tailZ: 0.72, grille: "slim",
});

/** A five-door hatchback: a short bonnet, a cabin running nearly to the tail, an upright hatch. */
const hatchback = car("hatchback", {
  length: 4.0, width: 1.76, sill: 0.22,
  line: [[2.0, 0.56], [1.85, 0.74], [1.4, 0.84], [0.95, 0.88], [-1.75, 0.94], [-2.0, 0.9]],
  cabin: { foot: 0.98, front: 0.16, back: -1.6, tail: -1.94, roof: 1.46, w: 0.82, inS: 0.13 },
  windows: [[0.8, -0.38], [-0.5, -1.3], [-1.38, -1.66]], doors: [0.9, -0.43, -1.4],
  axles: [1.3, -1.28], tyre: { r: 0.31, width: 0.2 }, lampZ: 0.62, tailZ: 0.74,
});

/** A hot hatch: the hatchback lower, three doors, bigger wheels, a spoiler over the hatch. */
const hotHatch = car("hotHatch", {
  length: 4.05, width: 1.8, sill: 0.18,
  line: [[2.025, 0.5], [1.88, 0.68], [1.4, 0.78], [0.92, 0.82], [-1.75, 0.88], [-2.025, 0.84]],
  cabin: { foot: 0.92, front: 0.12, back: -1.6, tail: -1.94, roof: 1.36, w: 0.83, inS: 0.15 },
  windows: [[0.75, -0.55], [-0.64, -1.45]], doors: [0.85, -0.6],
  axles: [1.32, -1.28], tyre: { r: 0.33, width: 0.22 }, lampZ: 0.56, tailZ: 0.7,
  slabs: [{ l0: -1.5, l1: -1.8, w: 0.74, z0: 1.32, z1: 1.4, inB: 0.06, mat: "paint" }],
  decals: [{ mat: "chrome", at: (l, y, z) => l < -1.9 && (y - 0.5) ** 2 / 0.05 ** 2 + (z - 0.3) ** 2 / 0.035 ** 2 < 1 }],
});

/** A saloon: a long bonnet, a cabin in the middle, a boot of its own. */
const saloon = car("saloon", {
  length: 4.65, width: 1.8, sill: 0.22,
  line: [[2.325, 0.58], [2.18, 0.74], [1.6, 0.83], [0.92, 0.88], [-1.35, 0.93], [-1.6, 0.96], [-2.15, 0.95], [-2.325, 0.86]],
  cabin: { foot: 0.92, front: 0.1, back: -0.92, tail: -1.5, roof: 1.43, w: 0.84, inS: 0.14, crown: 0.03 },
  windows: [[0.76, -0.22], [-0.34, -1.2]], doors: [0.88, -0.28, -1.28],
  axles: [1.45, -1.45], tyre: { r: 0.32, width: 0.2 }, lampZ: 0.6, tailZ: 0.76,
  decals: [{ mat: "seam", at: (l, _y, z) => Math.abs(l + 1.56) < 0.01 && z > 0.9 }],
});

/** A stretch limousine: a saloon drawn out to two lengths, a long run of dark windows between the doors. */
const limo = car("limo", {
  length: 6.6, width: 1.86, sill: 0.2,
  line: [[3.3, 0.58], [3.15, 0.74], [2.55, 0.84], [1.85, 0.88], [-2.35, 0.93], [-2.6, 0.96], [-3.12, 0.95], [-3.3, 0.86]],
  cabin: { foot: 1.85, front: 1.05, back: -1.95, tail: -2.5, roof: 1.42, w: 0.86, inS: 0.14, crown: 0.02 },
  windows: [[1.7, 0.75], [0.62, -0.5], [-0.62, -1.75], [-1.86, -2.2]], doors: [1.82, 0.7, -1.8, -2.3],
  axles: [2.4, -2.35], tyre: { r: 0.33, width: 0.21 }, lampZ: 0.6, tailZ: 0.76,
  decals: [
    { mat: "seam", at: (l, _y, z) => Math.abs(l + 2.66) < 0.01 && z > 0.9 },
    // A bright strip along the waist, under the windows.
    { mat: "chrome", at: (l, y, z) => Math.abs(y) > 0.86 && l < 2.5 && l > -2.9 && z > 0.84 && z < 0.865 },
  ],
});

/** An estate: the saloon's front, its roof carried back to an upright tail. */
const estate = car("estate", {
  length: 4.8, width: 1.82, sill: 0.22,
  line: [[2.4, 0.58], [2.25, 0.75], [1.7, 0.84], [0.95, 0.89], [-2.1, 0.95], [-2.4, 0.92]],
  cabin: { foot: 0.95, front: 0.1, back: -2.08, tail: -2.36, roof: 1.47, w: 0.85, inS: 0.13 },
  windows: [[0.78, -0.22], [-0.34, -1.36], [-1.48, -2.04]], doors: [0.9, -0.28, -1.42],
  axles: [1.5, -1.5], tyre: { r: 0.32, width: 0.2 }, lampZ: 0.62, tailZ: 0.78,
});

/** A people carrier: a steep screen running into the bonnet, tall, three rows of windows, a sliding door. */
const mpv = car("mpv", {
  length: 4.6, width: 1.84, sill: 0.25,
  line: [[2.3, 0.62], [2.15, 0.8], [1.75, 0.9], [1.4, 0.94], [-2.05, 1.0], [-2.3, 0.98]],
  cabin: { foot: 1.42, front: 0.3, back: -2.0, tail: -2.26, roof: 1.76, w: 0.87, inS: 0.11 },
  windows: [[1.2, 0.12], [0.0, -1.15], [-1.28, -1.94]], doors: [1.3, 0.05, -1.22],
  axles: [1.45, -1.45], tyre: { r: 0.32, width: 0.2 }, lampZ: 0.72, tailZ: 0.86,
  decals: [{ mat: "seam", at: (l, y, z) => Math.abs(y) > 0.82 && l < 0.0 && l > -1.3 && Math.abs(z - 1.02) < 0.01 }],
});

/** A small SUV: a hatchback stood up on bigger wheels, black cladding round its feet. */
const smallSuv = car("smallSuv", {
  length: 4.3, width: 1.82, sill: 0.34,
  line: [[2.15, 0.68], [2.0, 0.88], [1.5, 0.98], [0.85, 1.02], [-1.85, 1.06], [-2.15, 1.02]],
  cabin: { foot: 0.88, front: 0.08, back: -1.7, tail: -2.05, roof: 1.64, w: 0.85, inS: 0.13 },
  windows: [[0.7, -0.42], [-0.52, -1.36], [-1.44, -1.76]], doors: [0.82, -0.46, -1.42],
  axles: [1.35, -1.35], tyre: { r: 0.36, width: 0.22 }, lampZ: 0.8, tailZ: 0.92, cladding: true,
});

/** A large SUV: square, tall and long, three windows a side. */
const largeSuv = car("largeSuv", {
  length: 4.95, width: 1.96, sill: 0.4,
  line: [[2.475, 0.78], [2.32, 0.98], [1.8, 1.08], [1.0, 1.12], [-2.2, 1.16], [-2.475, 1.12]],
  cabin: { foot: 1.0, front: 0.22, back: -2.24, tail: -2.42, roof: 1.86, w: 0.93, inS: 0.12, r: 0.12 },
  windows: [[0.85, -0.15], [-0.28, -1.42], [-1.55, -2.18]], doors: [0.95, -0.22, -1.5],
  axles: [1.6, -1.55], tyre: { r: 0.4, width: 0.26 }, lampZ: 0.88, tailZ: 1.0, cladding: true,
});

/** A coupé: low and long-bonneted, two doors, its roof falling all the way to the tail. */
const coupe = car("coupe", {
  length: 4.5, width: 1.84, sill: 0.18,
  line: [[2.25, 0.48], [2.1, 0.62], [1.5, 0.72], [0.6, 0.76], [-1.5, 0.82], [-2.0, 0.84], [-2.25, 0.76]],
  cabin: { foot: 0.6, front: -0.15, back: -0.72, tail: -1.78, roof: 1.28, w: 0.84, inS: 0.17, r: 0.18 },
  windows: [[0.45, -1.15]], doors: [0.55, -0.78],
  axles: [1.42, -1.38], tyre: { r: 0.33, width: 0.22 }, lampZ: 0.52, tailZ: 0.66, grille: "slim",
});

/** A convertible, roof down: a screen in its frame, two seats in a dark cockpit, a deck behind. */
const convertible = car("convertible", {
  length: 4.2, width: 1.78, sill: 0.18,
  line: [[2.1, 0.5], [1.95, 0.66], [1.3, 0.76], [0.5, 0.78], [-1.0, 0.8], [-1.8, 0.82], [-2.1, 0.74]],
  doors: [0.42, -0.95],
  axles: [1.35, -1.3], tyre: { r: 0.33, width: 0.21 }, lampZ: 0.52, tailZ: 0.62,
  decals: [{ mat: "interior", at: (l, y, z) => l < 0.48 && l > -0.98 && Math.abs(y) < 0.76 && z > 0.72 }],
  slabs: [
    { l0: 0.55, l1: 0.42, w: 0.82, z0: 0.76, z1: 1.18, inF: 0.28, inS: 0.06, mat: "glass", faces: { top: "trim" } },
    ...[1, -1].map((s): Slab => ({ l0: 0.55, l1: 0.42, w: 0.03, wc: s * 0.8, z0: 0.76, z1: 1.18, inF: 0.28, mat: "trim" })),
    ...[1, -1].map((s): Slab => ({ l0: -0.45, l1: -0.62, w: 0.24, wc: s * 0.4, z0: 0.6, z1: 1.18, inF: 0.06, mat: "seat" })),
    ...[1, -1].map((s): Slab => ({ l0: -0.72, l1: -0.86, w: 0.2, wc: s * 0.4, z0: 0.8, z1: 1.22, inB: 0.06, mat: "paint" })),
    ...mirrors(0.4, 0.86, 0.78),
  ],
});

// ─── WORK ────────────────────────────────────────────────────────────────────

/** A pickup: a crew cab, and an open bed behind it with a load of odds and ends. */
const pickup = car("pickup", {
  length: 5.3, width: 1.88, sill: 0.34,
  line: [[2.65, 0.68], [2.5, 0.88], [2.0, 0.98], [1.0, 1.02], [-0.8, 1.04]],
  cabin: { foot: 1.0, front: 0.28, back: -0.6, tail: -0.76, roof: 1.82, w: 0.88, inS: 0.12, r: 0.12 },
  windows: [[0.85, -0.02], [-0.1, -0.62]], doors: [0.92, -0.06, -0.72],
  axles: [1.65, -1.6], tyre: { r: 0.39, width: 0.25, rim: "steel" }, lampZ: 0.82, tailZ: 0.82,
  slabs: [
    { l0: -0.8, l1: -2.65, w: 0.94, z0: 0.34, z1: 0.7, mat: "paint", faces: { top: "bed" } },
    ...[1, -1].map((s): Slab => ({ l0: -0.8, l1: -2.65, w: 0.06, wc: s * 0.88, z0: 0.7, z1: 1.04, mat: "paint" })),
    { l0: -2.55, l1: -2.65, w: 0.94, z0: 0.7, z1: 1.04, mat: "paint" },
    ...[1, -1].map((s): Slab => ({ l0: -2.64, l1: -2.67, w: 0.06, wc: s * 0.86, z0: 0.72, z1: 1.0, mat: "tail" })),
    { l0: -2.62, l1: -2.75, w: 0.95, z0: 0.36, z1: 0.56, mat: "chrome" },
    { l0: -2.67, l1: -2.69, w: 0.26, z0: 0.6, z1: 0.72, mat: "rearPlate" },
    ...[1, -1].map((s): Slab => ({ l0: -1.25, l1: -1.95, w: 0.02, wc: s * 0.95, z0: 0.72, z1: 0.9, mat: "arch" })),
    { l0: -0.88, l1: -1.1, w: 0.82, z0: 0.7, z1: 1.0, mat: "trim" },
    { l0: -1.25, l1: -1.85, w: 0.3, wc: 0.38, z0: 0.7, z1: 1.18, mat: "load" },
    { l0: -1.95, l1: -2.45, w: 0.24, wc: -0.4, z0: 0.7, z1: 0.98, mat: "load" },
  ],
});

/** A small van: a car's front, a tall body behind it, windows only in the front doors, a sliding door. */
const smallVan = car("smallVan", {
  length: 4.55, width: 1.84, sill: 0.27,
  line: [[2.275, 0.6], [2.12, 0.8], [1.55, 0.94], [1.1, 0.98], [-2.0, 1.0], [-2.275, 0.98]],
  cabin: { foot: 1.1, front: 0.3, back: -2.12, tail: -2.24, roof: 1.88, w: 0.88, inS: 0.05, r: 0.12 },
  windows: [[0.95, 0.05]], doors: [1.02, 0.0, -1.05],
  axles: [1.45, -1.4], tyre: { r: 0.32, width: 0.2, rim: "steel" }, lampZ: 0.76, tailZ: 0.92,
  decals: [{ mat: "seam", at: (l, _y, z) => l < -2.2 && Math.abs(_y) < 0.012 && z > 0.4 }],
});

/** A panel van: a short nose, a tall body behind it, glass only in the cab, a sliding door. */
const panelVan = car("panelVan", {
  length: 5.2, width: 2.0, sill: 0.3,
  line: [[2.6, 0.65], [2.45, 0.86], [1.95, 1.02], [1.6, 1.08], [-2.3, 1.12], [-2.6, 1.1]],
  cabin: { foot: 1.62, front: 0.92, back: -2.5, tail: -2.58, roof: 2.45, w: 0.97, inS: 0.04, r: 0.14 },
  windows: [[1.4, 0.55]], doors: [1.52, 0.5, -0.75],
  axles: [1.7, -1.75], tyre: { r: 0.34, width: 0.22, rim: "steel" }, lampZ: 0.84, tailZ: 1.05,
  decals: [{ mat: "seam", at: (l, y, z) => Math.abs(y) > 0.95 && l < 0.5 && l > -0.75 && Math.abs(z - 1.2) < 0.01 }],
  hulls: [{ sections: [], side: "paint", top: "paint", decals: [
    { mat: "seam", at: (l, y, z) => l < -2.55 && Math.abs(y) < 0.012 && z > 0.5 && z < 2.3 },
  ] }],
});

/** A Luton van: a van's cab, and a tall box over its roof and back to the tail. A removal firm's. */
const LUTON_BOX: Section[] = [
  { l: 1.15, w: 1.06, z0: 0.62, z1: 3.2, r: 0.08 }, { l: -3.15, w: 1.06, z0: 0.62, z1: 3.2, r: 0.08 },
];
const lutonVan = car("lutonVan", {
  length: 6.3, width: 2.12, sill: 0.3,
  line: [[3.15, 0.66], [3.0, 0.86], [2.5, 1.04], [2.2, 1.1], [1.1, 1.12]],
  cabin: { foot: 2.2, front: 1.55, back: 1.2, tail: 1.12, roof: 2.22, w: 0.98, inS: 0.05, r: 0.12 },
  windows: [[2.0, 1.3]], doors: [2.1, 1.18],
  axles: [2.1, -1.95], tyre: { r: 0.36, width: 0.24, rim: "steel" }, lampZ: 0.86, tailZ: 0.8,
  hulls: [
    { sections: [{ l: 1.75, w: 1.06, z0: 2.24, z1: 3.2, r: 0.08 }, { l: 1.15, w: 1.06, z0: 2.24, z1: 3.2, r: 0.08 }], side: "paint", top: "paint" },
    { sections: LUTON_BOX, side: "paint", top: "paint", decals: [
      // The roller door at the back, its slats; tail lamps low on the box, the plate between.
      { mat: "seam", at: (l, y, z) => l < -3.1 && Math.abs(y) < 0.95 && z > 0.75 && z < 3.05 && (Math.abs(y) > 0.94 || z > 3.04 || z % 0.22 < 0.012) },
      ...[1, -1].map((s): Decal => ({ mat: "tail", at: (l, y, z) => l < -3.1 && lens(y - s * 0.9, z - 0.82, 0.1, 0.09) })),
      { mat: "rearPlate", at: (l, y, z) => l < -3.1 && Math.abs(y) < 0.26 && z > 0.66 && z < 0.78 },
      // A rubbing strip down each side.
      { mat: "trim", at: (_l, y, z) => Math.abs(y) > 1.0 && z > 0.92 && z < 1.0 },
    ] },
  ],
  slabs: [{ l0: -3.1, l1: -3.25, w: 1.0, z0: 0.42, z1: 0.6, mat: "trim" }],
});

/**
 * A LORRY: a flat-fronted cab over the front axle, its corners rounded, on a
 * chassis that carries whatever it carries. Glass, grille, lamps, a step, a
 * sun visor, mudguards, a fuel tank and side guards. `glass: false` blanks the
 * windows, for the Machine's.
 */
function lorry(id: string, length: number, width: number, cabDepth: number, load: Slab[], axles: number[],
  opts: { cab?: Mat; glass?: boolean; cabTop?: number; hulls?: Hull[] } = {}): Model {
  const L = length / 2, w = width / 2, back = L - cabDepth, z1 = opts.cabTop ?? 2.9, waist = 1.6;
  const mat = opts.cab ?? "paint", glass: Mat = opts.glass === false ? "trim" : "glass";
  const front = (l: number) => l > L - 0.12, onSide = (y: number) => Math.abs(y) > w - 0.06;
  const cab: Hull = {
    sections: [
      { l: L, w: w - 0.1, z0: 0.62, z1: z1 - 0.08, inS: 0.06, r: 0.22 },
      { l: L - 0.07, w: w - 0.015, z0: 0.56, z1: z1 - 0.01, inS: 0.06, r: 0.24 },
      { l: L - 0.16, w, z0: 0.55, z1, inS: 0.06, r: 0.24 },
      { l: back, w, z0: 0.55, z1, inS: 0.06, r: 0.24 },
    ],
    side: mat, top: mat,
    decals: [
      // The screen, in a black seal; a door window each side and the door's shut lines and handle.
      { mat: "trim", at: (l, y, z) => front(l) && Math.abs(y) < w - 0.1 && z > waist - 0.04 && z < z1 - 0.2 },
      { mat: glass, at: (l, y, z) => front(l) && Math.abs(y) < w - 0.14 && z > waist && z < z1 - 0.24 },
      { mat: "trim", at: (l, y, z) => onSide(y) && l < L - 0.2 && l > back + 0.42 && z > waist - 0.04 && z < z1 - 0.33 },
      { mat: glass, at: (l, y, z) => onSide(y) && l < L - 0.24 && l > back + 0.46 && z > waist && z < z1 - 0.37 },
      { mat: "seam", at: (l, y, z) => onSide(y) && (Math.abs(l - (L - 0.18)) < 0.012 || Math.abs(l - (back + 0.36)) < 0.012) && z > 0.7 && z < z1 - 0.15 },
      { mat: "trim", at: (l, y, z) => onSide(y) && l < back + 0.62 && l > back + 0.46 && Math.abs(z - (waist - 0.15)) < 0.025 },
      // The grille: dark, with bright bars across; a badge-less panel over it.
      { mat: "grille", at: (l, y, z) => front(l) && Math.abs(y) < w - 0.32 && z > 0.92 && z < waist - 0.16 },
      { mat: "chrome", at: (l, y, z) => front(l) && Math.abs(y) < w - 0.34 && z > 0.95 && z < waist - 0.19 && (z - 0.95) % 0.1 < 0.025 },
      // Headlamps low at the corners, an indicator beside each.
      ...[1, -1].flatMap((s): Decal[] => [
        { mat: "trim", at: (l, y, z) => l > L - 0.4 && lens(y - s * (w - 0.24), z - 0.82, 0.2, 0.1) },
        { mat: "lamp", at: (l, y, z) => l > L - 0.4 && lens(y - s * (w - 0.25), z - 0.82, 0.17, 0.075) },
        { mat: "indicator", at: (l, y, z) => l > L - 0.5 && lens(y - s * (w - 0.03), z - 0.82, 0.04, 0.07) },
      ]),
    ],
  };
  const r = 0.52, bw = w - 0.2;
  return {
    id, length, width, roof: { l0: L, l1: back, w, z: z1 },
    hulls: [cab, ...(opts.hulls ?? [])],
    slabs: [
      // The bumper, a plate on it, a step under each door, a visor over the screen.
      { l0: L + 0.04, l1: L - 0.12, w: w + 0.005, z0: 0.42, z1: 0.66, mat: "trim" },
      { l0: L + 0.05, l1: L + 0.04, w: 0.26, z0: 0.48, z1: 0.6, mat: "plate" },
      ...[1, -1].map((s): Slab => ({ l0: back + 0.4, l1: back + 0.05, w: 0.08, wc: s * (w - 0.04), z0: 0.45, z1: 0.55, mat: "trim" })),
      { l0: L + 0.12, l1: L - 0.1, w: w - 0.05, z0: z1 - 0.12, z1: z1 - 0.06, inF: 0.08, mat },
      ...mirrors(L - 0.1, w + 0.08, waist + 0.15).map((m) => ({ ...m, z1: m.z1 + 0.3, mat: "trim" as Mat })),
      // The chassis, a fuel tank on one side, and rails guarding the gap between the wheels.
      { l0: back, l1: -L + 0.15, w: w * 0.42, z0: 0.45, z1: 1.0, mat: "trim" },
      { l0: axles[0] - r - 0.25, l1: axles[0] - r - 1.1, w: 0.22, wc: w - 0.38, z0: 0.48, z1: 0.92, inS: 0.06, mat: "chrome" },
      ...[1, -1].flatMap((s): Slab[] => [0.58, 0.82].map((z) => ({
        l0: axles[1] + r + 0.15, l1: axles[0] - r - 1.2 > axles[1] + r + 0.15 ? axles[0] - r - 1.2 : axles[1] + r + 0.15, w: 0.012, wc: s * (w - 0.02), z0: z, z1: z + 0.06, mat: "trim" as Mat,
      })).filter((x) => x.l0 > x.l1 || s === -1)),
      // Mudguards over the rear wheels.
      ...axles.slice(1).flatMap((a) => [1, -1].map((s): Slab => ({ l0: a + r + 0.08, l1: a - r - 0.08, w: 0.17, wc: s * bw, z0: 2 * r + 0.06, z1: 2 * r + 0.1, mat: "trim" }))),
      // Tail lamps and a plate on a bar across the back.
      { l0: -L + 0.12, l1: -L - 0.02, w: w - 0.05, z0: 0.5, z1: 0.66, mat: "trim" },
      ...[1, -1].map((s): Slab => ({ l0: -L - 0.02, l1: -L - 0.04, w: 0.16, wc: s * (w - 0.24), z0: 0.52, z1: 0.64, mat: "tail" })),
      { l0: -L - 0.02, l1: -L - 0.04, w: 0.26, z0: 0.68, z1: 0.8, mat: "rearPlate" },
      ...load,
    ],
    wheels: axles.map((l, i) => ({ l, w: w - 0.2, r, width: 0.32, rim: i ? "steel" : "spokes" })),
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

/** A model with every material passed through `to`: slabs, faces, hulls and their decals. */
function recolour(m: Model, id: string, to: (x: Mat) => Mat, add: Slab[] = [], decals: Decal[] = []): Model {
  const sw = (x: Mat | undefined) => (x === undefined ? x : to(x));
  const swf = (x: Mat | ((l: number) => Mat)) => (typeof x === "function" ? (l: number) => to(x(l)) : to(x));
  return {
    ...m, id,
    slabs: [...m.slabs.map((s) => ({
      ...s, mat: to(s.mat),
      faces: s.faces && { side: sw(s.faces.side), top: sw(s.faces.top), front: sw(s.faces.front), back: sw(s.faces.back) },
    })), ...add],
    hulls: m.hulls?.map((h) => ({
      ...h, side: swf(h.side), top: swf(h.top), front: sw(h.front), back: sw(h.back),
      decals: [...(h.decals ?? []).map((d) => ({ ...d, mat: to(d.mat) })), ...decals],
    })),
  };
}

/** A model in a livery: every painted face `mat`, which is baked in its colour rather than tinted. */
const livered = (m: Model, id: string, mat: Mat, add: Slab[] = [], decals: Decal[] = []): Model =>
  recolour(m, id, (x) => (x === "paint" ? mat : x), add, decals);

/** Battenburg as decals on a hull's sides: two rows of squares, `a` and `b`, from `l0` back to `l1`. */
function battenburgDecals(l0: number, l1: number, w: number, z0: number, z1: number, a: Mat, b: Mat): Decal[] {
  const h = (z1 - z0) / 2, n = Math.max(2, Math.round((l0 - l1) / h)), step = (l0 - l1) / n;
  const band = (l: number, y: number, z: number) => Math.abs(y) > w - 0.14 && l <= l0 && l >= l1 && z >= z0 && z <= z1;
  return [
    { mat: a, at: band },
    { mat: b, at: (l, y, z) => band(l, y, z) && (Math.floor((l0 - l) / step) + Math.floor((z - z0) / h)) % 2 === 1 },
  ];
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
const police = livered(estate, "police", "liveryWhite", lightBar(estate.roof!),
  battenburgDecals(2.15, -2.25, 0.91, 0.36, 0.8, "livery", "liveryAlt"));

/** An ambulance: a Luton-bodied van in white, yellow and green Battenburg, lights on the cab and the box. */
const ambulance = livered(lutonVan, "ambulance", "liveryWhite",
  lightBar({ l0: 1.75, l1: -3.15, w: 1.0, z: 3.2 }, 0.05),
  battenburgDecals(1.1, -3.1, 1.06, 0.75, 1.55, "livery", "liveryGreen"));

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
  slabs: [...m.slabs, ...add],
  // The cabin's roof another colour: the roof itself, not the pillars.
  hulls: m.hulls?.map((h) => {
    if (!roof || !h.cabin) return h;
    const was = h.top;
    return { ...h, top: (l: number) => { const x = typeof was === "function" ? was(l) : was; return x === "paint" ? roof : x; } };
  }),
});

const CARS = [cityCar, hatchback, hotHatch, saloon, estate, mpv, smallSuv, largeSuv, coupe, convertible];
const SPECIAL = [limo];
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

export const MODELS: readonly Model[] = [...CARS, ...VARIANTS, ...WORK, ...SERVICE, ...SPECIAL];
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
