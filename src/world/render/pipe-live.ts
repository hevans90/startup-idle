/**
 * World v2 — WHAT EACH PIECE OF PIPE IS DOING NOW, as a texture the pipes'
 * shader reads: a texel a SLOT, a slot a piece (a trunk tile), and in it how
 * full the pipe stands there and how far its marks have run along it. So a
 * trunk's chevrons move with what it carries and its fill shows on the tube
 * — with nothing rebuilt, no vertex written, and no draw list touched: the
 * layer writes a few bytes and the one texture goes up again.
 * @see plans/pipe-network.md phase 10, pipe-gpu, live in pipe-mesh
 *
 * ONE TEXTURE FOR EVERY PIPE, made once and never put away: every band's
 * mesh shares the one shader, and a source destroyed under a cached draw
 * list is the fault the bands have had before.
 */
import { BufferImageSource } from "pixi.js";

/** Texels across; slots in all. Past the last, a piece has no slot: it is drawn still. */
export const LIVE_WIDE = 256, LIVE_SLOTS = LIVE_WIDE * 64;
/** A texel's bytes: fill, phase, and two spare. Alpha stays opaque: WebGL premultiplies on upload. */
const bytes = new Uint8Array(LIVE_SLOTS * 4);
for (let i = 3; i < bytes.length; i += 4) bytes[i] = 255;
/** How far each slot's marks have run, in lengths: kept whole here, its fraction in the texture. */
const phase = new Float32Array(LIVE_SLOTS);
let source: BufferImageSource | null = null;
let dirty = false;

/** The texture, made when first asked for. */
export function liveSource(): BufferImageSource {
  source ??= new BufferImageSource({ resource: bytes, width: LIVE_WIDE, height: LIVE_SLOTS / LIVE_WIDE, format: "rgba8unorm", scaleMode: "nearest" });
  return source;
}

/**
 * Say what a slot is doing: how full, nought to one, and how fast its marks
 * run, lengths a second, over `dt` seconds. Returns whether anything changed.
 */
export function setLive(slot: number, fill: number, speed: number, dt: number): boolean {
  if (slot <= 0 || slot >= LIVE_SLOTS) return false;
  const o = slot * 4;
  if (speed !== 0 && dt > 0) phase[slot] = (phase[slot] + speed * dt) % 1;
  const f = Math.round(Math.max(0, Math.min(1, fill)) * 255), p = Math.round(phase[slot] * 255) & 255;
  if (bytes[o] === f && bytes[o + 1] === p) return false;
  bytes[o] = f; bytes[o + 1] = p;
  dirty = true;
  return true;
}

/** What a slot's texel says: for tests. */
export const liveOf = (slot: number) => ({ fill: bytes[slot * 4] / 255, phase: bytes[slot * 4 + 1] / 255 });

/** Send what changed, if anything did: once a frame, after every slot is said. Returns whether it went. */
export function flushLive(): boolean {
  if (!dirty) return false;
  dirty = false;
  source?.update();
  return true;
}
