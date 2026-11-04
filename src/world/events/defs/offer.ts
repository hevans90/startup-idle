/**
 * AN ACQUIRER'S OFFER, at the company's grandest door once it can be sold:
 * looking at it puts their premium on a sale made while it is open; holding
 * out lets it go. The sale itself is the card's. @see answerOffer, OFFER_PREMIUM
 */
import { termEffects } from "../../../game/term-deal";
import { useSessionStore } from "../../../state/session.store";
import type { EventDef } from "../events";

export const OFFER_MS = 120_000;

export const OFFER: EventDef = {
  kind: "offer",
  // A NO-SHOP in the term sheet: no acquirer comes knocking this run. @see term-deal
  where: (v) => (termEffects().offers === "none" || !v.sale || !v.door ? null : { x: v.door.x + 1, y: v.door.y }),
  warnMs: 20_000,
  activeMs: OFFER_MS,
  warning: {
    title: "An acquirer is circling",
    // THE BEST STREET is what caught their eye. @see liveStreetEarnings
    text: (v) => {
      const street = v.sale?.street();
      return street ? `Someone wants to buy the company — they have been walking ${street}. An offer is coming.` : "Someone wants to buy the company. An offer is coming.";
    },
  },
  active: { title: "An offer is on the table", text: "Sell now and they pay a premium. Hold out, and the company — and the next offer — may grow." },
  choices: [
    { id: "accept", label: "Look at the offer", note: (v) => `+${v.sale?.withPremium ?? 0} Equity, against ${v.sale?.equity ?? 0} without them · sells the company` },
    { id: "hold", label: "Hold out", note: () => "the premium goes with them" },
  ],
  default: "hold",
  // An offer made has heard it. @see offerPremium
  // A sale ends the company, and this with it; still here, it lapsed.
  outcome: (e) => ({
    text: e.chosen === "accept" ? "The offer lapsed before you signed. Another may come." : "The acquirer has walked away. Another may come.",
    then: () => useSessionStore.getState().setSnubbed(false),
  }),
};
