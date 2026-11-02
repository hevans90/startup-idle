/**
 * THE CULTURE BOARD: the deck laid out over the whole screen. Above, the
 * SLOTS — what is in force — each a socket a card drops into; below, THE HAND,
 * the cards owned out of them. A card is dragged to a slot (or tapped: into
 * the first free one, or held till a slot is tapped), dragged back to the hand
 * to come out, ranked up beneath itself. Waiting offers come first, dealt in
 * three at a time to pick from. Calm, nothing moves. @see game/culture, CultureCard
 */
import { useEffect, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { twMerge } from "tailwind-merge";

import { sfx } from "../../../audio/sound";
import { CARDS, MAX_RANK, SET_AT, TAG_SETS, card, inForce, rankPrice, rerollSeconds, slotPrice, tagCounts, type CardId, type Tag, type Track } from "../../../game/culture";
import { useTicking } from "../../../hooks/use-ticking";
import { useGeneratorStore } from "../../../state/generators.store";
import { useInnovationStore } from "../../../state/innovation.store";
import { Backdrop, Button, Label } from "../../../ui/console";
import { FOCUS } from "../../../ui/console/controls";
import { useConsoleMotion } from "../../../ui/motion";
import { formatCurrency } from "../../../utils/money-utils";
import { toneVar } from "../../../ui/console/frame";
import { CARD_CLIP, CultureCard, TAG_NAME, TAG_TONE, TagMark } from "./culture-card";

const TRACK_NAME: Record<Track, string> = { agile: "Agile", corpo: "Corpo", sales: "Sales" };
/** How long a picked card takes to leave, ms. */
const PICK_MS = 420;

const deck = () => useGeneratorStore.getState().employeeManagement.deck;
const dragged = (e: DragEvent) => e.dataTransfer.getData("text/plain") as CardId;

/** Beneath a card, a card's width: a word on it. */
const Under = ({ children }: { children: string }) =>
  <span className="h-6 w-[9.5rem] text-center text-[10px] uppercase leading-6 tracking-wider text-fg-muted">{children}</span>;

/**
 * THE SETS: each tag, its cards in force as four pips, and its three steps —
 * lit as two, three and four of it reach them.
 */
function Sets({ counts }: { counts: Record<Tag, number> }) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {(Object.keys(TAG_SETS) as Tag[]).map((tag) => {
        const n = counts[tag];
        return (
          <div key={tag} style={toneVar(TAG_TONE[tag])} aria-label={`${TAG_NAME[tag]} set, ${n} in force`}
            className={twMerge("flex flex-col gap-1.5 border border-l-2 border-line-quiet border-l-tone bg-surface-1/60 px-2.5 py-2", n >= SET_AT[0] && "border-tone")}>
            <div className="flex items-center gap-1.5">
              <TagMark tag={tag} className="h-3.5 w-3.5 text-tone" />
              <span className="flex-1 font-display text-[11px] uppercase tracking-wider">{TAG_NAME[tag]}</span>
              <span className="flex gap-1" aria-hidden>
                {[1, 2, 3, 4].map((k) => <span key={k} className={twMerge("h-1.5 w-1.5 rotate-45 border border-tone", k <= n && "bg-tone")} />)}
              </span>
            </div>
            <ul className="flex flex-col gap-0.5">
              {TAG_SETS[tag].map((step, k) => {
                const lit = n >= SET_AT[k];
                return (
                  <li key={step.text} className={twMerge("flex gap-1.5 text-[11px] leading-tight", lit ? "text-fg" : "text-fg-muted")}>
                    <span className={twMerge("w-3 shrink-0 tabular-nums", lit ? "text-tone" : "opacity-70")}>{SET_AT[k]}</span>
                    <span className="min-w-0 flex-1">{step.text}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Beneath a card: its next rank's price, if it has one — the last, its rule. */
function RankUp({ id, points, onRanked }: { id: CardId; points: number; onRanked: (id: CardId) => void }) {
  const price = rankPrice(deck(), id);
  if (price === null) return <Under>Top rank</Under>;
  const next = (deck().ranks[id] ?? 1) + 1, rule = next === MAX_RANK;
  return (
    <Button size="sm" variant={rule ? "primary" : "secondary"} disabled={points < price} className="w-[9.5rem]"
      onClick={() => { useGeneratorStore.getState().rankUpCard(id); sfx(rule ? "decision" : "confirm"); onRanked(id); }}>
      Rank {next} · {price} {price === 1 ? "point" : "points"}
    </Button>
  );
}

/** A card that can be picked up: dragged, or tapped. Its shine plays once when it ranks up. */
function Held({ id, rank, shine, held, onTap, onDrag }: {
  id: CardId; rank: number; shine: boolean; held: boolean;
  onTap: () => void; onDrag: (id: CardId | null) => void;
}) {
  return (
    <button type="button" draggable aria-pressed={held}
      onClick={onTap}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", id); e.dataTransfer.effectAllowed = "move"; onDrag(id); }}
      onDragEnd={() => onDrag(null)}
      className={twMerge("card-lift cursor-grab active:cursor-grabbing", FOCUS, held && "card-held")}>
      {/* Its rule unlocked: a flare, as well as the shine. */}
      <CultureCard key={shine && rank >= MAX_RANK ? "ruled" : "card"} id={id} rank={rank} className={shine && rank >= MAX_RANK ? "card-rule-in" : "card-slot-in"}>
        {shine && <span key={rank} aria-hidden className="card-shine pointer-events-none absolute inset-0" style={{ clipPath: CARD_CLIP }} />}
      </CultureCard>
    </button>
  );
}

/** THE OFFER, dealt: three cards to take one of, a reroll, and leaving it for later. */
function OfferStage({ onDone, onLater }: { onDone: () => void; onLater: () => void }) {
  useTicking(1000);
  const innovation = useInnovationStore((s) => s.innovation);
  const d = useGeneratorStore((s) => s.employeeManagement.deck);
  const g = useGeneratorStore.getState();
  const { calm } = useConsoleMotion();
  const [picked, setPicked] = useState<CardId | null>(null);
  const o = d.offers[0];
  useEffect(() => { if (o) sfx("decision"); }, [o?.cards.join(), o?.rerolls]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!o) return null;
  const price = rerollSeconds(o) * g.getInnovationPerSecond();
  const pick = (id: CardId) => {
    if (picked) return;
    setPicked(id);
    sfx("confirm");
    window.setTimeout(() => {
      useGeneratorStore.getState().takeCard(0, id);
      setPicked(null);
      if (!deck().offers.length) onDone();
    }, calm ? 0 : PICK_MS);
  };
  return (
    <section aria-label="Offer" className="flex flex-1 flex-col items-center justify-center gap-6 pb-16 pt-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <Label className="text-fg-muted">{TRACK_NAME[o.track]} · offer 1 of {d.offers.length}</Label>
        <h3 className="font-display text-2xl tracking-wide text-fg">Pick a card</h3>
      </div>
      <div key={`${o.cards.join()}${o.rerolls}`} className="flex flex-wrap justify-center gap-5">
        {o.cards.map((id, k) => (
          <div key={id} className={twMerge("card-deal", picked && (picked === id ? "card-pick" : "card-pass"))}
            style={{ animationDelay: picked ? "0ms" : `${k * 110}ms`, ["--deal-rot" as string]: `${(k - 1) * 5}deg` }}>
            <button type="button" onClick={() => pick(id)} aria-label={`Take ${card(id).name}`} className={twMerge("card-lift cursor-pointer", FOCUS)}>
              <CultureCard id={id} rank={1} size="lg" className="max-sm:h-[18rem] max-sm:w-[9.5rem]" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="md" variant="secondary" disabled={!!picked || innovation.lt(price)} onClick={() => g.rerollOffer(0)}>
          Reroll · {formatCurrency(price, { showDollarSign: false })} innovation
        </Button>
        <Button size="md" variant="quiet" disabled={!!picked} onClick={onLater}>Decide later</Button>
      </div>
    </section>
  );
}

export function CultureBoard({ offerFirst, onClose }: { offerFirst: boolean; onClose: () => void }) {
  useTicking(1000);
  const d = useGeneratorStore((s) => s.employeeManagement.deck);
  const g = useGeneratorStore.getState();
  const points = g.getDeckPoints();
  const [offering, setOffering] = useState(offerFirst && d.offers.length > 0);
  // A card picked up: by a drag, or tapped with no slot free.
  const [held, setHeld] = useState<CardId | null>(null);
  const [over, setOver] = useState<number | "hand" | null>(null);
  const [shone, setShone] = useState<CardId | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    sfx("open");
    const back = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close.current(); } };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); sfx("close"); back?.focus?.(); };
  }, []);

  // Pivot Weekly's guest, in force in a slot of its own. @see pivot
  const guest = inForce(d).find((id) => !d.slotted.includes(id));
  const hand = CARDS.filter((c) => d.ranks[c.id] && !d.slotted.includes(c.id) && c.id !== guest).map((c) => c.id);
  const free = d.slotted.length < d.slots;

  const placeAt = (id: CardId, at: number) => { g.placeCard(id, at); sfx("pop"); setHeld(null); setOver(null); };
  const takeOut = (id: CardId) => { if (deck().slotted.includes(id)) { g.toggleCard(id); sfx("pop"); } setHeld(null); setOver(null); };
  const tapHand = (id: CardId) => {
    if (held === id) return setHeld(null);
    if (free) return placeAt(id, d.slotted.length);
    setHeld(id);
  };
  const tapSlot = (at: number, id?: CardId) => {
    if (held && held !== id) return placeAt(held, at);
    if (id) takeOut(id);
  };

  return createPortal(
    <div ref={box} role="dialog" aria-modal="true" aria-label="Culture deck" tabIndex={-1}
      className="fixed inset-0 z-50 overflow-y-auto bg-surface-0/95 text-fg outline-none backdrop-blur-sm">
      <Backdrop kind="dots" still />
      <div className="relative mx-auto flex min-h-full max-w-6xl flex-col gap-6 px-3 pb-10 pt-5 sm:px-4">
        <header className="flex items-start justify-between gap-3 border-b border-line-quiet pb-4">
          <div className="flex flex-col gap-1">
            <Label className="text-fg-muted">How the company is run</Label>
            <h2 className="font-display text-2xl tracking-wide">Culture deck</h2>
          </div>
          <div className="flex items-center gap-3">
            {!offering && d.offers.length > 0 && (
              <Button size="md" variant="primary" className="animate-pulse" onClick={() => setOffering(true)}>
                {d.offers.length} {d.offers.length === 1 ? "offer" : "offers"} waiting
              </Button>
            )}
            <div className="flex flex-col items-end leading-none">
              <span className="font-display text-2xl tabular-nums">{points}</span>
              <span className="text-[10px] uppercase tracking-widest text-fg-muted">{points === 1 ? "point" : "points"}</span>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className={twMerge("cursor-pointer px-2 text-lg text-fg-muted hover:text-fg", FOCUS)}>✕</button>
          </div>
        </header>

        {offering ? <OfferStage onDone={() => setOffering(false)} onLater={() => setOffering(false)} /> : (<>
          {/* THE SLOTS: in force. */}
          <section aria-label="Slots" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <Label>In force · {d.slotted.length}/{d.slots}</Label>
              {held && <span className="text-xs text-console">Pick a slot for it</span>}
            </div>
            {/* The tray they sit in. */}
            <div className="flex flex-wrap justify-center gap-3 border border-line-quiet bg-surface-1/50 p-2 shadow-[inset_0_2px_12px_rgb(0_0_0/0.25)] sm:justify-start sm:gap-4 sm:p-4">
              {Array.from({ length: d.slots }, (_, at) => {
                const id = d.slotted[at];
                const lit = over === at || (held !== null && held !== id);
                return (
                  <div key={at} className="flex flex-col items-center gap-2"
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOver(at); }}
                    onDragLeave={() => setOver((o) => (o === at ? null : o))}
                    onDrop={(e) => { e.preventDefault(); placeAt(dragged(e), at); }}>
                    <div className={twMerge("transition-[filter] duration-150", lit && "drop-shadow-[0_0_10px_var(--ui-console)]")}>
                      {id
                        ? <Held key={id} id={id} rank={d.ranks[id]!} shine={shone === id} held={held === id} onTap={() => tapSlot(at, id)} onDrag={setHeld} />
                        : (
                          <button type="button" onClick={() => tapSlot(at)} aria-label={`Slot ${at + 1}, empty`}
                            className={twMerge("relative block h-[18rem] w-[9.5rem] cursor-pointer", FOCUS)}>
                            <span className={twMerge("absolute inset-0", lit ? "bg-console" : "bg-line")} style={{ clipPath: CARD_CLIP }} />
                            <span className="absolute inset-px bg-surface-0 shadow-[inset_0_4px_16px_rgb(0_0_0/0.45)]" style={{ clipPath: CARD_CLIP }} />
                            {/* A card's outline, waiting. */}
                            <span className={twMerge("absolute inset-3 flex flex-col items-center justify-center gap-1 border border-dashed text-center", lit ? "border-console text-console" : "border-line-quiet text-fg-muted")}>
                              <span className="text-[10px] uppercase tracking-widest">{lit ? "Place here" : "Empty slot"}</span>
                            </span>
                          </button>
                        )}
                    </div>
                    {id ? <RankUp id={id} points={points} onRanked={setShone} /> : <span className="h-6" />}
                  </div>
                );
              })}
              {guest && (
                <div className="flex flex-col items-center gap-2">
                  <CultureCard id={guest} rank={d.ranks[guest]!} className="card-slot-in" />
                  <Under>Pivot's guest</Under>
                </div>
              )}
              {/* A NEW SLOT, for points. */}
              {/* On a phone, a bar of its own under them. */}
              <div className="flex flex-col items-center gap-2 max-sm:w-full">
                <button type="button" disabled={points < slotPrice(d)} onClick={() => { g.buySlot(); sfx("confirm"); }}
                  className={twMerge("group relative block h-[18rem] w-[9.5rem] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 max-sm:h-12 max-sm:w-full", FOCUS)}>
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-center text-fg-muted transition-colors group-enabled:group-hover:text-fg max-sm:flex-row max-sm:gap-3">
                    <span className="flex h-10 w-10 items-center justify-center border border-current text-xl leading-none max-sm:h-7 max-sm:w-7 max-sm:text-base">+</span>
                    <span className="mt-1 font-display text-sm max-sm:mt-0">New slot</span>
                    <span className="text-[10px] uppercase tracking-widest text-fg-muted">{slotPrice(d)} points</span>
                  </span>
                </button>
                <span className="h-6 max-sm:hidden" />
              </div>
            </div>
            {/* What the tags in force add up to. */}
            <Sets counts={tagCounts(d)} />
          </section>

          {/* THE HAND: owned, out of the slots. */}
          <section aria-label="Your cards"
            onDragOver={(e) => { if (held && d.slotted.includes(held)) { e.preventDefault(); setOver("hand"); } }}
            onDragLeave={() => setOver((o) => (o === "hand" ? null : o))}
            onDrop={(e) => { e.preventDefault(); takeOut(dragged(e)); }}
            className={twMerge("flex flex-col gap-3 border-t border-line-quiet pt-5 transition-colors", over === "hand" && "bg-console-soft")}>
            <Label>Your cards · {hand.length}</Label>
            {hand.length === 0
              ? <p className="py-6 text-center text-xs text-fg-muted">{d.offers.length ? "Take a card from an offer and it waits here." : "Cards come from offers, as the managers' tiers climb."}</p>
              : (
                <div className="flex flex-wrap justify-center gap-3 sm:justify-start sm:gap-4">
                  {hand.map((id) => (
                    <div key={id} className="flex flex-col items-center gap-2">
                      <Held id={id} rank={d.ranks[id]!} shine={shone === id} held={held === id} onTap={() => tapHand(id)} onDrag={setHeld} />
                      <RankUp id={id} points={points} onRanked={setShone} />
                    </div>
                  ))}
                </div>
              )}
          </section>
        </>)}
      </div>
    </div>,
    document.body,
  );
}
