/**
 * World v2 — a project's building, drawn going up, and drawn finished.
 *
 * Each building is a MODEL — its masses, the skin on each, its roofs, its
 * grounds and fit-out — and the site going up is that same model as far as
 * each trade has got: a pit, a plinth, a concrete frame a floor at a time,
 * the cladding following it up inside a netted scaffold, the roof, the
 * scaffold struck, and the building it was always going to be.
 * @see projects/looks, projects/schedule, projects/site
 *
 * A Graphics per column of the footprint, in that column's front band, and
 * one more for the crane's jib in front of them all. Redrawn when the work
 * has moved on enough to see, not every frame.
 */
import { Container, Graphics, Sprite } from "pixi.js";

import { getWorks, startedOnFixture, useWorldStore } from "../../state/world.store";
import { crosses, drawMover, outfitOf } from "../agents/town-render";
import { heightOf } from "../agents/people/cast";
import { bakedPeople, peopleLoaded, peopleSprites, posePerson } from "../agents/people/people-sheet";
import { propSprite, propSprites, propsLoaded } from "../props/props-sheet";
import { GROUND, groundClassOf, groundDraws } from "../render/ground-mesh";
import type { Mover } from "../agents/town";
import { idx, inBounds, type Structure } from "../grid";
import { HEIGHT_UNIT, HH, HW, cellToWorld } from "../iso";
import { drawLive, liveState } from "./projects/ai-live";
import { crewAt } from "./projects/crew";
import { lookOf } from "./projects/looks";
import type { Building } from "./projects/model";
import { makePen } from "./projects/pen";
import { siteAt, topOf, type Site } from "./projects/schedule";
import {
  OPENING, craneHeight, cranePose, craneRest, drawConfetti, drawFinished, drawSite, drawSky, jibLength,
} from "./projects/site";
import { structureDef } from "./def";
import { registerCustomRenderer, type RenderCtx, type StructureHandle } from "./render";

type ProjectHandle = StructureHandle & {
  /** A Graphics a TILE of the footprint, each in its tile's band; `cells` says which. @see makePen */
  columns: Graphics[];
  cells: { c: number; r: number }[];
  /**
   * The crane's jib and hook, in front of every column — IN THE MOVERS' RENDER
   * GROUP, because it is redrawn every frame it is working and a Graphics
   * whose contents change each frame in the band's own group re-batches the
   * whole chunk it is in. @see bands, dynamicOf
   */
  sky: Graphics;
  model: Building;
  drawn: string;
  /** The crew, one each, in the same group as the crane. @see crewAt */
  crew: Hand[];
  /** Seconds the crane has been working, which is where it is in its lift. */
  t: number;
  /** Seconds since it opened, while the confetti is still falling; else -1. */
  opened: number;
  /** The site as last drawn, for the crane to work over. */
  site: Site | null;
  /** An AI building's coolant, circuits and fans, open: redrawn a few times a second. @see ai-live */
  live: Graphics;
  /** Seconds since the live layer was last drawn, and its own clock. */
  liveDue: number;
  liveT: number;
  /** Seconds since the crew was last drawn. @see CREW_EVERY */
  crewDue: number;
  /** Whether the site has moved on since it was mounted: its tiles are then not batched. */
  growing: boolean;
  /** Its props from the sheet, once open, and what they were stood up for. @see Building.props */
  props: Container[];
  propsKey: string;
};

/**
 * How often a crew is drawn: a worker is a few pixels high and a pose at
 * twenty a second reads as walking. Every frame, a gallery's nine hundred
 * workers were re-tessellated sixty times a second — most of a frame.
 */
const CREW_EVERY = 1 / 20;

/**
 * Whether any of a project — its crane included — could be on screen.
 * Off it, its crew are left where they were last drawn: no pose to
 * tessellate, and no band rebuilt to hide them.
 */
function onScreen(s: Structure, ctx: RenderCtx): boolean {
  const vp = useWorldStore.getState().viewport as { getVisibleBounds?: () => { x: number; y: number; width: number; height: number } } | null;
  const b = vp?.getVisibleBounds?.();
  if (!b) return true;
  const { wx, wy } = cellToWorld(s.x + s.w / 2 - 0.5, s.y + s.h / 2 - 0.5, groundOf(s, ctx), ctx.scale);
  const rx = (s.w + s.h) * HW * ctx.scale, up = 40 * HEIGHT_UNIT * ctx.scale, down = (s.w + s.h) * HH * ctx.scale;
  return wx + rx > b.x && wx - rx < b.x + b.width && wy + down > b.y && wy - up < b.y + b.height;
}

/** How often the live layer is redrawn: smooth enough, at a fraction of the frames. */
const LIVE_EVERY = 1 / 24;

function drawLiveLayer(h: ProjectHandle, s: Structure, ctx: RenderCtx): void {
  h.live.clear();
  if (s.build || !h.model.live) return;
  const p = makePen(h.live, s.x - 0.5, s.y - 0.5, groundOf(s, ctx), ctx.scale, null);
  drawLive(p, h.model.live, h.liveT, liveState(s.id));
}

/** What a column of a building draws with: projection, and boxes clipped to the column. */
export function pen(g: Graphics, s: Structure, ctx: RenderCtx, c: number) {
  const sc = ctx.scale;
  const ground = inBounds(ctx.grid, s.x, s.y) ? ctx.grid.height[idx(ctx.grid, s.x, s.y)] : 0;
  const P = (u: number, v: number, z: number): [number, number] =>
    [(u - v) * HW * sc, (u + v) * HH * sc - (ground + z) * HEIGHT_UNIT * sc];
  const cu0 = s.x + c - 0.5, cu1 = cu0 + 1;
  const quad = (pts: [number, number][], color: number, alpha = 1) => {
    g.poly(pts.flat());
    g.fill({ color, alpha });
  };
  /**
   * A box, the part of it in this column: its top and the sides the camera
   * sees. Its lit +u side only in the column it ends in — inside the
   * building, the next column's box stands against it.
   */
  const box = (
    u0: number, v0: number, u1: number, v1: number, z0: number, z1: number,
    top: number, lit: number, shade: number,
  ) => {
    const a = Math.max(u0, cu0), b = Math.min(u1, cu1);
    if (b <= a || z1 <= z0) return;
    if (u1 <= cu1 + 1e-6) quad([P(b, v0, z1), P(b, v1, z1), P(b, v1, z0), P(b, v0, z0)], lit);
    quad([P(a, v1, z1), P(b, v1, z1), P(b, v1, z0), P(a, v1, z0)], shade);
    quad([P(a, v0, z1), P(b, v0, z1), P(b, v1, z1), P(a, v1, z1)], top);
  };
  const line = (pts: [number, number, number][], color: number, width: number) => {
    const inCol = pts.filter(([u]) => u >= cu0 - 1e-6 && u <= cu1 + 1e-6);
    if (inCol.length < 2) return;
    g.moveTo(...P(...inCol[0]));
    for (const p of inCol.slice(1)) g.lineTo(...P(...p));
    g.stroke({ color, width: Math.max(1, width * sc) });
  };
  return { P, quad, box, line, cu0, cu1, sc };
}

/** The band of a column's front cell. */
const bandOfColumn = (s: Structure, c: number) => s.x + c + s.y + s.h - 1;

/** The band of the tile at column `c`, row `r` of a footprint. */
const bandOfTile = (s: Structure, ctx: RenderCtx, c: number, r: number) =>
  Math.max(0, Math.min(ctx.bands.structureOf.length - 1, s.x + c + s.y + r));

/** The band of a site's front corner, where the crane's jib is filed. */
const frontBand = (s: Structure, ctx: RenderCtx) =>
  Math.max(0, Math.min(ctx.bands.structureOf.length - 1, bandOfColumn(s, s.w - 1)));

/** What a drawing depends on, so it is redrawn only when that changes enough to see. */
const stateOf = (s: Structure) =>
  s.build ? `${Math.floor((s.build.done / s.build.need) * 400)}:${s.build.delivered}:${s.build.priority === 0}` : "done";

/** Loads delivered and not yet built into the work: stacked in the yard. */
const stockOf = (s: Structure) => {
  const b = s.build;
  if (!b) return 0;
  const p = Math.min(1, b.done / b.need);
  return Math.max(0, b.delivered - Math.floor(p * b.deliveries + 1e-6));
};

/**
 * How many are working a site: the crane only moves, and the crew is only
 * drawn, with somebody on it. A fixture's sites have nobody — no road, so
 * nobody comes — and are worked anyway, so that what they look like at work
 * can be looked at. @see buildProjects
 */
function crewOn(s: Structure): number {
  if (startedOnFixture()) return Math.min(12, s.w * s.h * 2);
  return getWorks().crews.get(s.id)?.working ?? 0;
}
const working = (s: Structure) => crewOn(s) > 0;

/**
 * Whether a site is waiting for a load it cannot pay for: the crew stand
 * about and the crane stops, until the money comes or they go home.
 * @see stepWorks, STALL_GRACE
 */
const stalled = (s: Structure) => !startedOnFixture() && getWorks().stalled.has(s.id);

/** Whether a site is laid up: paused, nobody called to it. */
const laidUp = (s: Structure) => s.build?.priority === 0;

/**
 * One of the crew: drawn as the town draws a person, a Graphics posed each
 * time; or from the people sheet once it is in — five sprites, and a load
 * when they carry one. @see people-sheet
 */
type Hand = { node: Container; g: Graphics | null; parts: Sprite[]; load: Graphics | null; key: string };

function makeHand(baked: boolean, tints: () => number[]): Hand {
  if (!baked) {
    const g = new Graphics();
    g.eventMode = "none";
    // Batched: redrawn every frame, a worker alone was a draw call and an
    // upload of its own — a gallery's crews were nine hundred of each.
    g.context.batchMode = "batch";
    return { node: g, g, parts: [], load: null, key: "" };
  }
  const node = new Container();
  node.eventMode = "none";
  const parts = tints().map((t) => { const sp = new Sprite(); sp.tint = t; node.addChild(sp); return sp; });
  const load = new Graphics();
  load.context.batchMode = "batch";
  node.addChild(load);
  return { node, g: null, parts, load, key: "" };
}

const dropHand = (w: Hand) => { w.node.parent?.removeChild(w.node); w.node.destroy({ children: true }); };

/** A baked person is 1.75 m: their load a box of bricks at their chest, half steps and tiles. */
const LOAD = { half: 0.018, ahead: 0.03, z0: 0.42, z1: 0.56 };

/** Hi-vis, and the foreman in a white shirt. */
const VESTS = [0xf47b20, 0xc8dc32, 0xf47b20, 0xe8e23a];
const FOREMAN = 0xf2f2f2;

/** The crew where the work is, each drawn as the town draws a person. */
function drawCrew(h: ProjectHandle, s: Structure, ctx: RenderCtx, ground: number): void {
  const site = h.site;
  const crew = site ? crewAt(h.model, { w: s.w, h: s.h }, site, crewOn(s), h.t, stalled(s)) : [];
  // THE PEOPLE SHEET, once in: whoever was drawn before it is drawn again from it.
  const P = bakedPeople() ? peopleLoaded() : null;
  if (bakedPeople() && !P) void peopleSprites();
  for (const w of h.crew.splice(crew.length)) dropHand(w);
  crew.forEach((w, k) => {
    const id = s.id * 64 + k;
    const m = {
      id, kind: "person", x: s.x - 0.5 + w.u, y: s.y - 0.5 + w.v, z: ground + w.z,
      heading: w.heading, phase: w.phase, pitch: 0,
      colour: w.role === "foreman" ? FOREMAN : VESTS[k % VESTS.length],
      job: { site: s.id, role: w.working ? "working" : "builder" },
    } as unknown as Mover;
    if (h.crew[k] && !h.crew[k].g !== !!P) { dropHand(h.crew[k]); h.crew.splice(k, 1); }
    if (!h.crew[k]) {
      const o = outfitOf(m);
      h.crew.splice(k, 0, makeHand(!!P, () => [o.skin, o.legs, m.colour, o.hair, 0xffffff]));
    }
    const hand = h.crew[k], g = hand.node;
    if (hand.g) {
      drawMover(hand.g, m, ctx.scale, ctx.bands.bands.length);
      if (w.carrying) {
        const p = makePen(hand.g, s.x - 0.5, s.y - 0.5, ground, ctx.scale, null);
        const du = Math.cos(w.heading) * 0.07, dv = Math.sin(w.heading) * 0.07;
        p.box(w.u + du - 0.05, w.v + dv - 0.05, w.u + du + 0.05, w.v + dv + 0.05, w.z + 0.55, w.z + 0.78, 0xb3563f);
      }
    } else {
      // A BUILDER from the sheet, hammering or walking, at their own height.
      hand.key = posePerson(hand.parts, P!, "builder", w.working ? "work" : "walk", w.heading, w.phase, ctx.scale, heightOf(id), hand.key);
      const x = (m.x - m.y) * HW * ctx.scale, y = (m.x + m.y) * HH * ctx.scale - m.z * HEIGHT_UNIT * ctx.scale;
      for (const sp of hand.parts) sp.position.set(x, y);
      hand.load!.clear();
      if (w.carrying) {
        const p = makePen(hand.load!, s.x - 0.5, s.y - 0.5, ground, ctx.scale, null);
        const du = Math.cos(w.heading) * LOAD.ahead, dv = Math.sin(w.heading) * LOAD.ahead, r = LOAD.half;
        p.box(w.u + du - r, w.v + dv - r, w.u + du + r, w.v + dv + r, w.z + LOAD.z0, w.z + LOAD.z1, 0xb3563f);
      }
    }
    // IN THE BAND OF THE TILE THEY STAND ON, over that tile's share of the
    // building — they stand at its front faces — and under anything in
    // front of it. Nearer the camera drawn later within it.
    const c = Math.max(0, Math.min(s.w - 1, Math.floor(w.u))), r = Math.max(0, Math.min(s.h - 1, Math.floor(w.v)));
    const band = ctx.bands.dynamicOf[bandOfTile(s, ctx, c, r)];
    const z = 1 + (w.u + w.v) / 100 + w.z / 10000;
    if (g.parent !== band) { g.parent?.removeChild(g); g.zIndex = z; band.addChild(g); }
    // Only when it carries them past someone: else the band is sorted and rebuilt every frame. @see crosses
    else if (crosses(g, z)) g.zIndex = z;
  });
}

/** The crane over a site, where it is in its lift. */
function drawCrane(h: ProjectHandle, s: Structure, ctx: RenderCtx, ground: number): void {
  h.sky.clear();
  const site = h.site;
  if (!site || h.model.crane !== "tower" || !site.framing || site.strike >= 1) return;
  const f = { w: s.w, h: s.h };
  const p = makePen(h.sky, s.x - 0.5, s.y - 0.5, ground, ctx.scale, null);
  // At rest, its hook up and empty, when nobody is working.
  const pose = working(s) && !stalled(s)
    ? cranePose(f, h.model, site, h.t)
    : { heading: craneRest(f), reach: jibLength(f) * 0.6, hook: craneHeight(site.top) - 0.6, load: false };
  drawSky(p, f, craneHeight(site.top), pose);
}

const groundOf = (s: Structure, ctx: RenderCtx) =>
  inBounds(ctx.grid, s.x, s.y) ? ctx.grid.height[idx(ctx.grid, s.x, s.y)] : 0;

/** Whether every cell of the plot is shaded grass: then a lawn would only hide it. @see Building.lawn */
function onGrass(s: Structure, ctx: RenderCtx): boolean {
  const palette = useWorldStore.getState().palette;
  for (let r = 0; r < s.h; r++) for (let c = 0; c < s.w; c++) {
    const x = s.x + c, y = s.y + r;
    if (!inBounds(ctx.grid, x, y) || !groundDraws(ctx.grid, palette, x, y)) return false;
    if (groundClassOf(palette, ctx.grid.terrain[idx(ctx.grid, x, y)]) !== GROUND.grass) return false;
  }
  return true;
}

/**
 * STAND UP ITS PROPS, once it is open: each in the band of the tile it stands
 * on, over that tile's share of the building. Taken down while it is a site.
 */
function placeProps(h: ProjectHandle, s: Structure, ctx: RenderCtx, ground: number): void {
  const want = !h.site && h.model.props?.length ? h.model.props : null;
  const P = want ? propsLoaded() : null;
  if (want && !P) void propSprites();
  const key = want && P ? `${ctx.scale}|${ground}|${JSON.stringify(want)}` : "";
  if (key === h.propsKey) return;
  for (const c of h.props) { c.parent?.removeChild(c); c.destroy({ children: true }); }
  h.props = [];
  h.propsKey = key;
  if (!want || !P) return;
  for (const pr of [...want].sort((a, b) => a.u + a.v - (b.u + b.v))) {
    const c = Math.max(0, Math.min(s.w - 1, Math.floor(pr.u))), r = Math.max(0, Math.min(s.h - 1, Math.floor(pr.v)));
    const sp = propSprite(P, pr.id, pr.turn, s.x - 0.5 + pr.u, s.y - 0.5 + pr.v, ground + (pr.z ?? 0.03), ctx.scale, pr.tint, pr.size);
    if (!sp) continue;
    ctx.bands.structureOf[bandOfTile(s, ctx, c, r)].addChild(sp);
    h.props.push(sp);
  }
}

/** Draw every column of a project, and the crane over it. */
function draw(h: ProjectHandle, s: Structure, ctx: RenderCtx, growing = false): void {
  const ground = groundOf(s, ctx);
  const f = { w: s.w, h: s.h };
  const b = s.build;
  const site = b ? siteAt(h.model, Math.min(1, b.done / b.need)) : null;
  h.site = site;
  h.growing = !!site && (growing || h.growing);
  const lawnless = !site && !!h.model.lawn && onGrass(s, ctx);
  h.columns.forEach((g, k) => {
    // A SITE GOING UP IS NEVER BATCHED: redrawn every quarter percent, a small
    // tile's piece crossed Pixi's batching limit back and forth as the work
    // grew, and each crossing re-packed its chunk — the 3×3 garage's pieces
    // flickered, smeared toward its back tile and lagged the rest. It is
    // un-batched the first time the work moves on, once, and stays so; a site
    // that is not moving — laid up, or a fixture's — is drawn once and batches.
    //
    // A FINISHED BUILDING ALWAYS BATCHES. It is drawn once, so batching costs
    // nothing after; left to Pixi's own rule, any tile over 400 vertices — most
    // of a detailed building — was drawn alone, a draw call and a uniform group
    // of its own every frame: a gallery of them was a thousand draws, and
    // overflowed WebGPU's per-frame uniform buffer outright.
    g.context.batchMode = h.growing ? "no-batch" : "batch";
    g.clear();
    const p = makePen(g, s.x - 0.5, s.y - 0.5, ground, ctx.scale, h.cells[k]);
    if (site) drawSite(p, h.model, f, site, stockOf(s), laidUp(s));
    else {
      if (h.model.lawn && !lawnless) h.model.lawn(p, f);
      drawFinished(p, h.model, f, structureDef(s.def)?.ports);
    }
  });
  placeProps(h, s, ctx, ground);
  drawCrane(h, s, ctx, ground);
  drawCrew(h, s, ctx, ground);
  drawLiveLayer(h, s, ctx);
}

function mount(s: Structure, _def: unknown, ctx: RenderCtx): ProjectHandle {
  const columns: Graphics[] = [];
  const cells: { c: number; r: number }[] = [];
  for (let r = 0; r < s.h; r++) {
    for (let c = 0; c < s.w; c++) {
      const g = new Graphics();
      g.eventMode = "none";
      ctx.bands.structureOf[bandOfTile(s, ctx, c, r)].addChild(g);
      columns.push(g);
      cells.push({ c, r });
    }
  }
  const sky = new Graphics();
  sky.eventMode = "none";
  sky.context.batchMode = "batch";
  // Above whoever is walking past in the same band: it is in the sky.
  sky.zIndex = 2;
  ctx.bands.dynamicOf[frontBand(s, ctx)].addChild(sky);
  // On its faces, in front of the building and under the crane and confetti.
  const live = new Graphics();
  live.eventMode = "none";
  live.context.batchMode = "batch";
  live.zIndex = 1.5;
  ctx.bands.dynamicOf[frontBand(s, ctx)].addChild(live);
  const handle: ProjectHandle = {
    columns, cells, sky, live, model: lookOf(s.def, { w: s.w, h: s.h }), drawn: stateOf(s),
    // Out of step with every other crane on the map.
    t: s.id * 3.7, site: null, crew: [], opened: -1, liveDue: 0, liveT: s.id * 1.9, crewDue: 0, growing: false, props: [], propsKey: "",
    destroy: () => { for (const g of [...columns, sky, live]) { g.parent?.removeChild(g); g.destroy(); } handle.crew.forEach(dropHand); for (const c of handle.props) { c.parent?.removeChild(c); c.destroy({ children: true }); } },
  };
  draw(handle, s, ctx);
  return handle;
}

registerCustomRenderer("project", {
  mount,
  update(h, s, _def, ctx) {
    const handle = h as ProjectHandle;
    handle.model = lookOf(s.def, { w: s.w, h: s.h });
    draw(handle, s, ctx);
    handle.drawn = stateOf(s);
  },
  // GOING UP: redrawn as the work moves on, a quarter of a percent at a time,
  // and the crane every frame it is working.
  tick(h, s, _def, ctx, dt) {
    const handle = h as ProjectHandle;
    const now = stateOf(s);
    if (now !== handle.drawn) {
      // IT HAS OPENED: a site last frame, a building this one.
      if (handle.site && !s.build) handle.opened = 0;
      draw(handle, s, ctx, true);
      handle.drawn = now;
    }
    const ground = groundOf(s, ctx);
    // ITS PROPS, when their sheet comes in after it was drawn.
    if (!handle.site && handle.model.props && !handle.propsKey && propsLoaded()) placeProps(handle, s, ctx, ground);
    handle.crewDue += dt;
    if (handle.site && working(s)) {
      // The crane's clock stops while the site waits for a load.
      if (!stalled(s)) handle.t += dt;
      if (handle.crewDue >= CREW_EVERY && onScreen(s, ctx)) {
        handle.crewDue = 0;
        if (handle.model.crane === "tower") drawCrane(handle, s, ctx, ground);
        drawCrew(handle, s, ctx, ground);
      }
    } else if (handle.crew.length) drawCrew(handle, s, ctx, ground);
    if (handle.model.live && !s.build) {
      handle.liveT += dt;
      handle.liveDue += dt;
      // Off screen it is left as it was. @see onScreen
      if (handle.liveDue >= LIVE_EVERY && onScreen(s, ctx)) { handle.liveDue = 0; drawLiveLayer(handle, s, ctx); }
    }
    if (handle.opened >= 0) {
      handle.opened += dt;
      handle.sky.clear();
      if (handle.opened > OPENING) handle.opened = -1;
      else {
        const p = makePen(handle.sky, s.x - 0.5, s.y - 0.5, ground, ctx.scale, null);
        drawConfetti(p, { w: s.w, h: s.h }, topOf(handle.model), handle.opened);
      }
    }
  },
  unmount(h) { h.destroy(); },
});
