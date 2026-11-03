/**
 * THE NEGOTIATION UNDER WAY: begun from the Ascension card, played an
 * argument at a time, left and come back to while the AI waits. Not saved: a
 * reload begins it again. @see game/negotiation, NegotiationScreen
 */
import { create } from "zustand";

import { play, startTalk, type TalkState } from "../game/negotiation";
import type { Disposition } from "../game/quests/types";
import { talkContextNow } from "../game/negotiation-now";
import type { TraitId } from "../game/traits";
import { bookNow } from "../game/quests/books";

type TalkStore = {
  state: TalkState | null;
  /** Where it stood, and how far it trusted you, before the first answer: the start of its path on the dial. */
  from: { stance: Disposition; trust: number } | null;
  /** Who the AI is becoming, fixed as the talk begins. */
  trait: TraitId | null;
  /** On screen. */
  open: boolean;
  begin: () => void;
  answer: (id: string, regret: boolean) => void;
  close: () => void;
  /** Over: forgotten, for the next generation's. */
  clear: () => void;
};

export const useTalkStore = create<TalkStore>()((set, get) => ({
  state: null,
  from: null,
  trait: null,
  open: false,
  begin: () => {
    const talk = bookNow().talk;
    if (!talk) return;
    if (get().state) return set({ open: true });
    const ctx = talkContextNow();
    const state = startTalk(talk, ctx);
    set({ state, from: { stance: state.stance, trust: state.trust }, trait: ctx.trait, open: true });
  },
  answer: (id, regret) => {
    const { state, trait } = get(), talk = bookNow().talk;
    if (!state || !trait || !talk) return;
    set({ state: play(talk, state, id, trait, regret) });
  },
  close: () => set({ open: false }),
  clear: () => set({ state: null, from: null, trait: null, open: false }),
}));
