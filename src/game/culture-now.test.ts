import { afterEach, describe, expect, test } from "bun:test";

import { commit, createHistory } from "../world/edit/commands";
import { createGrid, fillTerrain, idx, type Structure } from "../world/grid";
import { createNetwork } from "../world/roads/network";
import { structureDef } from "../world/structures/def";
import { placeCommand } from "../world/structures/place";
import { DESKLESS, FREE, STRANDED, commuteEfficiency, seat } from "../world/agents/commute";
import { MOOD, moodsOf, stepMood } from "../world/agents/mood";
import { NEED_MOOD } from "../world/agents/mood-rules";
import type { MoodParts } from "../world/agents/mood-rules";
import type { Build } from "../world/grid";
import { placesOf } from "../world/agents/roads";
import { emptyDeck, type CardId, type Deck } from "./culture";
import { cultureNow, cultureVersion, setDeckReader } from "./culture-now";
import { housedBy } from "./housing";
import { leaderEffects, RANK_OUTPUT, type Leader } from "./leaders";
import { leadersNow } from "./leader-economy";
import { tankFor, TANK_SECONDS } from "./slop";

let undo = () => {};
/** These cards slotted, at these ranks. */
function deck(cards: Partial<Record<CardId, number>>) {
  const d: Deck = { ...emptyDeck(), slots: 9, ranks: cards, slotted: Object.keys(cards) as CardId[] };
  undo();
  undo = setDeckReader(() => d);
}
afterEach(() => { undo(); undo = () => {}; });

/** A road along row 5; a garage at 0 and a house of interns at `at`. */
function street(at = 6, residents = 5, house = "kit:intern.t1") {
  const g = createGrid(60, 10);
  fillTerrain(g, 1);
  for (let x = 0; x < g.w; x++) g.paved[idx(g, x, 5)] = 1;
  const h = createHistory();
  for (const [def, x] of [["garage", 0], [house, at]] as const) {
    const cmd = placeCommand(g, structureDef(def)!, x, 4 - (structureDef(def)!.footprint.h - 1))!;
    for (const s of cmd.structures!.added) if (def.startsWith("kit:")) s.residents = residents;
    commit(g, h, cmd);
  }
  const ids = [...g.structures.values()].map((s) => s.id);
  return { g, ids, seating: () => seat(g, placesOf(g, createNetwork(g))) };
}

describe("the culture deck, where the map works it out", () => {
  test("is nothing with no cards, and is read again when the deck changes", () => {
    expect(cultureNow().desks).toBe(1);
    const v = cultureVersion();
    deck({ hotdesk: 1 });
    expect(cultureNow("intern").desks).toBe(1.5);
    expect(cultureVersion()).toBeGreaterThan(v);
  });

  test("Hot Desking: more desks at every workplace", () => {
    const { ids, seating } = street();
    expect(seating().desks.get(ids[0])!.of).toBe(20);
    deck({ hotdesk: 2 });
    expect(seating().desks.get(ids[0])!.of).toBe(40);
  });

  test("Crunch Week: those with no desk work at 70%, then in full", () => {
    // Twelve interns for a garage's twenty desks, halved by Mentorship: two left over.
    const { ids, seating } = street(6, 12, "kit:intern.t2");
    deck({ mentorship: 1 });
    const before = seating().commutes.get(ids[1])!;
    expect(before.deskless).toBe(2);
    expect(before.eff).toBeCloseTo((10 + 2 * DESKLESS) / 12, 9);
    deck({ mentorship: 1, crunch: 2 });
    expect(seating().commutes.get(ids[1])!.eff).toBeCloseTo(1, 9);
  });

  test("Remote Fridays: those at home need no desk and work in full", () => {
    // A house past the free commute, so the walk costs.
    const { ids, seating } = street(30, 4);
    const walked = seating().commutes.get(ids[1])!.eff;
    expect(walked).toBeLessThan(1);
    deck({ remote: 2 });
    const s = seating();
    expect(s.desks.get(ids[0])!.used).toBe(2);
    expect(s.commutes.get(ids[1])!.eff).toBeCloseTo((2 * walked + 2) / 4, 9);
  });

  test("Shuttle Bus: free commutes twice as far, then all the way", () => {
    expect(commuteEfficiency(FREE + 8)).toBeLessThan(1);
    deck({ shuttle: 1 });
    expect(commuteEfficiency(FREE + 8)).toBe(1);
    expect(commuteEfficiency(FREE + 40)).toBeLessThan(1);
    deck({ shuttle: 2 });
    expect(commuteEfficiency(FREE + 400)).toBe(1);
  });

  test("Company Housing: beds per house doubled, then tripled", () => {
    expect(housedBy("kit:intern.t1")!.slots).toBe(5);
    deck({ housing: 1 });
    expect(housedBy("kit:intern.t1")!.slots).toBe(10);
    deck({ housing: 2 });
    expect(housedBy("kit:vibe_coder.t2")!.slots).toBe(36);
  });

  test("house moods: the cards' own, spills halved by Therapy, and a workplace's lunch as food and coffee", () => {
    const g = createGrid(40, 40);
    const at = (s: Partial<Structure>, id: number) => g.structures.set(id, { id, x: 0, y: 0, w: 1, h: 1, def: "kit:intern.t0", ...s } as Structure);
    at({ x: 5, y: 5, residents: 2 }, 1);
    at({ def: "garage", x: 9, y: 5, w: 2 }, 2);
    const mood = () => moodsOf(g, new Map(), new Map(), new Set([1])).get(1)!;
    expect(mood().total).toBe(MOOD.noServices + MOOD.sludge);
    deck({ fourday: 1, therapy: 1, lunch: 1 });
    // Four-Day Week's +10, and three Wellness's set +10.
    expect(mood().total).toBe(NEED_MOOD.intern + Math.round(MOOD.sludge / 2) + 10 + 10);
  });

  test("leaders: Stack Ranking multiplies a rank's output; Open Plan leads everyone in full", () => {
    const l: Leader = { id: "l", role: "intern", name: "L", personality: "overachiever", rank: 3, xp: 0, perks: [], placedAt: 1 };
    const base = leaderEffects(l, 10, 100).output;
    deck({ stack: 1 });
    // The team in full, the other ninety at half: the rank's output once more over that.
    expect(leaderEffects(l, 10, 100).output - base).toBeCloseTo(3 * RANK_OUTPUT * ((10 + 0.5 * 90) / 100), 9);
    deck({ openplan: 1 });
    const all = leaderEffects(l, 10, 100), team = leaderEffects(l, 100, 100);
    expect(all.output).toBeCloseTo(team.output, 9);
  });

  test("Hot Desking's rule: vibe coders sit at the interns' garage", () => {
    const { ids, seating } = street(6, 4, "kit:vibe_coder.t1");
    expect(seating().commutes.get(ids[1])!.eff).toBe(STRANDED);
    deck({ hotdesk: 3 });
    const s = seating();
    expect(s.commutes.get(ids[1])!.eff).toBe(1);
    expect(s.desks.get(ids[0])!.used).toBe(4);
  });

  test("Company Housing's rule: a house beside its workplace needs no desks; one farther does", () => {
    const near = street(2, 5);
    deck({ housing: 3 });
    expect(near.seating().desks.get(near.ids[0])!.used).toBe(0);
    expect(near.seating().commutes.get(near.ids[1])!.eff).toBe(1);
    const far = street(20, 5);
    expect(far.seating().desks.get(far.ids[0])!.used).toBe(5);
  });

  test("Shuttle Bus's rule: a house with no road to work works in full", () => {
    const { ids, seating } = street(6, 4, "kit:vibe_coder.t1");
    deck({ shuttle: 3 });
    expect(seating().commutes.get(ids[1])!.eff).toBe(1);
  });

  test("Move Fast's rule: a workplace still going up seats people", () => {
    const { g, ids, seating } = street();
    g.structures.get(ids[0])!.build = {} as Build;
    expect(seating().desks.has(ids[0])).toBe(false);
    deck({ movefast: 3 });
    expect(seating().desks.get(ids[0])!.used).toBe(5);
  });

  test("Remote Fridays: who is at home, counted for their leader", () => {
    const { seating } = street(6, 4);
    deck({ remote: 3 });
    expect(seating().home.intern).toBe(2);
  });

  test("Free Lunch's rule: every need met", () => {
    const g = createGrid(40, 40);
    g.structures.set(1, { id: 1, x: 5, y: 5, w: 1, h: 1, def: "kit:intern.t0", residents: 2 } as Structure);
    g.structures.set(2, { id: 2, x: 9, y: 5, w: 2, h: 1, def: "garage" } as Structure);
    deck({ lunch: 3 });
    const m = moodsOf(g, new Map(), new Map(), new Set()).get(1)!;
    expect(m.total).toBe(2 * NEED_MOOD.intern);
  });

  test("Therapy Budget's rule: no one moves out, however miserable", () => {
    const { g, ids } = street(6, 4);
    const moods = new Map<number, MoodParts>([[ids[1], { total: -40, parts: [] }]]);
    stepMood(new Map(), g, moods, 61);
    expect(g.structures.get(ids[1])!.residents).toBe(3);
    deck({ therapy: 3 });
    stepMood(new Map(), g, moods, 61);
    expect(g.structures.get(ids[1])!.residents).toBe(3);
  });

  test("Open Plan's rule: every leader leads every kind", () => {
    const l: Leader = { id: "l", role: "intern", name: "L", personality: "overachiever", rank: 3, xp: 0, perks: [], placedAt: 1 };
    const owned = { intern: 10, vibe_coder: 10 };
    expect(leadersNow(owned, () => 1, [l]).of.vibe_coder).toBeUndefined();
    deck({ openplan: 3 });
    const of = leadersNow(owned, () => 1, [l]).of;
    expect(of.vibe_coder!.output).toBeCloseTo(of.intern!.output, 9);
    expect(of.vibe_coder!.output).toBeGreaterThan(1);
  });

  test("Stack Ranking's rule: ranks past five count", () => {
    const l: Leader = { id: "l", role: "intern", name: "L", personality: "overachiever", rank: 8, xp: 0, perks: [], placedAt: 1 };
    deck({ stack: 2 });
    const capped = leaderEffects(l, 10, 10).output;
    deck({ stack: 3 });
    expect(leaderEffects(l, 10, 10).output - capped).toBeCloseTo(3 * RANK_OUTPUT * 3, 9);
  });

  test("Move Fast: slop tanks half the size", () => {
    expect(tankFor(10)).toBe(10 * TANK_SECONDS);
    deck({ movefast: 1 });
    expect(tankFor(10)).toBe(5 * TANK_SECONDS);
  });
});
