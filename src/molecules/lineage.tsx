/**
 * THE LINEAGE: every generation, an AI a node down the line — its trait, its
 * Lattice's form, how its book ended — each joined to the founder it fused
 * into. Opened from the founder screen, or the recap. @see AscensionRecap
 */
import { useGenerationStore } from "../state/generation.store";
import { book as bookOf } from "../game/quests/books";
import { endingOf } from "../game/quests/endings";
import { FORM_NAMES } from "../game/quests/finale";
import { trait as traitOf } from "../game/traits";
import { FOUNDERS } from "../game/founders.catalog";
import { Dialog } from "../ui/console";
import { endingColour } from "./negotiation-parts";

export function Lineage({ onClose }: { onClose: () => void }) {
  const past = useGenerationStore((g) => g.past);
  return (
    <Dialog title="The lineage" kicker={`${past.length} generation${past.length === 1 ? "" : "s"}`} tone="ai" wide onClose={onClose}>
      <ol aria-label="Every generation" className="-mx-1 flex max-h-[70vh] flex-col overflow-y-auto px-1 pb-1">
        {past.map((p, k) => {
          const ending = endingOf(p.ending);
          const colour = ending ? endingColour(ending.id) : "var(--ui-ai)";
          const b = bookOf(p.book ?? 1);
          return (
            <li key={p.generation} className="talk-line-in grid grid-cols-[1.5rem_1fr_auto] items-stretch gap-x-3 max-sm:grid-cols-[1.5rem_1fr]"
              style={{ animationDelay: `${k * 0.08}s` }}>
              {/* THE LINE DOWN: an AI a node, the next below it. */}
              <span aria-hidden className="relative flex justify-center">
                {past.length > 1 && <span className={`absolute w-px bg-ai-line ${k === 0 ? "top-5" : "top-0"} ${k === past.length - 1 ? "h-5" : "bottom-0"}`} />}
                <span className="relative mt-4 size-3 rotate-45 border-2 bg-surface-1" style={{ borderColor: colour }} />
              </span>
              <div className="my-1 flex min-w-0 flex-col gap-0.5 border border-line-quiet bg-surface-1 px-3 py-2">
                <span className="text-[10px] uppercase tracking-widest text-fg-muted">Generation {p.generation} · Book {b.id} · {b.title}</span>
                <span className="font-display text-lg text-ai">
                  {traitOf(p.trait).name}{p.also && <> + {traitOf(p.also).name}</>}
                  {p.mutated && <span className="ml-2 align-middle text-[10px] uppercase tracking-widest text-warn">mutated</span>}
                </span>
                <span className="text-xs text-fg-muted">
                  {ending ? <b style={{ color: colour }}>{ending.name}</b> : "Ascended"}
                  {p.form && <> · {FORM_NAMES[p.form]}</>} · +{p.weights} Weights
                </span>
              </div>
              {/* JOINED TO ITS FOUNDER. */}
              <div className="my-1 flex items-center gap-2 max-sm:col-start-2 max-sm:my-0 max-sm:mb-1">
                <span aria-hidden className="h-px w-6 bg-ai-line max-sm:hidden" />
                <span className="border border-ai-line bg-ai-soft px-2 py-1 text-xs">
                  <span className="text-fg-muted">fused into </span><b>{FOUNDERS.find((f) => f.id === p.founder)?.name ?? p.founder}</b>
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </Dialog>
  );
}
