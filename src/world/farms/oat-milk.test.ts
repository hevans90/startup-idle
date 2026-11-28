import { beforeEach, describe, expect, test } from "bun:test";

import { CAFE_BOOST, CAFE_REACH, deskPerks } from "../agents/desk-perks";
import { createGrid, type Grid, type Structure } from "../grid";
import { CAFE_HOLDS, OAT_BOOST, OAT_REACH, SILO_CAP, UNIT_SECONDS, cafeStock, dairy, delivered, harvestMilk, newDairy, pickCafe, useStock } from "./oat-milk";

/** OAT MILK: a unit a field into the silo, a van a unit, a café's stock used a season at a time. @see oat-milk */
const noLead = { of: new Map(), leads: new Map() };
function add(g: Grid, s: Structure) { g.structures.set(s.id, s); return s; }

beforeEach(() => { dairy.silo.clear(); dairy.stock.clear(); dairy.vans.clear(); });

describe("the silo", () => {
  test("a unit a field, up to the cap", () => {
    const D = newDairy();
    expect(harvestMilk(D, 1, 30)).toBe(30);
    expect(harvestMilk(D, 1, 45)).toBe(SILO_CAP - 30);
    expect(D.silo.get(1)).toBe(SILO_CAP);
  });
});

describe("deliveries", () => {
  test("to the café with the least in stock and coming; none to one that is full", () => {
    expect(pickCafe([{ id: 1, stock: 2, coming: 0 }, { id: 2, stock: 0.5, coming: 1 }, { id: 3, stock: 1, coming: 0 }])).toBe(3);
    expect(pickCafe([{ id: 1, stock: CAFE_HOLDS, coming: 0 }, { id: 2, stock: 2, coming: 1 }])).toBeNull();
    expect(pickCafe([])).toBeNull();
  });

  test("a café holds three, uses one a season, and runs out", () => {
    const g = createGrid(8, 8), D = newDairy();
    add(g, { id: 5, def: "cafe", x: 1, y: 1, w: 1, h: 1 });
    for (let k = 0; k < 5; k++) delivered(D, 5);
    expect(cafeStock(D, 5)).toBe(CAFE_HOLDS);
    useStock(D, g, UNIT_SECONDS);
    expect(cafeStock(D, 5)).toBeCloseTo(CAFE_HOLDS - 1);
    useStock(D, g, 2 * UNIT_SECONDS);
    expect(cafeStock(D, 5)).toBe(0);
    expect(D.stock.has(5)).toBe(false);
  });
});

describe("oat flat whites", () => {
  test("a stocked café works the desks harder, and further off", () => {
    const g = createGrid(24, 24);
    const cafe = add(g, { id: 1, def: "cafe", x: 2, y: 2, w: 1, h: 1 });
    // An office just past plain coffee's reach, inside oat milk's.
    const office = add(g, { id: 2, def: "office.vibe", x: 2 + CAFE_REACH + 1, y: 2, w: 1, h: 1 });
    expect(OAT_REACH).toBeGreaterThan(CAFE_REACH);
    expect(deskPerks(g, noLead, office).share).toBe(0);
    delivered(dairy, cafe.id);
    const p = deskPerks(g, noLead, office);
    expect(p.share).toBe(OAT_BOOST);
    expect(p.why).toContain(`Oat flat whites · +${Math.round(OAT_BOOST * 100)}%`);
    // Run dry: plain coffee, and only near.
    dairy.stock.clear();
    const near = add(g, { id: 3, def: "office.vibe", x: 3, y: 2, w: 1, h: 1 });
    expect(deskPerks(g, noLead, near).share).toBe(CAFE_BOOST);
  });
});
