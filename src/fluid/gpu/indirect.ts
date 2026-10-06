/**
 * INDIRECT DISPATCH ARGUMENTS, A FRESH BUFFER FOR EVERY USE IN A FRAME.
 *
 * A pass whose size only the device knows — the falls walk this frame's cliff
 * index, the landings the box this substep's falls landed in — has one thread
 * write its workgroup counts and dispatches indirectly off them. Twice a
 * substep, up to twelve substeps, all in one command buffer.
 *
 * WHY A RING. What was measured: the falls' sizing written in the SAME pass as
 * the dispatch it sizes was not seen by it on this device, and a still flood
 * on a 204 tile map lost half its water while every frame comparison passed.
 * A pass of its own fixed that. One buffer reused by every substep in a
 * command buffer was then suspected of the same thing and was NOT shown to
 * fail — the reading that suggested it was a hidden pane's frozen frames —
 * but a buffer per use costs sixteen bytes and leaves nothing for an ordering
 * rule to get wrong, so they are not shared.
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
