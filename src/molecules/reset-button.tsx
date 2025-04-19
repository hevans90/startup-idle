import { Button } from "../ui/Button";

export const ResetButton = ({ onReset }: { onReset: () => void }) => {
  return (
    <Button
      onClick={onReset}
      className="bg-red-500 hover:bg-red-600 text-white px-4 py-2"
    >
      Reset Game
    </Button>
  );
};
