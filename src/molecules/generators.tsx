import { useGeneratorStore } from "../state/generators.store";
import { formatCurrency } from "../utils/money-utils";
import { GeneratorBuyButton } from "./generator-buy-button";

export const Generators = () => {
  const { generators } = useGeneratorStore();

  return (
    <div className="flex flex-wrap gap-2">
      {generators.map((gen) => (
        <div
          key={gen.id}
          className="min-w-48 flex flex-col gap-2 items-center border-[1px] border-primary-500 px-3 py-2"
        >
          {gen.name} - {gen.amount}
          <div className="flex items-center">
            <span className="text-xs text-primary-400">
              {formatCurrency(gen.baseProduction * gen.multiplier * gen.amount)}
              /s
            </span>
          </div>
          <GeneratorBuyButton id={gen.id} />
          <span className="text-xs text-primary-400">
            {formatCurrency(gen.baseProduction * gen.multiplier)}/s
          </span>
        </div>
      ))}
    </div>
  );
};
