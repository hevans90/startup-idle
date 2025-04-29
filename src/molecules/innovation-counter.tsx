import { ClassNameValue, twMerge } from "tailwind-merge";
import { useGeneratorStore } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { formatRate } from "../utils/rate-utils";

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
            "flex flex-col items-center hover:bg-primary-200 dark:hover:bg-primary-600 p-2 cursor-help",
            className
          )}
        >
          <div className="responsive-text">
            <span className="opacity-50">Innovation: </span>
            <span className="">{innovation.toFixed(2)} </span>
          </div>
          <span className="opacity-50">({formatRate(ips).formatted})</span>
        </section>
      </PopoverTrigger>

      <PopoverContent className="bg-primary-100 dark:bg-primary-800 text-primary-900 dark:text-primary-100 border-primary-500 border-[1px] p-4 w-48 xl:w-52 2xl:w-56 3xl:w-64 outline-none focus:ring-0">
        Coming soon
      </PopoverContent>
    </Popover>
  );
};

export const ToolbarInnovationCounter = ({
  className,
}: {
  className?: ClassNameValue;
}) => {
  const { innovation } = useInnovationStore();

  const ips = useGeneratorStore((state) => state.getInnovationPerSecond());

  return (
    <Popover openOnHover={true} persistOnHoverContent={true} placement="bottom">
      <PopoverTrigger asChild>
        <div
          className={twMerge(
            "responsive-text cursor-help h-full flex items-center gap-1",
            className
          )}
        >
          <span className="opacity-50">I:</span>
          <span className="">{innovation.toFixed(2)} </span>
        </div>
      </PopoverTrigger>

      <PopoverContent className="bg-primary-100 dark:bg-primary-800 text-primary-900 dark:text-primary-100 border-primary-500 border-[1px] p-4  outline-none focus:ring-0">
        <div className="flex flex-col gap-2 items-center justify-center">
          Innovation mechanics coming soon!
          <span className="opacity-50">({formatRate(ips).formatted})</span>
        </div>
      </PopoverContent>
    </Popover>
  );
};
