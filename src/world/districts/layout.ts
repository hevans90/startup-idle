/**
 * A DISTRICT, LAID OUT WHOLE: a square of blocks inside a ring of road.
 *
 *   ═══════════════════════   the ring: the district's edge, all road
 *   ║ h h h h h h ║ h h o o   a strip: two rows of lots, each row fronting
 *   ║ h h h h h h ║ h h o o     the street on its own side
 *   ═══════════════════════   a street every third row
 *   ║ h h ▣ ▣ h h ║ s s h h   ▣ the centre: a landmark or a park, the
 *   ║ h h ▣ ▣ h h ║ s s h h     street under it cut away
 *   ═══════════════════════   ║ a cross street every `BLOCK_LOTS` lots
 *
 * Houses on every lot, then offices — two lots by two, fronting both streets
 * — for as many desks as the houses have beds, then the services among them.
 * Checked against the ground as it will be (its roads laid), so what is
 * planned can be built. Pure. @see findDistrictSite, placeDistrictNow
 */
import type { GeneratorId } from "../../state/generators.store";
import { housedBy } from "../../game/housing";
import { DESKS, workplaceKind } from "../agents/commute";
import { cloneGrid } from "../ai/masterplan/town-model";
import { idx, inBounds, type Grid } from "../grid";
import { structureDef } from "../structures/def";
import { validatePlacement, type PlaceRules } from "../structures/place";
import { portTiles } from "../water/ports";
import type { Cell } from "./route";

/** Lots across a block, between two cross streets. */
export const BLOCK_LOTS = 6;
/** Rows a strip takes, its street included: a street, then two rows of lots. */
const STRIP = 3;
/** The office a kind's desks are in, two lots by two; none for a kind whose office will not fit a strip. */
const OFFICE: Partial<Record<GeneratorId, string>> = { intern: "office-intern", vibe_coder: "office-vibe" };

export type DistrictSpec = {
  /** Blocks across, each `BLOCK_LOTS` lots wide. */
  across: number;
  /** Strips down, each two lots deep. */
  strips: number;
  /** The houses, in turn over the lots: kit ids, e.g. `kit:intern.t1`. */
  houses: readonly string[];
  /** Offices for the houses' beds. @see deskBalance */
  desks?: boolean;
  /** A building in the middle: a landmark, a park. */
  centre?: string;
  /** Services spread over the district. */
  services?: readonly string[];
};

export type Planned = { def: string; x: number; y: number };

export type DistrictPlan = {
  /** The district's corner and size, its ring included. */
  x0: number; y0: number; w: number; h: number;
  /** Every tile of road it lays, the ring and its streets. */
  roads: Cell[];
  /** The roads as straight strokes, rows first. */
  runs: { from: Cell; to: Cell }[];
  /** What stands on its lots, the centre first. */
  buildings: Planned[];
  /** Ground kept open: where a building's slop comes out, for a sewer connection to reach. */
  open: Cell[];
};

/** A district's size for a spec, its ring included. */
export const districtSize = (spec: Pick<DistrictSpec, "across" | "strips">) =>
  ({ w: spec.across * (BLOCK_LOTS + 1) + 1, h: spec.strips * STRIP + 1 });

/** Whether a district's own road runs at (dx, dy) from its corner, its centre aside: for a site on road already there. @see findDistrictSite */
export const districtRoadAt = (dx: number, dy: number) => dy % STRIP === 0 || dx % (BLOCK_LOTS + 1) === 0;

/** Its rectangle's own tiles: whether (x, y) is a street of it, a lot of it, or neither. */
function grid0(x0: number, y0: number, spec: DistrictSpec) {
  const { w, h } = districtSize(spec);
  const isRow = (y: number) => (y - y0) % STRIP === 0;
  const isCol = (x: number) => (x - x0) % (BLOCK_LOTS + 1) === 0;
  const inside = (x: number, y: number) => x >= x0 && y >= y0 && x < x0 + w && y < y0 + h;
  return { w, h, isRow, isCol, inside };
}

/**
 * THE PLAN for a district with its ring's corner at (x0, y0). Its roads are
 * all laid; a building the ground will not take there (water, a building in
 * the way) is left out.
 */
export function layoutDistrict(g: Grid, x0: number, y0: number, spec: DistrictSpec, rules: PlaceRules = { needsRoad: true }): DistrictPlan {
  const { w, h, isRow, isCol, inside } = grid0(x0, y0, spec);
  // THE CENTRE: in the middle block, the strip above the middle, the street under it cut away.
  let plaza: { x: number; y: number; w: number; h: number } | null = null;
  const centreDef = spec.centre ? structureDef(spec.centre) : null;
  if (centreDef && centreDef.footprint.w <= BLOCK_LOTS) {
    const j = Math.floor(spec.across / 2), s = Math.max(0, Math.floor((spec.strips - 1) / 2));
    const bx = x0 + j * (BLOCK_LOTS + 1) + 1;
    plaza = { x: bx + Math.floor((BLOCK_LOTS - centreDef.footprint.w) / 2), y: y0 + s * STRIP + 1, w: centreDef.footprint.w, h: centreDef.footprint.h };
    if (plaza.y + plaza.h > y0 + h - 1) plaza = null;
  }
  const inPlaza = (x: number, y: number) => !!plaza && x >= plaza.x && y >= plaza.y && x < plaza.x + plaza.w && y < plaza.y + plaza.h;
  const isRoad = (x: number, y: number) => inside(x, y) && (isRow(y) || isCol(x)) && !inPlaza(x, y);

  // THE ROADS, and their strokes: a row's runs, then a column's, broken where the centre cuts them.
  const roads: Cell[] = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (isRoad(x, y)) roads.push({ x, y });
  const runs: { from: Cell; to: Cell }[] = [];
  const along = (cells: Cell[]) => {
    let start: Cell | null = null, prev: Cell | null = null;
    for (const c of cells) {
      if (isRoad(c.x, c.y)) { start ??= c; prev = c; continue; }
      if (start && prev) runs.push({ from: start, to: prev });
      start = prev = null;
    }
    if (start && prev) runs.push({ from: start, to: prev });
  };
  for (let y = y0; y < y0 + h; y += STRIP) along(Array.from({ length: w }, (_, k) => ({ x: x0 + k, y })));
  for (let x = x0; x < x0 + w; x += BLOCK_LOTS + 1) along(Array.from({ length: h }, (_, k) => ({ x, y: y0 + k })));

  // THE GROUND AS IT WILL BE: its roads laid, so what fronts them can be checked.
  const planned = cloneGrid(g);
  for (const c of roads) if (inBounds(planned, c.x, c.y)) planned.paved[idx(planned, c.x, c.y)] ||= 1;
  const taken = new Set<number>();
  const key = (x: number, y: number) => y * g.w + x;
  // Never in the water: placing allows it (a building walls it), a district does not. @see aiRules
  const dry = (x: number, y: number) => inBounds(g, x, y) && g.pool[idx(g, x, y)] === 0 && g.deckPool[idx(g, x, y)] === 0;
  const free = (x: number, y: number) => inside(x, y) && dry(x, y) && !isRoad(x, y) && !inPlaza(x, y) && !taken.has(key(x, y));
  // WHERE ITS SLOP COMES OUT, kept open ground: a connection is laid on empty plots only. @see lateralGround
  const slopOut = (def: string, x: number, y: number) => {
    const d = structureDef(def)!;
    return portTiles(planned, def, x, y, d.footprint.w, d.footprint.h).filter((p) => p.port.fluid === "slop" && p.port.dir === "out");
  };
  const open: Cell[] = [];
  const fits = (def: string, x: number, y: number) => {
    const d = structureDef(def);
    if (!d) return false;
    for (let dy = 0; dy < d.footprint.h; dy++) for (let dx = 0; dx < d.footprint.w; dx++) if (!free(x + dx, y + dy)) return false;
    if (!slopOut(def, x, y).every((p) => free(p.x, p.y))) return false;
    return validatePlacement(planned, d, x, y, rules).ok;
  };
  const take = (def: string, x: number, y: number) => {
    const d = structureDef(def)!;
    for (let dy = 0; dy < d.footprint.h; dy++) for (let dx = 0; dx < d.footprint.w; dx++) taken.add(key(x + dx, y + dy));
    for (const p of slopOut(def, x, y)) { taken.add(key(p.x, p.y)); open.push({ x: p.x, y: p.y }); }
  };

  const footprintDry = (r: { x: number; y: number; w: number; h: number }) => {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (!dry(x, y)) return false;
    return true;
  };
  const centre: Planned[] = [];
  if (plaza && spec.centre && footprintDry(plaza) && validatePlacement(planned, centreDef!, plaza.x, plaza.y, rules).ok) {
    centre.push({ def: spec.centre, x: plaza.x, y: plaza.y });
    for (const p of slopOut(spec.centre, plaza.x, plaza.y)) if (free(p.x, p.y)) { taken.add(key(p.x, p.y)); open.push({ x: p.x, y: p.y }); }
  }

  // THE 2×2 SLOTS, a block's ends first (beside the cross streets), then its middle: offices and services go here.
  const slots: Cell[] = [];
  for (let s = 0; s < spec.strips; s++) {
    const y = y0 + s * STRIP + 1;
    for (let j = 0; j < spec.across; j++) {
      const bx = x0 + j * (BLOCK_LOTS + 1) + 1;
      for (const dx of [0, BLOCK_LOTS - 2, 2]) slots.push({ x: bx + dx, y });
    }
  }
  const services: Planned[] = [];
  const offices: Planned[] = [];
  let slot = 0;
  const nextSlot = (def: string): Cell | null => {
    for (; slot < slots.length; slot++) {
      const c = slots[slot];
      if (fits(def, c.x, c.y)) { slot++; return c; }
    }
    return null;
  };
  // Services spread out: a slot every so often, not the first few.
  if (spec.services?.length) {
    const stride = Math.max(1, Math.floor(slots.length / (spec.services.length + 1)));
    spec.services.forEach((def, k) => {
      for (let t = (k + 1) * stride; t < slots.length; t++) {
        const c = slots[t];
        if (fits(def, c.x, c.y)) { take(def, c.x, c.y); services.push({ def, x: c.x, y: c.y }); break; }
      }
    });
  }

  // HOUSES on every lot left, in turn.
  const houseAt = (x: number, y: number) => spec.houses[((x - x0) * 7 + (y - y0) * 13) % spec.houses.length];
  const houses = new Map<number, Planned>();
  const lotsFor = () => {
    houses.clear();
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      if (!free(x, y) || !spec.houses.length) continue;
      const def = houseAt(x, y);
      if (fits(def, x, y)) houses.set(key(x, y), { def, x, y });
    }
  };
  lotsFor();
  // OFFICES for the beds: the kind furthest short of desks gets the next, its four lots no longer houses, till none is short.
  if (spec.desks) for (;;) {
    const short = deskBalance([...houses.values(), ...offices, ...centre])
      .filter((b) => OFFICE[b.kind] && b.beds > b.desks)
      .sort((a, b) => (b.beds - b.desks) - (a.beds - a.desks))[0];
    if (!short) break;
    const def = OFFICE[short.kind]!;
    const c = nextSlot(def);
    if (!c) break;
    take(def, c.x, c.y);
    offices.push({ def, x: c.x, y: c.y });
    lotsFor();
  }
  return { x0, y0, w, h, roads, runs, buildings: [...centre, ...offices, ...services, ...houses.values()], open };
}

/**
 * BEDS AND DESKS, a kind at a time: what a set of buildings houses, and the
 * desks it has for them. An office is worth its desks; a house its beds at the
 * tier it is. @see layoutDistrict
 */
export function deskBalance(buildings: readonly Pick<Planned, "def">[]): { kind: GeneratorId; beds: number; desks: number }[] {
  const out = new Map<GeneratorId, { kind: GeneratorId; beds: number; desks: number }>();
  const row = (k: GeneratorId) => out.get(k) ?? (out.set(k, { kind: k, beds: 0, desks: 0 }), out.get(k)!);
  for (const b of buildings) {
    const home = housedBy(b.def);
    if (home) { if (Number.isFinite(home.slots)) row(home.id).beds += home.slots; continue; }
    const k = workplaceKind(b.def);
    if (k) row(k).desks += DESKS[b.def] ?? 0;
  }
  return [...out.values()];
}
