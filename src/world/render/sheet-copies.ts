/**
 * World v2 — A COMPRESSED SHEET IS KEPT ONCE, ON THE GPU.
 *
 * Pixi keeps what a texture was uploaded from (`source.resource`) so that it can upload it again: for a `.ktx2`
 * sheet, every mip level's blocks, as large in the page's memory as on the GPU — some 190 MB in a big town, held
 * for nothing, since a lost device reloads the page (@see reloadForLoss) and the renderer's own collection is off.
 *
 * So once a sheet is on the GPU its levels are let go. What uploading again was FOR is a second renderer — the map's
 * canvas is made anew each time its tab is come back to — so the GPU's texture is kept past its renderer and handed
 * to the next, which is the same device (@see gpuForPixi): nothing is uploaded twice either.
 *
 * WebGPU only: a WebGL context's textures die with its canvas, so there the copy stays.
 * @see ktx.ts, dev/to-ktx2.ts
 */
import type { Renderer, TextureSource } from "pixi.js";

type Data = { gpuTexture: GPUTexture | null; textureView: GPUTextureView | null; destroy: () => void };
type Held = { _gpuData: Record<number, Data | null>; resource: unknown; destroyed: boolean };
type Gpu = Renderer & { uid: number; gpu?: { device?: GPUDevice }; texture: { getGpuSource?: (s: TextureSource) => GPUTexture | null } };

/** Sheets loaded and not yet let go. */
const owed: Held[] = [];
/** Sheets let go: the texture each lives in, and the device that made it. */
const kept = new Map<Held, { texture: GPUTexture; device: GPUDevice }>();
/** How many are uploaded in a frame: a page is some megabytes written to the queue. */
const A_FRAME = 2;

/** A renderer's hold on a kept texture: dropped with the renderer, the texture left standing. */
function hold(texture: GPUTexture): Data {
  return { gpuTexture: texture, textureView: null, destroy() { this.gpuTexture = null; this.textureView = null; } };
}

/** A sheet just loaded: its copy is let go once it is on the GPU. Anything but a compressed sheet is left alone. */
export function keepOnGpuOnly(source: TextureSource): void {
  const s = source as unknown as Held;
  if (source.uploadMethodId !== "compressed" || kept.has(s) || owed.includes(s)) return;
  owed.push(s);
}

/** A renderer newly made: handed the sheets already on the GPU, before it draws. */
export function adoptSheets(renderer: Renderer): void {
  const r = renderer as Gpu, device = r.gpu?.device;
  if (!device) return;
  for (const [s, k] of kept) if (k.device === device && !s._gpuData[r.uid]) s._gpuData[r.uid] = hold(k.texture);
}

/** Each frame: put a sheet or two on the GPU and let their copies go. */
export function shedSheetCopies(renderer: Renderer): void {
  if (!owed.length) return;
  const r = renderer as Gpu, device = r.gpu?.device;
  if (!device || !r.texture.getGpuSource) { owed.length = 0; return; }
  for (let n = 0; n < A_FRAME && owed.length; n++) {
    const s = owed.shift()!;
    if (s.destroyed || !Array.isArray(s.resource) || !s.resource.length) continue;
    const texture = r.texture.getGpuSource(s as unknown as TextureSource);
    if (!texture) continue;
    s._gpuData[r.uid] = hold(texture);
    kept.set(s, { texture, device });
    s.resource.length = 0;
  }
}
// (In development: `__sheetCopies()` says how many sheets are kept on the GPU alone and how many wait; `.adopt` hands them to a renderer.)
if (import.meta.env?.DEV && typeof window !== "undefined") (window as unknown as { __sheetCopies?: unknown }).__sheetCopies = Object.assign(() => ({ kept: kept.size, owed: owed.length }), { adopt: adoptSheets });
