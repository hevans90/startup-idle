import { useGeneratorStore } from "../state/generators.store";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { formatCurrency } from "../utils/money-utils";
import { RainbowText } from "../utils/vibe-utils";
import { GeneratorBuyButton } from "./generator-buy-button";

export const Generators = ({ isMobile }: { isMobile: boolean }) => {
  const { generators } = useGeneratorStore();

  return isMobile ? (
    <div className="flex flex-row flex-wrap gap-2">
      {generators.map((gen) => (
        <div
          key={gen.id}
          className="min-w-48 flex flex-col gap-2 items-center border-[1px] border-primary-300 dark:border-primary-600 px-3 py-2"
        >
          {gen.name} - {gen.amount}
          <div className="flex items-center">
            <span className="responsive-text-xs text-primary-400">
              {formatCurrency(gen.baseProduction * gen.multiplier * gen.amount)}
              /s
            </span>
          </div>
          <GeneratorBuyButton id={gen.id} />
          <span className="responsive-text-xs text-primary-400">
            {formatCurrency(gen.baseProduction * gen.multiplier)}/s
          </span>
        </div>
      ))}
    </div>
  ) : (
    <div className="flex flex-col">
      {generators.map((gen) => (
        <Popover key={gen.id} openOnHover={true} placement="left">
          <PopoverTrigger asChild>
            <div
              key={gen.id}
              className="flex responsive-text-sm justify-between items-center hover:cursor-help hover:bg-primary-300 dark:hover:bg-primary-800 py-1 px-2"
            >
              {gen.id === "vibe_coder" ? (
                <RainbowText className="grow" text={gen.name} />
              ) : (
                <span className="grow">{gen.name}</span>
              )}

              <span className="w-1/4 text-center">{gen.amount}</span>
              <GeneratorBuyButton
                id={gen.id}
                className="w-1/2 responsive-text-xs"
              />
            </div>
          </PopoverTrigger>

          <PopoverContent className="outline-none focus:ring-0 bg-primary-300 dark:bg-primary-800 p-2 flex flex-col gap-1 min-w-44">
            <div className="flex items-center gap-3 justify-between">
              <span className="responsive-text-xs grow text-primary-700 dark:text-primary-300">
                total:
              </span>
              <span className="responsive-text-xs">
                {formatCurrency(
                  gen.baseProduction * gen.multiplier * gen.amount
                )}
                /s
              </span>
            </div>
            <div className="flex items-center gap-3 justify-between border-b-[1px] border-primary-400 border-solid pb-2">
              <span className="responsive-text-xs grow text-primary-600 dark:text-primary-300">
                per:
              </span>
              <span className="responsive-text-xs">
                {formatCurrency(gen.baseProduction * gen.multiplier)}/s
              </span>
            </div>
            <div className="flex items-center gap-3 justify-between">
              <span className="responsive-text-xs grow text-primary-600 dark:text-primary-300">
                base production:
              </span>
              <span className="responsive-text-xs">
                {formatCurrency(gen.baseProduction)}
              </span>
            </div>
            <div className="flex items-center gap-3 justify-between">
              <span className="responsive-text-xs grow text-primary-500 dark:text-primary-300">
                multiplier:
              </span>
              <span className="responsive-text-xs">
                x{gen.multiplier.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-3 justify-between">
              <span className="responsive-text-xs grow text-primary-500 dark:text-primary-300">
                cost multiplier:
              </span>
              <span className="responsive-text-xs">
                {gen.costMultiplier.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-3 justify-between">
              <span className="responsive-text-xs grow text-primary-500 dark:text-primary-300">
                cost exponent:
              </span>
              <span className="responsive-text-xs">
                {gen.costExponent.toFixed(2)}
              </span>
            </div>
          </PopoverContent>
        </Popover>
      ))}
    </div>
  );
};
