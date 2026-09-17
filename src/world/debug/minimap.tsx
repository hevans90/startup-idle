/**
 * Top-down minimap — chrome, so an HTML canvas rather than Pixi.
 *
 * Draws straight from the dense typed arrays, which is why it is nearly free.
 * The equivalent view beside v1's `?debug=map` proved to be the fastest way to
 * catch a picking or placement bug: hover the iso map, watch the minimap
 * highlight, and an off-by-one is unmissable.
 */
import { useEffect, useRef } from "react";

import { useWorldStore } from "../../state/world.store";

const PX = 3; // px per cell

/**
 * Stable hue per material index. 1 (grass) keeps the original green so the
 * default map looks unchanged; everything else fans out around the wheel.
 */
function hueFor(material: number): number {
  if (material === 1) return 96;
  return (material * 47 + 200) % 360;
}

export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const grid = useWorldStore((s) => s.grid);
  const hover = useWorldStore((s) => s.hover);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    cv.width = grid.w * PX;
    cv.height = grid.h * PX;

    ctx.fillStyle = "#0b0e12";
    ctx.fillRect(0, 0, cv.width, cv.height);

    const span = Math.max(1, grid.maxHeight - grid.minHeight);
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        const i = y * grid.w + x;
        if (grid.terrain[i] === 0) continue;   // void
        const hv = grid.height[i];
        // Hue carries MATERIAL, lightness carries height. Colouring by height
        // alone made a fully painted map look identical to a blank one, which
        // is the one thing a minimap exists to tell you apart.
        const t = span ? (hv - grid.minHeight) / span : 0.5;
        const l = 32 + Math.round(t * 46);
        ctx.fillStyle = `hsl(${hueFor(grid.terrain[i])} 34% ${l}%)`;
        ctx.fillRect(x * PX, y * PX, PX, PX);
      }
    }
    if (hover) {
      ctx.strokeStyle = "#7cfc9a";
      ctx.lineWidth = 1;
      ctx.strokeRect(hover.x * PX - 0.5, hover.y * PX - 0.5, PX + 1, PX + 1);
    }
  }, [grid, hover]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded border border-gray-800"
      style={{ imageRendering: "pixelated" }}
    />
  );
}
