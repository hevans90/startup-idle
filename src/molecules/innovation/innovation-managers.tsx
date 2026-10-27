import {
  ManagerKeyValues,
  useInnovationStore,
} from "../../state/innovation.store";
import { usePrestigeStore } from "../../state/prestige.store";
import { Locked, Panel } from "../../ui/console";
import { showProject } from "../../world/play/map-focus";
import { CycleButton } from "../../ui/CyclingButton";
import { EmployeeManagementPanel } from "./employee-management-panel";
import ManagerRow from "./manager-row";

export const InnovationManagers = () => {
  const {
    innovation,
    unlocks,
    managers,
    assignManager,
    unassignManager,
    assignment,
    setAssignment,
  } = useInnovationStore();

  // OPENED BY THE HQ, both: never bought. @see grantFeatures
  const managersState = unlocks.managers;
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
      {/* LOCKED until the HQ stands. @see grantFeatures */}
      {!managersState?.unlocked && (
        <Locked needs="Managers need an office: build your Company HQ on the map" onShow={() => showProject("managers")} />
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
