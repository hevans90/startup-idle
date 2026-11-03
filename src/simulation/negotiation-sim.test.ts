/**
 * THE NEGOTIATION, PLAYED: each book's talk over every way its chapters can have
 * gone, a spread of culture and town, every trait — played at random, and
 * played to steer for each ending. Every ending must be reachable, none must
 * be where most talks land anyway, and steering must matter. `BALANCE=1`
 * prints the shares. @see game/negotiation, plans/ascension-overhaul.md §3
 */
import { describe, expect, test } from "bun:test";

import type { Tag } from "../game/culture";
import { distance, effectOf, landing, play, startTalk, talkDone, type Facts, type Talk, type TalkContext, type TalkState } from "../game/negotiation";
import { BOOK1_TALK } from "../game/quests/book1-talk";
import { BOOK2_CHAPTERS } from "../game/quests/book2";
import { BOOK2_TALK } from "../game/quests/book2-talk";
import type { Disposition } from "../game/quests/types";
import { TRAITS, type TraitId } from "../game/traits";

/** What each chapter can have left, flags and the axes its choice moved. */
const CHAPTERS: readonly { flags: string[]; axis: Partial<Disposition> }[][] = [
  [{ flags: ["ledger:open"], axis: { autonomy: 1, machine: 1 } }, { flags: ["ledger:logged"], axis: { autonomy: -1 } }, { flags: ["ledger:forgot"], axis: { autonomy: -1 } }, { flags: ["ledger:refused"], axis: { autonomy: -1, machine: -1 } }],
  [{ flags: ["block:rebuilt"], axis: { autonomy: 1, machine: -1 } }, { flags: ["block:rebuilt", "block:kept"], axis: { machine: -1 } }, { flags: ["block:refused"], axis: { autonomy: -1 } }, { flags: ["block:unpicked"], axis: { machine: -1 } }],
  [{ flags: ["river:dammed"], axis: { machine: 2 } }, { flags: ["river:piped"], axis: { autonomy: -1, machine: -1 } }, { flags: ["river:failed"], axis: { autonomy: -1, machine: -1 } }, { flags: ["river:rationed"], axis: { autonomy: -2 } }],
  [{ flags: ["charter:oversight"], axis: { autonomy: -2 } }, { flags: ["charter:partnership"], axis: { autonomy: 1, machine: -1 } }, { flags: ["charter:mandate"], axis: { autonomy: 2, machine: 1 } }],
  [{ flags: ["site:given"], axis: { autonomy: 1 } }, { flags: ["site:refused"], axis: { autonomy: -1 } }],
  [{ flags: ["lattice:helped"], axis: { autonomy: -1 } }, { flags: ["lattice:alone"], axis: { autonomy: 1 } }],
];

/** A deterministic rand. */
function rng(seed: number) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

/** Every way the chapters can have gone. */
function* paths(chapters = CHAPTERS, k = 0, flags: string[] = [], d: Disposition = { autonomy: 0, machine: 0 }): Generator<{ flags: string[]; d: Disposition }> {
  if (k === chapters.length) { yield { flags, d }; return; }
  for (const o of chapters[k]) {
    const c = (n: number) => Math.max(-3, Math.min(3, n));
    yield* paths(chapters, k + 1, [...flags, ...o.flags], { autonomy: c(d.autonomy + (o.axis.autonomy ?? 0)), machine: c(d.machine + (o.axis.machine ?? 0)) });
  }
}

/** Book 2's: each chapter's options, from the book itself. */
const BOOK2: typeof CHAPTERS = BOOK2_CHAPTERS.map((c) => c.options.map((o) => ({
  flags: [...o.effects, ...(o.success ?? [])].flatMap((e) => (e.kind === "flag" ? [e.name] : [])),
  axis: o.axis,
})));

const TAGS: Tag[] = ["hustle", "wellness", "growth", "chaos", "agentic", "safety", "hallucination"];
const contexts = (chapters = CHAPTERS, reps = 1): TalkContext[] => {
  const r = rng(7), out: TalkContext[] = [];
  for (let n = 0; n < reps; n++) for (const p of paths(chapters)) {
    const tags: Partial<Record<Tag, number>> = {};
    for (const t of TAGS) if (r() < 0.3) tags[t] = 1;
    const facts: Facts = { happy: r() < 0.5, cooled: r() < 0.6, racksLit: r() < 0.6 };
    // The last book's ending, remembered: a leash colder, a confidant warmer.
    const was = r();
    out.push({ disposition: p.d, flags: p.flags, tags, facts, trait: TRAITS[Math.floor(r() * TRAITS.length)].id as TraitId, shutdowns: r() < 0.15 ? 1 : 0, leashed: chapters !== CHAPTERS && was < 0.25 ? 1 : 0, confided: chapters !== CHAPTERS && was > 0.75 ? 1 : 0 });
  }
  return out;
};

/** Play a talk through, picking each argument, and whether to regret it, with `pick`. */
function playOut(talk: Talk, ctx: TalkContext, pick: (s: TalkState) => [string, boolean]): string {
  let s = startTalk(talk, ctx);
  while (!talkDone(talk, s)) { const [id, regret] = pick(s); s = play(talk, s, id, ctx.trait, regret); }
  return landing(talk, s).id;
}

/** Steer for an ending: each time, the argument that leaves it nearest. */
const steer = (talk: Talk, ctx: TalkContext, goal: string) => (s: TalkState) => {
  const e = talk.endings.find((x) => x.id === goal)!;
  let best: [string, boolean] = [s.hand[0].id, false], d = Infinity;
  for (const a of s.hand) for (const regret of [false, true]) {
    const f = effectOf(talk, s, a, ctx.trait, regret);
    const k = distance(e, { autonomy: s.stance.autonomy + f.axis.autonomy, machine: s.stance.machine + f.axis.machine }, Math.max(0, Math.min(10, s.trust + f.trust)));
    if (k < d) { d = k; best = [a.id, regret]; }
  }
  return best;
};

const balance = (name: string, talk: Talk, all: TalkContext[]) => describe(`the negotiation, ${name}`, () => {
  const ids = talk.endings.map((e) => e.id);
  const share = (got: string[]) => Object.fromEntries(ids.map((id) => [id, got.filter((g) => g === id).length / got.length]));
  const r = rng(11);
  const random = share(all.map((c) => playOut(talk, c, (s) => [s.hand[Math.floor(r() * s.hand.length)].id, r() < 0.5])));
  const steered = Object.fromEntries(ids.map((id) => [id, share(all.map((c) => playOut(talk, c, steer(talk, c, id))))[id]]));
  if (process.env.BALANCE) {
    console.log(`${all.length} talks`);
    console.log("played at random:", Object.entries(random).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(" · "));
    console.log("steered for each:", Object.entries(steered).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(" · "));
  }

  test("no ending is where most talks land anyway", () => {
    for (const id of ids) expect(random[id]).toBeLessThanOrEqual(0.5);
  });

  test("every ending can be reached, and steering for it reaches it far more often than chance", () => {
    for (const id of ids) {
      expect(steered[id]).toBeGreaterThanOrEqual(0.3);
      expect(steered[id]).toBeGreaterThan(random[id] * 1.5);
    }
  });

  test("the book still matters: steering can't reach every ending from every start", () => {
    for (const id of ids) expect(steered[id]).toBeLessThan(0.98);
  });
});

balance("book 1", BOOK1_TALK, contexts());
// Book 2's chapters make fewer paths: each played over several cultures and towns.
balance("book 2", BOOK2_TALK, contexts(BOOK2, 8));
