import { describe, expect, test } from "bun:test";

import { choose, newMemory, type Purse } from "./chooser";
import { clock, dollars, shownAs, type Job } from "./job";
import { CANCEL_REST, FAULT_REST, PACE, WATCHDOG, createPilot, type Desk } from "./pilot";

const purse = (money: number, income = 0, reserve = 0): Purse => ({ money, income, reserve, innovation: 0, innovationRate: 0 });
const job = (id: string, cost: number, gain: number, more: Partial<Job> = {}): Job => ({
  id, desk: "people", says: id, why: "", cost, gain, run: () => ({ ok: true }), ...more,
});
const pick = (jobs: Job[], p: Purse, memory = newMemory(), now = 0, rev = 0) => choose(jobs, p, memory, now, rev).decision;

describe("the pilot's choice", () => {
  test("is the best payback it can afford", () => {
    const d = pick([job("dear", 100, 5), job("good", 100, 20), job("cheap", 10, 1)], purse(1000));
    expect(d).toMatchObject({ kind: "do", job: { id: "good" } });
  });

  test("saves for a better job it cannot pay for yet, and says how long", () => {
    // The best costs 1000 with 100 in hand at 10 a second: a minute and a half. The other pays back in 1000 seconds: it waits.
    const d = pick([job("best", 1000, 500), job("slow", 100, 0.1)], purse(100, 10));
    expect(d).toMatchObject({ kind: "saving", job: { id: "best" }, short: 900, seconds: 90 });
  });

  test("meanwhile takes a cheaper one that pays for itself before then: it brings the better nearer", () => {
    // 100 for 5 a second pays back in 20 seconds, against 90 of saving.
    const d = pick([job("best", 1000, 500), job("quick", 100, 5)], purse(100, 10));
    expect(d).toMatchObject({ kind: "do", job: { id: "quick" } });
  });

  test("with no income takes whatever earns, rather than save for ever", () => {
    expect(pick([job("best", 1000, 500), job("first", 5, 1)], purse(5, 0))).toMatchObject({ kind: "do", job: { id: "first" } });
    // And with nothing it can pay for, says so: saving, with no end in sight.
    const d = pick([job("best", 1000, 500)], purse(5, 0));
    expect(d).toMatchObject({ kind: "saving", job: { id: "best" } });
    expect(d.kind === "saving" && d.seconds).toBe(Infinity);
  });

  test("keeps its reserve back", () => {
    expect(pick([job("a", 100, 5)], purse(150, 1, 100))).toMatchObject({ kind: "saving", short: 50, seconds: 50 });
    expect(pick([job("a", 100, 5)], purse(200, 1, 100))).toMatchObject({ kind: "do" });
  });

  test("a job that waits on another says which, and the one it waits on is worth what it opens", () => {
    const studio = job("project:studio", 500, 0);
    const coder = job("hire:vibe_coder", 100, 60, { needs: [{ id: "project:studio", says: "the Vibe Coder Studio" }] });
    const intern = job("hire:intern", 50, 1);
    const c = choose([intern, coder, studio], purse(600), newMemory(), 0, 0);
    // The studio earns nothing itself: with the coder behind it, 60 for 600 beats the intern's 1 for 50.
    expect(c.decision).toMatchObject({ kind: "do", job: { id: "project:studio" } });
    expect(c.queue.find((q) => q.job.id === "hire:vibe_coder")!.shown).toEqual({ state: "waiting", on: { id: "project:studio", says: "the Vibe Coder Studio" } });
    // With nothing proposing what it waits on, the wait is still named.
    expect(pick([coder], purse(600))).toMatchObject({ kind: "waiting", on: { says: "the Vibe Coder Studio" } });
  });

  test("urgent goes first, and a pinned job before anything", () => {
    const jobs = [job("good", 100, 20), job("fire", 0, 0, { urgent: true }), job("whim", 100, 0.001)];
    expect(pick(jobs, purse(1000))).toMatchObject({ job: { id: "fire" } });
    const m = newMemory();
    m.pinned = "whim";
    expect(pick(jobs, purse(1000), m)).toMatchObject({ job: { id: "whim" } });
  });

  test("a refused job is left till its time is up or the map changes; a cancelled one for its while", () => {
    const m = newMemory();
    m.refused.set("a", { because: "no ground beside a road", until: Infinity, rev: 3 });
    expect(pick([job("a", 1, 1)], purse(10), m, 0, 3)).toMatchObject({ kind: "blocked", because: "no ground beside a road" });
    expect(pick([job("a", 1, 1)], purse(10), m, 0, 4)).toMatchObject({ kind: "do" });
    m.refused.set("a", { because: "not enough money", until: 5, rev: null });
    expect(pick([job("a", 1, 1)], purse(10), m, 4, 4)).toMatchObject({ kind: "blocked" });
    expect(pick([job("a", 1, 1)], purse(10), m, 5, 4)).toMatchObject({ kind: "do" });
    m.refused.clear();
    m.cancelled.set("a", 100);
    expect(pick([job("a", 1, 1)], purse(10), m, 50, 4)).toMatchObject({ kind: "idle" });
  });

  test("innovation is its own coin: saving money does not hold up what innovation buys", () => {
    const card = job("card", 5, 0, { costs: "innovation" });
    const d = choose([job("best", 1000, 500), card], { ...purse(0, 10), innovation: 10, innovationRate: 1 }, newMemory(), 0, 0).decision;
    expect(d).toMatchObject({ kind: "do", job: { id: "card" } });
  });

  test("every state has words", () => {
    expect(shownAs({ state: "ready" })).toBe("Next");
    expect(shownAs({ state: "saving", short: 361_000, seconds: 130 })).toBe("Saving · $361k short · 2:10");
    expect(shownAs({ state: "waiting", on: { id: "x", says: "a sewer into the block" } })).toBe("After: a sewer into the block");
    expect(shownAs({ state: "blocked", because: "no ground beside a road" })).toBe("Can't: no ground beside a road");
    expect(clock(3900)).toBe("1h 05m");
    expect(dollars(1_500_000)).toBe("$1.5M");
  });
});

describe("the pilot", () => {
  const desk = (jobs: () => Job[]): Desk => ({ id: "people", propose: jobs });
  /** Run it for so many seconds, a tenth at a time. */
  const run = (p: ReturnType<typeof createPilot>, seconds: number, money: () => Purse, rev = () => 0) => {
    for (let k = 0; k < seconds * 10; k++) p.tick(0.1, money(), rev());
  };

  test("does a job, at its pace, and always says what it is doing", () => {
    let bought = 0;
    const p = createPilot([desk(() => [job("hire", 10, 1, { says: "Hire 1 intern", run: () => { bought++; return { ok: true }; } })])]);
    run(p, PACE * 3 + 1, () => purse(1000));
    expect(bought).toBe(4);
    expect(p.done()).toBe(4);
    expect(p.last()).toBe("Hire 1 intern");
    expect(p.status().says.length).toBeGreaterThan(0);
    expect(p.log().every((l) => l.kind === "did")).toBe(true);
  });

  test("an urgent job does not wait for the pace", () => {
    let n = 0;
    const p = createPilot([desk(() => [job("answer", 0, 0, { urgent: true, run: () => { n++; return { ok: true }; } })])]);
    run(p, 2, () => purse(0));
    expect(n).toBeGreaterThan(2);
  });

  test("done is read off the world: an action that changed nothing is a refusal", () => {
    let tried = 0;
    const p = createPilot([desk(() => [job("lot", 10, 1, { run: () => { tried++; return { ok: true }; }, done: () => false })])]);
    run(p, 20, () => purse(1000));
    // Tried once, refused, and not again while the map stands as it did.
    expect(tried).toBe(1);
    expect(p.done()).toBe(0);
    expect(p.status()).toMatchObject({ kind: "blocked" });
    expect(p.status().says).toContain("it changed nothing");
    expect(p.log().at(-1)).toMatchObject({ kind: "refused" });
    // The map changes: tried again.
    run(p, 5, () => purse(1000), () => 1);
    expect(tried).toBe(2);
  });

  test("a job done once is not proposed again once the world shows it", () => {
    let built = false, runs = 0;
    const p = createPilot([desk(() => [job("upgrade", 10, 1, { run: () => { built = true; runs++; return { ok: true }; }, done: () => built })])]);
    run(p, 20, () => purse(1000));
    expect(runs).toBe(1);
    expect(p.status()).toMatchObject({ kind: "idle" });
  });

  test("never the same failing job twice running: the next is taken", () => {
    const order: string[] = [];
    const p = createPilot([desk(() => [
      job("best", 10, 100, { run: () => { order.push("best"); return { ok: false, because: "no ground", retry: "on-change" }; } }),
      job("next", 10, 1, { run: () => { order.push("next"); return { ok: true }; } }),
    ])]);
    run(p, PACE * 2 + 1, () => purse(1000));
    expect(order.slice(0, 3)).toEqual(["best", "next", "next"]);
  });

  test("the watchdog: jobs ready and nothing done for two minutes is a fault, said and logged; thrown when strict", () => {
    // Every job fails and may be tried again at once: ready, always, and never done.
    const failing = () => [job("a", 1, 2, { says: "Lay a street", run: () => ({ ok: false, because: "refused", retry: 0 }) })];
    const p = createPilot([desk(failing)]);
    run(p, WATCHDOG + 5, () => purse(1000));
    expect(p.faults()).toBe(1);
    expect(p.log().some((l) => l.kind === "fault" && l.text.includes("Lay a street"))).toBe(true);
    // Left alone for its rest: nothing ready, so no second fault.
    run(p, WATCHDOG + 5, () => purse(1000));
    expect(p.faults()).toBe(1);
    expect(FAULT_REST).toBeGreaterThan(WATCHDOG);
    const strict = createPilot([desk(failing)], { strict: true });
    expect(() => run(strict, WATCHDOG + 5, () => purse(1000))).toThrow(/pilot fault/);
  });

  test("the player's hand: cancel, do next, pause, a desk off", () => {
    const done: string[] = [];
    const jobs = () => [job("good", 10, 100, { run: () => { done.push("good"); return { ok: true }; } }), job("poor", 10, 1, { run: () => { done.push("poor"); return { ok: true }; } })];
    const p = createPilot([desk(jobs)]);
    p.cancel("good");
    run(p, 1, () => purse(1000));
    expect(done).toEqual(["poor"]);
    expect(p.queue().find((q) => q.job.id === "good")!.shown.state).toBe("cancelled");
    expect(CANCEL_REST).toBeGreaterThan(60);
    p.doNext("good");
    run(p, PACE + 1, () => purse(1000));
    expect(done.at(-1)).toBe("good");
    p.pause(true);
    const before = done.length;
    run(p, 10, () => purse(1000));
    expect(done.length).toBe(before);
    expect(p.status()).toMatchObject({ kind: "paused", says: "Paused" });
    p.pause(false);
    p.setDesk("people", false);
    run(p, 10, () => purse(1000));
    expect(done.length).toBe(before);
    expect(p.status()).toMatchObject({ kind: "idle" });
  });
});
