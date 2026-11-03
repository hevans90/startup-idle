/**
 * THE RECAP: the generation just gone, said once, as the next is founded —
 * its book and how it ended, the companies sold, each chapter's choice, the
 * trait drawn (and whether it mutated), the Weights banked, the ring of the
 * Machine it revealed. Then the lineage, or on. @see ascend, Lineage
 */
import { useQuestStore } from "../state/quest.store";
import { useGenerationStore, type PastGeneration } from "../state/generation.store";
import { book as bookOf, chapterKicker, chapterOf } from "../game/quests/books";
import { endingOf } from "../game/quests/endings";
import { FORM_NAMES } from "../game/quests/finale";
import { ringRevealed } from "../game/machine";
import { trait as traitOf } from "../game/traits";
import { FOUNDERS } from "../game/founders.catalog";
import { Backdrop, Button, CountUp, Frame, Text } from "../ui/console";
import { endingColour } from "./negotiation-parts";

const Label = ({ children }: { children: string }) => <dt className="text-[10px] uppercase tracking-widest text-fg-muted">{children}</dt>;

export function AscensionRecap({ gone, onLineage, onDone }: { gone: PastGeneration; onLineage: () => void; onDone: () => void }) {
  const record = useQuestStore((q) => q.record.find((r) => r.generation === gone.generation));
  const past = useGenerationStore((g) => g.past.length);
  const b = bookOf(gone.book ?? 1);
  const ending = endingOf(gone.ending);
  // EACH CHAPTER'S CHOICE, in the book's order, its dark chapter last.
  const order = [...b.chapters, ...(b.dark ? [b.dark] : [])].map((c) => c.id);
  const chosen = Object.entries(record?.chapters ?? {})
    .sort(([x], [y]) => order.indexOf(x) - order.indexOf(y))
    .map(([id, i]) => ({ c: chapterOf(id, b), i }))
    .filter((x) => x.c);
  const ring = ringRevealed(gone.generation);
  const founder = FOUNDERS.find((f) => f.id === gone.founder)?.name ?? gone.founder;
  return (
    <div role="dialog" aria-label="The generation just gone" className="fixed inset-0 z-50 overflow-y-auto bg-surface-0 text-fg">
      <Backdrop />
      <div className="relative mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-5 p-4 md:p-8">
        <header className="card-slot-in flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-fg-muted">Generation {gone.generation} · Book {b.id} · {b.title}</span>
          <span style={{ color: ending ? endingColour(ending.id) : undefined }}>
            <Text as="h2" mode="decipher" text={ending ? `Ended on ${ending.name}` : "Ascended"} className="font-display text-3xl tracking-wide md:text-5xl" />
          </span>
          {ending && <p className="max-w-prose text-sm text-fg-muted">{ending.does}</p>}
        </header>

        <Frame kind="octagon" tone="ai" assemble="always" className="card-slot-in text-fg">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-5 sm:grid-cols-4">
            <div><Label>Companies sold</Label><dd className="font-display text-2xl tabular-nums">{gone.sales ?? "—"}</dd></div>
            <div><Label>Weights banked</Label><dd><CountUp to={gone.weights} format={(v) => `+${Math.round(v)}`} role="weights" className="font-display text-2xl" /></dd></div>
            <div>
              <Label>It became</Label>
              <dd className="font-display text-2xl text-ai">{traitOf(gone.trait).name}{gone.also && <span className="text-base"> + {traitOf(gone.also).name}</span>}</dd>
              <dd className="text-xs text-fg-muted">{gone.mutated ? <b className="text-warn">Mutated</b> : "As it leant"} · fused into {founder}</dd>
            </div>
            <div>
              <Label>Revealed</Label>
              <dd className="font-display text-base">{ring ?? "Nothing more"}</dd>
              {gone.form && <dd className="text-xs text-fg-muted">Its Lattice: {FORM_NAMES[gone.form]}</dd>}
            </div>
          </dl>
        </Frame>

        {chosen.length > 0 && (
          <section aria-label="Each chapter's choice" className="flex flex-col gap-1.5">
            <h3 className="text-[10px] uppercase tracking-widest text-fg-muted">The book, as you wrote it</h3>
            <ol className="flex flex-col gap-1">
              {chosen.map(({ c, i }, k) => (
                <li key={c!.id} className="talk-line-in grid grid-cols-[12rem_1fr] gap-3 border-l-2 border-ai-line bg-surface-1 px-3 py-2 text-sm max-sm:grid-cols-1 max-sm:gap-0.5"
                  style={{ animationDelay: `${0.3 + k * 0.12}s` }}>
                  <span className="text-[10px] uppercase tracking-widest text-fg-muted">{chapterKicker(c!)} · {c!.title}</span>
                  <span>{c!.options[i]?.label ?? "—"}</span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {past > 0 && <Button variant="secondary" onClick={onLineage}>The lineage</Button>}
          <Button variant="primary" tone="ai" onClick={onDone}>Generation {gone.generation + 1} →</Button>
        </div>
      </div>
    </div>
  );
}
