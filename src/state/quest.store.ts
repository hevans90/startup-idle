/**
 * THE ARC: the first generation's story with its AI — what it has been asked,
 * what was chosen, where that has left it (its disposition), what it
 * remembers (its echoes) and what is still running (an objective on the map).
 * Kept across sales, closed at the Ascension into the record the dossier
 * keeps. @see game/quests, plans/ai-takeover.md §5
 *
 * TRIGGERS: a chapter is offered the first time the meter reaches its stage,
 * in any company of the first generation; between chapters, from the
 * Colleague on, a request every 8–12 minutes, leant by the trait the AI is
 * becoming. One thing is asked at a time. Ignored, it picks for itself: a
 * chapter after 10 minutes, a request after 2 — and what it picks does not
 * move its disposition, which is what the PLAYER's choices add up to: an arc
 * left to itself opens no ending.
 *
 * TIME is played time. Every window — an objective's, the wait before it picks
 * for itself, the gap to the next request — counts only seconds the game was
 * looked at, so nothing fires or resolves while away, and an objective's
 * window is never spent by time away. A step longer than `LONGEST_STEP` is
 * time away, and moves nothing.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { AXIS_MOST, ONCE, type Chapter, type Disposition, type Effect, type Objective, type Option, type Request } from "../game/quests/types";
import { CHAPTERS, REQUESTS } from "../game/quests/chapters";
import { measure, type QuestWorld } from "../game/quests/objectives";
import type { Family } from "../game/traits";
import type { Stage } from "./ai-singularity.store";
import { useGenerationStore } from "./generation.store";

/** Seconds a chapter, and a request, waits before it picks for itself. */
export const CHAPTER_WAIT = 600;
export const REQUEST_WAIT = 120;
/** Seconds between requests, the least and most. */
export const REQUEST_EVERY = [480, 720] as const;
/** The stage requests begin at. */
export const REQUESTS_FROM: Stage = "colleague";
/** A step longer than this, seconds, is time away: it moves nothing. */
export const LONGEST_STEP = 5;

/** What is being asked now. */
export type Offer = { kind: "chapter" | "request"; id: string; waited: number };
/** An objective under way: whose, how long it has run, and what it has measured. */
export type Running = {
  kind: "chapter" | "request"; id: string; option: number; spec: Objective;
  elapsed: number; progress: number;
  /** Seconds held, for an objective that adds them up; what stood when it began, for one that counts. */
  held: number; baseline?: number; aiBuilt?: boolean;
};
/** A generation's arc, as the dossier keeps it. */
export type ArcRecord = { generation: number; chapters: Record<string, number>; disposition: Disposition; flags: string[]; ending?: string | null };

type QuestState = {
  offer: Offer | null;
  /** Chapters and requests answered: the option chosen. */
  chapters: Record<string, number>;
  requests: Record<string, number>;
  objective: Running | null;
  disposition: Disposition;
  /** Where it has stood after each answer: its path on the dossier's chart. */
  path: Disposition[];
  flags: string[];
  /** Every effect chosen this generation, in force — those that last a while, till their `until`. @see game/quests/effects */
  effects: Effect[];
  /** Seconds of play this generation: the clock a lasting effect's `until` is on. */
  clock: number;
  /** Seconds of play to the next request; null till requests begin. */
  requestIn: number | null;
  /**
   * The player's answers to objectives that ask for a place, in this company
   * (each has its own map): a block picked, by its middle; the building in it
   * kept, by id; a site given, by its middle. And what the next click on the
   * map picks, while it is picking.
   */
  block: { x: number; y: number } | null;
  keep: number | null;
  site: { x: number; y: number } | null;
  picking: "block" | "keep" | "site" | null;
  /** Effects done once, waiting for the map to do them. @see ONCE */
  actions: Effect[];
  /** The Lattice's form, fixed when it was begun. @see game/quests/finale */
  latticeForm: "spire" | "garden" | "open" | "vault" | "river" | null;
  /** What it has to say of how things turned out, for the memos; taken by the scene. */
  said: string[];
  record: ArcRecord[];
  /** Whether the Data Centre is fully cooled, as last measured: what an agent cap may wait on. Not saved. */
  dcCooled: boolean;

  /** Answer what is asked: from the game's chapters and requests, or those given. */
  choose: (option: number, chapters?: readonly Chapter[], requests?: readonly Request[]) => void;
  /** The AI put up a building, for an objective that waits on it. */
  noteAiBuilt: (def: string) => void;
  pickBlock: (at: { x: number; y: number }) => void;
  keepBuilding: (id: number) => void;
  giveSite: (at: { x: number; y: number }) => void;
  setPicking: (what: QuestState["picking"]) => void;
  /** A new company: its map's block and site forgotten. */
  newCompany: () => void;
  /** A second or so of play. */
  step: (world: QuestWorld, dt: number, rand?: () => number, chapters?: readonly Chapter[], requests?: readonly Request[]) => void;
  /** The Ascension: this generation's arc into the record, with the ending it closed on, and a fresh one. */
  closeArc: (ending?: string | null) => void;
  /** The Lattice begun: its form fixed. */
  fixLatticeForm: (form: QuestState["latticeForm"]) => void;
  reset: () => void;
};

const fresh = () => ({
  offer: null, chapters: {}, requests: {}, objective: null, disposition: { autonomy: 0, machine: 0 }, path: [],
  flags: [], effects: [], clock: 0, requestIn: null, block: null, keep: null, site: null, picking: null, actions: [], latticeForm: null, said: [],
});
/** Effects split: those read while they last — a lasting one timed from `clock` — and those done once. */
const split = (es: readonly Effect[], clock: number) => ({
  lasting: es.filter((e) => !ONCE.has(e.kind)).map((e) => (e.lasts ? { ...e, until: clock + e.lasts } : e)),
  once: es.filter((e) => ONCE.has(e.kind)),
});

const clamp = (n: number) => Math.max(-AXIS_MOST, Math.min(AXIS_MOST, n));

/** The option an offer stands for. */
export function offered(o: { kind: Offer["kind"]; id: string }, chapters: readonly Chapter[] = CHAPTERS, requests: readonly Request[] = REQUESTS): { options: readonly Option[]; preferred: number } | null {
  const c = o.kind === "chapter" ? chapters.find((x) => x.id === o.id) : requests.find((x) => x.id === o.id);
  return c ?? null;
}

/** Seconds to the next request, for a roll of the dice. */
const nextRequestIn = (roll: number) => REQUEST_EVERY[0] + roll * (REQUEST_EVERY[1] - REQUEST_EVERY[0]);

/** A request to ask, leant by the families the AI is becoming: one not asked this generation. */
function pickRequest(requests: readonly Request[], done: Record<string, number>, lean: Partial<Record<Family, number>>, rand: () => number): Request | null {
  const open = requests.filter((r) => !(r.id in done));
  if (!open.length) return null;
  const w = open.map((r) => 1 + 3 * (lean[r.family] ?? 0));
  let k = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < open.length; i++) { k -= w[i]; if (k < 0) return open[i]; }
  return open[open.length - 1];
}

/** Where the family odds come from: a reader the AI registers, so this store does not reach into the trait model. */
let familyLean: () => Partial<Record<Family, number>> = () => ({});
export const setFamilyLean = (read: () => Partial<Record<Family, number>>) => { familyLean = read; };

export const useQuestStore = create<QuestState>()(
  persist(
    (set, get) => {
      /** An answer: the axes moved, its effects in force, its objective begun. */
      const answer = (offer: Offer, index: number, chapters: readonly Chapter[], requests: readonly Request[], picked = false) => {
        const q = offered(offer, chapters, requests);
        const opt = q?.options[index];
        if (!opt) return;
        const s = get();
        // Picked for itself, it leaves the disposition where it was.
        const disposition = picked ? s.disposition
          : { autonomy: clamp(s.disposition.autonomy + (opt.axis.autonomy ?? 0)), machine: clamp(s.disposition.machine + (opt.axis.machine ?? 0)) };
        set({
          offer: null,
          [offer.kind === "chapter" ? "chapters" : "requests"]: { ...s[offer.kind === "chapter" ? "chapters" : "requests"], [offer.id]: index },
          disposition, path: picked ? s.path : [...s.path, disposition],
          effects: [...s.effects, ...split(opt.effects, s.clock).lasting],
          actions: [...s.actions, ...split(opt.effects, s.clock).once],
          said: opt.reply ? [...s.said, opt.reply] : s.said,
          flags: [...new Set([...s.flags, ...opt.effects.flatMap((e) => (e.kind === "flag" ? [e.name] : []))])],
          // One objective at a time: a new one takes the place of one still running, which is let go, not failed.
          objective: opt.objective ? { kind: offer.kind, id: offer.id, option: index, spec: opt.objective, elapsed: 0, progress: 0, held: 0 } : s.objective,
        });
      };
      /** An objective's end: what follows, in force. */
      const resolve = (met: boolean, chapters: readonly Chapter[], requests: readonly Request[]) => {
        const s = get(), o = s.objective;
        if (!o) return;
        const opt = offered(o, chapters, requests)?.options[o.option];
        const more = (met ? opt?.success : opt?.failure) ?? [];
        const says = met ? opt?.successSays : opt?.failureSays;
        set({
          objective: null, picking: null,
          effects: [...s.effects, ...split(more, s.clock).lasting],
          actions: [...s.actions, ...split(more, s.clock).once],
          flags: [...new Set([...s.flags, ...more.flatMap((e) => (e.kind === "flag" ? [e.name] : []))])],
          said: says ? [...s.said, says] : s.said,
        });
      };
      return {
        ...fresh(),
        record: [],
        dcCooled: false,

        choose: (option, chapters = CHAPTERS, requests = REQUESTS) => { const o = get().offer; if (o) answer(o, option, chapters, requests); },
        noteAiBuilt: (def) => {
          const o = get().objective;
          if (o && o.spec.kind === "aiBuilds" && o.spec.def === def) set({ objective: { ...o, aiBuilt: true } });
        },
        pickBlock: (block) => set({ block, keep: null }),
        keepBuilding: (keep) => set({ keep }),
        giveSite: (site) => set({ site }),
        setPicking: (picking) => set({ picking }),
        newCompany: () => set({ block: null, keep: null, site: null, picking: null }),

        step: (world, dt, rand = Math.random, chapters = CHAPTERS, requests = REQUESTS) => {
          if (dt <= 0 || dt > LONGEST_STEP) return;
          if (get().dcCooled !== world.dcCooled >= 1) set({ dcCooled: world.dcCooled >= 1 });
          // THE ARC IS THE FIRST GENERATION'S. @see plans/ai-takeover.md open question 6
          if (useGenerationStore.getState().generation !== 1) return;
          // THE ARC'S CLOCK, and what has run out on it.
          const clock = get().clock + dt;
          const expired = get().effects.some((e) => e.until !== undefined && e.until <= clock);
          set(expired ? { clock, effects: get().effects.filter((e) => e.until === undefined || e.until > clock) } : { clock });
          let s = get();
          // AN OBJECTIVE, measured; met, or out of time.
          if (s.objective) {
            const o = s.objective;
            const next: Running = { ...o, elapsed: o.elapsed + dt };
            if (next.spec.kind === "buildBy" && next.baseline === undefined) next.baseline = world.counts[next.spec.def] ?? 0;
            const { progress, held } = measure(next, world, dt);
            next.progress = progress; next.held = held;
            set({ objective: next });
            if (progress >= 1) resolve(true, chapters, requests);
            else if (next.elapsed >= o.spec.window) resolve(false, chapters, requests);
            s = get();
          }
          // WHAT IS ASKED, waiting; ignored, it picks for itself.
          if (s.offer) {
            const waited = s.offer.waited + dt;
            const q = offered(s.offer, chapters, requests);
            if (!q) { set({ offer: null }); return; }
            if (waited >= (s.offer.kind === "chapter" ? CHAPTER_WAIT : REQUEST_WAIT)) answer(s.offer, q.preferred, chapters, requests, true);
            else set({ offer: { ...s.offer, waited } });
            return;
          }
          // A CHAPTER, the first time the meter reaches it.
          const due = chapters.find((c) => !(c.id in s.chapters) && world.meter >= (c.at ?? world.stageFrom[c.stage]));
          if (due) { set({ offer: { kind: "chapter", id: due.id, waited: 0 } }); return; }
          // A REQUEST, between them, from the Colleague on.
          if (world.meter < world.stageFrom[REQUESTS_FROM] || !requests.length) return;
          const left = (s.requestIn ?? nextRequestIn(rand())) - dt;
          if (left > 0) { set({ requestIn: left }); return; }
          const r = pickRequest(requests, s.requests, familyLean(), rand);
          set({ requestIn: nextRequestIn(rand()), offer: r ? { kind: "request", id: r.id, waited: 0 } : null });
        },

        fixLatticeForm: (latticeForm) => { if (!get().latticeForm) set({ latticeForm }); },
        closeArc: (ending = null) => {
          const s = get();
          const done: ArcRecord = { generation: useGenerationStore.getState().generation, chapters: s.chapters, disposition: s.disposition, flags: s.flags, ending };
          set({ ...fresh(), record: Object.keys(s.chapters).length ? [...s.record, done] : s.record });
        },
        reset: () => set({ ...fresh(), record: [], dcCooled: false }),
      };
    },
    {
      name: "quests",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ dcCooled: _d, ...s }) =>
        Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v !== "function")) as Partial<QuestState>,
    },
  ),
);
