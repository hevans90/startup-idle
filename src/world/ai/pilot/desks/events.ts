/**
 * World v2 — THE PILOT'S EVENTS DESK: an answer to each event card, the
 * moment it comes. Free and urgent: it waits behind no purchase and no pace.
 *
 * The answer is the event's own for AI mode where it has one and that can be
 * taken and paid for, else its default — judged on the town as the events
 * last saw it. With no scene to have seen it, the default. @see answerFor
 * @see plans/ai-mode-rebuild.md phase 5
 */
import { useMoneyStore } from "../../../../state/money.store";
import { useWorldStore } from "../../../../state/world.store";
import { EVENT_DEFS } from "../../../events/defs";
import { answerFor, townView } from "../../../events/events";
import type { Job } from "../job";
import type { Desk } from "../pilot";

export function eventsDesk(): Desk {
  const propose = (): Job[] => {
    const st = useWorldStore.getState();
    const jobs: Job[] = [];
    for (const e of st.events) {
      if (e.phase !== "warning" || e.chosen !== undefined || !e.choices.length) continue;
      const def = EVENT_DEFS[e.kind], view = townView();
      const pick = view ? answerFor(def, e, view, useMoneyStore.getState().money.toNumber()) : def.default;
      const choice = e.choices.find((c) => c.id === pick);
      jobs.push({
        id: `event:${e.id}`, desk: "events",
        says: `${e.title}: ${choice?.label ?? pick}`, why: choice?.cost ?? e.text,
        at: e.where, cost: 0, gain: 0, urgent: true,
        done: () => useWorldStore.getState().events.find((x) => x.id === e.id)?.chosen !== undefined,
        run: () => {
          useWorldStore.getState().respondToEvent(e.id, pick);
          return useWorldStore.getState().events.find((x) => x.id === e.id)?.chosen === pick
            ? { ok: true } : { ok: false, because: useWorldStore.getState().notice?.text.toLowerCase() ?? "it could not be chosen", retry: 5 };
        },
      });
    }
    return jobs;
  };
  return { id: "events", propose };
}
