/**
 * World v2 editor — THE TOOLBOX: every tool the editor has, in one list, by what it works on. The bar along the
 * bottom shows it, and the keys come from it, so that neither can name a tool the other has not. @see ToolDock
 *
 * Each group keeps its own brush: a road goes down along a line and water at a point, and picking one up never
 * changes how the other was left.
 */
import { useWorldStore } from "../../state/world.store";
import type { BrushId, ToolId } from "./tools";

export type GroupId = "look" | "land" | "roads" | "water" | "nature" | "build";
export type Group = { id: GroupId; name: string; key: string; tone: string; tools: ToolId[]; brush?: BrushId };

/** The groups, in the bar's order, and the key of each: shift and its number. */
export const GROUPS: readonly Group[] = [
  { id: "look", name: "Look", key: "1", tone: "#8b9bb0", tools: ["inspect"] },
  { id: "land", name: "Land", key: "2", tone: "#c98f52", tools: ["paintTerrain", "erase", "raise", "lower", "flatten", "smooth"] },
  { id: "roads", name: "Roads", key: "3", tone: "#b9a4f2", tools: ["paintRoad", "eraseRoad", "slope", "unslope"], brush: "line" },
  { id: "water", name: "Water", key: "4", tone: "#3fa9e0", tools: ["pourWater", "drainWater", "spring", "sink", "pipe", "sewer", "dredge", "boat"] },
  { id: "nature", name: "Nature", key: "5", tone: "#62b85f", tools: ["plant"] },
  { id: "build", name: "Build", key: "6", tone: "#e8a83e", tools: ["placeStructure", "demolish"] },
];

/** How a tool takes the brush: its shape and size; its shape alone; or it has none. */
export type Takes = "brush" | "none";
export type ToolInfo = { name: string; key?: string; hint: string; takes: Takes };

export const TOOLS: Partial<Record<ToolId, ToolInfo>> = {
  inspect: { name: "Look", key: "v", hint: "Pan round, and click a thing to open it", takes: "none" },
  paintTerrain: { name: "Paint", key: "b", hint: "Paint the ground", takes: "brush" },
  erase: { name: "Erase", key: "e", hint: "Cut the ground away", takes: "brush" },
  raise: { name: "Raise", key: "r", hint: "Raise the land a step", takes: "brush" },
  lower: { name: "Lower", key: "f", hint: "Lower the land a step", takes: "brush" },
  flatten: { name: "Flatten", key: "t", hint: "Level the land to where the stroke starts", takes: "brush" },
  smooth: { name: "Smooth", key: "m", hint: "Soften the land's steps", takes: "brush" },
  paintRoad: { name: "Pave", key: "p", hint: "Lay road", takes: "brush" },
  eraseRoad: { name: "Unpave", key: "o", hint: "Delete road", takes: "brush" },
  slope: { name: "Slope", key: "u", hint: "Make a step a slope", takes: "brush" },
  unslope: { name: "Unslope", key: "i", hint: "Make a slope a step again", takes: "brush" },
  pourWater: { name: "Pour", key: "j", hint: "Pour on what is picked", takes: "brush" },
  drainWater: { name: "Drain", key: "k", hint: "Take the water off", takes: "brush" },
  spring: { name: "Spring", key: "l", hint: "Water that keeps coming", takes: "brush" },
  sink: { name: "Sink", key: ";", hint: "Water that keeps going", takes: "brush" },
  pipe: { name: "Main", key: "'", hint: "Drag from water to a building that drinks", takes: "none" },
  sewer: { name: "Sewer", key: "s", hint: "Drag from water, or a slop port, to lay a sewer", takes: "none" },
  dredge: { name: "Dredge", key: "q", hint: "Drag along a river to deepen it", takes: "none" },
  boat: { name: "Boat", key: "h", hint: "Click water for a boat; click a boat to take it off", takes: "none" },
  plant: { name: "Plant", key: "w", hint: "Drag to plant", takes: "none" },
  placeStructure: { name: "Place", key: "n", hint: "Put up the building picked", takes: "none" },
  demolish: { name: "Demolish", key: "x", hint: "Take a building down", takes: "none" },
};

/** Tools that lay out along a line whatever the brush was. */
const LINED: ReadonlySet<ToolId> = new Set<ToolId>(["pipe", "sewer", "dredge", "demolish"]);

/** Which tool each key picks. @see useEditKeys */
export const TOOL_KEYS: Readonly<Record<string, ToolId>> = Object.fromEntries(
  (Object.entries(TOOLS) as [ToolId, ToolInfo][]).flatMap(([id, t]) => (t.key ? [[t.key, id]] : [])),
);

export const groupOf = (tool: ToolId): Group => GROUPS.find((g) => g.tools.includes(tool)) ?? GROUPS[0];
export const groupById = (id: GroupId): Group => GROUPS.find((g) => g.id === id)!;

/** How each group's brush was left, and the tool last in hand from it. */
const brushes = new Map<GroupId, { brush: BrushId; radius: number }>();
const lasts = new Map<GroupId, ToolId>();

/** Take a tool in hand, with its group's brush as it was left. */
export function pickTool(tool: ToolId): void {
  const st = useWorldStore.getState(), was = groupOf(st.tool), to = groupOf(tool);
  if (TOOLS[st.tool]?.takes === "brush") brushes.set(was.id, { brush: st.brush, radius: st.brushRadius });
  lasts.set(to.id, tool);
  st.setTool(tool);
  if (tool === "plant") { st.setPlanting(st.planting); st.setBrushRadius(0); return; }
  if (TOOLS[tool]?.takes === "brush") {
    const b = brushes.get(to.id) ?? { brush: to.brush ?? "point", radius: 0 };
    st.setBrush(b.brush);
    st.setBrushRadius(b.radius);
  } else {
    st.setBrush(LINED.has(tool) ? "line" : "point");
    st.setBrushRadius(0);
  }
}

/** Take a group's tool in hand: the one last used from it. */
export const pickGroup = (id: GroupId): void => pickTool(lasts.get(id) ?? groupById(id).tools[0]);
