/**
 * World v2 — THE MAIN BEFORE IT IS LAID: a card while the Pipe tool has a
 * main in hand, dragged or laid by clicks, saying the whole of what it will
 * cost — its pump and what that costs to run included — what each end is,
 * and what it brings against what the building needs, or why it won't,
 * before it is laid. The pump is chosen here, not offered afterwards; a main
 * already down that cannot lift its water is still offered one from its own
 * card. @see mainStroke, acceptPump, plans/pipe-network.md §8
 */
import { coolingKept } from "../../game/pollution";
import { twMerge } from "tailwind-merge";

import { Button, Card, IconButton } from "../../ui/console";

import { pipeCost } from "../../game/build-cost";
import { agentsCooled } from "../../game/mains";
import { formatCurrency } from "../../utils/money-utils";
import { mainWet, useWorldStore } from "../../state/world.store";
import { useEffect, useState } from "react";

import { boreCost, buildCost } from "../../game/build-cost";
import { useTicking } from "../../hooks/use-ticking";
import { MAIN_BORE, MAIN_END, MAIN_SEWER, SEWER_BORE, idx, inBounds } from "../grid";
import { structureDef } from "../structures/def";
import { findMains, hasMain, mainProfile, mainReportAt, planMain, previewSewer, type MainReport } from "../water/mains";
import { sewerProfile } from "../pipes/profile";
import { PipeProfileStrip } from "./pipe-profile";
import { mainStroke } from "../water/main-stroke";
import { strokeRoute } from "../pipes/stroke-route";
import { pumpUpkeep } from "../../game/cooling";
import { useGeneratorStore } from "../../state/generators.store";
import { SAYS, sayOf } from "../water/main-says";
import { lateralsOf, sewerReportsFor } from "../sewers/flow";
import { planNode, planStormDrain } from "../sewers/lay";
import { hasSewer, solveSewers } from "../sewers/solve";
import type { SewerState } from "../pipes/report";

const CARD = "border border-line-quiet bg-surface-1/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-sm";

export function MainCard() {
  const stroke = useWorldStore((s) => s.stroke);
  const playing = useWorldStore((s) => s.playing);
  const offer = useWorldStore((s) => s.pumpOffer);
  const accept = useWorldStore((s) => s.acceptPump);
  const dismiss = useWorldStore((s) => s.dismissPumpOffer);
  if (!playing) return null;
  if (offer && !stroke) {
    return (
      <div role="status" className={twMerge(CARD, "flex items-center gap-2 border-l-2 border-l-warn")}>
        <span className="text-warn">{offer.why}.</span>
        <Button size="sm" variant="primary" tone="warn" onClick={accept}>Add a pump: {formatCurrency(offer.price)}</Button>
        <IconButton label="Dismiss" onClick={dismiss}>✕</IconButton>
      </div>
    );
  }
  if (!stroke || stroke.tool !== "pipe") return null;
  const st = useWorldStore.getState();
  const wet = mainWet(st.grid), sewer = !!stroke.sewer;
  if (sewer) {
    const route = strokeRoute(st.grid, stroke, wet, "connection");
    if (!route) return <p className={twMerge(CARD, "text-bad")}>No way through for a sewer: round buildings, off the water</p>;
    const plan = planMain(st.grid, route, wet, false, true);
    if ("refused" in plan) return <p className={twMerge(CARD, "text-bad")}>{plan.refused}</p>;
    // A SEWER: what it drains into what, and what it can carry.
    const look = previewSewer(st.grid, plan.cells);
    return (
      <div className={CARD}>
        <p className="flex justify-between gap-4 tabular-nums"><b>Sewer · {look.fresh} tiles</b><span>{formatCurrency(pipeCost(look.fresh).toNumber())}</span></p>
        <p className="text-fg-muted">{look.ends.join(" → ")}</p>
        {look.problem ? <p className="text-bad">{look.problem}</p> : <p className="text-good" title={`Carries up to ${look.capacity.toFixed(2)} slop a second`}>Joined up</p>}
      </div>
    );
  }
  // THE WHOLE OF IT, as it will be laid and charged: its pump and what that costs to run included. @see mainStroke
  const m = mainStroke(st.grid, st.getWaterField(), stroke, wet);
  if (m.refused || !m.look) return <p className={twMerge(CARD, "text-bad")}>{m.refused}</p>;
  const look = m.look, need = m.need;
  const upkeep = pumpUpkeep(useGeneratorStore.getState().getMoneyPerSecond());
  return (
    <div className={twMerge(CARD, "min-w-56")}>
      <p className="flex justify-between gap-4 tabular-nums"><b>Water main · {m.fresh} tiles</b><span>{formatCurrency(m.price.total)}</span></p>
      <p className="text-fg-muted">{look.ends.join(" → ")}</p>
      {look.problem ? <p className={look.needsPump ? "text-warn" : "text-bad"}>{look.problem}</p>
        : need ? (
          <p className="flex items-center gap-2 tabular-nums" title={`≈ ${look.flow.toFixed(2)} a second`}>
            <span className={need.share >= 1 ? "text-good" : "text-warn"}>
              {need.agents > 0 ? `Cools ${need.cooled} of ${need.agents} agents` : `${Math.round(need.share * 100)}% of what it needs`}
            </span>
            <span className="h-1 min-w-10 flex-1 bg-surface-3 dark:bg-surface-3">
              <span className={twMerge("block h-full", need.share >= 1 ? "bg-good dark:bg-good" : "bg-warn dark:bg-warn")} style={{ width: `${Math.round(need.share * 100)}%` }} />
            </span>
          </p>
        ) : <p className="text-good" title={`≈ ${look.flow.toFixed(2)} a second`}>Cools about {agentsCooled(look.flow)} agents</p>}
      {m.wantsPump && (
        <p className="mt-0.5 flex items-center justify-between gap-2 tabular-nums">
          <Button size="sm" variant={m.pump ? "primary" : undefined} onClick={st.toggleStrokePump} title="The water stands too low to reach the building without one (P)">
            {m.pump ? "With a pump" : "No pump"}
          </Button>
          {m.pump && <span className="text-fg-muted" title="What the pump costs to run">{formatCurrency(m.price.pump)} + {formatCurrency(upkeep)}/s</span>}
        </p>
      )}
      <PipeProfileStrip profile={m.profile} />
    </div>
  );
}

const TONE = { good: "text-good", warn: "text-warn", bad: "text-bad" };

/**
 * A MAIN, LOOKED AT: clicked with the Look tool, what it is doing and why —
 * its state in plain words, what it carries and cools, its head, each end —
 * with the pump it needs, if it does, and a way to lift it. @see mainReportAt
 */
export function MainInfo() {
  useTicking(500);
  const looked = useWorldStore((s) => s.lookedAt);
  const playing = useWorldStore((s) => s.playing);
  const tool = useWorldStore((s) => s.tool);
  const [shut, setShut] = useState<number | null>(null);
  useEffect(() => { setShut(null); }, [looked?.n]);
  if (!playing || !looked || shut === looked.n) return null;
  const st = useWorldStore.getState(), g = st.grid;
  if (!inBounds(g, looked.x, looked.y) || !hasMain(g, idx(g, looked.x, looked.y))) return null;
  // LOOKED AT, or clicked with its own tool in hand: a water main's with Pipe, a connection's with Sewer.
  const slop = (g.main[idx(g, looked.x, looked.y)] & MAIN_SEWER) !== 0;
  if (tool !== "inspect" && tool !== (slop ? "sewer" : "pipe")) return null;
  const r = mainReportAt(g, looked.x, looked.y);
  if (!r) return null;
  const net = findMains(g).list[findMains(g).of[idx(g, looked.x, looked.y)]];
  if (r.sewer) return <SewerInfo r={r} at={looked} onClose={() => setShut(looked.n)} />;
  const say = SAYS[r.state];
  const intake = net?.intakes.find((i) => g.mainEnd[i] === MAIN_END.intake);
  // WIDENING IT: twice the water through the same run, paid for the tiles not yet widened. @see boreCost
  const narrow = net ? net.cells.filter((i) => !(g.main[i] & MAIN_BORE)).length : 0;
  const names = r.outlets.filter((o) => o.building >= 0).map((o) => {
    const s = g.structures.get(o.building);
    return s?.def === "lattice" ? "the Lattice" : structureDef(s?.def ?? "")?.name ?? "a building";
  });
  // A MAIN LOOKED AT, beside it: a card toned by what it is doing. @see Anchored
  return (
    <Card tone={say.tone} onClose={() => setShut(looked.n)} className="w-80" title={<>{r.bore > 1 ? "Wide water main" : "Water main"} · {r.length} tiles</>}>
      <p className={TONE[say.tone]}>{say.text}</p>
      <p className="tabular-nums">
        <span title={`${r.flow.toFixed(2)} a second of the ${r.capacity.toFixed(2)} it could carry`}>
          {r.flow > 0 ? `Cools ${agentsCooled(r.flow)} agents` : `Could cool ${agentsCooled(r.capacity)} agents`}
        </span>
        {r.intakes.some((k) => k.surface !== null) && <> · water {Math.abs(r.head / 2).toFixed(1)} slabs {r.head >= 0 ? "above" : "below"} the floor</>}
      </p>
      <p className="text-fg-muted">
        {r.intakes.length ? r.intakes.map((k) => `${k.pump ? "Pump" : "Intake"}${k.surface === null ? " (dry)" : k.fouled >= 0.05 ? ` (${Math.round(k.fouled * 100)}% fouled: cools ${Math.round(coolingKept(k.fouled) * 100)}%)` : ""}`).join(", ") : "No intake"}
        {" → "}{names.length ? names.join(", ") : "nothing"}
      </p>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {r.state === "no-head" && intake !== undefined && (
          <Button size="sm" onClick={() => st.offerPump({ x: intake % g.w, y: (intake / g.w) | 0, price: buildCost("pump")?.toNumber() ?? 0, why: say.text })}>Add a pump…</Button>
        )}
        {narrow > 0 && (
          <Button size="sm" onClick={() => st.widenMainAt(looked)} title="Twice the water through the same run">Widen: {formatCurrency(boreCost(narrow).toNumber())}</Button>
        )}
        <Button size="sm" variant="danger" confirm="Lift it? Press again" onClick={() => st.liftMainAt(looked)}>Lift it</Button>
      </div>
      <PipeProfileStrip profile={mainProfile(g, st.getWaterField(), idx(g, looked.x, looked.y))} />
    </Card>
  );
}

/** A SEWER, LOOKED AT: whether it is joined up, the workplaces it drains and where to, and a way to widen or lift it. */
function SewerInfo({ r, at, onClose }: { r: MainReport; at: { x: number; y: number }; onClose: () => void }) {
  const st = useWorldStore.getState(), g = st.grid;
  const lateral = r.sewer!.node !== undefined;
  const say = sayOf(r);
  const net = findMains(g).list[findMains(g).of[idx(g, at.x, at.y)]];
  const narrow = net ? net.cells.filter((i) => !(g.main[i] & MAIN_BORE)).length : 0;
  const nameOf = (id: number) => structureDef(g.structures.get(id)?.def ?? "")?.name ?? "a building";
  const from = r.sewer!.sources.map(nameOf);
  const to = lateral ? ["a manhole"] : [...r.outlets.map((o) => nameOf(o.building)), ...r.sewer!.outfalls.map(() => "the water")];
  return (
    <Card tone={say.tone} onClose={onClose} className="w-80" title={<>{r.bore > 1 ? "Wide " : ""}{lateral ? (r.bore > 1 ? "connection" : "Connection") : r.bore > 1 ? "sewer" : "Sewer"} · {r.length} tiles</>}>
      <p className={TONE[say.tone]}>{say.text}</p>
      <p className="tabular-nums" title={`Carries up to ${r.capacity.toFixed(2)} slop a second`}>Drains {from.length} workplace{from.length === 1 ? "" : "s"}</p>
      <p className="text-fg-muted">{from.length ? from.join(", ") : "No workplace"}{" → "}{to.length ? to.join(", ") : "nothing"}</p>
      <div className="mt-0.5 flex flex-wrap gap-1">
        {narrow > 0 && (
          <Button size="sm" onClick={() => st.widenMainAt(at)} title="Twice the slop through the same run">Widen: {formatCurrency(boreCost(narrow).toNumber())}</Button>
        )}
        <Button size="sm" variant="danger" confirm="Lift it? Press again" onClick={() => st.liftMainAt(at)}>Lift it</Button>
      </div>
    </Card>
  );
}

/** A trunk's state, said plainly. @see SewerState */
const TRUNK_SAYS: Record<SewerState, { text: string; tone: "good" | "warn" | "bad" }> = {
  flowing: { text: "Carrying slop to its exit", tone: "good" },
  idle: { text: "Nothing in it", tone: "good" },
  "no-exit": { text: "No exit yet: it must pour into water or feed a processor", tone: "warn" },
  surcharged: { text: "More than it carries: coming up at a manhole", tone: "bad" },
  "backed-up": { text: "Backed up: its slop is coming up at a manhole", tone: "bad" },
  unpaid: { text: "Its lift station has stopped: not enough money to run it", tone: "bad" },
};

/**
 * A TRUNK, LOOKED AT — or clicked with the Sewer tool in hand: what it is
 * doing, how many workplaces drain into it, and a manhole to be had where it
 * was clicked. @see sewerReportsFor, planNode
 */
export function TrunkInfo() {
  useTicking(500);
  const looked = useWorldStore((s) => s.lookedAt);
  const playing = useWorldStore((s) => s.playing);
  const tool = useWorldStore((s) => s.tool);
  useWorldStore((s) => s.revision);
  const [shut, setShut] = useState<number | null>(null);
  useEffect(() => { setShut(null); }, [looked?.n]);
  if (!playing || !looked || shut === looked.n || (tool !== "inspect" && tool !== "sewer")) return null;
  const st = useWorldStore.getState(), g = st.grid;
  if (!inBounds(g, looked.x, looked.y)) return null;
  const i = idx(g, looked.x, looked.y);
  // A connection lying over it is the nearer thing: its card, not this one.
  if (!hasSewer(g, i) || hasMain(g, i)) return null;
  const solve = solveSewers(g), net = solve.nets[solve.of[i]];
  if (!net) return null;
  const r = sewerReportsFor(g).get(net.id);
  const say = TRUNK_SAYS[r?.state ?? (net.exits.length ? "idle" : "no-exit")];
  const wide = net.cells.every((c) => (g.sewer[c] & SEWER_BORE) !== 0);
  const drains = new Set(lateralsOf(g).filter((l) => l.node !== null && solve.of[l.node] === net.id).flatMap((l) => l.sources)).size;
  const lifts = r?.trunk.lifts.length ?? 0;
  const manhole = !("refused" in planNode(g, looked));
  const storm = !("refused" in planStormDrain(g, looked));
  return (
    <Card tone={say.tone} onClose={() => setShut(looked.n)} className="w-80" title={<>{wide ? "Wide sewer" : "Sewer"} · {net.cells.length} tiles</>}>
      <p className={TONE[say.tone]}>{say.text}</p>
      <p className="tabular-nums" title={r ? `${r.flow.toFixed(2)} slop a second of the ${r.capacity.toFixed(2)} it carries` : undefined}>
        Drains {drains} workplace{drains === 1 ? "" : "s"}{lifts > 0 && <> · {lifts} lift station{lifts === 1 ? "" : "s"}</>}
      </p>
      {(manhole || storm) && (
        <div className="mt-0.5 flex flex-wrap gap-1">
          {manhole && <Button size="sm" onClick={() => st.addManholeAt(looked)} title="Where a workplace's connection comes down into it">Add a manhole here</Button>}
          {storm && <Button size="sm" onClick={() => st.addStormDrainAt(looked)} title="A grate: water standing in the street here goes down it, as much as the sewer can take">Add a storm drain here</Button>}
        </div>
      )}
      <PipeProfileStrip profile={sewerProfile(g, solve, g.sewerFit, i)} />
    </Card>
  );
}
