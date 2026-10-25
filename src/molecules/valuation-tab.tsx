import { useShallow } from "zustand/shallow";
import { useInnovationStore } from "../state/innovation.store";
import { useValuationStore } from "../state/valuation.store";
import { InfoRow } from "../ui/InfoRow";
import { Locked, Panel } from "../ui/console";
import { useGlobalSettingsStore } from "../state/global-settings.store";
import { ValuationMandatesPanel } from "./innovation/valuation-mandates-panel";

export const ValuationTab = () => {
  const managersUnlocked = useInnovationStore(
    (s) => s.unlocks.managers?.unlocked,
  );
  const setTab = useGlobalSettingsStore((s) => s.setSidebarTab);
  const board = useValuationStore(useShallow((s) => s.getEconomyMultipliers()));

  if (!managersUnlocked) {
    return (
      <div className="p-2 pt-4">
        <Locked needs="Unlock Managers on the Innovation tab to accrue valuation and buy board mandates" onShow={() => setTab("innovation")} />
      </div>
    );
  }

  return (
    <div className="p-2 pt-4 w-full flex flex-col gap-4 items-center">
      <div className="w-64 text-left">
        <p className="responsive-text-xs text-fg-muted">
          Board mandate bonuses
        </p>
        <InfoRow
          label="Money output"
          value={`x${board.money.toFixed(2)}`}
          size="small"
          modKey="mandateMoney"
        />
        <InfoRow
          label="Innovation rate"
          value={`x${board.innovation.toFixed(2)}`}
          size="small"
          modKey="mandateInnovation"
        />
      </div>
      <Panel
        title="Board Mandates"
        help="Valuation accrues from revenue (boosted by Sales). Buy mandates for global bonuses."
        className="w-full"
      >
        <ValuationMandatesPanel />
      </Panel>
    </div>
  );
};
