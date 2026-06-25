import Decimal from "break_infinity.js";
import { useInnovationStore } from "../state/innovation.store";
import { useMoneyStore } from "../state/money.store";
import { usePrestigeStore } from "../state/prestige.store";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";

const BTN =
  "cursor-pointer border border-dashed border-amber-500 px-2 py-1 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 text-left";

const DevPanelImpl = () => (
  <div className="pointer-events-auto flex flex-col gap-1 border border-amber-500/40 bg-primary-900/80 p-1.5 dark:bg-primary-950/85">
    <p className="text-[9px] font-bold uppercase tracking-wider text-amber-500/70">
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
    <button type="button" className={BTN} onClick={() => usePrestigeStore.getState().grantEquity(50)}>
      +50 equity
    </button>
  </div>
);

export const DevPanel = import.meta.env.DEV
  ? DevPanelImpl
  : () => null;
