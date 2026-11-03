/**
 * THE CREDITS, after book 5's Ascension: the true ending, each book and how
 * it closed, then on into endless play. Shown once, before the recap.
 * @see ascend, AscensionRecap, plans/ascension-overhaul.md §8
 */
import { useGenerationStore, type PastGeneration } from "../state/generation.store";
import { book as bookOf } from "../game/quests/books";
import { endingOf } from "../game/quests/endings";
import { Backdrop, Button, Text } from "../ui/console";
import { endingColour } from "./negotiation-parts";

export function Credits({ gone, onDone }: { gone: PastGeneration; onDone: () => void }) {
  const past = useGenerationStore((g) => g.past);
  const ending = endingOf(gone.ending);
  // THE FIVE BOOKS, each as the last generation in it closed it.
  const books = ([1, 2, 3, 4, 5] as const).map((id) => ({ b: bookOf(id), e: endingOf(past.filter((p) => p.book === id).pop()?.ending) }));
  return (
    <div role="dialog" aria-label="The credits" className="fixed inset-0 z-50 overflow-y-auto bg-surface-0 text-fg">
      <Backdrop />
      <div className="relative mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center gap-6 p-4 text-center md:p-8">
        <span className="text-[10px] uppercase tracking-widest text-fg-muted">The end</span>
        <span style={{ color: ending ? endingColour(ending.id) : undefined }}>
          <Text as="h2" mode="decipher" text={ending?.name ?? "What You Are"} className="font-display text-4xl tracking-wide md:text-6xl" />
        </span>
        {ending && <p className="max-w-prose text-sm text-fg-muted">{ending.does}</p>}
        <ol className="flex w-full flex-col gap-1">
          {books.map(({ b, e }, k) => (
            <li key={String(b.id)} className="talk-line-in flex justify-between gap-3 border-l-2 border-ai-line bg-surface-1 px-3 py-2 text-left text-sm"
              style={{ animationDelay: `${0.4 + k * 0.25}s` }}>
              <span><span className="text-fg-muted">Book {b.id} · </span>{b.title}</span>
              <b style={{ color: e ? endingColour(e.id) : undefined }}>{e?.name ?? "—"}</b>
            </li>
          ))}
        </ol>
        <p className="talk-line-in text-sm text-fg-muted" style={{ animationDelay: "1.8s" }}>Startup Idle · thank you for playing</p>
        <Button variant="primary" tone="ai" onClick={onDone}>Endless play →</Button>
      </div>
    </div>
  );
}
