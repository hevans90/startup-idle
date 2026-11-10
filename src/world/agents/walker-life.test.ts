/**
 * Life on the pavements: walkers keep right and get by the slow on the left;
 * some walk in company, a child by the hand, and keep together; joggers run
 * past; dogs keep to the pavement on their leads; and now and then two who
 * meet stop for a chat — all of them still only off the kerb where it is
 * crossed.
 */
import { describe, expect, test } from "bun:test";

import { createNetwork } from "../roads/network";
import { crossroads } from "./lanes/traffic.test-kit";
import { createTown, setTownCaps, stepTown, townCaps, type Mover } from "./town";

/** Off the kerb: in the middle of a cell, not at its side. */
const offKerb = (x: number, y: number) => Math.max(Math.abs(x - Math.round(x)), Math.abs(y - Math.round(y))) < 0.3;
const onCrossing = (m: Mover, s = m.s) => m.walk!.crossings.some((c) => s > c.s0 - 0.02 && s < c.s1 + 0.02);

describe("life on the pavements", () => {
  test("company, joggers, dogs and chats, and still only over where it is crossed", () => {
    const caps = { ...townCaps };
    setTownCaps({ cars: 20, people: 80, every: 1 });
    const g = crossroads(1, 1), net = createNetwork(g), t = createTown();
    const seen = { groups: new Set<number>(), hands: new Set<number>(), joggers: new Set<number>(), dogs: new Set<number>() };
    const out = { overtakes: 0, chats: 0, dogOff: 0, walkerOff: 0, strayed: 0, right: 0, left: 0, arrived: 0 };
    const out1 = new Set<number>();
    const dt = 1 / 20;
    for (let k = 0; k < 400 / dt; k++) {
      const before = new Set(t.movers.map((m) => m.id));
      stepTown(t, g, net, 0, dt);
      const by = new Map(t.movers.map((m) => [m.id, m]));
      for (const id of before) if (!by.has(id)) out.arrived++;
      for (const m of t.movers) {
        if (m.kind !== "person" || !m.walk) continue;
        if (m.group) seen.groups.add(m.group.lead);
        if (m.hand !== undefined) seen.hands.add(m.id);
        if (m.jog) seen.joggers.add(m.id);
        if (m.pause && !out1.has(m.id)) { out1.add(m.id); out.chats++; }
        // Out to the left: getting by someone.
        if ((m.sideTo ?? 0) < -0.03 && !m.group) out.overtakes++;
        if (!m.group && m.speed > 0.1) { if ((m.side ?? 0) > 0) out.right++; else out.left++; }
        const near = m.s > 0.3 && m.at[m.at.length - 1] - m.s > 0.3;
        if (near && !onCrossing(m) && offKerb(m.x, m.y)) out.walkerOff++;
        // In company: never far from whoever leads, away from the crossings.
        const lead = m.group && by.get(m.group.lead);
        if (lead && !onCrossing(m) && !onCrossing(lead) && !lead.walk!.waited && Math.hypot(lead.x - m.x, lead.y - m.y) > 0.6) out.strayed++;
        const d = m.dog;
        if (d) {
          seen.dogs.add(m.id);
          if (d.s > 0.3 && !onCrossing(m, d.s) && offKerb(d.x, d.y)) out.dogOff++;
        }
      }
    }
    setTownCaps(caps);
    if (process.env.DBG) console.log(out, seen.groups.size, seen.hands.size, seen.joggers.size, seen.dogs.size);
    expect(seen.groups.size).toBeGreaterThan(5);
    expect(seen.hands.size).toBeGreaterThan(2);
    expect(seen.joggers.size).toBeGreaterThan(2);
    expect(seen.dogs.size).toBeGreaterThan(2);
    expect(out.overtakes).toBeGreaterThan(0);
    expect(out.chats).toBeGreaterThan(0);
    expect(out.right).toBeGreaterThan(out.left * 3);
    expect(out.walkerOff).toBe(0);
    expect(out.dogOff).toBe(0);
    expect(out.strayed).toBe(0);
    expect(out.arrived).toBeGreaterThan(50);
  });
});
