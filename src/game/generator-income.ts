import type { GameModifiers } from "./modifiers";
import type { OwnedGenerator } from "../state/generators.store";

/**
 * Pure arithmetic: compute the money and innovation produced by `units` of
 * a generator over one second, applying the full multiplier chain.
 *
 * No store reads or side-effects — safe to call from both the tick loop and
 * the per-second display getters.
 */
export function calcGeneratorPerSecond(
  gen: OwnedGenerator,
  m: GameModifiers,
  out: { money: number; innovation: number },
  units: number,
): { money: number; innovation: number } {
  const intervalSeconds = gen.interval / 1000;

  const money =
    ((m.innovationCurve *
      m.managerMoney *
      m.mandateMoney *
      gen.baseProduction *
      units *
      gen.multiplier *
      out.money *
      (m.satisfactionRevenue[gen.id] ?? 1) *
      (m.teamLeaderEmpRoleRevenue[gen.id] ?? 1) *
      (m.teamLeaderLegacyRevenue[gen.id] ?? 1) *
      (m.founderMoney[gen.id] ?? 1)) /
      intervalSeconds) *
    m.juiceMoney *
    m.headcountMoney *
    m.founderGlobalMoney *
    m.prestigeMoney *
    m.prestigeEmployeeOutput *
    (gen.id === "intern" ? m.prestigeInternOutput : 1) *
    m.teamLeaderEmpGlobalRevenue;

  const innovation =
    ((m.innovationCurve *
      m.managerInnovation *
      m.mandateInnovation *
      gen.innovationProduction *
      units *
      gen.innovationMultiplier *
      out.innovation *
      (m.teamLeaderEmpRoleIps[gen.id] ?? 1) *
      (m.teamLeaderLegacyIps[gen.id] ?? 1) *
      m.internIpsMult *
      (m.founderInnovation[gen.id] ?? 1)) /
      intervalSeconds) *
    m.juiceInnovation *
    m.prestigeInnovation *
    m.prestigeEmployeeOutput *
    (gen.id === "intern" ? m.prestigeInternOutput : 1) *
    m.teamLeaderEmpGlobalIps;

  return { money, innovation };
}

/**
 * Pure arithmetic: compute the money and innovation produced by one generator
 * over `ticks` tick intervals.
 *
 * Delegates to {@link calcGeneratorPerSecond} — `ticks / (1/intervalSeconds)`
 * = `ticks * intervalSeconds` seconds of output.
 */
export function calcGeneratorIncome(
  gen: OwnedGenerator,
  m: GameModifiers,
  out: { money: number; innovation: number },
  ticks: number,
): { money: number; innovation: number } {
  const perSecond = calcGeneratorPerSecond(gen, m, out, gen.amount);
  const intervalSeconds = gen.interval / 1000;
  return {
    money: perSecond.money * ticks * intervalSeconds,
    innovation: perSecond.innovation * ticks * intervalSeconds,
  };
}
