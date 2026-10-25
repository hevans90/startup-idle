import { afterAll, beforeAll, describe, expect, jest, test } from "bun:test";
import { StrictMode, act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { installDom } from "../../test/dom";
import { ConsoleMotionOverride } from "../motion";
import { Button, CountUp, Dialog, ErrorScreen, Frame, Locked, Meter, Panel, Tabs, Text } from "./index";

let dom: ReturnType<typeof installDom>;
beforeAll(() => { jest.useRealTimers(); dom = installDom(); });
afterAll(async () => { await settle(); dom.remove(); });

/** The kit's arwes packages, fetched on first use: let them arrive, and what waits on them draw. */
async function settle() {
  await act(async () => { await Promise.all([import("@arwes/frames"), import("@arwes/text")]); for (let i = 0; i < 5; i++) await Promise.resolve(); });
}

/** Render under StrictMode — mounted, unmounted and mounted again, the trap arwes's React packages fall into. */
async function render(node: ReactNode, motion: { mix?: number; calm?: boolean } = { calm: true }) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root!: Root;
  await act(async () => {
    root = createRoot(host);
    root.render(<StrictMode><ConsoleMotionOverride.Provider value={motion}>{node}</ConsoleMotionOverride.Provider></StrictMode>);
  });
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe("the console's kit", () => {
  test("a frame, mounted twice under StrictMode, is there: its SVG drawn once, its content shown", async () => {
    const { host, unmount } = await render(<Frame kind="kranox"><span>inside</span></Frame>);
    await settle();
    expect(host.textContent).toContain("inside");
    expect(host.querySelectorAll("svg > g").length).toBe(1);
    expect(host.querySelectorAll("svg path").length).toBeGreaterThan(0);
    await unmount();
  });

  test("calm, text is whole and visible at once — whatever its mode", async () => {
    const { host, unmount } = await render(<><Text mode="decipher" text="Chapter 3 · Thirst" /><Text mode="sequence" text="I am thirsty." /></>);
    const spans = [...host.querySelectorAll("span > span")] as HTMLElement[];
    expect(spans.map((s) => s.textContent)).toEqual(["Chapter 3 · Thirst", "I am thirsty."]);
    for (const s of spans) expect(s.style.visibility).toBe("visible");
    await unmount();
  });

  test("before the console deciphers (the stage's mix too low), `auto` text is plain", async () => {
    const { host, unmount } = await render(<Text text="The Data Centre" />, { mix: 0, calm: false });
    expect((host.querySelector("span > span") as HTMLElement).style.visibility).toBe("visible");
    await unmount();
  });

  test("a number counts up to what it is — and, calm, is there at once", async () => {
    jest.useRealTimers(); // the preload fakes them before each test
    const fmt = (v: number) => String(Math.round(v));
    const calm = await render(<CountUp to={500} format={fmt} />);
    expect(calm.host.textContent).toBe("500");
    await calm.unmount();
    const moving = await render(<CountUp to={500} format={fmt} />, { calm: false });
    expect(Number(moving.host.textContent)).toBeLessThan(500);
    await act(async () => { await new Promise((r) => setTimeout(r, 1000)); });
    expect(moving.host.textContent).toBe("500");
    await moving.unmount();
  });

  test("a crash shows the error screen, with a reload, not a blank page", async () => {
    const Boom = () => { throw new Error("the kettle exploded"); };
    const quiet = console.error;
    console.error = () => {};
    const { host, unmount } = await render(<ErrorScreen><Boom /></ErrorScreen>);
    console.error = quiet;
    expect(host.textContent).toContain("Something broke");
    expect(host.textContent).toContain("the kettle exploded");
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toContain("Reload");
    await unmount();
  });

  test("a confirming button needs two presses, and says so between them", async () => {
    let fired = 0;
    const { host, unmount } = await render(<Button confirm onClick={() => fired++}>Ascend</Button>);
    const b = host.querySelector("button")!;
    await act(async () => b.click());
    expect(fired).toBe(0);
    expect(b.textContent).toBe("Press again");
    await act(async () => b.click());
    expect(fired).toBe(1);
    expect(b.textContent).toBe("Ascend");
    await unmount();
  });

  test("a panel is a labelled section with its title; a meter a progressbar with its value; locked shows what opens it", async () => {
    const { host, unmount } = await render(<>
      <Panel title="The Data Centre"><Meter label="Cooled" value={0.62} /></Panel>
      <Locked needs="Needs an HQ" onShow={() => {}}><p>Managers</p></Locked>
    </>);
    expect(host.querySelector("section[aria-label='The Data Centre']")).not.toBeNull();
    expect(host.querySelector("[role=progressbar]")!.getAttribute("aria-valuenow")).toBe("62");
    expect(host.textContent).toContain("Needs an HQ");
    expect([...host.querySelectorAll("button")].some((b) => b.textContent === "Show me")).toBe(true);
    await unmount();
  });

  test("tabs: the current one selected, arrow keys move between them", async () => {
    function Rail() {
      const [v, setV] = useState<"a" | "b" | "c">("a");
      return <Tabs label="Rail" value={v} onChange={setV} tabs={[{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }]} />;
    }
    const { host, unmount } = await render(<Rail />);
    const selected = () => host.querySelector("[aria-selected=true]")!.textContent;
    expect(selected()).toBe("A");
    await act(async () => host.querySelector("[role=tablist]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(selected()).toBe("B");
    await act(async () => host.querySelector("[role=tablist]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    await act(async () => host.querySelector("[role=tablist]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(selected()).toBe("C");
    await unmount();
  });

  test("a dialog takes the focus, keeps it inside, and closes on Esc", async () => {
    let closed = 0;
    const { unmount } = await render(
      <Dialog title="The Ascension" onClose={() => closed++} actions={<><button type="button">One</button><button type="button">Two</button></>}><p>Shall we go?</p></Dialog>,
    );
    const box = document.querySelector("[role=dialog]")!;
    expect(box.getAttribute("aria-modal")).toBe("true");
    expect(box.contains(document.activeElement)).toBe(true);
    const buttons = [...box.querySelectorAll("button")] as HTMLElement[];
    buttons[buttons.length - 1].focus();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" })));
    expect(document.activeElement).toBe(buttons[0]);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(closed).toBe(1);
    await unmount();
  });
});
