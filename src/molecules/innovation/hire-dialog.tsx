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
import { Button, Dialog } from "../../ui/console";
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
      <span className={twMerge("text-[10px] font-semibold leading-none", text)}>
        {skill.name}
      </span>
      <span className="text-[10px] leading-none text-fg-muted">
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
    <span className="text-[10px] text-fg-muted capitalize">
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
        "border-l-2 border border-line pr-2 py-2.5 flex gap-3",
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
            <span className="text-sm font-semibold text-fg leading-none">
              {candidate.name}
            </span>
            <RoleChip role={candidate.role} />
          </div>
          <span
            className={twMerge(
              "text-[10px] uppercase tracking-widest shrink-0",
              TRAIT_COLORS[candidate.traitId],
            )}
          >
            {trait.name}
          </span>
        </div>

        {/* Flavor */}
        <p className="text-[10px] italic text-fg-muted leading-snug">
          "{trait.flavor}"
        </p>

        {/* Skill path preview */}
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-fg-muted">
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
          <Button type="button" className="text-[10px] px-2 py-1" onClick={onHire}>
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

  // RECRUITMENT, a dialog: the candidates, a card each; a reroll in its foot.
  return (
    <Dialog title="Recruitment" kicker={`Hiring a team leader · ${roleLabel}`} onClose={onClose}
      actions={<>
        <span className="mr-auto self-center text-[11px] tabular-nums text-fg-muted">{innovation.toFixed(0)} innovation available</span>
        <Button size="sm" disabled={!canAffordReroll} onClick={() => rerollCandidates(role)}
          title={canAffordReroll ? `Costs ${rerollCost} innovation` : `Need ${rerollCost} innovation`}>
          Reroll · <span className="text-innovation">{rerollCost}</span>
        </Button>
      </>}>
      <div className="flex flex-col gap-2">
        {candidates.length === 0 ? (
          <p className="py-4 text-center text-xs text-fg-muted">No candidates available.</p>
        ) : (
          candidates.map((c) => (
            <CandidateCard key={c.id} candidate={c}
              onHire={() => { hireCandidateFromPool(role, c.id); onClose(); }} />
          ))
        )}
      </div>
    </Dialog>
  );
}
