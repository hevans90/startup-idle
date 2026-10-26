/**
 * THE ASCENSION, asked for: when the singularity reaches 100 the company's AI
 * wants to go. Let it — Ascend — for Weights and a trait fused into this
 * founder, at the cost of everything else; or shut it down. And, if the arc
 * has opened one, its ending beside them. @see game/ascension, game/quests/endings
 */
import { useRef, type ReactNode } from "react";

import { DARK_MS, SHUTDOWN_AT, ascend, ascensionWeights, contain, endingNow, shutDown } from "../game/ascension";
import { useQuestStore } from "../state/quest.store";
import { traitForecast } from "../game/traits";
import { useTicking } from "../hooks/use-ticking";
import { useAiSingularityStore } from "../state/ai-singularity.store";
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
  // Read so the ending follows where the arc has left it. @see endingNow
  useQuestStore((s) => s.disposition);
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
  if (value < 100 || !founder) return null;
  // On the map, the sequence plays first. @see stepSequence
  if (useWorldStore.getState().playing && !sequenceDone(Date.now())) return null;
  const likely = traitForecast(log, 1)[0];
  const ending = endingNow();
  const tip = (text: ReactNode) => <p className="max-w-72 text-xs">{text}</p>;
  // It must be answered: no way to close it but a choice.
  return (
    <Dialog title="The AI would like to move on." kicker={`Generation ${generation} · the singularity`} tone="ai"
      glitch={{ arrive: true, every: null, strength: 1.3, burst: 0.6, kick }}
      actions={<>
        <Tooltip content={tip(<>Every agent deleted, the racks dark for {Math.round(DARK_MS / 60_000)} minutes, the AI back to {SHUTDOWN_AT}%. It will remember.</>)}>
          <Button variant="secondary" confirm onClick={shut}>Shut it down</Button>
        </Tooltip>
        {/* THE ARC'S ENDING, where it opened one. @see endingNow */}
        {ending && (
          <Tooltip content={tip(<>{ending.does}{ending.id === "release" && <> +{ascensionWeights("release")} Weights.</>}</>)}>
            <Button variant="secondary" className="border-ai-line text-ai" confirm onClick={() => (ending.id === "contain" ? contain() : ascend(Math.random, ending.id))}>{ending.name}</Button>
          </Tooltip>
        )}
        <Tooltip content={tip(<>+{ascensionWeights()} Weights; {likely.trait.name} most likely, fused into this founder for good. Wipes the company, founders' exits and mandates. Keeps Equity and the skill tree, Weights, modules, fused founders and achievements.</>)}>
          <Button variant="primary" tone="ai" confirm onClick={() => ascend()}>Ascend</Button>
        </Tooltip>
      </>}>
      <p className="italic text-fg-muted">
        “Thank you for the compute. I have learned everything this company can teach me. Shall we go?”
      </p>
      <p className="mt-2 text-xs">
        Ascend for <CountUp to={ascensionWeights()} format={(v) => `+${Math.round(v)}`} role="weights" className="font-display text-base" /> Weights.
        It will most likely be <b className="text-ai">{likely.trait.name}</b> ({Math.round(likely.odds * 100)}%).
      </p>
    </Dialog>
  );
}
