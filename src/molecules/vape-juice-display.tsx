import { ClassNameValue, twMerge } from "tailwind-merge";
import { useId, useMemo } from "react";
import { vapeTankFillRatio } from "../game/vape-display-utils";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { formatCurrency } from "../utils/money-utils";

/**
 * SVG mod vape: a tank with a liquid fill, dressed by each purchased juice-shop
 * upgrade with a themed, filter-driven flourish — turbulent vapour clouds, a
 * bloom-glowing sub-ohm coil, glossy rising bubbles, a chrome sheen sweep, a
 * richer steeped liquid, and a glistening soaked wick.
 */
export const VapeJuiceDisplay = ({
  className,
}: {
  className?: ClassNameValue;
}) => {
  const uid = useId().replace(/:/g, "");
  const id = (n: string) => `${n}-${uid}`;

  const vapeJuice = useVapeAchievementsStore((s) => s.vapeJuice);
  const lifetime = useVapeAchievementsStore(
    (s) => s.lifetimeJuiceFromAchievements,
  );
  const purchased = useVapeAchievementsStore((s) => s.purchasedJuiceUpgradeIds);
  const has = (x: string) => purchased.includes(x);

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
        viewBox="0 -28 140 308"
        className="h-auto w-full max-h-[min(42vh,22rem)] drop-shadow-xl"
        aria-hidden
      >
        <defs>
          {/* Base liquid */}
          <linearGradient id={id("liquid")} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a78bfa" />
            <stop offset="100%" stopColor="#c026d3" />
          </linearGradient>
          {/* Deep-steep: a darker, richer brew */}
          <linearGradient id={id("liquidRich")} x1="0" y1="0" x2="0.25" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" />
            <stop offset="50%" stopColor="#9d174d" />
            <stop offset="100%" stopColor="#3b0764" />
          </linearGradient>
          {/* Glassy body sheen (always on) */}
          <linearGradient id={id("glass")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="16%" stopColor="#fff" stopOpacity="0.4" />
            <stop offset="34%" stopColor="#fff" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#000" stopOpacity="0.16" />
          </linearGradient>
          {/* Polished chrome body */}
          <linearGradient id={id("chrome")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#64748b" />
            <stop offset="22%" stopColor="#f1f5f9" />
            <stop offset="44%" stopColor="#94a3b8" />
            <stop offset="70%" stopColor="#e2e8f0" />
            <stop offset="100%" stopColor="#475569" />
          </linearGradient>
          {/* Moving sheen band */}
          <linearGradient id={id("sheen")} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#fff" stopOpacity="0" />
            <stop offset="50%" stopColor="#fff" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          {/* Glossy bubble sphere */}
          <radialGradient id={id("bubble")} cx="0.35" cy="0.3" r="0.7">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="38%" stopColor="#fff" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0.04" />
          </radialGradient>
          {/* Hot coil glow */}
          <radialGradient id={id("coilGlow")} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#fed7aa" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#f97316" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#ea580c" stopOpacity="0" />
          </radialGradient>

          {/* Bloom: blur + composite back over the source for a glowing element */}
          <filter
            id={id("bloom")}
            x="-70%"
            y="-70%"
            width="240%"
            height="240%"
          >
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Wispy vapour: animated fractal turbulence warps + softens the puffs */}
          <filter
            id={id("smoke")}
            x="-90%"
            y="-90%"
            width="280%"
            height="280%"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.02 0.035"
              numOctaves="2"
              seed="7"
              result="noise"
            >
              <animate
                attributeName="baseFrequency"
                dur="10s"
                values="0.02 0.035;0.032 0.022;0.02 0.035"
                repeatCount="indefinite"
              />
            </feTurbulence>
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="16"
              xChannelSelector="R"
              yChannelSelector="G"
            />
            <feGaussianBlur stdDeviation="1.8" />
          </filter>

          <clipPath id={id("tank")}>
            <rect x="36" y={innerTop} width="68" height={innerH} rx="10" />
          </clipPath>
          <clipPath id={id("body")}>
            <rect x="28" y="44" width="84" height="192" rx="22" />
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

        {/* Body */}
        <rect
          x="28"
          y="44"
          width="84"
          height="192"
          rx="22"
          className="fill-primary-200/90 stroke-primary-500 dark:fill-primary-800/90 dark:stroke-primary-500"
          strokeWidth="3"
        />
        {/* Coil polish: a metallic chrome skin over the body */}
        {has("juice_coil_polish") && (
          <rect
            x="28"
            y="44"
            width="84"
            height="192"
            rx="22"
            fill={`url(#${id("chrome")})`}
            opacity="0.55"
            clipPath={`url(#${id("body")})`}
          />
        )}

        {/* Liquid (clipped to tank window) */}
        <g clipPath={`url(#${id("tank")})`}>
          <rect
            x="34"
            y={liquidTop}
            width="72"
            height={innerBottom - liquidTop + 4}
            fill={`url(#${id(has("juice_deep_steep") ? "liquidRich" : "liquid")})`}
            className="transition-[y,height] duration-500 ease-out"
          />
          <rect
            x="34"
            y={liquidTop - 2}
            width="72"
            height="8"
            className="fill-white/25"
          />
          {/* Deep steep: a slow shimmer sweeping the liquid surface */}
          {has("juice_deep_steep") && (
            <ellipse cx="70" cy={liquidTop + 5} rx="32" ry="4" fill="#fff" opacity="0.18">
              <animate attributeName="rx" values="26;38;26" dur="3.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.08;0.22;0.08" dur="3.4s" repeatCount="indefinite" />
            </ellipse>
          )}
          {/* Max VG: thick juice sends glossy bubbles drifting up */}
          {has("juice_max_vg") &&
            [
              { cx: 55, r: 3, dur: "3.2s", begin: "0s" },
              { cx: 70, r: 4, dur: "4s", begin: "1.2s" },
              { cx: 85, r: 2.5, dur: "2.8s", begin: "0.6s" },
              { cx: 63, r: 2, dur: "3.6s", begin: "2s" },
            ].map((b) => (
              <circle key={b.cx} cx={b.cx} cy="212" r={b.r} fill={`url(#${id("bubble")})`}>
                <animate attributeName="cy" values="214;165" dur={b.dur} begin={b.begin} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;0.9;0" dur={b.dur} begin={b.begin} repeatCount="indefinite" />
              </circle>
            ))}
        </g>

        {/* Glassy body highlight (always) */}
        <rect
          x="28"
          y="44"
          width="84"
          height="192"
          rx="22"
          fill={`url(#${id("glass")})`}
          clipPath={`url(#${id("body")})`}
        />

        {/* Wick soak: a glistening soaked cotton wick at the base */}
        {has("juice_wick_soak") && (
          <g>
            <rect x="54" y="198" width="32" height="13" rx="5" className="fill-amber-100 dark:fill-amber-200" />
            <rect x="54" y="198" width="32" height="5" rx="2.5" fill="#fff" opacity="0.45" />
            <path d="M57 203 q4 3 8 0 t8 0 t8 0" stroke="#f59e0b" strokeWidth="0.8" fill="none" opacity="0.5" />
            <circle cx="60" cy="213" r="1.7" className="fill-amber-300">
              <animate attributeName="cy" values="211;219" dur="2.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.8;0" dur="2.2s" repeatCount="indefinite" />
            </circle>
          </g>
        )}

        {/* Sub-ohm rig: a bloom-glowing coil over a pulsing heat haze */}
        {has("juice_sub_ohm") && (
          <g>
            <ellipse cx="70" cy="208" rx="30" ry="13" fill={`url(#${id("coilGlow")})`}>
              <animate attributeName="opacity" values="0.55;1;0.55" dur="1.8s" repeatCount="indefinite" />
            </ellipse>
            <g filter={`url(#${id("bloom")})`}>
              <path d="M44 208 q6.5 -10 13 0 t13 0 t13 0 t13 0" fill="none" stroke="#fb923c" strokeWidth="2.6" strokeLinecap="round" />
              <path d="M44 208 q6.5 -10 13 0 t13 0 t13 0 t13 0" fill="none" stroke="#fef3c7" strokeWidth="1" strokeLinecap="round" opacity="0.9" />
            </g>
          </g>
        )}

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

        {/* Coil polish: a specular sheen sweeping diagonally across the body */}
        {has("juice_coil_polish") && (
          <g clipPath={`url(#${id("body")})`}>
            <rect
              x="-40"
              y="40"
              width="26"
              height="200"
              fill={`url(#${id("sheen")})`}
              transform="skewX(-16)"
            >
              {/* sweep across in the first ~third, then rest off-screen */}
              <animate
                attributeName="x"
                values="-60;160;160"
                keyTimes="0;0.32;1"
                dur="7s"
                repeatCount="indefinite"
              />
            </rect>
          </g>
        )}

        {/* Cloud chaser: turbulent vapour billowing from the mouthpiece */}
        {has("juice_cloud_chaser") && (
          <g
            filter={`url(#${id("smoke")})`}
            className="fill-slate-200/80 dark:fill-slate-100/50"
          >
            {[
              { cx: 70, begin: "0s" },
              { cx: 61, begin: "0.8s" },
              { cx: 79, begin: "1.5s" },
              { cx: 70, begin: "2.2s" },
            ].map((c, i) => (
              <circle key={i} cx={c.cx} cy="6" r="4">
                <animate attributeName="cy" values="8;-22" dur="2.8s" begin={c.begin} repeatCount="indefinite" />
                <animate attributeName="r" values="2;11" dur="2.8s" begin={c.begin} repeatCount="indefinite" />
                <animate attributeName="opacity" values="0;0.85;0" dur="2.8s" begin={c.begin} repeatCount="indefinite" />
              </circle>
            ))}
          </g>
        )}
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
