import { useEffect } from "react";
import { resetAllGameStores } from "../simulation/reset-game-stores";
import {
  clearAllStorageExceptVersion,
  CURRENT_VERSION,
  hasMajorOrMinorChanged,
  useVersionStore,
} from "../state/version.store";

export const useCompareVersion = () => {
  const storedVersion = useVersionStore((state) => state.version);
  const setVersion = useVersionStore((state) => state.setVersion);

  useEffect(() => {
    if (hasMajorOrMinorChanged(storedVersion, CURRENT_VERSION)) {
      console.log(
        `Version changed from ${storedVersion} to ${CURRENT_VERSION}, wiping progress`
      );
      // Wipe persisted storage AND in-memory state — clearing storage alone
      // leaves the already-hydrated stores running on stale values this session.
      clearAllStorageExceptVersion();
      resetAllGameStores();
    }
    setVersion(CURRENT_VERSION);
  }, []);
};
