/**
 * INDIRECT DISPATCH ARGUMENTS, A FRESH BUFFER FOR EVERY USE IN A FRAME.
 *
 * A pass whose size only the device knows — the falls walk this frame's cliff
 * index, the landings the box this substep's falls landed in — has one thread
 * write its workgroup counts and dispatches indirectly off them. Twice a
 * substep, up to twelve substeps, all in one command buffer.
 *
 * WHY A RING, when nothing was shown to need one. A still flood once seemed
 * to lose half its water with the sizing in the dispatch's own pass, and then
 * with one buffer shared across substeps. Both were the measurement: the
 * perf scene sometimes flooded before its field had grown the deck's storey,
 * and a hidden pane froze the readings between runs. With those fixed, every
 * arrangement holds the flood to the unit. A buffer per use costs sixteen
 * bytes and leaves no ordering rule to lean on, so it stays.
 */

/** More than any one command buffer uses: two passes, twelve substeps. */
const RING = 32;

export type IndirectRing = {
  /** The next set of arguments, and the sizing pass's bind group for them. */
  next: (key: object) => { args: GPUBuffer; bound: GPUBindGroup };
};

export function createIndirectRing(
  device: GPUDevice,
  label: string,
  layout: GPUBindGroupLayout,
  /** The sizing pass's bindings, `args` among them. Called once per buffer. */
  entries: (key: object, args: GPUBuffer) => GPUBindGroupEntry[],
): IndirectRing {
  const rings = new WeakMap<object, { args: GPUBuffer; bound: GPUBindGroup }[]>();
  let turn = 0;
  return {
    next: (key) => {
      let ring = rings.get(key);
      if (!ring) { ring = []; rings.set(key, ring); }
      const k = turn++ % RING;
      let had = ring[k];
      if (had) return had;
      const args = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
        label: `${label}:args`,
      });
      had = { args, bound: device.createBindGroup({ layout, entries: entries(key, args) }) };
      ring[k] = had;
      return had;
    },
  };
}
