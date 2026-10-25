/**
 * THE AI TRAITS FUSED INTO A FOUNDER, as their card and badge show them: each
 * trait's name and what it does to the companies they found. @see game/fusion
 */
import { FUSIONS, fusedInto } from "../game/fusion";
import { trait } from "../game/traits";
import { useGenerationStore } from "../state/generation.store";

export function FusedTraits({ founder }: { founder: string }) {
  useGenerationStore((s) => s.fused[founder]);
  const traits = fusedInto(founder);
  if (!traits.length) return null;
  return (
    <div className="mt-2 border border-ai/30 bg-ai/10 px-2 py-1 text-[11px] leading-snug text-ai">
      <p className="font-semibold">Fused with the AI</p>
      {traits.map((t, k) => (
        <p key={k} title={trait(t).memo}><b>{trait(t).name}</b>: {FUSIONS[t].text}</p>
      ))}
    </div>
  );
}
