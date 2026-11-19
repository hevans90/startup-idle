/**
 * WHAT THE PLAYER PAYS AND GETS FOR WHAT GROWS, in seconds of the company's income as roads are (@see roadCost),
 * each never under a floor:
 *
 * - **Felling** a tree costs 0.15 s; its **timber** sells for 0.1 s if it is grown, less if young — so clearing a
 *   mature wood costs a little and a young one or scrub more. A building or road on a wood fells it.
 * - **Planting** a cell: a wood's saplings 0.4 s, a row's tree 0.3 s, a hedge 0.2 s, a bed of flowers 0.25 s.
 * - **A harvest** pays 2 s a field. A farm (90 s) with the 30-odd fields round it pays back in a year or two of
 *   the calendar — an hour or two of play. @see world/vegetation/tend
 */
import Decimal from "break_infinity.js";

import { safeIncome } from "./build-cost";
import type { Planting } from "../world/vegetation/tend";

const each = (seconds: number, floor: number) => Math.max(floor, safeIncome() * seconds);

export const fellCost = (trees: number) => new Decimal(Math.round(each(0.15, 1) * trees));
export const timberValue = (timber: number) => Math.round(each(0.1, 0.6) * timber);
const PLANT: Record<Planting, [number, number]> = { woods: [0.4, 3], row: [0.3, 2], hedge: [0.2, 1], bed: [0.25, 2] };
export const plantCost = (what: Planting, cells: number) => new Decimal(Math.round(each(...PLANT[what]) * cells));
export const harvestPay = (fields: number) => Math.round(each(2, 4) * fields);
