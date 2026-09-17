import { ClassNameValue, twMerge } from "tailwind-merge";
import { useGeneratorPurchase } from "../hooks/use-purchase-generator";
import { Button } from "../ui/Button";
import { formatCurrency } from "../utils/money-utils";

export const GeneratorBuyButton = ({
  id,
  className,
}: {
  id: string;
  className?: ClassNameValue;
}) => {
  const { cost, affordable, housed, onPurchase, max, purchaseMode } =
    useGeneratorPurchase(id);

  // TWO REASONS A HIRE CAN BE REFUSED, and they want different words. "No
  // housing" is a thing the player fixes on the MAP, not by waiting for money,
  // and a button that only ever says the price would leave them waiting.
  const blocked = !affordable || !housed;

  return (
    <Button
      onClick={onPurchase}
      disabled={blocked}
      title={!housed ? "No housing — build somewhere for them to live" : undefined}
      className={twMerge(
        "min-w-32 flex gap-2",
        blocked ? " cursor-not-allowed" : " cursor-pointer",
        className
      )}
    >
      {!housed ? (
        <span className="text-amber-700 dark:text-amber-300">No housing</span>
      ) : (
        <>
          {formatCurrency(cost)}
          <span className="opacity-70">
            {purchaseMode === "max" && max.amount > 1 && <>({max.amount})</>}
          </span>
        </>
      )}
    </Button>
  );
};
