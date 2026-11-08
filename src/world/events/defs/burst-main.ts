/**
 * A BURST MAIN: the longest main that feeds anything breaks at a joint. What
 * it would carry pours out there, into the street, and nothing reaches its
 * buildings until it is mended. Send the interns to dig it up (every one off
 * work till it is mended), pay a contractor (mended sooner), or let it pour
 * till the water company gets round to it. A second main into a building,
 * or a loop, is the built answer: only this one breaks. @see setBurst
 */
import { CREW_SHARE, minutes, type EventDef } from "../events";

export const BURST_WARN_MS = 30_000;
/** How long it pours, let; and mended by the interns, and by a contractor. */
export const BURST_MS = 360_000;
export const MEND_MS = 120_000;
export const CONTRACT_MS = 30_000;
/** Seconds of income the contractor costs. */
export const CONTRACT_SECONDS = 90;

export const BURST_MAIN: EventDef = {
  kind: "burst-main",
  where: (v) => v.joint && { x: v.joint.x, y: v.joint.y },
  warnMs: BURST_WARN_MS,
  activeMs: BURST_MS,
  activeFor: (e) => (e.chosen === "mend" ? MEND_MS : e.chosen === "contractor" ? CONTRACT_MS : BURST_MS),
  warning: { title: "A main is straining", text: () => "A joint on your longest main is about to give." },
  active: { title: "Burst main", text: "A main has burst. It pours into the street, and nothing reaches its buildings." },
  calledOff: "The main is gone.",
  choices: [
    { id: "mend", label: "Dig it up", crew: { who: "intern", share: CREW_SHARE.mend, during: "active" }, note: () => `mended in ${minutes(MEND_MS)}` },
    { id: "contractor", label: "Pay a contractor", price: (v) => v.income * CONTRACT_SECONDS, note: () => `mended in ${CONTRACT_MS / 1000} s` },
    { id: "pour", label: "Let it pour", note: () => `the water company comes in ${minutes(BURST_MS)}` },
  ],
  default: "pour",
  ai: () => "contractor",
  outcome: () => ({ text: "The main is mended. Its buildings are drinking again." }),
};
