/**
 * THE CULTURE DECK, as the player plays it (a greybox: the flow first, the
 * look after): the points the managers' tiers give, the slots, a chip for
 * the offers waiting (a picker, with rerolls), the cards out of the slots, and how near
 * each track is to its next card. @see game/culture
 */
import { useCallback, useEffect, useState } from "react";

import { CARDS, MAX_RANK, card, cardAt, rankPrice, rerollSeconds, says, slotPrice, type CardId, type Tag, type Track } from "../../game/culture";
import { useTicking } from "../../hooks/use-ticking";
import { useGeneratorStore } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { Button, Chip, Dialog, Meter, Panel, Tile } from "../../ui/console";
import type { Tone } from "../../ui/console/frame";
import { formatCurrency } from "../../utils/money-utils";

const TAG_TONE: Record<Tag, Tone> = { hustle: "warn", wellness: "good", growth: "money", chaos: "juice" };
const TRACK_NAME: Record<Track, string> = { agile: "Agile", corpo: "Corpo", sales: "Sales" };

const TagChip = ({ tag }: { tag: Tag }) => <Chip tone={TAG_TONE[tag]}>{tag}</Chip>;

/** A card's face: its name, tag and rank, and its trade at that rank. */
function Face({ id, rank }: { id: CardId; rank: number }) {
  const c = card(id);
  return (
    <span className="flex w-full flex-col items-start gap-1">
      <span className="flex w-full items-baseline justify-between gap-2">
        <span className="text-xs font-bold">{c.name}</span>
        <TagChip tag={c.tag} />
      </span>
      <span className="text-[10px] leading-snug text-fg-muted">{says(c, rank)}</span>
      {c.only && <span className="text-[10px] uppercase tracking-wider text-fg-muted">{c.only.replace("_", " ")}s only</span>}
    </span>
  );
}

/** A card owned, as a row: its face, its rank, and what can be done with it — the next rank, and in or out of a slot. */
function OwnedRow({ id, points, slotFree }: { id: CardId; points: number; slotFree: boolean }) {
  const deck = useGeneratorStore((s) => s.employeeManagement.deck);
  const g = useGeneratorStore.getState();
  const rank = deck.ranks[id]!, price = rankPrice(deck, id), on = deck.slotted.includes(id);
  return (
    <div className={`flex flex-col gap-1.5 border px-2 py-1.5 ${on ? "border-console bg-console-soft" : "border-line-quiet"}`}>
      <Face id={id} rank={rank} />
      <div className="flex items-center gap-2">
        <span className="text-[10px] tabular-nums text-fg-muted">Rank {rank}/{MAX_RANK}</span>
        <span className="flex-1" />
        {price !== null && (
          <Button size="sm" disabled={points < price} onClick={() => g.rankUpCard(id)}>Rank up · {price} pts</Button>
        )}
        <Button size="sm" variant="quiet" disabled={!on && !slotFree} onClick={() => g.toggleCard(id)}>
          {on ? "Unslot" : "Slot"}
        </Button>
      </div>
    </div>
  );
}

/** THE OFFER PICKER: the oldest offer waiting, three cards to take one of, and its reroll; the next offer after it, till none are left. */
function OfferPicker({ onClose }: { onClose: () => void }) {
  useTicking(1000);
  const innovation = useInnovationStore((s) => s.innovation);
  const deck = useGeneratorStore((s) => s.employeeManagement.deck);
  const g = useGeneratorStore.getState();
  const o = deck.offers[0];
  useEffect(() => { if (!o) onClose(); }, [o, onClose]);
  if (!o) return null;
  const price = rerollSeconds(o) * g.getInnovationPerSecond();
  return (
    <Dialog title="Pick a card" kicker={`${TRACK_NAME[o.track]} offer · 1 of ${deck.offers.length}`} onClose={onClose} wide
      actions={<Button size="sm" variant="quiet" disabled={innovation.lt(price)} onClick={() => g.rerollOffer(0)}>
        Reroll · {formatCurrency(price, { showDollarSign: false })} innovation
      </Button>}>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {o.cards.map((id) => (
          <Tile key={id} lit onClick={() => g.takeCard(0, id)} className="px-2 py-2"><Face id={id} rank={1} /></Tile>
        ))}
      </div>
    </Dialog>
  );
}

export function CultureDeckPanel() {
  useTicking(1000);
  const managers = useInnovationStore((s) => s.managers);
  const deck = useGeneratorStore((s) => s.employeeManagement.deck);
  const g = useGeneratorStore.getState();
  const points = g.getDeckPoints();
  const [picking, setPicking] = useState(false);
  const close = useCallback(() => setPicking(false), []);
  const slotFree = deck.slotted.length < deck.slots;
  const bench = CARDS.filter((c) => deck.ranks[c.id] && !deck.slotted.includes(c.id));
  const offers = deck.offers.length;

  return (
    <Panel title="Culture deck"
      help="Manager tiers are points: spend them on slots or on a card's next rank. Each track deals its own cards. Swapping cards is free; morale drifts."
      controls={<span className="flex items-center gap-2">
        {offers > 0 && (
          <button type="button" onClick={() => setPicking(true)} className="animate-pulse cursor-pointer">
            <Chip tone="console">{offers} {offers === 1 ? "offer" : "offers"}</Chip>
          </button>
        )}
        <span className="whitespace-nowrap text-[10px] uppercase tracking-widest text-fg-muted">{points} {points === 1 ? "point" : "points"}</span>
      </span>}>
      {picking && <OfferPicker onClose={close} />}
      <div className="flex flex-col gap-4">
        {/* SLOTS: what is in force, with the next rank of each. */}
        <section aria-label="Slots" className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-display uppercase tracking-wider">Slots {deck.slotted.length}/{deck.slots}</span>
            <Button size="sm" variant="secondary" disabled={points < slotPrice(deck)} onClick={g.buySlot}>
              + Slot · {slotPrice(deck)} pts
            </Button>
          </div>
          {deck.slotted.map((id) => <OwnedRow key={id} id={id} points={points} slotFree={slotFree} />)}
          {Array.from({ length: deck.slots - deck.slotted.length }, (_, k) => (
            <div key={k} className="flex min-h-10 items-center justify-center border border-dashed border-line-quiet text-[10px] uppercase tracking-wider text-fg-muted">Empty</div>
          ))}
        </section>

        {/* THE BENCH: cards owned, out of the slots. */}
        {bench.length > 0 && (
          <section aria-label="Unslotted cards" className="flex flex-col gap-1.5">
            <span className="text-xs font-display uppercase tracking-wider">Unslotted</span>
            {bench.map((c) => <OwnedRow key={c.id} id={c.id} points={points} slotFree={slotFree} />)}
          </section>
        )}

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
