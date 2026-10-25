/**
 * THE TOKENS, INSTALLED: written once into a `<style>` as CSS variables —
 * `--ui-*` on `:root` for light, again under `.dark` — before anything is
 * drawn; and `--console-ai`, the takeover mix, kept to the meter's stage on
 * the root element — nothing when the console is calm — and the interface's
 * sound pitched by it. `--ui-console` is the console's own colour: the founder's
 * teal mixed toward the AI's violet by it; an element that sets its own
 * `--console-ai` takes the class `console-scope` to have it mixed there.
 * @see tokens, plans/ui-overhaul.md §1.1
 */
import { setConsoleMix } from "../../audio/sound";
import { useAiSingularityStore } from "../../state/ai-singularity.store";
import { useGlobalSettingsStore } from "../../state/global-settings.store";
import { isCalm, stageMix } from "../motion/console";
import { tokens, type Theme } from "./tokens";

const block = (theme: Theme) => Object.entries(tokens(theme)).map(([k, v]) => `--ui-${k}: ${v};`).join(" ");

/** The CSS the tokens make. */
export const themeCss = (): string => [
  `:root { ${block("light")} --console-ai: 0; }`,
  `.dark { ${block("dark")} }`,
  // Declared wherever its inputs may change — a variable built of variables resolves where it is declared, so one
  // declared on :root alone would keep light's teal and the root's mix in dark mode and under a local --console-ai.
  `:root, .dark, .console-scope { --ui-console: color-mix(in oklab, var(--ui-accent) calc((1 - var(--console-ai)) * 100%), var(--ui-ai)); }`,
].join("\n");

/** Write the tokens into the page, and keep `--console-ai` to the stage. Returns how to stop. */
export function installTheme(doc: Document = document): () => void {
  const style = doc.createElement("style");
  style.dataset.ui = "tokens";
  style.textContent = themeCss();
  doc.head.prepend(style);
  // THE MIX, the stage's — held at nothing when calm — for the colours and the interface's pitch.
  let was = -1;
  const sync = () => {
    const mix = isCalm() ? 0 : stageMix(useAiSingularityStore.getState().value);
    if (mix === was) return;
    was = mix;
    doc.documentElement.style.setProperty("--console-ai", String(mix));
    setConsoleMix(mix);
  };
  sync();
  const stops = [useAiSingularityStore.subscribe(sync), useGlobalSettingsStore.subscribe(sync)];
  const media = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  media?.addEventListener("change", sync);
  return () => { for (const s of stops) s(); media?.removeEventListener("change", sync); style.remove(); };
}
