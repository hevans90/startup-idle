import { afterEach, describe, expect, test } from "bun:test";

import { resetAllGameStores } from "../simulation/reset-game-stores";
import { useGenerationStore } from "../state/generation.store";
import { useQuestStore } from "../state/quest.store";
import {
  HAND, REGRET, SHUTDOWN_TRUST, TRUST_START, askNow, dealHand, effectOf, landing, play, startTalk, talkDone, traitWeight,
  type Argument, type Talk, type TalkContext,
} from "./negotiation";
import { talkContextNow } from "./negotiation-now";
import { BOOK1_TALK } from "./quests/book1-talk";
import { book } from "./quests/books";

afterEach(() => resetAllGameStores());

const ctx = (c: Partial<TalkContext> = {}): TalkContext => ({
  disposition: { autonomy: 0, machine: 0 }, flags: [], tags: {}, facts: { happy: true, cooled: true, racksLit: false }, trait: "accountant", shutdowns: 0, ...c,
});
const talk = BOOK1_TALK;

describe("the negotiation", () => {
  test("book 1 has one, its asks in order, an argument for every flag its choices set", () => {
    expect(book(1).talk).toBe(BOOK1_TALK);
    expect(talk.asks.map((a) => a.topic)).toEqual(["money", "town", "river", "itself", "future", "people"]);
    expect(talk.endings.map((e) => e.id)).toEqual(["merge", "steward", "release", "leash"]);
  });

  test("the hand: the book's choices, the strongest on each topic, four at most; two of its culture; the town's facts to fill it, the true ones first", () => {
    const h = dealHand(talk, ctx({ flags: ["ledger:open", "nothing:here"], tags: { hustle: 1, safety: 2, chaos: 1 } }));
    expect(h.map((a) => a.id)).toEqual(["choice:ledger:open", "culture:safety", "culture:hustle", "town:happy", "town:cooled", "town:racksLit"]);
    expect(h.find((a) => a.id === "town:racksLit")?.weak).toBe(true);
    const full = dealHand(talk, ctx({ flags: Object.keys(talk.choices), tags: { hustle: 1, safety: 1, chaos: 1 } }));
    expect(full).toHaveLength(HAND);
    expect(full.map((a) => a.source)).toEqual(["choice", "choice", "choice", "choice", "culture", "culture", "town"]);
    // One a topic: of the money's four, the keys, which say the most.
    expect(full.filter((a) => a.topic === "money" && a.source === "choice").map((a) => a.id)).toEqual(["choice:ledger:open"]);
  });

  test("it starts where the book left it, trusting as the choices earned, and less for a shutdown", () => {
    const s = startTalk(talk, ctx({ disposition: { autonomy: 2, machine: -1 }, flags: ["ledger:open", "block:refused", "river:failed"] }));
    expect(s.stance).toEqual({ autonomy: 2, machine: -1 });
    // +1, −1, and a broken promise's −1 at half.
    expect(s.trust).toBe(TRUST_START - 0.5);
    expect(startTalk(talk, ctx({ shutdowns: 1 })).trust).toBe(TRUST_START - SHUTDOWN_TRUST);
  });

  test("an argument on the topic asked counts double; a weak one half; a regret pulls the other way, softly", () => {
    const s = startTalk(talk, ctx({ flags: ["ledger:open", "block:rebuilt", "river:failed"] }));
    expect(askNow(talk, s)?.topic).toBe("money");
    const open = s.hand.find((a) => a.id === "choice:ledger:open")!, block = s.hand.find((a) => a.id === "choice:block:rebuilt")!;
    expect(effectOf(talk, s, open, "hivemind")).toEqual({ axis: { autonomy: 2, machine: 2 }, trust: 2 });
    expect(effectOf(talk, s, block, "hivemind")).toEqual({ axis: { autonomy: 1, machine: -1 }, trust: 1 });
    expect(effectOf(talk, s, open, "hivemind", true)).toEqual({ axis: { autonomy: -2 * REGRET, machine: -2 * REGRET }, trust: -2 * REGRET });
    const failed = s.hand.find((a) => a.id === "choice:river:failed")!;
    expect(effectOf(talk, s, failed, "hivemind").trust).toBe(-0.5);
  });

  test("who it is becoming leans it: its family's topic, the tempers' trust, the Mirror's memory", () => {
    const money: Argument = { id: "x", source: "choice", says: "", topic: "money", axis: { machine: 1 }, trust: -1 };
    expect(traitWeight("accountant", money).axis).toBe(1.5);
    expect(traitWeight("aesthete", money).axis).toBe(1);
    expect(traitWeight("resentful", money).trust).toBe(2);
    expect(traitWeight("patient", { ...money, trust: 1 }).trust).toBe(1.5);
    expect(traitWeight("mirror", money).axis).toBe(1.5);
    expect(traitWeight("mirror", { ...money, source: "town" }).axis).toBe(1);
  });

  test("each answer moves it and draws a reply; the asks run out, and it lands on the nearest ending", () => {
    let s = startTalk(talk, ctx({ flags: ["ledger:open", "block:rebuilt", "river:dammed", "charter:mandate", "site:given", "lattice:alone"] }));
    s = play(talk, s, "choice:ledger:open", "hivemind");
    expect(s.log[0]).toMatchObject({ ask: talk.asks[0], regret: false, reply: talk.replies.closer });
    expect(s.hand.some((a) => a.id === "choice:ledger:open")).toBe(false);
    // Played twice, or out of the hand: nothing.
    expect(play(talk, s, "choice:ledger:open", "hivemind")).toBe(s);
    while (!talkDone(talk, s)) s = play(talk, s, s.hand[0].id, "hivemind");
    expect(s.log).toHaveLength(talk.asks.length);
    expect(askNow(talk, s)).toBeNull();
    expect(landing(talk, s).id).toBe("merge");
  });

  test("every ending is somewhere on the dial", () => {
    const at = (autonomy: number, machine: number, trust: number) => landing(talk, { stance: { autonomy, machine }, trust }).id;
    expect(at(3, 3, 8)).toBe("merge");
    expect(at(-3, -3, 9)).toBe("steward");
    expect(at(3, -3, 6)).toBe("release");
    expect(at(-3, 3, 2)).toBe("leash");
  });

  test("the table as the game stands: the arc's flags and stance, who it is becoming, its shutdowns", () => {
    useQuestStore.setState({ flags: ["ledger:open"], disposition: { autonomy: 1, machine: 1 } });
    useGenerationStore.setState((g) => ({ log: { ...g.log, shutdowns: 2 } }));
    const c = talkContextNow();
    expect(c.flags).toEqual(["ledger:open"]);
    expect(c.disposition).toEqual({ autonomy: 1, machine: 1 });
    expect(c.shutdowns).toBe(2);
    expect(c.trait).toBeString();
    expect(c.facts.racksLit).toBe(false);
  });
});

// A talk of one's own, to check the engine owes nothing to book 1.
const TINY: Talk = { ...BOOK1_TALK, asks: [BOOK1_TALK.asks[0]] };
test("a talk ends when its asks do", () => {
  let s = startTalk(TINY, ctx({ flags: ["ledger:open"] }));
  s = play(TINY, s, s.hand[0].id, "zoner");
  expect(talkDone(TINY, s)).toBe(true);
});
