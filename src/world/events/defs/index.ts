/** EVERY EVENT there is, by kind. @see EventDef */
import type { EventDef, EventKind } from "../events";
import { CONVOY } from "./convoy";
import { DILIGENCE } from "./diligence";
import { FLOOD } from "./flood";
import { HACKATHON } from "./hackathon";
import { OFFER } from "./offer";

export const EVENT_DEFS: Readonly<Record<EventKind, EventDef>> = {
  "river-flood": FLOOD,
  convoy: CONVOY,
  diligence: DILIGENCE,
  hackathon: HACKATHON,
  offer: OFFER,
};
