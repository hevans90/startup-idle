import { useSessionStore } from "../state/session.store";
import { Button } from "../ui/Button";

/** Floods, overflows and the like on the company map, on or off. @see stepEvents */
export const MapEventsToggle = () => {
  const off = useSessionStore((s) => s.mapEventsOff);
  const setOff = useSessionStore((s) => s.setMapEventsOff);
  return (
    <Button
      onClick={() => setOff(!off)}
      className="px-4 py-2 bg-gray-200 dark:bg-primary-700 text-black dark:text-white responsive-text"
    >
      Map events: {off ? "off" : "on"}
    </Button>
  );
};
