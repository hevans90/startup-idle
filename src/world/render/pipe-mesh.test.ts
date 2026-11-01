import { describe, expect, test } from "bun:test";

import { HEIGHT_UNIT, HH, HW } from "../iso";
import { VIEW, WORDS, ZT, ball, pipeCell, pipeMesh, solid, tube, type PipeMesh } from "./pipe-mesh";
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

  test("a tube writes only the faces the camera can see — about half of them", () => {
    const m = pipeMesh();
    tube(m, 1, 0, 0, 0, 1, 0, 0, 0.1, solid(0x888888), 16);
    const faces = tris(m).length / 2;
    expect(faces).toBeGreaterThanOrEqual(8);
    expect(faces).toBeLessThanOrEqual(10);
    for (const [a, b] of tris(m)) expect(Math.max(facing(normalOf(m, a)), facing(normalOf(m, b)))).toBeGreaterThan(-0.5);
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

  test("a straight run needs no ball; a bend has one, drawn between its far limb and its near", () => {
    const straight = pipeMesh(), bend = pipeMesh();
    pipeCell(straight, 1, 5, 5, 1, [{ dx: 0, dy: -1, zf: 1 }, { dx: 0, dy: 1, zf: 1 }], 0.1, solid(0), 12);
    pipeCell(bend, 1, 5, 5, 1, [{ dx: 1, dy: 0, zf: 1 }, { dx: 0, dy: -1, zf: 1 }], 0.1, solid(0), 12);
    // Two tubes of 24 vertices; the bend's ball adds its pole and three rings.
    expect(straight.nv).toBe(48);
    expect(bend.nv).toBe(48 + 1 + 3 * 12);
    // The far limb (toward −v) is written first: its vertices sit up the screen of the near one's.
    const firstY = bend.f32[1], lastY = bend.f32[(bend.nv - 1) * WORDS + 1];
    expect(firstY).toBeLessThan(lastY);
  });

  test("it grows past its first size and keeps what it wrote", () => {
    const m = pipeMesh(4);
    for (let k = 0; k < 20; k++) tube(m, 1, k, 0, 0, k + 1, 0, 0, 0.1, solid(0x123456), 8);
    expect(m.nv).toBe(20 * 16);
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
