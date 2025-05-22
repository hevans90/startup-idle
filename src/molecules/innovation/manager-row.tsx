import Decimal from "break_infinity.js";

import { memo } from "react";
import { ManagerState } from "../../state/innovation.store";
import { Button } from "../../ui/Button";
import { InfoRow } from "../../ui/InfoRow";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/Popover";
import { ProgressBar } from "../../ui/ProgressBar";
import { Spacer } from "../../ui/Spacer";

interface ManagerRowProps {
  managerName: string;
  managerData: ManagerState;
  innovation: Decimal;
  onAssign: () => void;
  onUnassign: () => void;
  getManagerCost: (value: Decimal) => Decimal;
}

const ManagerRow: React.FC<ManagerRowProps> = memo(
  ({
    managerName,
    managerData,
    innovation,
    onAssign,
    onUnassign,
    getManagerCost,
  }) => {
    const {
      assignment,
      progress,
      tier,
      estimateToNextTier,
      bonusType,
      bonusMultiplier,
      bonusMultiplierGrowthPerTier,
    } = managerData;

    const assignmentCost = getManagerCost(assignment);
    const refundCost = getManagerCost(assignment.minus(1));

    return (
      <Popover
        placement="left"
        key={managerName}
        openOnHover={true}
        floatOffset={15}
      >
        <PopoverTrigger asChild>
          <div className="flex gap-2 items-center w-full justify-between hover:bg-primary-300 dark:hover:bg-primary-800 p-2 py-3">
            <span className="leading-none mr-4">
              {managerName.toUpperCase()}
            </span>
            <div className="grow h-full flex items-end gap-1">
              <Popover openOnHover={true} placement="bottom-start">
                <PopoverTrigger asChild>
                  <Button
                    onClick={onUnassign}
                    disabled={assignment.equals(0)}
                    className="w-12 h-10 leading-none"
                  >
                    -
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="bg-primary-100 dark:bg-primary-800 text-primary-900 dark:text-primary-100 border-primary-500 border-[1px] p-2 outline-none focus:ring-0">
                  <div className="flex flex-col gap-2 items-center justify-center text-sm">
                    Refund Innovation ({refundCost.toFixed(2)})
                  </div>
                </PopoverContent>
              </Popover>

              <div className="w-full gap-2">
                <div className="flex justify-between gap-2">
                  <span className="text-xs">Tier: {tier.toNumber()}</span>
                  <span className="text-xs">
                    Assigned: {assignment.toFixed(0)}
                  </span>
                </div>
                <ProgressBar value={progress.toNumber()} />
              </div>

              <Popover openOnHover={true} placement="bottom-end">
                <PopoverTrigger asChild>
                  <Button
                    onClick={onAssign}
                    disabled={assignmentCost.gte(innovation)}
                    className="w-12 h-10 leading-none"
                  >
                    +
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="bg-primary-100 dark:bg-primary-800 text-primary-900 dark:text-primary-100 border-primary-500 border-[1px] p-2 outline-none focus:ring-0">
                  <div className="flex flex-col gap-2 items-center justify-center text-sm">
                    Cost: ({assignmentCost.toFixed(2)})
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </PopoverTrigger>

        <PopoverContent className="bg-primary-100 dark:bg-primary-800 text-primary-900 dark:text-primary-100 border-primary-500 border-[1px] p-2 outline-none focus:ring-0 min-w-72">
          <div className="flex flex-col gap-2 items-center justify-center text-sm">
            <InfoRow
              label={`${bonusType}:`}
              value={`x${bonusMultiplier?.toFixed(3)}`}
            />
            <InfoRow
              label="growth/tier:"
              value={`x${bonusMultiplierGrowthPerTier?.toFixed(2)}`}
            />
            <Spacer />
            <InfoRow label="next tier:" value={estimateToNextTier} />
          </div>
        </PopoverContent>
      </Popover>
    );
  }
);

export default ManagerRow;
