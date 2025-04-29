import { inv, Matrix, matrix, multiply } from "mathjs";

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

export function getHoveredTile(
  screenX: number,
  screenY: number,
  scale: number
): { x: number; y: number } {
  // Inverse of the isometric transformation matrix
  const isometricWeights = matrix([
    [0.5, 0.25],
    [-0.5, 0.25],
  ]);
  const inverseMatrix = inv(isometricWeights) as Matrix;

  // Undo scale and tile size
  const worldX = screenX / (18 * scale);
  const worldY = screenY / (18 * scale);

  const result = multiply(matrix([[worldX, worldY]]), inverseMatrix) as Matrix;
  const resultArray = result.toArray() as number[][];

  const tileX = Math.floor(resultArray[0][0]);
  const tileY = Math.floor(resultArray[0][1]);

  return { x: tileX, y: tileY };
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
