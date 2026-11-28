/**
 * THE CROPS, as models: a half-tile PATCH of each crop in its rows, through its year — shoots coming up, grown,
 * ripe, stubble after the cut, and under snow — baked with the trees (`bun run bake:trees`) and drawn by their mesh,
 * so a field turns, sways and takes the snow as a wood does. Hay is the ground's own (@see render/ground-mesh).
 *
 * A patch stands on its FRONT corner, every plant behind it: four to a field tile, each drawn in its own cell's
 * band and never under the ground in front. Its rows lie where the shader ploughs them (@see vegetation/crops
 * rowsOf), so the four meet in unbroken lines; its four turns are not turns but sowings — two with the rows along
 * u, two along v, each its own plants. @see render/forest fieldOn, render/tree-mesh
 */
import type { Tri, V3 } from "../agents/cars/raster";
import { TILES_PER_M } from "../agents/cars/models";
import { ball, limb } from "../agents/people/figures";
import type { TreeState } from "../calendar";
import { rowsOf, type Crop } from "../vegetation/crops";
import { seeded, shadowOf, type PropShadow } from "./models";

/** The crops with plants of their own. */
export const CROP_KINDS = ["wheat", "barley", "rape", "maize", "kale"] as const satisfies readonly Crop[];
export type CropKind = (typeof CROP_KINDS)[number];

/** A tile, metres: a patch is half of one each way. */
const TILE = 1 / TILES_PER_M;
/** Plants a row to a tile. */
const PER: Readonly<Record<CropKind, number>> = { wheat: 18, barley: 18, rape: 12, maize: 10, kale: 8 };

type Rand = () => number;
const straw = (out: Tri[], n0: number, c: V3) => { for (let t = n0; t < out.length; t++) out[t].c = c; };
const STRAW: V3 = [0.8, 0.7, 0.46], STEM: V3 = [0.33, 0.46, 0.22], DRY: V3 = [0.62, 0.52, 0.33];

/** Each plant's foot in a patch: its rows (along u or v), jittered a little along them. */
function plants(kind: CropKind, acrossU: boolean, rand: Rand, each: (at: V3, k: number) => void) {
  const rows = rowsOf(kind), per = PER[kind];
  let k = 0;
  for (let r = 0; r < rows / 2; r++) {
    const across = ((r + 0.5) / rows - 0.5) * TILE;
    for (let j = 0; j < per / 2; j++) {
      const along = ((j + 0.5 + (rand() - 0.5) * 0.5) / per - 0.5) * TILE;
      const side = (rand() - 0.5) * 0.12 * (TILE / rows);
      each(acrossU ? [across + side, along, 0] : [along, across + side, 0], k++);
    }
  }
}

/** Out from a foot at a bearing, `d` along and `z` up. */
const out3 = (at: V3, a: number, d: number, z: number): V3 => [at[0] + Math.cos(a) * d, at[1] + Math.sin(a) * d, at[2] + z];

/** Blades of young grain, a tuft. */
function shoots(at: V3, rand: Rand, out: Tri[], h = 0.32, n = 6) {
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, hh = h * (0.7 + 0.5 * rand());
    limb(out3(at, a, 0.04, 0), out3(at, a, 0.12 + 0.12 * rand(), hh), 0.06, 0.025, "leaf", out, 3, false);
  }
}

/** A tuft of grain: stalks with their ears, `ripe` nodding over (barley right over, its awns out). */
function grain(at: V3, rand: Rand, out: Tri[], barley: boolean, ripe: boolean) {
  const n = 5 + Math.floor(rand() * 3), h = barley ? 1.05 : 1.25;
  // (A blade or two low down.)
  for (let i = 0; i < 2; i++) { const a = rand() * Math.PI * 2; limb(out3(at, a, 0.05, 0.1), out3(at, a, 0.4, 0.5 * h), 0.06, 0.02, "leaf", out, 3, false); }
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, lean = 0.06 + 0.16 * rand(), hh = h * (0.85 + 0.25 * rand());
    const tip = out3(at, a, lean, hh);
    limb(out3(at, a, 0.03, 0), tip, 0.045, 0.035, "leaf", out, 3, false);
    // THE EAR: up from the stalk's top, or hanging from it once ripe.
    const nod = ripe ? (barley ? 0.75 : 0.35) : barley ? 0.15 : 0;
    const len = barley ? 0.2 : 0.24, end: V3 = [tip[0] + Math.cos(a) * len * nod, tip[1] + Math.sin(a) * len * nod, tip[2] + len * (1 - 1.6 * nod * nod)];
    limb(tip, end, 0.085, 0.06, "leaf", out, 4, true);
    if (barley) limb(end, [end[0] + Math.cos(a) * 0.12 * (0.4 + nod), end[1] + Math.sin(a) * 0.12 * (0.4 + nod), end[2] + 0.14 * (1 - 2 * nod)], 0.025, 0.01, "leaf", out, 3, false);
  }
}

/** Stubble where the combine went: short straw, a stalk or two lying. */
function stubble(at: V3, rand: Rand, out: Tri[], h: number, r: number) {
  const n0 = out.length;
  for (let i = 0; i < 4; i++) { const a = rand() * Math.PI * 2, d = 0.15 * rand(); limb(out3(at, a, d, 0), out3(at, a, d + 0.02, h * (0.7 + 0.5 * rand())), r, r * 0.85, "bark", out, 3, false); }
  if (rand() < 0.4) { const a = rand() * Math.PI * 2; limb(out3(at, a, 0.1, 0.03), out3(at, a + 0.4, 0.55, 0.03), r * 0.8, r * 0.7, "bark", out, 3, false); }
  straw(out, n0, STRAW);
}

/** Rape: a rosette of broad leaves; grown, a branching stem with its heads (flowers, then pods); ripe, dry. */
function rosette(at: V3, rand: Rand, out: Tri[], r: number) {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rand() * 0.6;
    ball(out3(at, a, r * 0.55, r * 0.22), [r * 0.55, r * 0.3, r * 0.12], "leaf", out, undefined, 6, 3);
  }
}
function rapePlant(at: V3, rand: Rand, out: Tri[], ripe: boolean) {
  const n0 = out.length, h = 1.35 + 0.35 * rand();
  // (Its stems and leaves a fixed green, so in flower only its heads go yellow; dry once ripe.)
  for (let i = 0; i < 3; i++) { const a = rand() * Math.PI * 2; ball(out3(at, a, 0.25, 0.3), [0.3, 0.14, 0.05], "bark", out, undefined, 5, 3); }
  const top = out3(at, rand() * Math.PI * 2, 0.08, h);
  limb(at, top, 0.06, 0.04, "bark", out, 3, false);
  const heads: V3[] = [top];
  for (let i = 0; i < 5; i++) {
    const a = rand() * Math.PI * 2, from: V3 = [at[0], at[1], h * (0.4 + 0.12 * i)];
    const to = out3(from, a, 0.3 + 0.15 * rand(), 0.3 + 0.25 * rand());
    limb(from, to, 0.04, 0.03, "bark", out, 3, false);
    heads.push(to);
  }
  straw(out, n0, ripe ? DRY : STEM);
  for (const c of heads) ball([c[0], c[1], c[2] + 0.05], [0.15, 0.15, ripe ? 0.1 : 0.13], "leaf", out, undefined, 6, 4);
}

/** Maize: a tall stalk, broad leaves arching off it each way, a cob, the tassel on top. */
function maizePlant(at: V3, rand: Rand, out: Tri[], ripe: boolean) {
  const h = 2.6 + 0.5 * rand(), a0 = rand() * Math.PI * 2, top: V3 = [at[0] + 0.05, at[1], h];
  limb(at, top, 0.11, 0.06, "leaf", out, 4, false);
  for (let i = 0; i < 7; i++) {
    const z = h * (0.18 + 0.1 * i), a = a0 + i * Math.PI + (rand() - 0.5) * 0.7, len = 0.9 - 0.06 * i, droop = ripe ? 0.55 : 0.25;
    const from: V3 = [at[0], at[1], z], knee = out3(from, a, len * 0.45, len * 0.35), end = out3(from, a, len, len * (0.2 - droop));
    limb(from, knee, 0.1, 0.09, "leaf", out, 3, false);
    limb(knee, end, 0.09, 0.03, "leaf", out, 3, false);
  }
  const n0 = out.length;
  const ca = a0 + Math.PI / 2, cob = out3(at, ca, 0.14, h * 0.5);
  ball(cob, [0.09, 0.09, 0.22], "bark", out, undefined, 6, 4);
  straw(out, n0, ripe ? [0.78, 0.66, 0.4] : [0.55, 0.66, 0.32]);
  const n1 = out.length;
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2; limb(top, out3(top, a, 0.22, 0.22), 0.035, 0.015, "bark", out, 3, false); }
  straw(out, n1, ripe ? [0.62, 0.5, 0.3] : [0.86, 0.8, 0.55]);
}

/** Kale: a stout stem, ruffled leaves round it (`leaves` of them), a dark heart. */
function kalePlant(at: V3, rand: Rand, out: Tri[], leaves: number) {
  const n0 = out.length;
  limb(at, [at[0], at[1], 0.5], 0.1, 0.08, "bark", out, 4, false);
  straw(out, n0, [0.42, 0.5, 0.34]);
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rand() * 0.5, z = 0.3 + 0.45 * rand(), d = 0.2 + 0.2 * rand();
    ball(out3(at, a, d, z), [0.3, 0.2, 0.17], "leaf", out, undefined, 6, 4);
  }
  ball([at[0], at[1], 0.75], [0.17, 0.17, 0.15], "leaf", out, undefined, 6, 4);
}

/** Snow lying on what stands: a cap on each plant's top, as high as it is. */
function capped(out: Tri[], at: V3, r: number, z: number) {
  ball([at[0], at[1], z], [r, r, r * 0.4], "snow", out, undefined, 6, 3);
}

/** A crop's patch in a look, sown its `k`th way (rows across u for 0 and 1). */
function patch(kind: CropKind, state: TreeState, k: number): Tri[] {
  const out: Tri[] = [], rand = seeded(0xc40 + CROP_KINDS.indexOf(kind) * 97 + k * 13 + 1), acrossU = k < 2;
  plants(kind, acrossU, rand, (at) => {
    switch (kind) {
      case "wheat": case "barley": {
        const barley = kind === "barley";
        if (state === "bud") shoots(at, rand, out);
        else if (state === "full" || state === "thin") grain(at, rand, out, barley, state === "thin");
        else if (state === "bare") stubble(at, rand, out, 0.16, 0.05);
        else { shoots(at, rand, out); capped(out, at, 0.2, 0.2); }
        break;
      }
      case "rape":
        if (state === "bud") rosette(at, rand, out, 0.45);
        else if (state === "full" || state === "thin") rapePlant(at, rand, out, state === "thin");
        else if (state === "bare") stubble(at, rand, out, 0.26, 0.06);
        else { rosette(at, rand, out, 0.45); capped(out, at, 0.35, 0.16); }
        break;
      case "maize":
        if (state === "bud") shoots(at, rand, out, 0.55, 4);
        else if (state === "full" || state === "thin") maizePlant(at, rand, out, state === "thin");
        else { stubble(at, rand, out, 0.3, 0.09); if (state === "snow") capped(out, at, 0.25, 0.25); }
        break;
      case "kale":
        if (state === "bud") rosette(at, rand, out, 0.3);
        else if (state === "full" || state === "thin") kalePlant(at, rand, out, state === "thin" ? 5 : 9);
        // (Picked, and the stalks cut down to stubs till it is planted out again.)
        else if (state === "bare") stubble(at, rand, out, 0.2, 0.08);
        else { kalePlant(at, rand, out, 9); capped(out, at, 0.32, 0.86); }
        break;
    }
  });
  return out;
}

/** No shadow of their own under the plants: the ground shades between the rows. */
const NONE: PropShadow = shadowOf(0.01, 0);

export type CropLook = { id: CropKind; state: TreeState; tris: (k: number) => Tri[]; shadow: PropShadow };
/** Every crop in every look, each at its four sowings. */
export const CROP_LOOKS: readonly CropLook[] = CROP_KINDS.flatMap((id) =>
  (["bud", "full", "thin", "bare", "snow"] as const).map((state): CropLook => ({ id, state, tris: (k) => patch(id, state, k), shadow: NONE })));
