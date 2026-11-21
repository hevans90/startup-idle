/**
 * World v2 — A BOUND ON PIXI'S TEXTURE BIND GROUPS.
 *
 * A batch binds its textures in the order it met them, and Pixi keeps a bind
 * group for every ORDER it has ever seen, for good (`getTextureBatchBindGroup`:
 * a module's own table, nothing evicted). The town's cars, people and
 * buildings are drawn sorted by depth from some ten atlases, so the order
 * changes with every step somebody takes: 160 new groups a second, each
 * holding a listener on every texture in it. An hour's play was 500,000 of
 * them, four gigabytes, and the tab died before the sale.
 *
 * So the batch is given its group HERE, before Pixi looks for one, from a
 * table that forgets: past a bound, those no batch used this frame or the last
 * are dropped, and their GPU halves with them. A batch still holding a dropped
 * group (a still band, not rebuilt) is given a live one when it is next drawn.
 *
 * THE GROUPS LISTEN TO NOTHING. Pixi's own put a listener on each of their 32
 * resources — the textures, their styles, and the empty texture filling every
 * slot not used — so a thousand groups hung ten thousand listeners on the same
 * few objects, and dropping them took each off a list that long: a sweep was
 * two seconds of a locked game (`removeListener`). A group here is built
 * without them and knows itself stale instead — a texture of it destroyed, or
 * resized or unloaded since (its resource id moved on) — when it is next used.
 * @see plans/ai-mode-rebuild.md, the play-through
 */
import { BindGroup, Texture, type TextureSource } from "pixi.js";

/** Groups kept before a sweep. A frame uses a few dozen. */
export const KEEP = 512;

type Resource = { _resourceId: number; destroyed?: boolean };
type Group = BindGroup & { _used?: number; _ids?: number[] };
type Batch = { bindGroup: Group | null; textures: { textures: TextureSource[]; count: number } };
type Adaptor = { execute: (pipe: unknown, batch: Batch) => void };
type Host = {
  tick: number;
  limits: { maxBatchableTextures: number };
  bindGroup?: { _hash: Record<string, unknown> };
  renderPipes: { batch?: { _adaptor?: Adaptor & { __bound?: boolean } } };
};

/** Whether a group can still be drawn with: not dropped, and every resource in it as it was when it was made. */
export function liveGroup(g: Group | null | undefined): g is Group {
  if (!g || !g.resources) return false;
  const ids = g._ids;
  if (!ids) return true;
  const res = g.resources as unknown as Record<number, Resource>;
  for (let i = 0; i < ids.length; i++) { const r = res[i]; if (!r || r.destroyed || r._resourceId !== ids[i]) return false; }
  return true;
}

/** A group of these resources, in this order, that listens to none of them. @see liveGroup */
function quietGroup(resources: Resource[]): Group {
  const g = new BindGroup({}) as Group;
  const res = g.resources as unknown as Record<number, Resource>;
  for (let i = 0; i < resources.length; i++) res[i] = resources[i];
  g._ids = resources.map((r) => r._resourceId);
  (g as unknown as { _dirty: boolean })._dirty = true;
  g._updateKey();
  return g;
}

/** The groups by the order of their textures, and how to find or make one. Its own, so it can be tested with no renderer. */
export function createBinds(keep = KEEP, drop: (g: Group) => void = () => {}) {
  const groups = new Map<string, Group>();
  /** Swept when there are this many: twice what was left last time, at least, so a sweep that frees little is not run again at once. */
  let bound = keep * 2;
  const forget = (key: string, g: Group) => { groups.delete(key); drop(g); (g as { resources: unknown }).resources = null; };
  const sweep = (tick: number) => {
    for (const [key, g] of groups) if ((g._used ?? 0) < tick - 1) forget(key, g);
    bound = Math.max(keep * 2, groups.size * 2);
  };
  return {
    size: () => groups.size,
    /** The group for these textures in this order, marked used this tick. */
    of(textures: TextureSource[], count: number, max: number, tick: number): Group {
      let key = "";
      for (let i = 0; i < count; i++) key += textures[i].uid + ",";
      let g = groups.get(key);
      // (Or one gone stale — a texture of it destroyed, resized or unloaded: made again.)
      if (!liveGroup(g)) {
        if (g) forget(key, g);
        if (groups.size >= bound) sweep(tick);
        const resources: Resource[] = [];
        for (let i = 0; i < max; i++) {
          const source = i < count ? textures[i] : Texture.EMPTY.source;
          resources.push(source as unknown as Resource, source.style as unknown as Resource);
        }
        g = quietGroup(resources);
        groups.set(key, g);
      }
      g._used = tick;
      return g;
    },
  };
}

/** Have the renderer's batches take their bind groups from a table that forgets. WebGPU only; once a renderer. */
export function boundBatchBinds(renderer: unknown): void {
  const r = renderer as Host;
  const adaptor = r.renderPipes?.batch?._adaptor;
  // WebGL binds textures by unit and keeps no groups; and a Pixi whose insides have moved is left as it is.
  if (!adaptor || adaptor.__bound || !r.bindGroup?._hash || !r.limits) return;
  adaptor.__bound = true;
  const binds = createBinds(KEEP, (g) => { delete r.bindGroup!._hash[g._key]; });
  const execute = adaptor.execute;
  adaptor.execute = function (pipe, batch) {
    const had = batch.bindGroup;
    // None yet, one this table has since dropped, or one gone stale.
    if (!liveGroup(had)) batch.bindGroup = binds.of(batch.textures.textures, batch.textures.count, r.limits.maxBatchableTextures, r.tick);
    else had._used = r.tick;
    execute.call(this, pipe, batch);
  };
}
