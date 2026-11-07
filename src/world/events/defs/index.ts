/** EVERY EVENT there is, by kind. @see EventDef */
import type { EventDef, EventKind } from "../events";
import { CONVOY } from "./convoy";
import { DILIGENCE } from "./diligence";
import { DROUGHT } from "./drought";
import { FLOOD } from "./flood";
import { HACKATHON } from "./hackathon";
import { HEATWAVE } from "./heatwave";
import { INSPECTOR } from "./inspector";
import { OFFER } from "./offer";
import { STRIKE } from "./strike";

export const EVENT_DEFS: Readonly<Record<EventKind, EventDef>> = {
  "river-flood": FLOOD,
  convoy: CONVOY,
  diligence: DILIGENCE,
  hackathon: HACKATHON,
  offer: OFFER,
  heatwave: HEATWAVE,
  drought: DROUGHT,
  inspector: INSPECTOR,
  strike: STRIKE,
};
