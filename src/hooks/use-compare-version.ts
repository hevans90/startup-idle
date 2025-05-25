import { useEffect } from "react";
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
        `Version changed from ${storedVersion} to ${CURRENT_VERSION}, clearing storage`
      );
      clearAllStorageExceptVersion();
    }
    setVersion(CURRENT_VERSION);
  }, []);
};
