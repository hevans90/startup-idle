import { matrix, multiply } from "mathjs";

type Block = {
  x: number;
  y: number;
};

export function screenToIsometric(x: number, y: number, scale: number) {
  // the weights as explanined in the youtube video
  const isometricWeights = matrix([
    [0.5, 0.25],
    [-0.5, 0.25],
  ]);

  // coordinatex times the size of the block 18 * 4 = 72
  // as it's scaled 4x
  const coordinate = matrix([[x * 18 * scale, y * 18 * scale]]);

  const [isometricCoordinate] = multiply(
    coordinate,
    isometricWeights
  ).toArray();
  return isometricCoordinate as number[];
}

export function generateGrid<T extends Block = Block>(
  rows: number,
  cols: number,
  blockProvider: (x: number, y: number) => T
) {
  const grid: T[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      grid.push(blockProvider(i, j));
    }
  }
  return grid;
}
