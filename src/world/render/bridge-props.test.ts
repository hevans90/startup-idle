import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import { createGrid, fillTerrain, idx, type Grid } from "../grid";
import { BENT_UNDER, BRIDGE, HS, RIB_CROWN, RIB_FOOT } from "../props/bridges";
import { bridgePiecesOf, bridgesOf, kindOf, springsOf, towersOf, type BridgeKind } from "./bridge-props";

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

  test("a girder's piers: where two of its arches meet, the same tiles across its width, none under its ends; each from the ground up to the deck, in the order it is drawn", () => {
    const g = bridged(10), pieces = bridgePiecesOf(g, () => 2, "girder");
    const caps = pieces.filter((p) => p.id === "girderCap");
    const ys = [...new Set(caps.map((p) => p.y))].sort((a, b) => a - b);
    expect(ys).toEqual(springsOf(14).slice(1, -1).map((k) => 6 + k));
    expect(ys).toEqual([9, 11, 14, 16]);
    for (const y of ys) expect(caps.filter((p) => p.y === y).map((p) => p.x).sort()).toEqual([10, 11]);
    const mine = pieces.filter((p) => p.x === 10 && p.y === 9 && p.tier === "under");
    expect(mine[0]).toMatchObject({ id: "girderFoot", z: 0 });
    expect(mine[mine.length - 1]).toMatchObject({ id: "girderCap", z: 10 });
    const shafts = mine.filter((p) => p.id === "girderShaft");
    shafts.forEach((p, k) => { if (k) expect(p.z - shafts[k - 1].z).toBeCloseTo(1, 9); });
    expect(shafts[shafts.length - 1].z).toBeGreaterThanOrEqual(10 - 3.5 / 2.268);
    expect(shafts[shafts.length - 1].z).toBeLessThan(10);
  });

  test("a viaduct has a pier between every arch and the next; a timber bridge a pier where its trusses meet; a truss its bracing over every tile", () => {
    const g = bridged(10);
    const arch = bridgePiecesOf(g, () => 2, "arch");
    expect(arch.filter((p) => p.id === "archSide").length).toBe(14);
    expect(new Set(arch.filter((p) => p.id === "archHead").map((p) => p.y)).size).toBe(13);
    // A timber pier where two of its trusses meet, across its width, none under its ends: each whole, made to the nearest
    // half step and drawn the little taller or shorter that reaches from the water to the beams exactly.
    const piers = bridgePiecesOf(g, () => 2, "trestle").filter((p) => /^timberPier\d+$/.test(p.id));
    expect([...new Set(piers.map((p) => p.y))].sort((a, b) => a - b)).toEqual(springsOf(14).slice(1, -1).map((k) => 6 + k));
    expect(piers.length).toBe(8);
    for (const p of piers) {
      const n = Number(p.id.slice(10)), need = 10 - BENT_UNDER / HS;
      expect(p).toMatchObject({ z: 0, tier: "under" });
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

  test("every kind stands over the road as well as under it: arches over a girder, tile for tile, meeting where they spring; king posts along a timber bridge; gate towers on a viaduct's piers", () => {
    // Arches of two or three tiles (one, over a bridge of two) from the first tile's middle to the last's.
    for (let len = 2; len <= 30; len++) {
      const s = springsOf(len);
      expect([s[0], s[s.length - 1]]).toEqual([0, len - 1]);
      for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeGreaterThanOrEqual(len === 2 ? 1 : 2), expect(s[i] - s[i - 1]).toBeLessThanOrEqual(3);
    }
    const g = bridged(10), girder = bridgePiecesOf(g, () => 2, "girder"), s = springsOf(14);
    for (const [x, turn] of [[11, 3], [10, 1]]) for (let k = 0; k < 14; k++) {
      const bows = girder.filter((p) => p.x === x && p.y === 6 + k && p.turn === turn && /^bow\d/.test(p.id)).map((p) => p.id).sort();
      const at = s.indexOf(k);
      if (at < 0) { expect(bows.length).toBe(1); expect(bows[0]).toMatch(/^bow(2M|3M[AB])$/); continue; }
      // Where two meet: the end of one and the start of the next, one each way; at the bridge's ends, the one.
      expect(bows.length).toBe(at === 0 || at === s.length - 1 ? 1 : 2);
      if (bows.length === 2) expect(bows[0].slice(-1)).not.toBe(bows[1].slice(-1));
    }
    // Either side of an arch's middle tiles, its rise and its fall: not the same piece twice.
    const mids = girder.filter((p) => p.x === 11 && p.turn === 3 && /^bow3M/.test(p.id)).sort((a, b) => a.y - b.y);
    for (let i = 0; i + 1 < mids.length; i += 2) expect(mids[i].id).not.toBe(mids[i + 1].id);
    // The two edges mirror each other: a piece turned about is its other hand.
    const hand = (x: number, turn: number, y: number) => girder.find((p) => p.x === x && p.turn === turn && p.y === y && /^bow\d[AB]$/.test(p.id))!.id.slice(-1);
    expect(hand(11, 3, 6)).not.toBe(hand(10, 1, 6));
    expect(girder.filter((p) => /^bowBrace/.test(p.id)).length).toBe(2 * (14 - s.length));

    // WHAT STANDS OVER IT STANDS ON WHAT IS UNDER IT. A girder's arch springs from a seat at each edge over each pier —
    // the pier's concrete brought up where the edge shows it; a timber truss's feet are over the timber piers.
    const seats = girder.filter((p) => /^bowSeat/.test(p.id));
    expect([...new Set(seats.map((p) => p.y))].sort((a, b) => a - b)).toEqual(s.map((k) => 6 + k));
    for (const p of seats) expect(p.id).toBe(p.x === 11 && p.y !== 6 && p.y !== 19 ? "bowSeat" : "bowSeatFar");
    const low = bridged(6, 1), timber = bridgePiecesOf(low, () => 2, "trestle");
    const feet = timber.filter((p) => /^kp\d[AB]$/.test(p.id)), kps = timber.filter((p) => /^kp\d/.test(p.id));
    expect(new Set(kps.map((p) => p.y)).size).toBe(14);
    expect(kps.filter((p) => p.tier === "front").length).toBe(kps.length / 2);
    expect([...new Set(feet.map((p) => p.y))].sort((a, b) => a - b)).toEqual(s.map((k) => 6 + k));
    expect(new Set(timber.filter((p) => /^timberPier/.test(p.id)).map((p) => p.y))).toEqual(new Set(s.slice(1, -1).map((k) => 6 + k)));

    // A gate tower: a turret on the pier at each edge, the gate between them — whole over one lane, in halves over two.
    for (let len = 2; len <= 30; len++) for (const k of towersOf(len)) { expect(k).toBeGreaterThanOrEqual(1); expect(k).toBeLessThanOrEqual(len - 1); }
    expect(towersOf(1)).toEqual([]);
    expect(towersOf(14)).toEqual([1, 5, 9, 13]);
    const two = bridgePiecesOf(g, () => 2, "arch"), one = bridgePiecesOf(bridged(10, 1), () => 2, "arch");
    for (const [ps, wide] of [[two, 2], [one, 1]] as const) {
      const turrets = ps.filter((p) => /^archTower(Far)?$/.test(p.id));
      expect(turrets.length).toBe(8);
      expect([...new Set(turrets.map((p) => p.y))].sort((a, b) => a - b)).toEqual([6.5, 10.5, 14.5, 18.5]);
      // Each turret that shows its foot has the pier's stone under it, down to the water.
      const shafts = ps.filter((p) => p.id === "archTowerShaft" && p.tier === "under");
      expect(new Set(shafts.map((p) => p.y))).toEqual(new Set([6.5, 10.5, 14.5, 18.5]));
      for (const p of shafts) { expect(p.tier).toBe("under"); expect(p.z).toBeGreaterThan(0); expect(p.z).toBeLessThanOrEqual(10 - 6.6 / HS + 1e-9); }
      expect(ps.filter((p) => p.id === "archGateHalf").length).toBe(wide === 2 ? 8 : 0);
      expect(ps.filter((p) => p.id === "archGate").length).toBe(wide === 1 ? 4 : 0);
      for (const p of ps.filter((q) => /^archGate/.test(q.id))) expect(p.tier).toBe("front");
    }
  });

  test("between its piers, under the deck: a timber bridge's braced frame, a girder's and a truss's arch ribs — along the edge that shows, tile for tile, and fitted to the room over the water", () => {
    const s = springsOf(14);
    for (const [kind, name] of [["trestle", "frame"], ["girder", "rib"], ["truss", "ribR"]] as const) {
      const ps = bridgePiecesOf(bridged(10), () => 2, kind).filter((p) => new RegExp(`^${name}\\d`).test(p.id));
      // Only along the near edge, in front; every tile of it; two where two spans meet.
      for (const p of ps) expect(p).toMatchObject({ x: 11, turn: 3, tier: "front" });
      for (let k = 0; k < 14; k++) expect(ps.filter((p) => p.y === 6 + k).length).toBe(s.includes(k) && k > 0 && k < 13 ? 2 : 1);
    }
    // A truss's piers are where its ribs spring, as a girder's are.
    const truss = bridgePiecesOf(bridged(10), () => 2, "truss");
    expect([...new Set(truss.filter((p) => p.id === "girderCap").map((p) => p.y))].sort((a, b) => a - b)).toEqual(s.slice(1, -1).map((k) => 6 + k));
    expect(truss.filter((p) => p.id === "ribWall").length).toBe(8);
    // A RIB'S CROWN STAYS under the deck and its feet stay over the water, however much room there is.
    for (const up of [5, 6, 8, 12, 20]) for (const [kind, name] of [["girder", "rib"], ["truss", "ribR"]] as const) {
      const rib = bridgePiecesOf(bridged(up), () => 2, kind).find((p) => p.id.startsWith(`${name}3A`) || p.id.startsWith(`${name}2A`))!;
      const fit = rib.stretch ?? 1, crown = rib.z - (fit * RIB_CROWN[name]) / HS, foot = rib.z - (fit * RIB_FOOT) / HS;
      expect(crown).toBeCloseTo(up - RIB_CROWN[name] / HS, 9);
      expect(foot).toBeGreaterThanOrEqual(2 + 1.2 / HS - 1e-9);
      expect(fit).toBeLessThanOrEqual(1);
      expect(fit).toBeGreaterThanOrEqual(0.45);
    }
    // A low timber bridge has the shallow frame; one too low, none.
    expect(bridgePiecesOf(bridged(4, 1), () => 2, "trestle").some((p) => /^frameLow\d/.test(p.id))).toBe(true);
    expect(bridgePiecesOf(bridged(3, 1), () => 2, "trestle").some((p) => /^frame/.test(p.id))).toBe(false);
  });

  test("where a bridge meets the bank, on the land's tiles and not its own: an abutment under each end of the deck, a wing wall along the bank each side where the ground falls away, the rail run on a tile along the road to a pier", () => {
    const FACE = { arch: "Stone", trestle: "Timber", girder: "Concrete", truss: "Concrete", stay: "Concrete" } as const;
    for (const kind of KINDS) {
      // A bank: the ground at the deck's level everywhere but under the bridge and beside it.
      const g = bridged(10);
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (y < 6 || y > 19) g.height[idx(g, x, y)] = 10;
      const ps = bridgePiecesOf(g, () => 2, kind), F = FACE[kind];
      // An abutment's head per lane at each end, on the line between the last tile of deck and the land; under it, the wall down to the water.
      const heads = ps.filter((p) => p.id === `abut${F}`);
      expect(heads.map((p) => p.y).sort((a, b) => a - b)).toEqual([5.5, 5.5, 19.5, 19.5]);
      for (const p of heads) expect(p).toMatchObject({ tier: "under", z: 10 });
      expect(ps.filter((p) => p.id === `abut${F}Shaft` && p.tier === "under").every((p) => p.z > 0 && p.z < 10)).toBe(true);
      expect(ps.filter((p) => p.id === `abut${F}Shaft` && p.tier === "under").length).toBeGreaterThanOrEqual(4 * 6);
      // A wing each side of each end — the outer side of each lane, none between the two lanes.
      const wings = ps.filter((p) => p.id === `wing${F}`);
      expect(wings.length).toBe(4);
      expect(new Set(wings.map((p) => `${p.x},${p.y},${p.turn}`)).size).toBe(4);
      // On the land: a tile of rail each side of the road at each end, and a pier where it stops.
      const land = ps.filter((p) => p.y === 5 || p.y === 20);
      expect(land.length).toBe(4);
      for (const p of land) expect(p.id).not.toMatch(/Edge|Near|Side/);
      expect(ps.filter((p) => p.id === `end${F}`).length).toBe(4);
      for (const p of ps.filter((q) => q.id === `end${F}`)) expect(p.y < 6 || p.y > 19).toBe(true);
    }
    // Low ground at the deck's end: no bank there to build into, and nothing is.
    const flat = bridgePiecesOf(bridged(10), () => 2, "girder");
    expect(flat.some((p) => /^(abut|wing)/.test(p.id))).toBe(false);
    // A road that climbs to the bridge has no rail run on along it.
    expect(flat.some((p) => /^end/.test(p.id))).toBe(false);
  });

  test("what is under a deck stands on the ground, whatever the water: its piers and its bank's walls are the same in a drought and a flood, footed on the bed; only what hangs between the piers is fitted to the room over the water", () => {
    for (const kind of KINDS) {
      const g = bridged(10);
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (y < 6 || y > 19) g.height[idx(g, x, y)] = 10;
      const hung = (p: { id: string }) => /^(rib|frame)/.test(p.id);
      const at = (d: number) => bridgePiecesOf(g, () => d, kind).filter((p) => p.tier === "under" && !hung(p)).map((p) => `${p.id}@${p.x},${p.y},${p.z}`).sort();
      expect(at(0).length).toBeGreaterThan(0);
      expect(at(5)).toEqual(at(0));
      expect(at(8)).toEqual(at(0));
      // Every footing is on the ground, and every wall at a bank goes down to it.
      const ps = bridgePiecesOf(g, () => 5, kind);
      for (const p of ps.filter((q) => /Foot$|^timberPier/.test(q.id))) expect(p.z).toBe(0);
      const walls = ps.filter((p) => /^abut\w+Shaft$/.test(p.id)).map((p) => p.z);
      expect(Math.min(...walls)).toBeLessThanOrEqual(1);
    }
    // A flood to under the deck: nothing is hung between the piers that would be in it.
    for (const kind of ["girder", "truss", "trestle"] as const) expect(bridgePiecesOf(bridged(10), () => 9, kind).some((p) => /^(rib|frame)/.test(p.id))).toBe(false);
  });

  test("a street that crosses aslant is a staircase of deck: what runs along it runs whole along each straight length of its edge, its piers along each straight row, and it is not a kind that needs a rectangle", () => {
    // Three rows of deck over x = 4…15, each a step along from the last: rows at y = 10, 11, 12.
    const g = createGrid(24, 24); fillTerrain(g, 1);
    const rows: [number, number, number][] = [[10, 4, 9], [11, 4, 15], [12, 10, 15]];
    for (const [y, x0, x1] of rows) for (let x = x0; x <= x1; x++) { const i = idx(g, x, y); g.paved[i] = 1; g.deck[i] = 1; g.deckZ[i] = 8; }
    // The road onto it at each end, on a bank at its level.
    for (const [x, y] of [[2, 10], [3, 10], [2, 11], [3, 11], [16, 11], [17, 11], [16, 12], [17, 12]]) { const i = idx(g, x, y); g.paved[i] = 1; g.height[i] = 8; }
    const [B] = bridgesOf(g);
    expect(B).toMatchObject({ rect: false, len: 12, alongX: true });
    for (let k = 0; k < 60; k++) expect(["truss", "stay"]).not.toContain(kindOf({ ...B, cells: [k * 31 + 7] }));
    for (const [kind, P] of [["girder", "bow"], ["trestle", "kp"]] as const) {
      const ps = bridgePiecesOf(g, () => 2, kind).filter((p) => new RegExp(`^${P}\\d`).test(p.id));
      // The near edge (+y): row 12 over x = 10…15, and row 11 over x = 4…9 where row 12 is not beside it. Each its own whole run.
      for (const [y, x0, x1] of [[12, 10, 15], [11, 4, 9]] as const) {
        const edge = ps.filter((p) => p.y === y && p.turn === 0), s = springsOf(x1 - x0 + 1);
        for (let x = x0; x <= x1; x++) {
          const here = edge.filter((p) => p.x === x), k = x - x0, at = s.indexOf(k);
          expect({ kind, y, x, n: here.length }).toEqual({ kind, y, x, n: at < 0 ? 1 : at === 0 || at === s.length - 1 ? 1 : 2 });
          // At each end of the run, a half that rises away from the end: never an arch cut off in the air.
          if (k === 0 || k === x1 - x0) expect(here[0].id).toMatch(/^[a-z]+\d[AB]$/);
        }
        expect(edge.filter((p) => p.x < x0 || p.x > x1).length).toBe(0);
      }
    }
    // Its piers: along each row by that row's own length, none under a row's ends.
    const caps = bridgePiecesOf(g, () => 2, "girder").filter((p) => p.id === "girderCap");
    for (const [y, x0, x1] of rows) expect(caps.filter((p) => p.y === y).map((p) => p.x).sort((a, b) => a - b)).toEqual(springsOf(x1 - x0 + 1).slice(1, -1).map((k) => x0 + k));
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
      const low = bridgePiecesOf(bridged(1), undefined, kind);
      expect(low.some((p) => p.tier === "under")).toBe(false);
      expect(low.filter((p) => p.tier === "front" && p.turn === 3).length).toBeGreaterThanOrEqual(14);
    }
    const g0 = createGrid(8, 8); fillTerrain(g0, 1);
    for (let x = 0; x < 8; x++) g0.paved[idx(g0, x, 4)] = 1;
    expect(bridgePiecesOf(g0)).toEqual([]);
  });
});
