/**
 * World v2 — THE ARC'S RULES ON THE MAP: what the chapters chosen change about
 * building. The site given to the AI is its own: the player cannot build
 * there, and the Lattice goes there. Under the Partnership the AI pays half of
 * what the player builds in its district. And a block picked to be rebuilt
 * has its starter houses cleared, but for the building kept, for the AI to
 * build again taller. @see game/quests/chapters, plans/ai-takeover.md §5
 */
import { questCharter, questFlag } from "../../game/quests/effects";
import { stageOf, useAiSingularityStore } from "../../state/ai-singularity.store";
import { useQuestStore } from "../../state/quest.store";
import { housedBy } from "../../game/housing";
import { tierOf } from "../agents/services";
import type { Grid, Structure } from "../grid";
import { demolishAt } from "../play/build-actions";
import { aiActing, aiDistrict, inDistrict } from "./district";

/** The site's size, and a block's: tiles a side, round their middle. */
export const SITE = 3;
export const BLOCK = 9;

type Box = { x: number; y: number; w: number; h: number };
/** The box `n` tiles a side round a middle. */
export const boxAround = (at: { x: number; y: number }, n: number): Box => ({ x: at.x - Math.floor(n / 2), y: at.y - Math.floor(n / 2), w: n, h: n });
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** The AI's site, if one was given in this company. */
export const aiSite = (): Box | null => {
  const at = useQuestStore.getState().site;
  return at && questFlag("site:given") ? boxAround(at, SITE) : null;
};

/** Whether the player is kept off what they would build here: the AI's site. */
export function onAiSite(boxes: readonly Box[]): boolean {
  const site = aiSite();
  return !!site && !aiActing() && boxes.some((b) => overlaps(b, site));
}

/** The share of a build the player pays: half in the AI's district under the Partnership, the AI the rest. */
export function playerShare(g: Grid, boxes: readonly Box[]): number {
  if (aiActing() || questCharter() !== "partnership" || !boxes.length) return 1;
  const d = aiDistrict(g, stageOf(useAiSingularityStore.getState().value).stage);
  return boxes.every((b) => inDistrict(d, b.x, b.y)) ? 0.5 : 1;
}

/** Whether a building is a starter house: a lot at the first tier. */
const starter = (s: Structure) => !!housedBy(s.def) && (tierOf(s.def) ?? "t0") === "t0";

/** THE BLOCK REBUILT: its starter houses cleared, but the one kept. How many went. */
export function clearBlock(g: Grid): number {
  const q = useQuestStore.getState();
  if (!q.block) return 0;
  const box = boxAround(q.block, BLOCK);
  const doomed = [...g.structures.values()].filter((s) => s.id !== q.keep && starter(s) && overlaps(box, { x: s.x, y: s.y, w: s.w, h: s.h }));
  let n = 0;
  for (const s of doomed) if (demolishAt({ x: s.x, y: s.y })) n++;
  return n;
}

/** Whether a tile is in the block picked to be rebuilt, where the AI zones taller. */
export function inRebuiltBlock(x: number, y: number): boolean {
  const q = useQuestStore.getState();
  if (!q.block || !questFlag("block:rebuilt")) return false;
  const b = boxAround(q.block, BLOCK);
  return x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;
}
