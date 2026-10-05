/**
 * How long a band's mesh stays SHOWN after it last drew anything, in frames.
 *
 * Shown and hidden is structural in Pixi: flip one mesh's `visible` and the
 * render group it sits in rebuilds its whole instruction list — and the stage
 * is the one group, so it re-batches every sprite on the map. The per-band
 * meshes that come and go with the water — the sheets off every lip, the
 * drops in the air, the host's quad batches — flipped whenever a band's last
 * fall stopped or its first started, which on a flooded map is a dozen bands
 * every frame: measured at 204 tiles, 23 flips a frame, every frame
 * re-batching 48,000 terrain sprites for 20 ms of CPU and 5.6 MB of vertex
 * data uploaded again.
 *
 * So a mesh shows the moment it has something and is hidden only after this
 * many frames with nothing — a band whose falls flicker on and off never
 * flips at all, and a band that never had any never draws. Shown and empty,
 * each layer draws nothing for the price of one draw: the sheets ask for no
 * instances, and the drops' and the batches' slots collapse to a point.
 */
export const HOLD_FRAMES = 120;

/**
 * One band's mesh, one frame: whether it is drawing anything now, and the
 * frames it has been idle, kept in `idle[b]`. Flips `visible` only on a change.
 */
export function holdShown(
  mesh: { visible: boolean }, active: boolean, idle: Uint16Array, b: number,
): void {
  if (active) idle[b] = 0;
  else if (idle[b] < 0xffff) idle[b]++;
  const show = active || (mesh.visible && idle[b] < HOLD_FRAMES);
  if (mesh.visible !== show) mesh.visible = show;
}
