/**
 * The WebGPU device, for the debug overlays that need it.
 *
 * The renderer owns it and the scene is where it becomes reachable; the HUD
 * that wants it is a sibling of the canvas, several components away. A holder
 * rather than a prop drilled through `<Application>` — this is a dev-only
 * readout and threading it would touch the render tree for nothing.
 */
let held: GPUDevice | null = null;

/** Called by the scene once the renderer exists. */
export const holdDevice = (d: GPUDevice | null) => { held = d; };

/** Null on the WebGL path, where there is no compute at all. */
export const heldDevice = () => held;
