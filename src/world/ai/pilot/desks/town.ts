/**
 * World v2 — THE PILOT'S TOWN DESK: somewhere for people to live and
 * somewhere for them to work.
 *
 *  - A LOT for a kind whose beds are nearly all taken, on the most desirable
 *    frontage there is. It is the job a hire waits on (`beds:<kind>`).
 *  - AN OFFICE for a kind short of desks: people perched with none earn a
 *    third of what they would at one.
 *  - THE NEXT PIECE OF STREET of the block in hand (`street`) — or what must
 *    come first for it, ground levelled or a house cleared. A lot or an
 *    office with no frontage waits on it, so a street is laid when something
 *    needs it, and is worth what that is worth.
 *
 * The streets are planned a block at a time by the planner kept from the old
 * autopilot (`chooseNext`); the order things are built in is the chooser's.
 * What is costly to work out — every spot a building could stand — is worked
 * out again only when the map changes. @see lotStep, officeStep, streetStep
 */
import { buildCost, roadCost } from "../../../../game/build-cost";
import { fusedInto } from "../../../../game/fusion";
import { hasLots, housedBy, roomFor } from "../../../../game/housing";
import { useFounderStore } from "../../../../state/founder.store";
import { useGeneratorStore, type GeneratorId } from "../../../../state/generators.store";
import { playRules, useWorldStore } from "../../../../state/world.store";
import { DESKLESS, DESKS, WORKPLACES } from "../../../agents/commute";
import { idx, type Grid } from "../../../grid";
import { demolishAt, liftRoad, paveRoad, placeStructure, reshape } from "../../../play/build-actions";
import { isPaved } from "../../../roads/mask";
import { structureDef } from "../../../structures/def";
import { validatePlacement } from "../../../structures/place";
import { chooseNext } from "../../masterplan/choose";
import type { Prices } from "../../masterplan/lookahead";
import { townCentre, type Box, type Masterplan, type PlanStep } from "../../masterplan/plan";
import { desksShort, liftStep, lotStep, officeStep, roadTiles, streetStep, type Wants } from "../../masterplan/schedule";
import { PLAIN, styleOf, type Style } from "../../masterplan/style";
import type { Job, Need, Outcome } from "../job";
import type { Desk } from "../pilot";
import { lateralGround } from "../../../sewers/reach";
import { portTileSet, portTiles } from "../../../water/ports";
import { inYard } from "./landmarks";
import { sewerAsks } from "./water";

/** Looks between two tries at planning a block when the last found nowhere to grow: planning is the dearest thing it does. */
const PLAN_AGAIN = 40;
/**
 * Looks between two workings-out of where things could stand, at the least.
 * The map's revision moves with every house that grows and every load
 * delivered, and each working-out walks the whole map: a town of three
 * hundred had it walked twice a second, and the game crawled.
 */
const LOOK_AGAIN = 6;
/** Spots looked at for an office before giving up for this look. */
const SPOTS_TRIED = 6;
/** What a lot's beds are taken to be worth, against a hire into each: they have still to be hired into. */
const BED_WORTH = 0.5;
/** What desks nobody is short of yet are worth, against desks for people perched now. */
const AHEAD_WORTH = 0.25;

const STREET: Need = { id: "street", says: "a street with room beside it" };
/** What a building that makes slop waits on where there is ground for it and no sewer by it: the Water desk's to lay. */
const sewerFor = (who: GeneratorId): Need => ({ id: `sewer:${who}`, says: "a sewer to take its slop" });
const NO_ROOM: Need = { id: "room", says: "room to grow, and none is left on this map" };

type Build = Extract<PlanStep, { kind: "build" }>;

/** A step of the plan's, in words. */
const named = (s: PlanStep): string =>
  s.kind === "road" ? "Lay a piece of street"
    : s.kind === "level" ? "Level the ground for a street"
      : s.kind === "lift" ? "Lift a spur that goes nowhere"
        : s.kind === "clear" ? "Clear a house from a street's way"
          : s.def;

const whereOf = (s: PlanStep) => (s.kind === "road" || s.kind === "level" ? s.to : s.at);

/** Take a step through the player's own actions, and look: one that changed nothing on the map is a refusal. */
function take(g: Grid, s: PlanStep): Outcome {
  const before = g.rev, built = g.structures.size;
  const ok = s.kind === "road" ? paveRoad(s.from, s.to)
    : s.kind === "level" ? reshape("flatten", s.from, s.to)
      : s.kind === "lift" ? liftRoad(s.at, s.at)
        : s.kind === "clear" ? demolishAt(s.at)
          : placeStructure(s.def, s.at);
  if (ok && (g.rev !== before || g.structures.size !== built)) return { ok: true };
  // Why, in the game's own words where it has them.
  if (s.kind === "build") {
    const d = structureDef(s.def);
    const check = d && validatePlacement(g, d, s.at.x, s.at.y, playRules(g));
    if (check && !check.ok && check.reason) return { ok: false, because: check.reason.toLowerCase(), retry: "on-change" };
    if ((buildCost(s.def)?.toNumber() ?? 0) > 0) return { ok: false, because: "not enough money", retry: 5 };
  }
  return { ok: false, because: "the ground would not take it", retry: "on-change" };
}

const priceOf = (g: Grid, s: PlanStep): number =>
  s.kind === "road" ? roadCost(roadTiles(g, s)).toNumber() : s.kind === "build" ? buildCost(s.def)?.toNumber() ?? 0 : 0;

/** What the buildings a block plan might put up cost now, and road by the tile: for the planner's look ahead. */
function pricesNow(kinds: GeneratorId[]): Prices {
  const defs: Record<string, number> = {};
  for (const def of [...kinds.map((k) => `kit:${k}.t0`), ...kinds.flatMap((k) => WORKPLACES[k] ?? [])]) {
    const c = buildCost(def);
    if (c) defs[def] = c.toNumber();
  }
  return { defs, road: roadCost(1).toNumber() };
}

/** How it lays a town out: the Model's by the traits fused into it; anyone else's plainly. */
export const townStyle = (): Style => (useFounderStore.getState().selectedFounderId === "model" ? styleOf(fusedInto("model")) : PLAIN);

export function townDesk(): Desk {
  let plan: Masterplan | null = null, box: Box | null = null;
  /** Street tiles of blocks left with pieces that could not be laid: not planned again. */
  const tried = new Set<number>();
  /** Looks since a block was asked for and none found; and since where things could stand was last worked out. */
  let sinceNone = PLAN_AGAIN, sinceFresh = LOOK_AGAIN;
  /** What is costly, kept for the map as it stands. */
  let seen: { grid: Grid; rev: number; kinds: string } | null = null;
  const lots = new Map<GeneratorId, Build | null>(), offices = new Map<GeneratorId, Build | null>();
  /** Where a kind's office would stand but for a sewer: there is ground, so no street would help. */
  const unsewered = new Map<GeneratorId, Build | null>();
  let street: PlanStep | null = null, lift: PlanStep | null = null;

  /**
   * WHAT WAS REFUSED, so the next is offered: pieces of this block's street, and
   * tiles a building would not stand on. Offered the same piece again each time
   * the map changed, it was refused each time, and the people waiting on that
   * street's frontage for an office waited for good.
   */
  const skipped = new Set<string>(), bad = new Set<number>();
  // And a piece with no tile left to lay that is still not laid — all that is left of it is water — is never tried at all.
  const skip = (s: PlanStep) => skipped.has(JSON.stringify(s)) || (s.kind === "road" && roadTiles(useWorldStore.getState().grid, s) === 0);
  /**
   * Tiles the block in hand means for its offices and its streets: no lot goes
   * on them. Zoned on the best frontage anywhere, lots took the offices' sites,
   * and stood across the lines the block's streets were to run on — every
   * piece blocked, the block dropped, and after a few the town had "no room
   * to grow" with one street on the map.
   */
  let kept = new Set<number>();
  const keep = (g: Grid) => {
    kept = new Set();
    for (const s of plan?.steps ?? []) {
      if (s.kind === "road") {
        for (let y = Math.min(s.from.y, s.to.y); y <= Math.max(s.from.y, s.to.y); y++) for (let x = Math.min(s.from.x, s.to.x); x <= Math.max(s.from.x, s.to.x); x++) kept.add(idx(g, x, y));
        continue;
      }
      const d = s.kind === "build" && !housedBy(s.def) ? structureDef(s.def) : null;
      if (!d || s.kind !== "build") continue;
      for (let y = 0; y < d.footprint.h; y++) for (let x = 0; x < d.footprint.w; x++) kept.add(idx(g, s.at.x + x, s.at.y + y));
    }
  };
  /**
   * A spot for an office WHOSE SLOP CAN BE TAKEN AWAY: its slop port on open
   * ground, where a connection can be laid. One fronting the street with its
   * port on the road can never be sewered — a connection lies on empty plots
   * only — and the two built so before there was slop spilled on the street
   * from the fiftieth vibe coder to the end of the run. Looked for a few
   * times, each spot that fails struck off.
   */
  const drained = (g: Grid, find: () => Build | null): Build | null => {
    for (let k = 0; k < SPOTS_TRIED; k++) {
      const b = find(), d = b && structureDef(b.def);
      if (!b || !d) return null;
      const out = portTiles(g, b.def, b.at.x, b.at.y, d.footprint.w, d.footprint.h).filter((p) => p.port.fluid === "slop" && p.port.dir === "out");
      if (out.every((p) => lateralGround(g, idx(g, p.x, p.y)))) return b;
      bad.add(idx(g, b.at.x, b.at.y));
    }
    return null;
  };
  let stale = false;
  /** Take a step; refused, it is not offered again, and where things could stand is worked out afresh. */
  const attempt = (g: Grid, s: PlanStep): Outcome => {
    // LOOKED AT AGAIN as it is built: the spot was chosen a few looks ago, and a lot zoned since may stand where its slop comes out.
    if (s.kind === "build") {
      const d = structureDef(s.def);
      const out = d ? portTiles(g, s.def, s.at.x, s.at.y, d.footprint.w, d.footprint.h).filter((p) => p.port.fluid === "slop" && p.port.dir === "out") : [];
      if (!out.every((p) => lateralGround(g, idx(g, p.x, p.y)))) {
        bad.add(idx(g, s.at.x, s.at.y));
        stale = true; forget();
        return { ok: false, because: "its slop would have nowhere to come out", retry: 3 };
      }
    }
    const out = take(g, s);
    // DONE OR NOT, what was offered is spent: kept till the next walk of the map, the lot just zoned was offered again and
    // refused as occupied, and the piece just laid as nothing to lay.
    stale = true;
    if (!out.ok && out.because !== "not enough money") {
      if (s.kind === "build") bad.add(idx(g, s.at.x, s.at.y)); else skipped.add(JSON.stringify(s));
      stale = true;
      // Routed round here: the job may be offered again at once, as the next piece or the next spot.
      return { ...out, retry: 3 };
    }
    return out;
  };

  const forget = () => { lots.clear(); offices.clear(); unsewered.clear(); street = null; lift = null; };

  const propose = (): Job[] => {
    const g = useWorldStore.getState().grid;
    const gens = useGeneratorStore.getState();
    const kinds = gens.generators.map((x) => x.id as GeneratorId).filter(hasLots);
    if (!kinds.length) return [];
    const style = townStyle();
    const rules = playRules(g);
    // EVERY PORT KEPT CLEAR: a house on the tile an office's slop comes out at, and it spills for good. @see portTileSet
    const ports = portTileSet(g);
    const wants: Wants = { rules: { ...rules, owned: (x, y) => (rules.owned?.(x, y) ?? true) && !bad.has(idx(g, x, y)) && !inYard(g, x, y) && !ports.has(idx(g, x, y)) }, kinds, offices: true, style };
    const forLots: Wants = { ...wants, rules: { ...wants.rules, owned: (x, y) => (wants.rules.owned?.(x, y) ?? true) && !kept.has(idx(g, x, y)) } };
    const key = kinds.join();
    sinceFresh++; sinceNone++;
    const moved = !seen || seen.grid !== g || seen.kinds !== key;
    const fresh = moved || stale || (seen!.rev !== g.rev && sinceFresh >= LOOK_AGAIN);
    if (fresh) {
      sinceFresh = 0; stale = false;
      if (seen && seen.grid !== g) { plan = null; box = null; tried.clear(); skipped.clear(); bad.clear(); sinceNone = PLAN_AGAIN; }
      seen = { grid: g, rev: g.rev, kinds: key };
      forget();
      // THE BLOCK IN HAND, and the next when it has no piece left to lay.
      street = plan ? streetStep(g, plan, skip) : null;
      if (plan && !street) {
        // LEFT WITH PIECES IT COULD NOT LAY: its streets are not planned from again.
        const left = plan.steps.some((s) => s.kind === "road" && roadTiles(g, s) > 0);
        if (left && box) for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) if (isPaved(g, x, y)) tried.add(idx(g, x, y));
        plan = null; box = null; skipped.clear();
      }
      lift = plan ? liftStep(g, plan, skip) : null;
      keep(g);
    }
    if (!plan && sinceNone >= PLAN_AGAIN) {
      const chosen = chooseNext(g, townCentre(g, style), [...tried], kinds, true, style, pricesNow(kinds));
      plan = chosen?.plan ?? null; box = chosen?.box ?? null;
      sinceNone = plan ? PLAN_AGAIN : 0;
      street = plan ? streetStep(g, plan, skip) : null;
      lift = plan ? liftStep(g, plan, skip) : null;
      // A block with nothing to lay is as good as none: the next look tries again from the streets it has not tried.
      if (plan && !street) {
        if (box) for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) if (isPaved(g, x, y)) tried.add(idx(g, x, y));
        plan = null; box = null; sinceNone = 0;
      }
      keep(g);
      forget();
      street = plan ? streetStep(g, plan, skip) : null;
      lift = plan ? liftStep(g, plan, skip) : null;
    }

    const jobs: Job[] = [];
    const wait: Need[] = [street ? STREET : NO_ROOM];
    const earns = (who: GeneratorId) => gens.getGeneratorMoneyPerSecond(who, 1);
    const name = (who: GeneratorId) => gens.generators.find((x) => x.id === who)?.name ?? who;

    // A LOT, for each kind whose beds are nearly all taken.
    for (const who of kinds) {
      const def = `kit:${who}.t0`, beds = housedBy(def)?.slots ?? 0;
      const amount = gens.generators.find((x) => x.id === who)?.amount ?? 0;
      const room = Math.floor(roomFor(who, amount));
      if (!(beds > 0) || room >= beds) continue;
      if (!lots.has(who)) lots.set(who, lotStep(g, forLots, who));
      const at = lots.get(who) ?? null;
      jobs.push({
        id: `beds:${who}`, desk: "town",
        says: `Zone a lot for ${name(who)}s`, why: room > 0 ? `only ${room} ${room === 1 ? "bed" : "beds"} left` : "every bed is taken",
        at: at?.at, cost: buildCost(def)?.toNumber() ?? 0, gain: beds * earns(who) * BED_WORTH,
        needs: at ? undefined : wait,
        run: () => (at ? attempt(g, at) : { ok: false, because: "no frontage", retry: "on-change" }),
      });
    }

    // AN OFFICE, for each kind short of desks.
    sewerAsks.clear();
    for (const short of desksShort(g, wants)) {
      const who = short.who;
      if (!offices.has(who)) offices.set(who, drained(g, () => officeStep(g, plan, wants, who)));
      const at = offices.get(who) ?? null;
      // NOWHERE FOR IT: for want of a sewer, where the rules ask one and it would stand without — else for want of frontage.
      // Said to be waiting on a street, a vibe coders' office had street after street laid for it in vain.
      if (!at && wants.rules.needsSewer && !unsewered.has(who)) unsewered.set(who, drained(g, () => officeStep(g, plan, { ...wants, rules: { ...wants.rules, needsSewer: false } }, who)));
      const dry = at ? null : unsewered.get(who) ?? null;
      // WHERE, for the desk that lays it. @see sewerAsks
      const foot = dry && structureDef(dry.def)?.footprint;
      if (dry && foot) sewerAsks.set(who, { x: dry.at.x, y: dry.at.y, w: foot.w, h: foot.h });
      const def = at?.def ?? (WORKPLACES[who] ?? []).find((d) => d.startsWith("office")) ?? "";
      const desks = DESKS[def] ?? 0;
      const perched = Math.min(desks, Math.max(0, short.now)), coming = Math.min(desks, Math.max(0, short.ahead)) - perched;
      jobs.push({
        id: `desks:${who}`, desk: "town",
        says: `An office for the ${name(who)}s`,
        why: short.now > 0 ? `${short.now} ${name(who)}${short.now === 1 ? " has" : "s have"} no desk` : "their houses will outgrow their desks",
        at: (at ?? dry)?.at, cost: buildCost(def)?.toNumber() ?? 0,
        gain: earns(who) * (1 - DESKLESS) * (perched + Math.max(0, coming) * AHEAD_WORTH),
        needs: at ? undefined : dry ? [sewerFor(who)] : wait,
        run: () => (at ? attempt(g, at) : { ok: false, because: "no frontage", retry: "on-change" }),
      });
    }

    // THE NEXT PIECE OF STREET: worth nothing itself, and what waits on it. A spur lifted is free.
    if (street) {
      const s = street;
      jobs.push({ id: "street", desk: "town", says: named(s), why: "it makes frontage to build on", at: whereOf(s), cost: priceOf(g, s), gain: 0, run: () => attempt(g, s) });
    }
    if (lift) {
      const s = lift;
      jobs.push({ id: `lift:${s.kind === "lift" ? `${s.at.x},${s.at.y}` : ""}`, desk: "town", says: named(s), why: "nothing stands beside it", at: whereOf(s), cost: 0, gain: 0, run: () => attempt(g, s) });
    }
    return jobs;
  };

  return { id: "town", propose };
}
