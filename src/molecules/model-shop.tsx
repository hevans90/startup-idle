/**
 * THE MACHINE, between companies: the second prestige's spending, on the
 * founder screen. Its constellation drawn whole — bought, buyable, out of
 * reach, under the fog — beside the node chosen, what it does and what it
 * costs in Weights (the one under the pointer, else the one clicked); and under them the founders fused with the AI and the
 * generations past. @see game/machine, game/ascension
 */
import { useState } from "react";
import { twMerge } from "tailwind-merge";

import { FOUNDERS } from "../game/founders.catalog";
import { FUSIONS } from "../game/fusion";
import { buyMachine, INHERITANCE, machineBlocked, machineCost, machineGraph, type MachineNode } from "../game/machine";
import { trait } from "../game/traits";
import { useGenerationStore } from "../state/generation.store";
import { Button, FOCUS, Label } from "../ui/console";
import { formatCurrency } from "../utils/money-utils";
import { HudFigure } from "./founding-shell";

const GRAPH = machineGraph();
const BY_ID = new Map(GRAPH.nodes.map((n) => [n.id, n]));
const MACHINE_SIZE = GRAPH.nodes.length;
// The drawing's frame: the constellation round its root, with room for the keystones.
const CX = GRAPH.nodes[0].x, CY = GRAPH.nodes[0].y;
const SPAN = Math.max(...GRAPH.nodes.map((n) => Math.hypot(n.x - CX, n.y - CY))) + 40;
const RADIUS: Record<MachineNode["kind"], number> = { root: 28, keystone: 24, headstart: 24, notable: 18, minor: 11 };
const KIND: Record<MachineNode["kind"], string> = { root: "Root", keystone: "Keystone", headstart: "Head start", notable: "Notable", minor: "Module" };

type Blocked = ReturnType<typeof machineBlocked>;

/** What stands between a node and its buying, in a line and a colour. */
function status(n: MachineNode, blocked: Blocked, cost: number): { text: string; cls: string } {
  if (blocked === "owned") return { text: n.kind === "root" ? "Granted" : "Bought", cls: "text-good" };
  if (blocked === "fog") return { text: n.kind === "root" ? "Ascend to receive" : "Ascend to reveal", cls: "text-ai" };
  if (blocked === "exclusive") return { text: "Another keystone is bought", cls: "text-bad" };
  if (blocked === "unreached") return { text: "Buy the node before it first", cls: "text-warn" };
  if (blocked === "weights") return { text: `${cost} Weights (can't afford)`, cls: "text-bad" };
  return { text: `${cost} Weights`, cls: "text-fg" };
}

/** A node in the drawing, its state in its ring and fill. */
function Node({ n, blocked, chosen, onPick, onHover }: { n: MachineNode; blocked: Blocked; chosen: boolean; onPick: () => void; onHover: (on: boolean) => void }) {
  const r = RADIUS[n.kind];
  const owned = blocked === "owned";
  const fog = blocked === "fog";
  const ring = owned ? "stroke-ai fill-ai" : blocked === null ? "stroke-ai fill-ai-soft" : fog ? "stroke-line fill-none" : blocked === "exclusive" ? "stroke-bad fill-surface-2" : "stroke-line-strong fill-surface-2";
  return (
    <g role="button" tabIndex={0} aria-label={fog ? "Unrevealed node" : n.title} aria-pressed={chosen}
      className={twMerge("cursor-pointer outline-none", FOCUS)} onClick={onPick}
      onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(); } }}>
      {chosen && <circle cx={n.x} cy={n.y} r={r + 9} className="fill-none stroke-ai" strokeWidth={2} strokeDasharray="4 5" />}
      <circle cx={n.x} cy={n.y} r={r} className={twMerge(ring, "transition-colors")} strokeWidth={blocked === null ? 3 : 2}
        strokeDasharray={fog ? "3 5" : undefined} fillOpacity={owned ? 0.85 : 1} />
      {(n.kind === "keystone" || n.kind === "headstart") && !fog && <circle cx={n.x} cy={n.y} r={r - 7} className={owned ? "fill-surface-1" : "fill-none stroke-ai"} strokeWidth={1.5} />}
    </g>
  );
}

/** THE MACHINE, drawn: its edges lit where both ends are bought. */
function MachineMap({ chosen, onPick, onHover }: { chosen: string; onPick: (id: string) => void; onHover: (id: string | null) => void }) {
  useGenerationStore((s) => s.machine);
  useGenerationStore((s) => s.weights);
  const owned = new Set(GRAPH.nodes.filter((n) => machineBlocked(n.id) === "owned").map((n) => n.id));
  return (
    <svg viewBox={`${CX - SPAN} ${CY - SPAN} ${SPAN * 2} ${SPAN * 2}`} className="aspect-square w-full max-h-[60vh]">
      {GRAPH.edges.map(([a, b]) => {
        const p = BY_ID.get(a)!, q = BY_ID.get(b)!;
        const lit = owned.has(a) && owned.has(b);
        return <line key={`${a} ${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={lit ? "stroke-ai" : "stroke-line"} strokeWidth={lit ? 3 : 1.5} />;
      })}
      {GRAPH.nodes.map((n) => <Node key={n.id} n={n} blocked={machineBlocked(n.id)} chosen={n.id === chosen} onPick={() => onPick(n.id)} onHover={(on) => onHover(on ? n.id : null)} />)}
    </svg>
  );
}

/** THE NODE CHOSEN: what it is, what it does, and the buying of it. */
function NodeCard({ id }: { id: string }) {
  useGenerationStore((s) => s.machine);
  useGenerationStore((s) => s.weights);
  const n = BY_ID.get(id)!;
  const blocked = machineBlocked(id);
  const cost = machineCost(id);
  const fog = blocked === "fog" && n.kind !== "root";
  const s = status(n, blocked, cost);
  return (
    <div className="flex flex-col gap-3 self-start border border-line border-t-2 border-t-ai bg-surface-2/60 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-ai">{KIND[n.kind]}{n.kind === "minor" ? ` · ring ${n.ring}` : ""}</Label>
      </div>
      <h3 className="font-display text-lg uppercase tracking-wider">{fog ? "Unrevealed" : n.title}</h3>
      {!fog && <p className="text-sm text-good">{n.effect}</p>}
      {!fog && n.detail && <p className="text-xs leading-snug text-fg-muted">{n.detail}</p>}
      <div className="flex items-center justify-between gap-3 border-t border-line-quiet pt-3">
        <span className={twMerge("text-xs tabular-nums", s.cls)}>{s.text}</span>
        {blocked !== "owned" && blocked !== "fog" && (
          <Button variant="primary" tone="ai" size="sm" disabled={blocked !== null} onClick={() => buyMachine(id)}>Buy</Button>
        )}
      </div>
    </div>
  );
}

export function ModelShop() {
  const g = useGenerationStore();
  const [chosen, setChosen] = useState(INHERITANCE);
  // Under the pointer, previewed; chosen by a click, kept.
  const [hover, setHover] = useState<string | null>(null);
  const founderName = (id: string) => FOUNDERS.find((f) => f.id === id)?.name ?? id;
  const fused = Object.entries(g.fused);
  return (
    <div className="flex flex-col gap-4 text-xs text-fg">
      <div className="flex flex-wrap items-center gap-3">
        <HudFigure label="Weights" value={formatCurrency(g.weights, { showDollarSign: false })} className="text-weights" />
        <HudFigure label="Bought" value={`${g.machine.length} / ${MACHINE_SIZE}`} className="text-ai" />
        <HudFigure label="Gen" value={g.generation} />
      </div>

      <div className="grid items-start gap-4 md:grid-cols-[1fr_17rem]">
        <MachineMap chosen={chosen} onPick={setChosen} onHover={setHover} />
        <NodeCard id={hover ?? chosen} />
      </div>

      {(fused.length > 0 || g.past.length > 0) && (
        <div className="grid gap-4 border-t border-line-quiet pt-3 md:grid-cols-2">
          {/* THE FOUNDERS FUSED WITH THE AI. */}
          {fused.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label>Fused founders</Label>
              {fused.map(([f, traits]) => (
                <div key={f}>
                  <p className="font-bold">{founderName(f)}</p>
                  {traits.map((t, k) => <p key={k}><span className="text-ai">{trait(t).name}</span>: {FUSIONS[t].text}</p>)}
                </div>
              ))}
            </div>
          )}
          {/* THE GENERATIONS PAST. */}
          {g.past.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label>Generations</Label>
              {[...g.past].reverse().map((p) => (
                <p key={p.generation} className="flex justify-between gap-2">
                  <span>{p.generation}. <b>{trait(p.trait).name}</b>{p.mutated ? " (mutated)" : ""} → {founderName(p.founder)}</span>
                  <span className="tabular-nums">+{p.weights}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
