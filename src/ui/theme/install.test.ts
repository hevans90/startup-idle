import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { installDom } from "../../test/dom";
import { useAiSingularityStore } from "../../state/ai-singularity.store";
import { useGlobalSettingsStore } from "../../state/global-settings.store";
import { MOVES_FROM } from "../motion";
import { installTheme } from "./install";

let dom: ReturnType<typeof installDom>;
beforeAll(() => { dom = installDom(); });
afterAll(() => dom.remove());

describe("the console's takeover, on the page", () => {
  test("the mix follows the stage, and calm holds it at nothing and stills what loops", () => {
    const root = document.documentElement;
    useGlobalSettingsStore.getState().setMotion("full");
    useAiSingularityStore.setState({ value: 85 });
    const stop = installTheme(document);
    expect(root.style.getPropertyValue("--console-ai")).toBe(String(MOVES_FROM));
    expect(root.classList.contains("ui-calm")).toBe(false);
    useGlobalSettingsStore.getState().setMotion("calm");
    expect(root.style.getPropertyValue("--console-ai")).toBe("0");
    expect(root.classList.contains("ui-calm")).toBe(true);
    useGlobalSettingsStore.getState().setMotion("full");
    expect(root.classList.contains("ui-calm")).toBe(false);
    stop();
    useAiSingularityStore.setState({ value: 0 });
  });
});
