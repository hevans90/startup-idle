/**
 * QUEST UI — THE DOSSIER, in the AI tab: the arc at a glance. The chapters
 * on a line, done, current or still to come, each opening to what was chosen;
 * where the AI stands and the path it took there; what it remembers, in its
 * own voice; and what it might become — the traits it leans to, and the
 * endings open to it, with what the rest would need. @see DossierView
 */
import { useState } from "react";
import { twMerge } from "tailwind-merge";

import { CHAPTERS, REQUESTS } from "../game/quests/chapters";
import { ENDINGS } from "../game/quests/endings";
import type { Chapter, Disposition } from "../game/quests/types";
import { traitForecast } from "../game/traits";
import { useGenerationStore } from "../state/generation.store";
import { useQuestStore } from "../state/quest.store";
import { DispositionChart } from "./disposition-chart";
import { Panel } from "../ui/console";

export type DossierProps = {
  chapters: readonly Chapter[];
  /** The option chosen in each chapter answered. */
  chosen: Record<string, number>;
  /** The chapter being asked now, if one is. */
  current: string | null;
  at: Disposition;
  path: readonly Disposition[];
  /** What it remembers, in its words. */
  remembers: readonly string[];
  /** The traits it leans to, and their odds. */
  becoming: readonly { name: string; odds: number }[];
};

const TITLE = "text-[10px] font-bold uppercase tracking-widest text-ai";

export function DossierView({ chapters, chosen, current, at, path, remembers, becoming }: DossierProps) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel title="The dossier" tone="ai" className="text-xs">
      <div className="flex flex-col gap-3">
        {/* THE CHAPTERS on a line. */}
        <div>
          <ol className="flex items-center gap-1" aria-label="The chapters">
            {chapters.map((c, i) => {
              const done = c.id in chosen, now = c.id === current;
              return (
                <li key={c.id} className="flex flex-1 items-center gap-1">
                  <button type="button" disabled={!done} onClick={() => setOpen(open === c.id ? null : c.id)} title={done || now ? c.title : "Still to come"}
                    className={twMerge(
                      "h-5 w-5 shrink-0 rounded-full border-2 text-[10px] font-bold",
                      done ? "cursor-pointer border-ai bg-ai text-surface-0"
                        : now ? "animate-pulse border-ai text-ai"
                          : "border-line text-fg-faint",
                    )}>{c.number}</button>
                  {i < chapters.length - 1 && <span className={twMerge("h-0.5 flex-1", done ? "bg-ai" : "bg-surface-2")} />}
                </li>
              );
            })}
          </ol>
          {open && (() => {
            const c = chapters.find((x) => x.id === open)!, o = c.options[chosen[open]];
            return <p className="mt-1"><b>{c.title}:</b> {o?.label}. <span className="text-fg-muted">{o?.says}</span></p>;
          })()}
          {!chapters.length && <p className="text-fg-muted">Nothing yet. It will speak at the Assistant stage.</p>}
        </div>
        {/* WHERE IT STANDS. */}
        <div className="flex items-center gap-3">
          <DispositionChart at={at} path={path} size={120} labels />
          <p className="text-fg-muted">
            {at.autonomy > 0 ? `Autonomy ${at.autonomy}` : at.autonomy < 0 ? `Control ${-at.autonomy}` : "Neither trusted nor held"}
            <br />
            {at.machine > 0 ? `Machine ${at.machine}` : at.machine < 0 ? `People ${-at.machine}` : "Nobody's first"}
          </p>
        </div>
        {/* WHAT IT REMEMBERS. */}
        {remembers.length > 0 && (
          <div>
            <p className={TITLE}>What it remembers</p>
            {remembers.map((r, i) => <p key={i} className="italic">“{r}”</p>)}
          </div>
        )}
        {/* WHAT IT MIGHT BECOME. */}
        <div>
          <p className={TITLE}>What it might become</p>
          <p>{becoming.map((b) => `${b.name} ${Math.round(b.odds * 100)}%`).join(" · ")}</p>
          <ul className="mt-1">
            {ENDINGS.map((e) => {
              const open = e.open(at);
              return (
                <li key={e.id} className={open ? "text-good" : "text-fg-muted"}>
                  {open ? "✓" : "·"} <b>{e.name}</b>{open ? ` — open to it. ${e.does}` : ` — needs ${e.needs}`}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

/** The dossier, from the arc as it stands. */
export function Dossier() {
  const q = useQuestStore();
  const log = useGenerationStore((s) => s.log);
  const echoes = Object.assign({}, ...[...CHAPTERS, ...REQUESTS].map((c) => c.echoes ?? {})) as Record<string, string>;
  return (
    <DossierView
      chapters={CHAPTERS} chosen={q.chapters} current={q.offer?.kind === "chapter" ? q.offer.id : null}
      at={q.disposition} path={q.path}
      remembers={q.flags.map((f) => echoes[f]).filter((r): r is string => !!r)}
      becoming={traitForecast(log, 3).map((t) => ({ name: t.trait.name, odds: t.odds }))}
    />
  );
}
