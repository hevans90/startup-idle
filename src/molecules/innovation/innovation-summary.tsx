import { ClassNameValue, twMerge } from "tailwind-merge";
import { useGeneratorStore } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { InfoRow } from "../../ui/InfoRow";
import { formatRate } from "../../utils/rate-utils";

export const InnovationSummary = ({
  className,
  compact,
}: {
  compact?: boolean;
  className?: ClassNameValue;
}) => {
  const { innovation, getMultiplier } = useInnovationStore();

  const globalMultiplier = getMultiplier().toFixed(4);

  const ips = useGeneratorStore((state) => state.getInnovationPerSecond());

  return (
    <div
      className={twMerge(
        "flex flex-col gap-2 items-center justify-center text-center w-full",
        className
      )}
    >
      {compact ? (
        <div className="w-64">
          <InfoRow
            label="Innovation"
            value={innovation.toFixed(2)}
            size="large"
          ></InfoRow>
          <InfoRow
            label="Rate"
            value={formatRate(ips).formatted}
            size="large"
          ></InfoRow>
          <InfoRow
            label="Global multi"
            value={`x${globalMultiplier}`}
            size="large"
          ></InfoRow>
        </div>
      ) : (
        <>
          <span>Innovation - better employees grow innovation faster:</span>
          <span className="opacity-50">({formatRate(ips).formatted})</span>
          <span>
            The more innovation, the higher global multiplier for ALL resources:
          </span>
          <span className="opacity-50">x{globalMultiplier}</span>
        </>
      )}
    </div>
  );
};
