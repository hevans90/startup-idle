import { ClassNameValue, twMerge } from "tailwind-merge";
import { useGeneratorStore } from "../state/generators.store";
import { useGlobalSettingsStore } from "../state/global-settings.store";
import { useInnovationStore } from "../state/innovation.store";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { ResourceCounter } from "../ui/ResourceCounter";
import { formatRate } from "../utils/rate-utils";
import { InnovationSummary } from "./innovation/innovation-summary";
import { POPOVER } from "../ui/console";

export const InnovationCounter = ({
  className,
}: {
  className?: ClassNameValue;
}) => {
  const { innovation } = useInnovationStore();

  const ips = useGeneratorStore((state) => state.getInnovationPerSecond());

  return (
    <Popover openOnHover={true} persistOnHoverContent={true} placement="bottom">
      <PopoverTrigger asChild>
        <section
          className={twMerge(
            "flex cursor-help flex-col items-center p-2 hover:bg-surface-2",
            className,
          )}
        >
          <div className="responsive-text">
            <span className="opacity-50">Innovation: </span>
            <span className="">{innovation.toFixed(2)} </span>
          </div>
          <span className="opacity-50">({formatRate(ips).formatted})</span>
        </section>
      </PopoverTrigger>

      <PopoverContent className={twMerge(POPOVER, "w-56")}>
        Coming soon
      </PopoverContent>
    </Popover>
  );
};

export const ToolbarInnovationCounter = ({
  className,
  rateClassName,
}: {
  className?: ClassNameValue;
  rateClassName?: ClassNameValue;
}) => {
  const { innovation } = useInnovationStore();

  const ips = useGeneratorStore((state) => state.getInnovationPerSecond());

  const { setSidebarTab } = useGlobalSettingsStore();

  return (
    <ResourceCounter
      value={
        <>
          <span className="opacity-60">I</span> {innovation.toFixed(2)}
        </>
      }
      rate={formatRate(ips).formatted}
      role="innovation"
      onClick={() => setSidebarTab("innovation")}
      popover={<InnovationSummary />}
      className={className}
      rateClassName={rateClassName}
    />
  );
};
