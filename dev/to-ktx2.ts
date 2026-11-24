/**
 * BAKED SHEETS AS KTX2 (UASTC, with their mipmaps): what the GPU can keep compressed — BC7 or ASTC, a byte a pixel
 * where the picture as loaded is four — at about twice a lossless WebP's bytes to fetch, and not pixel for pixel
 * (some 37 dB on the sprites; nothing to be seen at three times life size). Colour multiplied by its alpha first:
 * a compressed texture cannot have that done as it is uploaded, and its mipmaps cannot be made on the GPU.
 *
 *     bun run dev/to-ktx2.ts cars people …     # needs `basisu` (brew install basis_universal) and `dwebp` (brew install webp)
 *
 * Takes each named sheet's pages from their PNGs (a fresh bake) or their WebPs, tells the JSON the new names and
 * removes the old files. Not the houses: the map's first frame waits for them, and a WebP needs no transcoder.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodePng, encodePng } from "./png-min.ts";

const DIR = join(import.meta.dir, "../public/isometric_assets/derived");
const families = process.argv.slice(2);
if (!families.length) throw new Error("to-ktx2: name the sheets (cars people props trees landmarks boats cranes)");
for (const tool of ["basisu", "dwebp"]) if (Bun.spawnSync(["which", tool]).exitCode !== 0) throw new Error(`to-ktx2: ${tool} is not installed`);

const tmp = mkdtempSync(join(tmpdir(), "ktx2-"));
const sh = async (cmd: string[]) => { const p = Bun.spawn(cmd, { stdout: "ignore", stderr: "inherit" }); if ((await p.exited) !== 0) throw new Error(`to-ktx2: ${cmd[0]} failed: ${cmd.join(" ")}`); };
let before = 0, after = 0, n = 0;
const one = async (name: string) => {
  const png = join(DIR, `${name}.png`), webp = join(DIR, `${name}.webp`), out = join(DIR, `${name}.ktx2`), work = join(tmp, `${name}.png`);
  const from = existsSync(png) ? png : existsSync(webp) ? webp : null;
  if (!from) { if (!existsSync(out)) throw new Error(`to-ktx2: no ${name}.png or .webp`); return; }
  if (from === webp) await sh(["dwebp", "-quiet", webp, "-o", work]);
  const img = decodePng(readFileSync(from === webp ? work : png)), px = img.px;
  // (Colour times alpha, rounded: what the browser does to a picture as it is uploaded.)
  for (let o = 0; o < px.length; o += 4) { const a = px[o + 3]; if (a === 255) continue; px[o] = Math.round((px[o] * a) / 255); px[o + 1] = Math.round((px[o + 1] * a) / 255); px[o + 2] = Math.round((px[o + 2] * a) / 255); }
  writeFileSync(work, encodePng(img));
  // (Linear: the numbers are sampled as they stand, as the PNG's were. Mipmaps clamped at the sheet's edge, not wrapped.)
  await sh(["basisu", "-uastc", "-uastc_level", "2", "-mipmap", "-mip_clamp", "-linear", "-ktx2", "-ktx2_zstandard_level", "19", "-no_status_output", work, "-output_file", out]);
  before += statSync(from).size; after += statSync(out).size; n++;
  for (const f of [png, webp]) if (existsSync(f)) rmSync(f);
};
for (const fam of families) {
  const file = join(DIR, `${fam}.json`);
  const text = readFileSync(file, "utf8");
  const names = [...new Set(text.match(new RegExp(`${fam}_\\d+(?=\\.(?:png|webp|ktx2)")`, "g")) ?? [])];
  if (!names.length) throw new Error(`to-ktx2: ${fam}.json names no pages`);
  // (Four at a time: the encoder is many threads already.)
  for (let i = 0; i < names.length; i += 4) await Promise.all(names.slice(i, i + 4).map(one));
  writeFileSync(file, text.replace(new RegExp(`(${fam}_\\d+)\\.(?:png|webp)"`, "g"), '$1.ktx2"'));
  // (A sheet baked to fewer pages than before leaves none of the old ones behind.)
  for (const f of readdirSync(DIR)) if (new RegExp(`^${fam}_\\d+\\.ktx2$`).test(f) && !names.includes(f.replace(/\.ktx2$/, ""))) rmSync(join(DIR, f));
}
rmSync(tmp, { recursive: true, force: true });
console.log(`to-ktx2: ${n} sheets, ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB of KTX2`);
