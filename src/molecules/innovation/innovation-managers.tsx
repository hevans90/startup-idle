import {
  ManagerKeyValues,
  useInnovationStore,
} from "../../state/innovation.store";
import { usePrestigeStore } from "../../state/prestige.store";
import { Button } from "../../ui/Button";
import { CycleButton } from "../../ui/CyclingButton";
import { SystemPanel } from "../../ui/SystemPanel";
import { EmployeeManagementPanel } from "./employee-management-panel";
import ManagerRow from "./manager-row";

export const InnovationManagers = () => {
  const {
    innovation,
    unlocks,
    canUnlock,
    unlock,
    managers,
    assignManager,
    unassignManager,
    assignment,
    setAssignment,
  } = useInnovationStore();

  const managersState = unlocks.managers;

  const canUnlockManagers = canUnlock("managers");
  const canUnlockEmployeeManagement = canUnlock("employeeManagement");

  const employeeManagementState = unlocks.employeeManagement;
  const disableManagers = usePrestigeStore((s) => s.modifiers.disableManagers);

  return (
    <div className="w-full flex flex-col gap-6 select-none mt-2">
      {disableManagers && (
        <div className="border border-rose-400/60 bg-rose-500/15 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          <span className="font-semibold">Bootstrapped</span> — managers and
          auto-buy are disabled. Manager tiers and auto-buy levels have no effect
          while this keystone is allocated.
        </div>
      )}
      {!managersState?.unlocked && (
        <Button
          onClick={() => unlock("managers")}
          disabled={!canUnlockManagers}
        >
          Unlock Managers: {managersState?.cost.toFixed(2)}
        </Button>
      )}

      {managersState?.unlocked && (
        <SystemPanel
          title="Managers"
          help="Assign innovation to tier up managers"
          controls={
            <CycleButton
              currentValue={assignment}
              values={[1, 10, 100, "max"]}
              onChanged={setAssignment}
            />
          }
        >
          {ManagerKeyValues.map((managerName) => (
            <ManagerRow
              key={managerName}
              managerName={managerName}
              managerData={managers[managerName]}
              innovation={innovation}
              onAssign={() => assignManager(managerName)}
              onUnassign={() => unassignManager(managerName)}
            />
          ))}
        </SystemPanel>
      )}

      {!employeeManagementState?.unlocked && (
        <Button
          onClick={() => unlock("employeeManagement")}
          disabled={!canUnlockEmployeeManagement}
        >
          Unlock Employee Management: {employeeManagementState?.cost.toFixed(2)}
        </Button>
      )}

      {employeeManagementState?.unlocked && (
        <SystemPanel
          title="Employee Management"
          help="Spend points equal to your total manager tier levels on each role"
        >
          <EmployeeManagementPanel />
        </SystemPanel>
      )}
    </div>
  );
};
