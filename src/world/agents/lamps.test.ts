/**
 * The lamps: baked as masks where they are seen — headlamps from the front,
 * tail lamps from behind — and lit as a driver brakes, turns and it gets dark.
 */
import { describe, expect, test } from "bun:test";

import { MODELS } from "./cars/models";
import { bakeFrame, LAMPS } from "./cars/raster";
import { createNetwork } from "../roads/network";
import { crossroads } from "./lanes/traffic.test-kit";
import { inside } from "./lanes/drive";
import { lampsOf, signalOf, type Signal } from "./lamps";
import { createTown, setTownCaps, stepTown, townCaps, trafficOf, type Mover } from "./town";

const lit = (img: { px: Uint8Array }) => { let n = 0; for (let i = 3; i < img.px.length; i += 4) if (img.px[i] > 128) n++; return n; };

describe("the lamps", () => {
  test("baked where they are seen: the headlamps from in front, the tail lamps from behind", () => {
    const car = MODELS[0];
    const head = LAMPS.indexOf("head"), tail = LAMPS.indexOf("tail");
    // Nose toward the camera, then away from it.
    const front = bakeFrame(car, Math.PI / 4, 2), back = bakeFrame(car, Math.PI / 4 + Math.PI, 2);
    expect(lit(front.lamps[head])).toBeGreaterThan(4);
    expect(lit(front.lamps[tail])).toBe(0);
    expect(lit(back.lamps[tail])).toBeGreaterThan(4);
    expect(lit(back.lamps[head])).toBe(0);
    // An indicator each side, seen from behind: the tail lamps.
    expect(lit(back.lamps[LAMPS.indexOf("left")])).toBeGreaterThan(0);
    expect(lit(back.lamps[LAMPS.indexOf("right")])).toBeGreaterThan(0);
  });

  test("brake lights, head lamps by night, and indicators blinking", () => {
    const m = { id: 3, kind: "car" } as Mover;
    expect(lampsOf(m, 0, false, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(lampsOf(m, 0, true, 0, 0)[1]).toBe(1);
    const night = lampsOf(m, 0, false, 1, 0);
    expect(night[0]).toBe(1);
    expect(night[1]).toBeGreaterThan(0);
    // Over a second, the right indicator is on half the time and the left never.
    let right = 0, left = 0;
    for (let k = 0; k < 100; k++) { const l = lampsOf(m, 1, false, 0, k / 100); right += l[2]; left += l[3]; }
    expect(right).toBeGreaterThan(30);
    expect(right).toBeLessThan(70);
    expect(left).toBe(0);
  });

  test("turning at a junction: the way it turns, before it gets there", () => {
    const caps = { ...townCaps };
    setTownCaps({ cars: 30, people: 0, every: 1 });
    const g = crossroads(1, 1), net = createNetwork(g), t = createTown();
    const seen = new Map<Signal, number>();
    let wrong = 0;
    for (let k = 0; k < 60 * 20; k++) {
      stepTown(t, g, net, 0, 1 / 20);
      const G = trafficOf(t, g).G;
      for (const m of t.movers) {
        const d = m.drive;
        if (!d || m.kind === "person" || m.pass || m.leaving || m.bayTo) continue;
        const s = signalOf(G, m);
        seen.set(s, (seen.get(s) ?? 0) + 1);
        // Signalling, it is that way the junction lane ahead of it turns.
        const j = d.lanes.findIndex((l, i) => i >= d.k && inside(G.lanes[l]));
        if (s === 1 || s === -1) {
          if (j < 0) continue;
          const l = G.lanes[d.lanes[j]], n = l.pts.length;
          const a = { x: l.pts[1].x - l.pts[0].x, y: l.pts[1].y - l.pts[0].y }, b = { x: l.pts[n - 1].x - l.pts[n - 2].x, y: l.pts[n - 1].y - l.pts[n - 2].y };
          // Right of a heading (x, y) is (−y, x): turning right, the end's heading is that way.
          if (Math.sign(a.x * b.y - a.y * b.x) !== s) wrong++;
        }
      }
    }
    setTownCaps(caps);
    expect(seen.get(1) ?? 0).toBeGreaterThan(20);
    expect(seen.get(-1) ?? 0).toBeGreaterThan(20);
    expect(wrong).toBe(0);
  });
});
