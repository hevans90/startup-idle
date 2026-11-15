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
 * table that forgets: past `KEEP` groups, those no batch used this frame or
 * the last are destroyed, and their GPU halves with them. A batch still
 * holding a destroyed group (a still band, not rebuilt) is given a live one
 * when it is next drawn.
 * @see plans/ai-mode-rebuild.md, the play-through
 */
import { BindGroup, Texture, type TextureSource } from "pixi.js";

/** Groups kept before a sweep. A frame uses a few dozen. */
export const KEEP = 512;

type Group = BindGroup & { _used?: number };
type Batch = { bindGroup: Group | null; textures: { textures: TextureSource[]; count: number } };
type Adaptor = { execute: (pipe: unknown, batch: Batch) => void };
type Host = {
  tick: number;
  limits: { maxBatchableTextures: number };
  bindGroup?: { _hash: Record<string, unknown> };
  renderPipes: { batch?: { _adaptor?: Adaptor & { __bound?: boolean } } };
};

/** The groups by the order of their textures, and how to find or make one. Its own, so it can be tested with no renderer. */
export function createBinds(keep = KEEP, drop: (g: Group) => void = () => {}) {
  const groups = new Map<string, Group>();
  const sweep = (tick: number) => {
    for (const [key, g] of groups) {
      if ((g._used ?? 0) >= tick - 1) continue;
      groups.delete(key);
      drop(g);
      g.destroy();
    }
  };
  return {
    size: () => groups.size,
    /** The group for these textures in this order, marked used this tick. */
    of(textures: TextureSource[], count: number, max: number, tick: number): Group {
      let key = "";
      for (let i = 0; i < count; i++) key += textures[i].uid + ",";
      let g = groups.get(key);
      // (Or one Pixi destroyed itself, a texture of its having gone: made again.)
      if (!g || !g.resources) {
        if (groups.size >= keep * 2) sweep(tick);
        const resources: Record<number, unknown> = {};
        let at = 0;
        for (let i = 0; i < max; i++) {
          const source = i < count ? textures[i] : Texture.EMPTY.source;
          resources[at++] = source;
          resources[at++] = source.style;
        }
        g = new BindGroup(resources as ConstructorParameters<typeof BindGroup>[0]);
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
    // None yet, or one this table has since destroyed (its resources gone).
    if (!had || !had.resources) batch.bindGroup = binds.of(batch.textures.textures, batch.textures.count, r.limits.maxBatchableTextures, r.tick);
    else had._used = r.tick;
    execute.call(this, pipe, batch);
  };
}
