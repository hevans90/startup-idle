import { IconSettings } from "@tabler/icons-react";
import { ClassNameValue, twMerge } from "tailwind-merge";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { resetAllGameStores } from "../simulation/reset-game-stores";
import { report } from "../state/comms.store";
import { useGlobalSettingsStore } from "../state/global-settings.store";
import { useSessionStore } from "../state/session.store";
import { useThemeStore } from "../state/theme.store";
import { Button, FOCUS, Panel, POPOVER, Section, Segmented, Toggle } from "../ui/console";
import { SoundControls } from "./sound-controls";

const ROW = "flex items-center justify-between gap-2 text-sm";

/**
 * SETTINGS, a panel: how it looks (theme, motion, day and night, map events),
 * how it sounds, and the reset — a second press to be sure. @see SoundControls
 */
export const SettingsPopover = ({
  className,
}: {
  className?: ClassNameValue;
}) => {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const motion = useGlobalSettingsStore((s) => s.motion);
  const setMotion = useGlobalSettingsStore((s) => s.setMotion);
  const dayNight = useGlobalSettingsStore((s) => s.dayNight);
  const setDayNight = useGlobalSettingsStore((s) => s.setDayNight);
  const eventsOff = useSessionStore((s) => s.mapEventsOff);
  const setEventsOff = useSessionStore((s) => s.setMapEventsOff);
  return (
    <Popover
      openOnHover={true}
      persistOnHoverContent={true}
      placement="right-start"
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Settings"
          className={twMerge("flex cursor-pointer items-center justify-center border border-line p-2 hover:bg-surface-2", FOCUS, className)}
        >
          <IconSettings className="h-6 w-6 text-fg xl:h-7 xl:w-7" />
        </button>
      </PopoverTrigger>

      <PopoverContent className={twMerge(POPOVER, "w-72 border-0 bg-transparent p-0 shadow-none")}>
        <Panel title="Settings" className="bg-surface-3">
          <div className={ROW}>
            <span className="text-fg-muted">Theme</span>
            <Segmented label="Theme" value={theme} onChange={setTheme}
              options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
          </div>
          <div className={ROW}>
            <span className="text-fg-muted">Motion</span>
            <Segmented label="Motion" value={motion} onChange={setMotion}
              options={[{ value: "full", label: "Full" }, { value: "calm", label: "Calm", title: "Nothing moves that need not" }]} />
          </div>
          <div className={ROW}>
            <span className="text-fg-muted">Day &amp; night</span>
            <Toggle label="Day and night on the map" on={dayNight} onChange={setDayNight} />
          </div>
          <div className={ROW}>
            <span className="text-fg-muted">Map events</span>
            {/* Floods, overflows and the like on the company map. @see stepEvents */}
            <Toggle label="Map events" on={!eventsOff} onChange={(on) => setEventsOff(!on)} />
          </div>
          <Section label="Sound">
            <SoundControls />
          </Section>
          <Section>
            <Button variant="danger" confirm="Press again: wipe everything" className="w-full"
              onClick={() => {
                // Every game store (the founder too), so a reset returns to founding.
                resetAllGameStores();
                report("Game fully reset. All progress wiped.");
              }}>
              Reset game
            </Button>
          </Section>
        </Panel>
      </PopoverContent>
    </Popover>
  );
};
