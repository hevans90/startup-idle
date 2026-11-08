import { describe, expect, test } from "bun:test";

import { EVENT_DEFS } from "./defs";
import { BLACKOUT_MS, BLACKOUT_WARN_MS } from "./defs/blackout";
import { BURST_MS, BURST_WARN_MS, CONTRACT_MS, MEND_MS } from "./defs/burst-main";
import { QUAKE_WEIGHT } from "./defs/earthquake";
import { BACKUP_MS, BACKUP_WARN_MS, PUMP_OUT_MS, ROD_MS } from "./defs/sewer-backup";
import { pickEvent } from "./director";
import { startEvent, stepEvents, type EventKind, type GameEvent, type TownView } from "./events";

const town = (now: number, over: Partial<TownView> = {}): TownView => ({
  now, income: 100, owned: {}, river: null, flooded: 0, overheated: 0, smoking: null, levee: null, evacuated: [], port: null,
  drinkers: null, offices: null, site: null, junction: null, joint: null, manhole: null, district: null, hq: null, poach: null, viral: null, unhappy: null, datacentre: null,
  convoy: { calls: 0, earned: 0 }, routes: 0, door: null, studio: null, sale: null,
  diligence: { mood: 0, spills: 0, watered: null, mop: () => {} }, ...over,
});
const step = (evs: GameEvent[], v: TownView) => stepEvents(evs, v, EVENT_DEFS);
const struck = (kind: EventKind, chosen: string | undefined, over: Partial<TownView>, warnMs: number) => {
  const e = startEvent(EVENT_DEFS[kind], town(0, over), 1)!;
  return step([chosen ? { ...e, chosen } : e], town(warnMs, over)).events[0];
};

describe("the planned disasters", () => {
  test("come only where the map has what they break", () => {
    for (const kind of ["burst-main", "sewer-backup", "blackout", "earthquake"] as const) {
      expect(startEvent(EVENT_DEFS[kind], town(0), 1)).toBeNull();
      expect(EVENT_DEFS[kind].followUp).toBeUndefined();
    }
  });

  test("a burst main: mended by the interns, sooner by a contractor, or pouring till the water company comes", () => {
    const joint = { x: 4, y: 5, cell: 104 };
    expect(struck("burst-main", "mend", { joint }, BURST_WARN_MS).endsAt).toBe(BURST_WARN_MS + MEND_MS);
    expect(struck("burst-main", "contractor", { joint }, BURST_WARN_MS).endsAt).toBe(BURST_WARN_MS + CONTRACT_MS);
    expect(struck("burst-main", undefined, { joint }, BURST_WARN_MS)).toMatchObject({ chosen: "pour", endsAt: BURST_WARN_MS + BURST_MS });
  });

  test("a sewer backup: rodded, pumped sooner, or left to clear itself", () => {
    const manhole = { x: 4, y: 5, cell: 104 };
    expect(struck("sewer-backup", "rod", { manhole }, BACKUP_WARN_MS).endsAt).toBe(BACKUP_WARN_MS + ROD_MS);
    expect(struck("sewer-backup", "pump", { manhole }, BACKUP_WARN_MS).endsAt).toBe(BACKUP_WARN_MS + PUMP_OUT_MS);
    expect(struck("sewer-backup", undefined, { manhole }, BACKUP_WARN_MS)).toMatchObject({ chosen: "leave", endsAt: BACKUP_WARN_MS + BACKUP_MS });
  });

  test("a blackout: the agents' load shed only with agents to shed; sat out by default", () => {
    const district = { x: 6, y: 6, ids: [1, 2, 3] };
    const e = startEvent(EVENT_DEFS.blackout, town(0, { district }), 1)!;
    expect(e.choices.find((c) => c.id === "shed")?.unavailable).toBe("No agents to shed");
    expect(e.choices.find((c) => c.id === "generators")?.price).toBeGreaterThan(0);
    const withAgents = startEvent(EVENT_DEFS.blackout, town(0, { district, datacentre: { x: 1, y: 1 } as never }), 1)!;
    expect(withAgents.choices.find((c) => c.id === "shed")?.unavailable).toBeUndefined();
    expect(struck("blackout", undefined, { district }, BLACKOUT_WARN_MS)).toMatchObject({ chosen: "wait", endsAt: BLACKOUT_WARN_MS + BLACKOUT_MS });
  });

  test("an earthquake: only once the HQ stands, and rarer than the rest", () => {
    expect(startEvent(EVENT_DEFS.earthquake, town(0, { hq: { x: 3, y: 3 } }), 1)).not.toBeNull();
    expect(EVENT_DEFS.earthquake.weight?.(town(0))).toBe(QUAKE_WEIGHT);
    expect(QUAKE_WEIGHT).toBeLessThan(1);
    // Drawn now and then, among the others it can come with.
    const v = town(0, { hq: { x: 3, y: 3 }, joint: { x: 4, y: 5, cell: 104 } });
    let quakes = 0;
    const defs = Object.values(EVENT_DEFS);
    for (let k = 0; k < 400; k++) if (pickEvent({ gap: 0, last: null } as never, v, defs, false, (k + 0.5) / 400)?.kind === "earthquake") quakes++;
    const bursts = Array.from({ length: 400 }, (_, k) => pickEvent({ gap: 0, last: null } as never, v, defs, false, (k + 0.5) / 400)?.kind).filter((k) => k === "burst-main").length;
    expect(quakes).toBeGreaterThan(0);
    expect(quakes).toBeLessThan(bursts);
  });
});
