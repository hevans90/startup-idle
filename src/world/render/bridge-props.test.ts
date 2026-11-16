import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { BENT_UNDER, BRIDGE, HS } from "../props/bridges";
import { PIER_EVERY, bridgePiecesOf, bridgesOf, kindOf, type BridgeKind } from "./bridge-props";

/** A road down x = 10… (`wide` of it) from y = 2 to `2 + len + 7`, the stretch from y = 6 of it, `len` long, a deck `up` half steps over the ground. */
function bridged(up: number, wide = 2, len = 14): Grid {
  const g = createGrid(30, 40); fillTerrain(g, 1);
  for (let y = 2; y <= 9 + len; y++) for (let j = 0; j < wide; j++) {
    const i = idx(g, 10 + j, y);
    g.paved[i] = 1;
    if (y >= 6 && y < 6 + len) { g.deck[i] = 1; g.deckZ[i] = up; }
  }
  return g;
}
const KINDS: BridgeKind[] = ["arch", "trestle", "girder", "truss", "stay"];
const baked = new Set(BRIDGE.map((p) => p.id));

describe("a bridge's pieces", () => {
  test("every kind: each open edge of the deck has its side — the full side where it faces the camera, what stands over the road where it faces away — and every piece is one that is baked", () => {
    const sheet = JSON.parse(readFileSync("public/isometric_assets/derived/props.json", "utf8")) as { props: Record<string, unknown[]> };
    for (const kind of KINDS) {
      const g = bridged(10), pieces = bridgePiecesOf(g, () => 2, kind);
      for (const p of pieces) { expect({ kind, id: p.id, known: baked.has(p.id) }).toEqual({ kind, id: p.id, known: true }); expect(sheet.props[p.id]?.length).toBe(4); }
      for (let y = 6; y < 20; y++) {
        // x = 11's outside (+x) faces the camera; x = 10's (−x) faces away.
        expect(pieces.filter((p) => p.x === 11 && p.y === y && p.tier === "front" && p.turn === 3).length).toBeGreaterThanOrEqual(1);
        expect(pieces.filter((p) => p.x === 10 && p.y === y && p.tier === "back" && p.turn === 1).length).toBeGreaterThanOrEqual(1);
        // Nothing along the line between its two lanes.
        expect(pieces.filter((p) => p.x === 10 && p.y === y && p.turn === 3 && p.tier !== "under").length).toBe(0);
      }
    }
  });

  test("a girder's piers: every third tile, the same tiles across its width, none under its ends; each from the waterline up to the deck, in the order it is drawn", () => {
    const g = bridged(10), pieces = bridgePiecesOf(g, () => 2, "girder");
    const caps = pieces.filter((p) => p.id === "girderCap");
    const ys = [...new Set(caps.map((p) => p.y))].sort((a, b) => a - b);
    expect(ys).toEqual([7, 10, 13, 16]);
    for (const y of ys) { expect(y % PIER_EVERY).toBe(1); expect(caps.filter((p) => p.y === y).map((p) => p.x).sort()).toEqual([10, 11]); }
    const mine = pieces.filter((p) => p.x === 10 && p.y === 10 && p.tier === "under");
    expect(mine[0]).toMatchObject({ id: "girderFoot", z: 2 });
    expect(mine[mine.length - 1]).toMatchObject({ id: "girderCap", z: 10 });
    const shafts = mine.filter((p) => p.id === "girderShaft");
    shafts.forEach((p, k) => { if (k) expect(p.z - shafts[k - 1].z).toBeCloseTo(1, 9); });
    expect(shafts[shafts.length - 1].z).toBeGreaterThanOrEqual(10 - 3.5 / 2.268);
    expect(shafts[shafts.length - 1].z).toBeLessThan(10);
  });

  test("a viaduct has a pier between every arch and the next; a timber bridge a pier under every other tile; a truss its bracing over every tile", () => {
    const g = bridged(10);
    const arch = bridgePiecesOf(g, () => 2, "arch");
    expect(arch.filter((p) => p.id === "archSide").length).toBe(14);
    expect(new Set(arch.filter((p) => p.id === "archHead").map((p) => p.y)).size).toBe(13);
    // A timber pier under every other tile, across its width, none under its ends: each whole, made to the nearest
    // half step and drawn the little taller or shorter that reaches from the water to the beams exactly.
    const piers = bridgePiecesOf(g, () => 2, "trestle").filter((p) => /^timberPier\d+$/.test(p.id));
    expect([...new Set(piers.map((p) => p.y))].sort((a, b) => a - b)).toEqual([8, 10, 12, 14, 16, 18]);
    expect(piers.length).toBe(12);
    for (const p of piers) {
      const n = Number(p.id.slice(10)), need = 10 - 2 - BENT_UNDER / HS;
      expect(p).toMatchObject({ z: 2, tier: "under" });
      expect(n * p.stretch!).toBeCloseTo(need, 9);
      expect(Math.abs(p.stretch! - 1)).toBeLessThan(0.1);
    }
    const truss = bridgePiecesOf(g, () => 2, "truss");
    expect(truss.filter((p) => p.id === "trussTop").length).toBe(28);
    expect(truss.filter((p) => p.id === "trussNear").length).toBe(14);
    expect(truss.filter((p) => p.id === "trussFar").length).toBe(14);
  });

  test("a cable-stayed bridge: a pylon every seventh tile with a pier under it and a beam across, its stays over the three tiles either side of it, nearer the pylon the more of them", () => {
    const g = bridged(10), stay = bridgePiecesOf(g, () => 2, "stay");
    const legs = stay.filter((p) => p.id === "pylonLeg" || p.id === "pylonLegFar");
    expect([...new Set(legs.map((p) => p.y))].sort((a, b) => a - b)).toEqual([9, 16]);
    expect(legs.length).toBe(4);
    expect(stay.filter((p) => p.id === "pylonBeam").length).toBe(4);
    expect(new Set(stay.filter((p) => p.id === "girderCap").map((p) => p.y))).toEqual(new Set([9, 16]));
    // The tile before a pylon and the tile after it carry the first stay's piece, the one each way.
    for (const y of [8, 10]) expect(stay.filter((p) => p.y === y && /^stay[AB]1$/.test(p.id)).length).toBe(2);
    const near = (y: number) => stay.find((p) => p.x === 11 && p.y === y && /^stay[AB]\d$/.test(p.id))!.id;
    expect(near(8)[4]).not.toBe(near(10)[4]);
    expect(near(12)).toMatch(/3$/);
  });

  test("what kind a bridge is: one its shape allows, and the same one every time", () => {
    for (const [wide, len, up] of [[1, 6, 4], [1, 12, 12], [2, 14, 10], [3, 12, 10], [4, 5, 8]]) {
      const g = bridged(up, wide, len), [b] = bridgesOf(g);
      expect(b).toMatchObject({ width: wide, len, alongX: false, room: up });
      expect(kindOf(b)).toBe(b.kind);
      if (b.kind === "trestle") expect(wide).toBe(1);
      if (b.kind === "arch") expect(wide).toBeLessThanOrEqual(2);
      if (b.kind === "stay") { expect(wide).toBeGreaterThanOrEqual(2); expect(len).toBeGreaterThanOrEqual(9); }
      if (b.kind === "truss") expect(len).toBeGreaterThanOrEqual(5);
    }
    // Across many places, more than one kind turns up for a bridge that could be several.
    const kinds = new Set<string>();
    for (let k = 0; k < 40; k++) kinds.add(kindOf({ len: 14, width: 2, room: 10, cells: [k * 37 + 5] }));
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  test("a deck too near the ground has sides and nothing under it; a road on the ground has neither", () => {
    for (const kind of ["girder", "truss", "stay"] as const) {
      const low = bridgePiecesOf(bridged(2), undefined, kind);
      expect(low.some((p) => p.tier === "under")).toBe(false);
      expect(low.filter((p) => p.tier === "front" && p.turn === 3).length).toBeGreaterThanOrEqual(14);
    }
    const g0 = createGrid(8, 8); fillTerrain(g0, 1);
    for (let x = 0; x < 8; x++) g0.paved[idx(g0, x, 4)] = 1;
    expect(bridgePiecesOf(g0)).toEqual([]);
  });
});
