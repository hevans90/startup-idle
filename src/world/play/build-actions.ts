/**
 * World v2 — THE PLAYER'S BUILD ACTIONS, AS CALLS: put a building down, pull
 * one down, lay or lift road, reshape the ground, buy land, start a project.
 * Each goes through exactly the store action a click goes through — the same
 * prices, the same rules, the same refusals — so whatever calls these (the
 * company's AI, The Model's autopilot) builds as a player builds and cannot
 * cheat. @see world/ai/planner, plans/singularity.md
 *
 * QUIET: a refusal is an answer here, not a notice for the player, and what
 * the player had in hand is put back afterwards.
 */
import type { ProjectId } from "../../game/projects";
import { useWorldStore } from "../../state/world.store";
import type { ToolId } from "../edit/tools";
import { asAi } from "../ai/district";

type Cell = { x: number; y: number };

/** Run a store action with a tool in hand, then put back what the player had; whether the map changed. */
function withTool(patch: Record<string, unknown>, act: () => void): boolean {
  const st = useWorldStore.getState();
  const kept = {
    tool: st.tool, structureDefId: st.structureDefId, brush: st.brush, brushRadius: st.brushRadius,
    placingProject: st.placingProject, stroke: st.stroke, notice: st.notice, lastBuild: st.lastBuild,
  };
  const rev = st.revision;
  useWorldStore.setState(patch);
  // As the AI: its own streets are not closed to it. @see asAi
  try { asAi(act); } finally {
    // The AI's work is not the player's last build to take back. @see undoLastBuild
    useWorldStore.setState(kept);
  }
  return useWorldStore.getState().revision !== rev;
}

/** Put a building down, paid for as a click pays. */
export const placeStructure = (defId: string, at: Cell): boolean =>
  withTool({ tool: "placeStructure", structureDefId: defId, placingProject: null }, () => useWorldStore.getState().commitStructure(at));

/** Pull down whatever stands on a tile. */
export const demolishAt = (at: Cell): boolean =>
  withTool({ tool: "demolish", placingProject: null }, () => useWorldStore.getState().commitStructure(at));

/** A stroke of a brush tool along a straight line, as a drag makes one. */
function stroke(tool: ToolId, from: Cell, to: Cell): boolean {
  return withTool({ tool, brush: "line", brushRadius: 0, placingProject: null, stroke: { tool, brush: "line", anchor: from, head: to } },
    () => useWorldStore.getState().endStroke());
}

/** Lay pipe along a route, cell by cell in order, as the Pipe tool lays it and paid for alike. @see gamePipeRun */
export const layPipePath = (cells: readonly Cell[]): boolean =>
  cells.length > 0 && withTool(
    { tool: "pipe", brush: "line", brushRadius: 0, placingProject: null, stroke: { tool: "pipe", brush: "line", anchor: cells[0], head: cells[cells.length - 1], path: cells } },
    () => useWorldStore.getState().endStroke(),
  );

/** Lay road along a straight line, each new tile paid for. */
export const paveRoad = (from: Cell, to: Cell) => stroke("paintRoad", from, to);
/** Lift road along a straight line. */
export const liftRoad = (from: Cell, to: Cell) => stroke("eraseRoad", from, to);
/** Raise, lower or level the ground along a line. */
export const reshape = (op: "raise" | "lower" | "flatten", from: Cell, to: Cell) => stroke(op, from, to);
/** Pour water along a line: the AI's cooling ponds. */
export const pour = (from: Cell, to: Cell) => stroke("pourWater", from, to);

/** Buy the parcel a tile is in. */
export const buyParcelAt = (at: Cell): boolean => {
  const before = useWorldStore.getState().revision;
  withTool({}, () => useWorldStore.getState().buyParcel(at));
  return useWorldStore.getState().revision !== before;
};

/** Start a project's site at a tile. */
export const startProject = (id: ProjectId, at: Cell): boolean =>
  withTool({}, () => {
    useWorldStore.getState().placeProject(id);
    if (useWorldStore.getState().placingProject === id) useWorldStore.getState().commitStructure(at);
  });
