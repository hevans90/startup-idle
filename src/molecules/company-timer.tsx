import { useEffect, useState } from "react";
import { ClassNameValue, twMerge } from "tailwind-merge";
import { useSessionStore } from "../state/session.store";
import { formatDuration } from "../utils/time-utils";

/** "Incorporated X ago" — a live clock since the current company was founded. */
export const CompanyTimer = ({ className }: { className?: ClassNameValue }) => {
  const incorporatedAt = useSessionStore((s) => s.incorporatedAt);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className={twMerge(
        "flex flex-col leading-tight text-primary-500 dark:text-primary-400",
        className,
      )}
      title="Time since this company was founded"
    >
      <span className="text-[9px] uppercase tracking-wide opacity-70">
        Incorporated
      </span>
      <span className="responsive-text-xs tabular-nums">
        {formatDuration(now - incorporatedAt)} ago
      </span>
    </div>
  );
};
