import { twMerge } from "tailwind-merge";
import { LEADER_PERKS, PERSONALITIES, type PersonalityId } from "../../game/leaders";
import type { GeneratorId } from "../../state/generators.store";
import { useInnovationStore } from "../../state/innovation.store";
import { useShallow } from "zustand/shallow";
import {
  REROLL_BASE_COST,
  useTeamLeadersEmployeesStore,
  type TeamLeaderEmployee,
} from "../../state/team-leaders.store";
import { Button, Dialog, Label } from "../../ui/console";
import { TenXDevText } from "../../utils/ten-x-utils";
import { RainbowText } from "../../utils/vibe-utils";
import { EmployeeAvatar } from "./employee-avatar";

/** A personality's edge, by a role of the console's. */
const PERSONALITY_EDGE: Record<PersonalityId, string> = {
  overachiever: "border-l-money",
  chaos_agent: "border-l-bad",
  quiet_quitter: "border-l-line-strong",
  brown_noser: "border-l-warn",
  thought_leader: "border-l-ai",
  burnout_risk: "border-l-innovation",
};

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
  const p = PERSONALITIES[candidate.personality];
  return (
    <div className={twMerge("flex gap-3 border border-l-2 border-line-quiet bg-surface-1 py-3 pr-3", PERSONALITY_EDGE[candidate.personality])}>
      <EmployeeAvatar name={candidate.name} role={candidate.role} traitId={candidate.personality} avatarId={candidate.avatarId} size="lg" className="ml-2 mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-baseline justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="text-sm font-semibold leading-none text-fg">{candidate.name}</span>
            <RoleChip role={candidate.role} />
          </div>
          <span className="shrink-0 text-[10px] uppercase tracking-widest text-fg-muted">{p.name}</span>
        </div>
        <p className="text-[11px] text-fg">{p.says}</p>
        <div className="flex flex-col gap-1">
          <Label>Perks they can grow into</Label>
          <p className="flex flex-wrap gap-1 text-[10px]">
            {p.pool.map((k) => <span key={k} title={LEADER_PERKS[k].says} className="border border-line-quiet px-1 py-px text-fg-muted">{LEADER_PERKS[k].name}</span>)}
          </p>
        </div>
        <div className="flex justify-end pt-1">
          <Button size="sm" variant="primary" onClick={onHire}>Hire {candidate.name.split(" ")[0]}</Button>
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
    <Dialog title="Recruitment" kicker={`Hiring a leader · ${roleLabel}`} onClose={onClose}
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
