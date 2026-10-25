import { IconSettings } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { ClassNameValue, twMerge } from "tailwind-merge";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/Popover";
import { resetAllGameStores } from "../simulation/reset-game-stores";
import { report } from "../state/comms.store";
import { useGlobalSettingsStore } from "../state/global-settings.store";
import { useSessionStore } from "../state/session.store";
import { useThemeStore } from "../state/theme.store";
import { Button, FOCUS, Field, Label, POPOVER_BARE, Segmented, Toggle } from "../ui/console";
import { SoundControls } from "./sound-controls";

/** A group of settings: its name, then a row a setting. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1 border-t border-line-quiet px-4 py-3 first:border-t-0">
      <Label className="mb-1">{title}</Label>
      {children}
    </section>
  );
}

/**
 * SETTINGS: how it looks (theme, motion, day and night, map events), how it
 * sounds, and the reset — a second press to be sure. @see SoundControls
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
      placement="bottom-start"
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Settings"
          className={twMerge("flex cursor-pointer items-center justify-center text-fg-muted hover:bg-surface-2 hover:text-fg", FOCUS, className)}
        >
          <IconSettings className="h-5 w-5" stroke={1.6} />
        </button>
      </PopoverTrigger>

      <PopoverContent className={twMerge(POPOVER_BARE, "w-80 border border-line-strong border-t-2 border-t-console bg-surface-3 text-fg shadow-xl")}>
        <header className="flex items-center gap-2 border-b border-line-quiet px-4 py-2">
          <IconSettings className="h-3.5 w-3.5 text-console" stroke={1.6} />
          <h2 className="font-display text-[11px] uppercase tracking-widest">Settings</h2>
        </header>
        <Group title="Display">
          <Field label="Theme">
            <Segmented label="Theme" value={theme} onChange={setTheme}
              options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
          </Field>
          <Field label="Motion" hint="Calm: nothing moves that need not">
            <Segmented label="Motion" value={motion} onChange={setMotion}
              options={[{ value: "full", label: "Full" }, { value: "calm", label: "Calm" }]} />
          </Field>
          <Field label="Day and night">
            <Toggle label="Day and night on the map" on={dayNight} onChange={setDayNight} />
          </Field>
          {/* Floods, overflows and the like on the company map. @see stepEvents */}
          <Field label="Map events" hint="Floods, overflows and the like">
            <Toggle label="Map events" on={!eventsOff} onChange={(on) => setEventsOff(!on)} />
          </Field>
        </Group>
        <Group title="Sound">
          <SoundControls />
        </Group>
        <Group title="Progress">
          <Button variant="danger" confirm="Press again: wipe everything" className="w-full"
            onClick={() => {
              // Every game store (the founder too), so a reset returns to founding.
              resetAllGameStores();
              report("Game fully reset. All progress wiped.");
            }}>
            Reset game
          </Button>
        </Group>
      </PopoverContent>
    </Popover>
  );
};
