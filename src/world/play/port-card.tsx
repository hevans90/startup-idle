/**
 * World v2 — A SEAPORT, LOOKED AT: its berths, and what each is fitted for.
 * One row a berth; the fitting is chosen there. @see FITTINGS, Anchored
 */
import { useEffect, useState } from "react";

import { agentsOpen } from "../../game/agents";
import { useTicking } from "../../hooks/use-ticking";
import { getTraffic, sewersOpen, useWorldStore } from "../../state/world.store";
import { lands, yardFill } from "../boats/yard";
import { Card } from "../../ui/console";
import { FITTINGS, fitOf, fitsTier } from "../boats/fittings";
import { tradeLevel } from "../boats/trade";
import { loaderFill } from "../boats/slop-loader";
import { structureOf } from "../grid";
import { structureDef } from "../structures/def";

export function PortCard() {
  useTicking(1000);
  const looked = useWorldStore((s) => s.lookedAt);
  const playing = useWorldStore((s) => s.playing);
  const tool = useWorldStore((s) => s.tool);
  useWorldStore((s) => s.revision);
  const setFit = useWorldStore((s) => s.setBerthFit);
  const [shut, setShut] = useState<number | null>(null);
  useEffect(() => { setShut(null); }, [looked?.n]);
  if (!playing || !looked || shut === looked.n || tool !== "inspect") return null;
  const s = structureOf(useWorldStore.getState().grid, looked.x, looked.y);
  const def = s && !s.build ? structureDef(s.def) : null;
  if (!s || !def?.port) return null;
  const berths = def.port.berths;
  const hasYard = Array.from({ length: berths }, (_, k) => fitOf(s, k).id).some(lands);
  const fill = yardFill(getTraffic().yards, s.id, berths);
  const offered = FITTINGS.filter((f) => fitsTier(f, def.port!.berths) && (f.needs !== "datacentre" || agentsOpen()) && (f.needs !== "sewers" || sewersOpen()));
  return (
    <Card onClose={() => setShut(looked.n)} className="w-72" title={<span className="capitalize">{def.name}</span>}>
      {Array.from({ length: def.port.berths }, (_, k) => {
        const fit = fitOf(s, k);
        // A trade's meter; or, for a slop loader, how full its tank stands.
        const level = fit.keeps ? tradeLevel(fit.keeps) : fit.id === "slop" ? loaderFill(useWorldStore.getState().grid, s) : null;
        return (
          <label key={k} className="flex items-center gap-2 py-0.5" title={fit.does}>
            <span className="w-12 shrink-0 whitespace-nowrap text-fg-muted">Berth {k + 1}</span>
            <select value={fit.id} onChange={(e) => setFit(s.id, k, e.target.value)}
              className="min-w-0 flex-1 cursor-pointer border border-line-quiet bg-surface-2 px-1 py-0.5 text-xs text-fg dark:bg-surface-2 dark:text-fg">
              {offered.map((f) => <option key={f.id} value={f.id} title={f.does}>{f.name}</option>)}
            </select>
            {level !== null && (
              <span className="h-1 w-10 shrink-0 bg-surface-3 dark:bg-surface-3" title={fit.does}>
                <span className="block h-full bg-good dark:bg-good" style={{ width: `${Math.round(level * 100)}%` }} />
              </span>
            )}
          </label>
        );
      })}
      {hasYard && (
        <p className="mt-0.5 flex items-center gap-2" title="A full yard slows the cranes; lorries empty it by road">
          <span className="w-12 shrink-0 text-fg-muted">Yard</span>
          <span className="h-1 flex-1 bg-surface-3 dark:bg-surface-3">
            <span className={fill > 0.75 ? "block h-full bg-warn dark:bg-warn" : "block h-full bg-good dark:bg-good"} style={{ width: `${Math.round(fill * 100)}%` }} />
          </span>
        </p>
      )}
    </Card>
  );
}
