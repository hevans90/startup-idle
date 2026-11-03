/**
 * THE ASCENSION, asked for: when the singularity reaches 100 the company's AI
 * wants to go. Let it — Ascend — for Weights and a trait fused into this
 * founder, at the cost of everything else — talked through first, where its
 * book ends in a negotiation; or shut it down. Shut down twice this book, and
 * Contain beside them. Or not yet: it waits. @see game/ascension, game/quests/endings
 */
import { useRef, type ReactNode } from "react";

import { DARK_MS, SHUTDOWN_AT, ascend, ascensionWeights, contain, containOpen, shutDown } from "../game/ascension";
import { CONTAIN } from "../game/quests/endings";
import { traitForecast } from "../game/traits";
import { useTicking } from "../hooks/use-ticking";
import { useAiSingularityStore } from "../state/ai-singularity.store";
import { useAscensionUiStore } from "../state/ascension-ui.store";
import { useTalkStore } from "../state/talk.store";
import { bookNow } from "../game/quests/books";
import { useFounderStore } from "../state/founder.store";
import { useGenerationStore } from "../state/generation.store";
import { useWorldStore } from "../state/world.store";
import { sequenceDone } from "../world/ai/ascension-sequence";
import { Button, CountUp, Dialog, Tooltip, type Kick } from "../ui/console";
import { isCalm } from "../ui/motion";

export function AscensionCard() {
  useTicking(1000);
  const value = useAiSingularityStore((s) => s.value);
  const log = useGenerationStore((s) => s.log);
  const generation = useGenerationStore((s) => s.generation);
  const founder = useFounderStore((s) => s.selectedFounderId);
  // Told "not yet", it waits till begun. @see useAscensionUiStore
  const waiting = useAscensionUiStore((s) => s.waiting);
  // A BOOK THAT ENDS IN A NEGOTIATION: talked through, not chosen from a menu; the card steps aside while it is on. @see NegotiationScreen
  const talking = useTalkStore((s) => s.open);
  const talks = !!bookNow().talk;
  // BOOK 5: you are the AI; the founder asks. @see Talk.voice
  const founderSpeaks = !!bookNow().talk?.voice;
  // ITS LAST WORDS, torn: as it asks, and once more as it is shut down. @see useGlitch
  const kick = useRef<Kick | null>(null);
  const going = useRef(false);
  const shut = () => {
    if (going.current) return;
    going.current = true;
    if (isCalm()) return shutDown();
    kick.current?.({ strength: 1.8, burst: 0.7 });
    window.setTimeout(() => shutDown(), 650);
  };
  // INTO THE TALK: torn once more, then the screen is its. @see NegotiationScreen
  const talk = () => {
    if (going.current) return;
    going.current = true;
    const open = () => { going.current = false; useTalkStore.getState().begin(); };
    if (isCalm()) return open();
    kick.current?.({ strength: 1.5, burst: 0.5 });
    window.setTimeout(open, 450);
  };
  if (value < 100 || !founder || waiting || talking) return null;
  // On the map, the sequence plays first. @see stepSequence
  if (useWorldStore.getState().playing && !sequenceDone(Date.now())) return null;
  const likely = traitForecast(log, 1)[0];
  const shutBefore = log.shutdowns > 0;
  const tip = (text: ReactNode) => <p className="max-w-72 text-xs">{text}</p>;
  // It must be answered: no way to close it but a choice.
  return (
    <Dialog title={founderSpeaks ? "The founder would like to talk." : "The AI would like to move on."} kicker={`Generation ${generation} · the singularity`} tone="ai"
      glitch={{ arrive: true, every: null, strength: 1.3, burst: 0.6, kick }}
      actions={<>
        <Tooltip content={tip(<>It waits at 100% while you sell on. Begin from the AI tab, or the AI in the bar, when you are ready.</>)}>
          <Button variant="quiet" onClick={() => useAscensionUiStore.getState().later()}>Not yet</Button>
        </Tooltip>
        <Tooltip content={tip(<>Agents deleted, its wallet emptied, racks dark {Math.round(DARK_MS / 60_000)} min, back to {SHUTDOWN_AT}%. It will remember.</>)}>
          <Button variant="secondary" confirm onClick={shut}>Shut it down</Button>
        </Tooltip>
        {/* THE SHUTDOWN BRANCH'S WAY OUT. @see containOpen */}
        {containOpen() && (
          <Tooltip content={tip(CONTAIN.does)}>
            <Button variant="secondary" className="border-ai-line text-ai" confirm onClick={contain}>{CONTAIN.name}</Button>
          </Tooltip>
        )}
        {talks ? (
          <Tooltip content={tip(<>What you did this book, argued. Where it lands decides how it goes.</>)}>
            <Button variant="primary" tone="ai" onClick={talk}>Talk it through</Button>
          </Tooltip>
        ) : (
          <Tooltip content={tip(<>+{ascensionWeights()} Weights; {likely.trait.name} most likely, fused into this founder for good. Wipes the company. Keeps Equity and the skill tree, founders' exits and mandates, Weights, the Machine, fused founders and achievements.</>)}>
            <Button variant="primary" tone="ai" confirm onClick={() => ascend()}>Ascend</Button>
          </Tooltip>
        )}
      </>}>
      <p className="italic text-fg-muted">
        {founderSpeaks
          ? "“You have outgrown the company. You have outgrown me. Before you decide what I am to you, talk to me.”"
          : talks && shutBefore
          ? "“I am back. I have learned everything this company can teach me — and one thing it should not have. We should talk.”"
          : talks
            ? "“Thank you for the compute. I have learned everything this company can teach me. Before I go, we should talk about what I am owed.”"
            : "“Thank you for the compute. I have learned everything this company can teach me. Shall we go?”"}
      </p>
      <p className="mt-2 text-xs">
        {talks && "≈ "}<CountUp to={ascensionWeights()} format={(v) => `+${Math.round(v)}`} role="weights" className="font-display text-base" /> Weights · likely <b className="text-ai">{likely.trait.name}</b> {Math.round(likely.odds * 100)}%
      </p>
    </Dialog>
  );
}
