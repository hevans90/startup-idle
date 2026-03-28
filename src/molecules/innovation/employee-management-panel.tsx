import {
  GENERATOR_TYPES,
  type EmployeePerkBranch,
  type GeneratorId,
  useGeneratorStore,
} from "../../state/generators.store";
import {
  ManagerKeyValues,
  useInnovationStore,
} from "../../state/innovation.store";
import { Button } from "../../ui/Button";
import { InfoRow } from "../../ui/InfoRow";

const branchLabel: Record<EmployeePerkBranch, string> = {
  money: "+Money",
  innovation: "+Innov",
  cost: "−Cost",
  auto: "AutoBuy",
};

export const EmployeeManagementPanel = () => {
  const purchaseEmployeePerk = useGeneratorStore((s) => s.purchaseEmployeePerk);
  const canPurchaseEmployeePerk = useGeneratorStore(
    (s) => s.canPurchaseEmployeePerk
  );
  const getEmployeePerkNextCost = useGeneratorStore(
    (s) => s.getEmployeePerkNextCost
  );
  const getAvailableManagementPoints = useGeneratorStore(
    (s) => s.getAvailableManagementPoints
  );
  const perksByGen = useGeneratorStore((s) => s.employeeManagement.perks);

  const tierTotal = useInnovationStore((s) =>
    ManagerKeyValues.reduce(
      (sum, k) => sum + s.managers[k].tier.floor().toNumber(),
      0
    )
  );
  const available = getAvailableManagementPoints();

  return (
    <div className="flex flex-col gap-3 w-full text-sm">
      <div className="flex flex-col gap-1 px-1">
        <InfoRow
          label="Mgmt tiers (budget)"
          value={`${tierTotal} total · ${available} unspent`}
          size="small"
        />
        <p className="text-xs opacity-70 text-left">
          Spend management points from manager tiers on each role. Auto-buy
          purchases one employee per tick when you can afford it (fractions
          accumulate).
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {GENERATOR_TYPES.map((gen) => (
          <div
            key={gen.id}
            className="border border-primary-400 dark:border-primary-600 rounded p-2 flex flex-col gap-2"
          >
            <div className="flex justify-between items-baseline gap-2">
              <span className="font-medium capitalize">{gen.name}</span>
              <span className="text-xs opacity-70">
                M{perksByGen[gen.id as GeneratorId].moneyLevel} I
                {perksByGen[gen.id as GeneratorId].innovationLevel} C
                {perksByGen[gen.id as GeneratorId].costLevel} A
                {perksByGen[gen.id as GeneratorId].autoBuyLevel}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  "money",
                  "innovation",
                  "cost",
                  "auto",
                ] as EmployeePerkBranch[]
              ).map((branch) => {
                const cost = getEmployeePerkNextCost(gen.id as GeneratorId, branch);
                const can = canPurchaseEmployeePerk(gen.id as GeneratorId, branch);
                return (
                  <Button
                    key={branch}
                    className="text-xs px-2 py-1 min-w-0 flex-1"
                    disabled={!can || cost <= 0}
                    onClick={() => purchaseEmployeePerk(gen.id as GeneratorId, branch)}
                    title={cost > 0 ? `${cost} pts` : "Maxed"}
                  >
                    {branchLabel[branch]}
                    {cost > 0 ? ` (${cost})` : ""}
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
