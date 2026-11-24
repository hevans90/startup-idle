/**
 * World v2 — THE SHEETS THE GPU KEEPS COMPRESSED (`.ktx2`): Pixi's loader for them, and its transcoder fetched
 * from this site and not from a CDN. Imported by whatever loads a sheet; it costs nothing until a `.ktx2` is asked
 * for, when the transcoder (a worker, some 300 KB) is fetched once. Where the GPU has neither BC7 nor ASTC the
 * loader hands back plain RGBA, so a sheet loads everywhere. @see dev/to-ktx2.ts
 *
 * The two files under `public/transcoders/ktx` are copies of `node_modules/pixi.js/transcoders/ktx`, held to them
 * by a test: the loader and its transcoder are one version or they do not speak.
 */
import "pixi.js/ktx2";
import { setKTXTranscoderPath } from "pixi.js";

if (typeof location !== "undefined") {
  setKTXTranscoderPath({
    jsUrl: new URL("/transcoders/ktx/libktx.js", location.origin).href,
    wasmUrl: new URL("/transcoders/ktx/libktx.wasm", location.origin).href,
  });
}
