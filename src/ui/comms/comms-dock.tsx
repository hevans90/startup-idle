/**
 * COMMS ON THE MAP: one stack at the map's top right, in order of what needs
 * you most — the objective under way and what the AI asks, then events, then
 * reports, then a hint — at most `DOCK_MOST` cards (one on a phone); the rest fold into a
 * "+n" that opens the log. A polite live region; an alert speaks up.
 * @see comms.store, plans/ui-overhaul.md §3.2, §4
 */
import { useEffect, useState, type ReactNode } from "react";

import { useCommsStore, type CommsEntry } from "../../state/comms.store";
import { useQuestStore } from "../../state/quest.store";
import { useWorldStore } from "../../state/world.store";
import { QuestArc } from "../../quest-ui/arc";
import { EventCard, liveEvents } from "../../world/play/event-cards";
import { HintCard } from "../../world/play/hint-card";
import { Badge, Button, Card } from "../console";
import { CommsLog } from "./comms-log";

/** The most cards it shows at once. */
export const DOCK_MOST = 3;

/** A report: what happened, the AI's in its violet. */
export function ReportCard({ e }: { e: CommsEntry }) {
  const dismiss = useCommsStore((s) => s.dismiss);
  return (
    <Card tone={e.from === "ai" ? "ai" : "console"} onClose={() => dismiss(e.id)} className="w-[min(24rem,calc(100vw-1rem))]"
      title={e.title ? <span className="text-[10px] uppercase tracking-widest" style={{ color: e.from === "ai" ? "var(--ui-ai)" : undefined }}>{e.title}</span> : undefined}>
      {e.text && <p className={e.from === "ai" ? "italic" : undefined}>{e.from === "ai" ? `“${e.text}”` : e.text}</p>}
      {e.lines && <ul className="flex flex-col gap-0.5">{e.lines.map((l, k) => <li key={k} className="italic">“{l}”</li>)}</ul>}
    </Card>
  );
}

/**
 * WHAT COMMS SHOWS, in order of what needs you most, and how many more there
 * are: the objective, what the AI asks, events, reports; `DOCK_MOST` at most.
 */
export function dockItems(has: { objective: boolean; offer: boolean; events: readonly number[]; reports: readonly number[] }, most = DOCK_MOST): { shown: string[]; hidden: number } {
  const all = [
    ...(has.objective ? ["quest:tracker"] : []), ...(has.offer ? ["quest:offer"] : []),
    ...has.events.map((id) => `event:${id}`), ...has.reports.map((id) => `report:${id}`),
  ];
  return { shown: all.slice(0, most), hidden: Math.max(0, all.length - most) };
}

/** How many cards: `DOCK_MOST`, or on a phone one, its "+n" the rest. */
export function CommsDock({ most = DOCK_MOST }: { most?: number }) {
  const objective = useQuestStore((s) => !!s.objective);
  const offer = useQuestStore((s) => !!s.offer);
  const events = liveEvents(useWorldStore((s) => s.events));
  const reports = useCommsStore((s) => s.live).filter((e) => e.kind === "report").reverse();
  const logged = useCommsStore((s) => s.log.length);
  const [open, setOpen] = useState(false);
  // What has run its time, taken down.
  useEffect(() => {
    const id = window.setInterval(() => useCommsStore.getState().expire(), 500);
    return () => window.clearInterval(id);
  }, []);

  // IN ORDER of what needs you most. @see dockItems
  const nodes = new Map<string, ReactNode>([
    ...events.map((e) => [`event:${e.id}`, <EventCard e={e} />] as const),
    ...reports.map((r) => [`report:${r.id}`, <ReportCard e={r} />] as const),
  ]);
  const { shown: keys, hidden } = dockItems({ objective, offer, events: events.map((e) => e.id), reports: reports.map((r) => r.id) }, most);
  const shown = keys.map((key) => ({ key, node: nodes.get(key) ?? null }));
  const has = (key: string) => keys.includes(key);

  return (
    <div className="pointer-events-none flex flex-col items-end gap-2" aria-live="polite">
      {(hidden > 0 || logged > 0) && (
        <div className="pointer-events-auto">
          <Button size="sm" variant="quiet" onClick={() => setOpen(true)} aria-label={hidden > 0 ? `${hidden} more, and the log` : "The comms log"}>
            {hidden > 0 && <Badge tone="warn">+{hidden}</Badge>} Log
          </Button>
        </div>
      )}
      <div className="pointer-events-auto flex flex-col items-end gap-2">
        {/* The arc: its tracker and its transmission, each if it has a slot. */}
        {(has("quest:tracker") || has("quest:offer")) && <QuestArc tracker={has("quest:tracker")} offer={has("quest:offer")} />}
        {shown.filter((i) => i.node).map((i) => <div key={i.key}>{i.node}</div>)}
        {/* A hint, last, only with a slot to spare. */}
        {shown.length < most && <HintCard />}
      </div>
      {open && <CommsLog onClose={() => setOpen(false)} />}
    </div>
  );
}
