/**
 * World v2 — what a port is DOING, for whoever draws it: each berth free,
 * working or blocked, and the ship a working one has alongside; how full its
 * yard is; and how dark it is. The scene says, from the traffic; the renderer
 * asks. Nothing here knows either. @see seaport-renderer, portWork
 */
export type BerthState = "free" | "working" | "blocked";
/** A ship alongside, in tile coordinates and half steps: how big, how far through its call, loading or unloading, and whether it has cargo to work. */
export type ShipAt = { x: number; y: number; z: number; cls: number; at: number; loading: boolean; cargo: boolean };
export type PortLife = { berths: { state: BerthState; ship?: ShipAt }[]; yard: number; night: number };

let source: ((port: number) => PortLife | null) | null = null;
/** Say how to find a port's life; null for nobody to ask. */
export const setPortLife = (f: typeof source) => { source = f; };
export const portLife = (port: number): PortLife | null => source?.(port) ?? null;
