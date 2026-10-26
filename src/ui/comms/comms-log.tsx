/**
 * THE COMMS LOG: everything comms has said this session — alerts, the AI's
 * transmissions, reports — newest first, filtered by kind, so nothing is lost
 * because its card timed out. @see comms.store
 */
import { useState } from "react";

import { useCommsStore, type CommsEntry } from "../../state/comms.store";
import { Dialog, Segmented } from "../console";

type Filter = "all" | "alert" | "ai" | "report";
const SHOWS: Record<Filter, (e: CommsEntry) => boolean> = {
  all: () => true,
  alert: (e) => e.kind === "alert",
  ai: (e) => e.from === "ai" || e.kind === "transmission",
  report: (e) => e.kind === "report" && e.from !== "ai",
};
const KIND: Record<string, string> = { alert: "Alert", transmission: "Transmission", report: "Report", notice: "Notice", hint: "Hint" };

/** A time of day, hh:mm. */
const when = (at: number) => new Date(at).toTimeString().slice(0, 5);

export function CommsLog({ onClose }: { onClose: () => void }) {
  const log = useCommsStore((s) => s.log);
  const [filter, setFilter] = useState<Filter>("all");
  const rows = log.filter(SHOWS[filter]).slice().reverse();
  return (
    <Dialog title="Comms log" kicker="This session" onClose={onClose} wide>
      <div className="flex flex-col gap-2">
        <Segmented label="Show" value={filter} onChange={setFilter}
          options={[{ value: "all", label: "All" }, { value: "alert", label: "Alerts" }, { value: "ai", label: "The AI" }, { value: "report", label: "Reports" }]} />
        <ol className="flex max-h-[55vh] flex-col gap-1 overflow-y-auto text-xs">
          {rows.map((e) => (
            <li key={e.id} className="grid grid-cols-[3rem_6.5rem_1fr] gap-2 border-b border-line-quiet py-1">
              <span className="tabular-nums text-fg-faint">{when(e.at)}</span>
              <span style={{ color: e.from === "ai" || e.kind === "transmission" ? "var(--ui-ai)" : e.kind === "alert" ? "var(--ui-warn)" : "var(--ui-fg-muted)" }}>
                {e.title ?? KIND[e.kind]}
              </span>
              <span>{e.text}{e.lines && <span className="text-fg-muted"> {e.lines.join(" · ")}</span>}</span>
            </li>
          ))}
          {!rows.length && <li className="text-fg-muted">Nothing yet.</li>}
        </ol>
      </div>
    </Dialog>
  );
}
