import { featureGateOpen } from "../../game/projects";
import { MANDATES, useValuationStore } from "../../state/valuation.store";
import { Locked, Tile } from "../../ui/console";
import { formatCurrency } from "../../utils/money-utils";
import { showProject } from "../../world/play/map-focus";

/**
 * THE BOARD'S MANDATES: a tile each — its name and level, what it does, and
 * its price in valuation; lit when it can be bought, a press to buy. Locked
 * until the board has its Boardroom Tower, on the map.
 */
export const ValuationMandatesPanel = () => {
  const mandateLevels = useValuationStore((s) => s.mandateLevels);
  const purchaseMandate = useValuationStore((s) => s.purchaseMandate);
  const canAffordMandate = useValuationStore((s) => s.canAffordMandate);
  const getMandateCost = useValuationStore((s) => s.getMandateCost);
  const open = featureGateOpen("mandates");

  return (
    <div className="flex flex-col gap-2">
      {/* The board needs somewhere to meet, where the company has a map. */}
      {!open && <Locked needs="The board meets in its Boardroom Tower: build one on the map" onShow={() => showProject("mandates")} />}
      <div className="grid grid-cols-2 gap-2">
        {MANDATES.map((m) => {
          const level = mandateLevels[m.id];
          const affordable = open && canAffordMandate(m.id);
          return (
            <Tile key={m.id} lit={affordable} disabled={!affordable} onClick={() => purchaseMandate(m.id)}
              className="flex flex-col gap-1 p-2.5">
              <span className="flex items-baseline justify-between gap-2">
                <b className="text-xs">{m.name}</b>
                <span className="text-[10px] uppercase tracking-widest text-fg-faint">Lv {level}</span>
              </span>
              <span className="text-[11px] leading-snug text-fg-muted">{m.description}</span>
              <span className="mt-auto pt-1 text-xs tabular-nums text-valuation">
                {formatCurrency(getMandateCost(m.id), { showDollarSign: false })} valuation
              </span>
            </Tile>
          );
        })}
      </div>
    </div>
  );
};
