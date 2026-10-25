import {
  ManagerKeyValues,
  useInnovationStore,
} from "../../state/innovation.store";
import { featureGateOpen } from "../../game/projects";
import { usePrestigeStore } from "../../state/prestige.store";
import { Button, Locked, Panel } from "../../ui/console";
import { showProject } from "../../world/play/map-focus";
import { CycleButton } from "../../ui/CyclingButton";
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
  // Where the company has a map, managers wait for the HQ. @see featureGateOpen
  const hqBuilt = featureGateOpen("managers");

  const canUnlockManagers = canUnlock("managers");
  const canUnlockEmployeeManagement = canUnlock("employeeManagement");

  const employeeManagementState = unlocks.employeeManagement;
  const disableManagers = usePrestigeStore((s) => s.modifiers.disableManagers);

  return (
    <div className="w-full flex flex-col gap-6 select-none mt-2">
      {disableManagers && (
        <div className="border border-bad-line bg-bad-soft px-3 py-2 text-xs text-bad">
          <span className="font-semibold">Bootstrapped</span> — managers and
          auto-buy are disabled. Manager tiers and auto-buy levels have no
          effect while this keystone is allocated.
        </div>
      )}
      {/* LOCKED until the HQ stands; then bought. @see featureGateOpen */}
      {!managersState?.unlocked && !hqBuilt && (
        <Locked needs="Managers need an office: build your Company HQ on the map" onShow={() => showProject("managers")} />
      )}
      {!managersState?.unlocked && hqBuilt && (
        <Button variant="primary" onClick={() => unlock("managers")} disabled={!canUnlockManagers}>
          Unlock Managers: {managersState?.cost.toFixed(2)}
        </Button>
      )}

      {managersState?.unlocked && (
        <Panel
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
        </Panel>
      )}

      {!employeeManagementState?.unlocked && (
        <Button
          variant="primary"
          onClick={() => unlock("employeeManagement")}
          disabled={!canUnlockEmployeeManagement}
        >
          Unlock Employee Management: {employeeManagementState?.cost.toFixed(2)}
        </Button>
      )}

      {employeeManagementState?.unlocked && (
        <Panel
          title="Employee Management"
          help="Spend management points from manager tiers on each role. Refund a row
          to return all points spent on that role. Auto-buy purchases one
          employee per tick when you can afford it (fractions accumulate)."
        >
          <EmployeeManagementPanel />
        </Panel>
      )}
    </div>
  );
};
