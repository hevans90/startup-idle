/**
 * THE TRUCKS a building site sends for at a time, and what a load costs: one
 * truck at the usual price, unless the equity tree says otherwise (Refactoring,
 * Monorepo). The prestige store hands in its reader. @see PrestigeModifiers.extraTrucks
 */
export type Haulage = { trucks: number; price: number };

let read = (): Haulage => ({ trucks: 1, price: 1 });

export const siteTrucks = (): Haulage => read();

/** Set what the trucks come to. Returns the undo. */
export function setHaulageReader(r: () => Haulage): () => void {
  const before = read;
  read = r;
  return () => { read = before; };
}
