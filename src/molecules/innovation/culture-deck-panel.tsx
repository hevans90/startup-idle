/**
 * THE CULTURE DECK, in the Innovation tab: what is in force at a glance, the
 * points to spend, a pulsing button while offers wait, and how near each
 * track is to its next card. The deck itself is played on its board. @see CultureBoard
 */
import { useState } from "react";

import { card, cardAt, type Track } from "../../game/culture";
import { useTicking } from "../../hooks/use-ticking";
import { useGeneratorStore } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { Button, Meter, Panel } from "../../ui/console";
import { toneVar } from "../../ui/console/frame";
import { CultureBoard } from "./culture/culture-board";
import { TAG_TONE, TagMark } from "./culture/culture-card";

const TRACK_NAME: Record<Track, string> = { agile: "Agile", corpo: "Corpo", sales: "Sales" };

export function CultureDeckPanel() {
  useTicking(1000);
  const managers = useInnovationStore((s) => s.managers);
  const deck = useGeneratorStore((s) => s.employeeManagement.deck);
  const points = useGeneratorStore.getState().getDeckPoints();
  // The board, open: on its offers first when opened from the button.
  const [open, setOpen] = useState<null | "deck" | "offer">(null);
  const offers = deck.offers.length;

  return (
    <Panel title="Culture deck"
      help="Manager tiers are points: spend them on slots or on a card's next rank. Each track deals its own cards. Swapping cards is free; morale drifts."
      controls={<span className="whitespace-nowrap text-[10px] uppercase tracking-widest text-fg-muted">{points} {points === 1 ? "point" : "points"}</span>}>
      {open && <CultureBoard offerFirst={open === "offer"} onClose={() => setOpen(null)} />}
      <div className="flex flex-col gap-4">
        {offers > 0 && (
          <Button variant="primary" className="w-full animate-pulse" onClick={() => setOpen("offer")}>
            {offers} {offers === 1 ? "card offer" : "card offers"} waiting
          </Button>
        )}

        {/* IN FORCE: each slot, a line. */}
        <button type="button" onClick={() => setOpen("deck")} className="group flex cursor-pointer flex-col gap-1 text-left">
          <span className="flex items-baseline justify-between text-xs">
            <span className="font-display uppercase tracking-wider">In force · {deck.slotted.length}/{deck.slots}</span>
            <span className="text-[10px] uppercase tracking-widest text-fg-muted group-hover:text-fg">Open deck ›</span>
          </span>
          {Array.from({ length: deck.slots }, (_, k) => deck.slotted[k]).map((id, k) => {
            if (!id) return <span key={`e${k}`} className="border border-dashed border-line-quiet px-2 py-1 text-[10px] uppercase tracking-wider text-fg-muted">Empty slot</span>;
            const c = card(id), rank = deck.ranks[id]!;
            return (
              <span key={id} style={toneVar(TAG_TONE[c.tag])} className="flex items-center gap-2 border border-l-2 border-line-quiet border-l-tone px-2 py-1 group-hover:border-line-strong group-hover:border-l-tone">
                <TagMark tag={c.tag} className="h-3.5 w-3.5 text-tone" />
                <span className="flex-1 text-xs">{c.name}</span>
                <span className="flex gap-0.5">{[1, 2, 3].map((r) => <span key={r} className={`h-1.5 w-1.5 rotate-45 border border-tone ${r <= rank ? "bg-tone" : ""}`} />)}</span>
              </span>
            );
          })}
        </button>

        {/* NEXT CARD, each track. */}
        <section aria-label="Next card" className="flex flex-col gap-1.5">
          <span className="text-xs font-display uppercase tracking-wider">Next card</span>
          {(Object.keys(TRACK_NAME) as Track[]).map((t) => {
            const tier = managers[t].tier.floor().toNumber(), n = deck.dealt[t];
            const from = n ? cardAt(n - 1) : 0, to = cardAt(n);
            return <Meter key={t} label={TRACK_NAME[t]} value={(tier - from) / (to - from)} detail={`${tier}/${to} tiers`} />;
          })}
        </section>
      </div>
    </Panel>
  );
}
