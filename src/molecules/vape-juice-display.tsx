import { ClassNameValue, twMerge } from "tailwind-merge";
import { useId, useMemo } from "react";
import { vapeTankFillRatio } from "../game/vape-display-utils";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { formatCurrency } from "../utils/money-utils";

/** SVG mod vape: tank window + liquid fill from `vapeTankFillRatio`. */
export const VapeJuiceDisplay = ({
  className,
}: {
  className?: ClassNameValue;
}) => {
  const uid = useId().replace(/:/g, "");
  const gradId = `vapeLiquid-${uid}`;
  const clipId = `vapeTankClip-${uid}`;

  const vapeJuice = useVapeAchievementsStore((s) => s.vapeJuice);
  const lifetime = useVapeAchievementsStore(
    (s) => s.lifetimeJuiceFromAchievements,
  );
  const purchased = useVapeAchievementsStore((s) => s.purchasedJuiceUpgradeIds);

  const fill = useMemo(
    () => vapeTankFillRatio(vapeJuice, lifetime, purchased),
    [vapeJuice, lifetime, purchased],
  );

  const innerTop = 52;
  const innerBottom = 220;
  const innerH = innerBottom - innerTop;
  const liquidTop = innerBottom - fill * innerH;

  return (
    <div
      className={twMerge(
        "pointer-events-none flex flex-col items-center gap-1 select-none",
        className,
      )}
    >
      <svg
        viewBox="0 0 140 280"
        className="h-auto w-full max-h-[min(42vh,22rem)] drop-shadow-lg transition-transform duration-300"
        aria-hidden
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#c026d3" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x="36" y={innerTop} width="68" height={innerH} rx="10" />
          </clipPath>
        </defs>

        {/* Mouthpiece */}
        <rect
          x="54"
          y="12"
          width="32"
          height="36"
          rx="6"
          className="fill-primary-400 stroke-primary-600 dark:fill-primary-600 dark:stroke-primary-400"
          strokeWidth="2"
        />
        <rect
          x="62"
          y="4"
          width="16"
          height="14"
          rx="3"
          className="fill-primary-500 dark:fill-primary-500"
        />

        {/* Body outline */}
        <rect
          x="28"
          y="44"
          width="84"
          height="192"
          rx="22"
          className="fill-primary-200/90 stroke-primary-500 dark:fill-primary-800/90 dark:stroke-primary-500"
          strokeWidth="3"
        />

        {/* Liquid (clipped to tank window) */}
        <g clipPath={`url(#${clipId})`}>
          <rect
            x="34"
            y={liquidTop}
            width="72"
            height={innerBottom - liquidTop + 4}
            fill={`url(#${gradId})`}
            className="transition-[y,height] duration-500 ease-out"
          />
          <rect
            x="34"
            y={liquidTop - 2}
            width="72"
            height="8"
            className="fill-white/25"
          />
        </g>

        {/* Tank glass edge */}
        <rect
          x="36"
          y={innerTop}
          width="68"
          height={innerH}
          rx="10"
          fill="none"
          className="stroke-primary-600/50 dark:stroke-primary-300/40"
          strokeWidth="2"
        />

        {/* Base */}
        <ellipse
          cx="70"
          cy="252"
          rx="38"
          ry="14"
          className="fill-primary-300 stroke-primary-500 dark:fill-primary-700 dark:stroke-primary-500"
          strokeWidth="2"
        />
      </svg>
      <p className="max-w-full truncate text-center text-[10px] font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-300">
        Vape juice
      </p>
      <p className="tabular-nums text-sm font-bold text-primary-800 dark:text-primary-100">
        {formatCurrency(vapeJuice, {
          showDollarSign: false,
          exponentBreakpoint: 1e9,
        })}
      </p>
    </div>
  );
};
