/**
 * World v2 — where a structure may stand, and the command that puts it there.
 *
 * Placement is a whole-FOOTPRINT question, but the build cursor tints per cell,
 * so validation reports both: a verdict for every cell and one summary. The two
 * cannot be collapsed — "the ground is uneven" is true of the footprint and of
 * no single cell in it.
 *
 * Placing is ONE command. Auto-flatten, stamping the footprint and creating the
 * record all travel together, so a single undo reverses the lot; a player who
 * flattened a hillside by placing a building would otherwise have to undo twice
 * to get their hill back.
 */
import { PatchBuilder, type Command } from "../edit/commands";
import type { CellVerdict } from "../edit/cursor";
import {
  VOID, footprintCells, idx, inBounds, structureAt, type Grid, type Structure,
} from "../grid";
import { RAMP } from "../iso";
import { NEIGHBOUR } from "../../iso/dir";
import { SHIP_CLASSES } from "../boats/classes";
import { riverAt, riverWithin, type RiverMap } from "../boats/river";
import {
  FACINGS, PORT_DEPTH, QUAY_MAX_DROP, alongX, bestFacing, portShape, quayLength, quayLevel, quayRiver, quayTiles, steadyRivers,
  type Facing, type Rect,
} from "../boats/quay";
import { placementOf, structureDef, type StructureDef } from "./def";
import { LATERAL_REACH, hasSewer, solveSewers } from "../sewers/solve";
import { portTiles } from "../water/ports";

/** Where a structure stroke places: the head cell, with the definition's footprint. */
export function strokeFootprint(
  def: StructureDef | null,
  _anchor: { x: number; y: number },
  head: { x: number; y: number },
): { x: number; y: number; w: number; h: number } {
  if (!def) return { x: head.x, y: head.y, w: 1, h: 1 };
  return { x: head.x, y: head.y, w: def.footprint.w, h: def.footprint.h };
}

export type PlacementCheck = {
  ok: boolean;
  /** One verdict per footprint cell, row-major — for the cursor's per-cell tint. */
  cells: CellVerdict[];
  /** Why the whole placement fails, or null. */
  reason: string | null;
  /** The height the footprint would be levelled to. */
  groundHeight: number;
  /**
   * The footprint judged, which is where it would stand. A seaport's turns to
   * face the water, so it is not always the definition's. @see validatePort
   */
  at: Rect;
  /** A seaport's: the side its quay would be on. */
  facing?: Facing;
  /** Every reason it fails, not only the first; empty when it may stand. */
  reasons: string[];
};

const OK: CellVerdict = { ok: true };

/**
 * Rules the GAME imposes on top of structural legality.
 *
 * `validatePlacement` answers whether a placement is possible at all — on the
 * map, on ground, not already occupied. Those are facts about the data and the
 * editor must obey them too. Whether a building needs a street in front of it
 * is a rule of PLAY, and the editor has to stay able to author a map with a
 * building anywhere it likes — a fixture dropping one on bare ground should not
 * have to lay a road first.
 *
 * So it arrives here, per call, from whoever is enforcing the game.
 */
export type PlaceRules = {
  /**
   * The footprint must touch paving. Orthogonally — a corner is not frontage.
   *
   * This is what makes the opening a choice rather than a click: the map starts
   * with one road across it, so where you build is where the road is.
   */
  needsRoad?: boolean;
  /**
   * The map's rivers as they stand, for a building that must be on a bank.
   * The water is live state and placement is a question about the grid, so
   * whoever has the water hands this in; without it no bank can be found.
   * @see Placement.riverside
   */
  rivers?: RiverMap;
  /** Whether a cell may be built on: the AI keeps its plans to a block, and off the water's edge. @see planTown */
  owned?: (x: number, y: number) => boolean;
  /**
   * A building that makes slop needs a live sewer manhole — on a network
   * with an exit — within a lateral's reach of its slop port. A rule of play,
   * once slop is made; an upgrade keeps its place. @see plans/underground-sewers.md §5
   */
  needsSewer?: boolean;
};

/** Whether a building of `def` set down at (x, y) would have a live sewer manhole within reach of its slop port. True for one that makes no slop. */
export function sewerInReach(grid: Grid, def: StructureDef, x: number, y: number): boolean {
  const ports = portTiles(grid, def.id, x, y, def.footprint.w, def.footprint.h).filter((p) => p.port.fluid === "slop" && p.port.dir === "out");
  if (!ports.length) return true;
  const s = solveSewers(grid);
  for (const net of s.nets) {
    if (!net.exits.length) continue;
    for (const n of net.nodes) {
      const nx = n % grid.w, ny = (n / grid.w) | 0;
      if (ports.some((p) => Math.abs(p.x - nx) + Math.abs(p.y - ny) <= LATERAL_REACH)) return true;
    }
  }
  return false;
}

const NO_RULES: PlaceRules = {};

/** Per-cell rules. Everything here is decidable without looking at the others. */
function cellVerdict(
  grid: Grid, def: StructureDef, x: number, y: number, rules: PlaceRules,
): CellVerdict {
  if (!inBounds(grid, x, y)) return { ok: false, reason: "off map" };
  const i = idx(grid, x, y);
  if (grid.terrain[i] === VOID) return { ok: false, reason: "no ground" };
  if (rules.owned && !rules.owned(x, y)) return { ok: false, reason: "out of bounds" };
  if (structureAt(grid, x, y) >= 0) return { ok: false, reason: "occupied" };
  // A sewer's land is kept: nothing is built over a trunk. @see plans/underground-sewers.md §1
  if (hasSewer(grid, i)) return { ok: false, reason: "over a sewer" };
  if (!placementOf(def).allowOnPaved && grid.paved[i] !== VOID) {
    return { ok: false, reason: "on a road" };
  }
  if (placementOf(def).riverside && rules.rivers && riverAt(rules.rivers, x, y)) {
    return { ok: false, reason: "in the river" };
  }
  return OK;
}

/**
 * Whether a cell orthogonally touches paving.
 *
 * Its own four-neighbour test rather than `cellsAdjacentToNet`, which answers
 * the inverse question by walking the whole map to list every cell beside a
 * given component. Placement asks about ONE cell and asks it per footprint cell
 * per pointer move, so it wants the cheap direction.
 *
 * Any paving, not a particular network: "does this house front a street" is a
 * question about the street outside it, not about where that street goes. When
 * reachability starts to matter, the component is what to ask. @see Network
 */
export function touchesRoad(grid: Grid, x: number, y: number): boolean {
  return (
    (inBounds(grid, x + 1, y) && grid.paved[idx(grid, x + 1, y)] !== VOID)
    || (inBounds(grid, x - 1, y) && grid.paved[idx(grid, x - 1, y)] !== VOID)
    || (inBounds(grid, x, y + 1) && grid.paved[idx(grid, x, y + 1)] !== VOID)
    || (inBounds(grid, x, y - 1) && grid.paved[idx(grid, x, y - 1)] !== VOID)
  );
}

/**
 * The height a footprint levels to: the LOWER median of its cells.
 *
 * Median rather than mean so the result is a height the ground actually has —
 * a mean lands between steps and would need rounding, which is the same choice
 * made less honestly. Lower median on an even count, so the rule is total and
 * two runs on the same ground never differ.
 */
export function medianHeight(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
}

export function validatePlacement(
  grid: Grid,
  def: StructureDef,
  ox: number,
  oy: number,
  rules: PlaceRules = NO_RULES,
  facing?: Facing,
): PlacementCheck {
  if (placementOf(def).riverside) return validatePort(grid, def, ox, oy, rules, facing);
  const { w, h } = def.footprint;
  const at = { x: ox, y: oy, w, h };
  const cells = footprintCells(ox, oy, w, h);
  const verdicts = cells.map((c) => cellVerdict(grid, def, c.x, c.y, rules));

  const heights = cells
    .filter((c) => inBounds(grid, c.x, c.y))
    .map((c) => grid.height[idx(grid, c.x, c.y)]);
  const groundHeight = medianHeight(heights);
  /** Refused as a whole: every cell says why. */
  const whole = (reason: string): PlacementCheck =>
    ({ ok: false, cells: verdicts.map(() => ({ ok: false, reason })), reason, reasons: [reason], groundHeight, at });

  const firstBad = verdicts.find((v) => !v.ok);
  if (firstBad) {
    const reason = firstBad.reason ?? "blocked";
    return { ok: false, cells: verdicts, reason, reasons: [reason], groundHeight, at };
  }

  // BESIDE a road, which is not the same as ON one — and both rules apply, so
  // a building wants cells that are bare themselves, and frontage.
  //
  // FRONTAGE IS THE FOOTPRINT'S, not every cell's: a door on one side is
  // a door.
  if (rules.needsRoad && !placementOf(def).noFrontage && !cells.some((c) => inBounds(grid, c.x, c.y) && touchesRoad(grid, c.x, c.y))) {
    return whole("no road access");
  }

  // A SEWER IN REACH, for what makes slop. @see sewerInReach
  if (rules.needsSewer && !sewerInReach(grid, def, ox, oy)) return whole("No sewer node in reach");

  // NEAR A RIVER, likewise: some river tile within reach of the footprint.
  const near = placementOf(def).nearRiver;
  if (near !== undefined && !(rules.rivers && riverWithin(rules.rivers, ox, oy, w, h, near))) return whole("too far from a river");

  // BESIDE STANDING WATER, likewise: a footprint cell's neighbour is pool.
  if (placementOf(def).waterside && !waterBeside(grid, ox, oy, w, h)) return whole("not beside water");

  // Uneven ground is a property of the FOOTPRINT, so it can only be judged
  // here — and only matters when nothing is going to level it.
  if (!placementOf(def).autoFlatten && new Set(heights).size > 1) return whole("uneven ground");
  return { ok: true, cells: verdicts, reason: null, reasons: [], groundHeight, at };
}

/**
 * Whether a SEAPORT may stand with its footprint's corner at (ox, oy): a
 * length of quay along the bank, facing the water, two tiles deep.
 *
 * IT TURNS TO FACE THE WATER. With no facing asked for, each side is tried —
 * the camera's first — and the first that may stand is the answer; failing
 * all, the one with the most of its quay on the water, so what is said to be
 * wrong is what is nearest to right.
 *
 * AGAINST THE STANDING WATER, whatever rivers the rules carry: a flood or a
 * drought does not move the bank, and the cursor and the click cannot be
 * handed different rivers. @see steadyRivers
 */
function validatePort(grid: Grid, def: StructureDef, ox: number, oy: number, rules: PlaceRules, facing?: Facing): PlacementCheck {
  let best: PlacementCheck | null = null, bestWet = -1;
  const rivers = steadyRivers(grid);
  for (const f of facing ? [facing] : FACINGS) {
    const at = { x: ox, y: oy, ...portShape(def.footprint.w, f) };
    const check = portCheck(grid, def, at, f, rules);
    if (check.ok) return check;
    const wet = quayTiles(at, f).filter((q) => riverAt(rivers, q.wx, q.wy)).length - check.reasons.length / 16;
    if (wet > bestWet) { best = check; bestWet = wet; }
  }
  return best!;
}

/**
 * A port's footprint judged with its quay on side `f`. Every reason it
 * fails is given, and the cells that are the trouble say so themselves:
 *  - EVERY TILE OF QUAY has the one river beside it, so it has its berths;
 *  - BUILT AT THE WATER: levelled to a half step over it, and refused on a
 *    bank that stands too far above — but not `standing`, for one being
 *    grown, which is at the height it is;
 *  - THE GATE IS LANDWARD: the road it needs is behind it, across from the quay.
 */
function portCheck(grid: Grid, def: StructureDef, at: Rect, f: Facing, rules: PlaceRules, standing = false): PlacementCheck {
  const rivers = steadyRivers(grid);
  const cells = footprintCells(at.x, at.y, at.w, at.h);
  const verdicts = cells.map((c) => cellVerdict(grid, def, c.x, c.y, { ...rules, rivers }));
  const quay = quayTiles(at, f);
  const river = quayRiver(rivers, quay);
  for (const q of quay) {
    const k = (q.y - at.y) * at.w + (q.x - at.x);
    if (verdicts[k].ok && !(river && riverAt(rivers, q.wx, q.wy) === river)) verdicts[k] = { ok: false, reason: "quay off the water" };
  }
  const reasons = [...new Set(verdicts.filter((v) => !v.ok).map((v) => v.reason ?? "blocked"))];

  const heights = cells.filter((c) => inBounds(grid, c.x, c.y)).map((c) => grid.height[idx(grid, c.x, c.y)]);
  const level = quayLevel(grid, quay);
  const groundHeight = level ?? medianHeight(heights);
  const whole: string[] = [];
  if (!standing && level !== null && medianHeight(heights) - level > QUAY_MAX_DROP) whole.push("too high above the water");
  if (rules.needsRoad && !quay.some((q) => inBounds(grid, q.bx, q.by) && grid.paved[idx(grid, q.bx, q.by)] !== VOID)) whole.push("no road at the gate");
  // What is wrong with the whole of it is said by every cell that had nothing of its own to say.
  if (whole.length) for (let k = 0; k < verdicts.length; k++) if (verdicts[k].ok) verdicts[k] = { ok: false, reason: whole[0] };
  reasons.push(...whole);
  return { ok: !reasons.length, cells: verdicts, reason: reasons[0] ?? null, reasons, groundHeight, at, facing: f };
}

/**
 * The command that places one structure, or null if it may not stand there.
 *
 * The id comes from `grid.nextStructureId` but the grid is NOT advanced here —
 * applying the command does that, which is what lets redo restore the record
 * under its original id. Two commands built before either is committed would
 * therefore collide; build one, commit it, build the next.
 */
export function placeCommand(
  grid: Grid,
  def: StructureDef,
  ox: number,
  oy: number,
  rules: PlaceRules = NO_RULES,
  facing?: Facing,
): Command | null {
  const check = validatePlacement(grid, def, ox, oy, rules, facing);
  if (!check.ok) return null;

  // Where the check says, which for a seaport has turned to face the water.
  const { w, h } = check.at;
  const b = new PatchBuilder(grid);
  const structure: Structure = { id: grid.nextStructureId, def: def.id, x: ox, y: oy, w, h, ...(check.facing ? { facing: check.facing } : {}) };

  for (const c of footprintCells(ox, oy, w, h)) {
    if (placementOf(def).autoFlatten) {
      b.set("height", c.x, c.y, check.groundHeight);
      // A ramp under a structure is a contradiction: the cell is flat now.
      b.set("ramp", c.x, c.y, RAMP.NONE);
    }
    b.set("structureAt", c.x, c.y, structure.id);
  }
  b.addStructure(structure);
  return b.build(`place ${def.name}`);
}

/**
 * The command that removes one structure.
 *
 * It writes only `structureAt`. `clearsTerrain` never erased the material — the
 * renderer skips those cells while something stands on them — so the ground
 * reappears the moment the footprint is freed, with nothing to restore. Had the
 * placement zeroed the layer instead, demolishing would have had to remember
 * what used to be there, and a map edited and reloaded in between would not.
 *
 * Note this does NOT undo the levelling: flattening a hill to build on it is a
 * change to the GROUND, and knocking the building down does not put the hill
 * back. Undo does, because undo reverses the whole command.
 */
export function demolishCommand(grid: Grid, id: number): Command | null {
  const s = grid.structures.get(id);
  if (!s) return null;
  const b = new PatchBuilder(grid);
  for (const c of footprintCells(s.x, s.y, s.w, s.h)) {
    if (structureAt(grid, c.x, c.y) === id) b.set("structureAt", c.x, c.y, -1);
  }
  b.removeStructure(s);
  return b.build(`demolish ${s.def}`);
}

/**
 * Growing a structure into its next tier, in place: where it would stand and
 * whether it may. Null when there is nothing to upgrade it to.
 *
 * IT GROWS OUT OF ITSELF. The new footprint keeps the old one's row and takes
 * a column more on the east, or failing that on the west — the old footprint
 * judged as if empty, since the building on it is the one growing. The rest is
 * the ordinary placement check, rules and all, so a bigger seaport must still
 * stand on the bank. @see validatePlacement
 */
export type UpgradePlan = PlacementCheck & {
  from: Structure;
  to: StructureDef;
  x: number;
  y: number;
};

export function planUpgrade(
  grid: Grid, id: number, rules: PlaceRules = NO_RULES, into?: StructureDef,
): UpgradePlan | null {
  const from = grid.structures.get(id);
  const to = from && (into ?? structureDef(structureDef(from.def)?.upgradesTo ?? ""));
  // GROWN, a building keeps its place: it needs no sewer it didn't. @see needsSewer
  rules = { ...rules, needsSewer: false };
  if (!from || !to) return null;
  const grow = Math.max(0, to.footprint.w - from.w), growV = Math.max(0, to.footprint.h - from.h);
  const old = footprintCells(from.x, from.y, from.w, from.h).filter((c) => inBounds(grid, c.x, c.y));
  // Judged as if the old footprint were empty, and put back exactly after.
  const held = old.map((c) => grid.structureAt[idx(grid, c.x, c.y)]);
  for (const c of old) grid.structureAt[idx(grid, c.x, c.y)] = -1;
  let first: UpgradePlan | null = null;
  try {
    if (placementOf(to).riverside) return planQuay(grid, from, to, rules);
    // Where it stands first, then grown out back or left. A landmark from an
    // older save grows out of a smaller first tier. @see tierBelow
    const at: [number, number][] = [];
    for (let dy = 0; dy <= growV; dy++) for (const dx of grow ? [0, grow, ...Array.from({ length: grow - 1 }, (_, k) => k + 1)] : [0]) at.push([from.x - dx, from.y - dy]);
    for (const [x, y] of at) {
      const check = validatePlacement(grid, to, x, y, rules);
      const plan = { ...check, from, to, x, y };
      if (check.ok) return plan;
      first ??= plan;
    }
  } finally {
    old.forEach((c, k) => { grid.structureAt[idx(grid, c.x, c.y)] = held[k]; });
  }
  return first;
}

/**
 * EVERY BANK A SEAPORT OF THIS TIER COULD GO ON: the tiles that would be quay
 * in some placement that may stand, as cell indices. The road it needs is not
 * asked — a bank is a fact about the water, and the road can be laid to it.
 * Each with the biggest class of ship that could come alongside it there,
 * by number. For lighting them while a port is in hand. @see validatePort
 */
export function quayBanks(grid: Grid, def: StructureDef, rules: PlaceRules = NO_RULES): { i: number; cls: number }[] {
  const rivers = steadyRivers(grid), lit = new Map<number, number>();
  // The biggest ship a port of this size takes. @see SHIP_CLASSES
  let top = 0;
  for (let k = 0; k < SHIP_CLASSES.length; k++) if (SHIP_CLASSES[k].tier <= (def.port?.berths ?? 1)) top = k;
  const bare = { ...rules, needsRoad: false, needsSewer: false };
  const length = def.footprint.w;
  for (let y = 0; y < grid.h; y++) {
    for (let x = 0; x < grid.w; x++) {
      if (riverAt(rivers, x, y)) continue;
      for (const f of FACINGS) {
        const [dx, dy] = NEIGHBOUR[f];
        if (!riverAt(rivers, x + dx, y + dy)) continue;
        // Every port whose quay on this side has this tile in it.
        for (let k = 0; k < length; k++) {
          const at = alongX(f)
            ? { x: x - k, y: dy > 0 ? y - (PORT_DEPTH - 1) : y, ...portShape(length, f) }
            : { x: dx > 0 ? x - (PORT_DEPTH - 1) : x, y: y - k, ...portShape(length, f) };
          if (!portCheck(grid, def, at, f, bare).ok) continue;
          // By the biggest ship that can come alongside that tile of it.
          for (const q of quayTiles(at, f)) {
            const i = idx(grid, q.x, q.y);
            const cls = Math.min(top, rivers.reach[idx(grid, q.wx, q.wy)] - 1);
            lit.set(i, Math.max(lit.get(i) ?? 0, cls));
          }
        }
      }
    }
  }
  return [...lit].map(([i, cls]) => ({ i, cls }));
}

/**
 * A SEAPORT GROWS ALONG ITS QUAY: the same side to the water, the same two
 * tiles deep, and longer at one end or the other — every new tile of quay on
 * the water like the old. One whose quay is not its long side, from before
 * ports faced the water, has no quay to lengthen. @see validatePort
 */
function planQuay(grid: Grid, from: Structure, to: StructureDef, rules: PlaceRules): UpgradePlan {
  const f = from.facing ?? bestFacing(steadyRivers(grid), from);
  const grow = to.footprint.w - quayLength(from, f);
  const deep = (alongX(f) ? from.h : from.w) === PORT_DEPTH;
  if (grow < 0 || !deep) {
    const check = portCheck(grid, to, from, f, rules, true);
    const reason = "quay off the water";
    return { ...check, ok: false, cells: check.cells.map(() => ({ ok: false, reason })), reason, reasons: [reason], from, to, x: from.x, y: from.y };
  }
  let first: UpgradePlan | null = null;
  for (const k of grow ? [0, grow, ...Array.from({ length: grow - 1 }, (_, j) => j + 1)] : [0]) {
    const x = from.x - (alongX(f) ? k : 0), y = from.y - (alongX(f) ? 0 : k);
    const check = portCheck(grid, to, { x, y, ...portShape(to.footprint.w, f) }, f, rules, true);
    const plan = { ...check, from, to, x, y };
    if (check.ok) return plan;
    first ??= plan;
  }
  return first!;
}

/**
 * The command that upgrades one structure in place, or null if it cannot be.
 *
 * ONE COMMAND, like placing: the record swapped for the next tier's under the
 * SAME ID — so anything bound for it, a boat on its way to a port, is still
 * bound for it — the new cells stamped, and the ground under them levelled to
 * the height the building already stands at, so it does not step.
 */
export function upgradeCommand(grid: Grid, id: number, rules: PlaceRules = NO_RULES, into?: StructureDef): Command | null {
  const plan = planUpgrade(grid, id, rules, into);
  if (!plan?.ok) return null;
  const { from, to } = plan;
  const b = new PatchBuilder(grid);
  const ground = grid.height[idx(grid, from.x, from.y)];
  const next: Structure = { ...from, def: to.id, ...plan.at, ...(plan.facing ? { facing: plan.facing } : {}) };
  for (const c of footprintCells(next.x, next.y, next.w, next.h)) {
    b.set("height", c.x, c.y, ground);
    b.set("ramp", c.x, c.y, RAMP.NONE);
    b.set("structureAt", c.x, c.y, id);
  }
  b.removeStructure(from);
  b.addStructure(next);
  return b.build(`upgrade ${from.def} to ${to.name}`);
}

/** Whether standing water lies beside a footprint, on any side. @see Placement.waterside */
export function waterBeside(grid: Grid, ox: number, oy: number, w: number, h: number): boolean {
  for (let y = oy - 1; y <= oy + h; y++) {
    for (let x = ox - 1; x <= ox + w; x++) {
      const inside = x >= ox && x < ox + w && y >= oy && y < oy + h;
      const corner = (x === ox - 1 || x === ox + w) && (y === oy - 1 || y === oy + h);
      if (inside || corner || !inBounds(grid, x, y)) continue;
      if (grid.pool[idx(grid, x, y)]) return true;
    }
  }
  return false;
}
