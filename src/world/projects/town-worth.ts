/**
 * World v2 — WHAT A TOWN IS WORTH AT A SALE: a share on top of the Equity an
 * acquisition pays, for having built somewhere good rather than merely big.
 *  - each tier a house has GROWN, served by cafés, parks and gyms: +1%;
 *  - each SERVICE standing: +2%;
 *  - each WONDER standing: +5%;
 * up to +50% in all. @see setTownBonusReader, TOWN_BONUS_CAP
 */
import { TOWN_BONUS_CAP } from "../../game/acquisition";
import { projectForStructure } from "../../game/projects";
import type { Grid } from "../grid";
import { serviceOf } from "../agents/services";

export const PER_GROWN = 0.01;
export const PER_SERVICE = 0.02;
export const PER_WONDER = 0.05;

export function townBonusOf(g: Grid): number {
  let bonus = 0;
  for (const s of g.structures.values()) {
    if (s.build) continue;
    bonus += (s.grown ?? 0) * PER_GROWN;
    if (serviceOf(s.def)) bonus += PER_SERVICE;
    if (projectForStructure(s.def)?.bonus) bonus += PER_WONDER;
  }
  return Math.min(TOWN_BONUS_CAP, bonus);
}
