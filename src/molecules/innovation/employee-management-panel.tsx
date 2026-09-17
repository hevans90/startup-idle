import { useMemo, useState } from "react";
import { twMerge } from "tailwind-merge";
import { useShallow } from "zustand/shallow";
import { satisfactionTargetForRole } from "../../game/satisfaction";
import {
  EMPLOYEE_SKILLS,
  EMPLOYEE_TRAITS,
  getActivePairSynergies,
  skillMult,
  MAX_RANK,
  nextRankThreshold,
  RANK_THRESHOLDS,
  type TeamLeaderSkillId,
  type PairSynergy,
} from "../../game/team-leaders.catalog";
import {
  useGeneratorStore,
  type EmployeePerkBranch,
  type GeneratorId,
} from "../../state/generators.store";
import { ManagerKeyValues, useInnovationStore } from "../../state/innovation.store";
import {
  FIRE_COST_PER_RANK,
  useTeamLeadersEmployeesStore,
  type TeamLeaderEmployee,
} from "../../state/team-leaders.store";
import { Button } from "../../ui/Button";
import { InfoRow } from "../../ui/InfoRow";
import { TenXDevText } from "../../utils/ten-x-utils";
import { RainbowText } from "../../utils/vibe-utils";
import { EmployeeAvatar } from "./employee-avatar";
import { HireDialog } from "./hire-dialog";

// ─── Role label ───────────────────────────────────────────────────────────────

function RoleLabel({ id, className }: { id: GeneratorId; className?: string }) {
  if (id === "vibe_coder")
    return (
      <RainbowText
        text="vibe coder"
        className={twMerge("font-medium", className)}
      />
    );
  if (id === "10x_dev")
    return (
      <TenXDevText
        text="10x dev"
        className={twMerge("font-medium", className)}
      />
    );
  return (
    <span className={twMerge("font-medium capitalize", className)}>intern</span>
  );
}

// ─── Shared skill/trait styles ────────────────────────────────────────────────

import {
  CAT_STYLE,
  SKILL_CAT,
  TRAIT_COLORS,
} from "./skill-styles";

function StatBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.min(100, (value / Math.max(1, max)) * 100);
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className="text-[9px] text-primary-400 dark:text-primary-500 w-9 shrink-0">
        {label}
      </span>
      <div className="flex-1 h-1 bg-primary-200 dark:bg-primary-800 overflow-hidden min-w-0">
        <div
          className={twMerge("h-full transition-all duration-700", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[9px] tabular-nums text-primary-400 dark:text-primary-500 w-5 text-right shrink-0">
        {Math.floor(value)}
      </span>
    </div>
  );
}

function SkillPip({
  skillId,
  level,
}: {
  skillId: TeamLeaderSkillId;
  level: number;
}) {
  const skill = EMPLOYEE_SKILLS[skillId];
  const { border, bg, text, dimText } = CAT_STYLE[SKILL_CAT[skillId]];
  const unlocked = level > 0;
  return (
    <div
      className={twMerge(
        "flex flex-col gap-px px-1.5 py-1 border leading-none",
        unlocked
          ? twMerge(border, bg)
          : "border-primary-300/50 dark:border-primary-700/50",
      )}
    >
      <div className="flex items-center gap-1">
        <span
          className={twMerge(
            "text-[8px] font-semibold",
            unlocked ? text : "text-primary-500 dark:text-primary-600",
          )}
        >
          {skill.name}
        </span>
        <span
          className={twMerge(
            "text-[7px]",
            unlocked ? dimText : "text-primary-400/40 dark:text-primary-600/40",
          )}
        >
          {"▪".repeat(level)}
          {"·".repeat(3 - level)}
        </span>
      </div>
      <span
        className={twMerge(
          "text-[7px]",
          unlocked
            ? "text-primary-600 dark:text-primary-400"
            : "text-primary-500/50 dark:text-primary-600/50",
        )}
      >
        {unlocked ? skill.descriptions[level - 1] : skill.descriptions[0]}
      </span>
    </div>
  );
}

function TeamLeaderCard({ emp }: { emp: TeamLeaderEmployee }) {
  const spendRankPoint = useTeamLeadersEmployeesStore((s) => s.spendRankPoint);
  const fireEmployee = useTeamLeadersEmployeesStore((s) => s.fireEmployee);
  const innovation = useInnovationStore((s) => s.innovation);

  const trait = EMPLOYEE_TRAITS[emp.traitId];
  const nextThresh = nextRankThreshold(emp.rank);
  const statMax = nextThresh ?? RANK_THRESHOLDS[MAX_RANK];
  const legacyMult = skillMult("legacy_amplifier", emp.skills.legacy_amplifier ?? 0);
  const legacyRev = Math.round(emp.rank * 2 * legacyMult * 10) / 10;
  const legacyIps = Math.round(emp.rank * 1 * legacyMult * 10) / 10;
  const fireCost = emp.rank * FIRE_COST_PER_RANK;
  const canAffordFire = fireCost === 0 || innovation.gte(fireCost);

  return (
    <div className="border border-primary-300 dark:border-primary-700 p-2 flex flex-col gap-1.5">
      {/* Avatar + name + role + trait */}
      <div className="flex items-start gap-2 min-w-0">
        <EmployeeAvatar
          name={emp.name}
          role={emp.role}
          traitId={emp.traitId}
          avatarId={emp.avatarId}
          size="sm"
        />
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 min-w-0">
            <div className="flex items-baseline gap-1.5 min-w-0 flex-1">
              <span className="text-xs font-semibold text-primary-800 dark:text-primary-100 truncate">
                {emp.name}
              </span>
              <RoleLabel id={emp.role} className="text-[10px] font-normal" />
            </div>
            <span
              className={twMerge(
                "text-[9px] shrink-0 font-medium",
                TRAIT_COLORS[emp.traitId],
              )}
            >
              {trait.name}
            </span>
          </div>
          <p className="text-[9px] italic text-primary-400 dark:text-primary-500 leading-tight">
            {trait.flavor}
          </p>
        </div>
      </div>

      {/* Stat bars */}
      <div className="flex flex-col gap-0.5">
        <StatBar
          label="Output"
          value={emp.outputStat}
          max={statMax}
          color="bg-blue-400 dark:bg-blue-500"
        />
        <StatBar
          label="Morale"
          value={emp.moraleStat}
          max={statMax}
          color="bg-emerald-400 dark:bg-emerald-500"
        />
      </div>

      {/* Rank + unspent indicator */}
      <div className="flex items-center justify-between text-[9px] tabular-nums">
        <span className="text-primary-400 dark:text-primary-500">
          Rank {emp.rank}
          {emp.rank < MAX_RANK ? ` → ${nextThresh}` : " (max)"}
        </span>
        {emp.unspentPoints > 0 && (
          <span className="text-amber-500 dark:text-amber-400 font-semibold">
            ⬆ {emp.unspentPoints} to spend
          </span>
        )}
      </div>

      {/* Skill spend buttons (only shown when there are unspent points) */}
      {emp.unspentPoints > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-amber-500/20 pt-1.5">
          <p className="text-[9px] text-amber-500 dark:text-amber-400">
            Spend rank point:
          </p>
          <div className="flex flex-col gap-1">
            {(emp.skillPool ?? trait.skills.slice(0, 3)).map((skillId) => {
              const currentLevel = emp.skills[skillId] ?? 0;
              const maxed = currentLevel >= 3;
              const skill = EMPLOYEE_SKILLS[skillId];
              const { border, bg, text } = CAT_STYLE[SKILL_CAT[skillId]];
              return (
                <button
                  key={skillId}
                  onClick={() => spendRankPoint(emp.id, skillId)}
                  disabled={maxed}
                  className={twMerge(
                    "flex items-center justify-between gap-2 px-2 py-1.5 border text-left transition-colors w-full",
                    maxed
                      ? "border-primary-300/40 dark:border-primary-700/40 cursor-not-allowed opacity-50"
                      : twMerge(
                          "cursor-pointer",
                          border,
                          bg,
                          "hover:opacity-80",
                        ),
                  )}
                >
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span
                      className={twMerge(
                        "text-[9px] font-semibold leading-none",
                        maxed ? "text-primary-500" : text,
                      )}
                    >
                      {skill.name}
                      {maxed && (
                        <span className="ml-1 text-[7px] font-normal opacity-60">
                          maxed
                        </span>
                      )}
                    </span>
                    <span className="text-[7px] leading-none text-primary-600 dark:text-primary-300">
                      {maxed
                        ? skill.descriptions[2]
                        : `→ ${skill.descriptions[currentLevel]}`}
                    </span>
                  </div>
                  <span className="text-[8px] tabular-nums text-primary-400 dark:text-primary-600 shrink-0">
                    {currentLevel}/3
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Current skill levels */}
      <div className="flex gap-1 flex-wrap">
        {(emp.skillPool ?? trait.skills.slice(0, 3)).map((skillId) => (
          <SkillPip
            key={skillId}
            skillId={skillId}
            level={emp.skills[skillId] ?? 0}
          />
        ))}
      </div>

      {/* Fire */}
      <div className="flex items-center justify-between gap-2 border-t border-primary-200 dark:border-primary-700 pt-1.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] text-primary-400 dark:text-primary-500">
            {emp.rank > 0
              ? `Legacy → +${legacyRev}% rev, +${legacyIps}% IPS`
              : "Rank up to earn a legacy"}
          </span>
          {fireCost > 0 && (
            <span
              className={twMerge(
                "text-[8px] tabular-nums",
                canAffordFire
                  ? "text-primary-400 dark:text-primary-600"
                  : "text-red-400 dark:text-red-500",
              )}
            >
              Severance: {fireCost} ipa
            </span>
          )}
        </div>
        <Button
          type="button"
          className="text-[9px] px-1.5 py-0.5 shrink-0"
          disabled={!canAffordFire}
          onClick={() => fireEmployee(emp.id)}
          title={
            !canAffordFire ? `Need ${fireCost} innovation to fire` : undefined
          }
        >
          Fire{emp.rank > 0 ? " →" : ""}
        </Button>
      </div>
    </div>
  );
}

function PairSynergyRow({ syn }: { syn: PairSynergy }) {
  const parts: string[] = [];
  if (syn.globalRevenueMult != null && syn.globalRevenueMult !== 1)
    parts.push(
      `${syn.globalRevenueMult > 1 ? "+" : ""}${Math.round((syn.globalRevenueMult - 1) * 100)}% rev`,
    );
  if (syn.globalIpsMult)
    parts.push(`+${Math.round((syn.globalIpsMult - 1) * 100)}% IPS`);
  if (syn.satOffset)
    parts.push(`${syn.satOffset > 0 ? "+" : ""}${syn.satOffset} sat`);
  if (syn.outputGrowthBonus)
    parts.push(`+${Math.round(syn.outputGrowthBonus * 100)}% growth`);

  return (
    <div className="flex items-baseline gap-1.5 text-[9px]">
      <span className="text-emerald-400 shrink-0">⇌</span>
      <span className="font-medium text-primary-700 dark:text-primary-300">
        {syn.name}
      </span>
      <span className="text-primary-400 dark:text-primary-500 truncate">
        {parts.join(" · ")}
      </span>
    </div>
  );
}

const BRANCH_LABEL: Record<EmployeePerkBranch, string> = {
  money: "+Rev",
  innovation: "+Happy",
  cost: "-Cost",
  auto: "Auto",
};

const BRANCH_TITLE: Record<EmployeePerkBranch, string> = {
  money: "+20% revenue per level · lowers satisfaction target",
  innovation: "+20% IPS per level · raises satisfaction target",
  cost: "-3.2% hire cost per level · lowers satisfaction target",
  auto: "Auto-purchases employees · lowers satisfaction target",
};

// ─── Team Leaders Section ─────────────────────────────────────────────────────

type TeamLeadersSectionProps = {
  employees: TeamLeaderEmployee[];
  legacies: ReturnType<typeof useTeamLeadersEmployeesStore.getState>["legacies"];
  candidatePool: ReturnType<typeof useTeamLeadersEmployeesStore.getState>["candidatePool"];
  generators: ReturnType<typeof useGeneratorStore.getState>["generators"];
  totalUnspent: number;
  rolesNeedingHire: GeneratorId[];
  onHire: (role: GeneratorId) => void;
};

function TeamLeadersSection({
  employees,
  legacies,
  candidatePool,
  generators: _generators,
  totalUnspent,
  rolesNeedingHire,
  onHire,
}: TeamLeadersSectionProps) {
  const activePairSyns = useMemo(
    () => getActivePairSynergies(employees),
    [employees],
  );

  return (
    <div className="px-1 flex flex-col gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-primary-500 dark:text-primary-400">
        Team Leaders
        {totalUnspent > 0 && (
          <span className="ml-1.5 font-normal normal-case tracking-normal text-amber-500 dark:text-amber-400">
            · {totalUnspent} unspent
          </span>
        )}
      </p>

      <div className="flex flex-col gap-2">
        {employees.map((emp) => (
          <TeamLeaderCard key={emp.id} emp={emp} />
        ))}
        {rolesNeedingHire.map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => onHire(role)}
            className="flex items-center justify-between gap-2 border border-dashed border-primary-300 dark:border-primary-700 hover:border-primary-400 dark:hover:border-primary-500 px-2 py-2 transition-colors group"
          >
            <div className="flex items-center gap-1.5">
              <RoleLabel id={role} className="text-[10px]" />
              {candidatePool[role]?.length ? (
                <span className="text-[9px] text-emerald-500 dark:text-emerald-400">
                  · {candidatePool[role]!.length} candidates ready
                </span>
              ) : (
                <span className="text-[9px] text-primary-400 dark:text-primary-600">
                  · no team leader
                </span>
              )}
            </div>
            <span className="text-[9px] text-primary-400 dark:text-primary-500 group-hover:text-primary-600 dark:group-hover:text-primary-300 transition-colors">
              Find talent →
            </span>
          </button>
        ))}
      </div>

      {activePairSyns.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-primary-200 dark:border-primary-700 pt-1.5">
          <p className="text-[9px] uppercase tracking-wider text-primary-400 dark:text-primary-500">
            Pair synergies
          </p>
          {activePairSyns.map((syn) => (
            <PairSynergyRow key={syn.id} syn={syn} />
          ))}
        </div>
      )}

      {legacies.length > 0 && (
        <div className="flex flex-col gap-0.5 border-t border-primary-200 dark:border-primary-700 pt-1.5">
          <p className="text-[9px] uppercase tracking-wider text-primary-400 dark:text-primary-500">
            Legacy bonuses
          </p>
          {legacies.map((leg) => (
            <div key={leg.role} className="flex gap-1.5 text-[9px]">
              <RoleLabel id={leg.role} className="text-[9px] font-normal" />
              <span className="text-primary-400 dark:text-primary-500">
                +{Math.round(leg.revenueMult * 100)}% rev · +
                {Math.round(leg.ipsMult * 100)}% IPS
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Micromanagement Section ──────────────────────────────────────────────────

type MicromanagementSectionProps = {
  perksByGen: ReturnType<typeof useGeneratorStore.getState>["employeeManagement"]["perks"];
  generators: ReturnType<typeof useGeneratorStore.getState>["generators"];
  available: number;
  getManagementPointsSpentOnRow: (id: GeneratorId) => number;
  refundEmployeeManagementRow: (id: GeneratorId) => void;
  getEmployeePerkNextCost: (id: GeneratorId, branch: EmployeePerkBranch) => number;
  canPurchaseEmployeePerk: (id: GeneratorId, branch: EmployeePerkBranch) => boolean;
  purchaseEmployeePerk: (id: GeneratorId, branch: EmployeePerkBranch) => void;
};

function MicromanagementSection({
  perksByGen,
  generators,
  available: _available,
  getManagementPointsSpentOnRow,
  refundEmployeeManagementRow,
  getEmployeePerkNextCost,
  canPurchaseEmployeePerk,
  purchaseEmployeePerk,
}: MicromanagementSectionProps) {
  return (
    <div className="border-t border-primary-200 dark:border-primary-700 px-1 pt-2 pb-1 flex flex-col gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-primary-500 dark:text-primary-400">
        Micromanagement
      </p>
      {generators.map((gen) => {
        const gid = gen.id as GeneratorId;
        const rowSpent = getManagementPointsSpentOnRow(gid);
        const target = Math.round(
          satisfactionTargetForRole(gid, gen.amount, perksByGen[gid]),
        );
        return (
          <div
            key={gen.id}
            className="border border-primary-300 dark:border-primary-700 p-2 flex flex-col gap-1.5"
          >
            <div className="flex justify-between items-center gap-1">
              <div className="flex items-center gap-2 min-w-0">
                <RoleLabel id={gid} />
                <span className="text-[10px] text-primary-400 dark:text-primary-500 tabular-nums">
                  target {target > 0 ? "+" : ""}
                  {target}
                </span>
              </div>
              <Button
                type="button"
                className="text-[10px] px-1.5 py-0.5 shrink-0"
                disabled={rowSpent <= 0}
                onClick={() => refundEmployeeManagementRow(gid)}
              >
                Refund +{rowSpent}
              </Button>
            </div>
            <div className="flex gap-1">
              {(
                [
                  "money",
                  "innovation",
                  "cost",
                  "auto",
                ] as EmployeePerkBranch[]
              ).map((branch) => {
                const cost = getEmployeePerkNextCost(gid, branch);
                const can = canPurchaseEmployeePerk(gid, branch);
                return (
                  <Button
                    key={branch}
                    className="text-[10px] px-1.5 py-0.5 min-w-0 flex-1"
                    disabled={!can || cost <= 0}
                    onClick={() => purchaseEmployeePerk(gid, branch)}
                    title={BRANCH_TITLE[branch]}
                  >
                    {BRANCH_LABEL[branch]}
                    {cost > 0 ? ` (${cost})` : ""}
                  </Button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export const EmployeeManagementPanel = () => {
  const [hiringFor, setHiringFor] = useState<GeneratorId | null>(null);

  // Change 1: collapse 8 individual useGeneratorStore calls into one useShallow selector
  const {
    purchaseEmployeePerk,
    refundEmployeeManagementRow,
    getManagementPointsSpentOnRow,
    canPurchaseEmployeePerk,
    getEmployeePerkNextCost,
    perksByGen,
    generators,
    spentManagementPoints,
  } = useGeneratorStore(
    useShallow((s) => ({
      purchaseEmployeePerk: s.purchaseEmployeePerk,
      refundEmployeeManagementRow: s.refundEmployeeManagementRow,
      getManagementPointsSpentOnRow: s.getManagementPointsSpentOnRow,
      canPurchaseEmployeePerk: s.canPurchaseEmployeePerk,
      getEmployeePerkNextCost: s.getEmployeePerkNextCost,
      perksByGen: s.employeeManagement.perks,
      generators: s.generators,
      spentManagementPoints: s.employeeManagement.spentManagementPoints,
    })),
  );

  const { employees, legacies, candidatePool } = useTeamLeadersEmployeesStore(
    useShallow((s) => ({
      employees: s.employees,
      legacies: s.legacies,
      candidatePool: s.candidatePool,
    })),
  );

  const tierTotal = useInnovationStore((s) =>
    ManagerKeyValues.reduce((sum, key) => sum + s.managers[key].tier.floor().toNumber(), 0),
  );
  const available = tierTotal - spentManagementPoints;

  // Change 4: memoize derived values
  const totalUnspent = useMemo(
    () => employees.reduce((n, e) => n + e.unspentPoints, 0),
    [employees],
  );

  const rolesNeedingHire = useMemo(
    () =>
      generators
        .filter((g) => g.amount > 0 && !employees.some((e) => e.role === g.id))
        .map((g) => g.id as GeneratorId),
    [generators, employees],
  );

  const hasTeamLeadersSection =
    employees.length > 0 || rolesNeedingHire.length > 0;

  return (
    <div className="flex flex-col gap-3 w-full text-sm">
      {/* Hire dialog portal */}
      {hiringFor && (
        <HireDialog role={hiringFor} onClose={() => setHiringFor(null)} />
      )}

      {/* Budget */}
      <div className="px-1">
        <InfoRow
          label="Mgmt tiers (budget)"
          value={`${tierTotal} total · ${available} unspent`}
          size="small"
        />
      </div>

      {/* Change 5: team leaders section as sub-component */}
      {hasTeamLeadersSection && (
        <TeamLeadersSection
          employees={employees}
          legacies={legacies}
          candidatePool={candidatePool}
          generators={generators}
          totalUnspent={totalUnspent}
          rolesNeedingHire={rolesNeedingHire}
          onHire={setHiringFor}
        />
      )}

      {/* Change 5: micromanagement section as sub-component */}
      <MicromanagementSection
        perksByGen={perksByGen}
        generators={generators}
        available={available}
        getManagementPointsSpentOnRow={getManagementPointsSpentOnRow}
        refundEmployeeManagementRow={refundEmployeeManagementRow}
        getEmployeePerkNextCost={getEmployeePerkNextCost}
        canPurchaseEmployeePerk={canPurchaseEmployeePerk}
        purchaseEmployeePerk={purchaseEmployeePerk}
      />
    </div>
  );
};
