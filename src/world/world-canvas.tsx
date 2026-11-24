/**
 * World v2 — the map itself, for whichever page shows it.
 *
 * Two pages do: the GAME, where the map is the company's town and it is played
 * by the game's rules, and the EDITOR (`?world=1`), where it is authored freely
 * with every tool and HUD. They share this — the renderer, the scene, the
 * map's lifetime — and differ only in what they put round it.
 * @see App, WorldEditor
 */
import { loadDeviceOpen } from "./load-progress";
import { MapLoading } from "./map-loading";
import { Application } from "@pixi/react";
import { useEffect, useState, type RefObject } from "react";

import { foundingRemoteBeds, setHousingReader } from "../game/housing";
import { useGeneratorStore } from "../state/generators.store";
import { startAutosave, startedOnFixture, useWorldStore } from "../state/world.store";
import { setProjectReader } from "../game/projects";
import { setTermReader } from "../game/term-sheets";
import { MAX_ROUTES } from "./events/defs/convoy";
import { DEFAULT_GEN, type GenParams } from "./gen/params";
import { setTownBonusReader } from "../game/acquisition";
import { setTownMoodReader } from "../game/town-mood";
import { townBonusOf } from "./projects/town-worth";
import { useSessionStore } from "../state/session.store";
import { useDisableDOMZoom } from "../utils/use-disable-dom-zoom";
import { loadSaved, setSaveSlot, type SaveSlot } from "./io/world-save";
import { hasWebGl, rendererAsked, usePixiGpu } from "./render/use-gpu";
import { WorldScene } from "./world-scene";
import { bedsReading, foundPlayedProjects, held, projectReader, termReading, townMoodReading } from "./play-wiring";
import { WorldViewport } from "./world-viewport";
import { usePrestigeStore } from "../state/prestige.store";
import { markWorldGone, markWorldReady } from "../game/world-ready";

export { rendererAsked } from "./render/use-gpu";

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

/** `?noaa` in the address: no multisampling. For measuring it against the look. */
const NO_AA = typeof location !== "undefined" && /[?&]noaa\b/.test(location.search);

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
  // A NEW COMPANY's founding gifts, once the map is up, not while drawing it.
  useEffect(() => {
    if (slot !== "run" || generatedKey !== `${slot}:${useSessionStore.getState().incorporatedAt}`) return;
    generatedKey = null;
    const perks = usePrestigeStore.getState().modifiers;
    // A CAFÉ to begin with, for founders who have done this before. @see foundingCafe
    if (perks.foundingCafe) useWorldStore.getState().foundCafe();
    // A SHIPPING ROUTE to begin with, likewise. @see ROUTE_BONUS
    for (let k = 0; k < perks.startingRoutes; k++) useSessionStore.getState().addRoute(MAX_ROUTES);
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
    return setHousingReader(held(() => bedsReading(play)));
  }, [play]);
  /**
   * HOW THE TOWN FEELS, told to the economy while the map is mounted in the
   * game: each kind's Home part of morale, its houses'. @see moodOffsets
   */
  useEffect(() => {
    if (!play) return;
    return setTownMoodReader(held(townMoodReading));
  }, [play]);
  /**
   * THE TOWN'S WORTH AT A SALE, told to the acquisition while the map is
   * mounted in the game. @see townBonusOf
   */
  useEffect(() => {
    if (!play) return;
    return setTownBonusReader(held(() => townBonusOf(useWorldStore.getState().grid)));
  }, [play]);
  /** THE MAP'S SIDE OF THE TERM SHEET: houses lived in, wonders standing, projects built. @see game/term-sheets */
  useEffect(() => {
    if (!play) return;
    return setTermReader(held(termReading));
  }, [play]);
  /** THE GAME'S RULES, while the game is the one showing the map. @see playing */
  useEffect(() => {
    if (!play) return;
    const st = useWorldStore.getState();
    st.setPlaying(true);
    // And in the game a road is built, not bought. @see roads/jobs
    st.setRoadWorks(true);
    st.setTool("inspect");
    return () => { useWorldStore.getState().setPlaying(false); useWorldStore.getState().setRoadWorks(false); };
  }, [play]);
  /**
   * THE PROJECTS, in the game: what a company already earned stood up
   * finished, the time away caught up, and the economy told what is built and
   * who is away building — for as long as the map is mounted.
   * @see game/projects, setProjectReader
   */
  useEffect(() => {
    if (!play) return;
    foundPlayedProjects();
    return setProjectReader(held(projectReader()));
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
  const gpu = usePixiGpu();
  useDisableDOMZoom({ wrapperRef });
  // (The device asked and answered — one, or none to be had: either way no longer what the load waits for.)
  useEffect(() => { if (gpu !== undefined) loadDeviceOpen(); }, [gpu]);
  if (!size || gpu === undefined) return <MapLoading />;
  // NO GPU AT ALL — no WebGPU device and no WebGL: said, rather than the 2D canvas Pixi would fall back to, which
  // cannot draw the map and throws on its first frame.
  if (!gpu && !hasWebGl()) return <NoAcceleration />;
  return (
    <>
    <Application
      resizeTo={wrapperRef}
      // (`?noaa` draws without it, to see what it costs: four samples a pixel, resolved every frame.)
      antialias={!NO_AA}
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
    <MapLoading />
    </>
  );
}

/** In place of the map when the browser has no graphics acceleration to draw it with. */
function NoAcceleration() {
  return (
    <div role="alert" className="flex h-full w-full items-center justify-center bg-surface-0 p-6 text-center text-fg dark:bg-surface-0 dark:text-fg">
      <div className="max-w-sm border border-line-quiet bg-surface-1 p-4 dark:border-line-quiet dark:bg-surface-1">
        <p className="text-sm font-semibold">Graphics acceleration is off</p>
        <p className="mt-1 text-xs text-fg-muted dark:text-fg-muted">The map needs WebGPU or WebGL. Restart the browser to turn it back on.</p>
      </div>
    </div>
  );
}
