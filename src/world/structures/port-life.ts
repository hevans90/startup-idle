/**
 * World v2 — what a port is DOING, for whoever draws it: each berth free,
 * working or blocked, and the ship a working one has alongside; how full its
 * yard is; and how dark it is. The scene says, from the traffic; the renderer
 * asks. Nothing here knows either. @see seaport-renderer, portWork
 */
export type BerthState = "free" | "working" | "blocked";
/**
 * A ship alongside, in tile coordinates and half steps: where it lies and
 * heads, how big it is, which lift its crane is on and how far through it,
 * loading or unloading, and whether it has cargo to work. @see liftAt
 */
export type ShipAt = {
  id: number; x: number; y: number; z: number; heading: number; cls: number; look: string; boxes: number;
  lift: number; phase: number; loading: boolean; cargo: boolean; slot: number;
};
export type PortLife = { berths: { state: BerthState; ship?: ShipAt }[]; yard: number; night: number };

let source: ((port: number) => PortLife | null) | null = null;
/** Say how to find a port's life; null for nobody to ask. */
export const setPortLife = (f: typeof source) => { source = f; };
export const portLife = (port: number): PortLife | null => source?.(port) ?? null;
