import { afterEach, describe, expect, test } from "bun:test";

import { projectDef } from "../../game/projects";
import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useGenerationStore } from "../../state/generation.store";
import { AI_TRUCK_COLOUR, createTown, stepTown } from "../agents/town";
import { commit, createHistory } from "../edit/commands";
import { createGrid, fillTerrain, idx } from "../grid";
import { createNetwork } from "../roads/network";
import { structureDef } from "../structures/def";
import { placeCommand } from "../structures/place";
import { AIRLIFT_PRICE, CONVOY, PREFAB_WORK, createWorks, newBuild, siteOf, startSiteCommand, stepWorks } from "./works";

const STUDIO = projectDef("studio")!, GARAGE = projectDef("garage")!;
const own = (...ids: string[]) => useGenerationStore.setState({ machine: ids.map((id) => `machine_n_${id}`) });

/** A road along row 5, intern housing north of it; a Data Centre too, if asked. */
function town(dc = false) {
  const g = createGrid(30, 14);
  fillTerrain(g, 1);
  for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
  const h = createHistory();
  for (const x of [3, 6, 9]) commit(g, h, placeCommand(g, structureDef("kit:intern.t0")!, x, 4)!);
  if (dc) commit(g, h, placeCommand(g, { ...structureDef("datacentre")!, placement: undefined }, 20, 1)!);
  return { g, h };
}

afterEach(() => resetAllGameStores());

describe("the Machine on site", () => {
  test("Prefab Printing: a new site needs 40% less work", () => {
    expect(newBuild(STUDIO, 0).need).toBe(STUDIO.work);
    own("prefab");
    expect(newBuild(STUDIO, 0).need).toBeCloseTo(STUDIO.work * PREFAB_WORK);
  });

  test("Autonomous Freight: loads go in convoys of the Machine's lorries", () => {
    own("freight");
    const { g, h } = town();
    commit(g, h, startSiteCommand(g, STUDIO, 12, 6, { needsRoad: true }, 0)!);
    const net = createNetwork(g), t = createTown(), w = createWorks();
    const wallet = { money: 1e9 };
    let most = 0;
    for (let k = 0; k < 30 * 5; k++) {
      stepTown(t, g, net, 0, 1 / 30);
      stepWorks(w, g, net, t, { intern: 10 }, (n) => ((wallet.money -= n), true), 1 / 30, k * 33);
      most = Math.max(most, t.movers.filter((m) => m.job?.role === "truck" && m.colour === AI_TRUCK_COLOUR).length);
    }
    expect(most).toBe(CONVOY);
  });

  test("Drone Airlift: a small site's loads fly from the Data Centre, a quarter dearer, and no lorry comes", () => {
    own("airlift");
    const { g, h } = town(true);
    commit(g, h, startSiteCommand(g, GARAGE, 12, 6, { needsRoad: true }, 0)!);
    const site = siteOf(g, GARAGE)!;
    site.build!.cost = 400;
    const net = createNetwork(g), t = createTown(), w = createWorks();
    let paid = 0, flew = 0;
    for (let k = 0; k < 30 * 20 && site.build; k++) {
      stepTown(t, g, net, 0, 1 / 30);
      stepWorks(w, g, net, t, { intern: 10 }, (n) => ((paid += n), true), 1 / 30, k * 33);
      flew = Math.max(flew, w.airlifts.length);
      expect(t.movers.some((m) => m.job?.role === "truck")).toBe(false);
    }
    expect(flew).toBe(1);
    expect(paid).toBeCloseTo(400 * AIRLIFT_PRICE);
    expect(site.build?.delivered ?? GARAGE.deliveries).toBe(GARAGE.deliveries);
  });
});
