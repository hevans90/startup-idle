import { useId, useMemo } from "react";
import { ClassNameValue, twMerge } from "tailwind-merge";
import { vapeTankFillRatio } from "../game/vape-display-utils";
import { useVapeAchievementsStore } from "../state/vape-achievements.store";
import { formatCurrency } from "../utils/money-utils";

/**
 * SVG mod vape: a tank with a liquid fill, dressed by each purchased juice-shop
 * upgrade with a themed, filter-driven flourish.
 *
 * Pass `chargeFill` (0–1) to drive the tank fill from an external charge value
 * instead of the juice balance — used by the map overlay where the fill
 * represents how charged the vape is, not how much juice is stored.
 * Pass `compact` to hide the status label.
 */
export const VapeJuiceDisplay = ({
  className,
  compact = false,
  chargeFill,
}: {
  className?: ClassNameValue;
  compact?: boolean;
  chargeFill?: number;
}) => {
  const uid = useId().replace(/:/g, "");
  const id = (n: string) => `${n}-${uid}`;

  const vapeJuice = useVapeAchievementsStore((s) => s.vapeJuice);
  const lifetime = useVapeAchievementsStore(
    (s) => s.lifetimeJuiceFromAchievements,
  );
  const purchased = useVapeAchievementsStore((s) => s.purchasedJuiceUpgradeIds);
  const has = (x: string) => purchased.includes(x);

  const juiceFill = useMemo(
    () => vapeTankFillRatio(vapeJuice, lifetime, purchased),
    [vapeJuice, lifetime, purchased],
  );
  const fill = chargeFill !== undefined ? chargeFill : juiceFill;

  const innerTop = 52;
  const innerBottom = 220;
  const innerH = innerBottom - innerTop;
  const liquidTop = innerBottom - fill * innerH;

  return (
    <div
      className={twMerge(
        "pointer-events-none flex flex-col items-center select-none",
        className,
      )}
    >
      <svg
        viewBox="0 -30 140 270"
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
          {/* Nicotine shot: electric cyan-tinted liquid */}
          <linearGradient
            id={id("liquidCharged")}
            x1="0"
            y1="0"
            x2="0.3"
            y2="1"
          >
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="40%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#0e7490" />
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
          {/* DNA chip: cyan LED glow */}
          <radialGradient id={id("ledGlow")} cx="0.5" cy="0.5" r="0.5">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="1" />
            <stop offset="60%" stopColor="#0891b2" stopOpacity="0.5" />
            <stop offset="100%" stopColor="#0891b2" stopOpacity="0" />
          </radialGradient>

          {/* Bloom: blur + composite back over the source for a glowing element */}
          <filter id={id("bloom")} x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Wispy vapour: animated fractal turbulence warps + softens the puffs */}
          <filter id={id("smoke")} x="-90%" y="-90%" width="280%" height="280%">
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
          {/* Soft outer glow for DNA chip LEDs */}
          <filter
            id={id("ledBloom")}
            x="-120%"
            y="-120%"
            width="340%"
            height="340%"
          >
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
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

        {/* Coil polish: metallic chrome skin over the body */}
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

        {/* Ceramic coil: three white ceramic band rings around the body */}
        {has("juice_ceramic_coil") && (
          <g clipPath={`url(#${id("body")})`}>
            {[98, 148, 195].map((y) => (
              <rect
                key={y}
                x="28"
                y={y}
                width="84"
                height="8"
                fill="#f8fafc"
                opacity="0.32"
              />
            ))}
            {/* Thin highlight line at top edge of each band */}
            {[98, 148, 195].map((y) => (
              <rect
                key={`h${y}`}
                x="28"
                y={y}
                width="84"
                height="2"
                fill="#fff"
                opacity="0.5"
              />
            ))}
          </g>
        )}

        {/* Squonk mod: a side reservoir bottle mounted to the right */}
        {has("juice_squonk_mod") && (
          <g>
            <rect
              x="112"
              y="148"
              width="15"
              height="36"
              rx="5"
              className="fill-primary-300 stroke-primary-400 dark:fill-primary-700 dark:stroke-primary-500"
              strokeWidth="1.5"
            />
            {/* Squonk fill indicator — pulsing purple liquid inside */}
            <rect
              x="114"
              y="154"
              width="11"
              height="24"
              rx="3"
              fill="#7c3aed"
              opacity="0.35"
            >
              <animate
                attributeName="opacity"
                values="0.2;0.55;0.2"
                dur="3.2s"
                repeatCount="indefinite"
              />
            </rect>
            {/* Connect to body */}
            <rect
              x="108"
              y="160"
              width="8"
              height="5"
              rx="2"
              className="fill-primary-400 dark:fill-primary-600"
            />
          </g>
        )}

        {/* Liquid (clipped to tank window) */}
        <g clipPath={`url(#${id("tank")})`}>
          <rect
            x="34"
            y={liquidTop}
            width="72"
            height={innerBottom - liquidTop + 4}
            fill={`url(#${id(
              has("juice_nicotine_shot")
                ? "liquidCharged"
                : has("juice_deep_steep")
                  ? "liquidRich"
                  : "liquid",
            )})`}
            className="transition-[y,height] duration-500 ease-out"
          />
          <rect
            x="34"
            y={liquidTop - 2}
            width="72"
            height="8"
            className="fill-white/25"
          />

          {/* Deep steep: slow shimmer sweeping the liquid surface */}
          {has("juice_deep_steep") && (
            <ellipse
              cx="70"
              cy={liquidTop + 5}
              rx="32"
              ry="4"
              fill="#fff"
              opacity="0.18"
            >
              <animate
                attributeName="rx"
                values="26;38;26"
                dur="3.4s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0.08;0.22;0.08"
                dur="3.4s"
                repeatCount="indefinite"
              />
            </ellipse>
          )}

          {/* Nicotine shot: crackling electric arcs in the charged liquid */}
          {has("juice_nicotine_shot") && (
            <>
              <path
                d="M50 185 l4-12 l-3 0 l4-14"
                stroke="#67e8f9"
                strokeWidth="1.2"
                fill="none"
                opacity="0.7"
                strokeLinecap="round"
              >
                <animate
                  attributeName="opacity"
                  values="0;0.8;0;0.6;0"
                  dur="2.4s"
                  repeatCount="indefinite"
                />
              </path>
              <path
                d="M85 190 l-3-10 l2-1 l-5-13"
                stroke="#a5f3fc"
                strokeWidth="1"
                fill="none"
                opacity="0.7"
                strokeLinecap="round"
              >
                <animate
                  attributeName="opacity"
                  values="0;0;0.7;0;0.5;0"
                  dur="3s"
                  repeatCount="indefinite"
                />
              </path>
            </>
          )}

          {/* Max VG: thick juice sends glossy bubbles drifting up */}
          {has("juice_max_vg") &&
            [
              { cx: 55, r: 3, dur: "3.2s", begin: "0s" },
              { cx: 70, r: 4, dur: "4s", begin: "1.2s" },
              { cx: 85, r: 2.5, dur: "2.8s", begin: "0.6s" },
              { cx: 63, r: 2, dur: "3.6s", begin: "2s" },
            ].map((b) => (
              <circle
                key={b.cx}
                cx={b.cx}
                cy="212"
                r={b.r}
                fill={`url(#${id("bubble")})`}
              >
                <animate
                  attributeName="cy"
                  values="214;165"
                  dur={b.dur}
                  begin={b.begin}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0;0.9;0"
                  dur={b.dur}
                  begin={b.begin}
                  repeatCount="indefinite"
                />
              </circle>
            ))}

          {/* Mesh coil: fine crosshatch grid overlay on the tank window */}
          {has("juice_mesh_coil") && (
            <g opacity="0.22">
              {Array.from({ length: 13 }, (_, i) => (
                <line
                  key={`h${i}`}
                  x1="36"
                  y1={52 + i * 13}
                  x2="104"
                  y2={52 + i * 13}
                  stroke="#fff"
                  strokeWidth="0.7"
                />
              ))}
              {Array.from({ length: 8 }, (_, i) => (
                <line
                  key={`v${i}`}
                  x1={36 + i * 9.7}
                  y1="52"
                  x2={36 + i * 9.7}
                  y2="220"
                  stroke="#fff"
                  strokeWidth="0.7"
                />
              ))}
            </g>
          )}
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

        {/* DNA chip: column of pulsing LEDs down the left side */}
        {has("juice_dna_chip") && (
          <g
            clipPath={`url(#${id("body")})`}
            filter={`url(#${id("ledBloom")})`}
          >
            {[88, 110, 132, 154, 176, 198, 220].map((y, i) => (
              <circle
                key={y}
                cx="38"
                cy={y}
                r="2.8"
                fill={i % 2 === 0 ? "#22d3ee" : "#a78bfa"}
              >
                <animate
                  attributeName="opacity"
                  values="0.2;0.95;0.2"
                  dur="1.4s"
                  begin={`${i * 0.2}s`}
                  repeatCount="indefinite"
                />
              </circle>
            ))}
          </g>
        )}

        {/* Wick soak: a glistening soaked cotton wick at the base */}
        {has("juice_wick_soak") && (
          <g>
            <rect
              x="54"
              y="198"
              width="32"
              height="13"
              rx="5"
              className="fill-amber-100 dark:fill-amber-200"
            />
            <rect
              x="54"
              y="198"
              width="32"
              height="5"
              rx="2.5"
              fill="#fff"
              opacity="0.45"
            />
            <path
              d="M57 203 q4 3 8 0 t8 0 t8 0"
              stroke="#f59e0b"
              strokeWidth="0.8"
              fill="none"
              opacity="0.5"
            />
            <circle cx="60" cy="213" r="1.7" className="fill-amber-300">
              <animate
                attributeName="cy"
                values="211;219"
                dur="2.2s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0.8;0"
                dur="2.2s"
                repeatCount="indefinite"
              />
            </circle>
          </g>
        )}

        {/* Sub-ohm rig: a bloom-glowing coil over a pulsing heat haze */}
        {has("juice_sub_ohm") && (
          <g>
            <ellipse
              cx="70"
              cy="208"
              rx="30"
              ry="13"
              fill={`url(#${id("coilGlow")})`}
            >
              <animate
                attributeName="opacity"
                values="0.55;1;0.55"
                dur="1.8s"
                repeatCount="indefinite"
              />
            </ellipse>
            <g filter={`url(#${id("bloom")})`}>
              <path
                d="M44 208 q6.5 -10 13 0 t13 0 t13 0 t13 0"
                fill="none"
                stroke="#fb923c"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
              <path
                d="M44 208 q6.5 -10 13 0 t13 0 t13 0 t13 0"
                fill="none"
                stroke="#fef3c7"
                strokeWidth="1"
                strokeLinecap="round"
                opacity="0.9"
              />
            </g>
          </g>
        )}

        {/* Triple coil: three tight glowing coil arcs — brighter and higher-set */}
        {has("juice_triple_coil") && (
          <g>
            <ellipse
              cx="70"
              cy="203"
              rx="32"
              ry="10"
              fill={`url(#${id("coilGlow")})`}
            >
              <animate
                attributeName="opacity"
                values="0.4;0.85;0.4"
                dur="1.4s"
                repeatCount="indefinite"
              />
            </ellipse>
            <g filter={`url(#${id("bloom")})`}>
              <path
                d="M43 203 q4.5-6.5 9 0 t9 0"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              <path
                d="M61 203 q4.5-6.5 9 0 t9 0"
                fill="none"
                stroke="#fef3c7"
                strokeWidth="1.4"
                strokeLinecap="round"
                opacity="0.95"
              />
              <path
                d="M79 203 q4.5-6.5 9 0 t9 0"
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
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
                <animate
                  attributeName="cy"
                  values="8;-22"
                  dur="2.8s"
                  begin={c.begin}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="r"
                  values="2;11"
                  dur="2.8s"
                  begin={c.begin}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0;0.85;0"
                  dur="2.8s"
                  begin={c.begin}
                  repeatCount="indefinite"
                />
              </circle>
            ))}
          </g>
        )}

        {/* Nicotine shot: electric cyan sparks crackling from the mouthpiece */}
        {has("juice_nicotine_shot") && (
          <g filter={`url(#${id("bloom")})`}>
            {[
              { cx: 64, dur: "1.6s", begin: "0s" },
              { cx: 70, dur: "2.1s", begin: "0.5s" },
              { cx: 76, dur: "1.9s", begin: "1.1s" },
              { cx: 68, dur: "2.3s", begin: "1.7s" },
            ].map((s, i) => (
              <circle
                key={i}
                cx={s.cx}
                cy="2"
                r="1.6"
                fill="#22d3ee"
                opacity="0"
              >
                <animate
                  attributeName="cy"
                  values="2;-24"
                  dur={s.dur}
                  begin={s.begin}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="0;0.95;0"
                  dur={s.dur}
                  begin={s.begin}
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="r"
                  values="1.6;0.8;0"
                  dur={s.dur}
                  begin={s.begin}
                  repeatCount="indefinite"
                />
              </circle>
            ))}
          </g>
        )}
      </svg>
      {!compact && chargeFill !== undefined ? (
        <p
          className={twMerge(
            "text-[10px] font-semibold uppercase tracking-wide tabular-nums",
            chargeFill >= 0.999
              ? "text-violet-400 animate-pulse"
              : "text-primary-500 dark:text-primary-400",
          )}
        >
          {chargeFill >= 0.999
            ? "Ready 💨"
            : `Charging… ${Math.round(chargeFill * 100)}%`}
        </p>
      ) : !compact ? (
        <>
          <p className="max-w-full truncate text-center text-[10px] font-semibold uppercase tracking-wide text-primary-600 dark:text-primary-300">
            Vape juice
          </p>
          <p className="tabular-nums text-sm font-bold text-primary-800 dark:text-primary-100">
            {formatCurrency(vapeJuice, {
              showDollarSign: false,
              exponentBreakpoint: 1e9,
            })}
          </p>
        </>
      ) : null}
    </div>
  );
};
