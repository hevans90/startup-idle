/**
 * THE CULTURE DECK, as the player plays it (a greybox: the flow first, the
 * look after): the points the managers' tiers give, the slots, the offers
 * waiting with their rerolls, the cards owned with their ranks, and how near
 * each track is to its next card. @see game/culture
 */
import { CARDS, MAX_RANK, card, cardAt, rankPrice, rerollSeconds, says, slotPrice, type CardId, type Tag, type Track } from "../../game/culture";
import { useTicking } from "../../hooks/use-ticking";
import { useGeneratorStore } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { Button, Chip, Meter, Panel, Tile } from "../../ui/console";
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

export function CultureDeckPanel() {
  useTicking(1000);
  const managers = useInnovationStore((s) => s.managers);
  const innovation = useInnovationStore((s) => s.innovation);
  const deck = useGeneratorStore((s) => s.employeeManagement.deck);
  const g = useGeneratorStore.getState();
  const points = g.getDeckPoints();
  const ips = g.getInnovationPerSecond();
  const owned = CARDS.filter((c) => deck.ranks[c.id]);

  return (
    <Panel title="Culture deck"
      help="Manager tiers are points: spend them on slots or on a card's next rank. Each track deals its own cards. Swapping cards is free; morale drifts."
      controls={<span className="whitespace-nowrap text-[10px] uppercase tracking-widest text-fg-muted">{points} {points === 1 ? "point" : "points"}</span>}>
      <div className="flex flex-col gap-4">
        {/* OFFERS waiting, oldest first. */}
        {deck.offers.map((o, k) => {
          const price = rerollSeconds(o) * ips;
          return (
            <section key={k} aria-label={`${TRACK_NAME[o.track]} offer`} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-display uppercase tracking-wider">{TRACK_NAME[o.track]} offers: pick one</span>
                <Button size="sm" variant="quiet" disabled={innovation.lt(price)} onClick={() => g.rerollOffer(k)}>
                  Reroll · {formatCurrency(price, { showDollarSign: false })}
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                {o.cards.map((id) => (
                  <Tile key={id} lit onClick={() => g.takeCard(k, id)} className="px-2 py-1.5"><Face id={id} rank={1} /></Tile>
                ))}
              </div>
            </section>
          );
        })}

        {/* SLOTS: what is in force. */}
        <section aria-label="Slots" className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-display uppercase tracking-wider">Slots</span>
            <Button size="sm" variant="secondary" disabled={points < slotPrice(deck)} onClick={g.buySlot}>
              + Slot · {slotPrice(deck)} pts
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {Array.from({ length: deck.slots }, (_, k) => deck.slotted[k]).map((id, k) => id
              ? <Tile key={id} selected onClick={() => g.toggleCard(id)} title="Take it out" className="px-2 py-1.5"><Face id={id} rank={deck.ranks[id]!} /></Tile>
              : <div key={`empty${k}`} className="flex min-h-14 items-center justify-center border border-dashed border-line-quiet text-[10px] uppercase tracking-wider text-fg-muted">Empty</div>)}
          </div>
        </section>

        {/* EVERY CARD OWNED, with its rank. */}
        {owned.length > 0 && (
          <section aria-label="Cards owned" className="flex flex-col gap-1.5">
            <span className="text-xs font-display uppercase tracking-wider">Owned</span>
            {owned.map((c) => {
              const rank = deck.ranks[c.id]!, price = rankPrice(deck, c.id), on = deck.slotted.includes(c.id);
              return (
                <div key={c.id} className="flex items-center gap-2 border border-line-quiet px-2 py-1.5">
                  <div className="min-w-0 flex-1"><Face id={c.id} rank={rank} /></div>
                  <span className="shrink-0 text-[10px] tabular-nums text-fg-muted">R{rank}/{MAX_RANK}</span>
                  {price !== null && (
                    <Button size="sm" disabled={points < price} onClick={() => g.rankUpCard(c.id)}>Rank up · {price} pts</Button>
                  )}
                  <Button size="sm" variant="quiet" disabled={!on && deck.slotted.length >= deck.slots} onClick={() => g.toggleCard(c.id)}>
                    {on ? "Unslot" : "Slot"}
                  </Button>
                </div>
              );
            })}
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
