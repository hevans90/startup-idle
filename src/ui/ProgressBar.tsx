import { ClassNameValue, twMerge } from "tailwind-merge";

type ProgressBarProps = {
  value: number;
  min?: number;
  max?: number;
  className?: ClassNameValue;
};

/** How far, as a thin bar in the console's colour and its percentage beside it. */
export const ProgressBar = ({
  value,
  min = 0,
  max = 100,
  className,
}: ProgressBarProps) => {
  const percent = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  return (
    <div className={twMerge("flex w-full select-none items-center gap-2", className)}>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} className="h-1.5 flex-1 overflow-hidden bg-surface-3">
        <div className="h-full bg-console transition-[width] duration-300" style={{ width: `${percent}%` }} />
      </div>
      <span className="w-12 text-right text-[11px] tabular-nums text-fg-muted">{percent.toFixed(1)}%</span>
    </div>
  );
};
