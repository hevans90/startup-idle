/**
 * A SUPPLY CONVOY down the river: for a minute every call at the ports pays
 * double, and a building site's loads come off it at the port at half price.
 * Extra hands at the quays (interns, while it is in) turn the boats round
 * twice as fast — and a convoy served comes back as a regular route, every
 * call paying more and every load costing less, for good.
 * @see convoyPays, ROUTE_BONUS, CONVOY_LOADS
 */
import { notable } from "../../../game/machine";
import { useSessionStore } from "../../../state/session.store";
import { CONVOY_LOADS, ROUTE_LOADS } from "../convoy";
import { CREW_SHARE, money, type EventDef, type GameEvent } from "../events";

/**
 * A CONVOY SERVED — extra hands at the quays, and calls made while it was in —
 * comes back as a regular route: every call at every port pays this much more,
 * for good, up to `MAX_ROUTES` of them. @see routeWon
 */
export const ROUTE_BONUS = 0.2;
export const MAX_ROUTES = 5;
/** Whether a convoy, over, was served well enough to become a regular route. */
export const routeWon = (e: GameEvent, calls: number) => e.kind === "convoy" && e.chosen === "hands" && calls > 0;
const pct = (k: number) => `+${Math.round(k * 100)}%`;
const off = (k: number) => `−${Math.round(k * 100)}%`;

export const CONVOY: EventDef = {
  kind: "convoy",
  where: (v) => v.port,
  // Twice as often with the Machine's Market Maker. @see game/machine "market"
  weight: () => (notable("market") ? 2 : 1),
  warnMs: 30_000,
  activeMs: 60_000,
  warning: {
    title: "A convoy is coming down the river",
    text: () => `For a minute, every call at your ports pays double, and building materials come in on it: loads ${off(1 - CONVOY_LOADS)}.`,
  },
  active: { title: "The convoy is in", text: "Every call pays double, and loads come off it at the port at half price, until it has passed." },
  choices: [
    {
      id: "hands", label: "Extra hands at the quays", crew: { who: "intern", share: CREW_SHARE.hands, during: "active" },
      note: (v) => `calls take half as long${v.routes < MAX_ROUTES ? ` · it becomes a regular route: ${pct(ROUTE_BONUS)} on every call, ${off(ROUTE_LOADS)} on loads` : ""}`,
    },
    { id: "usual", label: "Business as usual" },
  ],
  default: "usual",
  ai: () => "hands",
  outcome: (e, v) => {
    const { calls, earned } = v.convoy;
    const won = routeWon(e, calls) && v.routes < MAX_ROUTES;
    return {
      text: `${calls} calls while it was in, for ${money(earned)}.${won ? ` It will be back: a regular route, ${pct(ROUTE_BONUS * (v.routes + 1))} on every call and ${off(ROUTE_LOADS * (v.routes + 1))} on loads.` : ""}`,
      then: won ? () => useSessionStore.getState().addRoute(MAX_ROUTES) : undefined,
    };
  },
};
