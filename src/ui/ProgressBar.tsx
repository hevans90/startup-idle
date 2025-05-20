import { ClassNameValue, twMerge } from "tailwind-merge";

type ProgressBarProps = {
  value: number;
  min?: number;
  max?: number;
  className?: ClassNameValue;
};

export const ProgressBar = ({
  value,
  min = 0,
  max = 100,
  className,
}: ProgressBarProps) => {
  const percent = Math.min(
    100,
    Math.max(0, ((value - min) / (max - min)) * 100)
  );

  return (
    <div className={twMerge("w-full select-none", className)}>
      <div className="relative w-full h-4 bg-primary-400 dark:bg-primary-600  overflow-hidden">
        <div
          className="h-full bg-primary-600 dark:bg-primary-400"
          style={{ width: `${percent}%` }}
        />
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-primary-50 text-xs">
          {percent.toFixed(2)}%
        </div>
      </div>
    </div>
  );
};
