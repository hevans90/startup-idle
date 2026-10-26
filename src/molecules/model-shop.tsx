/**
 * THE MODEL'S SHOP: the second prestige's spending, between companies — on
 * the founder screen, before a run starts. Which generation this is, the
 * Weights to spend — in the Machine, the skill tree's AI cluster — the
 * founders fused with the AI, and the generations past. @see game/ascension, game/machine
 */
import { FOUNDERS } from "../game/founders.catalog";
import { FUSIONS } from "../game/fusion";
import { machineGraph } from "../game/machine";
import { trait } from "../game/traits";
import { useGenerationStore } from "../state/generation.store";
import { Button, Stat, StatGrid } from "../ui/console";

const MACHINE_SIZE = machineGraph().nodes.length;

const SECTION = "flex flex-col gap-1 border-t border-line-quiet pt-3";
const TITLE = "mb-1 text-[10px] uppercase tracking-widest text-fg-muted";

export function ModelShop({ onOpenTree }: { onOpenTree?: () => void }) {
  const g = useGenerationStore();
  const owned = g.machine.length;
  const founderName = (id: string) => FOUNDERS.find((f) => f.id === id)?.name ?? id;
  return (
    <div className="flex flex-col gap-3 px-5 text-xs text-fg">
      <StatGrid>
        <Stat label="Generation" value={g.generation} />
        <Stat label="Weights" value={g.weights} role="weights" />
        <Stat label="The Machine" value={`${owned} / ${MACHINE_SIZE}`} role="ai" />
      </StatGrid>

      {/* THE MACHINE: where Weights go — the skill tree's AI cluster. @see game/machine */}
      <div className={SECTION}>
        <p className={TITLE}>The Machine</p>
        <p className="text-fg-muted">
          {g.generation > 1
            ? "Spend Weights in the Machine: the AI's own cluster of the skill tree, below the rest. A ring more of it shows each Ascension."
            : "The Machine, the AI's own cluster of the skill tree, opens at the first Ascension."}
        </p>
        {onOpenTree && (
          <Button size="sm" variant="primary" tone="ai" className="mt-1 self-start" onClick={onOpenTree}>
            Open the skill tree
          </Button>
        )}
      </div>

      {/* THE FOUNDERS FUSED WITH THE AI. */}
      {Object.keys(g.fused).length > 0 && (
        <div className={SECTION}>
          <p className={TITLE}>Fused founders</p>
          {Object.entries(g.fused).map(([f, traits]) => (
            <div key={f} className="mb-1">
              <p className="font-bold">{founderName(f)}</p>
              {traits.map((t, k) => <p key={k}><span className="text-ai">{trait(t).name}</span>: {FUSIONS[t].text}</p>)}
            </div>
          ))}
        </div>
      )}

      {/* THE GENERATIONS PAST. */}
      {g.past.length > 0 && (
        <div className={SECTION}>
          <p className={TITLE}>Generations</p>
          {[...g.past].reverse().map((p) => (
            <p key={p.generation} className="flex justify-between gap-2">
              <span>{p.generation}. <b>{trait(p.trait).name}</b>{p.mutated ? " (mutated)" : ""} → {founderName(p.founder)}</span>
              <span className="tabular-nums">+{p.weights}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
