/** Road center column for a square map (matches `layer-0-ground.txt` when built with same rules). */
export function roadMapX(cols: number): number {
  return Math.floor(cols / 2) + 2;
}
