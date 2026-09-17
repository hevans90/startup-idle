/**
 * The quad batch.
 *
 * Everything here is about the buffer rather than the picture: what the GPU is
 * handed, what it is left holding, and how much of it gets re-uploaded. The
 * picture is `water.test.ts`'s problem.
 */
import { describe, expect, test } from "bun:test";
import { Container } from "pixi.js";

import {
  colourAt, createQuadBatch, destroyQuadBatch, pushQuad, quadAt, resetQuads, rgba, uploadQuads,
  type QuadBatch,
} from "./quads";

/** A unit square at (x, y), so a quad is easy to name and easy to recognise. */
const square = (b: QuadBatch, x: number, y: number, colour = 0xffffffff) =>
  pushQuad(b, x, y, colour, x + 1, y, colour, x + 1, y + 1, colour, x, y + 1, colour);

const fresh = (cap?: number) => createQuadBatch(new Container(), cap);

/** How many bytes the last upload asked the renderer for. */
const uploadedBytes = (b: QuadBatch) =>
  (b.vertices as unknown as { _updateSize: number })._updateSize;

describe("writing quads", () => {
  test("a quad's four corners land in the buffer in order", () => {
    const b = fresh();
    square(b, 10, 20);
    expect(b.n).toBe(1);
    expect(quadAt(b, 0)).toEqual([10, 20, 11, 20, 11, 21, 10, 21]);
    destroyQuadBatch(b);
  });

  test("the colour rides on every vertex of the quad", () => {
    const b = fresh();
    const c = rgba(0x2a6f97, 0.5);
    square(b, 0, 0, c);
    for (let v = 0; v < 4; v++) expect(colourAt(b, 0, v)).toBe(c);
    destroyQuadBatch(b);
  });

  test("each corner can carry its OWN colour, which is what shades a surface", () => {
    // The rasteriser interpolates between them, so a quad with four different
    // corner colours is a gradient rather than a plate.
    const b = fresh();
    pushQuad(b, 0, 0, 1, 1, 0, 2, 1, 1, 3, 0, 1, 4);
    expect([0, 1, 2, 3].map((v) => colourAt(b, 0, v))).toEqual([1, 2, 3, 4]);
    destroyQuadBatch(b);
  });

  test("quads pack one after another, three words a vertex", () => {
    const b = fresh();
    square(b, 0, 0);
    square(b, 5, 5);
    expect(quadAt(b, 1)).toEqual([5, 5, 6, 5, 6, 6, 5, 6]);
    expect(b.f32[12]).toBe(5);          // second quad starts at word 12
    destroyQuadBatch(b);
  });

  test("reset rewinds without touching what is written", () => {
    const b = fresh();
    square(b, 3, 4);
    resetQuads(b);
    expect(b.n).toBe(0);
    expect(b.f32[0]).toBe(3);           // still there, just not claimed
    destroyQuadBatch(b);
  });
});

describe("growing", () => {
  test("it doubles, and keeps every quad already written", () => {
    const b = fresh(2);
    square(b, 0, 0);
    square(b, 1, 1);
    expect(b.cap).toBe(2);
    square(b, 2, 2);
    expect(b.cap).toBe(4);
    expect(quadAt(b, 0)).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    expect(quadAt(b, 1)).toEqual([1, 1, 2, 1, 2, 2, 1, 2]);
    expect(quadAt(b, 2)).toEqual([2, 2, 3, 2, 3, 3, 2, 3]);
    destroyQuadBatch(b);
  });

  test("it keeps growing until it fits, however far past capacity", () => {
    const b = fresh(1);
    for (let q = 0; q < 40; q++) square(b, q, q);
    expect(b.n).toBe(40);
    expect(b.cap).toBe(64);
    expect(b.f32.length).toBe(64 * 4 * 3);
    expect(quadAt(b, 39)).toEqual([39, 39, 40, 39, 40, 40, 39, 40]);
    destroyQuadBatch(b);
  });

  test("the index buffer covers the whole new capacity", () => {
    const b = fresh(2);
    for (let q = 0; q < 5; q++) square(b, q, q);
    const idx = b.indices.data as Uint32Array;
    expect(idx.length).toBe(b.cap * 6);
    // Two triangles round the last quad's four corners.
    const v = (b.cap - 1) * 4, o = (b.cap - 1) * 6;
    expect([...idx.slice(o, o + 6)]).toEqual([v, v + 1, v + 2, v, v + 2, v + 3]);
    destroyQuadBatch(b);
  });

  test("a batch that shrinks keeps its capacity, so a settled surface never grows again", () => {
    const b = fresh(2);
    for (let q = 0; q < 20; q++) square(b, q, q);
    const cap = b.cap, buf = b.f32;
    uploadQuads(b);
    resetQuads(b);
    square(b, 0, 0);
    uploadQuads(b);
    expect(b.cap).toBe(cap);
    expect(b.f32).toBe(buf);
    destroyQuadBatch(b);
  });
});

describe("uploading", () => {
  test("quads dropped since last frame are collapsed to a point", () => {
    // The index buffer spans the capacity, so anything left in the buffer keeps
    // being drawn. Blanking is what actually takes a quad off the screen.
    const b = fresh();
    square(b, 1, 1);
    square(b, 2, 2);
    uploadQuads(b);

    resetQuads(b);
    square(b, 1, 1);
    uploadQuads(b);
    expect(quadAt(b, 1)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(colourAt(b, 1)).toBe(0);      // and transparent, belt and braces
    expect(quadAt(b, 0)).toEqual([1, 1, 2, 1, 2, 2, 1, 2]);
    destroyQuadBatch(b);
  });

  test("only the bytes in use are uploaded", () => {
    const b = fresh(64);
    square(b, 0, 0);
    square(b, 1, 1);
    uploadQuads(b);
    // Two quads: 2 x 4 vertices x 12 bytes. Not the 64-quad buffer behind them.
    expect(uploadedBytes(b)).toBe(2 * 4 * 12);
    destroyQuadBatch(b);
  });

  test("a shrink still uploads the blanked tail", () => {
    const b = fresh(64);
    for (let q = 0; q < 6; q++) square(b, q, q);
    uploadQuads(b);
    resetQuads(b);
    square(b, 0, 0);
    uploadQuads(b);
    // One live quad, but six quads' worth of buffer has to reach the GPU.
    expect(uploadedBytes(b)).toBe(6 * 4 * 12);
    destroyQuadBatch(b);
  });

  test("the mesh shows only while it has something to draw", () => {
    const b = fresh();
    uploadQuads(b);
    expect(b.mesh.visible).toBe(false);

    square(b, 0, 0);
    uploadQuads(b);
    expect(b.mesh.visible).toBe(true);

    resetQuads(b);
    uploadQuads(b);
    expect(b.mesh.visible).toBe(false);
    destroyQuadBatch(b);
  });

  test("a steady surface never touches visibility, which is structural", () => {
    // Setting `visible` makes the renderer rebuild the scene's instruction
    // list. Doing that every frame would cost more than the water.
    const b = fresh();
    square(b, 0, 0);
    uploadQuads(b);

    let writes = 0;
    const mesh = b.mesh;
    let proto = Object.getPrototypeOf(mesh);
    while (proto && !Object.getOwnPropertyDescriptor(proto, "visible")) {
      proto = Object.getPrototypeOf(proto);
    }
    const real = Object.getOwnPropertyDescriptor(proto, "visible")!;
    Object.defineProperty(mesh, "visible", {
      get: () => real.get!.call(mesh),
      set: (v: boolean) => { writes++; real.set!.call(mesh, v); },
      configurable: true,
    });
    for (let n = 0; n < 10; n++) { resetQuads(b); square(b, 0, 0); uploadQuads(b); }
    expect(writes).toBe(0);
    destroyQuadBatch(b);
  });
});

describe("rgba packing", () => {
  test("packs a 0xRRGGBB colour and an alpha the way unorm8x4 reads them", () => {
    // Little-endian ABGR: red ends up in the low byte.
    expect(rgba(0xff0000, 1)).toBe(0xff0000ff);
    expect(rgba(0x0000ff, 1)).toBe(0xffff0000);
    expect(rgba(0x00ff00, 1)).toBe(0xff00ff00);
    expect(rgba(0x000000, 0)).toBe(0x00000000);
    expect(rgba(0x2a6f97, 0.5) >>> 24).toBe(128);
    destroyQuadBatch(fresh());
  });

  test("clamps rather than wrapping, so an out-of-range alpha cannot flip a colour", () => {
    expect(rgba(0x2a6f97, 2) >>> 24).toBe(255);
    expect(rgba(0x2a6f97, -1) >>> 24).toBe(0);
  });
});

describe("the mesh itself", () => {
  test("it goes into the container it was made for, and is not hit-testable", () => {
    const parent = new Container();
    const b = createQuadBatch(parent);
    expect(parent.children).toContain(b.mesh);
    expect(b.mesh.eventMode).toBe("none");
    destroyQuadBatch(b);
    expect(parent.children).not.toContain(b.mesh);
  });
});
