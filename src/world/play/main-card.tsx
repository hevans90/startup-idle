/**
 * World v2 — THE MAIN BEFORE IT IS LAID, and the pump after: a card while the
 * Pipe tool is dragged, saying what the main will cost, what each end is,
 * what it will carry — or why it won't, before you let go — and, once a
 * main is down that cannot lift its water, the pump it needs, one click
 * away. @see previewMain, acceptPump, plans/pipes-overhaul.md §2
 */
import { twMerge } from "tailwind-merge";

import { pipeCost } from "../../game/build-cost";
import { agentsCooled } from "../../game/mains";
import { formatCurrency } from "../../utils/money-utils";
import { mainWet, useWorldStore } from "../../state/world.store";
import { useEffect, useState } from "react";

import { buildCost } from "../../game/build-cost";
import { useTicking } from "../../hooks/use-ticking";
import { MAIN_END, idx, inBounds } from "../grid";
import { structureDef } from "../structures/def";
import { findMains, hasMain, mainReportAt, planMain, previewMain, routeMain, type MainState } from "../water/mains";

const CARD = "border border-primary-300 bg-primary-100/95 px-2 py-1 text-xs shadow dark:border-primary-700 dark:bg-primary-900/95";

export function MainCard() {
  const stroke = useWorldStore((s) => s.stroke);
  const playing = useWorldStore((s) => s.playing);
  const offer = useWorldStore((s) => s.pumpOffer);
  const accept = useWorldStore((s) => s.acceptPump);
  const dismiss = useWorldStore((s) => s.dismissPumpOffer);
  if (!playing) return null;
  if (offer && !stroke) {
    return (
      <div role="status" className={twMerge(CARD, "flex items-center gap-2 border-amber-400 dark:border-amber-600")}>
        <span className="text-amber-800 dark:text-amber-300">{offer.why}.</span>
        <button type="button" onClick={accept}
          className="cursor-pointer border border-primary-400 px-2 py-0.5 hover:bg-primary-200 dark:border-primary-600 dark:hover:bg-primary-800">
          Add a pump: {formatCurrency(offer.price)}
        </button>
        <button type="button" onClick={dismiss} aria-label="Dismiss" className="cursor-pointer px-1 text-primary-500 hover:text-primary-900 dark:text-primary-400 dark:hover:text-primary-100">✕</button>
      </div>
    );
  }
  if (!stroke || stroke.tool !== "pipe") return null;
  const st = useWorldStore.getState();
  const wet = mainWet(st.grid);
  const route = routeMain(st.grid, stroke.anchor, stroke.head, wet);
  if (!route) return <p className={twMerge(CARD, "text-red-700 dark:text-red-400")}>No way through for a main: round buildings, off the water</p>;
  const plan = planMain(st.grid, route, wet);
  if ("refused" in plan) return <p className={twMerge(CARD, "text-red-700 dark:text-red-400")}>{plan.refused}</p>;
  const look = previewMain(st.grid, st.getWaterField(), plan.cells);
  const price = pipeCost(look.fresh).toNumber();
  return (
    <div className={CARD}>
      <p className="flex justify-between gap-4 tabular-nums"><b>Water main · {look.fresh} tiles</b><span>{formatCurrency(price)}</span></p>
      <p className="text-primary-600 dark:text-primary-400">{look.ends.join(" → ")}</p>
      {look.problem
        ? <p className={look.needsPump ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400"}>{look.problem}{look.needsPump ? " — you can add one when it's laid" : ""}</p>
        : <p className="text-emerald-700 dark:text-emerald-400">≈ {look.flow.toFixed(2)} a second · cools about {agentsCooled(look.flow)} agents</p>}
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
const TONE = { good: "text-emerald-700 dark:text-emerald-400", warn: "text-amber-700 dark:text-amber-400", bad: "text-red-700 dark:text-red-400" };

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
  const names = r.outlets.filter((o) => o.building >= 0).map((o) => {
    const s = g.structures.get(o.building);
    return s?.def === "lattice" ? "the Lattice" : structureDef(s?.def ?? "")?.name ?? "a building";
  });
  return (
    <div className={twMerge(CARD, "flex w-80 flex-col gap-0.5")}>
      <p className="flex justify-between gap-2"><b>Water main · {r.length} tiles</b>
        <button type="button" onClick={() => setShut(looked.n)} aria-label="Close" className="cursor-pointer px-1 text-primary-500 hover:text-primary-900 dark:text-primary-400 dark:hover:text-primary-100">✕</button></p>
      <p className={TONE[say.tone]}>{say.text}</p>
      <p className="tabular-nums">
        {r.flow > 0 ? `${r.flow.toFixed(2)} a second · cools ${agentsCooled(r.flow)} agents` : `Could carry ${r.capacity.toFixed(2)} a second`}
        {r.intakes.some((k) => k.surface !== null) && <> · head {(r.head / 2).toFixed(1)} slabs</>}
      </p>
      <p className="text-primary-600 dark:text-primary-400">
        {r.intakes.length ? r.intakes.map((k) => `${k.pump ? "Pump" : "Intake"}${k.surface === null ? " (dry)" : ""}`).join(", ") : "No intake"}
        {" → "}{names.length ? names.join(", ") : "nothing"}
      </p>
      <div className="mt-0.5 flex gap-1">
        {r.state === "no-head" && intake !== undefined && (
          <button type="button" onClick={() => st.offerPump({ x: intake % g.w, y: (intake / g.w) | 0, price: buildCost("pump")?.toNumber() ?? 0, why: say.text })}
            className="cursor-pointer border border-primary-400 px-2 py-0.5 hover:bg-primary-200 dark:border-primary-600 dark:hover:bg-primary-800">Add a pump…</button>
        )}
        <button type="button" onClick={() => st.liftMainAt(looked)}
          className="cursor-pointer border border-primary-400 px-2 py-0.5 hover:bg-primary-200 dark:border-primary-600 dark:hover:bg-primary-800">Lift it</button>
      </div>
    </div>
  );
}
