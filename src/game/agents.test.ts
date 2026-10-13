import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resetAllGameStores } from "../simulation/reset-game-stores";
import { agentTrade, useAgentsStore } from "../state/agents.store";
import { useInnovationStore } from "../state/innovation.store";
import { commit, createHistory } from "../world/edit/commands";
import { createGrid, fillTerrain } from "../world/grid";
import { rackReading } from "../world/projects/racks";
import { structureDef } from "../world/structures/def";
import { placeCommand } from "../world/structures/place";
import {
  AGENT_BOOST, AGENTS_A_RACK, AGENT_COST_GROWTH, UNPOWERED_SHARE, agentBonus, agentCost, agentsAtWork, agentsOpen, rackRoom,
} from "./agents";
import { setProjectReader } from "./projects";

let stop: (() => void) | null = null;
const map = (powered: number, unpowered: number, built: string[] = ["datacentre"]) => {
  stop?.();
  stop = setProjectReader(() => ({ built: new Set(built) as never, away: {}, racks: { powered, unpowered } }));
};
afterEach(() => { stop?.(); stop = null; });

describe("AI agents", () => {
  test("each costs more innovation than the last", () => {
    expect(agentCost(1) / agentCost(0)).toBeCloseTo(AGENT_COST_GROWTH, 9);
    expect(agentCost(10)).toBeGreaterThan(agentCost(9));
  });

  test("with no map, all run at full power, with room for any number", () => {
    expect(agentsOpen()).toBe(true);
    expect(rackRoom()).toBe(Infinity);
    expect(agentBonus(10)).toBeCloseTo(1 + 10 * AGENT_BOOST, 9);
  });

  test("on a map they wait for the Data Centre, and fill the powered racks first", () => {
    map(4, 8, []);
    expect(agentsOpen()).toBe(false);
    map(4, 8);
    expect(agentsOpen()).toBe(true);
    expect(rackRoom()).toBe(12);
    expect(agentsAtWork(6)).toEqual({ powered: 4, unpowered: 2 });
    expect(agentBonus(6)).toBeCloseTo(1 + AGENT_BOOST * (4 + 2 * UNPOWERED_SHARE), 9);
  });

  test("a rack is powered within reach of a finished Data Centre, and not beyond it", () => {
    const g = createGrid(40, 40);
    fillTerrain(g, 1);
    const h = createHistory();
    commit(g, h, placeCommand(g, structureDef("datacentre")!, 5, 5)!);
    commit(g, h, placeCommand(g, structureDef("rack")!, 10, 5)!);
    commit(g, h, placeCommand(g, structureDef("rack")!, 35, 35)!);
    expect(rackReading(g)).toEqual({ powered: AGENTS_A_RACK, unpowered: AGENTS_A_RACK });
  });
});

describe("spinning one up", () => {
  beforeEach(() => { localStorage.clear(); resetAllGameStores(); });

  test("costs its innovation, and needs the room and the innovation", () => {
    map(4, 0);
    expect(useAgentsStore.getState().blocked()).toBe("innovation");
    useInnovationStore.getState().increaseInnovation(100);
    expect(useAgentsStore.getState().spinUp()).toBe(true);
    expect(useInnovationStore.getState().innovation.toNumber()).toBeCloseTo(100 - agentCost(0), 6);
    useAgentsStore.setState({ agents: 4 });
    expect(useAgentsStore.getState().blocked()).toBe("no-room");
  });

  test("is worth it when innovation is plentiful, and not when it is the last of it", () => {
    map(40, 0);
    useInnovationStore.getState().increaseInnovation(1000);
    expect(agentTrade(0).net).toBeGreaterThan(1);
    useAgentsStore.setState({ agents: 0 });
    useInnovationStore.setState({ innovation: useInnovationStore.getState().innovation.mul(0).add(agentCost(0)) });
    expect(agentTrade(0).net).toBeLessThan(1);
  });
});
