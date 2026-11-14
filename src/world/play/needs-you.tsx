/**
 * World v2 — THE AI NEEDS YOU: the three things AI mode never does itself.
 * The acquisition offer, the Ascension, and a story choice are the player's;
 * the pilot carries on with everything else meanwhile. One card, at the head
 * of comms. @see useAiDriving, plans/ai-mode-rebuild.md "When it needs you"
 */
import { canAcquire } from "../../game/acquisition";
import { useAiDriving } from "../../hooks/use-ai-driving";
import { useTicking } from "../../hooks/use-ticking";
import { useAiSingularityStore } from "../../state/ai-singularity.store";
import { useAscensionUiStore } from "../../state/ascension-ui.store";
import { useGlobalSettingsStore } from "../../state/global-settings.store";
import { useQuestStore } from "../../state/quest.store";
import { Button, Card } from "../../ui/console";

/** What waits on the player now, in the order it is listed. */
export function needsYou(has: { sale: boolean; ascension: boolean; choice: boolean }): ("sale" | "ascension" | "choice")[] {
  return [...(has.sale ? ["sale" as const] : []), ...(has.ascension ? ["ascension" as const] : []), ...(has.choice ? ["choice" as const] : [])];
}

const openSale = () => {
  useGlobalSettingsStore.getState().setSidebarTab("acquisition");
  window.dispatchEvent(new CustomEvent("startup:show-company"));
};

export function NeedsYouCard() {
  const driving = useAiDriving();
  useTicking(1000);
  const choice = useQuestStore((s) => !!s.offer);
  const full = useAiSingularityStore((s) => s.value) >= 100;
  const waiting = useAscensionUiStore((s) => s.waiting);
  if (!driving) return null;
  const asks = needsYou({ sale: canAcquire(), ascension: full && waiting, choice });
  if (!asks.length) return null;
  return (
    <Card tone="ai" className="w-[min(24rem,calc(100vw-1rem))]" title={<span className="text-[10px] uppercase tracking-widest">The AI needs you</span>}>
      <div role="alert" className="flex flex-col gap-1">
        {asks.map((a) => (
          <p key={a} className="flex items-center justify-between gap-2">
            <span>{a === "sale" ? "The acquisition offer" : a === "ascension" ? "The Ascension" : "A story choice"}</span>
            {a === "sale" && <Button size="sm" variant="primary" tone="ai" onClick={openSale}>Open</Button>}
            {a === "ascension" && <Button size="sm" variant="primary" tone="ai" onClick={() => useAscensionUiStore.getState().begin()}>Begin</Button>}
          </p>
        ))}
      </div>
    </Card>
  );
}
