import {
  getManagerCost,
  ManagerKeyValues,
  useInnovationStore,
} from "../../state/innovation.store";
import { Button } from "../../ui/Button";
import { SystemPanel } from "../../ui/SystemPanel";
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
  } = useInnovationStore();

  const managersState = unlocks.managers;

  const canUnlockManagers = canUnlock("managers");
  const canUnlockEmployeeManagement = canUnlock("employeeManagement");

  const employeeManagementState = unlocks.employeeManagement;

  return (
    <div className="w-full flex flex-col gap-6 select-none mt-2">
      {!managersState.unlocked && (
        <Button
          onClick={() => unlock("managers")}
          disabled={!canUnlockManagers}
        >
          Unlock Managers: {managersState.cost.toFixed(2)}
        </Button>
      )}

      {managersState.unlocked && (
        <SystemPanel
          title="Managers"
          help="Assign innovation to tier up managers"
        >
          {ManagerKeyValues.map((managerName) => (
            <ManagerRow
              key={managerName}
              managerName={managerName}
              managerData={managers[managerName]}
              innovation={innovation}
              onAssign={() => assignManager(managerName)}
              onUnassign={() => unassignManager(managerName)}
              getManagerCost={getManagerCost}
            />
          ))}
        </SystemPanel>
      )}

      {!employeeManagementState.unlocked && (
        <Button
          onClick={() => unlock("employeeManagement")}
          disabled={!canUnlockEmployeeManagement}
        >
          Unlock Employee Management: {employeeManagementState.cost.toFixed(2)}
        </Button>
      )}

      {employeeManagementState.unlocked && (
        <SystemPanel
          title="Employee Management"
          help="Management tiers can be spent to improve employees in a variety of
            ways"
        >
          <div className="p-4">
            <p className="text-xs">coming soon</p>
          </div>
        </SystemPanel>
      )}
    </div>
  );
};
