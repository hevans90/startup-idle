import { useGlobalSettingsStore } from "../state/global-settings.store";
import { Button } from "../ui/Button";

/** The game's sound: on or off, and how loud. @see audio/sound */
export const SoundControls = () => {
  const volume = useGlobalSettingsStore((s) => s.volume);
  const muted = useGlobalSettingsStore((s) => s.muted);
  const set = useGlobalSettingsStore((s) => s.setSound);
  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={() => set({ muted: !muted })}
        className="px-4 py-2 bg-gray-200 dark:bg-primary-700 text-black dark:text-white responsive-text"
      >
        Sound: {muted ? "off" : "on"}
      </Button>
      <input
        type="range" min={0} max={1} step={0.05} value={volume} disabled={muted}
        aria-label="Volume"
        onChange={(e) => set({ volume: Number(e.target.value) })}
        className="w-24 accent-primary-600 disabled:opacity-40 dark:accent-primary-400"
      />
    </div>
  );
};
