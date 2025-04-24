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
  const { cost, affordable, onPurchase, max, purchaseMode } =
    useGeneratorPurchase(id);

  return (
    <Button
      onClick={onPurchase}
      disabled={!affordable}
      className={twMerge(
        "min-w-32 flex gap-2",
        affordable ? " cursor-pointer" : " cursor-not-allowed",
        className
      )}
    >
      {formatCurrency(cost)}
      <span className="opacity-70">
        {purchaseMode === "max" && max.amount > 1 && <>({max.amount})</>}
      </span>
    </Button>
  );
};
