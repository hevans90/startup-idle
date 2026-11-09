/**
 * World v2 — ROOM FOR A FRAME'S UNIFORMS on WebGPU.
 *
 * Pixi's WebGPU renderer packs every uniform group a frame binds — one for
 * each render group, each Graphics or mesh drawn on its own — into one buffer
 * of 65,535 floats, a slot of 128 bytes each: about two thousand a frame. Past
 * that it throws "ubo batch got too big" (its own source says "TODO push a
 * new buffer") and the frame is lost, every frame: a black screen. A big map
 * with a gallery of buildings going up passed it.
 *
 * So the buffer is made bigger once the renderer is up. Only what a frame
 * uses is uploaded, so the room costs memory, not time. WebGL has no such
 * buffer and is left alone.
 */

/** Floats of room: eight times Pixi's, about sixteen thousand groups a frame. */
export const UNIFORM_FLOATS = 65535 * 8;

type Pipe = { _batchBuffer?: { data: Float32Array }; _buffers?: { data: Float32Array }[] };

/** Give the renderer's per-frame uniform buffer `floats` of room, if it is WebGPU's and has less. */
export function roomForUniforms(renderer: unknown, floats = UNIFORM_FLOATS): boolean {
  const pipe = (renderer as { renderPipes?: { uniformBatch?: Pipe } })?.renderPipes?.uniformBatch;
  const batch = pipe?._batchBuffer;
  if (!pipe || !batch || !pipe._buffers || batch.data.length >= floats) return false;
  const data = new Float32Array(floats);
  batch.data = data;
  // The GPU buffers it is copied into: setting their data resizes them.
  for (const b of pipe._buffers) b.data = data;
  return true;
}
