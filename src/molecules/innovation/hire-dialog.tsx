import { twMerge } from "tailwind-merge";
import {
  EMPLOYEE_SKILLS,
  EMPLOYEE_TRAITS,
  type TeamLeaderSkillId,
  type TeamLeaderTraitId,
} from "../../game/team-leaders.catalog";
import type { GeneratorId } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { useShallow } from "zustand/shallow";
import {
  REROLL_BASE_COST,
  useTeamLeadersEmployeesStore,
  type TeamLeaderEmployee,
} from "../../state/team-leaders.store";
import { Button } from "../../ui/Button";
import { TenXDevText } from "../../utils/ten-x-utils";
import { RainbowText } from "../../utils/vibe-utils";
import { EmployeeAvatar } from "./employee-avatar";
import { CAT_STYLE, SKILL_CAT, TRAIT_COLORS } from "./skill-styles";

// ─── Trait colour palette ─────────────────────────────────────────────────────

const TRAIT_BORDER: Record<TeamLeaderTraitId, string> = {
  overachiever:   "border-l-blue-500 dark:border-l-blue-400",
  chaos_agent:    "border-l-red-500 dark:border-l-red-400",
  quiet_quitter:  "border-l-slate-500 dark:border-l-slate-400",
  brown_noser:    "border-l-yellow-500 dark:border-l-yellow-400",
  thought_leader: "border-l-purple-500 dark:border-l-purple-400",
  burnout_risk:   "border-l-orange-500 dark:border-l-orange-400",
};

// ─── Skill chip (hire dialog) ─────────────────────────────────────────────────

function SkillChip({ skillId }: { skillId: TeamLeaderSkillId }) {
  const skill = EMPLOYEE_SKILLS[skillId];
  const { border, bg, text } = CAT_STYLE[SKILL_CAT[skillId]];
  return (
    <div
      className={twMerge(
        "flex flex-col gap-0.5 px-1.5 py-1 border",
        border,
        bg,
      )}
    >
      <span className={twMerge("text-[8px] font-semibold leading-none", text)}>
        {skill.name}
      </span>
      <span className="text-[7px] leading-none text-primary-600 dark:text-primary-400">
        {skill.descriptions[0]}
      </span>
    </div>
  );
}

// ─── Role label (inline, small) ───────────────────────────────────────────────

function RoleChip({ role }: { role: GeneratorId }) {
  if (role === "vibe_coder")
    return <RainbowText text="vibe coder" className="text-[10px]" />;
  if (role === "10x_dev")
    return <TenXDevText text="10x dev" className="text-[10px]" />;
  return (
    <span className="text-[10px] text-primary-400 dark:text-primary-500 capitalize">
      intern
    </span>
  );
}

// ─── Single candidate card ────────────────────────────────────────────────────

function CandidateCard({
  candidate,
  onHire,
}: {
  candidate: TeamLeaderEmployee;
  onHire: () => void;
}) {
  const trait = EMPLOYEE_TRAITS[candidate.traitId];

  return (
    <div
      className={twMerge(
        "border-l-2 border border-primary-300 dark:border-primary-700 pr-2 py-2.5 flex gap-3",
        TRAIT_BORDER[candidate.traitId],
      )}
    >
      {/* Avatar */}
      <EmployeeAvatar
        name={candidate.name}
        role={candidate.role}
        traitId={candidate.traitId}
        avatarId={candidate.avatarId}
        size="lg"
        className="ml-2 mt-0.5 shrink-0"
      />

      {/* Content */}
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        {/* Name + role + trait */}
        <div className="flex items-baseline justify-between gap-2 min-w-0">
          <div className="flex items-baseline gap-2 min-w-0 flex-1">
            <span className="text-sm font-semibold text-primary-800 dark:text-primary-100 leading-none">
              {candidate.name}
            </span>
            <RoleChip role={candidate.role} />
          </div>
          <span
            className={twMerge(
              "text-[9px] font-semibold uppercase tracking-wide shrink-0",
              TRAIT_COLORS[candidate.traitId],
            )}
          >
            {trait.name}
          </span>
        </div>

        {/* Flavor */}
        <p className="text-[9px] italic text-primary-400 dark:text-primary-500 leading-snug">
          "{trait.flavor}"
        </p>

        {/* Skill path preview */}
        <div className="flex flex-col gap-1">
          <span className="text-[8px] uppercase tracking-wider text-primary-400 dark:text-primary-600">
            Skills
          </span>
          <div className="flex gap-1 flex-wrap">
            {(candidate.skillPool ?? trait.skills.slice(0, 3)).map((sid) => (
              <SkillChip key={sid} skillId={sid} />
            ))}
          </div>
        </div>

        {/* Hire button */}
        <div className="flex justify-end pt-0.5">
          <Button type="button" className="text-[9px] px-2 py-1" onClick={onHire}>
            Hire →
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Dialog ───────────────────────────────────────────────────────────────────

export function HireDialog({
  role,
  onClose,
}: {
  role: GeneratorId;
  onClose: () => void;
}) {
  const { candidatePool, rerollCounts, hireCandidateFromPool, rerollCandidates } =
    useTeamLeadersEmployeesStore(
      useShallow((s) => ({
        candidatePool: s.candidatePool,
        rerollCounts: s.rerollCounts,
        hireCandidateFromPool: s.hireCandidateFromPool,
        rerollCandidates: s.rerollCandidates,
      })),
    );
  const candidates = candidatePool[role] ?? [];
  const rerollCount = rerollCounts[role] ?? 0;
  const rerollCost = Math.round(REROLL_BASE_COST * Math.pow(2, rerollCount));
  const innovation = useInnovationStore((s) => s.innovation);

  const canAffordReroll = innovation.gte(rerollCost);

  const roleLabel =
    role === "vibe_coder"
      ? "vibe coder"
      : role === "10x_dev"
        ? "10x dev"
        : "intern";

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      {/* Panel — stop propagation so clicks inside don't close */}
      <div
        className="bg-primary-100 dark:bg-primary-900 border border-primary-400 dark:border-primary-600 w-full max-w-sm mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-primary-300 dark:border-primary-700">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-semibold uppercase tracking-widest text-primary-400 dark:text-primary-500">
              Recruitment
            </span>
            <span className="text-[9px] text-primary-500 dark:text-primary-600">
              ·
            </span>
            {role === "vibe_coder" ? (
              <RainbowText
                text={roleLabel}
                className="text-[10px] font-medium"
              />
            ) : role === "10x_dev" ? (
              <TenXDevText
                text={roleLabel}
                className="text-[10px] font-medium"
              />
            ) : (
              <span className="text-[10px] font-medium text-primary-700 dark:text-primary-300 capitalize">
                {roleLabel}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[10px] text-primary-400 dark:text-primary-500 hover:text-primary-700 dark:hover:text-primary-200 leading-none px-1"
          >
            ✕
          </button>
        </div>

        {/* Candidate cards */}
        <div className="flex flex-col gap-2 p-3">
          {candidates.length === 0 ? (
            <p className="text-xs text-primary-400 dark:text-primary-500 text-center py-4">
              No candidates available.
            </p>
          ) : (
            candidates.map((c) => (
              <CandidateCard
                key={c.id}
                candidate={c}
                onHire={() => {
                  hireCandidateFromPool(role, c.id);
                  onClose();
                }}
              />
            ))
          )}
        </div>

        {/* Reroll footer */}
        <div className="border-t border-primary-300 dark:border-primary-700 px-3 py-2 flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] text-primary-400 dark:text-primary-500">
              Not feeling it?
            </span>
            <span className="text-[9px] tabular-nums text-primary-500 dark:text-primary-600">
              {innovation.toFixed(0)} innovation available
            </span>
          </div>
          <Button
            type="button"
            disabled={!canAffordReroll}
            onClick={() => rerollCandidates(role)}
            className="text-[9px] px-2 py-1 shrink-0"
            title={
              canAffordReroll
                ? `Costs ${rerollCost} innovation`
                : `Need ${rerollCost} innovation`
            }
          >
            Reroll — {rerollCost} ipa
          </Button>
        </div>
      </div>
    </div>
  );
}
