import { useGlobalSettingsStore } from "../state/global-settings.store";
import { Button } from "../ui/Button";

/** Day and night on the company's map, on or off. @see world/daylight */
export const DayNightToggle = () => {
  const on = useGlobalSettingsStore((s) => s.dayNight);
  const set = useGlobalSettingsStore((s) => s.setDayNight);
  return (
    <Button
      onClick={() => set(!on)}
      className="px-4 py-2 bg-gray-200 dark:bg-primary-700 text-black dark:text-white responsive-text"
    >
      Day &amp; night: {on ? "on" : "off"}
    </Button>
  );
};
