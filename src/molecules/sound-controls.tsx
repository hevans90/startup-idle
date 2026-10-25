import { sfx } from "../audio/sound";
import { useGlobalSettingsStore } from "../state/global-settings.store";
import { Slider, Toggle } from "../ui/console";

const ROW = "flex items-center justify-between gap-2";

/**
 * The game's sound — on or off, how loud, and each part's share: the game's
 * effects, the interface, the town's ambience; whether the interface ticks
 * under the pointer. @see audio/sound
 */
export const SoundControls = () => {
  const g = useGlobalSettingsStore();
  const set = g.setSound;
  const bus = (key: "effects" | "interface" | "ambience", label: string, hear?: () => void) => (
    <div className={ROW}>
      <span className="text-fg-muted">{label}</span>
      <Slider label={`${label} volume`} value={g[key]} disabled={g.muted} onChange={(v) => set({ [key]: v })} onCommit={hear} />
    </div>
  );
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className={ROW}>
        <span className="flex items-center gap-2">
          <Toggle label="Sound" on={!g.muted} onChange={(on) => set({ muted: !on })} />
          Sound
        </span>
        <Slider label="Volume" value={g.volume} disabled={g.muted} onChange={(v) => set({ volume: v })} />
      </div>
      {bus("effects", "Effects", () => sfx("build"))}
      {bus("interface", "Interface", () => sfx("confirm"))}
      {bus("ambience", "Ambience")}
      <div className={ROW}>
        <span className="text-fg-muted">Ticks under the pointer</span>
        <Toggle label="Interface ticks under the pointer" on={g.ticks} onChange={(on) => set({ ticks: on })} />
      </div>
    </div>
  );
};
