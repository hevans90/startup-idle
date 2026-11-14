/**
 * World v2 — THE PILOT'S MACHINE DESK: the Data Centre's floor.
 *
 *  - AN AGENT SPUN UP whenever the trade is good: what it adds to income
 *    against what its price in innovation takes off. @see agentTrade
 *  - A RACK when the agents have no room and another would be worth it.
 *  - A TRAINING RUN whenever none is on: the dataset least learned.
 *  - ON THE MODEL'S OWN RUNS, its own buildings, which cost nothing: nodes
 *    for room, then farms, spires, hangars, the Monolith and the Lattice.
 *
 * Nothing that drinks is put up while what stands is short of water: the
 * Water desk's main comes first. @see coolingState
 * @see plans/ai-mode-rebuild.md phase 5
 */
import { MAX_HANGARS, MAX_NODES, MAX_SPIRES, agentBonus, agentCost } from "../../../../game/agents";
import { buildCost } from "../../../../game/build-cost";
import { isDrinker } from "../../../../game/cooling";
import { DATASETS, MAX_FARMS, MAX_SKILL } from "../../../../game/training";
import { agentTrade, runningAgents, useAgentsStore } from "../../../../state/agents.store";
import { useFounderStore } from "../../../../state/founder.store";
import { useTrainingStore } from "../../../../state/training.store";
import { useWorldStore } from "../../../../state/world.store";
import type { Grid } from "../../../grid";
import { placeStructure, whyNot } from "../../../play/build-actions";
import { structureDef } from "../../../structures/def";
import { aiBuildingSite, coolingState } from "../../planner";
import type { Purse } from "../chooser";
import type { Job, Need, Outcome } from "../job";
import type { Desk } from "../pilot";

/** Looks between two searches for a site, at the least. @see town desk LOOK_AGAIN */
const LOOK_AGAIN = 6;
/** The least an agent's trade must come to before one is spun up. @see simulate-map-run */
const WORTH_IT = 1.001;
/** What a training run, or one of the Model's own buildings, is taken to be worth, as a share of income: enough to be done. */
const STEP_WORTH = 0.01;

/** "a GPU farm", "an AI node", "the Lattice". */
function named(def: string): string {
  const name = structureDef(def)?.name ?? def;
  return /^the /i.test(name) ? `the ${name.slice(4)}` : `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
}

const COOLING: Need = { id: "cooling", says: "water for what already drinks" };
/** The Model's own, in the order it puts them up, and how many of each. */
const OWN: readonly (readonly [string, number])[] = [["gpu-farm", MAX_FARMS], ["compute-spire", MAX_SPIRES], ["drone-hangar", MAX_HANGARS], ["monolith", 1], ["lattice", 1]];

export function machineDesk(): Desk {
  let seen: { grid: Grid; rev: number } | null = null, since = LOOK_AGAIN;
  const sites = new Map<string, { x: number; y: number } | null>();
  const failed = new Set<string>();

  const propose = (purse: Purse): Job[] => {
    const g = useWorldStore.getState().grid;
    const all = [...g.structures.values()];
    const dc = all.find((s) => s.def === "datacentre" && !s.build);
    if (!dc) return [];
    since++;
    if (!seen || seen.grid !== g) failed.clear();
    if (!seen || seen.grid !== g || (seen.rev !== g.rev && since >= LOOK_AGAIN)) { seen = { grid: g, rev: g.rev }; since = 0; sites.clear(); }
    const siteOf = (def: string) => { if (!sites.has(def)) sites.set(def, aiBuildingSite(g, def, dc)); return sites.get(def) ?? null; };
    const count = (def: string) => all.filter((s) => s.def === def).length;
    const income = Math.max(purse.income, 1), model = useFounderStore.getState().selectedFounderId === "model";
    const short = coolingState(g) === "short";
    const jobs: Job[] = [];

    /** Put one up, and look. */
    const put = (def: string): Outcome => {
      const at = siteOf(def);
      sites.delete(def);
      if (!at) { failed.add(def); return { ok: false, because: "nowhere within reach of the Data Centre", retry: "on-change" }; }
      const before = g.structures.size;
      placeStructure(def, at);
      if (g.structures.size > before) return { ok: true };
      return { ok: false, because: whyNot()?.toLowerCase() ?? "it would not go there", retry: "on-change" };
    };
    const building = (def: string, why: string, gain: number): Job => ({
      id: `machine:${def}`, desk: "machine",
      says: `Put up ${named(def)}`, why,
      at: siteOf(def) ?? undefined, puts: def, cost: buildCost(def)?.toNumber() ?? 0, gain,
      needs: short && isDrinker(def) ? [COOLING] : undefined,
      run: () => put(def),
    });

    // AN AGENT, when the trade is good; ROOM for one, when that is all it wants.
    const agents = useAgentsStore.getState(), why = agents.blocked();
    const trade = agentTrade(runningAgents());
    if (why === "no-room") {
      // What one more would add, were there a rack for it.
      const worth = income * (agentBonus(runningAgents() + 1) / agentBonus(runningAgents()) - 1);
      const def = model && count("ai-node") < MAX_NODES ? "ai-node" : "rack";
      if (!failed.has(def)) jobs.push(building(def, "the agents have no rack to run on", Math.max(worth, income * STEP_WORTH)));
    } else if ((why === null || why === "innovation") && trade.net > WORTH_IT) {
      jobs.push({
        id: "agent", desk: "machine", says: "Spin up an agent", why: `income ×${trade.net.toFixed(3)}, after its price`,
        cost: agentCost(agents.agents), costs: "innovation", gain: income * (trade.net - 1),
        run: () => (useAgentsStore.getState().spinUp() ? { ok: true } : { ok: false, because: "it would not start", retry: 10 }),
      });
    }

    // A TRAINING RUN, whenever none is on: what it has learned least, in the order they are listed.
    const training = useTrainingStore.getState();
    if (!training.blocked()) {
      const next = [...DATASETS].sort((a, b) => (training.skills[a.id] ?? 0) - (training.skills[b.id] ?? 0)).find((d) => (training.skills[d.id] ?? 0) < MAX_SKILL);
      if (next) {
        jobs.push({
          id: `train:${next.id}`, desk: "machine", says: `Train on ${next.name.toLowerCase()}`, why: next.skills[training.skills[next.id] ?? 0],
          cost: 0, gain: income * STEP_WORTH,
          run: () => (useTrainingStore.getState().start(next.id) ? { ok: true } : { ok: false, because: "a run is already on", retry: 10 }),
        });
      }
    }

    // THE MODEL'S OWN, one kind at a time.
    if (model) {
      const next = OWN.find(([def, most]) => count(def) < most && !failed.has(def));
      if (next) jobs.push(building(next[0], "its own, and free", income * STEP_WORTH));
    }
    return jobs;
  };
  return { id: "machine", propose };
}
