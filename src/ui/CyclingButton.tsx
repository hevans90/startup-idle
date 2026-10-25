import { Button } from "./console";

/** A step through a few values, a press each: ×1, ×10, ×100, max. */
export const CycleButton = ({
  values,
  currentValue,
  onChanged,
}: {
  currentValue: "max" | number;
  values: ("max" | number)[];
  onChanged: (value: "max" | number) => void;
}) => {
  const next = values[(values.indexOf(currentValue) + 1) % values.length];
  return (
    <Button size="sm" className="min-w-12 tabular-nums" title={`Next: ${next}`} onClick={() => onChanged(next)}>
      {currentValue === "max" ? "Max" : `×${currentValue}`}
    </Button>
  );
};
