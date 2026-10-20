import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { setHousingReader } from "../../game/housing";
import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useMoneyStore } from "../../state/money.store";
import { useSessionStore } from "../../state/session.store";
import { useWorldStore } from "../../state/world.store";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, setHeight, type Grid } from "../grid";
import { resetCooling, stepCooling, tankFor } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { depthAt } from "../water/field";
import { neededPipe } from "./cooling-ai";
import { aiDistrict } from "./district";
import { chooseAction, perform } from "./planner";
import { DEPTH, MAX_RESERVOIRS, RESERVOIR, siteFor } from "./reservoir";

/** A Data Centre with a rack, on a road, thirsty and its tank empty; `shape` the ground first. */
function town(shape: (g: Grid) => void = () => {}) {
  const g = createGrid(30, 24);
  fillTerrain(g, 1);
  shape(g);
  for (let x = 4; x < 26; x++) g.paved[idx(g, x, 12)] = 1;
  const h = createHistory();
  commit(g, h, placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 12, 9)!);
  commit(g, h, placeCommand(g, { ...structureDef("rack")!, placement: undefined }, 16, 10)!);
  useWorldStore.getState().loadGrid(g, [null]);
  useWorldStore.setState({ playing: true });
  useMoneyStore.setState({ money: new Decimal(1e12) });
  unhouse = setHousingReader(() => ({ intern: 0, vibe_coder: 0, "10x_dev": 0 }));
  const live = useWorldStore.getState().grid;
  const dc = [...live.structures.values()].find((s) => s.def === "datacentre")!;
  stepCooling(live, 4, false, 1);
  Object.assign(tankFor(dc.id)!, { level: 0, share: 0 });
  return { g: live, dc };
}
let unhouse = () => {};
const rand = () => 0.5;

afterEach(() => {
  unhouse();
  resetCooling();
  useWorldStore.setState({ playing: false });
  resetAllGameStores();
});

describe("the AI's reservoirs", () => {
  test("with no water within reach, it digs one by the building: a basin lowered, its rim left, and filled", () => {
    const { g } = town();
    const a = chooseAction(g, "manager", rand);
    expect(a?.kind).toBe("reservoir");
    const at = { x: a!.kind === "reservoir" ? a!.at.x - 1 : 0, y: a!.kind === "reservoir" ? a!.at.y - 1 : 0 };
    const before = g.height[idx(g, at.x, at.y)];
    expect(perform(a!)).toBe(true);
    const live = useWorldStore.getState().grid;
    for (let dy = 0; dy < RESERVOIR; dy++) for (let dx = 0; dx < RESERVOIR; dx++) {
      expect(live.height[idx(live, at.x + dx, at.y + dy)]).toBe(before - DEPTH);
    }
    expect(live.height[idx(live, at.x - 1, at.y - 1)]).toBe(before);
    expect(live.height[idx(live, at.x + RESERVOIR, at.y + 1)]).toBe(before);
    expect(depthAt(useWorldStore.getState().getWaterField()!, at.x + 1, at.y + 1)).toBeGreaterThan(0);
    expect(useSessionStore.getState().aiReservoirs).toEqual([at]);
    // And its next job pipes from it.
    expect(neededPipe(live)).not.toBeNull();
  });

  test("never on a slope", () => {
    const { g, dc } = town((g) => { for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) setHeight(g, x, y, 1 + 2 * x); });
    expect(siteFor(g, dc, aiDistrict(g, "manager"))).toBeNull();
  });

  test("with a lake in reach it pipes from that instead; and never digs on its shore", () => {
    const { g, dc } = town((g) => { for (let y = 0; y < g.h; y++) for (let x = 0; x < 3; x++) { setHeight(g, x, y, -2); g.pool[idx(g, x, y)] = 5; } });
    expect(chooseAction(g, "manager", rand)?.kind).toBe("pipe");
    const at = siteFor(g, dc, aiDistrict(g, "manager"))!;
    expect(at.x - 1).toBeGreaterThanOrEqual(3);
  });

  test("no more than its most a company, nor before the Manager", () => {
    const { g } = town();
    expect(chooseAction(g, "colleague", rand)?.kind).not.toBe("reservoir");
    useSessionStore.getState().setAiReservoirs([...Array(MAX_RESERVOIRS)].map((_, k) => ({ x: k, y: 0 })));
    expect(chooseAction(g, "manager", rand)?.kind).not.toBe("reservoir");
  });
});
