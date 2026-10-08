/**
 * World v2 — FOUNDING, step two: choosing the land.
 *
 * The map generator run live as the player chooses, with the result drawn as
 * the company will see it — a diamond, the way the game is drawn — and the
 * choice kept for the run, so the map it is founded on is the map that was
 * shown. @see useFoundWorld, Session.mapChoice
 *
 * A FEW PLAIN CHOICES up front — size, hills, rivers, lakes, woods, and a dice
 * for a new seed — and every setting the generator has behind "All settings",
 * from its own table, so nothing here can drift from what it can do.
 * @see GEN_SLIDERS
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import { DIRT, GRASS, SAND, WOODS } from "../../state/world.store";
import { Button } from "../../ui/Button";
import { generatePlayableMap, type GenReport } from "../gen/generate-map";
import { DEFAULT_GEN, GEN_SLIDERS, type GenParams } from "../gen/params";
import { createGrid, type Grid } from "../grid";

/** The sizes on offer, in tiles across. */
const SIZES: [number, string][] = [[48, "Small"], [64, "Medium"], [96, "Large"]];

/** The few settings worth a plain control, and how to say their values. */
const PLAIN: { key: keyof GenParams; label: string; words: (v: number) => string }[] = [
  { key: "relief", label: "Hills", words: (v) => (v <= 4 ? "Flat" : v <= 14 ? "Rolling" : v <= 26 ? "Hilly" : "Mountainous") },
  { key: "rivers", label: "Rivers", words: (v) => (v === 0 ? "None" : `${v}`) },
  { key: "lakes", label: "Lakes", words: (v) => (v === 0 ? "None" : `${v}`) },
  { key: "trees", label: "Woods", words: (v) => (v < 0.05 ? "None" : v < 0.2 ? "Sparse" : v < 0.4 ? "Some" : "Dense") },
];

const GROUPS: [string, string][] = [
  ["map", "Map"], ["land", "Land"], ["road", "Road"], ["water", "Water"], ["cover", "Ground cover"],
];

const randomSeed = () => Math.floor(Math.random() * 0x7fffffff);

/** Generate a map just as the game will, into a grid of its own. */
function generate(seed: number, params: GenParams): { grid: Grid; report: GenReport } {
  const grid = createGrid(params.size, params.size);
  const report = generatePlayableMap(grid, { seed, material: GRASS, dirt: DIRT, sand: SAND, woods: WOODS, params });
  return { grid, report };
}

/** A terrain material's colour, from above. */
function groundColour(material: number): [number, number, number] {
  if (material === DIRT) return [176, 138, 90];
  if (material === SAND) return [227, 210, 155];
  const wood = (WOODS as readonly number[]).indexOf(material);
  if (wood >= 0) return [[86, 140, 70], [66, 120, 58], [50, 98, 48]][wood] as [number, number, number];
  return [123, 182, 97];
}

/**
 * The map from above, as a diamond the way the game draws it, shaded as if
 * lit from the top left so the hills read, with its water and its road.
 */
function drawPreview(cv: HTMLCanvasElement, g: Grid, px: number): void {
  const w = px, h = px / 2;
  cv.width = Math.round(w + 8);
  cv.height = Math.round(h + 8);
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const k = w / (g.w + g.h);
  const at = (i: number) => g.height[i];
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const i = y * g.w + x;
      let [r, gr, b] = groundColour(g.terrain[i]);
      // Lit from the top left: brighter facing it, darker facing away.
      const west = x > 0 ? at(i - 1) : at(i), north = y > 0 ? at(i - g.w) : at(i);
      const slope = (at(i) - west) + (at(i) - north);
      const lift = Math.max(-40, Math.min(40, slope * 9)) + (at(i) - g.minHeight) * 0.8;
      if (g.pool[i] > 0) {
        const deep = Math.min(1, g.pool[i] / 8);
        [r, gr, b] = [70 - 30 * deep, 140 - 40 * deep, 200 - 30 * deep];
      } else if (g.paved[i] !== 0) {
        [r, gr, b] = [96, 100, 108];
      } else {
        r += lift; gr += lift; b += lift;
      }
      ctx.fillStyle = `rgb(${r | 0},${gr | 0},${b | 0})`;
      // The cell's diamond: x runs down to the right, y down to the left.
      const cx = 4 + (x - y + g.h) * k, cy = 4 + (x + y) * (k / 2);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + k, cy + k / 2);
      ctx.lineTo(cx, cy + k);
      ctx.lineTo(cx - k, cy + k / 2);
      ctx.closePath();
      ctx.fill();
    }
  }
}

export type MapSetupProps = {
  /** Who is founding, for the heading. */
  founder: string;
  onBack: () => void;
  /** Found the company on this land. */
  onFound: (choice: { seed: number; params: GenParams }) => void;
};

export default function MapSetup({ founder, onBack, onFound }: MapSetupProps) {
  const [seed, setSeed] = useState(randomSeed);
  const [params, setParams] = useState<GenParams>({ ...DEFAULT_GEN });
  const [map, setMap] = useState<{ grid: Grid; report: GenReport } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  // Generated a moment after the last change, so dragging a slider does not
  // queue a map for every pixel it passes.
  useEffect(() => {
    const id = setTimeout(() => setMap(generate(seed, params)), 120);
    return () => clearTimeout(id);
  }, [seed, params]);
  useEffect(() => {
    if (map && canvas.current) drawPreview(canvas.current, map.grid, 520);
  }, [map]);

  const set = (key: keyof GenParams, v: number) => setParams((p) => ({ ...p, [key]: v }));
  const slider = (key: keyof GenParams) => GEN_SLIDERS.find((s) => s.key === key)!;
  const stats = useMemo(() => {
    if (!map) return null;
    let water = 0;
    for (let i = 0; i < map.grid.pool.length; i++) if (map.grid.pool[i] > 0) water++;
    return { plots: map.report.frontage, road: map.report.road, water };
  }, [map]);

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-primary-100 px-6 py-8 text-primary-900 dark:bg-primary-900 dark:text-primary-50">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold sm:text-4xl">Choose your land</h1>
        <p className="mt-2 text-sm opacity-70">Where will {founder} found the company?</p>
      </div>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 lg:flex-row">
        {/* THE PREVIEW */}
        <div className="flex flex-1 flex-col items-center gap-3">
          <div className="relative flex min-h-[290px] w-full items-center justify-center border border-primary-300 bg-primary-200/60 p-3 dark:border-primary-700 dark:bg-primary-800/40">
            <canvas ref={canvas} className="h-auto max-w-full" />
            {!map && <span className="absolute text-sm opacity-60">Surveying…</span>}
          </div>
          {stats && (
            <div className="flex gap-6 text-xs tabular-nums opacity-80">
              <span><b>{stats.plots}</b> building plots by the road</span>
              <span><b>{stats.road}</b> road tiles</span>
              <span><b>{stats.water}</b> tiles of water</span>
            </div>
          )}
        </div>

        {/* THE CHOICES */}
        <div className="flex w-full flex-col gap-4 lg:w-80">
          <div className="flex items-center gap-2">
            <Button type="button" className="flex-1 py-2 font-bold" onClick={() => setSeed(randomSeed())}>
              🎲 New land
            </Button>
            <input
              aria-label="Seed"
              title="The seed: the same seed and settings always give the same land"
              className="w-28 border border-primary-300 bg-primary-50 px-2 py-2 text-xs tabular-nums dark:border-primary-700 dark:bg-primary-800"
              value={seed}
              onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) setSeed(Math.floor(Math.abs(n))); }}
            />
          </div>

          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wide opacity-60">Size</p>
            <div className="flex gap-1">
              {SIZES.map(([n, name]) => (
                <button key={n} type="button" onClick={() => set("size", n)}
                  className={twMerge(
                    "flex-1 cursor-pointer border border-primary-300 px-2 py-1.5 text-sm dark:border-primary-700",
                    params.size === n ? "bg-primary-300 font-bold dark:bg-primary-700" : "hover:bg-primary-200 dark:hover:bg-primary-800",
                  )}>
                  {name}
                  <span className="ml-1 text-[10px] opacity-60">{n}×{n}</span>
                </button>
              ))}
            </div>
          </div>

          {PLAIN.map(({ key, label, words }) => {
            const s = slider(key);
            return (
              <label key={key} className="block" title={s.hint}>
                <span className="flex justify-between text-xs">
                  <span className="font-bold uppercase tracking-wide opacity-60">{label}</span>
                  <span>{words(params[key])}</span>
                </span>
                <input type="range" className="w-full accent-emerald-600 dark:accent-emerald-400"
                  min={s.min} max={s.max} step={s.step} value={params[key]}
                  onChange={(e) => set(key, Number(e.target.value))} />
              </label>
            );
          })}

          <details className="border border-primary-300 p-2 text-xs dark:border-primary-700">
            <summary className="cursor-pointer font-bold">All settings</summary>
            {GROUPS.map(([group, name]) => (
              <fieldset key={group} className="mt-2">
                <legend className="font-bold uppercase tracking-wide opacity-60">{name}</legend>
                {GEN_SLIDERS.filter((s) => s.group === group && s.key !== "size").map((s) => (
                  <label key={s.key} className="mt-1 grid grid-cols-[6rem_1fr_2.5rem] items-center gap-2" title={s.hint}>
                    <span className="truncate">{s.label}</span>
                    <input type="range" className="accent-emerald-600 dark:accent-emerald-400"
                      min={s.min} max={s.max} step={s.step} value={params[s.key]}
                      onChange={(e) => set(s.key, Number(e.target.value))} />
                    <span className="text-right tabular-nums">{params[s.key]}</span>
                  </label>
                ))}
              </fieldset>
            ))}
            <button type="button" className="mt-3 cursor-pointer underline opacity-70"
              onClick={() => setParams({ ...DEFAULT_GEN, size: params.size })}>
              Back to the usual settings
            </button>
          </details>

          <div className="mt-auto flex gap-2 pt-2">
            <Button type="button" className="px-4 py-3" onClick={onBack}>← Back</Button>
            <Button type="button" className="flex-1 px-4 py-3 text-base font-bold disabled:opacity-40"
              disabled={!map}
              // The REPORTED seed: the generator rerolls a map with too little
              // to build on, and the one shown is the one to make again.
              onClick={() => map && onFound({ seed: map.report.seed, params })}>
              Found here →
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
