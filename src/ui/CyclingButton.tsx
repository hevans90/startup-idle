import { Button } from "./Button";

export const CycleButton = ({
  values,
  currentValue,
  onChanged,
}: {
  currentValue: "max" | number;
  values: ("max" | number)[];
  onChanged: (value: "max" | number) => void;
}) => {
  const currentIndex = values.indexOf(currentValue);
  const nextIndex = (currentIndex + 1) % values.length;

  const handleClick = () => {
    const nextValue = values[nextIndex];
    onChanged(nextValue);
  };

  return (
    <Button
      className="h-full p-0 text-sm min-w-12 border-primary-500"
      onClick={handleClick}
    >
      {currentValue}
    </Button>
  );
};
