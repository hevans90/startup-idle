/**
 * World v2 — FIRST-RUN HINTS: what a new player is told, and when.
 *
 * The map carries most of the game now — the garage, lots, roads, projects,
 * services, wonders — and none of it explains itself. So a tip at a time, the
 * first whose moment has come and whose goal is not met yet: it goes when the
 * goal is met, or when dismissed, and is not shown again for that company.
 * A company that has already done a thing is never told to do it.
 *
 * Pure: each hint is two questions about a snapshot of the game. @see HintCard
 */

/** What the hints can see. */
export type HintState = {
  owned: { intern: number; vibe_coder: number; "10x_dev": number };
  /** Projects standing, projects with a site going up, and projects ready to start. */
  built: ReadonlySet<string>;
  sites: ReadonlySet<string>;
  ready: ReadonlySet<string>;
  /** Lots and houses on the map, and how many live in them. */
  lots: number;
  residents: number;
  /** Hires not yet moved in. */
  awaiting: number;
  services: number;
  offices: number;
  /** The worst commute on the map, as the share of a day it leaves; 1 for none. */
  worstCommute: number;
  wondersOpened: boolean;
  /** The unhappiest lived-in house's mood; 0 for none. @see world/agents/mood */
  worstMood: number;
  moodShown: boolean;
  /** Empty cells by a road on the company's own land; Infinity when it owns the whole map. @see world/land */
  freeFrontage: number;
  /** Whether there is land for sale, and how many parcels have been bought. */
  landForSale: boolean;
  parcelsBought: number;
  /** R&D labs and flood walls standing. */
  labs: number;
  levees: number;
  /** Whether a flood has been announced and not yet struck. */
  floodWarning: boolean;
};

export type Hint = {
  id: string;
  /** What it says. */
  text: string;
  /** What to point at: a `data-hint` handle on the page. */
  target?: string;
  /** Whether its moment has come. */
  when: (s: HintState) => boolean;
  /** Whether what it asks has been done — and so it need never be shown. */
  done: (s: HintState) => boolean;
};

export const HINTS: readonly Hint[] = [
  {
    id: "garage-site",
    text: "Your first project: choose a site for the Founder's Garage, beside the road.",
    target: "projects",
    when: (s) => s.ready.has("garage"),
    done: (s) => s.sites.has("garage") || s.built.has("garage"),
  },
  {
    id: "garage-wait",
    text: "You drive in and build the garage yourself. When it opens, you can hire interns.",
    when: (s) => s.sites.has("garage"),
    done: (s) => s.built.has("garage"),
  },
  {
    id: "first-hire",
    text: "The garage is open. Hire your first intern in the Employees tab.",
    target: "tab-employees",
    when: (s) => s.built.has("garage"),
    done: (s) => s.owned.intern > 0,
  },
  {
    id: "zone-lots",
    text: "Interns need somewhere to live. Open Build and zone a Lot beside the road — drag along the street for a row.",
    target: "build",
    when: (s) => s.owned.intern >= 2,
    done: (s) => s.lots > 0,
  },
  {
    id: "arrivals",
    text: "New hires come by bus from the edge of the map, and start work once they have moved in.",
    when: (s) => s.lots > 0 && s.awaiting > 0,
    done: (s) => s.residents > 0,
  },
  {
    id: "townhall",
    text: "The Town Hall is ready to build. It opens cafés, parks and gyms — and houses near them grow.",
    target: "projects",
    when: (s) => s.ready.has("townhall"),
    done: (s) => s.sites.has("townhall") || s.built.has("townhall"),
  },
  {
    id: "services",
    text: "Put a café near your lots. A full house beside one grows into a bigger house, for nothing.",
    target: "build",
    when: (s) => s.built.has("townhall"),
    done: (s) => s.services > 0,
  },
  {
    id: "commute",
    text: "Some of your people have a long walk to work, and it costs you output. An Office near their homes brings work closer.",
    target: "build",
    when: (s) => s.worstCommute < 0.8,
    done: (s) => s.offices > 0,
  },
  {
    id: "mood",
    text: "Some of your people are unhappy at home, and it costs you. Turn on Mood to see where, and read a house's label for why.",
    target: "mood",
    when: (s) => s.worstMood <= -10,
    done: (s) => s.moodShown,
  },
  {
    id: "land",
    text: "Your roadside land is nearly full. Land on the build bar buys the parcel next to yours.",
    target: "land",
    when: (s) => s.landForSale && s.freeFrontage < 6,
    done: (s) => s.parcelsBought > 0,
  },
  {
    id: "labs",
    text: "A Lab, in the 10x devs' row, raises innovation — twice as much beside the campus.",
    target: "build",
    when: (s) => s.built.has("campus"),
    done: (s) => s.labs > 0,
  },
  {
    id: "flood-walls",
    text: "A flood is coming. Flood walls, under Defences in Build, hold the water back.",
    target: "build",
    when: (s) => s.floodWarning,
    done: (s) => s.levees > 0,
  },
  {
    id: "wonders",
    text: "A wonder can be built. Open Wonders on the build bar: each is a bonus for good.",
    target: "wonders",
    when: (s) => [...s.ready].some((id) => WONDER_IDS.includes(id)),
    done: (s) => s.wondersOpened,
  },
];

const WONDER_IDS = ["datacentre", "conference", "ipo"];

/**
 * The hint to show now, if any, and the ones that can be put away without
 * being shown — their goal met already.
 */
export function nextHint(s: HintState, seen: ReadonlySet<string>): { show: Hint | null; settled: string[] } {
  const settled = HINTS.filter((h) => !seen.has(h.id) && h.done(s)).map((h) => h.id);
  const show = HINTS.find((h) => !seen.has(h.id) && !settled.includes(h.id) && h.when(s)) ?? null;
  return { show, settled };
}
