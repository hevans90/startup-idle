/**
 * World v2 — A STREET MADE FINE, SEEN: what each level of a street puts on
 * its pavements (@see liveBeauty):
 *  1. trees, planters and bins;
 *  2. lamp posts, benches, brick along the kerb and crossings at its ends;
 *  3. café tables, bunting between the lamps, and murals on its houses.
 *
 * DRAWN AS THE CULTURE PROPS ARE: a Graphics a band among the movers of the
 * band, built only when the streets' levels or the map change — never a
 * frame at a time. @see createCultureProps, render-group rebuilds
 */
import { Graphics } from "pixi.js";

import { housedBy } from "../../game/housing";
import type { Beauty } from "../agents/beauty";
import { idx, inBounds, type Grid } from "../grid";
import { bandOf } from "../iso";
import { streetsOf, type Streets } from "../roads/streets";
import { isPaved } from "../roads/mask";
import { makePen, mix, tone, type Pen } from "../structures/projects/pen";
import { tree } from "../structures/projects/looks";
import type { BandLayer } from "./bands";
import { faceOf } from "./shopfronts";

/** A prop on a road tile: which, its tile, and the kerb it stands by. */
export type StreetProp = {
  kind: "tree" | "planter" | "bin" | "lamp" | "bench" | "brick" | "crossing" | "table" | "bunting";
  x: number; y: number;
  /** The kerb: the side of the tile with no road beyond it. */
  side: "N" | "E" | "S" | "W";
};
/** A house's mural: on the face away from its street. */
export type Mural = { id: number; x: number; y: number; face: "u" | "v" };

const SIDES = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] } as const;

/**
 * What every street's level puts where. On each road tile of a street, by
 * each kerb — a side with no road beyond it — the tile's place along the
 * street, `(x + y)`, saying which. Pure, for tests.
 */
export function streetPropsOf(g: Grid, streets: Streets, b: Beauty): { props: StreetProp[]; murals: Mural[] } {
  const props: StreetProp[] = [];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = idx(g, x, y), level = b.tile[i];
      if (level < 1) continue;
      const k = x + y;
      // AT A STREET'S END, where it meets a junction: its crossing.
      const end = (Object.values(SIDES) as readonly (readonly [number, number])[]).some(([dx, dy]) => inBounds(g, x + dx, y + dy) && isPaved(g, x + dx, y + dy) && streets.of[idx(g, x + dx, y + dy)] < 0);
      // Its side says the way the street runs: "N" along x, its kerbs north and south.
      if (level >= 2 && end) props.push({ kind: "crossing", x, y, side: !isPaved(g, x, y - 1) || !isPaved(g, x, y + 1) ? "N" : "E" });
      for (const side of Object.keys(SIDES) as StreetProp["side"][]) {
        const [dx, dy] = SIDES[side];
        if (isPaved(g, x + dx, y + dy)) continue;
        // Each kerb its own beat, so the two sides of a street do not match.
        const n = k + (side === "S" || side === "E" ? 2 : 0);
        if (level >= 2) props.push({ kind: "brick", x, y, side });
        if (end) continue;
        const at = (kind: StreetProp["kind"]) => props.push({ kind, x, y, side });
        if (level >= 2 && n % 4 === 0) at("lamp");
        else if (n % 4 === 2) at("tree");
        else if (level >= 3 && n % 8 === 1) at("table");
        else if (level >= 2 && n % 8 === 3) at("bench");
        else if (n % 8 === 5) at("planter");
        else if (n % 8 === 7) at("bin");
        if (level >= 3) at("bunting");
      }
    }
  }
  // MURALS: on every other house of the finest streets with no shop, on the face away from its street.
  const murals: Mural[] = [];
  for (const [st, ids] of b.homes) {
    if (b.street[st] < 3) continue;
    for (const id of ids) {
      const s = g.structures.get(id);
      if (!s || s.shop || id % 2 || !housedBy(s.def)) continue;
      const x = s.x + s.w - 1, y = s.y + s.h - 1;
      murals.push({ id, x, y, face: isPaved(g, x, y + 1) ? "u" : "v" });
    }
  }
  return { props, murals };
}

const POLE = 0x5b6168, LAMP_ON = 0xffe2a0, WOOD = 0x9a7349, BRICK = 0xb0624a;
const BUNTING = [0xe0533d, 0xf2c230, 0x3d8be0, 0x45b07a, 0xf27aa8];
const MURAL = [[0xf27aa8, 0x3fc1c9, 0xf2c230], [0x7a4fd0, 0xe58a2b, 0x45b07a], [0x3d8be0, 0xf2efe6, 0xe0533d]];

/**
 * Where along a kerb, and how far in from it: `a` along the kerb from 0 to 1,
 * `d` in from the tile's edge, as the tile's (u, v).
 */
const onKerb = (side: StreetProp["side"], a: number, d: number): [number, number] =>
  side === "N" ? [a, d] : side === "S" ? [a, 1 - d] : side === "W" ? [d, a] : [1 - d, a];

/** How far in from the edge a prop stands: on the pavement. */
const IN = 0.1;

const DRAW: Record<StreetProp["kind"], (p: Pen, pr: StreetProp) => void> = {
  tree: (p, pr) => { const [u, v] = onKerb(pr.side, 0.5, IN); tree(p, u, v, 0, 0.55); },
  planter: (p, pr) => {
    const [u, v] = onKerb(pr.side, 0.5, IN);
    p.box(u - 0.06, v - 0.06, u + 0.06, v + 0.06, 0, 0.22, 0xb9b3a4);
    p.dot(u, v, 0.32, 0.07, 0x5c9a46);
    p.dot(u - 0.02, v - 0.01, 0.38, 0.03, 0xf27aa8);
  },
  bin: (p, pr) => { const [u, v] = onKerb(pr.side, 0.5, IN); p.box(u - 0.035, v - 0.035, u + 0.035, v + 0.035, 0, 0.32, 0x3f6b4a); },
  lamp: (p, pr) => {
    const [u, v] = onKerb(pr.side, 0.5, IN);
    p.box(u - 0.012, v - 0.012, u + 0.012, v + 0.012, 0, 2.3, POLE);
    p.box(u - 0.035, v - 0.035, u + 0.035, v + 0.035, 2.3, 2.42, POLE, { top: tone(POLE, 1.2) });
    p.dot(u, v, 2.25, 0.03, LAMP_ON);
  },
  bench: (p, pr) => {
    const along = pr.side === "N" || pr.side === "S";
    const [u, v] = onKerb(pr.side, 0.5, IN);
    const [hu, hv] = along ? [0.14, 0.035] : [0.035, 0.14];
    p.box(u - hu, v - hv, u + hu, v + hv, 0.14, 0.2, WOOD);
    for (const s of [-1, 1]) p.box(u + (along ? s * 0.11 : 0) - 0.01, v + (along ? 0 : s * 0.11) - 0.01, u + (along ? s * 0.11 : 0) + 0.01, v + (along ? 0 : s * 0.11) + 0.01, 0, 0.14, POLE);
  },
  brick: (p, pr) => {
    const [u0, v0] = onKerb(pr.side, 0, 0), [u1, v1] = onKerb(pr.side, 1, 0.17);
    p.flat(Math.min(u0, u1), Math.min(v0, v1), Math.max(u0, u1), Math.max(v0, v1), 0.012, BRICK, 0.55);
  },
  crossing: (p, pr) => {
    // Zebra stripes, each along the way the street runs, set across it.
    for (let k = 0; k < 5; k++) {
      const a = 0.22 + k * 0.12;
      if (pr.side === "N") p.flat(0.3, a, 0.7, a + 0.06, 0.014, 0xf2efe6, 0.85);
      else p.flat(a, 0.3, a + 0.06, 0.7, 0.014, 0xf2efe6, 0.85);
    }
  },
  table: (p, pr) => {
    const [u, v] = onKerb(pr.side, 0.5, IN + 0.02);
    p.box(u - 0.04, v - 0.04, u + 0.04, v + 0.04, 0, 0.3, WOOD);
    p.dot(u, v, 0.62, 0.11, mix(0xe0533d, 0xffffff, 0.15));
    p.box(u - 0.005, v - 0.005, u + 0.005, v + 0.005, 0.3, 0.6, POLE);
    for (const s of [-1, 1]) {
      const [cu, cv] = pr.side === "N" || pr.side === "S" ? [u + s * 0.1, v] : [u, v + s * 0.1];
      p.box(cu - 0.025, cv - 0.025, cu + 0.025, cv + 0.025, 0, 0.2, 0x333a40);
    }
  },
  bunting: (p, pr) => {
    // Flags on a line along the kerb, dipping between the ends of the tile.
    const n = 5;
    for (let k = 0; k < n; k++) {
      const a = (k + 0.5) / n, z = 2.1 - Math.sin(Math.PI * a) * 0.25;
      const [u, v] = onKerb(pr.side, a, IN);
      p.dot(u, v, z - 0.06, 0.025, BUNTING[(pr.x + pr.y + k) % BUNTING.length]);
    }
    const [u0, v0] = onKerb(pr.side, 0, IN), [u1, v1] = onKerb(pr.side, 0.5, IN), [u2, v2] = onKerb(pr.side, 1, IN);
    p.strut([u0, v0, 2.1], [u1, v1, 1.85], 0.008, 0x3a3f45);
    p.strut([u1, v1, 1.85], [u2, v2, 2.1], 0.008, 0x3a3f45);
  },
};

/** A mural on a house's ground floor: blocks of colour and a circle, by its id. */
function drawMural(p: Pen, m: Mural) {
  const f = faceOf(p, m.face);
  const [a, b, c] = MURAL[m.id % MURAL.length];
  f.on(0.08, 0.92, 0.2, 1.7, a);
  f.on(0.08, 0.5, 0.2, 0.9, b);
  f.on(0.5, 0.92, 1.0, 1.7, c);
  f.dot(0.55, 0.01, 0.95, 0.14, mix(b, c, 0.5));
}

export type StreetProps = {
  /** Put the streets' props where their levels say, if those or the map have changed. */
  sync: (g: Grid, b: Beauty, rev: number, scale: number) => void;
  destroy: () => void;
};

export function createStreetProps(bands: BandLayer): StreetProps {
  let drawn: Graphics[] = [];
  let key = "";
  const clear = () => {
    for (const gr of drawn) { gr.parent?.removeChild(gr); gr.destroy(); }
    drawn = [];
  };
  return {
    sync(g, b, rev, scale) {
      const k = `${rev}|${scale}|${b.street.join("")}`;
      if (k === key) return;
      key = k;
      clear();
      const of = new Map<number, Graphics>();
      const graphicsAt = (x: number, y: number) => {
        const band = bandOf(x, y);
        let gr = of.get(band);
        if (gr) return gr;
        const layer = bands.dynamicOf[band];
        if (!layer) return null;
        gr = new Graphics();
        gr.eventMode = "none";
        gr.zIndex = 0;
        layer.addChild(gr);
        drawn.push(gr);
        of.set(band, gr);
        return gr;
      };
      const { props, murals } = streetPropsOf(g, streetsOf(g), b);
      // Flat things first, so what stands is over them.
      const flat = (pr: StreetProp) => pr.kind === "brick" || pr.kind === "crossing";
      for (const pr of [...props.filter(flat), ...props.filter((pr) => !flat(pr))]) {
        const gr = graphicsAt(pr.x, pr.y);
        if (gr) DRAW[pr.kind](makePen(gr, pr.x - 0.5, pr.y - 0.5, g.height[idx(g, pr.x, pr.y)], scale, null), pr);
      }
      for (const m of murals) {
        const gr = graphicsAt(m.x, m.y);
        if (gr) drawMural(makePen(gr, m.x - 0.5, m.y - 0.5, g.height[idx(g, m.x, m.y)], scale, null), m);
      }
    },
    destroy: clear,
  };
}
