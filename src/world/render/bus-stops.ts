/**
 * World v2 — THE BUS SHELTERS: one at each stop a route calls at, at the back
 * of the pavement facing the road, the queue standing in front of it; its
 * band and the stop's sign in the route's colour. From the props sheet.
 * @see agents/bus-routes, agents/buses queueAt, props/models shelterTris
 *
 * Laid out again only when the lanes or the routes change.
 */
import type { Container } from "pixi.js";

import { NEIGHBOUR } from "../../iso/dir";
import type { Route } from "../agents/bus-routes";
import type { Traffic } from "../agents/lanes/drive";
import { roadHeightAt } from "../agents/roads";
import type { Grid } from "../grid";
import { bandOf } from "../iso";
import { bakedProps, propSprite, propSprites, propsLoaded, turnOf } from "../props/props-sheet";
import type { BandLayer } from "./bands";

/** How far in from the pavement's back edge a shelter stands, and back along the kerb from the stop, tiles. */
const BACK = 0.07;
const ALONG = -0.1;

export type BusStops = {
  sync: (g: Grid, T: Traffic, routes: readonly Route[], scale: number) => void;
  destroy: () => void;
};

export function createBusStops(bands: BandLayer): BusStops {
  let drawn: Container[] = [];
  let key = "";
  const clear = () => {
    for (const c of drawn) { c.parent?.removeChild(c); c.destroy({ children: true }); }
    drawn = [];
  };
  return {
    sync(g, T, routes, scale) {
      const P = bakedProps() ? propsLoaded() : null;
      if (bakedProps() && !P) void propSprites();
      const k = `${T.key}|${scale}|${routes.map((r) => r.stops.join(",") + ":" + r.colour).join("|")}|${P ? 1 : 0}`;
      if (k === key) return;
      key = k;
      clear();
      if (!P) return;
      // Each stop once, in the colour of the first route calling at it.
      const colour = new Map<number, number>();
      for (const r of routes) for (const id of r.stops) if (!colour.has(id)) colour.set(id, r.colour);
      for (const [id, tint] of colour) {
        const s = T.G.stops[id];
        if (!s) continue;
        const [kx, ky] = NEIGHBOUR[s.kerb];
        const cx = s.cell % g.w, cy = (s.cell / g.w) | 0;
        const ax = Math.cos(s.heading), ay = Math.sin(s.heading);
        const u = cx + kx * (0.5 - BACK) + ax * ALONG, v = cy + ky * (0.5 - BACK) + ay * ALONG;
        const band = bandOf(cx, cy), layer = bands.dynamicOf[band];
        if (!layer) continue;
        const c = propSprite(P, "shelter", turnOf(Math.atan2(-ky, -kx)), u, v, roadHeightAt(g, cx, cy), scale, tint);
        if (!c) continue;
        c.zIndex = u + v - band;
        layer.addChild(c);
        drawn.push(c);
      }
    },
    destroy() { clear(); key = ""; },
  };
}
