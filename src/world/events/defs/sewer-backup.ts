/**
 * A SEWER BACKUP: the longest sewer that drains anything chokes, and what it
 * carries comes up at a manhole — slop in the street, by whatever homes are
 * near. Rod it out (half the vibe coders off work till it is clear), pay to
 * have it pumped (clear sooner), or leave it to clear itself. A second sewer
 * is the built answer: only this one chokes. @see setBackedUp
 */
import { CREW_SHARE, minutes, type EventDef } from "../events";

export const BACKUP_WARN_MS = 30_000;
/** How long it backs up, left; rodded; pumped. */
export const BACKUP_MS = 300_000;
export const ROD_MS = 120_000;
export const PUMP_OUT_MS = 20_000;
/** Seconds of income pumping it out costs. */
export const PUMP_OUT_SECONDS = 90;

export const SEWER_BACKUP: EventDef = {
  kind: "sewer-backup",
  where: (v) => v.manhole && { x: v.manhole.x, y: v.manhole.y },
  warnMs: BACKUP_WARN_MS,
  activeMs: BACKUP_MS,
  activeFor: (e) => (e.chosen === "rod" ? ROD_MS : e.chosen === "pump" ? PUMP_OUT_MS : BACKUP_MS),
  warning: { title: "A sewer is gurgling", text: () => "Your longest sewer is choking. It will come up at a manhole." },
  active: { title: "Sewer backup", text: "A sewer has backed up. Its slop is coming up in the street." },
  calledOff: "The sewer is gone.",
  choices: [
    { id: "rod", label: "Rod it out", crew: { who: "vibe_coder", share: CREW_SHARE.rod, during: "active" }, note: () => `clear in ${minutes(ROD_MS)}` },
    { id: "pump", label: "Have it pumped", price: (v) => v.income * PUMP_OUT_SECONDS, note: () => `clear in ${PUMP_OUT_MS / 1000} s` },
    { id: "leave", label: "Leave it", note: () => `slop in the street for ${minutes(BACKUP_MS)}` },
  ],
  default: "leave",
  ai: () => "pump",
  outcome: () => ({ text: "The sewer runs again. What came up is still to be mopped." }),
};
