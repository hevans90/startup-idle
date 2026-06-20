/**
 * Samples each SubTexture rect in landscape_sheet.png and renames frames from pixel statistics
 * (heuristic: water / grass / dirt / sand / road / composites). Works best on flat-shaded tiles.
 *
 * Run: `bun run scripts/analyze-landscape-atlas-colors.ts`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

type Frame = { name: string; x: number; y: number; width: number; height: number };

function parseFrames(xml: string): Frame[] {
  const out: Frame[] = [];
  const re =
    /<SubTexture name="([^"]+)" x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push({
      name: m[1],
      x: +m[2],
      y: +m[3],
      width: +m[4],
      height: +m[5],
    });
  }
  return out;
}

type PixelKind =
  | "water"
  | "grass"
  | "dirt"
  | "sand"
  | "road"
  | "other";

function pixelKind(r: number, g: number, b: number, a: number): PixelKind | null {
  if (a < 48) return null;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max - min;
  const avg = (r + g + b) / 3;

  if (b > r + 22 && b > g + 12 && b > 65) return "water";
  if (g > r + 18 && g > b + 12 && g > 55) return "grass";
  if (r > 175 && g > 155 && b > 95 && r - b < 95 && g - b < 75) return "sand";
  if (sat < 42 && avg > 40 && avg < 205) {
    if (avg < 125 && r + 15 > g && r + 15 > b) return "dirt";
    return "road";
  }
  if (r > 65 && g < r * 0.98 + 15 && b < r * 0.92 && r > b + 12) return "dirt";

  return "other";
}

type TileKind =
  | "grass"
  | "water"
  | "water_grass"
  | "dirt"
  | "sand"
  | "road"
  | "mixed"
  | "other"
  | "sparse";

function classifyTile(
  png: PNG,
  x: number,
  y: number,
  w: number,
  h: number
): TileKind {
  const padX = Math.floor(w * 0.22);
  const padY = Math.floor(h * 0.2);
  const x0 = Math.max(0, x + padX);
  const y0 = Math.max(0, y + padY);
  const x1 = Math.min(png.width, x + w - padX);
  const y1 = Math.min(png.height, y + h - padY);
  if (x1 <= x0 || y1 <= y0) return "sparse";

  const counts: Record<PixelKind, number> = {
    water: 0,
    grass: 0,
    dirt: 0,
    sand: 0,
    road: 0,
    other: 0,
  };
  let opaque = 0;
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const i = (png.width * py + px) << 2;
      const r = png.data[i]!;
      const g = png.data[i + 1]!;
      const b = png.data[i + 2]!;
      const a = png.data[i + 3]!;
      const k = pixelKind(r, g, b, a);
      if (k == null) continue;
      opaque++;
      counts[k]++;
    }
  }
  if (opaque < 80) return "sparse";

  const pct = (k: PixelKind) => (counts[k] / opaque) * 100;
  const pw = pct("water");
  const pg = pct("grass");
  const pd = pct("dirt");
  const ps = pct("sand");
  const pr = pct("road");

  if (pw > 16 && pg > 16 && pw + pg > 52) return "water_grass";
  if (pw > 30) return "water";
  if (pg > 28) return "grass";
  if (ps > 22) return "sand";
  if (pr > 26) return "road";
  if (pd > 24) return "dirt";

  const ranked: [PixelKind, number][] = [
    ["water", counts.water],
    ["grass", counts.grass],
    ["dirt", counts.dirt],
    ["sand", counts.sand],
    ["road", counts.road],
    ["other", counts.other],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  const top = ranked[0]![0];
  if (top === "other" || ranked[0]![1] / opaque < 0.2) return "mixed";
  return top as TileKind;
}

function bySheetOrder(a: Frame, b: Frame): number {
  if (a.y !== b.y) return a.y - b.y;
  return a.x - b.x;
}

function heightClass(h: number): "" | "_low" | "_tall" {
  if (h >= 120) return "_tall";
  if (h <= 88) return "_low";
  return "";
}

const xmlPath = join(
  root,
  "public/isometric_assets/landscape/landscape_sheet.xml"
);
const pngPath = join(
  root,
  "public/isometric_assets/landscape/landscape_sheet.png"
);
const legendPath = join(
  root,
  "src/office/map/tilemaps/default/legend.txt"
);

const xml = readFileSync(xmlPath, "utf8");
const pngBuf = readFileSync(pngPath);
const png = PNG.sync.read(pngBuf);

const frames = parseFrames(xml);
const analyzed: { frame: Frame; kind: TileKind }[] = frames.map((frame) => ({
  frame,
  kind: classifyTile(png, frame.x, frame.y, frame.width, frame.height),
}));

const kindTallFirst = (k: TileKind, h: number) => `${k}${heightClass(h)}`;

const groups = new Map<string, { frame: Frame; kind: TileKind }[]>();
for (const row of analyzed) {
  const key = kindTallFirst(row.kind, row.frame.height);
  const list = groups.get(key) ?? [];
  list.push(row);
  groups.set(key, list);
}
for (const list of groups.values()) {
  list.sort((a, b) => bySheetOrder(a.frame, b.frame));
}

const nameMap = new Map<string, string>();
const counters = new Map<string, number>();

for (const [groupKey, list] of [...groups.entries()].sort((a, b) =>
  a[0].localeCompare(b[0])
)) {
  let n = 0;
  for (const { frame } of list) {
    n++;
    const newName = `land_${groupKey}_${String(n).padStart(3, "0")}.png`;
    nameMap.set(frame.name, newName);
    counters.set(groupKey, n);
  }
}

let outXml = xml;
for (const [oldName, newName] of nameMap) {
  outXml = outXml.replace(`name="${oldName}"`, `name="${newName}"`);
}
writeFileSync(xmlPath, outXml, "utf8");

let legend = readFileSync(legendPath, "utf8");
for (const [oldName, newName] of nameMap) {
  legend = legend.replace(
    new RegExp(`(\\s)${escapeRegExp(oldName)}(\\s|$)`, "g"),
    `$1${newName}$2`
  );
}
writeFileSync(legendPath, legend, "utf8");

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

console.log("Landscape atlas renamed from PNG color sampling.\n");
console.log("Tiles per category (after height suffix):");
for (const [k, v] of [...counters.entries()].sort((a, b) =>
  a[0].localeCompare(b[0])
)) {
  console.log(`  ${k}: ${v}`);
}

console.log("\nFirst 12 renames (old -> new):");
let i = 0;
for (const [o, n] of nameMap) {
  console.log(`  ${o} -> ${n}`);
  if (++i >= 12) break;
}
console.log("\nRun `bun run build-atlas-json` to refresh *_sheet.json for the app.");
