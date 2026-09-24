/**
 * WHAT THE DEVICE HOLDS, read back from the textures the shader samples.
 *
 * Every probe written for the multi-storey water so far reads the HOST's copy
 * of the depths, and then asks whether the sheet ids agree with it. They always
 * do: the ids are computed from that copy, every frame, by `findBodies`. The
 * disagreement that puts a hole on a bridge is between the ids and the DEVICE's
 * depth — the texture the vertex shader actually samples — and no instrument
 * in this repository could see it, because nothing read that texture back.
 *
 * On the device path the host's copy is a band or a sparse list three to five
 * frames behind, and on a sparse frame up to `CARRY_EVERY` readbacks behind. At
 * a front moving onto or off a deck the two are simply different water: the
 * column is wet on the device and `NO_BODY` on the host, or labelled on the
 * host and empty on the device. The shader has no skip for `NO_BODY` — it draws
 * such a column as pseudo-sheet `-1` and `cornerOf(-1)` gathers every other
 * unlabelled column at that corner, at the wrong height, colour and alpha.
 *
 * ITS OWN STAGING BUFFER, AND SO ITS OWN ROW STRIDE. `copyOut` copies straight
 * out of the solver's field buffer and therefore inherits the 256-byte row
 * rule as a constraint on the MAP — that is what `canCopyOut` is about, and it
 * is why a 128-column map cannot take the material texture by copy. Reading
 * back into a buffer of this module's own choosing, the stride is a free
 * variable: pad the rows, unpack them here. That matters because the maps this
 * has to be pointed at include exactly the ones the copy cannot serve.
 */
import type { TextureSource } from "pixi.js";
import type { ColumnField } from "../../fluid/columns";
import { NO_BODY } from "../render/bodies";

/** A texture copy's rows must start on this many bytes. @see canCopyOut */
const ROW = 256;

/** The padded width of one row of `nx` floats, in bytes. */
export const strideFor = (nx: number) => Math.ceil((nx * 4) / ROW) * ROW;

/** The tight floats inside a padded copy. @see strideFor */
export function unpad(
  raw: Uint8Array, nx: number, rows: number, stride: number,
): Float32Array {
  const out = new Float32Array(nx * rows);
  for (let r = 0; r < rows; r++) {
    // A view, not a copy: `stride` is a multiple of 256 and so of 4, which is
    // what lets a Float32Array be laid over the byte offset at all.
    out.set(new Float32Array(raw.buffer, raw.byteOffset + r * stride, nx), r * nx);
  }
  return out;
}

/** The same the other way, for a write back into a texture. @see strideFor */
export function padded(
  data: Float32Array, nx: number, rows: number, stride: number,
): Uint8Array {
  const out = new Uint8Array(stride * rows);
  const view = new Float32Array(out.buffer);
  for (let r = 0; r < rows; r++) {
    view.set(data.subarray(r * nx, r * nx + nx), (r * stride) / 4);
  }
  return out;
}

/** Just enough of the renderer to ask what stands behind a texture source. */
type GetGpu = { texture: { getGpuSource: (s: TextureSource) => GPUTexture } };

/**
 * The `GPUTexture` behind a Pixi source, or null off the WebGPU path.
 *
 * Pixi gives every uncompressed source `COPY_SRC` (`GpuTextureSystem`), so one
 * of these can be copied out of without asking for anything special at
 * creation. Nothing on the WebGL path can be, and there is no pretending
 * otherwise — that path has no device to read back from.
 */
export function gpuOf(renderer: unknown, source: TextureSource): GPUTexture | null {
  const sys = renderer as Partial<GetGpu>;
  if (typeof sys?.texture?.getGpuSource !== "function") return null;
  return sys.texture.getGpuSource(source);
}

/**
 * `rows` rows of an `r32float` texture, starting at row `y0`.
 *
 * The planes of the water's textures are stacked vertically — slot `a` starts
 * at row `a * ny` — so a storey is a row range and nothing has to be unpacked
 * beyond the padding. @see createGpuWaterLayer
 */
export async function readFloatRows(
  device: GPUDevice, texture: GPUTexture, nx: number, y0: number, rows: number,
): Promise<Float32Array> {
  const stride = strideFor(nx);
  const staging = device.createBuffer({
    size: stride * rows,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    label: "a water texture, read back",
  });
  const enc = device.createCommandEncoder({ label: "read back a water texture" });
  enc.copyTextureToBuffer(
    { texture, origin: { x: 0, y: y0, z: 0 } },
    { buffer: staging, bytesPerRow: stride, rowsPerImage: rows },
    { width: nx, height: rows, depthOrArrayLayers: 1 },
  );
  device.queue.submit([enc.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  // COPIED OUT BEFORE THE UNMAP. The mapped range is only valid until then,
  // and a Float32Array laid over it afterwards is a detached buffer.
  const raw = new Uint8Array(staging.getMappedRange()).slice();
  staging.unmap();
  staging.destroy();
  return unpad(raw, nx, rows, stride);
}

/**
 * Put `rows` rows back, starting at row `y0`.
 *
 * For an instrument that has to take the device's water away and see what
 * stops being drawn — zeroing the host's array does not do that, because on a
 * carried frame nothing uploads the host's array. @see readFloatRows
 */
export function writeFloatRows(
  device: GPUDevice, texture: GPUTexture, nx: number, y0: number,
  rows: number, data: Float32Array,
) {
  const stride = strideFor(nx);
  device.queue.writeTexture(
    { texture, origin: { x: 0, y: y0, z: 0 } },
    padded(data, nx, rows, stride),
    { bytesPerRow: stride, rowsPerImage: rows },
    { width: nx, height: rows, depthOrArrayLayers: 1 },
  );
}

/** One column the two sources disagree about. @see accountDecks */
export type Disagreement = {
  cx: number; cy: number; a: number;
  /** The device's depth, which is what the shader draws from. */
  dev: number;
  /** The host's copy of it, which is what the id was decided from. */
  host: number;
  /** The sheet id, or {@link NO_BODY}. */
  id: number;
};

/** @see accountDecks */
export type DeckAccount = {
  deckColumns: number;
  deviceWet: number; hostWet: number;
  deviceHeld: number; hostHeld: number;
  /**
   * WET ON THE DEVICE, WITH NO SHEET ID. The number the whole instrument is
   * for: these columns hold water, the shader will sample it, and it is drawn
   * as pseudo-sheet `-1` alongside every other unlabelled column at the corner.
   */
  deviceWetNoId: number;
  /** Labelled, and the device has nothing there: an id for water that has gone. */
  idNoDeviceWater: number;
  /** The same two asked of the host mirror — what every other probe can see. */
  hostWetNoId: number; idNoHostWater: number;
  /** Where the two depths simply part company. */
  deviceWetHostDry: number; hostWetDeviceDry: number;
  worstGap: number; worstAt: Disagreement | null;
  /**
   * Columns whose id ON THE DEVICE is not the one the host last computed.
   * Expected to be nought — the body texture is uploaded whole every frame —
   * and worth asking once rather than assuming. Null when the ids were not
   * read back.
   */
  idsAdrift: number | null;
  examples: Disagreement[];
  ok: boolean;
  why: string | null;
};

/**
 * THE THREE COUNTS, over every decked column.
 *
 * Pure, and separate from the readback, so the arithmetic can be tested
 * without a device. `device` and `ids` are the full `cells * layers` planes as
 * they came off the textures; `f` is the host mirror.
 */
export function accountDecks(
  f: ColumnField, device: Float32Array, ids: Int32Array,
  deviceIds: Float32Array | null,
): DeckAccount {
  const cells = f.cells, dry = f.params.dryDepth;
  const out: DeckAccount = {
    deckColumns: 0, deviceWet: 0, hostWet: 0, deviceHeld: 0, hostHeld: 0,
    deviceWetNoId: 0, idNoDeviceWater: 0, hostWetNoId: 0, idNoHostWater: 0,
    deviceWetHostDry: 0, hostWetDeviceDry: 0, worstGap: 0, worstAt: null,
    idsAdrift: deviceIds ? 0 : null, examples: [], ok: true, why: null,
  };
  for (let a = 1; a < f.layers; a++) {
    for (let i = 0; i < cells; i++) {
      const ia = a * cells + i;
      // A DECK, by the only test there is for one: an upper slot that EXISTS.
      // `rebuildSlots` collapses a slot the map has no room for onto its own
      // floor, so `roof > ground` above slot zero is a storeyed column and
      // nothing else is. The deck's own water sits in that slot with the sky
      // over it; the channel it spans is slot zero, roofed by the soffit.
      if (!(f.roof[ia] > f.ground[ia])) continue;
      out.deckColumns++;
      const dev = device[ia], host = f.depth[ia], id = ids[ia];
      out.deviceHeld += dev; out.hostHeld += host;
      const devWet = dev > dry, hostWet = host > dry, has = id !== NO_BODY;
      if (devWet) out.deviceWet++;
      if (hostWet) out.hostWet++;
      if (devWet && !has) out.deviceWetNoId++;
      if (has && !devWet) out.idNoDeviceWater++;
      if (hostWet && !has) out.hostWetNoId++;
      if (has && !hostWet) out.idNoHostWater++;
      if (devWet && !hostWet) out.deviceWetHostDry++;
      if (hostWet && !devWet) out.hostWetDeviceDry++;
      if (deviceIds && deviceIds[ia] !== id) out.idsAdrift!++;
      const gap = Math.abs(dev - host);
      const at = { cx: i % f.nx, cy: (i / f.nx) | 0, a, dev, host, id };
      if (gap > out.worstGap) { out.worstGap = gap; out.worstAt = at; }
      if (devWet && !has && out.examples.length < 12) out.examples.push(at);
    }
  }
  out.deviceHeld = +out.deviceHeld.toFixed(3);
  out.hostHeld = +out.hostHeld.toFixed(3);
  out.worstGap = +out.worstGap.toFixed(4);
  out.ok = out.deviceWetNoId === 0 && out.idNoDeviceWater === 0;
  out.why = out.deviceWetNoId > 0
    ? `${out.deviceWetNoId} decked columns hold water on the device and have no`
      + " sheet id: the shader draws them as sheet -1"
    : out.idNoDeviceWater > 0
      ? `${out.idNoDeviceWater} decked columns are labelled and empty on the`
        + " device: a sheet is being drawn for water that has gone"
      : null;
  return out;
}

/**
 * TAKE THE DECK'S WATER AWAY ON BOTH SIDES, and hand back how to put it back.
 *
 * The reference frame every pixel probe here is measured against — the same
 * picture with the deck's water not drawn — was built by emptying the host's
 * upper storeys and redrawing, on the theory that `findBodies` would then
 * label those columns `NO_BODY` and the builder would drop them. It does label
 * them, and the builder does not drop them: the GPU has no skip for `NO_BODY`
 * and draws such a column as pseudo-sheet `-1`. And on a carried frame nothing
 * uploads the host's depths at all, so the texture the shader samples still
 * holds every drop. The reference still contained the thing it was the
 * reference for, and a probe whose baseline includes its own subject reports
 * a smaller difference than there is — which is how "the deck draws fine"
 * survived several sittings.
 *
 * So zero the DEVICE's plane, which is what is drawn, and the host's, which is
 * what the ids are decided from. Both, because a bare frame has to be bare on
 * every source the picture is assembled out of.
 *
 * THE CALLER MUST NOT YIELD between this resolving and its restore: the zeros
 * go onto the queue here, and the solver's own `copyOut` would put the water
 * straight back on the next frame it ran. Draw, shoot, restore, all in one
 * synchronous stretch. The depths restored are the ones read a moment ago and
 * may be a frame stale; on the device path the next `copyOut` overwrites the
 * whole texture anyway, and on the host path they are exact.
 */
export async function silenceDecks(
  renderer: unknown, device: GPUDevice | null, depth: TextureSource, f: ColumnField,
): Promise<(() => void) | null> {
  if (f.layers < 2) return null;
  const cells = f.cells;
  const host = f.depth.slice(cells);
  const tex = device ? gpuOf(renderer, depth) : null;
  const rows = f.ny * (f.layers - 1);
  const kept = tex && device
    ? await readFloatRows(device, tex, f.nx, f.ny, rows)
    : null;
  f.depth.fill(0, cells);
  if (tex && device && kept) {
    writeFloatRows(device, tex, f.nx, f.ny, rows, new Float32Array(kept.length));
  }
  return () => {
    f.depth.set(host, cells);
    if (tex && device && kept) writeFloatRows(device, tex, f.nx, f.ny, rows, kept);
  };
}
