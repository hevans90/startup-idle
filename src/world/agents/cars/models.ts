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
  | "seam" | "arch" | "rim" | "spoke"
  | "skin" | "top" | "bottom" | "hair" | "shoe" | "bag" | "hivis" | "hardhat"
  | "leaf" | "canvas" | "bark" | "birchBark" | "wood" | "iron" | "stone" | "water" | "linen" | "spray"
  | "wall" | "rooftile" | "slate" | "roofing" | "pane" | "hedge" | "pave"
  // A bridge's: dressed stone in three tones, its mortar and its lighter dressings; concrete and its joints; painted
  // steel, two colours, each with its shade; timber, three; a stay's cable; a pylon's white.
  | "stoneA" | "stoneB" | "stoneC" | "mortar" | "ashlar" | "concrete" | "joint"
  | "steelBlue" | "steelBlueDark" | "steelRed" | "steelRedDark" | "timber" | "timberDark" | "timberLight" | "cable" | "pylon" | "pylonShade";

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
  /**
   * WHAT OF IT IS NOT SQUARE TO IT, as triangles of its own, metres (along, to its left, up): a body tipped on its
   * hinge, an arm of jointed lengths. Slabs lie along the vehicle; these lie as they are. @see plant below
   */
  extra?: () => { p: [P3, P3, P3]; mat: Mat; n: P3 }[];
};
/** A point of a model: along it, to its left, up — metres. */
export type P3 = [number, number, number];

/** Tiles to a metre: a 4.3 m car is 0.39 tiles, as the old box car was. */
export const TILES_PER_M = 0.09;
/**
 * Half steps to a metre, from the projection: a tile's side is 93 px of true
 * length on screen's 2:1 dimetric and a half step stands 16.5 px at 30°, so a
 * half step is 0.204 tiles tall — and a metre up is 0.09 / 0.204 of one.
 */
export const HALF_STEPS_PER_M = TILES_PER_M / 0.2041;
/** The angle of a slope of `pitch` half steps a tile, radians: a ramp of a whole step is 22°. */
export const pitchAngle = (pitch: number) => Math.atan((pitch * TILES_PER_M) / HALF_STEPS_PER_M);

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

// ─── BUSES ───────────────────────────────────────────────────────────────────

/** A minibus: a long-wheelbase van with a window in every bay, a sliding door. The interns'. */
const minibus = car("minibus", {
  length: 6.9, width: 2.02, sill: 0.3,
  line: [[3.45, 0.65], [3.3, 0.86], [2.8, 1.02], [2.45, 1.08], [-3.15, 1.12], [-3.45, 1.1]],
  cabin: { foot: 2.47, front: 1.77, back: -3.35, tail: -3.43, roof: 2.6, w: 0.98, inS: 0.04, r: 0.16 },
  windows: [[2.25, 1.4], [1.25, 0.15], [0.0, -1.1], [-1.25, -2.4], [-2.55, -3.2]], doors: [2.37, 1.33, -0.05],
  axles: [2.5, -2.3], tyre: { r: 0.35, width: 0.22, rim: "steel" }, lampZ: 0.84, tailZ: 1.1,
  hulls: [{ sections: [], side: "paint", top: "paint", decals: [
    { mat: "seam", at: (l, y, z) => l < -3.4 && Math.abs(y) < 0.012 && z > 0.5 && z < 2.4 },
  ] }],
});

/**
 * A BUS: one long rounded box on its wheels, deck upon deck of windows,
 * doors on the near side (left, as the traffic keeps), a destination sign
 * lit over the screen, a light roof. `coach`: high, dark glass all along and
 * luggage hatches under it, no doors but one at the front.
 */
function bus(id: string, length: number, width: number, height: number, opts: { decks: 1 | 2; coach?: boolean; axles: number[] }): Model {
  const L = length / 2, w = width / 2, H = height, front = (l: number) => l > L - 0.12, back = (l: number) => l < -L + 0.12;
  const onSide = (y: number) => Math.abs(y) > w - 0.05, near = (y: number) => y > w - 0.05;
  // Each deck's windows, from the waist up: [bottom, top].
  const decks: [number, number][] = opts.coach ? [[1.6, H - 0.4]]
    : opts.decks === 2 ? [[1.3, 2.0], [2.6, H - 0.45]] : [[1.3, H - 0.5]];
  const inDeck = (z: number, pad = 0) => decks.some(([a, b]) => z > a - pad && z < b + pad);
  const BAY = opts.coach ? 1.6 : 1.15;
  // Doors: [front, back] along the near side.
  const doors: [number, number][] = opts.coach ? [[L - 0.3, L - 1.15]] : [[L - 0.3, L - 1.45], [0.2, -1.0]];
  const inDoor = (l: number, y: number) => near(y) && doors.some(([f, b]) => l < f && l > b);
  const decals: Decal[] = [
    { mat: "trim", at: (_l, _y, z) => z < 0.42 },
    // Arches round the wheels.
    ...opts.axles.map((a): Decal => ({ mat: "arch", at: (l, y, z) => onSide(y) && (l - a) ** 2 + (z - 0.5) ** 2 < 0.58 ** 2 })),
    // The windows: a black band on each deck, glass in it, a slim pillar every bay.
    { mat: "trim", at: (l, y, z) => onSide(y) && l < L - 0.25 && l > -L + 0.3 && inDeck(z, 0.04) },
    { mat: "glass", at: (l, y, z) => onSide(y) && l < L - 0.3 && l > -L + 0.35 && inDeck(z) && ((L - l) % BAY) > 0.07 },
    ...(opts.coach ? [
      { mat: "seam" as Mat, at: (l: number, y: number, z: number) => onSide(y) && z > 0.5 && z < 1.3 && l < L - 1.4 && l > -L + 0.5 && ((L - l) % 1.4 < 0.015 || Math.abs(z - 0.52) < 0.01 || Math.abs(z - 1.28) < 0.01) },
      { mat: "livery" as Mat, at: (_l: number, y: number, z: number) => onSide(y) && Math.abs(z - 1.38) < 0.04 },
    ] : []),
    // Doors on the near side, glazed, split down the middle.
    { mat: "trim", at: (l, y, z) => inDoor(l, y) && z > 0.35 && z < (opts.decks === 2 ? 2.15 : H - 0.35) },
    { mat: "glass", at: (l, y, z) => inDoor(l, y) && z > 0.5 && z < (opts.decks === 2 ? 2.05 : H - 0.45) && doors.every(([f, b]) => Math.abs(l - (f + b) / 2) > 0.025) },
    // THE FRONT: a deep screen, the sign over it, lamps low at the corners, a grille, the plate.
    { mat: "trim", at: (l, y, z) => front(l) && Math.abs(y) < w - 0.06 && z > 1.0 && z < (opts.decks === 2 ? 2.15 : H - 0.12) },
    { mat: "glass", at: (l, y, z) => front(l) && Math.abs(y) < w - 0.1 && z > 1.05 && z < (opts.decks === 2 ? 2.05 : H - 0.5) },
    ...(opts.decks === 2 ? [{ mat: "glass" as Mat, at: (l: number, y: number, z: number) => front(l) && Math.abs(y) < w - 0.1 && z > 2.5 && z < H - 0.55 }] : []),
    { mat: "sign", at: (l, y, z) => front(l) && Math.abs(y) < w - 0.3 && z > (opts.decks === 2 ? 2.2 : H - 0.44) && z < (opts.decks === 2 ? 2.42 : H - 0.2) },
    { mat: "grille", at: (l, y, z) => front(l) && Math.abs(y) < w - 0.45 && z > 0.5 && z < 0.75 },
    ...[1, -1].flatMap((s): Decal[] => [
      { mat: "lamp", at: (l, y, z) => l > L - 0.35 && lens(y - s * (w - 0.22), z - 0.68, 0.16, 0.08) },
      { mat: "indicator", at: (l, y, z) => l > L - 0.35 && lens(y - s * (w - 0.04), z - 0.68, 0.04, 0.07) },
      { mat: "tail", at: (l, y, z) => l < -L + 0.3 && lens(y - s * (w - 0.12), z - 0.95, 0.08, 0.22) },
    ]),
    { mat: "plate", at: (l, y, z) => front(l) && Math.abs(y) < 0.26 && z > 0.44 && z < 0.56 },
    // THE BACK: a window high up, the engine's grille low down, the plate.
    { mat: "glass", at: (l, y, z) => back(l) && Math.abs(y) < w - 0.3 && z > H - 1.05 && z < H - 0.35 },
    { mat: "grille", at: (l, y, z) => back(l) && Math.abs(y) < w - 0.35 && z > 0.5 && z < 0.95 },
    { mat: "rearPlate", at: (l, y, z) => back(l) && Math.abs(y) < 0.26 && z > 1.05 && z < 1.17 },
  ];
  return {
    id, length, width, roof: { l0: L - 0.3, l1: -L + 0.3, w: w - 0.1, z: H },
    hulls: [{
      sections: [
        { l: L, w: w - 0.06, z0: 0.3, z1: H - 0.08, inS: 0.04, r: 0.3 },
        { l: L - 0.1, w, z0: 0.28, z1: H, inS: 0.04, r: 0.32 },
        { l: -L + 0.1, w, z0: 0.28, z1: H, inS: 0.04, r: 0.32 },
        { l: -L, w: w - 0.05, z0: 0.3, z1: H - 0.06, inS: 0.04, r: 0.3 },
      ],
      side: "paint", top: "roofWhite", decals,
    }],
    slabs: [
      ...mirrors(L - 0.05, w + 0.1, 1.75).map((m) => ({ ...m, z1: m.z1 + 0.25, mat: "trim" as Mat })),
      ...(opts.coach ? [] : [{ l0: -L + 0.6, l1: -L + 1.6, w: 0.45, wc: -0.3, z0: H, z1: H + 0.22, inS: 0.06, inF: 0.06, inB: 0.06, mat: "roofWhite" as Mat }]),
    ],
    wheels: opts.axles.map((l) => ({ l, w: w - 0.165, r: 0.5, width: 0.3, rim: "steel" as const })),
  };
}

/** A single-decker, a city's: low floor, two doors. */
const singleDecker = bus("singleDecker", 9.6, 2.5, 3.1, { decks: 1, axles: [2.7, -2.4] });
/** A double-decker: two decks of windows, the stairs' landing between. */
const doubleDecker = bus("doubleDecker", 9.6, 2.5, 4.3, { decks: 2, axles: [2.6, -2.4] });
/** A coach: high, long, dark glass all down it, luggage hatches beneath, three axles. */
const coach = bus("coach", 10.4, 2.5, 3.5, { decks: 1, coach: true, axles: [3.1, -2.2, -3.25] });

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
const BUSES = [minibus, singleDecker, doubleDecker, coach];
const VARIANTS: Model[] = [
  variant(cityCar, "whiteRoof", [], "roofWhite"), variant(cityCar, "blackRoof", [], "roofBlack"),
  variant(hatchback, "rails", rails(hatchback)), variant(hatchback, "blackRoof", [], "roofBlack"),
  variant(estate, "rails", rails(estate)), variant(estate, "box", [...rails(estate), roofBox(estate)]),
  variant(mpv, "rails", rails(mpv)),
  variant(smallSuv, "rails", rails(smallSuv)), variant(smallSuv, "blackRoof", [], "roofBlack"),
  variant(largeSuv, "rails", rails(largeSuv)), variant(largeSuv, "box", [...rails(largeSuv), roofBox(largeSuv)]),
];

// ── road plant: what builds a road, not what drives on one. @see render/road-plant ──────────
const post = (l: number, y: number, z0: number, z1: number): Slab => ({ l0: l + 0.05, l1: l - 0.05, w: 0.05, wc: y, z0, z1, mat: "trim" });
/** A tandem roller: a steel drum the width of it at each end, the engine between, a seat under a canopy. */
const roller: Model = {
  id: "roller", length: 4.6, width: 1.9,
  wheels: [1.45, -1.45].map((l) => ({ l, w: 0.42, r: 0.62, width: 0.86, rim: "steel" as const })),
  slabs: [
    { l0: 0.75, l1: -0.75, w: 0.8, z0: 0.55, z1: 1.5, mat: "paint" },
    // The yokes that carry the drums.
    ...[1, -1].flatMap((e) => [1, -1].map((sg): Slab => ({ l0: e > 0 ? 1.6 : -0.7, l1: e > 0 ? 0.7 : -1.6, w: 0.06, wc: sg * 0.9, z0: 0.5, z1: 1.2, mat: "paint" }))),
    ...[1, -1].map((e): Slab => ({ l0: e > 0 ? 2.15 : -0.75, l1: e > 0 ? 0.75 : -2.15, w: 0.9, z0: 1.24, z1: 1.38, mat: "paint" })),
    { l0: 0.7, l1: 0.1, w: 0.6, z0: 1.5, z1: 1.9, mat: "paint" },
    { l0: -0.15, l1: -0.6, w: 0.3, z0: 1.5, z1: 2.1, mat: "seat" },
    { l0: 0.1, l1: 0.0, w: 0.4, z0: 1.5, z1: 2.0, mat: "trim" },
    ...[[0.7, 0.75], [0.7, -0.75], [-0.7, 0.75], [-0.7, -0.75]].map(([l, y]) => post(l, y, 1.5, 2.75)),
    { l0: 0.85, l1: -0.85, w: 0.85, z0: 2.75, z1: 2.84, mat: "paint" },
    { l0: 0.3, l1: 0.1, w: 0.1, z0: 2.84, z1: 3.0, mat: "indicator" },
  ],
};
const DEG = Math.PI / 180;
// ── free geometry: what a slab cannot be ────────────────────────────────────────────────────
type FreeTri = { p: [P3, P3, P3]; mat: Mat; n: P3 };
/** A flat face, its normal turned away from `inside`. */
function freeFace(pts: P3[], mat: Mat, inside: P3, out: FreeTri[]) {
  const a = pts[0], b = pts[1], c = pts[2];
  let n: P3 = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
  const len = Math.hypot(...n) || 1;
  n = [n[0] / len, n[1] / len, n[2] / len];
  const mid = pts.reduce((m, q) => [m[0] + q[0] / pts.length, m[1] + q[1] / pts.length, m[2] + q[2] / pts.length] as P3, [0, 0, 0] as P3);
  if (n[0] * (mid[0] - inside[0]) + n[1] * (mid[1] - inside[1]) + n[2] * (mid[2] - inside[2]) < 0) n = [-n[0], -n[1], -n[2]];
  for (let k = 1; k + 1 < pts.length; k++) out.push({ p: [pts[0], pts[k], pts[k + 1]], mat, n });
}
/** A shape drawn in the plane along the machine — points (along, up), in order round it — and as thick as `w` across, about `y`: its two sides and its rim. `open`, a stretch of its rim left out: a bucket's mouth. */
function prism(profile: [number, number][], y: number, w: number, mat: Mat, out: FreeTri[], rim: Mat = mat, open = -1) {
  const n = profile.length, mid: P3 = [profile.reduce((a, q) => a + q[0], 0) / n, y, profile.reduce((a, q) => a + q[1], 0) / n];
  for (const sg of [-1, 1]) freeFace(profile.map(([l, z]) => [l, y + sg * w / 2, z] as P3), mat, mid, out);
  for (let k = 0; k < n; k++) {
    if (k === open) continue;
    const [l0, z0] = profile[k], [l1, z1] = profile[(k + 1) % n];
    freeFace([[l0, y - w / 2, z0], [l1, y - w / 2, z1], [l1, y + w / 2, z1], [l0, y + w / 2, z0]], rim, mid, out);
  }
}
/** A straight length in that plane from one point to another, `t0` deep at its first end and `t1` at its second, `w` across: an arm, a ram. */
function beam(a: [number, number], b: [number, number], t0: number, t1: number, w: number, y: number, mat: Mat, out: FreeTri[], rim: Mat = mat) {
  const dl = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dl, dz) || 1, nl = -dz / len, nz = dl / len;
  prism([[a[0] + nl * t0 / 2, a[1] + nz * t0 / 2], [b[0] + nl * t1 / 2, b[1] + nz * t1 / 2], [b[0] - nl * t1 / 2, b[1] - nz * t1 / 2], [a[0] - nl * t0 / 2, a[1] - nz * t0 / 2]], y, w, mat, out, rim);
}
/** A hydraulic ram between two points: a dark barrel for the half nearer its first, a bright rod beyond. */
function ram(a: [number, number], b: [number, number], y: number, out: FreeTri[], fat = 0.2) {
  const m: [number, number] = [a[0] + (b[0] - a[0]) * 0.55, a[1] + (b[1] - a[1]) * 0.55];
  beam(a, m, fat, fat, fat, y, "trim", out);
  beam(m, b, fat * 0.5, fat * 0.5, fat * 0.5, y, "chrome", out);
}
/** A pin at a joint, across the arm: a short dark cylinder as a square. */
const pin = (at: [number, number], y: number, w: number, out: FreeTri[], r = 0.13) =>
  prism([[at[0] - r, at[1] - r], [at[0] + r, at[1] - r], [at[0] + r, at[1] + r], [at[0] - r, at[1] + r]], y, w, "trim", out);

/** A flat plate on four corners, `t` thick toward `inside`: a hopper's wing, a chute's floor. */
function plate(q: [P3, P3, P3, P3], t: number, mat: Mat, inside: P3, out: FreeTri[]) {
  const mid: P3 = [(q[0][0] + q[2][0]) / 2, (q[0][1] + q[2][1]) / 2, (q[0][2] + q[2][2]) / 2];
  const d = [inside[0] - mid[0], inside[1] - mid[1], inside[2] - mid[2]], len = Math.hypot(d[0], d[1], d[2]) || 1;
  const o = q.map((c) => [c[0] + (d[0] / len) * t, c[1] + (d[1] / len) * t, c[2] + (d[2] / len) * t] as P3);
  const core: P3 = [mid[0] + (d[0] / len) * t / 2, mid[1] + (d[1] / len) * t / 2, mid[2] + (d[2] / len) * t / 2];
  freeFace(q, mat, core, out); freeFace(o, mat, core, out);
  for (let k = 0; k < 4; k++) freeFace([q[k], q[(k + 1) % 4], o[(k + 1) % 4], o[k]], mat, core, out);
}
/**
 * THE PAVER, which carries its own blacktop and lays it: tracks under an engine deck; ahead of it a deep hopper
 * between two WINGS hinged along its floor, black to the brim; behind the engine the driver's deck under a canopy,
 * a stack, a beacon; and out of its back, high, the mouth of the conveyor that brings the blacktop through the
 * machine — what falls from it falls in the open, ahead of the screed, which is towed and is a model of its own.
 * `fold` is how far its wings have come up, 0…1: spread wide and full as it travels, folding up and in as the hopper
 * empties, to tip what is left of it onto the conveyor. The one machine in every look; only its wings and its load.
 */
function paverAt(id: string, fold: number): Model {
  const open = (38 - 34 * fold) * DEG, left = 1 - 0.62 * fold, H = 1.2, Z = 0.66, L0 = 3.1, L1 = 1.5;
  return {
    id, length: 6.6, width: 4.0, wheels: [],
    slabs: [
      // Tracks, their frames, and the rollers that push whatever is ahead.
      ...[1, -1].map((sg): Slab => ({ l0: 1.7, l1: -2.0, w: 0.3, wc: sg * 1.0, z0: 0, z1: 0.78, inF: 0.22, inB: 0.22, mat: "tyre" })),
      ...[1, -1].map((sg): Slab => ({ l0: 1.5, l1: -1.8, w: 0.31, wc: sg * 1.0, z0: 0.3, z1: 0.48, mat: "trim" })),
      { l0: 3.28, l1: 3.1, w: 1.05, z0: 0.22, z1: 0.5, mat: "chrome" },
      // The hopper's floor, its apron, the bulkhead behind it with the conveyor's dark mouth.
      { l0: L0, l1: L1, w: 1.3, z0: 0.45, z1: Z, mat: "trim" },
      { l0: L0 + 0.06, l1: L0, w: 1.3, z0: Z, z1: Z + 0.3, mat: "paint" },
      { l0: L1, l1: L1 - 0.1, w: 1.3, z0: Z, z1: 1.9, mat: "paint" },
      { l0: L1 + 0.02, l1: L1, w: 0.5, z0: Z, z1: 1.15, mat: "tyre" },
      // The engine deck: louvred down each side, a hood, the stack and its bright tip.
      { l0: 1.4, l1: -1.3, w: 1.15, z0: 0.5, z1: 1.6, mat: "paint" },
      ...[1, -1].map((sg): Slab => ({ l0: 1.1, l1: -0.4, w: 0.02, wc: sg * 1.16, z0: 0.85, z1: 1.45, mat: "grille" })),
      { l0: 1.3, l1: -0.15, w: 0.95, z0: 1.6, z1: 2.05, inF: 0.15, mat: "paint" },
      { l0: 1.0, l1: 0.1, w: 0.55, z0: 2.05, z1: 2.1, mat: "grille" },
      { l0: 0.95, l1: 0.8, w: 0.075, wc: -0.62, z0: 2.05, z1: 3.2, mat: "trim" },
      { l0: 0.97, l1: 0.78, w: 0.095, wc: -0.62, z0: 3.2, z1: 3.32, mat: "chrome" },
      // The driver's deck: a console, two seats, a rail round it; four posts and the canopy; a beacon on it.
      { l0: -0.15, l1: -2.05, w: 1.25, z0: 1.6, z1: 1.72, mat: "trim" },
      { l0: -0.25, l1: -0.45, w: 0.8, z0: 1.72, z1: 2.3, mat: "trim" },
      ...[1, -1].map((sg): Slab => ({ l0: -1.1, l1: -1.55, w: 0.26, wc: sg * 0.55, z0: 1.72, z1: 2.4, mat: "seat" })),
      ...[1, -1].map((sg): Slab => ({ l0: -0.2, l1: -2.05, w: 0.03, wc: sg * 1.22, z0: 2.2, z1: 2.27, mat: "trim" })),
      { l0: -2.0, l1: -2.05, w: 1.22, z0: 2.2, z1: 2.27, mat: "trim" },
      ...[[-0.2, 1.2], [-0.2, -1.2], [-2.0, 1.2], [-2.0, -1.2]].map(([l, y]) => post(l, y, 1.72, 3.05)),
      { l0: 0.05, l1: -2.25, w: 1.32, z0: 3.05, z1: 3.16, mat: "paint" },
      { l0: -0.9, l1: -1.1, w: 0.1, z0: 3.16, z1: 3.34, mat: "indicator" },
      // THE CONVEYOR'S MOUTH, out of the back and high: a trough between two cheeks, black inside.
      { l0: -1.3, l1: -2.25, w: 1.0, z0: 1.2, z1: 1.3, mat: "trim" },
      ...[1, -1].map((sg): Slab => ({ l0: -1.3, l1: -2.3, w: 0.04, wc: sg * 1.02, z0: 1.3, z1: 1.62, mat: "paint" })),
      { l0: -1.3, l1: -2.2, w: 0.95, z0: 1.3, z1: 1.42, mat: "tyre" },
      // The augers' shaft under it, across the machine.
      { l0: -2.25, l1: -2.45, w: 1.35, z0: 0.22, z1: 0.42, mat: "chrome" },
    ],
    extra: () => {
      const out: FreeTri[] = [], sn = Math.sin(open), cs = Math.cos(open);
      for (const sg of [1, -1]) {
        // A WING: hinged along the floor's edge, leaning out by how far it is open; a rib along its top.
        const y0 = sg * 1.3, y1 = sg * (1.3 + H * sn), z1 = Z + H * cs;
        plate([[L0, y0, Z], [L1, y0, Z], [L1, y1, z1], [L0 - 0.3, y1, z1]], 0.07, "paint", [2.3, 0, Z + 0.6], out);
        plate([[L0 - 0.3, y1, z1], [L1, y1, z1], [L1, y1 + sg * 0.09 * cs, z1 - 0.09 * sn], [L0 - 0.3, y1 + sg * 0.09 * cs, z1 - 0.09 * sn]], 0.07, "trim", [2.3, y1 * 2, z1], out);
        // The ram that folds it, from under the floor.
        const m: P3 = [2.3, sg * (1.3 + 0.55 * H * sn), Z + 0.55 * H * cs], f: P3 = [2.3, sg * 1.75, 0.5];
        plate([[f[0] - 0.07, f[1], f[2]], [f[0] + 0.07, f[1], f[2]], [m[0] + 0.07, m[1] + sg * 0.05, m[2]], [m[0] - 0.07, m[1] + sg * 0.05, m[2]]], 0.1, "chrome", [2.3, sg * 3, 0.6], out);
      }
      // WHAT IS IN IT: black, between the wings to the height there is left of it, a mound along its middle.
      const h = 0.95 * left, yb = 1.24, yt = 1.24 + h * Math.tan(open) - 0.04, zt = Z + h, core: P3 = [2.3, 0, Z + h / 2];
      freeFace([[L0 - 0.08, -yt, zt], [L0 - 0.08, yt, zt], [L1 + 0.05, yt, zt], [L1 + 0.05, -yt, zt]], "tyre", core, out);
      freeFace([[L0 - 0.02, -yb, Z], [L0 - 0.02, yb, Z], [L0 - 0.08, yt, zt], [L0 - 0.08, -yt, zt]], "tyre", core, out);
      for (const sg of [1, -1]) freeFace([[L0 - 0.02, sg * yb, Z], [L1 + 0.05, sg * yb, Z], [L1 + 0.05, sg * yt, zt], [L0 - 0.08, sg * yt, zt]], "tyre", core, out);
      prism([[L0 - 0.4, zt], [L0 - 0.9, zt + 0.22 * left + 0.06], [L1 + 0.5, zt + 0.3 * left + 0.06], [L1 + 0.1, zt]], 0, Math.max(0.6, yt * 1.2), "tyre", out);
      return out;
    },
  };
}
/** The paver as it travels, its hopper full and its wings spread; and with its wings half up, and up. */
export const PAVER_LOOKS = ["paver", "paver1", "paver2"] as const;
const paver = paverAt("paver", 0), paver1 = paverAt("paver1", 0.5), paver2 = paverAt("paver2", 1);
/**
 * THE SCREED, towed: two arms reaching forward to the paver's sides, the heated plate that strikes the blacktop off
 * level and irons it, a gate at each end holding the blacktop in ahead of it, what it is pushing heaped against its
 * front, and the walkway along its back with its rail and its two boxes of controls. About its plate's middle.
 */
const screed: Model = {
  id: "screed", length: 5.8, width: 3.5, wheels: [],
  slabs: [
    ...[1, -1].map((sg): Slab => ({ l0: 2.85, l1: 0.2, w: 0.05, wc: sg * 1.52, z0: 0.42, z1: 0.62, mat: "paint" })),
    ...[1, -1].map((sg): Slab => ({ l0: 2.9, l1: 2.7, w: 0.07, wc: sg * 1.5, z0: 0.36, z1: 0.68, mat: "trim" })),
    // The head of blacktop it pushes, between the gates.
    { l0: 1.0, l1: 0.3, w: 1.5, z0: 0, z1: 0.36, inF: 0.45, mat: "tyre" },
    ...[1, -1].map((sg): Slab => ({ l0: 1.15, l1: -0.35, w: 0.04, wc: sg * 1.6, z0: 0.02, z1: 0.55, mat: "trim" })),
    { l0: 0.35, l1: -0.35, w: 1.6, z0: 0.03, z1: 0.42, mat: "chrome" },
    { l0: 0.3, l1: -0.3, w: 1.5, z0: 0.42, z1: 0.62, mat: "trim" },
    ...[1, -1].map((sg): Slab => ({ l0: 0.25, l1: -0.2, w: 0.22, wc: sg * 1.1, z0: 0.62, z1: 1.05, mat: "paint" })),
    { l0: -0.35, l1: -0.85, w: 1.55, z0: 0.34, z1: 0.42, mat: "trim" },
    ...[-1.5, -0.5, 0.5, 1.5].map((y) => post(-0.82, y, 0.42, 1.4)),
    { l0: -0.8, l1: -0.85, w: 1.52, z0: 1.36, z1: 1.42, mat: "trim" },
    { l0: -0.8, l1: -0.85, w: 1.52, z0: 0.88, z1: 0.92, mat: "trim" },
  ],
};

/**
 * AN EXCAVATOR, IN TWO: its tracks, which stand as the machine stands; and its house — engine, counterweight, cab,
 * boom, dipper and bucket — which slews on them, drawn over them at whatever heading it has swung to. The house in
 * poses of its arm, each the same arm at other angles: jointed lengths, pinned, with their rams.
 */
const exTracks: Model = {
  id: "exTracks", length: 3.9, width: 2.7, wheels: [],
  slabs: [
    ...[1, -1].map((sg): Slab => ({ l0: 1.9, l1: -1.9, w: 0.3, wc: sg * 1.0, z0: 0, z1: 0.8, inF: 0.25, inB: 0.25, mat: "tyre" })),
    ...[1, -1].map((sg): Slab => ({ l0: 1.7, l1: -1.7, w: 0.31, wc: sg * 1.0, z0: 0.3, z1: 0.5, mat: "trim" })),
    { l0: 1.2, l1: -1.2, w: 0.75, z0: 0.35, z1: 0.92, mat: "trim" },
  ],
};
/** Where the boom is pinned to the house, and how far to the cab's side of the middle the arm is. */
const BOOM_FOOT: [number, number] = [0.95, 1.55], ARM_Y = -0.3;
/**
 * THE ARM, in a pose: the boom from its foot to `tip`, cranked upward at its knee; the dipper from past the
 * boom's tip down to the bucket's pin at `pivot`; the bucket turned to `bite` — the way from its pin to its teeth,
 * radians up from straight ahead — full of earth if `full`; and the three rams that hold it so.
 */
function arm(tip: [number, number], pivot: [number, number], bite: number, full: boolean): FreeTri[] {
  const out: FreeTri[] = [], F = BOOM_FOOT, y = ARM_Y;
  // THE BOOM: two lengths meeting at a knee set above the straight line, deepest there.
  const bl = Math.hypot(tip[0] - F[0], tip[1] - F[1]), bn: [number, number] = [-(tip[1] - F[1]) / bl, (tip[0] - F[0]) / bl];
  const knee: [number, number] = [F[0] + (tip[0] - F[0]) * 0.52 + bn[0] * 0.62, F[1] + (tip[1] - F[1]) * 0.52 + bn[1] * 0.62];
  beam(F, knee, 0.42, 0.62, 0.4, y, "paint", out);
  beam(knee, tip, 0.62, 0.34, 0.4, y, "paint", out);
  // THE DIPPER: from a little past the boom's tip — where its ram pulls — to the bucket's pin.
  const dl = Math.hypot(pivot[0] - tip[0], pivot[1] - tip[1]), du: [number, number] = [(pivot[0] - tip[0]) / dl, (pivot[1] - tip[1]) / dl];
  const heel: [number, number] = [tip[0] - du[0] * 0.6, tip[1] - du[1] * 0.6];
  beam(heel, pivot, 0.4, 0.26, 0.32, y, "paint", out);
  // THE BUCKET: a scoop — its back, its belly, its lip to the teeth — open at the mouth; teeth along its lip.
  const u: [number, number] = [Math.cos(bite), Math.sin(bite)], v: [number, number] = [-u[1], u[0]];
  const at = (a: number, b: number): [number, number] => [pivot[0] + u[0] * a + v[0] * b, pivot[1] + u[1] * a + v[1] * b];
  prism([at(0, 0), at(0.1, 0.5), at(0.5, 0.82), at(0.95, 0.62), at(1.2, 0.02)], y, 1.0, "trim", out, "trim", 4);
  for (const ty of [-0.36, -0.12, 0.12, 0.36]) prism([at(1.12, 0.1), at(1.42, -0.04), at(1.16, -0.04)], y + ty, 0.1, "chrome", out);
  if (full) prism([at(0.08, 0.06), at(0.3, -0.22), at(0.8, -0.26), at(1.1, 0.06), at(0.6, 0.35)], y, 0.9, "load", out);
  // THE RAMS: under the boom from the house; along the boom's back to the dipper's heel; down the dipper to the bucket.
  for (const sy of [-0.3, 0.3]) ram([1.75, 1.3], [F[0] + (knee[0] - F[0]) * 0.75, F[1] + (knee[1] - F[1]) * 0.75 - 0.2], y + sy, out, 0.18);
  ram([knee[0] + bn[0] * 0.38, knee[1] + bn[1] * 0.38], heel, y, out, 0.2);
  const mid: [number, number] = [heel[0] + du[0] * dl * 0.35 - du[1] * 0.3, heel[1] + du[1] * dl * 0.35 + du[0] * 0.3];
  ram(mid, at(0.12, 0.3), y, out, 0.16);
  pin(F, y, 0.6, out); pin(tip, y, 0.5, out); pin(pivot, y, 0.45, out);
  return out;
}
/** The house, about the slewing ring at its middle, with its arm in a pose. */
const exHouse = (id: string, pose: () => FreeTri[]): Model => ({
  id, length: 7.4, width: 2.7, wheels: [],
  slabs: [
    { l0: 1.0, l1: -1.9, w: 1.25, z0: 0.95, z1: 2.1, mat: "paint" },
    { l0: -1.9, l1: -2.4, w: 1.2, z0: 1.0, z1: 2.0, inB: 0.2, mat: "trim" },
    { l0: -0.6, l1: -1.7, w: 0.5, wc: -0.5, z0: 2.1, z1: 2.3, mat: "grille" },
    { l0: -1.75, l1: -1.85, w: 0.08, wc: -0.95, z0: 2.1, z1: 2.75, mat: "trim" },
    { l0: 1.5, l1: 0.1, w: 0.48, wc: 0.72, z0: 0.95, z1: 2.75, mat: "glass" },
    { l0: 1.55, l1: 0.05, w: 0.52, wc: 0.72, z0: 2.75, z1: 2.85, mat: "paint" },
    { l0: 1.55, l1: 0.05, w: 0.52, wc: 0.72, z0: 0.95, z1: 1.45, mat: "paint" },
    // Lugs for the boom's foot.
    ...[1, -1].map((sg): Slab => ({ l0: 1.25, l1: 0.65, w: 0.06, wc: ARM_Y + sg * 0.27, z0: 0.95, z1: 1.8, mat: "paint" })),
  ],
  extra: pose,
});
/** Reached out, the bucket's teeth in the ground ahead: the start of a bite. */
const exDig = exHouse("exDig", () => arm([4.5, 2.5], [5.6, 0.95], -115 * DEG, false));
/** The bite: the dipper drawn in and the bucket curled through the ground, filling. */
const exDig2 = exHouse("exDig2", () => arm([4.2, 2.3], [4.3, 0.55], -165 * DEG, true));
/** Carrying: the boom up, the dipper in, the bucket curled level and full. */
const exLift = exHouse("exLift", () => arm([3.3, 4.2], [3.2, 2.2], 172 * DEG, true));
/** Tipping: the boom up, the dipper thrown out, the bucket turned down and empty. */
const exDump = exHouse("exDump", () => arm([3.9, 4.4], [5.2, 2.9], -95 * DEG, false));

/**
 * A TIPPER WITH ITS BODY UP by `deg`: the body one rigid box turned on the hinge at its tail — floor, sides,
 * headboard and the lip over the cab — what is left of its load slid to the tail, its tailgate hung open from its
 * top edge as gravity hangs it, and the ram under it pushing it up.
 */
function tipped(id: string, deg: number, load: Mat = "gravel", fill = 1): Model {
  const base = lorry(id, 6.6, 2.4, 1.9, [], [2.25, -1.55, -2.65]);
  const a = deg * DEG, hinge: [number, number] = [-3.05, 1.08], ca = Math.cos(a), sa = Math.sin(a);
  /** A point of the body — forward of its hinge, above its floor — on the lorry. */
  const at = (x: number, z: number): [number, number] => [hinge[0] + x * ca - z * sa, hinge[1] + x * sa + z * ca];
  const box = (x0: number, x1: number, z0: number, z1: number, y: number, w: number, mat: Mat, out: FreeTri[], rim: Mat = mat) =>
    prism([at(x0, z0), at(x1, z0), at(x1, z1), at(x0, z1)], y, w, mat, out, rim);
  return {
    ...base,
    extra: () => {
      const out: FreeTri[] = [];
      box(0, 4.4, 0, 0.1, 0, 2.36, "paint", out);
      for (const sg of [-1, 1]) box(0, 4.4, 0.1, 1.25, sg * 1.14, 0.08, "paint", out);
      box(4.32, 4.4, 0.1, 1.45, 0, 2.36, "paint", out);
      box(4.4, 4.95, 1.33, 1.45, 0, 2.2, "paint", out);
      // Ribs down its sides.
      for (const sg of [-1, 1]) for (const x of [0.9, 1.9, 2.9, 3.9]) box(x - 0.05, x + 0.05, 0.1, 1.25, sg * 1.2, 0.05, "trim", out);
      // ITS LOAD: heaped the length of it while it lies level; tipped, what is left slid down to the tail — a wedge,
      // deep there and thinning up the floor, less of it the higher it is.
      const left = 1 - deg / 60;
      // (Level, it holds as much as it has been given: nothing, a layer on its floor, on up to heaped over its sides.)
      if (deg < 5) { if (fill > 0) prism([at(0.1, 0.1), at(4.3, 0.1), at(4.25, 0.1 + 1.05 * fill), at(3.2, 0.1 + 1.4 * fill), at(1.2, 0.1 + 1.4 * fill), at(0.15, 0.1 + 1.05 * fill)], 0, 2.2, load, out); }
      else prism([at(0.05, 0.1), at(0.6 + 3.4 * left, 0.1), at(0.4 + 2.0 * left, 0.35 + 0.6 * left), at(0.05, 0.55 + 0.6 * left)], 0, 2.2, "gravel", out);
      // THE TAILGATE, hinged along its top edge and hanging straight down from it.
      const top = at(0, 1.25);
      prism([[top[0] - 0.05, top[1]], [top[0] + 0.03, top[1]], [top[0] + 0.03, top[1] - 1.15], [top[0] - 0.05, top[1] - 1.15]], 0, 2.3, "paint", out);
      // THE RAM under it, from the chassis behind the cab up to the floor.
      const foot: [number, number] = [0.75, 1.0], head = at(3.7, 0);
      for (const sg of [-1, 1]) ram(foot, head, sg * 0.28, out, 0.2);
      // The subframe it lies on when it is down.
      out.push(...((): FreeTri[] => { const q: FreeTri[] = []; prism([[1.35, 0.95], [-3.1, 0.95], [-3.1, 1.08], [1.35, 1.08]], 0, 1.0, "trim", q); return q; })());
      return out;
    },
  };
}
/**
 * THE TIPPER, at every angle the one lorry: lying level and full as it drives, and on up in steps as it tips — so
 * nothing about it changes but the angle of its body and how much is left in it.
 */
export const TIP_LOOKS = ["tipper", "tipper1", "tipper2", "tipperUp"] as const;
const tipper = tipped("tipper", 0), tipper1 = tipped("tipper1", 14), tipper2 = tipped("tipper2", 28), tipperUp = tipped("tipperUp", 42);
/**
 * THE LORRY THE DIGGER LOADS, the same lorry: come empty, and a bucketful more of earth in it each time the bucket
 * is tipped, to heaped — then away, and an empty one in its place.
 */
export const SPOIL_LOOKS = ["spoil0", "spoil1", "spoil2", "spoil3", "spoil4"] as const;
const spoils = SPOIL_LOOKS.map((id, k) => tipped(id, 0, "load", k / (SPOIL_LOOKS.length - 1)));
/**
 * A PILING RIG: tracks, a house with its cab, and a tall leader stood at its front on a foot, stayed back to the
 * house — a drop hammer riding it over the pile it is driving. `left` is how much of the pile still stands out of
 * the ground, metres; none, and it has no pile in it and its hammer hangs half way up. The one rig in every look.
 */
function rigAt(id: string, left: number | null): Model {
  const TOP = 9.6, LEAD = 2.55, h = left ?? 5.6;
  return {
    id, length: 6.4, width: 2.8, wheels: [],
    slabs: [
      ...[1, -1].map((sg): Slab => ({ l0: 1.9, l1: -1.9, w: 0.32, wc: sg * 1.02, z0: 0, z1: 0.8, inF: 0.25, inB: 0.25, mat: "tyre" })),
      ...[1, -1].map((sg): Slab => ({ l0: 1.7, l1: -1.7, w: 0.33, wc: sg * 1.02, z0: 0.3, z1: 0.5, mat: "trim" })),
      { l0: 1.2, l1: -1.2, w: 0.78, z0: 0.35, z1: 0.95, mat: "trim" },
      // The house: engine and winches, a counterweight behind, the cab to one side.
      { l0: 1.3, l1: -1.9, w: 1.25, z0: 0.95, z1: 2.15, mat: "paint" },
      { l0: -1.9, l1: -2.5, w: 1.2, z0: 1.0, z1: 2.05, inB: 0.2, mat: "trim" },
      { l0: -0.4, l1: -1.6, w: 0.5, wc: -0.5, z0: 2.15, z1: 2.35, mat: "grille" },
      { l0: 1.75, l1: 0.3, w: 0.48, wc: 0.74, z0: 0.95, z1: 2.8, mat: "glass" },
      { l0: 1.8, l1: 0.25, w: 0.52, wc: 0.74, z0: 2.8, z1: 2.9, mat: "paint" },
      { l0: 1.8, l1: 0.25, w: 0.52, wc: 0.74, z0: 0.95, z1: 1.45, mat: "paint" },
      // THE LEADER: a box mast on its foot, two bright guides down its face, a head with its sheaves.
      { l0: LEAD + 0.25, l1: LEAD - 0.25, w: 0.5, z0: 0, z1: 0.18, mat: "trim" },
      { l0: LEAD + 0.16, l1: LEAD - 0.16, w: 0.2, z0: 0.18, z1: TOP, mat: "paint" },
      ...[1, -1].map((sg): Slab => ({ l0: LEAD + 0.22, l1: LEAD + 0.16, w: 0.04, wc: sg * 0.16, z0: 0.4, z1: TOP - 0.2, mat: "chrome" })),
      ...[1.5, 3.1, 4.7, 6.3, 7.9].map((z): Slab => ({ l0: LEAD + 0.17, l1: LEAD - 0.17, w: 0.21, z0: z, z1: z + 0.12, mat: "trim" })),
      { l0: LEAD + 0.75, l1: LEAD - 0.35, w: 0.26, z0: TOP, z1: TOP + 0.35, mat: "trim" },
      // THE HAMMER on the guides, a ram in a cage; and the pile under it, what is left of it.
      { l0: LEAD + 0.95, l1: LEAD + 0.22, w: 0.34, z0: h + 0.12, z1: h + 1.75, mat: "trim" },
      { l0: LEAD + 0.97, l1: LEAD + 0.2, w: 0.36, z0: h + 0.75, z1: h + 1.05, mat: "paint" },
      { l0: LEAD + 0.85, l1: LEAD + 0.32, w: 0.3, z0: h, z1: h + 0.12, mat: "chrome" },
      ...(left === null ? [] : [{ l0: LEAD + 0.78, l1: LEAD + 0.4, w: 0.19, z0: 0, z1: h, mat: "hub" } as Slab]),
    ],
    extra: () => {
      const out: FreeTri[] = [];
      // The stays, from the house's back up to the leader; the rope from the head down to the hammer.
      for (const sy of [-0.45, 0.45]) beam([-1.6, 2.15], [LEAD - 0.1, 7.2], 0.14, 0.14, 0.12, sy, "paint", out);
      beam([-0.2, 2.15], [LEAD - 0.12, 3.6], 0.2, 0.2, 0.18, 0, "trim", out);
      beam([LEAD + 0.6, TOP], [LEAD + 0.6, h + 1.75], 0.05, 0.05, 0.05, 0, "trim", out);
      return out;
    },
  };
}
/** The rig between piles, its hammer up and empty; and driving one, the pile going in. */
export const RIG_LOOKS = ["rig0", "rig1", "rig2", "rig3"] as const;
const rigUp = rigAt("rigUp", null), rigs = RIG_LOOKS.map((id, k) => rigAt(id, [5.2, 3.6, 2.0, 0.5][k]));
/**
 * A CONCRETE MIXER: a lorry's cab and chassis; its DRUM, a round barrel lying back toward its mouth — narrow at its
 * head, fat in the middle — with two bands wound round it as a screw's thread is; the hopper it is charged by over
 * its tail, and the chute swung down from under that, where the concrete comes out. `turn` is how far round the
 * drum has gone, nought to one of the way from one band to the next: the one lorry in every look, its drum turned.
 */
const mixerAt = (id: string, turn: number): Model => {
  /** The drum's axis, rising toward its mouth: how high it is, so far along the lorry. */
  const axis = (l: number) => 2.38 - 0.17 * l;
  /** A ring of the drum: round, so as wide as it is high. */
  const ring = (l: number, R: number): Section => ({ l, w: R, z0: axis(l) - R, z1: axis(l) + R, r: R });
  return {
    ...lorry(id, 7.6, 2.5, 2.0, [
      // The subframe, narrow: there is daylight under the drum either side of it.
      { l0: 1.75, l1: -3.7, w: 0.5, z0: 0.72, z1: 1.02, mat: "trim" },
      // WHAT CARRIES THE DRUM: the pedestal and gearbox at its head, behind the cab; a cradle with a roller each side under its track ring.
      { l0: 1.8, l1: 1.45, w: 0.4, z0: 1.02, z1: axis(1.6) + 0.15, mat: "trim" },
      { l0: 1.62, l1: 1.5, w: 0.2, z0: axis(1.6) - 0.2, z1: axis(1.6) + 0.2, mat: "chrome" },
      { l0: -1.95, l1: -2.25, w: 0.95, z0: 1.02, z1: 1.2, mat: "trim" },
      ...[1, -1].map((sg): Slab => ({ l0: -1.98, l1: -2.22, w: 0.12, wc: sg * 0.72, z0: 1.2, z1: axis(-2.1) - 0.62, mat: "chrome" })),
      // A water tank across the frame behind the cab, under the drum's head; a mudguard over the back wheels each side.
      { l0: 1.4, l1: 0.95, w: 0.7, z0: 1.02, z1: 1.3, inS: 0.06, mat: "chrome" },
      ...[1, -1].map((sg): Slab => ({ l0: -1.0, l1: -3.45, w: 0.2, wc: sg * 1.04, z0: 1.12, z1: 1.2, mat: "trim" })),
      // The frame that carries its mouth, the hopper on it, a ladder up one side.
      ...[1, -1].map((sg): Slab => ({ l0: -3.02, l1: -3.17, w: 0.05, wc: sg * 0.72, z0: 1.02, z1: axis(-3.0) + 0.75, mat: "trim" })),
      { l0: -2.98, l1: -3.2, w: 0.74, z0: axis(-3.0) + 0.62, z1: axis(-3.0) + 0.75, mat: "trim" },
      { l0: -2.95, l1: -3.7, w: 0.46, z0: axis(-3.0) + 0.3, z1: axis(-3.0) + 0.95, inF: 0.2, inB: 0.05, mat: "trim" },
      { l0: -3.3, l1: -3.4, w: 0.25, wc: 0.95, z0: 1.02, z1: axis(-3.0) + 0.3, mat: "chrome" },
    ], [2.6, -1.7, -2.9], {
      // THE DRUM, round and clear of the frame: narrow at its head behind the cab, fat in the middle, drawn in to its
      // mouth and lying back toward it.
      hulls: [{
        sections: [ring(1.5, 0.4), ring(0.95, 0.86), ring(0, 1.08), ring(-1.2, 1.1), ring(-2.2, 0.84), ring(-3.0, 0.5)],
        side: "paint", top: "paint",
        decals: [
          // THE BANDS: two, wound round it and along it — so that as it turns they run down it, toward its mouth.
          { mat: "liveryRed", at: (l, y, z) => { const a = Math.atan2(z - axis(l), y) / Math.PI, q = (((a + l * 0.42 + turn) % 1) + 1) % 1; return l < 1.35 && l > -2.85 && q < 0.2; } },
          // The track ring it rides its rollers on, and the lip of its mouth.
          { mat: "trim", at: (l) => Math.abs(l + 2.1) < 0.07 || l < -2.93 },
        ],
      }],
    }),
    extra: () => {
      const out: FreeTri[] = [];
      // THE CHUTE: a trough from under the drum's mouth down and out behind, its two cheeks standing over its floor.
      beam([-3.2, 2.15], [-5.1, 0.95], 0.1, 0.1, 0.6, 0, "trim", out);
      for (const sy of [-0.3, 0.3]) beam([-3.2, 2.29], [-5.1, 1.09], 0.3, 0.22, 0.05, sy, "chrome", out);
      return out;
    },
  };
};
/** The mixer with its drum turning: a quarter of the way from one band to the next, each look on from the last. */
export const MIXER_LOOKS = ["mixer", "mixer1", "mixer2", "mixer3"] as const;
const mixers = MIXER_LOOKS.map((id, k) => mixerAt(id, k / MIXER_LOOKS.length));
/** What builds a road. Never in the traffic. */
export const PLANT = [paver, paver1, paver2, screed, roller, exTracks, exDig, exDig2, exLift, exDump, tipper1, tipper2, tipperUp, ...spoils, rigUp, ...rigs, ...mixers];

const WORK = [pickup, smallVan, panelVan, lutonVan, flatbed, boxLorry, tipper, machineLorry];
const SERVICE = [taxi, police, ambulance, postalVan, fireEngine];

export const MODELS: readonly Model[] = [...CARS, ...VARIANTS, ...WORK, ...SERVICE, ...SPECIAL, ...BUSES, ...PLANT];
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
/** The interns' bus, and Shuttle Bus's. */
export const MINIBUS_WEIGHTS: Readonly<Record<string, number>> = { minibus: 2, singleDecker: 1 };
export const BUS_WEIGHTS: Readonly<Record<string, number>> = { singleDecker: 2, doubleDecker: 2, coach: 1 };

/** Where a model's light bar is, metres: along it, out to either end of it, and its top. Null for one with none. @see lightBar */
export function beaconsOf(id: string): { l: number; w: number; z: number } | null {
  const bar = modelById.get(id)?.slabs.find((sl) => sl.mat === "light");
  return bar ? { l: (bar.l0 + bar.l1) / 2, w: bar.w, z: bar.z1 } : null;
}
