import { twMerge } from "tailwind-merge";
import { useGeneratorPurchase } from "../hooks/use-purchase-generator";
import { Button } from "../ui/Button";
import { formatCurrency } from "../utils/money-utils";

export const GeneratorBuyButton = ({ id }: { id: string }) => {
  const { cost, affordable, onPurchase } = useGeneratorPurchase(id, 1);

  return (
    <Button
      onClick={onPurchase}
      disabled={!affordable}
      className={twMerge(
        "min-w-32",
        affordable ? " cursor-pointer" : " cursor-not-allowed"
      )}
    >
      {formatCurrency(cost)}
    </Button>
  );
};
