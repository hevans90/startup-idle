/**
 * THE CONSOLE'S MOTION: how much it moves and decorates itself, now. Calm —
 * chosen in settings, or asked for by the system's reduced motion — means
 * frames are simply there, text whole and nothing moves behind, and the
 * takeover's mix is held at nothing. Otherwise the decoration grows with the
 * mix: frames draw on from the Colleague, headers decipher from the Manager,
 * the backgrounds' lines run behind dialogs from the Overseer.
 * @see plans/ui-overhaul.md §1.4
 */
import { createContext, useContext } from "react";

import { stageOf, useAiSingularityStore } from "../../state/ai-singularity.store";
import { useGlobalSettingsStore } from "../../state/global-settings.store";
import { CONSOLE_AI } from "../theme/tokens";
import { reducedMotion, useReducedMotion } from "./reduced";

/** Where each piece of decoration begins, on the takeover's mix. */
export const DRAWS_FROM = CONSOLE_AI.colleague;
export const DECIPHERS_FROM = CONSOLE_AI.manager;
export const MOVES_FROM = CONSOLE_AI.overseer;

/** THE BUDGETS: the longest an entrance takes, s; the gap between staggered rows, ms, and the most rows staggered. */
export const ENTER_MOST = 0.8;
export const STAGGER_MS = 30;
export const STAGGER_MOST = 10;

export type ConsoleMotion = {
  /** Calm: nothing animates. */
  calm: boolean;
  /** The takeover's mix, 0–1; nothing when calm. */
  mix: number;
  /** Whether frames draw on, headers decipher, and backgrounds move. */
  draws: boolean;
  deciphers: boolean;
  moves: boolean;
};

/** The console's motion, from the mix and whether it is calm. */
export function consoleMotion(mix: number, calm: boolean): ConsoleMotion {
  const m = calm ? 0 : mix;
  return { calm, mix: m, draws: !calm && m >= DRAWS_FROM, deciphers: !calm && m >= DECIPHERS_FROM, moves: !calm && m >= MOVES_FROM };
}

/** The mix the meter's stage gives, before calm. */
export const stageMix = (value: number): number => CONSOLE_AI[stageOf(value).stage] ?? 0;

/** Whether the console is calm now: chosen, or the system's reduced motion. */
export const isCalm = (): boolean => useGlobalSettingsStore.getState().motion === "calm" || reducedMotion();

/**
 * A MIX AND A CALM GIVEN, for what is under it: the kit's gallery showing
 * every stage and level, and tests — without touching the meter or the
 * settings, which are saved.
 */
export const ConsoleMotionOverride = createContext<{ mix?: number; calm?: boolean } | null>(null);

/** The console's motion now, as a hook. */
export function useConsoleMotion(): ConsoleMotion {
  const given = useContext(ConsoleMotionOverride);
  const reduced = useReducedMotion();
  const chosen = useGlobalSettingsStore((s) => s.motion);
  const mix = useAiSingularityStore((s) => stageMix(s.value));
  return consoleMotion(given?.mix ?? mix, given?.calm ?? (reduced || chosen === "calm"));
}
