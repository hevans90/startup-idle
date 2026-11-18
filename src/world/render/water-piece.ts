/** How far apart two columns' floors may be, half steps, and still be ONE PIECE of ground to the water as a field: over it is a cliff or a wall, and neither side's water has to do with the other's. @see water-gpu.ts fieldCorner, quad-rule.ts skirtAt */
export const PIECE = 2.5;
/** How far apart the DRAWN ground of two tiles may stand at a point, half steps, and their water still be one sheet there: under it is a ripple in the ground, over it a drop. @see water-gpu.ts pieceOf */
export const PIECE_STEP = 0.75;
