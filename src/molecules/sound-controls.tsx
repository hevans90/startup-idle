import { sfx } from "../audio/sound";
import { useGlobalSettingsStore } from "../state/global-settings.store";
import { twMerge } from "tailwind-merge";
import { Field, Slider, Toggle } from "../ui/console";

/**
 * The game's sound — on or off and how loud, then each part's share: the
 * game's effects, the interface, the town's ambience (dimmed while it is off);
 * and whether the interface ticks under the pointer. @see audio/sound
 */
export const SoundControls = () => {
  const g = useGlobalSettingsStore();
  const set = g.setSound;
  const bus = (key: "effects" | "interface" | "ambience", label: string, hear?: () => void) => (
    <Field label={label} className={twMerge("pl-3", g.muted && "opacity-50")}>
      <Slider label={`${label} volume`} value={g[key]} disabled={g.muted} onChange={(v) => set({ [key]: v })} onCommit={hear} />
    </Field>
  );
  return (
    <>
      <Field label="Sound">
        <span className="flex items-center gap-3">
          <Slider label="Volume" value={g.volume} disabled={g.muted} onChange={(v) => set({ volume: v })} />
          <Toggle label="Sound" on={!g.muted} onChange={(on) => set({ muted: !on })} />
        </span>
      </Field>
      {bus("effects", "Effects", () => sfx("build"))}
      {bus("interface", "Interface", () => sfx("confirm"))}
      {bus("ambience", "Ambience")}
      <Field label="Ticks under the pointer">
        <Toggle label="Interface ticks under the pointer" on={g.ticks} onChange={(on) => set({ ticks: on })} />
      </Field>
    </>
  );
};
