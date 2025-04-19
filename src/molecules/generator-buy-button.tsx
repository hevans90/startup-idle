import { twMerge } from "tailwind-merge";
import { useGeneratorPurchase } from "../hooks/use-purchase-generator";
import { Button } from "../ui/Button";

export const GeneratorBuyButton = ({ id }: { id: string }) => {
  const { cost, affordable, onPurchase } = useGeneratorPurchase(id, 1);

  return (
    <Button
      onClick={onPurchase}
      disabled={!affordable}
      className={twMerge(
        "",
        affordable
          ? "text-primary-600 cursor-pointer"
          : "text-primary-200 cursor-not-allowed"
      )}
    >
      Buy for ${cost.toFixed(2)}
    </Button>
  );
};
