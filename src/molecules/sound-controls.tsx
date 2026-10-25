import { sfx } from "../audio/sound";
import { useGlobalSettingsStore } from "../state/global-settings.store";
import { Button } from "../ui/Button";

const SLIDER = "w-24 accent-primary-600 disabled:opacity-40 dark:accent-primary-400";
const ROW = "flex items-center justify-between gap-2";

/**
 * The game's sound — on or off, how loud, and each part's share: the game's
 * effects, the interface, the town's ambience; whether the interface ticks
 * under the pointer — and how much the console moves. @see audio/sound, ui/motion
 */
export const SoundControls = () => {
  const g = useGlobalSettingsStore();
  const set = g.setSound;
  const bus = (key: "effects" | "interface" | "ambience", label: string, hear?: () => void) => (
    <label className={ROW}>
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={g[key]} disabled={g.muted} aria-label={`${label} volume`}
        onChange={(e) => set({ [key]: Number(e.target.value) })} onPointerUp={hear} className={SLIDER} />
    </label>
  );
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex items-center gap-2">
        <Button
          onClick={() => set({ muted: !g.muted })}
          className="px-4 py-2 bg-gray-200 dark:bg-primary-700 text-black dark:text-white responsive-text"
        >
          Sound: {g.muted ? "off" : "on"}
        </Button>
        <input
          type="range" min={0} max={1} step={0.05} value={g.volume} disabled={g.muted}
          aria-label="Volume"
          onChange={(e) => set({ volume: Number(e.target.value) })}
          className={SLIDER}
        />
      </div>
      {bus("effects", "Effects", () => sfx("build"))}
      {bus("interface", "Interface", () => sfx("confirm"))}
      {bus("ambience", "Ambience")}
      <label className={ROW}>
        <span>Interface ticks under the pointer</span>
        <input type="checkbox" checked={g.ticks} onChange={(e) => set({ ticks: e.target.checked })} />
      </label>
      <div className={ROW} role="radiogroup" aria-label="Motion">
        <span>Motion</span>
        <span className="flex gap-1">
          {(["full", "calm"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={g.motion === m} onClick={() => g.setMotion(m)}
              className={`cursor-pointer border px-2 py-0.5 ${g.motion === m
                ? "border-primary-700 bg-primary-200 dark:border-primary-200 dark:bg-primary-700"
                : "border-primary-300 dark:border-primary-600"}`}>
              {m === "full" ? "Full" : "Calm"}
            </button>
          ))}
        </span>
      </div>
    </div>
  );
};
