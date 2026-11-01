import { describe, expect, test } from "bun:test";

import { HEIGHT_UNIT, HH, HW } from "../iso";
import { BEND_R, BOLTS, VIEW, WORDS, ZT, ball, elbowPath, flange, pipeCell, pipeMesh, solid, tube, type PipeMesh } from "./pipe-mesh";
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

  test("a straight run is two lengths, and a flange only at its far join", () => {
    const bare = pipeMesh(), flanged = pipeMesh();
    pipeCell(bare, 1, 5, 5, 1, [N, S], { ...look, flanges: false });
    pipeCell(flanged, 1, 5, 5, 1, [N, S], look);
    // A length is the near half of each end's ring: seven of twelve, twice.
    expect(bare.nv).toBe(2 * 14);
    // One flange: its rim, its face, and six bolts on the face.
    expect(flanged.nv).toBe(2 * 14 + 14 + 24 + BOLTS * 7);
  });

  test("a flange's face shows only on the camera's side", () => {
    const near = pipeMesh(), away = pipeMesh();
    flange(near, 1, 0, 0, 0, 1, 0, 0.1, 0x888888, 12, false, false);
    flange(away, 1, 0, 0, 0, -1, 0, 0.1, 0x888888, 12, false, false);
    expect(near.nv).toBe(away.nv + 24);
  });

  test("a bend's path leaves one face and arrives at the other, round a quarter circle", () => {
    const path = elbowPath(5, 5, 0.2, W, S);
    expect(path[0]).toEqual([4.5, 5, ZT]);
    expect(path[path.length - 1]).toEqual([5, 5.5, ZT]);
    // The arc: every point BEND_R from the circle's middle, out along both limbs.
    const [ou, ov] = [5 - BEND_R, 5 + BEND_R];
    for (const [u, v, h] of path.slice(1, -1)) {
      expect(Math.hypot(u - ou, v - ov)).toBeCloseTo(BEND_R);
      expect(h).toBe(0.2);
    }
    // It turns smoothly: no step between neighbours longer than the straights in and out.
    for (let k = 1; k < path.length; k++) expect(Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1])).toBeLessThanOrEqual(0.5 - BEND_R + 1e-9);
  });

  test("a bend has no ball; a loose end does, or a blind flange if capped", () => {
    const bend = pipeMesh(), end = pipeMesh(), capped = pipeMesh();
    pipeCell(bend, 1, 5, 5, 1, [E, N], { ...look, flanges: false });
    pipeCell(end, 1, 5, 5, 1, [N], { ...look, flanges: false });
    pipeCell(capped, 1, 5, 5, 1, [N], { ...look, flanges: false, cap: 0xc0392b });
    expect(bend.nv).toBe(9 * 7);
    expect(end.nv).toBe(14 + 1 + 3 * 12);
    // A blind flange facing the camera: rim, a whole disc, and its bolts.
    expect(capped.nv).toBe(14 + 14 + 13 + BOLTS * 7);
  });

  test("a tee is a run with a collared stub; a cross, a run with two", () => {
    const tee = pipeMesh(), cross = pipeMesh();
    pipeCell(tee, 1, 5, 5, 1, [N, S, E], { ...look, flanges: false });
    pipeCell(cross, 1, 5, 5, 1, [N, S, E, W], { ...look, flanges: false });
    // Lengths of 14, a collar of 14 and, facing the camera, its face of 24.
    expect(tee.nv).toBe(3 * 14 + 14 + 24);
    // The far stub's collar faces away: no face.
    expect(cross.nv).toBe(4 * 14 + 14 + 24 + 14);
  });

  test("everything a cell writes points somewhere real", () => {
    const m = pipeMesh();
    for (const limbs of [[N], [N, S], [E, N], [N, S, E], [N, S, E, W]]) pipeCell(m, 1, 5, 5, 1, limbs, { ...look, cap: 0xff0000 });
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

describe("the mains' shader", () => {
  test("both dialects build, and say the same lighting", () => {
    const wgsl = pipeShaderSource(), glsl = pipeFragmentGlsl();
    expect(wgsl).toContain("fn mainVertex");
    expect(wgsl).toContain("fn mainFragment");
    expect(glsl).not.toContain("let ");
    expect(glsl).toContain("vec3 lit =");
    expect(glsl).toContain("float tone =");
    const numbers = (s: string) => s.match(/-?\d+\.\d{5}/g);
    expect(numbers(glsl)).toEqual(numbers(wgsl.slice(wgsl.indexOf("fn mainFragment"))));
  });
});
