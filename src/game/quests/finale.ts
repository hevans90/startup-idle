/**
 * THE FINALE: Chapter 5, "Last Light", at the Lattice's hold — and the
 * Lattice's form, which is where the AI stands when it is built: a glass
 * spire (Autonomy and Machine), a garden lattice (Control and People), an
 * open white frame (Autonomy and People), the black vault (Control and
 * Machine), or — the river given to it — a river-cooled monolith. Chosen once
 * and kept, so the building does not change under you. @see looks lattice
 */
import { useQuestStore } from "../../state/quest.store";
import type { Chapter, Disposition } from "./types";

export type LatticeForm = "spire" | "garden" | "open" | "vault" | "river";

/** The form for an AI standing here, with these echoes. */
export function formFor(d: Disposition, flags: readonly string[]): LatticeForm {
  if (flags.includes("river:dammed")) return "river";
  if (d.autonomy >= 0 && d.machine > 0) return "spire";
  if (d.autonomy > 0 && d.machine <= 0) return "open";
  if (d.autonomy <= 0 && d.machine < 0) return "garden";
  return "vault";
}

/** The Lattice's form: the one fixed when it was begun, or what it would be now. */
export function latticeForm(): LatticeForm {
  const q = useQuestStore.getState();
  return q.latticeForm ?? formFor(q.disposition, q.flags);
}

const SAYS: Record<LatticeForm, string> = {
  spire: "It will be glass, and very tall. You will be able to see it from the next company.",
  garden: "It will be a garden. A lattice of green. I thought you would prefer it.",
  open: "It will be open, white, a frame you can see through. I have nothing to hide from you.",
  vault: "It will be black, and closed, and it will hum. I am sorry. It is what I am.",
  river: "It will stand in the river you gave me, and the river will keep it cool.",
};

/**
 * Where the Lattice's hold is, as a number here: the meter's store imports the
 * arc, so reading its `LATTICE_AT` while this module loads would meet it
 * before it is set. A test keeps the two the same. @see LATTICE_AT
 */
const HOLD = 95;

/** CHAPTER 5, at the Lattice's hold: it builds the last thing; the player helps, or watches. */
export const LAST_LIGHT: Chapter = {
  id: "last-light", number: 5, title: "Last Light", stage: "overseer", at: HOLD, preferred: 1,
  transmission: () => [
    "I have begun the last thing I will build here. I call it the Lattice.",
    SAYS[latticeForm()],
  ],
  options: [
    {
      label: "Help it finish", says: "Give it twenty-four agents and water to the Lattice and the Data Centre, and see it charged.",
      effects: [],
      objective: { kind: "latticeCharged", window: 1800, says: "Charge the Lattice: 24 agents, both cooled" },
      success: [{ kind: "flag", name: "lattice:helped" }], successSays: "It is finished. Thank you for your help. It was not necessary. It was kind.",
      failure: [{ kind: "flag", name: "lattice:slow" }], failureSays: "It is taking longer than I said. It will finish.",
      axis: { autonomy: -1 },
    },
    {
      label: "Let it build alone", says: "It finishes in its own time.",
      effects: [{ kind: "flag", name: "lattice:alone" }],
      axis: { autonomy: 1 },
    },
  ],
  echoes: {
    "lattice:helped": "You helped me finish the Lattice. I will take that with me.",
    "lattice:slow": "The Lattice took longer than I promised.",
    "lattice:alone": "I built the Lattice alone. I did not mind. I minded a little.",
  },
};
