/**
 * World v2 — TRAFFIC LIGHTS at every lights junction: a pole on the near-side
 * corner of each way in, its head turned to the traffic coming, lit as the
 * junction's cycle has it. @see agents/lanes/drive lightOf
 *
 * The poles are drawn once a road revision; each frame only the three lit
 * lamps' alphas change, and only when the light does.
 */
import { Container, Graphics } from "pixi.js";

import { roadHeightAt } from "../agents/roads";
import { lightOf, type Traffic } from "../agents/lanes/drive";
import { right, sub, dot, type Pt } from "../agents/lanes/geometry";
import type { Grid } from "../grid";
import { bandOf } from "../iso";
import { makePen, tone } from "../structures/projects/pen";
import type { BandLayer } from "./bands";

const POLE = 0x2a2e33;
const LAMP = { red: 0xff3b2a, amber: 0xffb02a, green: 0x3bff7a } as const;
type State = keyof typeof LAMP;
/** Lamp heights, top down. */
const AT: Record<State, number> = { red: 1.62, amber: 1.5, green: 1.38 };

/** Where an arm's pole stands: the corner on the right of the way in. */
function poleAt(T: Traffic, j: number, arm: number): { p: Pt; face: Pt } | null {
  const G = T.G, A = G.junctions[j].arms[arm];
  const l = G.lanes[A.inLanes[0]];
  if (!l) return null;
  const end = l.pts[l.pts.length - 1], h = { x: -A.out.x, y: -A.out.y }, r = right(h);
  const c = A.crossing !== undefined ? G.crossings[A.crossing] : undefined;
  if (c) {
    for (const n of [c.a, c.b]) {
      const p = G.walk.nodes[n];
      if (dot(sub(p, end), r) > 0) return { p, face: A.out };
    }
  }
  return null;
}

type Pole = { j: number; arm: number; lit: Record<State, Graphics>; on: State | "" };

export type Signals = {
  sync: (g: Grid, T: Traffic, scale: number) => void;
  /** Light the lamps as they are at time `t`. */
  tick: (T: Traffic, t: number) => void;
  destroy: () => void;
};

export function createSignals(bands: BandLayer): Signals {
  let poles: Pole[] = [];
  let drawn: Container[] = [];
  let key = "";
  const clear = () => {
    for (const c of drawn) { c.parent?.removeChild(c); c.destroy({ children: true }); }
    drawn = []; poles = [];
  };
  return {
    sync(g, T, scale) {
      const k = `${T.key}|${scale}`;
      if (k === key) return;
      key = k;
      clear();
      for (const J of T.G.junctions) {
        if (J.kind !== "signals") continue;
        J.arms.forEach((_, arm) => {
          const at = poleAt(T, J.id, arm);
          if (!at) return;
          const { p, face } = at;
          const band = bandOf(Math.round(p.x), Math.round(p.y)), layer = bands.dynamicOf[band];
          if (!layer) return;
          const box = new Container();
          box.eventMode = "none";
          box.zIndex = p.x + p.y - band;
          const base = new Graphics();
          box.addChild(base);
          const z = roadHeightAt(g, p.x, p.y);
          const pen = makePen(base, 0, 0, z, scale, null);
          // The head sits a little toward the road, its lamps on the side the traffic sees.
          const hx = p.x - face.x * 0.02, hy = p.y - face.y * 0.02;
          const lx = hx + face.x * 0.045, ly = hy + face.y * 0.045;
          const toward = face.x + face.y > 0;
          const head = () => {
            pen.box(hx - 0.04, hy - 0.04, hx + 0.04, hy + 0.04, 1.3, 1.7, POLE, { top: tone(POLE, 1.3) });
          };
          pen.box(p.x - 0.022, p.y - 0.022, p.x + 0.022, p.y + 0.022, 0, 0.1, POLE, { top: tone(POLE, 1.3) });
          pen.box(p.x - 0.013, p.y - 0.013, p.x + 0.013, p.y + 0.013, 0.1, 1.3, POLE);
          const lit = {} as Record<State, Graphics>;
          if (toward) {
            // Facing the camera: the head, then its lamps dark, and over them the lit ones.
            head();
            for (const s of Object.keys(AT) as State[]) pen.dot(lx, ly, AT[s], 0.028, tone(LAMP[s], 0.42));
            for (const s of Object.keys(AT) as State[]) {
              const gr = new Graphics();
              makePen(gr, 0, 0, z, scale, null).dot(lx, ly, AT[s], 0.03, LAMP[s]);
              gr.alpha = 0;
              box.addChild(gr);
              lit[s] = gr;
            }
          } else head();
          layer.addChild(box);
          drawn.push(box);
          poles.push({ j: J.id, arm, lit, on: "" });
        });
      }
    },
    tick(T, t) {
      for (const P of poles) {
        const s = lightOf(T, P.j, P.arm, t);
        if (s === P.on) continue;
        if (P.on && P.lit[P.on]) P.lit[P.on].alpha = 0;
        if (P.lit[s]) P.lit[s].alpha = 1;
        P.on = s;
      }
    },
    destroy() { clear(); key = ""; },
  };
}
