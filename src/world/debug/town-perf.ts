/**
 * `window.__townPerf()` in development: what a TOWN costs a frame, measured
 * on real frames in the play view — the scene the engine's phases are judged
 * against (`/?fixture=bigtown&crowd=2000`). @see plans/engine-polish.md
 *
 * For each zoom it centres the map, lets the frame settle, then averages the
 * meter's rolling numbers over a few seconds: the frame, the javascript and
 * its parts, draw calls and Graphics redrawn, and the GPU's passes where the
 * device can time them. Real frames, not a bench: the town's ticks only run
 * on the ticker. So the page HAS TO BE IN FRONT — a hidden one is throttled, and it refuses rather than report that. A slow one in front is
 * reported, slow. @see perfRead
 */
import { useWorldStore, getTown } from "../../state/world.store";
import { cellToWorld } from "../iso";
import { perfRead, type PerfRead } from "./perf";
import { stampsNow } from "./gpu-stamps";

export type TownPerfRow = PerfRead & { zoom: number; movers: number; gpu: Record<string, number> | null };
export type TownPerfReport = { ok: boolean; why: string | null; structures: number; rows: TownPerfRow[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Frames the browser gives a second, measured over `ms`. */
async function framesIn(ms: number): Promise<number> {
  let n = 0;
  const t0 = performance.now();
  await new Promise<void>((done) => {
    const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else done(); };
    requestAnimationFrame(f);
  });
  return (n * 1000) / ms;
}

export async function runTownPerf(
  { zooms = [0.25, 1, 3], settle = 1500, sample = 3000 }: { zooms?: number[]; settle?: number; sample?: number } = {},
): Promise<TownPerfReport> {
  const st = useWorldStore.getState();
  const vp = st.viewport;
  const empty = (why: string): TownPerfReport => ({ ok: false, why, structures: st.grid.structures.size, rows: [] });
  if (!vp) return empty("no map on screen");
  // HIDDEN, the browser throttles the frames and nothing here would mean
  // anything. (Not focus: the console it is run from has that.) A page in
  // front that is slow is the finding, not a reason to refuse. @see perfRead
  if (document.hidden) return empty("the page is hidden: the browser throttles its frames, so nothing here would mean anything — bring it to the front and run again");
  const fps = await framesIn(500);
  const g = st.grid;
  const { wx, wy } = cellToWorld(g.w / 2, g.h / 2, 0, st.scale);
  const rows: TownPerfRow[] = [];
  for (const zoom of zooms) {
    vp.plugins.remove("animate");
    vp.setZoom(zoom, true);
    vp.moveCenter(wx, wy);
    await sleep(settle);
    stampsNow()?.reset();
    const reads: PerfRead[] = [];
    for (let t = 0; t < sample; t += 250) { await sleep(250); reads.push(perfRead()); }
    const mean = Object.fromEntries(
      (Object.keys(reads[0]) as (keyof PerfRead)[]).map((k) => [k, Math.round((reads.reduce((a, r) => a + r[k], 0) / reads.length) * 100) / 100]),
    ) as PerfRead;
    const gpu = stampsNow()?.says() ?? null;
    rows.push({ ...mean, zoom, movers: getTown().movers.length, gpu: gpu ? { total: Math.round(gpu.total * 100) / 100, ...gpu.of } : null });
  }
  return { ok: true, why: fps < 30 ? `slow: ${fps.toFixed(0)} frames a second before measuring` : null, structures: g.structures.size, rows };
}

if (import.meta.env?.DEV && typeof window !== "undefined") {
  (window as unknown as { __townPerf?: typeof runTownPerf }).__townPerf = runTownPerf;
}
