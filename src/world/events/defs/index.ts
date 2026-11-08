/** EVERY EVENT there is, by kind. @see EventDef */
import type { EventDef, EventKind } from "../events";
import { AGENT_INCIDENT } from "./agents";
import { CONVOY } from "./convoy";
import { DILIGENCE } from "./diligence";
import { DROUGHT } from "./drought";
import { FIRE } from "./fire";
import { FLOOD } from "./flood";
import { HACKATHON } from "./hackathon";
import { HEATWAVE } from "./heatwave";
import { INSPECTOR } from "./inspector";
import { OFFER } from "./offer";
import { POACHING } from "./poaching";
import { ROAD_WORKS } from "./road-works";
import { STRIKE } from "./strike";
import { TENANTS } from "./tenants";
import { VIRAL } from "./viral";

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
  "road-works": ROAD_WORKS,
  poaching: POACHING,
  viral: VIRAL,
  tenants: TENANTS,
  agents: AGENT_INCIDENT,
  fire: FIRE,
};
