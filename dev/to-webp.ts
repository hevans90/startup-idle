/**
 * THE BAKED SHEETS AS LOSSLESS WEBP: every `*_N.png` a sheet's JSON names, encoded again pixel for pixel — the
 * colour under a clear pixel kept (`-exact`), since the sampler blends with it at a sprite's edge — at about half
 * the bytes; the JSON told the new names, the PNGs removed. Run after a bake (the `bake:*` scripts do).
 *
 *     bun run dev/to-webp.ts            # needs `cwebp` (brew install webp)
 */
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(import.meta.dir, "../public/isometric_assets/derived");
if (Bun.spawnSync(["cwebp", "-version"]).exitCode !== 0) throw new Error("to-webp: cwebp is not installed (brew install webp)");

const jobs: { png: string; webp: string }[] = [];
for (const f of readdirSync(DIR)) {
  if (!f.endsWith(".json")) continue;
  const text = readFileSync(join(DIR, f), "utf8");
  const names = [...new Set(text.match(/"[a-z]+_\d+\.png"/g) ?? [])].map((n) => n.slice(1, -1));
  if (!names.length) continue;
  for (const n of names) if (existsSync(join(DIR, n))) jobs.push({ png: join(DIR, n), webp: join(DIR, n.replace(/\.png$/, ".webp")) });
  writeFileSync(join(DIR, f), text.replace(/"([a-z]+_\d+)\.png"/g, '"$1.webp"'));
}
let before = 0, after = 0;
const run = async (j: { png: string; webp: string }) => {
  const p = Bun.spawn(["cwebp", "-quiet", "-lossless", "-exact", "-z", "9", j.png, "-o", j.webp], { stderr: "inherit" });
  if ((await p.exited) !== 0) throw new Error(`to-webp: cwebp failed on ${j.png}`);
  before += statSync(j.png).size; after += statSync(j.webp).size;
  rmSync(j.png);
};
// (Eight at a time: each is a core for some seconds.)
for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map(run));
// (A sheet baked to fewer pages than before leaves none of the old ones behind.)
const named = new Set<string>();
for (const f of readdirSync(DIR)) if (f.endsWith(".json")) for (const n of readFileSync(join(DIR, f), "utf8").match(/[a-z]+_\d+\.webp/g) ?? []) named.add(n);
for (const f of readdirSync(DIR)) if (/^[a-z]+_\d+\.webp$/.test(f) && !named.has(f)) rmSync(join(DIR, f));
console.log(`to-webp: ${jobs.length} sheets, ${(before / 1e6).toFixed(1)} MB of PNG -> ${(after / 1e6).toFixed(1)} MB of WebP`);
