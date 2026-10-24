/**
 * QUEST UI — WHERE THE AI STANDS: Control to Autonomy across, People to
 * Machine up, −3 to +3 each. Its place a glowing dot; on a card, an arrow to
 * where an option would move it; on the dossier, the path it has come.
 */
import { AXIS_MOST, type Disposition } from "../game/quests/types";

export function DispositionChart({ at, to, path = [], size = 44, labels = false }: {
  at: Disposition;
  /** Where an option would move it. */
  to?: Disposition;
  /** Where it has stood, in order. */
  path?: readonly Disposition[];
  size?: number;
  labels?: boolean;
}) {
  const pad = labels ? 14 : 3, inner = size - pad * 2;
  const X = (d: Disposition) => pad + ((d.autonomy + AXIS_MOST) / (2 * AXIS_MOST)) * inner;
  const Y = (d: Disposition) => pad + ((AXIS_MOST - d.machine) / (2 * AXIS_MOST)) * inner;
  const trail = [{ autonomy: 0, machine: 0 }, ...path];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label={`Autonomy ${at.autonomy}, Machine ${at.machine}`}
      className="shrink-0 text-violet-600 dark:text-violet-300">
      <rect x={pad} y={pad} width={inner} height={inner} className="fill-primary-200/60 stroke-primary-400 dark:fill-primary-800/60 dark:stroke-primary-600" strokeWidth={0.5} />
      <line x1={size / 2} y1={pad} x2={size / 2} y2={size - pad} className="stroke-primary-400 dark:stroke-primary-600" strokeWidth={0.5} />
      <line x1={pad} y1={size / 2} x2={size - pad} y2={size / 2} className="stroke-primary-400 dark:stroke-primary-600" strokeWidth={0.5} />
      {labels && (
        <g className="fill-primary-600 dark:fill-primary-400" fontSize={8}>
          <text transform={`translate(9 ${size / 2}) rotate(-90)`} textAnchor="middle">Control</text>
          <text transform={`translate(${size - 9} ${size / 2}) rotate(90)`} textAnchor="middle">Autonomy</text>
          <text x={size / 2} y={9} textAnchor="middle">Machine</text>
          <text x={size / 2} y={size - 3} textAnchor="middle">People</text>
        </g>
      )}
      {path.length > 0 && (
        <polyline points={trail.map((d) => `${X(d)},${Y(d)}`).join(" ")} fill="none" stroke="currentColor" strokeOpacity={0.45} strokeWidth={1} />
      )}
      {to && (to.autonomy !== at.autonomy || to.machine !== at.machine) && (
        <line x1={X(at)} y1={Y(at)} x2={X(to)} y2={Y(to)} stroke="currentColor" strokeWidth={1.2} markerEnd="url(#quest-arrow)" />
      )}
      <defs>
        <marker id="quest-arrow" viewBox="0 0 6 6" refX={5} refY={3} markerWidth={5} markerHeight={5} orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
        </marker>
      </defs>
      <circle cx={X(at)} cy={Y(at)} r={labels ? 5 : 3.5} fill="currentColor" opacity={0.25} />
      <circle cx={X(at)} cy={Y(at)} r={labels ? 2.5 : 2} fill="currentColor" />
    </svg>
  );
}
