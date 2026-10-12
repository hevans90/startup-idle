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
import { Graphics } from "pixi.js";

import { getWorks, startedOnFixture } from "../../state/world.store";
import { idx, inBounds, type Structure } from "../grid";
import { HEIGHT_UNIT, HH, HW } from "../iso";
import { lookOf } from "./projects/looks";
import type { Building } from "./projects/model";
import { makePen } from "./projects/pen";
import { siteAt, type Site } from "./projects/schedule";
import { craneHeight, cranePose, craneRest, drawFinished, drawSite, drawSky, jibLength } from "./projects/site";
import { registerCustomRenderer, type RenderCtx, type StructureHandle } from "./render";

type ProjectHandle = StructureHandle & {
  columns: Graphics[];
  /**
   * The crane's jib and hook, in front of every column — IN THE MOVERS' RENDER
   * GROUP, because it is redrawn every frame it is working and a Graphics
   * whose contents change each frame in the band's own group re-batches the
   * whole chunk it is in. @see bands, dynamicOf
   */
  sky: Graphics;
  model: Building;
  drawn: string;
  /** Seconds the crane has been working, which is where it is in its lift. */
  t: number;
  /** The site as last drawn, for the crane to work over. */
  site: Site | null;
};

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

/** The band of a site's front corner, where the crane's jib is filed. */
const frontBand = (s: Structure, ctx: RenderCtx) =>
  Math.max(0, Math.min(ctx.bands.structureOf.length - 1, bandOfColumn(s, s.w - 1)));

/** What a drawing depends on, so it is redrawn only when that changes enough to see. */
const stateOf = (s: Structure) =>
  s.build ? `${Math.floor((s.build.done / s.build.need) * 400)}:${s.build.delivered}` : "done";

/** Loads delivered and not yet built into the work: stacked in the yard. */
const stockOf = (s: Structure) => {
  const b = s.build;
  if (!b) return 0;
  const p = Math.min(1, b.done / b.need);
  return Math.max(0, b.delivered - Math.floor(p * b.deliveries + 1e-6));
};

/**
 * Whether anybody is working a site: the crane only moves with a crew on it.
 * A fixture's sites have nobody — no road, so nobody comes — and are worked
 * anyway, so that what they look like at work can be looked at. @see buildProjects
 */
function working(s: Structure): boolean {
  if (startedOnFixture()) return true;
  const w = getWorks();
  return (w.crews.get(s.id)?.working ?? 0) > 0;
}

/** The crane over a site, where it is in its lift. */
function drawCrane(h: ProjectHandle, s: Structure, ctx: RenderCtx, ground: number): void {
  h.sky.clear();
  const site = h.site;
  if (!site || h.model.crane !== "tower" || !site.framing || site.strike >= 1) return;
  const f = { w: s.w, h: s.h };
  const p = makePen(h.sky, s.x - 0.5, s.y - 0.5, ground, ctx.scale, null);
  // At rest, its hook up and empty, when nobody is working.
  const pose = working(s)
    ? cranePose(f, h.model, site, h.t)
    : { heading: craneRest(f), reach: jibLength(f) * 0.6, hook: craneHeight(site.top) - 0.6, load: false };
  drawSky(p, f, craneHeight(site.top), pose);
}

const groundOf = (s: Structure, ctx: RenderCtx) =>
  inBounds(ctx.grid, s.x, s.y) ? ctx.grid.height[idx(ctx.grid, s.x, s.y)] : 0;

/** Draw every column of a project, and the crane over it. */
function draw(h: ProjectHandle, s: Structure, ctx: RenderCtx): void {
  const ground = groundOf(s, ctx);
  const f = { w: s.w, h: s.h };
  const b = s.build;
  const site = b ? siteAt(h.model, Math.min(1, b.done / b.need)) : null;
  h.site = site;
  h.columns.forEach((g, c) => {
    g.clear();
    const p = makePen(g, s.x - 0.5, s.y - 0.5, ground, ctx.scale, c);
    if (site) drawSite(p, h.model, f, site, stockOf(s));
    else drawFinished(p, h.model, f);
  });
  drawCrane(h, s, ctx, ground);
}

function mount(s: Structure, _def: unknown, ctx: RenderCtx): ProjectHandle {
  const columns: Graphics[] = [];
  for (let c = 0; c < s.w; c++) {
    const g = new Graphics();
    g.eventMode = "none";
    const band = Math.max(0, Math.min(ctx.bands.structureOf.length - 1, bandOfColumn(s, c)));
    ctx.bands.structureOf[band].addChild(g);
    columns.push(g);
  }
  const sky = new Graphics();
  sky.eventMode = "none";
  // Above whoever is walking past in the same band: it is in the sky.
  sky.zIndex = 2;
  ctx.bands.dynamicOf[frontBand(s, ctx)].addChild(sky);
  const handle: ProjectHandle = {
    columns, sky, model: lookOf(s.def, { w: s.w, h: s.h }), drawn: stateOf(s),
    // Out of step with every other crane on the map.
    t: s.id * 3.7, site: null,
    destroy: () => { for (const g of [...columns, sky]) { g.parent?.removeChild(g); g.destroy(); } },
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
      draw(handle, s, ctx);
      handle.drawn = now;
    }
    if (handle.site && handle.model.crane === "tower" && working(s)) {
      handle.t += dt;
      drawCrane(handle, s, ctx, groundOf(s, ctx));
    }
  },
  unmount(h) { h.destroy(); },
});
