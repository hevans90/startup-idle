/**
 * A DROUGHT: the river stops coming onto the map for ten minutes, and what
 * drinks from it goes short. Dig a reservoir by what drinks (filled, to pipe
 * from), ration (the homes' water to the drinkers: every tank kept full, and
 * the homes put out for a day), or truck water in (paid for, every tank kept
 * full). The river is the scene's. @see setHeat, digReservoir
 */
import { addMorale } from "../../../game/morale";
import type { GeneratorId } from "../../../state/generators.store";
import type { EventDef } from "../events";

/** How long it lasts, and the warning, ms. */
export const DROUGHT_MS = 600_000;
export const DROUGHT_WARN_MS = 60_000;
/** What rationing puts the homes out, in morale for a day. */
export const RATION_MORALE = 8;
/** Seconds of income trucking water in costs, a minute of the drought. */
export const TRUCK_SECONDS = 8;
/** Seconds of income digging a reservoir costs. */
export const DIG_SECONDS = 60;

export const DROUGHT: EventDef = {
  kind: "drought",
  where: (v) => (v.river && v.drinkers ? v.river : null),
  warnMs: DROUGHT_WARN_MS,
  activeMs: DROUGHT_MS,
  warning: { title: "A drought is coming", text: () => "The river will stop coming onto the map for ten minutes. What drinks from it will go short." },
  active: { title: "Drought", text: "The river has stopped coming. It comes back on its own." },
  calledOff: "The river is gone.",
  choices: [
    {
      id: "dig", label: "Dig a reservoir", price: (v) => v.income * DIG_SECONDS,
      unavailable: (v) => (v.drinkers?.dig ? undefined : "Nowhere level to dig"),
      note: () => "a 3×3 basin by what drinks, filled now, to pipe from",
      act: (v) => v.drinkers?.dig?.(),
    },
    { id: "ration", label: "Ration the homes", note: () => `every tank kept full · −${RATION_MORALE} morale for a day` },
    { id: "truck", label: "Truck water in", price: (v) => v.income * TRUCK_SECONDS * (DROUGHT_MS / 60_000), note: () => "every tank kept full while it lasts" },
  ],
  default: "ration",
  outcome: (e, v) => {
    if (e.chosen !== "ration") return { text: "The river is back." };
    const kinds = (Object.keys(v.owned) as GeneratorId[]).filter((k) => (v.owned[k] ?? 0) > 0);
    return { text: `The river is back, and the taps are on again: −${RATION_MORALE} morale for a day.`, then: () => { for (const k of kinds) addMorale(k, -RATION_MORALE); } };
  },
};
