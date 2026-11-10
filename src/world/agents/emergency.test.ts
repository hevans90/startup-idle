import { describe, expect, test } from "bun:test";

import { burn, damage, damagedNow, stepRepairs } from "../events/damage";
import { createNetwork } from "../roads/network";
import { modelFor } from "./cars/fleet";
import { createEmergency, flashing, stepEmergency } from "./emergency";
import { crossroads, overlap } from "./lanes/traffic.test-kit";
import { createTown, setTownCaps, stepTown, townCaps, type Mover } from "./town";

/** A busy town, a building in it damaged, and `secs` of the services answering. */
function call(kx: number, ky: number, cause: "fire" | "quake", secs: number) {
  const caps = { ...townCaps };
  setTownCaps({ cars: 60, people: 0, every: 1 });
  const g = crossroads(kx, ky);
  const net = createNetwork(g), t = createTown(), e = createEmergency();
  const dt = 1 / 20;
  // The traffic up to speed first.
  for (let k = 0; k < 40 / dt; k++) stepTown(t, g, net, 0, dt);
  const [site] = [...g.structures.values()].filter((s) => s.x > 26).sort((a, b) => a.x - b.x);
  if (cause === "fire") burn(g, [site.id]); else damage(g, [site.id], "quake");
  const seen = new Map<number, Mover>(), out = { overlaps: 0, gone: 0, pulled: 0, atScene: 0, home: 0, flashed: 0 };
  for (let k = 0; k < secs / dt; k++) {
    const before = new Map(t.movers.map((m) => [m.id, m]));
    stepTown(t, g, net, 0, dt);
    stepEmergency(e, t, g, damagedNow(), dt);
    t.arrived.length = 0;
    const after = new Set(t.movers.map((m) => m.id));
    for (const [id, m] of before) if (!after.has(id) && m.gone) out.gone++;
    for (const m of t.movers) {
      if (m.siren) {
        seen.set(m.id, m);
        if (flashing(m)) out.flashed++;
        if ((m.wait ?? 0) > 0) out.atScene++;
        if (m.job?.role === "emergency-back" && (m.wait ?? 0) <= 0 && m.speed > 0.5) out.home++;
      } else if ((m.side ?? 0) > 0.12) out.pulled++;
    }
    const cars = t.movers.filter((m) => m.kind !== "person");
    const on = (m: Mover) => m.x >= 0 && m.y >= 0 && m.x <= g.w - 1 && m.y <= g.h - 1;
    for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i], b = cars[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.8 && on(a) && on(b) && overlap(a, b)) out.overlaps++;
    }
  }
  // Mended at once, for the next test.
  stepRepairs(g, 1e6, false);
  setTownCaps(caps);
  return { ...out, services: [...new Set([...seen.values()].map((m) => modelFor(m)))].sort() };
}

describe("the emergency services", () => {
  test("a fire: a fire engine and the police, through the traffic pulled in for them, and home again", () => {
    const r = call(2, 2, "fire", 150);
    expect(r.services).toEqual(["fireEngine", "police"]);
    expect(r.flashed).toBeGreaterThan(0);
    expect(r.pulled).toBeGreaterThan(0);
    expect(r.atScene).toBeGreaterThan(0);
    expect(r.home).toBeGreaterThan(0);
    expect(r.overlaps).toBe(0);
    expect(r.gone).toBe(0);
  });

  test("a quake, on narrow streets: an ambulance gets there too, nobody pulling in where there is no room", () => {
    const r = call(1, 1, "quake", 150);
    expect(r.services).toEqual(["ambulance", "police"]);
    expect(r.pulled).toBe(0);
    expect(r.atScene).toBeGreaterThan(0);
    expect(r.overlaps).toBe(0);
    expect(r.gone).toBe(0);
  });
});
