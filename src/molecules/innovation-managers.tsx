import { ClassNameValue, twMerge } from "tailwind-merge";
import { useInnovationStore } from "../state/innovation.store";
import { Button } from "../ui/Button";

export const InnovationManagers = ({
  className,
}: {
  className?: ClassNameValue;
}) => {
  const { unlocks, canUnlock, unlock } = useInnovationStore();

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

      {state.unlocked && <div className="p-2">nice</div>}
    </div>
  );
};
