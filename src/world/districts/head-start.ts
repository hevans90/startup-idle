/**
 * THE MACHINE'S HEAD STARTS: a whole district a new company is founded with —
 * its roads paved, its houses finished and full, offices for everyone in them —
 * and the people in those houses on the payroll from the first second.
 * Laid once, as the map is first made. @see game/machine HEAD_STARTS, world-canvas
 */
import { foundingRemoteBeds } from "../../game/housing";
import { headStart, HEAD_STARTS, type HeadStartId } from "../../game/machine";
import { GENERATOR_TYPES, useGeneratorStore, type GeneratorId } from "../../state/generators.store";
import { useSessionStore } from "../../state/session.store";
import { useWorldStore } from "../../state/world.store";
import { deskBalance, districtRoadAt, districtSize, layoutDistrict, type DistrictSpec } from "./layout";
import { placeDistrictNow } from "./place";
import { findDistrictSite } from "./site";

/** Each head start's district. */
export const HEAD_START_DISTRICTS: Record<HeadStartId, DistrictSpec> = {
  suburb: { across: 2, strips: 2, houses: ["kit:intern.t1"], desks: true, services: ["cafe"] },
  studio: { across: 2, strips: 2, houses: ["kit:vibe_coder.t1"], desks: true, centre: "studio" },
  company: { across: 2, strips: 2, houses: ["kit:intern.t2", "kit:vibe_coder.t2"], desks: true, services: ["cafe", "gym", "park"] },
};

/** Lay a district on the map now, near its middle, and hire whoever lives in it. What it housed, by kind. */
export function foundDistrict(spec: DistrictSpec): Partial<Record<GeneratorId, number>> {
  const st = useWorldStore.getState();
  const { w, h } = districtSize(spec);
  const site = findDistrictSite(st.grid, w, h, { maxRelief: 6, roadAt: districtRoadAt });
  if (!site) return {};
  const plan = layoutDistrict(st.grid, site.x0, site.y0, spec);
  const placed = placeDistrictNow(plan, site.connector);
  const grid = useWorldStore.getState().grid;
  const built = placed.ids.map((id) => grid.structures.get(id)).filter((s) => !!s).map((s) => ({ def: s!.def }));
  const out: Partial<Record<GeneratorId, number>> = {};
  for (const k of deskBalance(built)) if (k.beds > 0) out[k.kind] = k.beds;
  return out;
}

/**
 * A NEW COMPANY'S HEAD STARTS, the ones the Machine has: their districts laid
 * and their people hired. The beds off the map are fixed first, at the company's
 * own people, so the district's are housed in it and not counted as away.
 */
export function foundHeadStarts(): void {
  const owned = HEAD_STARTS.filter((h) => headStart(h.id));
  if (!owned.length) return;
  const gens = useGeneratorStore.getState();
  const before: Record<string, number> = {};
  for (const g of gens.generators) before[g.id] = g.amount;
  if (!useSessionStore.getState().remoteBeds) useSessionStore.getState().setRemoteBeds(foundingRemoteBeds(before));
  const hired: Partial<Record<GeneratorId, number>> = {};
  for (const h of owned) for (const [k, n] of Object.entries(foundDistrict(HEAD_START_DISTRICTS[h.id]))) hired[k as GeneratorId] = (hired[k as GeneratorId] ?? 0) + n;
  // ON THE ROSTER, whatever opens the kind later: hired past the housing gate, the beds being theirs.
  for (const [id, n] of Object.entries(hired) as [GeneratorId, number][]) {
    if (!useGeneratorStore.getState().generators.some((g) => g.id === id)) {
      const base = GENERATOR_TYPES.find((g) => g.id === id)!;
      useGeneratorStore.getState().addGenerator({ ...base, amount: 0, multiplier: 1, costMultiplier: 1, innovationMultiplier: 1, lastTick: Date.now() });
    }
    useGeneratorStore.setState((s) => ({ generators: s.generators.map((g) => (g.id === id ? { ...g, amount: g.amount + n } : g)) }));
  }
}
