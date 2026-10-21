import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { setHousingReader } from "../../game/housing";
import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { LATTICE_AT, setLatticeReader, useAiSingularityStore } from "../../state/ai-singularity.store";
import { useAgentsStore } from "../../state/agents.store";
import { useMoneyStore } from "../../state/money.store";
import { useSessionStore } from "../../state/session.store";
import { useTrainingStore } from "../../state/training.store";
import { useWorldStore } from "../../state/world.store";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { resetCooling, stepCooling, tankFor } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { LATTICE_AGENTS, LATTICE_SECONDS, latticeDone, latticeOf, stepLattice } from "./lattice";
import { chooseAction, perform } from "./planner";

/** A road along row 12, a Data Centre north of it, loaded into the game. */
function town() {
  const g = createGrid(40, 30);
  fillTerrain(g, 1);
  for (let x = 2; x < 38; x++) g.paved[idx(g, x, 12)] = 1;
  commit(g, createHistory(), placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 18, 9)!);
  useWorldStore.getState().loadGrid(g, [null]);
  useWorldStore.setState({ playing: true });
  useMoneyStore.setState({ money: new Decimal(1e12) });
  unhouse = setHousingReader(() => ({ intern: 0, vibe_coder: 0, "10x_dev": 0 }));
  return useWorldStore.getState().grid;
}
let unhouse = () => {}, unread = () => {};
const rand = () => 0.5;

afterEach(() => {
  unhouse();
  unread();
  resetCooling();
  useWorldStore.setState({ playing: false });
  resetAllGameStores();
});

describe("the Lattice's hold on the meter", () => {
  test("stops it at 95% till the Lattice is done — the agents and training alike — and never pulls it back", () => {
    let done = false;
    unread = setLatticeReader(() => done);
    useAgentsStore.setState({ agents: 40, running: 40 } as never);
    useAiSingularityStore.setState({ value: 94 });
    for (let k = 0; k < 600; k++) useAiSingularityStore.getState().tick(1);
    expect(useAiSingularityStore.getState().value).toBe(LATTICE_AT);
    useTrainingStore.getState().start("itself", 0);
    useTrainingStore.getState().tick(1e9);
    expect(useAiSingularityStore.getState().value).toBe(LATTICE_AT);
    useAiSingularityStore.setState({ value: 97 });
    useAiSingularityStore.getState().tick(1);
    expect(useAiSingularityStore.getState().value).toBe(97);
    done = true;
    for (let k = 0; k < 6000 && useAiSingularityStore.getState().value < 100; k++) useAiSingularityStore.getState().tick(1);
    expect(useAiSingularityStore.getState().value).toBe(100);
  });
});

describe("the Lattice", () => {
  test("is the AI's first job at the hold, by the Data Centre — not before it, nor told hands off", () => {
    const g = town();
    useAiSingularityStore.setState({ value: 90 });
    expect([...Array(20)].some(() => { const a = chooseAction(g, "overseer", rand); return a?.kind === "place" && a.def === "lattice"; })).toBe(false);
    useAiSingularityStore.setState({ value: LATTICE_AT });
    useSessionStore.getState().setAiFocus("hands-off");
    expect(chooseAction(g, "overseer", rand)).toBeNull();
    useSessionStore.getState().setAiFocus("grow");
    const a = chooseAction(g, "overseer", rand)!;
    expect(a.kind === "place" && a.def).toBe("lattice");
    expect(perform(a)).toBe(true);
    expect(latticeOf(useWorldStore.getState().grid)).not.toBeNull();
    // Only one.
    const again = chooseAction(useWorldStore.getState().grid, "overseer", rand);
    expect(again?.kind === "place" && again.def === "lattice").toBe(false);
  });

  test("charges only with the Data Centre and itself cooled and enough agents running", () => {
    const g = town();
    commit(g, createHistory(), placeCommand(g, { ...structureDef("lattice")!, placement: undefined }, 24, 14)!);
    const lat = latticeOf(g)!, dc = [...g.structures.values()].find((s) => s.def === "datacentre")!;
    stepCooling(g, 0, false, 1);
    // Dry: no charge.
    Object.assign(tankFor(lat.id)!, { share: 0 });
    Object.assign(tankFor(dc.id)!, { share: 1 });
    expect(stepLattice(g, LATTICE_AGENTS, 10)).toBe(false);
    expect(useSessionStore.getState().aiLattice).toBe(0);
    Object.assign(tankFor(lat.id)!, { share: 1 });
    // Too few agents.
    stepLattice(g, LATTICE_AGENTS - 1, 10);
    expect(useSessionStore.getState().aiLattice).toBe(0);
    let finished = false;
    for (let t = 0; t < LATTICE_SECONDS + 1 && !finished; t++) finished = stepLattice(g, LATTICE_AGENTS, 1);
    expect(finished).toBe(true);
    expect(latticeDone()).toBe(true);
  });
});
