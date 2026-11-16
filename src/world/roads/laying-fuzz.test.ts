/**
 * ROADS LAID AT RANDOM OVER GENERATED MAPS — hills, rivers, the streets and
 * bridges a map comes with — and after every stroke the tool takes, every
 * road cell looked at: none left that a ramp cannot serve, and no two side by
 * side that do not join, that were not so before. A stroke may be refused; it
 * may not lay a broken road.
 */
import { expect, test } from "bun:test";
import { useWorldStore } from "../../state/world.store";
import { idx, type Grid } from "../grid";
import { generateMap } from "../gen/generate-map";
import { connects, isPaved } from "./mask";
import { rampNeed } from "./ramp-derive";
const s = () => useWorldStore.getState();
const drag = (x0: number, y0: number, x1: number, y1: number) => { s().setTool("paintRoad"); s().setBrush("line"); useWorldStore.setState({ notice: null }); s().beginStroke({ x: x0, y: y0 }); s().updateStroke({ x: x1, y: y1 }); s().endStroke(); return s().notice?.text ?? ""; };
const faults = (G: Grid) => {
  const read = { inBounds: (x: number, y: number) => x >= 0 && y >= 0 && x < G.w && y < G.h, paved: (x: number, y: number) => isPaved(G, x, y), height: (x: number, y: number) => (G.deck[idx(G, x, y)] ? G.deckZ[idx(G, x, y)] : G.height[idx(G, x, y)]) };
  const out = new Set<string>();
  for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) {
    if (!isPaved(G, x, y)) continue;
    if (rampNeed(read, x, y).kind === "unbridgeable") out.add(`U${x},${y}`);
    if (x + 1 < G.w && isPaved(G, x + 1, y) && !connects(G, x, y, "S")) out.add(`X${x},${y}`);
    if (y + 1 < G.h && isPaved(G, x, y + 1) && !connects(G, x, y, "W")) out.add(`Y${x},${y}`);
  }
  return out;
};
test("a road stroke over any ground lays a sound road or none", () => {
  for (const start of [1, 2, 3]) {
  let seed = Number(process.env.FUZZ_SEED ?? start);
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = (n: number) => Math.floor(rnd() * n);
  let found = 0, strokes = 0, taken = 0; const refused: Record<string, number> = {};
  for (let m = 0; m < 12 && found < 6; m++) {
    s().resize(64, 64);
    const g = s().grid;
    generateMap(g, { seed: 100 + m * 7 + Number(process.env.FUZZ_SEED ?? start), material: 1, dirt: 2, sand: 3, woods: [4, 5, 6] });
    s().loadGrid(g);
    const G = s().grid;
    let before = faults(G);
    for (let k = 0; k < 60 && found < 6; k++) {
      const horiz = rnd() < 0.5, a = 2 + pick(60), b0 = 2 + pick(40), len = 4 + pick(30), b1 = Math.min(61, b0 + len);
      const st: [number, number, number, number] = horiz ? [b0, a, b1, a] : [a, b0, a, b1];
      const snap = { h: Array.from(G.height), p: Array.from(G.paved), d: Array.from(G.deck), dz: Array.from(G.deckZ), r: Array.from(G.ramp) };
      const said = drag(...st); strokes++;
      if (said) { refused[said.replace(/\d+/g, "N")] = (refused[said.replace(/\d+/g, "N")] ?? 0) + 1; continue; }
      taken++;
      const after = faults(G), fresh = [...after].filter((f) => !before.has(f));
      if (fresh.length) {
        found++;
        const xs = fresh.map((f) => Number(f.slice(1).split(",")[0])), ys = fresh.map((f) => Number(f.slice(1).split(",")[1]));
        const X0 = Math.max(0, Math.min(...xs) - 4), X1 = Math.min(63, Math.max(...xs) + 4), Y0 = Math.max(0, Math.min(...ys) - 3), Y1 = Math.min(63, Math.max(...ys) + 3);
        console.log(`MAP ${m} stroke ${st} -> ${fresh.join(" ")}`);
        for (let y = Y0; y <= Y1; y++) { let o = `${String(y).padStart(2)}: `; for (let x = X0; x <= X1; x++) { const i = idx(G, x, y); const was = snap.d[i] ? "D" + snap.dz[i] : snap.p[i] ? "P" + snap.h[i] + (snap.r[i] ? "r" : "") : "." + snap.h[i] + (G.pool[i] ? "~" : ""); const now = G.deck[i] ? "D" + G.deckZ[i] : G.paved[i] ? "P" + G.height[i] + (G.ramp[i] ? "r" : "") : "." + G.height[i] + (G.pool[i] ? "~" : ""); o += (was === now ? now : `${was}>${now}`).padEnd(11); } console.log(o + `  (x from ${X0})`); }
      }
      before = after;
    }
  }
  if (process.env.FUZZ_SEED) console.log("strokes", strokes, "faulty", found, "refused", JSON.stringify(refused));
  expect({ start, found }).toEqual({ start, found: 0 });
  // And it is not sound by refusing: most strokes that do not end in the water are laid.
  expect(taken / (strokes - (refused["A bridge runs straight, from dry ground to dry ground"] ?? 0))).toBeGreaterThan(0.75);
  }
}, 120_000);
