import { internSatisfactionManagerAccrualMultiplier } from "./satisfaction";

let internScoreFn: () => number = () => 0;
let employeeManagementUnlockedFn: () => boolean = () => false;

export function setEmployeeSatisfactionReaders(readers: {
  internScore: () => number;
  employeeManagementUnlocked: () => boolean;
}): void {
  internScoreFn = readers.internScore;
  employeeManagementUnlockedFn = readers.employeeManagementUnlocked;
}

export function getInternManagerAccrualMultiplierForTick(): number {
  if (!employeeManagementUnlockedFn()) return 1;
  return internSatisfactionManagerAccrualMultiplier(internScoreFn());
}
