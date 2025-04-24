import { ClassNameValue, twMerge } from "tailwind-merge";
import { useGeneratorStore } from "../state/generators.store";
import { Button } from "../ui/Button";

export const PurchaseModeToggle = ({
  className,
}: {
  className?: ClassNameValue;
}) => {
  const { purchaseMode, setPurchaseMode } = useGeneratorStore();

  const handleToggle = () => {
    if (purchaseMode === "single") {
      setPurchaseMode("max");
    }
    if (purchaseMode === "max") {
      setPurchaseMode("single");
    }
  };

  return (
    <Button
      onClick={handleToggle}
      className={twMerge(
        "px-4 py-2 bg-gray-200 dark:bg-primary-700 text-black dark:text-white",
        className
      )}
    >
      Purchase: {purchaseMode}
    </Button>
  );
};
