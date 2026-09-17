/**
 * How much water is on the map, for the readout — and NOT in the store.
 *
 * It was store state, set from the tick whenever it changed. On a flat map
 * after one pour that is every frame for as long as the puddle is spreading,
 * because the wet count goes up every frame — and a store write is a React
 * root pass, which in a profile of that exact click was the single biggest
 * thing in the trace: more than a third of it, and four times the whole Pixi
 * tick. Not in the components either, whose render functions come to single
 * digits between them; in `processRootScheduleInMicrotask`, which is React's
 * fixed cost per commit paid sixty times a second.
 *
 * So it is a latch, like `perf.ts` and `gpu-water-stat` before it, polled by
 * the one small thing that shows it. The rule this belongs to is worth stating
 * plainly: a number that changes every frame does not go in the store. The
 * store is for what the EDITOR changes, and a person cannot click sixty times
 * a second.
 */
export type WaterMeta = { wet: number; volume: number };

let last: WaterMeta = { wet: 0, volume: 0 };

export const waterMetaSaw = (m: WaterMeta) => { last = m; };
export const waterMetaRead = (): WaterMeta => last;
