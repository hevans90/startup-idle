import { describe, expect, test } from "bun:test";

import { HEIGHT_UNIT, HH, HW } from "../iso";
import {
  BEND_R, BOLTS, CONTACT, DOME_OUT, FITTING, FLANGE_T, FOOTING_T, GASKET, MATERIAL, NEAR_SPLIT, REDUCER, SUN, VALVE_BODY, VIEW, WORDS, ZT,
  ball, box, cellPaths, dome, elbowPath, flange, footing, made, outlet, pipeCell, pipeMesh, solid, taper, tube, valve, type PipeMesh,
} from "./pipe-mesh";
import { pipeFragmentGlsl, pipeShaderSource } from "./pipe-gpu";

const normalOf = (m: PipeMesh, v: number) => [m.f32[v * WORDS + 2], m.f32[v * WORDS + 3], m.f32[v * WORDS + 4]];
const facing = (n: number[]) => n[0] * VIEW[0] + n[1] * VIEW[1] + n[2] * VIEW[2];
const tris = (m: PipeMesh) => Array.from({ length: m.ni / 3 }, (_, t) => [m.idx[t * 3], m.idx[t * 3 + 1], m.idx[t * 3 + 2]]);

describe("a main as a solid", () => {
  test("a point on the axis lands where the strokes' projection puts it", () => {
    const m = pipeMesh();
    // A ball of radius 0 is every vertex at its centre.
    ball(m, 1, 3, 2, 5 * ZT, 0, solid(0xffffff), 8);
    expect(m.f32[0]).toBeCloseTo((3 - 2) * HW);
    expect(m.f32[1]).toBeCloseTo((3 + 2) * HH - 5 * HEIGHT_UNIT);
  });

  test("the line of sight projects to a point: the camera looks along VIEW", () => {
    const m = pipeMesh();
    ball(m, 1, VIEW[0], VIEW[1], VIEW[2], 0, solid(0), 4);
    expect(m.f32[0]).toBeCloseTo(0);
    expect(m.f32[1]).toBeCloseTo(0);
  });

  test("a tube writes the half the camera sees, edge to edge, and nothing turned away", () => {
    for (const [du, dv, dh] of [[1, 0, 0], [0, 1, 0], [0, -1, 0.4], [1, 0, -0.3]]) {
      const m = pipeMesh();
      tube(m, 1, 0, 0, 0, du, dv, dh, 0.1, solid(0x888888), 16);
      expect(tris(m).length / 2).toBe(8);
      for (let v = 0; v < m.nv; v++) expect(facing(normalOf(m, v))).toBeGreaterThan(-1e-6);
      // Its first and last edges are the silhouette: square to the line of sight.
      expect(facing(normalOf(m, 0))).toBeCloseTo(0);
      expect(facing(normalOf(m, m.nv - 1))).toBeCloseTo(0);
    }
  });

  test("every normal is a unit, every vertex on the tube's surface", () => {
    const m = pipeMesh();
    tube(m, 1, 0, 0, 1, 0, 1, 1, 0.2, solid(0), 12);
    for (let v = 0; v < m.nv; v++) expect(Math.hypot(...normalOf(m, v))).toBeCloseTo(1);
  });

  test("a ball is all near side", () => {
    const m = pipeMesh();
    ball(m, 1, 0, 0, 0, 0.1, solid(0), 12);
    for (let v = 0; v < m.nv; v++) expect(facing(normalOf(m, v))).toBeGreaterThan(-1e-6);
  });

  const look = { r: 0.1, colour: 0x888888, sides: 12 };
  const along = (l: { dx: number; dy: number }) => ({ ...l, zf: 1 });
  const N = along({ dx: 0, dy: -1 }), S = along({ dx: 0, dy: 1 }), E = along({ dx: 1, dy: 0 }), W = along({ dx: -1, dy: 0 });

  test("a straight run is one sweep, and a flange only at its far join", () => {
    const bare = pipeMesh(), flanged = pipeMesh();
    pipeCell(bare, 1, 5, 5, 1, [N, S], { ...look, flanges: false });
    pipeCell(flanged, 1, 5, 5, 1, [N, S], look);
    // Three rings — far face, middle, near face — each the near half: seven of twelve.
    expect(bare.nv).toBe(3 * 7);
    // One flange: its rim, the gasket's line round the middle of it, its face, and six bolts on the face.
    expect(flanged.nv).toBe(3 * 7 + 14 + 14 + 24 + BOLTS * 7);
  });

  test("over a road, the length past NEAR_SPLIT goes to the next band's mesh, and the far leg under the traffic", () => {
    // A run along v over a road along u: the far half and middle in `m`, the near end in `near`, the far leg in `back`.
    const m = pipeMesh(), near = pipeMesh(), back = pipeMesh();
    pipeCell(m, 1, 5, 5, 1, [N, S], { ...look, flanges: false, support: "frame", floor: 0, verges: "u", near, back });
    expect(m.nv).toBeGreaterThan(0);
    expect(near.nv).toBeGreaterThan(0);
    // Along v at u = 5, a point's screen x is (5 − v)·HW: the near length lies past the split, give or take the tube's radius.
    const vOf = (mesh: PipeMesh, k: number) => 5 - mesh.f32[k * WORDS] / HW;
    for (let k = 0; k < near.nv; k++) expect(vOf(near, k)).toBeGreaterThan(5 + NEAR_SPLIT - look.r - 1e-6);
    // Nothing of it past the tile's near edge — a footing's corner is off the run's line, by its own half width at most.
    for (let k = 0; k < m.nv; k++) expect(vOf(m, k)).toBeLessThan(5 + 0.5 + 0.08);
    // The far leg stands at the road's far edge, v = 5 − (½ − its width), not beside the tube in the lane.
    expect(back.nv).toBeGreaterThan(0);
    // (Its footing and the rim round that reach in a little further than the leg itself.)
    for (let k = 0; k < back.nv; k++) expect(back.f32[k * WORDS] / HW).toBeGreaterThan(0.28);
  });

  test("a window is three lengths, glass between, framed at both ends; a band is a hoop round the middle", () => {
    const win = pipeMesh(), band = pipeMesh();
    pipeCell(win, 1, 5, 5, 1, [N, S], { ...look, flanges: false, window: 0.3, glass: 0xcfe6f2 });
    pipeCell(band, 1, 5, 5, 1, [N, S], { ...look, flanges: false, band: 0xb44aff });
    // A hoop: its tube, and the one face of its two toward the camera — rim to tube, twelve each.
    const hoop = 14 + 24;
    expect(win.nv).toBe(3 * 14 + 2 * hoop);
    expect(band.nv).toBe(3 * 7 + hoop);
    // The middle length is the glass, and runs 0.3 each way of the middle.
    const colour = (m: PipeMesh, v: number) => new Uint32Array(m.f32.buffer)[v * WORDS + 5];
    expect(colour(win, 14)).toBe(solid(0xcfe6f2));
    expect(colour(win, 0)).toBe(solid(0x888888));
    // Its ends, the two vertices of one line along it: 0.6 apart down v.
    const y = (v: number) => win.f32[v * WORDS + 1];
    expect(Math.abs(y(15) - y(14))).toBeCloseTo(0.6 * HH);
  });

  test("far off, a window has no frames and an outlet no valve", () => {
    const framed = pipeMesh(), bare = pipeMesh(), valved = pipeMesh(), plain = pipeMesh();
    const win = { ...look, flanges: false, window: 0.3 };
    pipeCell(framed, 1, 5, 5, 1, [N, S], win);
    pipeCell(bare, 1, 5, 5, 1, [N, S], { ...win, frames: false });
    expect(bare.nv).toBe(3 * 14);
    expect(framed.nv).toBeGreaterThan(bare.nv);
    pipeCell(valved, 1, 5, 5, 1, [N], { ...look, flanges: false, end: "outlet" });
    pipeCell(plain, 1, 5, 5, 1, [N], { ...look, flanges: false, end: "outlet", valve: false });
    expect(plain.nv).toBeLessThan(valved.nv);
  });

  test("a main into a port stops at its outlet's flange, with its own flange there; one set back runs on to it", () => {
    const along = (m: PipeMesh) => {
      // How far toward the wall it reaches: the N limb runs along −v, so up and right on screen — the most screen x written.
      let most = -Infinity;
      for (let v = 0; v < m.nv; v++) most = Math.max(most, m.f32[v * WORDS]);
      return most;
    };
    for (const [l, wall] of [[S, { ...N, wall: 0x3f86c6 }], [N, { ...S, wall: 0x3f86c6 }]]) {
      const plain = pipeMesh(), ported = pipeMesh();
      pipeCell(plain, 1, 5, 5, 1, [l, { ...wall, wall: undefined }], { ...look, flanges: false });
      pipeCell(ported, 1, 5, 5, 1, [l, wall], { ...look, flanges: false });
      // A flange more — in the main's own colour, not the fluid's: that one is the outlet's.
      expect(ported.nv).toBeGreaterThanOrEqual(plain.nv + 14);
      const colours = new Set(Array.from({ length: ported.nv }, (_, v) => ported.u32[v * WORDS + 5]));
      expect(colours.has(solid(0x3f86c6))).toBe(false);
    }
    // Set back past the cell's face, it reaches further toward the wall.
    const at = pipeMesh(), back = pipeMesh();
    pipeCell(at, 1, 5, 5, 1, [S, { ...N, wall: 0x3f86c6 }], { ...look, flanges: false });
    pipeCell(back, 1, 5, 5, 1, [S, { ...N, wall: 0x3f86c6, reach: 0.4 }], { ...look, flanges: false });
    expect(along(back)).toBeGreaterThan(along(at) + 0.3 * HW);
  });

  test("a flange's face shows only on the camera's side", () => {
    const near = pipeMesh(), away = pipeMesh();
    flange(near, 1, 0, 0, 0, 1, 0, 0.1, 0x888888, 12, false, false);
    flange(away, 1, 0, 0, 0, -1, 0, 0.1, 0x888888, 12, false, false);
    expect(near.nv).toBe(away.nv + 24);
  });

  test("a bend's path leaves one face and arrives at the other, round a quarter circle", () => {
    const path = elbowPath(5, 5, ZT, W, S);
    expect(path[0]).toEqual([4.5, 5, ZT]);
    expect(path[path.length - 1]).toEqual([5, 5.5, ZT]);
    // The arc: every point BEND_R from the circle's middle, out along both limbs.
    const [ou, ov] = [5 - BEND_R, 5 + BEND_R];
    for (const [u, v, h] of path.slice(1, -1)) {
      expect(Math.hypot(u - ou, v - ov)).toBeCloseTo(BEND_R);
      expect(h).toBeCloseTo(ZT);
    }
    // It turns smoothly: no step between neighbours longer than the straights in and out.
    for (let k = 1; k < path.length; k++) expect(Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1])).toBeLessThanOrEqual(0.5 - BEND_R + 1e-9);
  });

  /** How many of `b`'s vertices `a` has too: the same place on screen, the same normal. */
  const shared = (a: PipeMesh, b: PipeMesh) => {
    let n = 0;
    for (let j = 0; j < b.nv; j++) {
      for (let k = 0; k < a.nv; k++) {
        if ([0, 1, 2, 3, 4].every((w) => Math.abs(a.f32[k * WORDS + w] - b.f32[j * WORDS + w]) < 1e-3)) { n++; break; }
      }
    }
    return n;
  };

  test("where a main climbs, the ring at a join is one ring from either side", () => {
    // Levels 0, 0 | 2 | 6, 6: a run at 2 between a step up and a steeper one; then a bend at 6.
    const run = (z: number, a: number, b: number) => [{ dx: -1, dy: 0, zf: (z + a) / 2 }, { dx: 1, dy: 0, zf: (z + b) / 2 }];
    const low = pipeMesh(), mid = pipeMesh(), bend = pipeMesh(), end = pipeMesh();
    const bare = { ...look, sides: 14, flanges: false };
    pipeCell(low, 1, 4, 5, 0, run(0, 0, 2), bare);
    pipeCell(mid, 1, 5, 5, 2, run(2, 0, 6), bare);
    pipeCell(bend, 1, 6, 5, 6, [{ dx: -1, dy: 0, zf: 4 }, { dx: 0, dy: 1, zf: 6 }], bare);
    pipeCell(end, 1, 6, 6, 6, [{ dx: 0, dy: -1, zf: 6 }], bare);
    // Each join: the whole near half of a ring, eight of fourteen.
    expect(shared(low, mid)).toBeGreaterThanOrEqual(8);
    expect(shared(mid, bend)).toBeGreaterThanOrEqual(8);
    expect(shared(bend, end)).toBeGreaterThanOrEqual(8);
  });

  test("a climbing run curves through its middle, never above or below the levels it joins", () => {
    const [path] = cellPaths(5, 5, 2 * ZT, [{ dx: -1, dy: 0, zf: 1 }, { dx: 1, dy: 0, zf: 4 }], 0.1);
    // More than face, middle, face: the slope changes along it.
    expect(path.length).toBeGreaterThan(3);
    expect(path[0][2]).toBeCloseTo(ZT);
    expect(path[path.length - 1][2]).toBeCloseTo(4 * ZT);
    expect(path[path.length >> 1][2]).toBeCloseTo(2 * ZT);
    for (let k = 1; k < path.length; k++) expect(path[k][2]).toBeGreaterThan(path[k - 1][2]);
    // A crest, from 0 up to 2 and back: level at the top, no higher.
    const [crest] = cellPaths(5, 5, 2 * ZT, [{ dx: -1, dy: 0, zf: 1 }, { dx: 1, dy: 0, zf: 1 }], 0.1);
    for (const p of crest) expect(p[2]).toBeLessThanOrEqual(2 * ZT + 1e-9);
  });

  test("a flange on a climbing join is square to the tube", () => {
    const level = pipeMesh(), steep = pipeMesh();
    flange(level, 1, 0, 0, 0, 1, 0, 0.1, 0x888888, 12, false, false);
    flange(steep, 1, 0, 0, 0, 1, 0, 0.1, 0x888888, 12, false, false, 1.5);
    // Its face's normal is the tube's way, tilted up.
    const last = (m: PipeMesh) => normalOf(m, m.nv - 1);
    expect(last(level)[2]).toBeCloseTo(0);
    expect(last(steep)[2]).toBeCloseTo(1.5 / Math.hypot(1, 1.5));
  });

  test("a bend is cut finer the rounder its tube: up close, no flat shows on it", () => {
    const counts = [6, 10, 14].map((sides) => {
      const m = pipeMesh();
      pipeCell(m, 1, 5, 5, 1, [E, N], { ...look, sides, flanges: false });
      return m.nv / ((sides >> 1) + 1);
    });
    // Rings: a face either end and the arc's points, 4, 6, then 12 lengths round it.
    expect(counts).toEqual([2 + 5, 2 + 7, 2 + 13]);
  });

  test("a bend has no ball; a loose end does, or a blind flange if capped", () => {
    const bend = pipeMesh(), end = pipeMesh(), capped = pipeMesh();
    pipeCell(bend, 1, 5, 5, 1, [E, N], { ...look, flanges: false });
    pipeCell(end, 1, 5, 5, 1, [N], { ...look, flanges: false });
    pipeCell(capped, 1, 5, 5, 1, [N], { ...look, flanges: false, end: "cap" });
    expect(bend.nv).toBe(9 * 7);
    expect(end.nv).toBe(14 + 1 + 3 * 12);
    // A blind flange facing the camera: rim, gasket, a whole disc, its dome — three rings and a crown — and its bolts.
    expect(capped.nv).toBe(14 + 14 + 14 + 13 + (3 * 12 + 1) + BOLTS * 7);
  });

  test("a tee is a run with a collared stub; a cross, a run with two", () => {
    const tee = pipeMesh(), cross = pipeMesh();
    pipeCell(tee, 1, 5, 5, 1, [N, S, E], { ...look, flanges: false });
    pipeCell(cross, 1, 5, 5, 1, [N, S, E, W], { ...look, flanges: false });
    // The run's sweep of 21, a stub of 14, its collar of 14 and, facing the camera, the collar's face of 24.
    expect(tee.nv).toBe(21 + 14 + 14 + 24);
    // The far stub's collar faces away: no face.
    expect(cross.nv).toBe(21 + 2 * 14 + 14 + 24 + 14);
  });

  test("the sun lights a box's top most, then its +v side, then its +u side", () => {
    const top = SUN[2], left = SUN[1], right = SUN[0];
    expect(top).toBeGreaterThan(left);
    expect(left).toBeGreaterThan(right);
  });

  test("a saddle stands under a ground run, a frame's legs either side of a high one", () => {
    // A run along u: its legs stand either side of it in v.
    const run = [{ dx: -1, dy: 0, zf: 4 }, { dx: 1, dy: 0, zf: 4 }];
    const bare = pipeMesh(), saddle = pipeMesh(), frame = pipeMesh();
    pipeCell(bare, 1, 5, 5, 4, run, { ...look, flanges: false });
    pipeCell(saddle, 1, 5, 5, 4, run, { ...look, flanges: false, support: "saddle", floor: 0 });
    pipeCell(frame, 1, 5, 5, 4, run, { ...look, flanges: false, support: "frame", floor: 0 });
    // A box is three faces of four corners; a footing, the flat rim of its contact and a slab.
    const BOX = 12, FOOT = 4 + BOX;
    // A saddle: its footing, its block, and its strap over the tube — a band and the band's near face.
    expect(saddle.nv).toBe(bare.nv + FOOT + BOX + 14 + 24);
    // Two legs, each on a footing, and a beam.
    expect(frame.nv).toBe(bare.nv + 2 * (FOOT + BOX) + BOX);
    // The near leg — the +v one, left of the run on screen — is written last, after the tube: it stands in front of it.
    let x = 0;
    for (let v = frame.nv - 4; v < frame.nv; v++) x += frame.f32[v * WORDS] / 4;
    expect(x).toBeCloseTo(-(0.1 + 0.04) * HW, 3);
  });

  test("a footing has a dark rim on the ground round it, as strong as CONTACT and no stronger", () => {
    const m = pipeMesh();
    const top = footing(m, 1, 5, 5, 5.1, 5.1, 0.2);
    expect(top).toBeCloseTo(0.2 + FOOTING_T, 6);
    // The rim first: four corners, flat, facing up, see-through by CONTACT; then the slab, solid.
    for (let v = 0; v < 4; v++) {
      expect(normalOf(m, v)).toEqual([0, 0, 1]);
      expect(m.u32[v * WORDS + 5] >>> 24).toBe(Math.round(CONTACT * 255));
    }
    for (let v = 4; v < m.nv; v++) expect(m.u32[v * WORDS + 5] >>> 24).toBe(255);
    // Wider than the slab, which is wider than what stands on it.
    const xs = (from: number, to: number) => { const a = Array.from({ length: to - from }, (_, k) => m.f32[(from + k) * WORDS]); return Math.max(...a) - Math.min(...a); };
    expect(xs(0, 4)).toBeGreaterThan(xs(4, m.nv));
    expect(xs(4, m.nv)).toBeGreaterThan(0.2 * HW);
  });

  test("a saddle's strap is the last thing on it, over the tube; a bend's saddle has none", () => {
    const run = [{ dx: -1, dy: 0, zf: 4 }, { dx: 1, dy: 0, zf: 4 }], bend = [{ dx: -1, dy: 0, zf: 4 }, { dx: 0, dy: 1, zf: 4 }];
    const straight = pipeMesh(), bent = pipeMesh(), bare = pipeMesh();
    pipeCell(straight, 1, 5, 5, 4, run, { ...look, flanges: false, support: "saddle", floor: 0 });
    pipeCell(bent, 1, 5, 5, 4, bend, { ...look, flanges: false, support: "saddle", floor: 0 });
    pipeCell(bare, 1, 5, 5, 4, bend, { ...look, flanges: false });
    // Steel, not the tube's grey nor the block's concrete.
    const last = straight.u32[(straight.nv - 1) * WORDS + 5] & 0xffffff;
    expect(last).not.toBe(straight.u32[5] & 0xffffff);
    expect(bent.nv).toBe(bare.nv + 4 + 12 + 12);
  });

  const ENDS = ["cap", "intake", "pump", "outlet", "drain", "outfall"] as const;

  test("each fitting stands at a loose end, and the length stops at a house's wall", () => {
    const dome = pipeMesh();
    pipeCell(dome, 1, 5, 5, 1, [N], { ...look, flanges: false });
    for (const end of ENDS) {
      const m = pipeMesh();
      pipeCell(m, 1, 5, 5, 1, [N], { ...look, flanges: false, end, floor: 0 });
      // A drain is the building outlet's to draw: the main is its length and the knuckle it turns at.
      if (end === "drain") { expect(m.nv).toBe(dome.nv); continue; }
      expect(m.nv, end).toBeGreaterThan(14);
      expect(m.nv, end).not.toBe(dome.nv);
    }
  });

  test("an outlet's valve goes on after the tube, on top of it", () => {
    const m = pipeMesh();
    pipeCell(m, 1, 5, 5, 4, [N], { ...look, flanges: false, end: "outlet" });
    // The handwheel's top hub is the last thing written: above the tube's middle.
    const y = m.f32[(m.nv - 1) * WORDS + 1];
    expect(y).toBeLessThan((5 + 5) * HH - (4 * ZT + 0.1) * (HEIGHT_UNIT / ZT));
  });

  test("an outlet: a plate on the wall, a spigot, a flange in the fluid's colour; open, its bore last", () => {
    const open = pipeMesh(), joined = pipeMesh(), plain = pipeMesh();
    outlet(open, 1, 5, 5, 1, 1, 0, 0.1, 0x3f86c6, 0x888888, 12);
    outlet(joined, 1, 5, 5, 1, 1, 0, 0.1, 0x3f86c6, 0x888888, 12, true);
    outlet(plain, 1, 5, 5, 1, 1, 0, 0.1, 0x3f86c6, 0x888888, 12, false, false);
    // Facing the camera, the dark bore is written last; joined, none.
    expect(open.u32[(open.nv - 1) * WORDS + 5]).toBe(solid(FITTING.bore));
    expect(joined.nv).toBe(open.nv - 13);
    const colours = new Set(Array.from({ length: joined.nv }, (_, v) => joined.u32[v * WORDS + 5]));
    expect(colours.has(solid(0x3f86c6))).toBe(true);
    // Its bolts, plate and flange, only when asked for.
    expect(plain.nv).toBeLessThan(open.nv);
    // Set back, the whole of it moves toward the wall: on screen, up and left by the same.
    const back = pipeMesh();
    outlet(back, 1, 5, 5, 1, 1, 0, 0.1, 0x3f86c6, 0x888888, 12, false, true, 0.3);
    expect(back.f32[0]).toBeCloseTo(open.f32[0] - 0.3 * HW, 3);
  });

  test("everything a cell writes points somewhere real", () => {
    const m = pipeMesh();
    for (const limbs of [[N], [N, S], [E, N], [N, S, E], [N, S, E, W]]) pipeCell(m, 1, 5, 5, 1, limbs, { ...look, end: "cap" });
    for (const end of ENDS) for (const limbs of [[], [N], [E], [S], [W]]) pipeCell(m, 1, 5, 5, 1, limbs, { ...look, end, floor: 0 });
    outlet(m, 1, 5, 5, 1, 1, 0, 0.1, 0x3f86c6, 0x888888, 12);
    outlet(m, 1, 5, 5, 1, -1, 0, 0.1, 0x3f86c6, 0x888888, 12);
    for (let v = 0; v < m.nv; v++) expect(Math.hypot(...normalOf(m, v))).toBeCloseTo(1);
    for (const t of tris(m)) for (const v of t) expect(v).toBeLessThan(m.nv);
  });

  test("it grows past its first size and keeps what it wrote", () => {
    const m = pipeMesh(4);
    for (let k = 0; k < 20; k++) tube(m, 1, k, 0, 0, k + 1, 0, 0, 0.1, solid(0x123456), 8);
    expect(m.nv).toBe(20 * 10);
    expect(m.u32[5]).toBe(solid(0x123456));
    for (const t of tris(m)) for (const v of t) expect(v).toBeLessThan(m.nv);
  });
});

describe("joints and fittings", () => {
  const look = { r: 0.1, colour: 0x888888, sides: 12 };
  const lim = (dx: number, dy: number, more: object = {}) => ({ dx, dy, zf: 1, ...more });
  const N = lim(0, -1), S = lim(0, 1);
  const at = (m: PipeMesh, v: number) => [m.f32[v * WORDS], m.f32[v * WORDS + 1]];
  const colourOf = (m: PipeMesh, v: number) => m.u32[v * WORDS + 5] & 0xffffff;

  test("a flange is two rings with the gasket's dark line between them", () => {
    const m = pipeMesh();
    flange(m, 1, 5, 5, 0.3, 0, 1, 0.1, 0x8090a0, 12, false, false);
    // Its rim, then the gasket: darker, a hair proud of the rim, and a fraction of its thickness.
    const rim = colourOf(m, 0), gasket = colourOf(m, 14);
    expect(gasket).not.toBe(rim);
    expect((gasket >> 16) & 255).toBeLessThan((rim >> 16) & 255);
    const thick = (from: number) => Math.hypot(at(m, from)[0] - at(m, from + 1)[0], at(m, from)[1] - at(m, from + 1)[1]);
    expect(thick(14) / thick(0)).toBeCloseTo(GASKET / FLANGE_T, 5);
  });

  test("a cap is domed: its crown stands out of its face, toward the way it faces", () => {
    const flat = pipeMesh(), domed = pipeMesh();
    flange(flat, 1, 5, 5, 0.3, 0, 1, 0.1, FITTING.cap, 12, false, false);
    flange(domed, 1, 5, 5, 0.3, 0, 1, 0.1, FITTING.cap, 12, false, true);
    expect(domed.nv).toBeGreaterThan(flat.nv);
    // The crown is the last vertex: on the axis, DOME_OUT radii past the face — +v is down-left on the screen.
    const crown = at(domed, domed.nv - 1), v = 5 + FLANGE_T / 2 + 0.1 * DOME_OUT;
    expect(crown[0]).toBeCloseTo((5 - v) * HW, 4);
    expect(crown[1]).toBeCloseTo((5 + v) * HH - 0.3 * (HEIGHT_UNIT / ZT), 4);
    // Facing away, there is no dome to see.
    const away = pipeMesh();
    flange(away, 1, 5, 5, 0.3, 0, -1, 0.1, FITTING.cap, 12, false, true);
    expect(away.nv).toBeLessThan(domed.nv);
  });

  test("a dome is all near side and closes on its crown", () => {
    const m = pipeMesh();
    dome(m, 1, 0, 0, 0, 0, 1, 0, 0.1, 0.05, solid(0), 12);
    expect(m.nv).toBe(3 * 12 + 1);
    expect(tris(m).length).toBe(2 * 12 * 2 + 12);
    for (const t of tris(m)) for (const v of t) expect(v).toBeLessThan(m.nv);
  });

  test("a taper runs from one radius to the other, the half the camera sees", () => {
    const m = pipeMesh();
    taper(m, 1, 0, 0, 0, 1, 0, 0, 0.2, 0.1, solid(0), 12);
    expect(m.nv).toBe(14);
    // Each ring's two ends are that ring's radius off the axis, on the screen's own measure of it.
    const span = (v: number) => Math.hypot(at(m, v)[0] - at(m, v + 12)[0], at(m, v)[1] - at(m, v + 12)[1]);
    expect(span(0) / span(1)).toBeCloseTo(2, 5);
  });

  test("where a wide length meets a slim one, the wide one draws a reducer; the slim one, and two alike, none", () => {
    const plain = pipeMesh(), wide = pipeMesh(), slim = pipeMesh(), same = pipeMesh();
    const bare = { ...look, flanges: false };
    pipeCell(plain, 1, 5, 5, 1, [N, S], bare);
    pipeCell(wide, 1, 5, 5, 1, [N, lim(0, 1, { meets: 0.07 })], bare);
    pipeCell(slim, 1, 5, 5, 1, [N, lim(0, 1, { meets: 0.14 })], bare);
    pipeCell(same, 1, 5, 5, 1, [N, lim(0, 1, { meets: 0.1 })], bare);
    expect(slim.nv).toBe(plain.nv);
    expect(same.nv).toBe(plain.nv);
    // Its collar and its taper down to the slim bore; the collar's face is toward the run, away from the camera here.
    expect(wide.nv).toBe(plain.nv + 14 + 14);
    // Its collar stands proud of the tube: a ring of it, edge to edge, is wider than a ring of the run.
    const span = (m: PipeMesh, a: number, b: number) => Math.hypot(at(m, a)[0] - at(m, b)[0], at(m, a)[1] - at(m, b)[1]);
    expect(span(wide, plain.nv, plain.nv + 12) / span(plain, 0, 6)).toBeCloseTo(1.12, 2);
    expect(REDUCER).toBeLessThan(0.5);
  });

  test("a valve has a body round the tube under its stem and wheel", () => {
    const m = pipeMesh();
    valve(m, 1, 5, 5, 0.4, 0.1);
    // The body's ball first: a pole and three rings of fourteen, VALVE_BODY radii across.
    const xs = Array.from({ length: 1 + 3 * 14 }, (_, k) => at(m, k)[0]);
    expect((Math.max(...xs) - Math.min(...xs)) / 2).toBeGreaterThan(0.1 * HW);
    expect(VALVE_BODY).toBeGreaterThan(1);
    // And the wheel's hub last, above it all.
    const hub = Math.min(...[1, 2, 3, 4].map((k) => at(m, m.nv - k)[1]));
    expect(hub).toBeLessThan(Math.min(...Array.from({ length: 43 }, (_, k) => at(m, k)[1])));
  });
});

describe("what a piece is made of", () => {
  const look = { r: 0.1, colour: 0x888888, sides: 12 };
  const lim = (dx: number, dy: number) => ({ dx, dy, zf: 1 });
  const mat = (m: PipeMesh, v: number) => [m.f32[v * WORDS + 6], m.f32[v * WORDS + 7], m.f32[v * WORDS + 8]];

  test("a tube is plain unless it is made of something", () => {
    const m = pipeMesh();
    tube(m, 1, 0, 0, 0, 1, 0, 0, 0.1, solid(0), 12);
    for (let v = 0; v < m.nv; v++) expect(mat(m, v)).toEqual([0, 0, 0]);
  });

  test("made of steel, it says where along its run and across it each vertex is", () => {
    const m = pipeMesh();
    made(MATERIAL.steel, () => tube(m, 1, 2, 5, 0, 3, 5, 0, 0.1, solid(0), 12));
    for (let v = 0; v < m.nv; v++) {
      const [along, across, of] = mat(m, v);
      expect(of).toBe(MATERIAL.steel);
      // Its place on the map along the way it runs: 2 at one end, 3 at the other.
      expect(along).toBeCloseTo(v % 2 ? 3 : 2, 6);
      expect(across).toBeCloseTo((v >> 1) / 6, 6);
    }
  });

  test("the marks count the same from whichever end a length was built", () => {
    const one = pipeMesh(), other = pipeMesh();
    made(MATERIAL.iron, () => tube(one, 1, 2, 5, 0, 3, 5, 0, 0.1, solid(0), 12));
    made(MATERIAL.iron, () => tube(other, 1, 3, 5, 0, 2, 5, 0, 0.1, solid(0), 12));
    expect(mat(one, 0)[0]).toBeCloseTo(mat(other, 1)[0], 6);
    expect(mat(one, 1)[0]).toBeCloseTo(mat(other, 0)[0], 6);
  });

  test("a run's marks carry on from one tile's length to the next", () => {
    const a = pipeMesh(), b = pipeMesh();
    const steel = { ...look, flanges: false, material: MATERIAL.steel };
    pipeCell(a, 1, 5, 5, 1, [lim(-1, 0), lim(1, 0)], steel);
    pipeCell(b, 1, 6, 5, 1, [lim(-1, 0), lim(1, 0)], steel);
    const range = (m: PipeMesh) => { const all = Array.from({ length: m.nv }, (_, v) => mat(m, v)[0]); return [Math.min(...all), Math.max(...all)]; };
    expect(range(a)[0]).toBeCloseTo(4.5, 5);
    expect(range(a)[1]).toBeCloseTo(5.5, 5);
    expect(range(b)[0]).toBeCloseTo(range(a)[1], 5);
    for (let v = 0; v < a.nv; v++) expect(mat(a, v)[2]).toBe(MATERIAL.steel);
  });

  test("what is fitted to a main is plain: its flanges, its collars, its supports' tops", () => {
    const bare = pipeMesh(), fitted = pipeMesh();
    const iron = { ...look, material: MATERIAL.iron };
    pipeCell(bare, 1, 5, 5, 1, [lim(0, -1), lim(0, 1)], { ...iron, flanges: false });
    pipeCell(fitted, 1, 5, 5, 1, [lim(0, -1), lim(0, 1), lim(1, 0)], iron);
    const of = (m: PipeMesh) => Array.from({ length: m.nv }, (_, v) => mat(m, v)[2]);
    expect(of(bare).every((k) => k === MATERIAL.iron)).toBe(true);
    // The flange and the stub's collar among them are not iron; the run and the stub still are.
    expect(of(fitted).filter((k) => k === MATERIAL.plain).length).toBeGreaterThan(14 + 24);
    expect(of(fitted).filter((k) => k === MATERIAL.iron).length).toBeGreaterThan(bare.nv);
  });

  test("a wall of brick says its height and its place along the wall; its top says nothing", () => {
    const m = pipeMesh();
    made(MATERIAL.brick, () => box(m, 1, 1, 2, 0, 3, 5, 0.6, solid(0)));
    // The +u face, the +v face, the top: four vertices each.
    for (let v = 0; v < 4; v++) { expect(mat(m, v)[2]).toBe(MATERIAL.brick); expect([2, 5]).toContain(mat(m, v)[1]); expect([0, 0.6]).toContain(Math.fround(mat(m, v)[0]) === Math.fround(0.6) ? 0.6 : mat(m, v)[0]); }
    for (let v = 4; v < 8; v++) { expect(mat(m, v)[2]).toBe(MATERIAL.brick); expect([1, 3]).toContain(mat(m, v)[1]); }
    for (let v = 8; v < 12; v++) expect(mat(m, v)).toEqual([0, 0, 0]);
  });
});

describe("the mains' shader", () => {
  test("both dialects build, and say the same lighting", () => {
    const wgsl = pipeShaderSource(), glsl = pipeFragmentGlsl();
    expect(wgsl).toContain("fn mainVertex");
    expect(wgsl).toContain("fn mainFragment");
    expect(glsl).not.toContain("let ");
    expect(glsl).toContain("vec3 lit =");
    expect(glsl).toContain("float tone =");
    // What it is made of, the same in both: every mark by name, and the vectors typed.
    for (const mark of ["ironJoint", "ironSeam", "rust", "bead", "spiral", "scuff", "stain", "board", "mortar", "fine", "chevron", "trunk"]) {
      expect(wgsl).toContain(`let ${mark} =`);
      expect(glsl).toContain(`float ${mark} =`);
    }
    expect(glsl).toContain("vec3 base =");
    expect(glsl).toContain("in vec3 vMat;");
    expect(wgsl).toContain("@location(3) aMat: vec3<f32>");
    const numbers = (s: string) => s.match(/-?\d+\.\d{5}/g);
    expect(numbers(glsl)).toEqual(numbers(wgsl.slice(wgsl.indexOf("fn mainFragment"))));
  });
});
