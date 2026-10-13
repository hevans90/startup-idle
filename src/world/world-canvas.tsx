/**
 * World v2 — the map itself, for whichever page shows it.
 *
 * Two pages do: the GAME, where the map is the company's town and it is played
 * by the game's rules, and the EDITOR (`?world=1`), where it is authored freely
 * with every tool and HUD. They share this — the renderer, the scene, the
 * map's lifetime — and differ only in what they put round it.
 * @see App, WorldEditor
 */
import { CREW_SHARE } from "./events/events";
import { Application } from "@pixi/react";
import { useEffect, useState, type RefObject } from "react";

import {
  addBeds, awaitingArrival, foundingRemoteBeds, housingCapacity, housingResidents, setHousingReader,
} from "../game/housing";
import { useGeneratorStore, type GeneratorId } from "../state/generators.store";
import { getNetwork, getWorks, startAutosave, startedOnFixture, useWorldStore } from "../state/world.store";
import { housedBy, residentsIn } from "../game/housing";
import { projectForStructure, setProjectReader, type FeatureId, type ProjectId } from "../game/projects";
import { setTermReader } from "../game/term-sheets";
import { useInnovationStore } from "../state/innovation.store";
import { useValuationStore } from "../state/valuation.store";
import { DEFAULT_GEN, type GenParams } from "./gen/params";
import { commuteFactor, liveCommutes } from "./agents/commute";
import { setTownBonusReader } from "../game/acquisition";
import { setTownMoodReader } from "../game/town-mood";
import { liveMoods, moodOffsets } from "./agents/mood";
import { useSlopPitStore } from "../state/slop-pit.store";
import { townBonusOf } from "./projects/town-worth";
import { serviceOf } from "./agents/services";
import { structureDef } from "./structures/def";
import { builtProjects, catchUpWorks } from "./projects/works";
import { announceOpened, ownedNow, payForLoad } from "./projects/economy";
import { useSessionStore } from "../state/session.store";
import { useDisableDOMZoom } from "../utils/use-disable-dom-zoom";
import { loadSaved, setSaveSlot, type SaveSlot } from "./io/world-save";
import { openDevice, type HeldGpu } from "./render/device";
import { WorldScene } from "./world-scene";
import { WorldViewport } from "./world-viewport";
import { damagedAway, evacuatedAway } from "./events/flood";
import { cleanupAway } from "./events/cleanup";
import { startingLand } from "./land";
import { usePrestigeStore } from "../state/prestige.store";
import { markWorldGone, markWorldReady } from "../game/world-ready";
import { labReading } from "./projects/labs";
import { rackReading } from "./projects/racks";

/**
 * Which renderer to ask for: WebGPU, unless `?webgl=1` says otherwise.
 *
 * Not a preference so much as a way to LOOK at the other one. Everything here
 * runs on WebGPU in practice, so the WebGL path is the one that rots quietly
 * until somebody opens the page in a browser that has no WebGPU and gets a
 * blank map. This makes it one URL away.
 */
export const rendererAsked = (): "webgpu" | "webgl" =>
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("webgl")
    ? "webgl"
    : "webgpu";

/**
 * The map this page shows, from mount to unmount: loaded or founded, saved as
 * it changes, and telling the economy its beds.
 *
 * `slot` is which map — the run's or the editor's. @see setSaveSlot
 * `play` puts the game's rules on: frontage and a price for every building,
 * and the look tool in hand rather than a paintbrush.
 */
/**
 * Which map this page has founded already — its slot and company — and which
 * it GENERATED, rather than loaded, and has yet to give its land to.
 * @see useFoundWorld
 */
let foundedKey: string | null = null;
let generatedKey: string | null = null;

export function useFoundWorld(slot: SaveSlot, play: boolean): void {
  /**
   * THE SAVED MAP, BEFORE ANYTHING DRAWS.
   *
   * In the first render rather than an effect: the scene builds off `grid`
   * identity, so loading after the first paint would build the whole scene for
   * the empty default map and immediately throw it away. `useState`'s
   * initialiser runs once and is the cheapest place to do a one-shot load.
   */
  useState(() => {
    setSaveSlot(slot);
    // ONCE A COMPANY, not once a mount: the map mounts more than once as the
    // page comes up, and founding it again on the second — a map generated
    // four times a load — wrote to the store under the first's build bar.
    const key = `${slot}:${useSessionStore.getState().incorporatedAt}`;
    if (foundedKey === key) return true;
    foundedKey = key;
    // A `?fixture=` is the map this session, not the saved one, and the store
    // has already built it. @see startedOnFixture
    if (startedOnFixture()) return true;
    const saved = loadSaved();
    if (saved) {
      useWorldStore.getState().loadGrid(saved.grid, saved.palette.terrain, saved.boats);
      return true;
    }
    /**
     * NO SAVED MAP MEANS A NEW COMPANY, so found one on fresh ground.
     *
     * SEEDED ON `incorporatedAt`, which is already unique per company and
     * already persisted — so the map is a consequence of founding rather than
     * something the founder flow has to know how to make. Nothing in
     * `src/state/founder` reaches into the world; the world simply generates
     * from the number that is already there. Selling the company throws the
     * run's save away, and that is what makes a new startup a new map.
     * @see generatePlayableMap, retireRunSave
     */
    // THE LAND THE PLAYER CHOSE, if they chose some: the seed and settings
    // they previewed, so the map they get is the map they saw. @see MapSetup
    const choice = slot === "run" ? useSessionStore.getState().mapChoice : null;
    if (choice) {
      const params = { ...DEFAULT_GEN, ...choice.params } as GenParams;
      useWorldStore.getState().generateWorld(choice.seed, params.size, params);
    } else useWorldStore.getState().generateWorld(useSessionStore.getState().incorporatedAt);
    generatedKey = key;
    return true;
  });
  // A NEW COMPANY OWNS THE MIDDLE OF ITS MAP, and buys the rest — said once
  // the map is up, not while drawing it. @see world/land
  useEffect(() => {
    if (slot !== "run" || generatedKey !== `${slot}:${useSessionStore.getState().incorporatedAt}`) return;
    generatedKey = null;
    const perks = usePrestigeStore.getState().modifiers;
    const land = startingLand(useWorldStore.getState().grid, perks.startingParcels);
    useSessionStore.getState().setLand(land);
    // A CAFÉ to begin with, for founders who have done this before. @see foundingCafe
    if (perks.foundingCafe) useWorldStore.getState().foundCafe();
    // AND THE OLD BUILDINGS on the land still for sale. @see placeDerelicts
    useWorldStore.getState().placeDerelicts(land, useSessionStore.getState().incorporatedAt);
  }, [slot]);
  // And keep it saved from here on. @see startAutosave
  useEffect(() => startAutosave(), []);
  /**
   * TELL THE ECONOMY ABOUT THE BEDS, for as long as this world is mounted.
   *
   * Registered from here rather than from the store so the gate exists exactly
   * while a map does: unmount and hiring goes back to being limited by money
   * alone, which is what the rest of the game expects. @see setHousingReader
   */
  //
  // IN THE GAME, WITH THE BEDS OFF THE MAP: a company's starter crew, or the
  // people it had before it had a map, founded once per company. @see foundingRemoteBeds
  useEffect(() => {
    if (play && !useSessionStore.getState().remoteBeds) {
      const owned: Record<string, number> = {};
      for (const g of useGeneratorStore.getState().generators) owned[g.id] = g.amount;
      useSessionStore.getState().setRemoteBeds(foundingRemoteBeds(owned));
    }
    return setHousingReader(() => {
      const built = housingCapacity(useWorldStore.getState().grid);
      return play ? addBeds(built, useSessionStore.getState().remoteBeds ?? {}) : built;
    });
  }, [play]);
  /**
   * HOW THE TOWN FEELS, told to the economy while the map is mounted in the
   * game: each kind's satisfaction leans toward its houses' mood. @see moodOffsets
   */
  useEffect(() => {
    if (!play) return;
    return setTownMoodReader(() => {
      const net = getNetwork(), g = useWorldStore.getState().grid;
      return net ? moodOffsets(g, liveMoods(g, net, useSlopPitStore.getState().fill / 100)) : {};
    });
  }, [play]);
  /**
   * THE TOWN'S WORTH AT A SALE, told to the acquisition while the map is
   * mounted in the game. @see townBonusOf
   */
  useEffect(() => {
    if (!play) return;
    return setTownBonusReader(() => townBonusOf(useWorldStore.getState().grid));
  }, [play]);
  /** THE MAP'S SIDE OF THE TERM SHEET: houses lived in, wonders standing. @see game/term-sheets */
  useEffect(() => {
    if (!play) return;
    return setTermReader(() => {
      let houses = 0, wonders = 0;
      for (const s of useWorldStore.getState().grid.structures.values()) {
        if (s.build) continue;
        if (housedBy(s.def) && residentsIn(s) > 0) houses++;
        if (projectForStructure(s.def)?.bonus) wonders++;
      }
      return { houses, wonders };
    });
  }, [play]);
  /** THE GAME'S RULES, while the game is the one showing the map. @see playing */
  useEffect(() => {
    if (!play) return;
    const st = useWorldStore.getState();
    st.setPlaying(true);
    st.setTool("inspect");
    return () => useWorldStore.getState().setPlaying(false);
  }, [play]);
  /**
   * THE PROJECTS, in the game: what a company already earned stood up
   * finished, the time away caught up, and the economy told what is built and
   * who is away building — for as long as the map is mounted.
   * @see game/projects, setProjectReader
   */
  useEffect(() => {
    if (!play) return;
    const owned = ownedNow();
    const features = new Set<FeatureId>();
    if (useInnovationStore.getState().unlocks.managers?.unlocked) features.add("managers");
    if (Object.values(useValuationStore.getState().mandateLevels).some((l) => l > 0)) features.add("mandates");
    // A map that already has services or ports has already earned them.
    for (const s of useWorldStore.getState().grid.structures.values()) {
      if (serviceOf(s.def)) features.add("services");
      if (structureDef(s.def)?.port) features.add("ports");
    }
    useWorldStore.getState().foundEarnedProjects(owned, features);
    // Whoever was on their way has arrived while the map was not looked at.
    useWorldStore.getState().settleHousing(owned, useSessionStore.getState().remoteBeds ?? {});
    const opened = catchUpWorks(useWorldStore.getState().grid, owned, payForLoad, Date.now());
    if (opened.length) announceOpened(opened);
    // What is built changes only with the map, so it is worked out again only
    // then: the economy asks every tick.
    let seenGrid: unknown = null, seenRev = -1, seenProjects = -1;
    let built: Set<ProjectId> = new Set();
    let residents = housingResidents(useWorldStore.getState().grid);
    let labs = labReading(useWorldStore.getState().grid);
    let racks = rackReading(useWorldStore.getState().grid);
    return setProjectReader(() => {
      const st = useWorldStore.getState();
      if (st.grid !== seenGrid || st.revision !== seenRev || st.projectRev !== seenProjects) {
        seenGrid = st.grid; seenRev = st.revision; seenProjects = st.projectRev;
        built = builtProjects(st.grid);
        residents = housingResidents(st.grid);
        labs = labReading(st.grid);
        racks = rackReading(st.grid);
      }
      // AWAY FROM THEIR DESKS: building, and — hired but not arrived — on
      // their way to the map, or waiting for somewhere to live on it.
      // @see awaitingArrival
      const away = { ...getWorks().away };
      const coming = awaitingArrival(ownedNow(), useSessionStore.getState().remoteBeds ?? {}, residents);
      for (const [id, n] of Object.entries(coming)) away[id as GeneratorId] = (away[id as GeneratorId] ?? 0) + n;
      // EVACUATED from a flood, for as long as their homes are under water.
      // @see evacuatedAway
      for (const [id, n] of Object.entries(evacuatedAway(st.grid))) away[id as GeneratorId] = (away[id as GeneratorId] ?? 0) + n;
      // OUT OF HOMES A FLOOD DAMAGED, until the repair crew has been. @see damage
      for (const [id, n] of Object.entries(damagedAway(st.grid))) away[id as GeneratorId] = (away[id as GeneratorId] ?? 0) + n;
      // MOPPING UP SLUDGE that ran out of the slop pit. @see stepCleanup
      const mopping = cleanupAway();
      if (mopping) away.vibe_coder = Math.min(ownedNow().vibe_coder ?? 0, (away.vibe_coder ?? 0) + mopping);
      // AT A HACKATHON, every vibe coder, for as long as it runs.
      if (st.events.some((e) => e.kind === "hackathon" && e.phase === "active" && e.chosen === "host")) {
        away.vibe_coder = ownedNow().vibe_coder ?? 0;
      }
      // AND WHOEVER AN EVENT'S CHOICE TOOK OFF WORK: sandbaggers until the
      // flood passes, hands at the quays while the convoy is in, tidiers
      // until the investors come. @see CREW_SHARE
      const crew = (who: GeneratorId, share: number) => {
        away[who] = Math.min(ownedNow()[who] ?? 0, (away[who] ?? 0) + Math.floor((ownedNow()[who] ?? 0) * share));
      };
      for (const e of st.events) {
        if (e.phase === "over") continue;
        if (e.kind === "river-flood" && e.chosen === "sandbags") crew("intern", CREW_SHARE.sandbags);
        if (e.kind === "convoy" && e.chosen === "hands" && e.phase === "active") crew("intern", CREW_SHARE.hands);
        if (e.kind === "investor-tour" && e.chosen === "tidy" && e.phase === "warning") crew("vibe_coder", CREW_SHARE.tidy);
      }
      const remote = useSessionStore.getState().remoteBeds ?? {};
      const net = getNetwork();
      const commute = net ? commuteFactor(st.grid, liveCommutes(st.grid, net), ownedNow(), remote) : undefined;
      return { built, away, commute, labs, racks };
    });
  }, [play]);
  // AND NOW THE ECONOMY CAN ASK: every reader above is in, so time away is
  // credited under the town's rules. Last, so it runs after them. @see whenWorldReady
  useEffect(() => {
    if (!play) return;
    markWorldReady();
    return markWorldGone;
  }, [play]);
}

/**
 * The renderer and the scene in it, sized to `wrapperRef`.
 *
 * THE DEVICE IS MADE BEFORE THE RENDERER RATHER THAN BY IT: `undefined` while
 * the ask is out, then an adapter and device, or `null` on WebGL and anywhere
 * WebGPU is not to be had — in which case Pixi makes its own exactly as it
 * always did. Nothing mounts until the ask has come back, because mounting
 * first and swapping later would build the whole scene on the device we are
 * trying to replace. @see openDevice
 */
export function WorldCanvas({
  wrapperRef, size,
}: {
  wrapperRef: RefObject<HTMLDivElement | null>;
  size: { width: number; height: number } | null;
}) {
  const [gpu, setGpu] = useState<HeldGpu | null | undefined>(undefined);
  useEffect(() => {
    if (rendererAsked() === "webgl") {
      setGpu(null);
      return;
    }
    let live = true;
    void openDevice().then((g) => {
      if (live) setGpu(g);
    });
    return () => {
      live = false;
    };
  }, []);
  useDisableDOMZoom({ wrapperRef });
  if (!size || gpu === undefined) return null;
  return (
    <Application
      resizeTo={wrapperRef}
      antialias
      autoDensity
      // Pixi skips its own device when handed one. @see openDevice
      {...(gpu ? { gpu } : {})}
      preference={rendererAsked()}
      resolution={Math.min(window.devicePixelRatio, 2)}
      backgroundColor={0x101418}
      hello={true}
    >
      <WorldViewport screenSize={size}>
        <WorldScene screenSize={size} />
      </WorldViewport>
    </Application>
  );
}
