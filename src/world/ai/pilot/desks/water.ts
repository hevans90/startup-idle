/**
 * World v2 — THE PILOT'S WATER AND SLOP DESK: what runs under the ground.
 *
 *  - A SEWER FOR EVERY TANK. A vibe workplace with its slop port free gets a
 *    connection to a live manhole in reach, else a trunk from beside it to
 *    where slop can go; the connection follows. A tank with no sewer fills
 *    in two minutes and spills on the street.
 *  - A SEWER WHERE AN OFFICE IS TO GO. Once slop is made, what makes it may
 *    only be built by a manhole: the Town desk's office says it waits on
 *    `sewer:<kind>`, and says where it would stand (`sewerAsks`). This desk
 *    lays a trunk to there, worth what the office is.
 *  - ANOTHER REFINERY when more slop is made than those standing take.
 *  - A MAIN to water for whatever drinks and runs short.
 *
 * The routes are the kept planners': `neededSewer`, `trunkInto`,
 * `wantsRefinery`, `neededPipe`. Laid through the player's own tools.
 * @see sewer-ai, cooling-ai, plans/ai-mode-rebuild.md phase 4
 */
import { pipeCost } from "../../../../game/build-cost";
import { REFINERY_INNOVATION } from "../../../../game/processors";
import { slopMaking } from "../../../../game/slop";
import { useGeneratorStore, type GeneratorId } from "../../../../state/generators.store";
import { playRules, useWorldStore } from "../../../../state/world.store";
import { DESKS, WORKPLACES } from "../../../agents/commute";
import type { Grid } from "../../../grid";
import { laySewerPath, placeStructure, whyNot } from "../../../play/build-actions";
import { nearestSpot } from "../../../projects/works";
import { structureDef } from "../../../structures/def";
import { layRoute, neededPipe } from "../../cooling-ai";
import { NO_WAY, neededSewer, spillNeed, trunkInto, wantsRefinery, type SewerJob } from "../../sewer-ai";
import { tanksOf } from "../../../slop/tanks";
import type { Purse } from "../chooser";
import type { Job, Outcome } from "../job";
import type { Desk } from "../pilot";

/**
 * WHERE AN OFFICE WOULD STAND BUT FOR A SEWER, by kind: written by the Town
 * desk as it proposes, read here. The desks share nothing else.
 */
export const sewerAsks = new Map<GeneratorId, { x: number; y: number; w: number; h: number }>();

/** Looks between two workings-out of the routes, at the least: each solves the sewers and walks the map. @see town desk LOOK_AGAIN */
const LOOK_AGAIN = 6;
/** Looks a route that would not go down is left alone for: a minute. */
const FAIL_REST = 120;
/** How far round where an office would stand a manhole serves it, tiles: the box a trunk is laid into. */
const ASK_ROUND = 2;
/**
 * What a tank spilling is taken to cost, as a share of what the people at
 * its desks earn: sludge on the street, the houses by it fouled, cleaners
 * called out. Set to have a sewer laid well before a hire, not measured.
 */
const SPILL_WORTH = 0.25;
/** What innovation is worth against money, for a refinery; and what a building going short of water costs, as shares of income. @see landmarks OTHER_BONUS_WORTH */
const INNOVATION_WORTH = 0.3, DRY_WORTH = 0.1;

export function waterDesk(): Desk {
  /** The routes, kept for the map as it stands. */
  let seen: { grid: Grid; rev: number } | null = null, since = LOOK_AGAIN, stale = false;
  let fix: SewerJob | null = null, refinery: { price: number; at: { x: number; y: number } | null } | null = null;
  let pipe: ReturnType<typeof neededPipe> = null;
  /** The tanks spilling that no sewer of this desk's is for, and what each waits on. */
  let spills: { id: number; at: { x: number; y: number }; desks: number; on: string }[] = [];
  const asked = new Map<GeneratorId, SewerJob | null>();
  /**
   * What a tile of pipe cost when the routes were priced. A route's price is of then, and a tile's follows income: it is
   * offered at what it would cost NOW. Offered at the old price with income doubling by the minute, the chooser thought
   * it paid for and the tool refused it, five times running on one map.
   */
  let unitThen = 1;
  const now = (price: number) => price * Math.max(1, pipeCost(1).toNumber() / unitThen);
  /**
   * Routes that would not go down, by the planner's own key, and the look they failed at: left alone a while, and the
   * next offered in their place. Not for good: a route is priced when it is planned, a few seconds before it is laid,
   * and with income climbing fast the tool refuses it for want of money. Written off for ever, a town's tanks spilled
   * for twenty minutes beside a sewer nobody would lay.
   */
  const failed = new Map<string, number>();
  let looks = 0;
  const resting = (key: string) => { const at = failed.get(key); return at !== undefined && looks - at < FAIL_REST; };

  const lay = (job: SewerJob): Outcome => {
    stale = true;
    if (laySewerPath(job.cells, job.kind === "lateral")) return { ok: true };
    failed.set(job.key, looks);
    return { ok: false, because: whyNot()?.toLowerCase() ?? "the sewer would not go down", retry: 3 };
  };

  const propose = (purse: Purse): Job[] => {
    const g = useWorldStore.getState().grid;
    const gens = useGeneratorStore.getState();
    since++; looks++;
    if (!seen || seen.grid !== g) failed.clear();
    const fresh = !seen || seen.grid !== g || stale || (seen.rev !== g.rev && since >= LOOK_AGAIN) || since >= LOOK_AGAIN * 10;
    if (fresh) {
      seen = { grid: g, rev: g.rev }; since = 0; stale = false;
      unitThen = Math.max(1, pipeCost(1).toNumber());
      asked.clear();
      fix = neededSewer(g, new Set([...failed.keys()].filter(resting)));
      spills = [];
      for (const [id, t] of tanksOf(g)) {
        const s = g.structures.get(id);
        if (!t.spilling || !s || (fix && Number(fix.key.split(":")[1]) === id)) continue;
        const on = spillNeed(g, s, t.rate);
        // One with no sewer yet, and another's being laid: its own comes next.
        if (on === NO_WAY && fix) continue;
        spills.push({ id, at: { x: s.x, y: s.y }, desks: DESKS[s.def] ?? 0, on });
      }
      const more = wantsRefinery(g);
      const vibe = more && [...g.structures.values()].find((s) => !s.build && WORKPLACES.vibe_coder.includes(s.def));
      const def = structureDef("refinery");
      refinery = more && def ? { price: more.price, at: nearestSpot(g, def, playRules(g), vibe ? { x: vibe.x, y: vibe.y } : undefined) } : null;
      pipe = neededPipe(g);
      if (pipe && resting(`pipe:${pipe.s.id}`)) pipe = null;
    }

    const jobs: Job[] = [];
    const earns = gens.getGeneratorMoneyPerSecond("vibe_coder", 1);

    // A SEWER FOR A TANK THAT HAS NONE.
    if (fix) {
      const job = fix;
      const s = g.structures.get(Number(job.key.split(":")[1]));
      const desks = s ? DESKS[s.def] ?? 0 : 0;
      jobs.push({
        id: `sewer:${job.key}`, desk: "water",
        says: job.kind === "lateral" ? "Connect an office to the sewer" : "Lay a sewer for the slop",
        why: job.kind === "lateral" ? "its tank has nowhere to drain" : "an office's slop has nowhere to go",
        at: job.cells[0], cost: now(job.price), gain: earns * desks * SPILL_WORTH,
        // URGENT: a trunk costs minutes of income, and on its payback it sat ready behind every upgrade while the tanks
        // spilled for half an hour. It does not wait behind a purchase.
        urgent: true,
        run: () => lay(job),
      });
    }

    // A TANK SPILLING THAT NO SEWER HERE WOULD MEND: said, with what it waits on, and not passed over in silence.
    for (const sp of spills) {
      jobs.push({
        id: `spill:${sp.id}`, desk: "water",
        says: "Stop a tank spilling", why: "its slop is going in the street",
        at: sp.at, cost: 0, gain: earns * sp.desks * SPILL_WORTH,
        needs: [{ id: `spill:${sp.id}:on`, says: sp.on }],
        run: () => ({ ok: false, because: sp.on, retry: "on-change" }),
      });
    }

    // A SEWER WHERE AN OFFICE WAITS FOR ONE: worth nothing itself, and the office that waits on it.
    for (const [who, at] of sewerAsks) {
      if (!asked.has(who)) {
        const job = trunkInto(g, { x0: at.x - ASK_ROUND, y0: at.y - ASK_ROUND, x1: at.x + at.w - 1 + ASK_ROUND, y1: at.y + at.h - 1 + ASK_ROUND });
        asked.set(who, job && !resting(job.key) ? job : null);
      }
      const job = asked.get(who);
      if (!job) continue;
      jobs.push({
        id: `sewer:${who}`, desk: "water",
        says: "Lay a sewer to where an office will go", why: "what makes slop is built by a manhole",
        at: job.cells[0], cost: now(job.price), gain: 0,
        run: () => lay(job),
      });
    }

    // ANOTHER REFINERY, with more slop than those standing take.
    if (refinery) {
      const r = refinery;
      jobs.push({
        id: "refinery:more", desk: "water",
        says: "Build another Slop Refinery", why: `${slopMaking().toFixed(1)} slop a second, more than the refineries take`,
        at: r.at ?? undefined, puts: "refinery", cost: r.price, gain: purse.income * REFINERY_INNOVATION * INNOVATION_WORTH,
        run: () => {
          stale = true;
          if (!r.at) return { ok: false, because: "nowhere to put it", retry: "on-change" };
          return placeStructure("refinery", r.at) ? { ok: true } : { ok: false, because: whyNot()?.toLowerCase() ?? "it would not go there", retry: "on-change" };
        },
      });
    }

    // A MAIN, for what drinks and runs short.
    if (pipe) {
      const p = pipe;
      jobs.push({
        id: `pipe:${p.s.id}`, desk: "water",
        says: p.route.pump ? "Lay a pump and a main, for cooling" : "Lay a main, for cooling", why: "a building is running short of water",
        at: p.route.pipe[p.route.pipe.length - 1], cost: now(p.price), gain: purse.income * DRY_WORTH,
        run: () => {
          stale = true;
          if (layRoute(p.route)) return { ok: true };
          failed.set(`pipe:${p.s.id}`, looks);
          return { ok: false, because: whyNot()?.toLowerCase() ?? "the main would not go down", retry: 3 };
        },
      });
    }
    return jobs;
  };
  return { id: "water", propose };
}
