/**
 * World v2 — the map itself, for whichever page shows it.
 *
 * Two pages do: the GAME, where the map is the company's town and it is played
 * by the game's rules, and the EDITOR (`?world=1`), where it is authored freely
 * with every tool and HUD. They share this — the renderer, the scene, the
 * map's lifetime — and differ only in what they put round it.
 * @see App, WorldEditor
 */
import { Application } from "@pixi/react";
import { useEffect, useState, type RefObject } from "react";

import { addBeds, foundingRemoteBeds, housingCapacity, setHousingReader } from "../game/housing";
import { useGeneratorStore } from "../state/generators.store";
import { getWorks, startAutosave, startedOnFixture, useWorldStore } from "../state/world.store";
import { setProjectReader, type ProjectId } from "../game/projects";
import { builtProjects, catchUpWorks } from "./projects/works";
import { announceOpened, ownedNow, payForLoad } from "./projects/economy";
import { useSessionStore } from "../state/session.store";
import { useDisableDOMZoom } from "../utils/use-disable-dom-zoom";
import { loadSaved, setSaveSlot, type SaveSlot } from "./io/world-save";
import { openDevice, type HeldGpu } from "./render/device";
import { WorldScene } from "./world-scene";
import { WorldViewport } from "./world-viewport";

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
    useWorldStore.getState().generateWorld(useSessionStore.getState().incorporatedAt);
    return true;
  });
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
    useWorldStore.getState().foundEarnedProjects(owned);
    const opened = catchUpWorks(useWorldStore.getState().grid, owned, payForLoad, Date.now());
    if (opened.length) announceOpened(opened);
    // What is built changes only with the map, so it is worked out again only
    // then: the economy asks every tick.
    let seenGrid: unknown = null, seenRev = -1, seenProjects = -1;
    let built: Set<ProjectId> = new Set();
    return setProjectReader(() => {
      const st = useWorldStore.getState();
      if (st.grid !== seenGrid || st.revision !== seenRev || st.projectRev !== seenProjects) {
        seenGrid = st.grid; seenRev = st.revision; seenProjects = st.projectRev;
        built = builtProjects(st.grid);
      }
      return { built, away: getWorks().away };
    });
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
