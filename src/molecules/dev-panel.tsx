import { useEffect, useState } from "react";
import Decimal from "break_infinity.js";
import { useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useValuationStore } from "../state/valuation.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";

const BTN =
  "cursor-pointer border border-dashed border-warn px-2 py-1 text-xs text-warn hover:bg-warn/10 text-left";

const DevPanelImpl = () => (
  <div className="pointer-events-auto flex flex-col gap-1 border border-warn/40 bg-surface-1/80 p-1.5">
    <p className="text-[9px] font-bold uppercase tracking-wider text-warn/70">
      dev
    </p>
    <button type="button" className={BTN} onClick={() => useMoneyStore.getState().increaseMoney(1e9)}>
      +1B money
    </button>
    <button type="button" className={BTN} onClick={() => useInnovationStore.getState().increaseInnovation(1e6)}>
      +1M innovation
    </button>
    <button
      type="button"
      className={BTN}
      onClick={() => useVapeAchievementsStore.setState({ vapeJuice: new Decimal(1e9) })}
    >
      +1B juice
    </button>
    <button type="button" className={BTN} onClick={() => useValuationStore.getState().increaseValuation(1e5)}>
      +100k valuation
    </button>
    <button type="button" className={BTN} onClick={() => usePrestigeStore.getState().grantEquity(50)}>
      +50 equity
    </button>
  </div>
);

export const DevPanel = import.meta.env.DEV
  ? DevPanelImpl
  : () => null;

/** THE DEV PANEL, in a drawer: shut till ` (backquote) opens it, so it stays out of comms' way. Development only. */
function DevDrawerImpl() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "`" || (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  if (!open) return null;
  return <div className="pointer-events-none absolute bottom-24 left-2 z-30"><DevPanelImpl /></div>;
}
export const DevDrawer = import.meta.env.DEV ? DevDrawerImpl : () => null;
