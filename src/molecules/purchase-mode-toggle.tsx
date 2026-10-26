import { ClassNameValue, twMerge } from "tailwind-merge";
import { useGeneratorStore } from "../state/generators.store";
import { Label, Segmented } from "../ui/console";

/** HOW MANY A PRESS BUYS: one, or as many as can be afforded. */
export const PurchaseModeToggle = ({ className }: { className?: ClassNameValue }) => {
  const { purchaseMode, setPurchaseMode } = useGeneratorStore();
  return (
    <div className={twMerge("flex items-center justify-between gap-2", className)}>
      <Label>Buy</Label>
      <Segmented label="How many a press buys" value={purchaseMode} onChange={setPurchaseMode}
        options={[{ value: "single", label: "×1" }, { value: "max", label: "Max", title: "As many as you can afford" }]} />
    </div>
  );
};
