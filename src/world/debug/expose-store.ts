/**
 * Puts the editor store on `window` in dev.
 *
 * Not a convenience: under Vite, `await import("…/world.store")` from a
 * devtools console resolves through a DIFFERENT module graph and hands back a
 * SECOND store instance, whose state has nothing to do with the one the UI is
 * rendering. Any assertion made against it is silently meaningless. This
 * module runs inside the app's own graph, so the handle it exposes is the real
 * one — the only reliable way to inspect the live map from outside React.
 */
import { getNetwork, netComponentAt, useWorldStore } from "../../state/world.store";

declare global {
  interface Window {
    __world?: typeof useWorldStore;
    /** Road graph, for the same reason: it lives outside the store entirely. */
    __net?: { get: typeof getNetwork; at: typeof netComponentAt };
    /**
     * Mounted structures, set by the scene.
     *
     * Needed for the same reason as the others — it lives outside the store —
     * and specifically because an ANIMATED structure cannot be checked any
     * other way from outside: the Pixi canvas has no `preserveDrawingBuffer`,
     * so reading its pixels back outside its own frame returns an empty image,
     * and a comparison of two such reads looks exactly like a still surface.
     */
    __structures?: unknown;
    /**
     * The live water field, for the same reason.
     *
     * Depth is a float updated every frame and held outside the store, so this
     * is the only way to look at it from a console — and the only way to check
     * a flow sim without watching it, since the canvas cannot be read back.
     */
    __water?: unknown;
    /** The water mesh layer, so a frame can be drawn by hand when rAF is paused. */
    __waterLayer?: unknown;
    /**
     * The waterfall layer, which no screenshot can settle on its own.
     *
     * A fall is a handful of quads filed into bands, and the whole question
     * about it — is a piece in the band it is actually in — is about WHICH
     * band holds WHICH quad. That is invisible when it is right and looks
     * like ordinary terrain in front of water when it is wrong, so it is
     * counted from a console rather than looked at.
     */
    __falls?: unknown;
    /** The device-built falls layer. @see createGpuFallLayer */
    __sheets?: () => unknown;
    /** The live device solver, for a harness. */
    __solver?: () => unknown;
    /**
     * The GPU water layer, which is where the FOAM field lives.
     *
     * `__waterLayer` is the CPU mesh builder and is null whenever the vertex
     * shader path is the one running — which is most of the time — so it is no
     * use for asking what the water is being drawn WITH. Foam is a field like
     * the flow wash, it is the only thing that makes water white, and a
     * console is the only place it can be read.
     */
    __waterGpu?: unknown;
    /**
     * The Pixi renderer, for the work that has to reach past Pixi's own API.
     *
     * The device-fed textures are the reason: asking what GPU object stands
     * behind a `TextureSource`, and whether it can be copied into, is not a
     * question Pixi's surface answers. Dev only.
     */
    __renderer?: unknown;
    /** Turns the solver's readback off, to measure it. @see setReadback */
    __readback?: (on: boolean) => void;
    /** Forces the dispatch region to the whole map. @see setWholeMap */
    __wholeMap?: (on: boolean) => void;
    /** Leaves passes out of the frame, for bisecting a fault. @see setSkip */
    __skip?: (names: string[]) => void;
    /** Lips back as a list, or as five whole arrays. @see setFallList */
    __fallList?: (list: boolean) => void;
    /** Depth back by the band, or whole. @see setDepthBand */
    __depthBand?: (band: boolean) => void;
    /** Hides the water's meshes, to time the render without them. */
    __showWater?: (show: boolean) => void;
    /** Milliseconds of GPU per pass, averaged. @see Stamps */
    __gpuTime?: () => {
      of: Record<string, number>; total: number; frames: number;
    } | null;
    /** Drives frames by hand, past the rAF throttle. See world-scene. */
    __waterBench?: (n?: number, sync?: boolean) => Promise<unknown>;
    /** Draws one scene both ways and compares the pixels. See water-compare. */
    __waterCompare?: (o?: Record<string, number>) => unknown;
    /**
     * Runs the compute spike and says whether the round trip held.
     *
     * Only under `?spike` — see `render/compute-spike`, which is the one
     * question the whole compute port rests on.
     */
    __spike?: () => Promise<{ ok: boolean; why?: string; worst?: number }>;
    /**
     * One solver pass on the device against the same pass on the CPU.
     *
     * The instrument the compute port is built against — see
     * `fluid/gpu/compare-pass`. `bun test` cannot run WGSL, so this is the
     * only place the answer exists.
     */
    /**
     * Every solver pass, run against the map on screen. See `gpu/check-live`.
     */
    __gpuCheck?: () => Promise<unknown>;
    /** One pass, on a collapsing pour — the scene the limiter fires on. */
    __pourPass?: (
      settle?: number, through?: string, solo?: boolean,
    ) => Promise<unknown>;
    __accelCompare?: (
      settle?: number, wind?: number,
      through?: "diffuse" | "accelerate" | "limit" | "divergence" | "apply"
      | "falls",
      solo?: boolean,
    ) => Promise<unknown>;
    /** A pour between frames, on the device path. @see checkPour */
    __pourCheck?: (
      onWet?: boolean, breaking?: boolean, openEdge?: boolean, frames?: number,
      wind?: number,
    ) => Promise<unknown>;
    /** The same pour, driven the way the tick drives it. @see checkPourLive */
    __pourLive?: (
      frames?: number, openEdge?: boolean, onWet?: boolean, twin?: boolean,
      pace?: "frame" | "free", away?: number,
    ) => string;
    /** Where `__pourLive` leaves its answer. @see checkPourLive */
    __pourLiveResult?: unknown;
    /** Whole frames, both solvers. @see compareFrames */
    __frameCompare?: (frames?: number, spray?: boolean) => Promise<unknown>;
    /** The cliff index, both ways. @see compareCliffs */
    __cliffCompare?: (
      settle?: number, spray?: boolean, fresh?: boolean,
    ) => Promise<unknown>;
    /** The falls pass on a scene that actually SPRAYS. @see spray */
    __sprayCompare?: (settle?: number, through?: string) => Promise<unknown>;
    /**
     * The band layer, so a console session can move the camera.
     *
     * Band visibility is culled by a `useTick`, and a hidden browser tab does
     * not get one — so a scripted camera move leaves everything it moved to
     * still culled away, and the map looks empty for no reason at all.
     */
    __bands?: unknown;
  }
}

if (import.meta.env.DEV) {
  window.__world = useWorldStore;
  window.__net = { get: getNetwork, at: netComponentAt };
}
