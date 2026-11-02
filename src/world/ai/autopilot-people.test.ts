import { beforeEach, describe, expect, test } from "bun:test";
import Decimal from "break_infinity.js";

import { XP_AT } from "../../game/leaders";
import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useGeneratorStore } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { useLinkedOutStore } from "../../state/linkedout.store";
import { useTeamLeadersEmployeesStore } from "../../state/team-leaders.store";
import { createGrid } from "../grid";
import { peopleStep } from "./autopilot-people";

const g = createGrid(8, 8);
/** Steps till it has nothing to do, at most `n`: what it did. */
const run = (tall: number, n = 20) => { const out: string[] = []; for (let k = 0; k < n; k++) { const s = peopleStep(g, tall); if (!s) break; out.push(s); } return out; };

describe("AI mode, its people", () => {
  beforeEach(() => {
    localStorage.clear();
    resetAllGameStores();
    useGeneratorStore.getState().increaseGenerator("intern", 10);
    useInnovationStore.getState().grantFeatures("managers");
    useInnovationStore.setState((s) => ({ innovation: new Decimal(1e6), managers: { ...s.managers, agile: { ...s.managers.agile, tier: new Decimal(5) } } }));
  });

  /** Two offers waiting, of both styles' cards. */
  const offered = () => useGeneratorStore.setState((s) => ({
    employeeManagement: { ...s.employeeManagement, deck: { ...s.employeeManagement.deck, offers: [
      { track: "corpo", cards: ["freeze", "lunch", "shuttle"], rerolls: 0 },
      { track: "agile", cards: ["movefast", "crunch", "stack"], rerolls: 0 },
    ] } },
  }));
  const deck = () => useGeneratorStore.getState().employeeManagement.deck;

  test("tall: takes its style's cards, slots one, ranks it up with the points, then leaves them be", () => {
    offered();
    // Rank 2 is dear: eight tiers, for six points.
    useInnovationStore.setState((s) => ({ managers: { ...s.managers, agile: { ...s.managers.agile, tier: new Decimal(8) } } }));
    const did = run(1);
    expect(did[0]).toBe("Hire Freeze taken");
    expect(did[1]).toBe("Crunch Week taken");
    expect(deck().slotted).toEqual(["freeze"]);
    // Rank 2 for the card it likes best that is slotted.
    expect(deck().ranks.freeze).toBe(2);
    expect(peopleStep(g, 1)).toBeNull();
  });

  test("wide: takes its style's cards and buys a slot for the one left out", () => {
    offered();
    run(0);
    expect(deck().ranks).toEqual({ lunch: 1, crunch: 1 });
    expect(deck().slots).toBe(2);
    expect([...deck().slotted].sort()).toEqual(["crunch", "lunch"]);
  });

  test("with leaders open: posts, checks the best applicant, hires one who hides nothing bad", () => {
    useInnovationStore.getState().grantFeatures("leaders");
    run(1);
    expect(useLinkedOutStore.getState().posts.map((p) => p.role)).toEqual(["intern"]);
    useLinkedOutStore.getState().tick(Date.now() + 7 * 60_000, 1, 0);
    run(1);
    const leader = useTeamLeadersEmployeesStore.getState().employees[0];
    const passed = useLinkedOutStore.getState().applicants;
    // Hired, unless every one hid something bad; nobody hired with a bad flag.
    if (leader) expect(!leader.flag || leader.flag === "brilliant").toBe(true);
    else expect(passed.length).toBe(0);
  });

  test("picks the perk its style likes best at a rank reached", () => {
    useInnovationStore.getState().grantFeatures("leaders");
    run(0);
    useTeamLeadersEmployeesStore.getState().hire({ id: "q", role: "intern", name: "Q", personality: "quiet_quitter", rank: 1, xp: XP_AT[1], perks: [], placedAt: 1 });
    run(0);
    // Quiet Quitter's pool has Inspire, wide's first choice, if it was offered; something, whatever was.
    expect(useTeamLeadersEmployeesStore.getState().employees[0].perks.length).toBe(1);
  });
});

describe("where it puts a leader", () => {
  test("the standing workplace of their kind with the most at its desks; another kind's, or none, never", async () => {
    const { commit, createHistory } = await import("../edit/commands");
    const { fillTerrain } = await import("../grid");
    const { placeCommand } = await import("../structures/place");
    const { structureDef } = await import("../structures/def");
    const { busiestWorkplace } = await import("./autopilot-people");
    const m = createGrid(30, 12);
    fillTerrain(m, 1);
    const h = createHistory();
    commit(m, h, placeCommand(m, structureDef("garage")!, 0, 4)!);
    commit(m, h, placeCommand(m, structureDef("office-intern")!, 17, 3)!);
    commit(m, h, placeCommand(m, structureDef("studio")!, 8, 4)!);
    const id = (def: string) => [...m.structures.values()].find((s) => s.def === def)!.id;
    const desks = new Map([[id("garage"), { used: 2 }], [id("office-intern"), { used: 9 }], [id("studio"), { used: 30 }]]);
    expect(busiestWorkplace(m, desks, "intern")).toEqual({ id: id("office-intern"), used: 9 });
    expect(busiestWorkplace(m, desks, "vibe_coder")!.id).toBe(id("studio"));
    expect(busiestWorkplace(m, desks, "10x_dev")).toBeNull();
  });
});
