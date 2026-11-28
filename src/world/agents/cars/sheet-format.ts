/**
 * The baked vehicle sheet's index, as `dev/bake-cars.ts` writes it and the
 * game reads it. @see car-sheet.ts
 */

/** Headings baked, round the full turn: as many as the box cars had. */
export const CAR_HEADINGS = 32;
/** Texels to a world px at scale 1. */
export const CAR_RES = 2;

/**
 * A frame: its page and where it starts, then each layer cropped to what it
 * covers — its width, height and the origin in it. The trim sits right of the
 * paint, `GAP` on. Then each lamp's mask, packed apart: its page, where it
 * starts, and its size and origin — seven numbers. A livery's paint is
 * empty: 0 wide; so is a lamp a vehicle has none of, or none seen at that
 * heading. And after the lamps, the same seven numbers for each of the
 * `over` layers — the paint and the trim that are drawn over whoever is in
 * the vehicle — as many as the sheet's `over` says.
 * @see raster LAMPS
 */
export type CarFrame = [
  page: number, x: number, y: number,
  pw: number, ph: number, pox: number, poy: number,
  tw: number, th: number, tox: number, toy: number,
  ...lamps: number[],
];

/**
 * ON A SLOPE a vehicle is baked again, leant back or forward as it stands on it: at each of these pitches (half
 * steps a tile along its heading — a ramp's one or two, up and down), for the headings a ramp is driven at, which
 * are a road's four ways. `PITCH_HEADINGS` of them round the turn, evenly: every `headings / PITCH_HEADINGS`th.
 * Any other heading on a slope, and what is left of a pitch between two of these, is sheared. @see car-sheet poseOf
 */
export const CAR_PITCHES = [-2, -1, 1, 2] as const;
export const PITCH_HEADINGS = 4;

export type CarSheet = {
  res: number;
  headings: number;
  /** The pitches baked, and how many headings of each. */
  pitches?: number[];
  pitchHeadings?: number;
  /** How many layers a frame carries after its lamps, to be drawn over its occupants: the paint's and the trim's. None in an old sheet. @see raster BakeOpts.over */
  over?: number;
  /** Whether a frame carries, last of all, the snow that lies on it (1): a layer faded in over the vehicle. None in an old sheet. @see raster bakeSnowFrame */
  snow?: number;
  pages: string[];
  /** `tilted[p][k]`: the frame at pitch `pitches[p]`, heading `k` of `pitchHeadings`. */
  models: Record<string, { length: number; width: number; frames: CarFrame[]; tilted?: CarFrame[][] }>;
};

/** Texels between the paint layer and the trim layer of a frame. */
export const CAR_GAP = 4;
