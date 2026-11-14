/**
 * World v2 — THE PILOT'S HARBOUR DESK: the river's trade.
 *
 *  - A ROAD TO THE WATER'S EDGE. The Harbour stands within a few tiles of a
 *    river and a seaport on its bank, and both want a road beside them; the
 *    town's blocks are laid where the town is. With nowhere for one to stand,
 *    this desk lays a road from the nearest street to the nearest place one
 *    could (`quay`, which the Landmarks desk's Harbour waits on; `quay:port`).
 *  - A SEAPORT, once the Harbour has opened them, worth what its calls pay.
 *  - EACH PORT GROWN to its next tier where the bank has room.
 *
 * Every berth is left a trading quay, which pays the whole fee.
 * @see portCallFee, stepHarbour, plans/ai-mode-rebuild.md phase 5
 */
import { buildCost, callsAMinute, portCallFee, roadCost, upgradeCost } from "../../../../game/build-cost";
import { featureGateOpen } from "../../../../game/projects";
import { useWorldStore } from "../../../../state/world.store";
import { hasRiver } from "../../../boats/river";
import { MAIN_SEWER, idx, inBounds, type Grid } from "../../../grid";
import { paveRoad, placeStructure, whyNot } from "../../../play/build-actions";
import { builtProjects, nearestSpot, projectUnderWay } from "../../../projects/works";
import { isPaved } from "../../../roads/mask";
import { structureDef, type StructureDef } from "../../../structures/def";
import { planUpgrade, validatePlacement, type PlaceRules } from "../../../structures/place";
import type { Job, Need, Outcome } from "../job";
import type { Desk } from "../pilot";
import { riverRules, yardSite } from "./landmarks";

type Cell = { x: number; y: number };

/** Looks between two searches of the map, at the least: each walks all of it. @see town desk LOOK_AGAIN */
const LOOK_AGAIN = 6;
/** The longest road it will lay to reach the water, tiles. */
const QUAY_FARTHEST = 40;

const NEIGHBOURS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * THE SHORTEST ROAD from a street to somewhere `def` could stand but for a
 * road beside it: where that is, and the tiles to pave, from the street out.
 * Over open ground only. Null with no street, or nowhere in reach.
 */
export function roadTo(g: Grid, def: StructureDef, rules: PlaceRules): { at: Cell; path: Cell[] } | null {
  const n = g.w * g.h, dist = new Int32Array(n).fill(-1), from = new Int32Array(n).fill(-1);
  const queue: number[] = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (isPaved(g, x, y)) { dist[idx(g, x, y)] = 0; queue.push(idx(g, x, y)); }
  if (!queue.length) return null;
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % g.w, y = (i / g.w) | 0;
    if (dist[i] >= QUAY_FARTHEST) continue;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(g, nx, ny)) continue;
      const j = idx(g, nx, ny);
      // Not through water or a building, nor over a sewer connection, which lies on open ground. @see planLateral
      if (dist[j] >= 0 || g.pool[j] || g.structureAt[j] >= 0 || (g.main[j] & MAIN_SEWER) !== 0) continue;
      dist[j] = dist[i] + 1; from[j] = i;
      queue.push(j);
    }
  }
  const { w, h } = def.footprint, bare = { ...rules, needsRoad: false };
  let best: { at: Cell; path: Cell[] } | null = null;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      // The tiles round the footprint a road could end on, the nearest a street first.
      let end = -1;
      for (let k = 0; k < w; k++) for (const ty of [y - 1, y + h]) if (inBounds(g, x + k, ty)) { const j = idx(g, x + k, ty); if (dist[j] > 0 && (end < 0 || dist[j] < dist[end])) end = j; }
      for (let k = 0; k < h; k++) for (const tx of [x - 1, x + w]) if (inBounds(g, tx, y + k)) { const j = idx(g, tx, y + k); if (dist[j] > 0 && (end < 0 || dist[j] < dist[end])) end = j; }
      if (end < 0 || (best && dist[end] >= best.path.length) || !validatePlacement(g, def, x, y, bare).ok) continue;
      const path: Cell[] = [];
      let through = false;
      for (let j = end; j >= 0 && dist[j] > 0; j = from[j]) {
        const c = { x: j % g.w, y: (j / g.w) | 0 };
        if (c.x >= x && c.x < x + w && c.y >= y && c.y < y + h) through = true;
        path.unshift(c);
      }
      if (!through) best = { at: { x, y }, path };
    }
  }
  return best;
}

/** Pave a path, a straight run at a time. Whether any of it went down. */
function pave(g: Grid, path: readonly Cell[]): boolean {
  const before = g.rev;
  let a = 0;
  for (let i = 1; i <= path.length; i++) {
    const turns = i === path.length
      || (i - a >= 2 && (path[i].x - path[i - 1].x !== path[a + 1].x - path[a].x || path[i].y - path[i - 1].y !== path[a + 1].y - path[a].y));
    if (!turns) continue;
    paveRoad(path[a], path[i - 1]);
    a = i - 1;
  }
  return g.rev !== before;
}

const refusal = (fallback: string) => whyNot()?.toLowerCase() ?? fallback;

export function harbourDesk(): Desk {
  let seen: { grid: Grid; rev: number } | null = null, since = LOOK_AGAIN, stale = false;
  /** Where a seaport could go now; and the roads that would make room for the Harbour and for a seaport. */
  let berth: Cell | null = null, quay: ReturnType<typeof roadTo> = null, portQuay: ReturnType<typeof roadTo> = null;
  /** The ports the bank has room to grow. */
  const growable = new Set<number>();
  const failed = new Set<string>();

  const road = (id: string, route: NonNullable<ReturnType<typeof roadTo>>, says: string, why: string): Job => ({
    id, desk: "harbour", says, why, at: route.at,
    cost: roadCost(route.path.length).toNumber(), gain: 0,
    run: (): Outcome => {
      stale = true;
      const g = useWorldStore.getState().grid;
      if (pave(g, route.path)) return { ok: true };
      // Tried again in a while, at its price then: with income climbing, what it cost when planned may not be what it costs now.
      return { ok: false, because: refusal("the road would not go down"), retry: 30 };
    },
  });

  const propose = (): Job[] => {
    const g = useWorldStore.getState().grid;
    if (!hasRiver(g)) return [];
    since++;
    const harbourDef = structureDef("harbour"), port = structureDef("seaport");
    const built = builtProjects(g);
    const wantsHarbour = !built.has("harbour") && projectUnderWay(g)?.id !== "harbour";
    const portsOpen = built.has("harbour") && featureGateOpen("ports");
    if (!seen || seen.grid !== g) failed.clear();
    if (!seen || seen.grid !== g || stale || (seen.rev !== g.rev && since >= LOOK_AGAIN)) {
      seen = { grid: g, rev: g.rev }; since = 0; stale = false;
      const rules = riverRules(g);
      quay = wantsHarbour && harbourDef && !nearestSpot(g, harbourDef, rules, yardSite(g)) ? roadTo(g, harbourDef, rules) : null;
      berth = portsOpen && port ? nearestSpot(g, port, rules, yardSite(g)) : null;
      portQuay = portsOpen && port && !berth ? roadTo(g, port, rules) : null;
      growable.clear();
      if (portsOpen) for (const s of g.structures.values()) if (!s.build && structureDef(s.def)?.port && planUpgrade(g, s.id, rules)?.ok) growable.add(s.id);
    }

    const jobs: Job[] = [];
    if (quay && !failed.has("quay")) jobs.push(road("quay", quay, "Lay a road to the water's edge", "the Harbour stands by the river"));
    if (!portsOpen || !port) return jobs;

    const fee = (def: string) => { const p = structureDef(def)?.port; return p ? (portCallFee(def) ?? 0) * callsAMinute(p) / 60 : 0; };

    // ANOTHER SEAPORT, where the bank has a road beside it; else the road first.
    const needs: Need[] = [];
    if (!berth) {
      if (portQuay && !failed.has("quay:port")) jobs.push(road("quay:port", portQuay, "Lay a road along the bank", "a seaport wants a road beside it"));
      needs.push({ id: "quay:port", says: "a road at the water's edge" });
    }
    if (berth || portQuay) {
      const at = berth;
      jobs.push({
        id: "port:new", desk: "harbour",
        says: "Build a seaport", why: "boats pay for every call",
        at: at ?? portQuay?.at, cost: buildCost("seaport")?.toNumber() ?? 0, gain: fee("seaport"),
        needs: needs.length ? needs : undefined,
        run: () => {
          stale = true;
          if (!at) return { ok: false, because: "nowhere on the bank", retry: "on-change" };
          const before = g.structures.size;
          placeStructure("seaport", at);
          return g.structures.size > before ? { ok: true } : { ok: false, because: refusal("it would not go there"), retry: "on-change" };
        },
      });
    }

    // EACH PORT GROWN, where the bank has room for the next.
    for (const s of g.structures.values()) {
      const def = structureDef(s.def);
      if (!def?.port || !def.upgradesTo || !growable.has(s.id) || failed.has(`port:up:${s.id}`)) continue;
      const to = def.upgradesTo, id = `port:up:${s.id}`;
      jobs.push({
        id, desk: "harbour",
        says: `Grow a seaport to ${structureDef(to)?.port?.berths ?? 2} berths`, why: "more boats at once, and each pays more",
        at: { x: s.x, y: s.y }, cost: upgradeCost(s.def, to)?.toNumber() ?? 0, gain: fee(to) - fee(s.def),
        run: () => {
          stale = true;
          placeStructure("seaport", { x: s.x, y: s.y });
          if (g.structures.get(s.id)?.def === to || [...g.structures.values()].some((x) => x.def === to && x.x <= s.x && x.y <= s.y && x.x + x.w > s.x && x.y + x.h > s.y)) return { ok: true };
          failed.add(id);
          return { ok: false, because: refusal("it would not grow"), retry: "on-change" };
        },
      });
    }
    return jobs;
  };
  return { id: "harbour", propose };
}
