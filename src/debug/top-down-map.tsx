/**
 * 2D top-down canvas view of the office map — debug companion to the isometric
 * Pixi renderer. Uses the same world data (generateWorld) and stores as the game.
 */
import { useEffect, useRef } from "react";
import { useGeneratorStore } from "../state/generators.store";
import { useSlopPitStore, SLOP_PIT_UNLOCK_COUNT } from "../state/slop-pit.store";
import {
  generateWorld,
  WORLD_COLS,
  WORLD_ROWS,
  SLOP_PIT_CENTER,
  SLOP_PIT_BLOCK,
} from "../office/city/generate-world";

const CELL = 10; // px per grid cell

const SP_CX   = SLOP_PIT_CENTER.x;
const SP_CY   = SLOP_PIT_CENTER.y;
const SP_HALF = SP_CX - SLOP_PIT_BLOCK.x0; // = 2

// District zone palette (matches DISTRICT_REGIONS in generate-world.ts)
const DISTRICT_COLORS: Record<string, { base: string; label: string }> = {
  intern:     { base: "#1e3a5f", label: "Interns" },
  vibe_coder: { base: "#3b1f5e", label: "Vibe coders" },
  "10x_dev":  { base: "#14402e", label: "10x devs" },
};

export function TopDownMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const vibeCount = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "vibe_coder")?.amount ?? 0,
  );
  const internCount = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "intern")?.amount ?? 0,
  );
  const devCount = useGeneratorStore(
    (s) => s.generators.find((g) => g.id === "10x_dev")?.amount ?? 0,
  );
  const fill = useSlopPitStore((s) => s.fill);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = WORLD_COLS * CELL;
    const H = WORLD_ROWS * CELL;
    canvas.width = W;
    canvas.height = H;

    const { roadCells, districts } = generateWorld();

    // District zone lookup — cell → id
    const districtOf = new Map<string, string>();
    for (const d of districts) {
      for (const plot of d.plots) {
        districtOf.set(`${plot.mapX},${plot.mapY}`, d.id);
      }
    }
    // Road cells are in roadCells set as "x,y"

    // Slop pit cells active at this fill level
    const unlocked = vibeCount >= SLOP_PIT_UNLOCK_COUNT;
    const pct = fill / 100;
    const slopRadius = unlocked ? Math.floor(pct * SP_HALF + 0.001) : 0; // 0, 1, or 2
    const slopCells = new Set<string>();
    for (let dy = -slopRadius; dy <= slopRadius; dy++) {
      for (let dx = -slopRadius; dx <= slopRadius; dx++) {
        slopCells.add(`${SP_CX + dx},${SP_CY + dy}`);
      }
    }

    // Background
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, W, H);

    // Draw each cell
    for (let y = 0; y < WORLD_ROWS; y++) {
      for (let x = 0; x < WORLD_COLS; x++) {
        const k = `${x},${y}`;
        const px = x * CELL;
        const py = y * CELL;

        let color = "#1f2937"; // void / outside all districts

        const distId = districtOf.get(k);
        if (distId) color = DISTRICT_COLORS[distId]?.base ?? "#1f2937";

        if (roadCells.has(k)) color = "#374151"; // road

        // Reserved slop pit block — always distinct, sludge-filled cells darker
        const inBlock =
          x >= SLOP_PIT_BLOCK.x0 && x <= SLOP_PIT_BLOCK.x1 &&
          y >= SLOP_PIT_BLOCK.y0 && y <= SLOP_PIT_BLOCK.y1;
        if (inBlock) color = "#1a1a2e"; // reserved void, no buildings

        if (slopCells.has(k)) {
          color = pct > 0.8 ? "#7c2d12" : pct > 0.5 ? "#92400e" : pct > 0.25 ? "#1e3a1e" : "#12261a";
        }

        ctx.fillStyle = color;
        ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
      }
    }

    // Slop pit centre dot + border
    const spPx = SP_CX * CELL;
    const spPy = SP_CY * CELL;
    const slopBorder = pct > 0.8 ? "#fca5a5" : pct > 0.5 ? "#fdba74" : "#4b5563";
    ctx.strokeStyle = slopBorder;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      (SP_CX - slopRadius) * CELL + 0.75,
      (SP_CY - slopRadius) * CELL + 0.75,
      (slopRadius * 2 + 1) * CELL - 1.5,
      (slopRadius * 2 + 1) * CELL - 1.5,
    );
    // Centre cross-hair
    ctx.strokeStyle = "#ffffff44";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(spPx + CELL / 2, spPy);
    ctx.lineTo(spPx + CELL / 2, spPy + CELL);
    ctx.moveTo(spPx, spPy + CELL / 2);
    ctx.lineTo(spPx + CELL, spPy + CELL / 2);
    ctx.stroke();

    // Grid lines every 5 cells
    ctx.strokeStyle = "#374151";
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= WORLD_COLS; x += 5) {
      ctx.beginPath();
      ctx.moveTo(x * CELL, 0);
      ctx.lineTo(x * CELL, H);
      ctx.stroke();
    }
    for (let y = 0; y <= WORLD_ROWS; y += 5) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL);
      ctx.lineTo(W, y * CELL);
      ctx.stroke();
    }

    // District labels
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    for (const d of districts) {
      const { region } = d;
      const lx = ((region.x0 + region.x1) / 2 + 0.5) * CELL;
      const ly = ((region.y0 + region.y1) / 2 + 0.5) * CELL;
      ctx.fillStyle = "#ffffff55";
      ctx.fillText(DISTRICT_COLORS[d.id]?.label ?? d.id, lx, ly);
    }

    // "SLOP" label on centre cell
    ctx.font = "bold 6px monospace";
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillStyle = unlocked ? "#fff" : "#4b5563";
    ctx.fillText(unlocked ? "SLOP" : `${SLOP_PIT_UNLOCK_COUNT}vc`, (SP_CX + 0.5) * CELL, (SP_CY + 0.5) * CELL + 2);

    // Employee buildings overlay (EMPLOYEE_BUILDINGS zones, separate coord system)
    // Just show occupied cells using actual placement from the store counts.
    // These are rendered from the EMPLOYEE_BUILDINGS zones which use a legacy
    // small-map sub-region; overlaid here as-is for debugging.
    // Axis labels every 10 cells
    ctx.font = "7px monospace";
    ctx.fillStyle = "#4b5563";
    ctx.textAlign = "center";
    for (let x = 0; x < WORLD_COLS; x += 10) {
      ctx.fillText(String(x), (x + 0.5) * CELL, 8);
    }
    ctx.textAlign = "right";
    for (let y = 0; y < WORLD_ROWS; y += 10) {
      ctx.fillText(String(y), CELL * 1.8, (y + 0.7) * CELL);
    }
  }, [vibeCount, internCount, devCount, fill]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-gray-900">
      <div className="shrink-0 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 border-b border-gray-800">
        Top-down (2D)
      </div>
      <div className="flex-1 overflow-auto p-2 min-h-0">
        <canvas
          ref={canvasRef}
          style={{ imageRendering: "pixelated", display: "block" }}
        />
        <div className="mt-2 flex flex-wrap gap-2 text-[9px] text-gray-400">
          {Object.entries(DISTRICT_COLORS).map(([id, c]) => (
            <span key={id} className="flex items-center gap-1">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: c.base }} />
              {c.label}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#374151]" />
            Roads
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#7c2d12]" />
            Slop pit
          </span>
        </div>
      </div>
    </div>
  );
}
