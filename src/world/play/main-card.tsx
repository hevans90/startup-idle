/**
 * World v2 — THE MAIN BEFORE IT IS LAID, and the pump after: a card while the
 * Pipe tool is dragged, saying what the main will cost, what each end is,
 * what it will carry — or why it won't, before you let go — and, once a
 * main is down that cannot lift its water, the pump it needs, one click
 * away. @see previewMain, acceptPump, plans/pipes-overhaul.md §2
 */
import { twMerge } from "tailwind-merge";

import { Button, Card } from "../../ui/console";

import { pipeCost } from "../../game/build-cost";
import { agentsCooled } from "../../game/mains";
import { formatCurrency } from "../../utils/money-utils";
import { mainWet, useWorldStore } from "../../state/world.store";
import { useEffect, useState } from "react";

import { boreCost, buildCost } from "../../game/build-cost";
import { useTicking } from "../../hooks/use-ticking";
import { MAIN_BORE, MAIN_END, idx, inBounds } from "../grid";
import { structureDef } from "../structures/def";
import { findMains, hasMain, mainReportAt, planMain, previewMain, routeMain, type MainState } from "../water/mains";

const CARD = "border border-line bg-surface-1/95 px-2 py-1 text-xs shadow";

export function MainCard() {
  const stroke = useWorldStore((s) => s.stroke);
  const playing = useWorldStore((s) => s.playing);
  const offer = useWorldStore((s) => s.pumpOffer);
  const accept = useWorldStore((s) => s.acceptPump);
  const dismiss = useWorldStore((s) => s.dismissPumpOffer);
  if (!playing) return null;
  if (offer && !stroke) {
    return (
      <div role="status" className={twMerge(CARD, "flex items-center gap-2 border-warn")}>
        <span className="text-warn">{offer.why}.</span>
        <button type="button" onClick={accept}
          className="cursor-pointer border border-line px-2 py-0.5 hover:bg-surface-2">
          Add a pump: {formatCurrency(offer.price)}
        </button>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="cursor-pointer px-1 text-fg-muted hover:text-fg">✕</button>
      </div>
    );
  }
  if (!stroke || stroke.tool !== "pipe") return null;
  const st = useWorldStore.getState();
  const wet = mainWet(st.grid);
  const route = routeMain(st.grid, stroke.anchor, stroke.head, wet);
  if (!route) return <p className={twMerge(CARD, "text-bad")}>No way through for a main: round buildings, off the water</p>;
  const plan = planMain(st.grid, route, wet);
  if ("refused" in plan) return <p className={twMerge(CARD, "text-bad")}>{plan.refused}</p>;
  const look = previewMain(st.grid, st.getWaterField(), plan.cells);
  const price = pipeCost(look.fresh).toNumber();
  return (
    <div className={CARD}>
      <p className="flex justify-between gap-4 tabular-nums"><b>Water main · {look.fresh} tiles</b><span>{formatCurrency(price)}</span></p>
      <p className="text-fg-muted">{look.ends.join(" → ")}</p>
      {look.problem
        ? <p className={look.needsPump ? "text-warn" : "text-bad"}>{look.problem}{look.needsPump ? " — you can add one when it's laid" : ""}</p>
        : <p className="text-good">≈ {look.flow.toFixed(2)} a second · cools about {agentsCooled(look.flow)} agents</p>}
    </div>
  );
}

/** What each state means, said plainly. @see MainState */
const SAYS: Record<MainState, { text: string; tone: "good" | "warn" | "bad" }> = {
  flowing: { text: "Carrying water", tone: "good" },
  full: { text: "Every tank it feeds is full: it carries more as they drink", tone: "good" },
  dry: { text: "Dry: the water at its intake has gone", tone: "bad" },
  "no-head": { text: "The water is too low to reach the building: it needs a pump", tone: "warn" },
  unpaid: { text: "Its pump has stopped: not enough money to run it", tone: "bad" },
  "no-source": { text: "Draws from nothing: one end must be at water", tone: "bad" },
  "no-outlet": { text: "Feeds nothing: one end must be beside a building that drinks", tone: "bad" },
};
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
  if (!playing || !looked || shut === looked.n || tool !== "inspect") return null;
  const st = useWorldStore.getState(), g = st.grid;
  if (!inBounds(g, looked.x, looked.y) || !hasMain(g, idx(g, looked.x, looked.y))) return null;
  const r = mainReportAt(g, looked.x, looked.y);
  if (!r) return null;
  const say = SAYS[r.state];
  const net = findMains(g).list[findMains(g).of[idx(g, looked.x, looked.y)]];
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
        {r.flow > 0 ? `${r.flow.toFixed(2)} a second · cools ${agentsCooled(r.flow)} agents` : `Could carry ${r.capacity.toFixed(2)} a second`}
        {r.intakes.some((k) => k.surface !== null) && <> · head {(r.head / 2).toFixed(1)} slabs</>}
      </p>
      <p className="text-fg-muted">
        {r.intakes.length ? r.intakes.map((k) => `${k.pump ? "Pump" : "Intake"}${k.surface === null ? " (dry)" : ""}`).join(", ") : "No intake"}
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
    </Card>
  );
}
