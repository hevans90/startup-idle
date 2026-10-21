/**
 * World v2 — THE AI'S WALLET: what the company's AI may spend. A share of the
 * company's income, set by the player in the Data Centre panel, comes into it
 * every second, up to `WALLET_MINUTES` of it; every job it does is paid for
 * out of it, and a job it cannot pay for it does not do — it waits, rather
 * than spending the company's money as it likes. The money is still the
 * company's; the wallet is how much of it the AI may use. @see planner, ai-runner
 */
import { buildCost, pipeCost, roadCost } from "../../game/build-cost";
import { useGeneratorStore } from "../../state/generators.store";
import { useMoneyStore } from "../../state/money.store";
import { useSessionStore } from "../../state/session.store";
import { useUpgradeStore } from "../../state/upgrades.store";
import { skillOf } from "../../state/training.store";
import { WALLET_DEEPER, WALLET_FASTER } from "../../game/training";
import { getGeneratorCost } from "../../utils/generator-utils";
import { idx, inBounds, type Grid } from "../grid";
import { isPaved } from "../roads/mask";
import type { AiAction } from "./planner";

/** The most of income it may be given, the step the slider moves in, and what a company starts with. */
export const SHARE_MAX = 0.5;
export const SHARE_STEP = 0.05;
export const SHARE_DEFAULT = 0.2;
/** Minutes of its share the wallet holds at most. */
export const WALLET_MINUTES = 10;

const income = () => {
  const n = useGeneratorStore.getState().getMoneyPerSecond();
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** What it may hold at most, now. */
export const walletCap = (): number =>
  income() * useSessionStore.getState().aiShare * WALLET_MINUTES * 60 * (skillOf("money") >= 3 ? WALLET_DEEPER : 1);

/**
 * Its share of `seconds` of income, into the wallet, up to the cap. Kept up
 * between calls and written to the store at most every `FLUSH` seconds: the
 * store is saved on every write, and this is called every frame.
 */
let owed = 0;
const FLUSH = 1;
export function accrueWallet(seconds: number): void {
  if (seconds <= 0) return;
  owed += seconds;
  if (owed < FLUSH) return;
  creditWallet(owed);
  owed = 0;
}
/** Credit `seconds` of its share at once: time away, or a flush. */
export function creditWallet(seconds: number): void {
  const s = useSessionStore.getState();
  // Faster for an AI trained on the money. @see WALLET_FASTER
  const faster = skillOf("money") >= 1 ? WALLET_FASTER : 1;
  const next = Math.min(walletCap(), s.aiWallet + income() * s.aiShare * faster * seconds);
  if (next !== s.aiWallet) s.setAiWallet({ aiWallet: Math.max(0, next) });
}

/** Tiles of a straight run of road not yet paved: what laying it costs. */
function freshRoad(g: Grid, from: { x: number; y: number }, to: { x: number; y: number }): number {
  let n = 0;
  for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y++)
    for (let x = Math.min(from.x, to.x); x <= Math.max(from.x, to.x); x++) if (inBounds(g, x, y) && !isPaved(g, x, y) && !g.pool[idx(g, x, y)]) n++;
  return n;
}

/** What a job costs now, in money: nought for what costs a player nothing. */
export function priceOfAi(g: Grid, a: AiAction): number {
  switch (a.kind) {
    case "place": return buildCost(a.def)?.toNumber() ?? Infinity;
    case "convert": return buildCost(a.into)?.toNumber() ?? 0;
    case "road": return roadCost(freshRoad(g, a.from, a.to)).toNumber();
    case "pipe": return pipeCost(a.route.pipe.length).toNumber() + (a.route.pump ? buildCost("pump")?.toNumber() ?? Infinity : 0);
    case "hire": return getGeneratorCost(a.who, 1).toNumber();
    case "upgrade": return useUpgradeStore.getState().availableUpgrades.find((u) => u.id === a.id)?.cost ?? Infinity;
    default: return 0;
  }
}

/** Whether the wallet, and the company, can pay for a job now. */
export function walletCovers(g: Grid, a: AiAction): boolean {
  const price = priceOfAi(g, a);
  return price <= useSessionStore.getState().aiWallet && useMoneyStore.getState().money.gte(price);
}

/** Take a job's price out of the wallet. */
export function spendWallet(price: number): void {
  if (price <= 0) return;
  const s = useSessionStore.getState();
  s.setAiWallet({ aiWallet: Math.max(0, s.aiWallet - price) });
}
