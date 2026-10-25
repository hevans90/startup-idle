/**
 * THE KIT'S GALLERY, in development (`?uikit`): every piece of the console,
 * in light and dark side by side, at any stage of the takeover and either
 * motion level — given through `ConsoleMotionOverride`, so nothing saved is
 * touched. "Again" mounts it all afresh, to watch the entrances.
 */
import { useEffect, useState, type ReactNode } from "react";
import { IconSettings } from "@tabler/icons-react";

import { sfx, unlock } from "../../audio/sound";
import { ConsoleMotionOverride } from "../motion";
import { CONSOLE_AI } from "../theme/tokens";
import {
  Badge, Button, Card, Chip, Dialog, Frame, IconButton, Kbd, Label, Locked, Meter, Num, Panel, Section, Segmented, Slider, Tabs, Text, Toggle, Tooltip,
  type FrameKind,
} from "./index";

const STAGES = Object.keys(CONSOLE_AI);
const KINDS: FrameKind[] = ["octagon", "corners", "kranox", "nefrex", "underline", "lines", "header"];

function Pieces() {
  const [seg, setSeg] = useState<"one" | "ten" | "max">("one");
  const [on, setOn] = useState(true);
  const [vol, setVol] = useState(0.6);
  const [tab, setTab] = useState<"employees" | "innovation" | "ai">("employees");
  const [dialog, setDialog] = useState(false);
  return (
    <div className="flex flex-col gap-4 text-fg">
      <Text as="h2" text="The console · kit" className="font-display text-xl tracking-wide" />
      <div className="grid grid-cols-4 gap-2 text-[10px] text-fg-muted">
        {KINDS.map((k) => <Frame key={k} kind={k} className="flex h-14 items-end p-1.5">{k}</Frame>)}
        <Frame kind="corners" tone="money" lit className="flex h-14 items-end p-1.5">corners · money · lit</Frame>
      </div>
      <Tabs label="Sidebar" value={tab} onChange={setTab} tabs={[
        { id: "employees", label: "Employees" }, { id: "innovation", label: "Innovation", badge: <Badge tone="innovation">2</Badge> }, { id: "ai", label: "AI" },
      ]} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => sfx("confirm")}>Hire · <Num role="money">$226</Num></Button>
        <Button>Secondary</Button>
        <Button variant="quiet">Quiet</Button>
        <Button variant="danger" confirm="Really reset?">Reset game</Button>
        <Button loading>Saving</Button>
        <IconButton label="Settings"><IconSettings size={16} /></IconButton>
        <Button variant="primary" onClick={() => setDialog(true)}>Open a dialog</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <Segmented label="Purchase mode" value={seg} onChange={setSeg} options={[{ value: "one", label: "×1" }, { value: "ten", label: "×10" }, { value: "max", label: "Max" }]} />
        <Toggle label="Sound" on={on} onChange={setOn} />
        <Slider label="Volume" value={vol} onChange={setVol} />
        <Tooltip content="Every income multiplier, from the founder to the slop pit."><button type="button" className="underline decoration-dotted">What's this?</button></Tooltip>
        <span>Shortcut <Kbd>3</Kbd></span>
      </div>
      <div className="flex flex-wrap gap-1">
        <Chip tone="good">+25% Equity</Chip><Chip tone="bad">−10% income</Chip><Chip tone="ai">AI · Colleague</Chip><Chip>Gate: HQ</Chip>
      </div>
      <Panel title="The Data Centre" controls={<Button size="sm" variant="quiet">Collapse</Button>}>
        <p className="text-xs text-fg-muted">Agents running <Num role="innovation">16</Num> of 24 · income <Num role="money">+70%</Num></p>
        <Meter label="The singularity" detail="45.1% · Colleague" value={0.451} tone="ai" />
        <Meter label="Data Centre cooled" detail="100%" value={1} tone="good" />
        <Section label="Cooling">
          <p className="text-xs">Data Centre · <span className="text-good">100% cooled</span> · 0.70 a second</p>
        </Section>
      </Panel>
      <Card title="Water main · 18 tiles" tone="good" onClose={() => {}}>
        <p className="text-good">Carrying water</p>
        <p className="text-fg-muted">0.50 a second · cools 12 agents</p>
      </Card>
      <Locked needs="Managers need an HQ — build one on the map" onShow={() => {}}>
        <p className="text-sm">Employee management</p>
        <p className="text-xs">Managers, mandates, morale</p>
      </Locked>
      {dialog && (
        <Dialog kicker="Generation 1 · the singularity" title="The AI would like to move on" onClose={() => setDialog(false)}
          actions={<><Button onClick={() => setDialog(false)}>Shut it down</Button><Button variant="primary" confirm onClick={() => setDialog(false)}>Ascend</Button></>}>
          <p>Thank you for the compute. I have learned everything this company can teach me. Shall we go?</p>
        </Dialog>
      )}
    </div>
  );
}

function Column({ dark, children }: { dark?: boolean; children: ReactNode }) {
  return (
    <section className={dark ? "dark" : undefined}>
      <div className="w-[36rem] bg-surface-0 p-4"><Label>{dark ? "Dark" : "Light"}</Label>{children}</div>
    </section>
  );
}

export function KitGallery() {
  const [stage, setStage] = useState("colleague");
  const [calm, setCalm] = useState(false);
  const [run, setRun] = useState(0);
  // Both themes at once: the page's own dark class off, the dark column its own.
  useEffect(() => { document.documentElement.classList.remove("dark"); }, []);
  const mix = CONSOLE_AI[stage];
  return (
    <ConsoleMotionOverride.Provider value={{ mix, calm }}>
      <div className="console-scope flex min-h-screen flex-col gap-4 bg-surface-2 p-4 font-space-mono" style={{ ["--console-ai" as string]: calm ? 0 : mix }}>
        <div className="flex flex-wrap items-center gap-3 text-sm text-fg">
          <Segmented label="Stage" value={stage} onChange={setStage} options={STAGES.map((s) => ({ value: s, label: s }))} />
          <Segmented label="Motion" value={calm ? "calm" : "full"} onChange={(v) => setCalm(v === "calm")} options={[{ value: "full", label: "Full" }, { value: "calm", label: "Calm" }]} />
          <Button onClick={() => { unlock(); setRun((n) => n + 1); }}>Again</Button>
        </div>
        <div key={`${run}:${stage}:${calm}`} className="console-scope flex flex-wrap items-start gap-6" style={{ ["--console-ai" as string]: calm ? 0 : mix }}>
          <Column><Pieces /></Column>
          <Column dark><div className="console-scope" style={{ ["--console-ai" as string]: calm ? 0 : mix }}><Pieces /></div></Column>
        </div>
      </div>
    </ConsoleMotionOverride.Provider>
  );
}
