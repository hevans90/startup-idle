import { useCallback } from "react";
import { report } from "../state/comms.store";
import { resetAllGameStores } from "../simulation/reset-game-stores";
import { Button } from "../ui/Button";

export const ResetButton = () => {
  const totalReset = useCallback(() => {
    if (confirm("This will reset all progress, are you sure?")) {
      // Single source of truth — resets every game store (incl. the founder),
      // so a reset returns the player to the founder-selection screen.
      resetAllGameStores();
      report("Game fully reset. All progress wiped.");
    }
  }, []);

  return (
    <Button
      onClick={totalReset}
      className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 responsive-text"
    >
      Reset Game
    </Button>
  );
};
