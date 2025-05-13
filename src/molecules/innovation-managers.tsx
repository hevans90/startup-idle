import { ClassNameValue, twMerge } from "tailwind-merge";
import {
  getManagerCost,
  ManagerKeyValues,
  useInnovationStore,
} from "../state/innovation.store";
import { Button } from "../ui/Button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { ProgressBar } from "../ui/ProgressBar";

export const InnovationManagers = ({
  className,
}: {
  className?: ClassNameValue;
}) => {
  const {
    innovation,
    unlocks,
    canUnlock,
    unlock,
    managers,
    assignManager,
    unassignManager,
  } = useInnovationStore();

  const state = unlocks.managers;

  const canUnlockManagers = canUnlock("managers");

  return (
    <div
      className={twMerge(
        "w-full flex flex-col gap-2 border-1 border-primary-500",
        className
      )}
    >
      {!state.unlocked && (
        <Button
          onClick={() => unlock("managers")}
          disabled={!canUnlockManagers}
        >
          Unlock Managers: {state.cost.toFixed(2)}
        </Button>
      )}

      {state.unlocked && (
        <div className="p-2 pt-6 relative flex flex-col gap-4">
          <span className="absolute -top-2.5 bg-primary-200 dark:bg-primary-900 leading-none font-bold">
            Managers
          </span>
          {ManagerKeyValues.map((managerName) => {
            const { assignment, progress, tier } = managers[managerName];

            const assignmentCost = getManagerCost(assignment);
            const refundCost = getManagerCost(assignment.minus(1));
            return (
              <>
                {/* {JSON.stringify({ m: managerName, assignment, progress, tier })} */}

                <div className="flex gap-2 items-center w-full justify-between">
                  <span className="leading-none mr-4">
                    {managerName.toUpperCase()}
                  </span>
                  <div className="grow h-full flex items-end gap-1">
                    <Popover openOnHover={true} placement="bottom">
                      <PopoverTrigger asChild>
                        <Button
                          disabled={assignment.equals(0)}
                          onClick={() => unassignManager(managerName)}
                          className="w-12 h-10 leading-none"
                        >
                          -
                        </Button>
                      </PopoverTrigger>

                      {assignment.gte(1) && (
                        <PopoverContent className="bg-primary-100 dark:bg-primary-800 text-primary-900 dark:text-primary-100 border-primary-500 border-[1px] p-4  outline-none focus:ring-0">
                          <div className="flex flex-col gap-2 items-center justify-center">
                            Refund Innovation ({refundCost.toNumber()})
                          </div>
                        </PopoverContent>
                      )}
                    </Popover>

                    <div className="w-full gap-2">
                      <div className="flex justify-between gap-2">
                        <span className="text-xs">Tier: {tier.toNumber()}</span>
                        <span className="text-xs">
                          Assigned: {assignment.toNumber()}
                        </span>
                      </div>
                      <ProgressBar value={progress.toNumber()} />
                    </div>

                    <Popover openOnHover={true} placement="bottom">
                      <PopoverTrigger asChild>
                        <Button
                          className="w-12 h-10"
                          onClick={() => assignManager(managerName)}
                          disabled={assignmentCost.gte(innovation)}
                        >
                          <div className="flex justify-center items-center gap-2">
                            <span>+</span>
                          </div>
                        </Button>
                      </PopoverTrigger>

                      <PopoverContent className="bg-primary-100 dark:bg-primary-800 text-primary-900 dark:text-primary-100 border-primary-500 border-[1px] p-4  outline-none focus:ring-0">
                        <div className="flex flex-col gap-2 items-center justify-center">
                          Cost: ({assignmentCost.toNumber()})
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              </>
            );
          })}
        </div>
      )}
    </div>
  );
};
