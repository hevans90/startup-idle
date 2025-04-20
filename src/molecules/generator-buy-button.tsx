import { twMerge } from "tailwind-merge";
import { useGeneratorPurchase } from "../hooks/use-purchase-generator";
import { Button } from "../ui/Button";

export const GeneratorBuyButton = ({ id }: { id: string }) => {
  const { displayCost, affordable, onPurchase } = useGeneratorPurchase(id, 1);

  return (
    <Button
      onClick={onPurchase}
      disabled={!affordable}
      className={twMerge(
        "min-w-32",
        affordable
          ? "text-primary-600 cursor-pointer"
          : "text-primary-200 cursor-not-allowed"
      )}
    >
      ${displayCost}
    </Button>
  );
};
