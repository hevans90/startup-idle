/** EVERY EVENT there is, by kind. @see EventDef */
import type { EventDef, EventKind } from "../events";
import { CONVOY } from "./convoy";
import { FLOOD } from "./flood";
import { HACKATHON } from "./hackathon";
import { INVESTOR_TOUR } from "./investor-tour";
import { OFFER } from "./offer";

export const EVENT_DEFS: Readonly<Record<EventKind, EventDef>> = {
  "river-flood": FLOOD,
  convoy: CONVOY,
  "investor-tour": INVESTOR_TOUR,
  hackathon: HACKATHON,
  offer: OFFER,
};
