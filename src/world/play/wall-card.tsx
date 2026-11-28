/**
 * World v2 — A FLOOD WALL, LOOKED AT: its run, what the run keeps out of the
 * flood line, and taking it down. The run and what it keeps dry are picked
 * out on the map meanwhile. @see wallRunInfo, createFloodLine
 */
import { useEffect, useState } from "react";

import { useTicking } from "../../hooks/use-ticking";
import { useWorldStore } from "../../state/world.store";
import { Button, Card } from "../../ui/console";
import { wallRunInfo } from "../events/flood-reach";
import { structureOf } from "../grid";

export function WallCard() {
  useTicking(1000);
  const looked = useWorldStore((s) => s.lookedAt);
  const playing = useWorldStore((s) => s.playing);
  const tool = useWorldStore((s) => s.tool);
  useWorldStore((s) => s.revision);
  const [shut, setShut] = useState<number | null>(null);
  useEffect(() => { setShut(null); }, [looked?.n]);
  if (!playing || !looked || shut === looked.n || tool !== "inspect") return null;
  const g = useWorldStore.getState().grid;
  const s = structureOf(g, looked.x, looked.y);
  if (!s || s.def !== "levee") return null;
  const { run, safe } = wallRunInfo(g, s);
  const cells = run.map((i) => ({ x: i % g.w, y: (i / g.w) | 0 }));
  return (
    <Card onClose={() => setShut(looked.n)} className="w-56" title="Flood wall">
      <p className="tabular-nums text-fg-muted">Run of {run.length}</p>
      <p className={safe.length ? "tabular-nums text-good" : "text-fg-muted"}>
        {safe.length ? `Keeps ${safe.length} building${safe.length === 1 ? "" : "s"} dry` : "Nothing behind it at risk"}
      </p>
      <div className="mt-1 flex gap-1">
        <Button size="sm" variant="danger" confirm="Delete it? Press again" onClick={() => useWorldStore.getState().deleteWalls([{ x: s.x, y: s.y }])}>Delete</Button>
        {run.length > 1 && <Button size="sm" variant="danger" confirm="Delete the run? Press again" onClick={() => useWorldStore.getState().deleteWalls(cells)}>Delete run</Button>}
      </div>
    </Card>
  );
}
