function generateFrameData(x: number, y: number) {
  return {
    frame: { x: 18 * x, y: 18 * y, w: 18, h: 18 },
    sourceSize: { w: 18, h: 18 },
    // spriteSourceSize: { x: 0, y: 0, w: 17, h: 1 },
  };
}

export const atlasData = {
  frames: {
    pale_green_grass: generateFrameData(0, 0),
    dark_green_grass: generateFrameData(1, 0),
    dark_green_grass_with_seedling: generateFrameData(2, 0),
    dark_green_grass_with_budding: generateFrameData(3, 0),
    sand: generateFrameData(4, 0),
    sand_with_crack: generateFrameData(5, 0),
    dry_dirt: generateFrameData(6, 0),
    dry_dirt_with_crach: generateFrameData(7, 0),
    dirt: generateFrameData(8, 0),
    dark_green_grass_dirt: generateFrameData(0, 1),
    dark_green_grass_dirt_with_seedling: generateFrameData(1, 1),
    dark_floor: generateFrameData(0, 6),
  },
  meta: {
    // renamed one of the sprite sheets into `structural_blocks.png`
    // and placed it in `public/sprites`
    image: "images/blocks.png",
    format: "RGBA8888",
    size: { w: 180, h: 180 },
    // scale is 1:1
    scale: 1,
  },
};
