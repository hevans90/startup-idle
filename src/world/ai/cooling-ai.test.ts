import { afterEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { setHousingReader } from "../../game/housing";
import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useMoneyStore } from "../../state/money.store";
import { useSessionStore } from "../../state/session.store";
import { useWorldStore } from "../../state/world.store";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx, setHeight } from "../grid";
import { resetCooling, stepCooling, tankFor } from "../projects/cooling";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { AUTOPILOT_EVERY, lastStep, planInline, stepAutopilot } from "./autopilot";
import { intakesInto, neededPipe } from "./cooling-ai";

planInline();

/** Water down column 1, above the town; a Data Centre with a rack, on a road; no beds to hire into. */
function town() {
  const g = createGrid(24, 16);
  fillTerrain(g, 1);
  for (let y = 0; y < 16; y++) { setHeight(g, 1, y, -2); g.pool[idx(g, 1, y)] = 5; }
  for (let x = 4; x < 22; x++) g.paved[idx(g, x, 12)] = 1;
  const h = createHistory();
  commit(g, h, placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 12, 9)!);
  commit(g, h, placeCommand(g, { ...structureDef("rack")!, placement: undefined }, 16, 10)!);
  useWorldStore.getState().loadGrid(g, [null]);
  useWorldStore.setState({ playing: true });
  unhouse = setHousingReader(() => ({ intern: 0, vibe_coder: 0, "10x_dev": 0 }));
  const live = useWorldStore.getState().grid;
  const dc = [...live.structures.values()].find((s) => s.def === "datacentre")!;
  // Four agents at work, two past what it runs dry: thirsty, and its tank empty.
  stepCooling(live, 4, false, 1);
  Object.assign(tankFor(dc.id)!, { level: 0, share: 0 });
  return { g: live, dc };
}
let unhouse = () => {};

afterEach(() => {
  unhouse();
  resetCooling();
  useWorldStore.setState({ playing: false });
  resetAllGameStores();
});

describe("the AI keeps its Data Centre cool", () => {
  test("finds the Data Centre short of water, and the way to the water", () => {
    const { g, dc } = town();
    const need = neededPipe(g)!;
    expect(need.s.id).toBe(dc.id);
    expect(need.route.pump).toBeNull();
    expect(need.price).toBeGreaterThan(0);
  });

  test("AI mode lays the pipe, paying for it, and the Data Centre is fed", () => {
    const { g, dc } = town();
    useMoneyStore.setState({ money: new Decimal(1e9) });
    useSessionStore.getState().setAiMode({ aiMode: true });
    for (let k = 0; k < 4 && intakesInto(g, dc) === 0; k++) stepAutopilot(g, AUTOPILOT_EVERY, Date.now());
    expect(intakesInto(g, dc)).toBe(1);
    expect(lastStep()).toMatch(/pipe/);
    expect(useMoneyStore.getState().money.lt(1e9)).toBe(true);
    // Fed, it is not short again.
    Object.assign(tankFor(dc.id)!, { share: 1 });
    expect(neededPipe(g)).toBeNull();
  });
});
