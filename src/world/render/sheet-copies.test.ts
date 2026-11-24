import { describe, expect, test } from "bun:test";
import type { Renderer, TextureSource } from "pixi.js";

import { adoptSheets, keepOnGpuOnly, shedSheetCopies } from "./sheet-copies";

type Fake = { uploadMethodId: string; resource: Uint8Array[]; _gpuData: Record<number, { gpuTexture: unknown; destroy: () => void } | null>; destroyed: boolean };
const sheet = (method = "compressed"): Fake => ({ uploadMethodId: method, resource: [new Uint8Array(64), new Uint8Array(16)], _gpuData: {}, destroyed: false });
const asSource = (s: Fake) => s as unknown as TextureSource;

/** A renderer that puts a source on its device the first time it is asked, as Pixi's does. */
function renderer(uid: number, device: object | null) {
  const made: { destroyed: number }[] = [];
  const r = {
    uid, gpu: device ? { device } : undefined,
    texture: device ? {
      getGpuSource(s: Fake) {
        const have = s._gpuData[uid]?.gpuTexture;
        if (have) return have;
        const t = { destroyed: 0, destroy() { t.destroyed++; } };
        made.push(t);
        s._gpuData[uid] = { gpuTexture: t, destroy() { t.destroy(); } };
        return t;
      },
    } : {},
  };
  return { r: r as unknown as Renderer, made };
}

describe("a compressed sheet kept on the GPU alone", () => {
  test("its levels are let go once uploaded, a couple a frame", () => {
    const device = {}, { r, made } = renderer(1, device);
    const sheets = [sheet(), sheet(), sheet()];
    for (const s of sheets) keepOnGpuOnly(asSource(s));
    shedSheetCopies(r);
    expect(sheets.map((s) => s.resource.length)).toEqual([0, 0, 2]);
    shedSheetCopies(r);
    expect(sheets[2].resource.length).toBe(0);
    expect(made.length).toBe(3);
  });

  test("the texture outlives its renderer and is the next one's, on the same device only", () => {
    const device = {}, a = renderer(11, device);
    const s = sheet();
    keepOnGpuOnly(asSource(s));
    shedSheetCopies(a.r);
    // The renderer destroyed: its hold dropped, the texture left standing.
    s._gpuData[11]!.destroy();
    expect(a.made[0].destroyed).toBe(0);
    const b = renderer(12, device);
    adoptSheets(b.r);
    expect(s._gpuData[12]!.gpuTexture).toBe(a.made[0]);
    const other = renderer(13, {});
    adoptSheets(other.r);
    expect(s._gpuData[13]).toBeUndefined();
  });

  test("an image's source is left alone, and so is everything on WebGL", () => {
    const { r } = renderer(21, {});
    const image = sheet("image");
    keepOnGpuOnly(asSource(image));
    shedSheetCopies(r);
    expect(image.resource.length).toBe(2);
    const gl = renderer(22, null), s = sheet();
    keepOnGpuOnly(asSource(s));
    shedSheetCopies(gl.r);
    expect(s.resource.length).toBe(2);
  });
});
