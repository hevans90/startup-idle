/**
 * World v2 — the first-run HINT on the map: one tip at a time, with the thing
 * it is about glowing, until its goal is met or it is dismissed. @see hints
 */
import { hotAgents } from "../projects/cooling";
import { useEffect, useState } from "react";

import { housedBy, housingResidents, awaitingArrival } from "../../game/housing";
import { PROJECTS } from "../../game/projects";
import { useGeneratorStore } from "../../state/generators.store";
import { gateUnlocksNow } from "./gates";
import { useSessionStore } from "../../state/session.store";
import { getNetwork, useWorldStore } from "../../state/world.store";
import { liveCommutes, workplaceKind } from "../agents/commute";
import { serviceOf } from "../agents/services";
import { liveMoods } from "../agents/mood";
import { useSlopPitStore } from "../../state/slop-pit.store";
import { builtProjects, ruledOut, sitesOf } from "../projects/works";
import { projectForStructure } from "../../game/projects";
import { nextHint, type HintState } from "./hints";
import { ownsTile, PARCELS, STARTING_PARCELS } from "../land";

/** What the hints can see, read from the game now. */
function snapshot(): HintState {
  const gens = useGeneratorStore.getState().generators;
  const owned = { intern: 0, vibe_coder: 0, "10x_dev": 0 };
  for (const g of gens) owned[g.id as keyof typeof owned] = g.amount;
  const unlocked = gateUnlocksNow();
  const grid = useWorldStore.getState().grid;
  const built = builtProjects(grid);
  const sites = new Set(sitesOf(grid).map((s) => projectForStructure(s.def)?.id).filter((id): id is NonNullable<typeof id> => !!id));
  const ready = new Set(PROJECTS.filter((p) => !built.has(p.id) && !sites.has(p.id) && !ruledOut(grid, p) && p.ready(owned, unlocked)).map((p) => p.id));
  let lots = 0, services = 0, offices = 0, labs = 0, levees = 0, racks = 0;
  for (const s of grid.structures.values()) {
    if (s.def === "lab" && !s.build) labs++;
    if (s.def === "rack" && !s.build) racks++;
    if (s.def === "levee") levees++;
    if (housedBy(s.def)) lots++;
    if (serviceOf(s.def)) services++;
    if (workplaceKind(s.def) && s.def.startsWith("office")) offices++;
  }
  const residents = housingResidents(grid);
  const away = awaitingArrival(owned, useSessionStore.getState().remoteBeds ?? {}, residents);
  const net = getNetwork();
  let worstCommute = 1, worstMood = 0, deskless = 0;
  if (net) {
    for (const [house, m] of liveMoods(grid, net, useSlopPitStore.getState().fill / 100)) {
      const s = grid.structures.get(house);
      if (s && (s.residents ?? 1) > 0) worstMood = Math.min(worstMood, m.total);
    }
  }
  if (net) {
    for (const [house, c] of liveCommutes(grid, net)) {
      const s = grid.structures.get(house);
      deskless += c.deskless;
      // The walk alone: a house short of desks is the desks hint's to tell.
      if (s && (s.residents ?? 1) > 0 && !c.deskless) worstCommute = Math.min(worstCommute, c.eff);
    }
  }
  return {
    owned, built, sites, ready, lots, services, offices, worstCommute,
    residents: residents.intern + residents.vibe_coder + residents["10x_dev"],
    awaiting: Object.values(away).reduce((n, v) => n + (v ?? 0), 0),
    wondersOpened: false,
    worstMood, moodShown: useWorldStore.getState().moodOverlay,
    ...landState(),
    labs, levees, racks,
    deskless,
    hot: Math.round(hotAgents()),
    pipes: grid.pipe.reduce((n, p) => n + (p ? 1 : 0), 0),
    floodWarning: useWorldStore.getState().events.some((e) => e.kind === "river-flood" && e.phase === "warning"),
  };
}

/** Room left by the road on the company's own land, and what is for sale. @see world/land */
function landState(): Pick<HintState, "freeFrontage" | "landForSale" | "parcelsBought"> {
  const land = useSessionStore.getState().land;
  if (!land) return { freeFrontage: Infinity, landForSale: false, parcelsBought: 0 };
  const g = useWorldStore.getState().grid;
  let free = 0;
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      if (g.paved[i] || g.structureAt[i] >= 0 || !ownsTile(g, land, x, y)) continue;
      if ((x > 0 && g.paved[i - 1]) || (x < g.w - 1 && g.paved[i + 1]) || (y > 0 && g.paved[i - g.w]) || (y < g.h - 1 && g.paved[i + g.w])) free++;
    }
  }
  return { freeFrontage: free, landForSale: land.length < PARCELS * PARCELS, parcelsBought: Math.max(0, land.length - STARTING_PARCELS) };
}

export function HintCard() {
  const off = useSessionStore((s) => s.hintsOff);
  const done = useSessionStore((s) => s.hintsDone);
  const markDone = useSessionStore((s) => s.markHintsDone);
  const setOff = useSessionStore((s) => s.setHintsOff);
  const [hint, setHint] = useState<ReturnType<typeof nextHint>["show"]>(null);

  // WHAT TO SAY, and what is already done and can be put away unseen —
  // looked at twice a second, the game moving on its own.
  useEffect(() => {
    if (off) { setHint(null); return; }
    const look = () => {
      const { show, settled } = nextHint(snapshot(), new Set(done));
      if (settled.length) markDone(settled);
      setHint((was) => (was?.id === show?.id ? was : show));
    };
    look();
    const id = setInterval(look, 500);
    return () => clearInterval(id);
  }, [off, done, markDone]);

  // WHAT IT POINTS AT, glowing while it is up.
  useEffect(() => {
    if (!hint?.target) return;
    const els = [...document.querySelectorAll(`[data-hint="${hint.target}"]`)];
    for (const el of els) el.classList.add("hint-glow");
    return () => { for (const el of els) el.classList.remove("hint-glow"); };
  }, [hint]);

  if (!hint) return null;
  return (
    <div role="status"
      className="flex max-w-[min(26rem,calc(100vw-1rem))] items-start gap-2 border border-emerald-500 bg-primary-50/95 px-3 py-2 text-xs text-primary-900 shadow-md dark:border-emerald-400 dark:bg-primary-900/95 dark:text-primary-100">
      <span aria-hidden className="mt-0.5 text-emerald-600 dark:text-emerald-400">●</span>
      <p className="flex-1">{hint.text}</p>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <button type="button" onClick={() => markDone([hint.id])}
          className="cursor-pointer px-1 text-primary-500 hover:text-primary-900 dark:hover:text-primary-100" aria-label="Dismiss this tip">✕</button>
        <button type="button" onClick={() => setOff(true)}
          className="cursor-pointer text-[10px] text-primary-500 underline hover:text-primary-900 dark:hover:text-primary-100">
          no more tips
        </button>
      </div>
    </div>
  );
}
