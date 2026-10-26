/**
 * FOUNDING, THE LAST STEP: NEGOTIATING A TERM SHEET. Three investors (four
 * with Founder Worship) each send an opening draft; the founder takes one and
 * redlines it, clause by clause, on the right, and the document on the left
 * types itself in as arwes text and re-types each clause as it is amended,
 * marked in the margin. The investor answers every draft and signs only one
 * that meets their appetite; signing writes both signatures in.
 * @see game/term-deal, game/term-sheets
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import {
  CLAUSES, NEGOTIATORS, appetite, clause, clauseAppetite, dealEffects, openingDeal, option, reply, willSign,
  type ClauseId, type Clauses,
} from "../game/term-deal";
import { termSheetsFor, type TermSheet } from "../game/term-sheets";
import { usePrestigeStore } from "../state/prestige.store";
import { Backdrop, Badge, Button, Label, Meter, Panel, Segmented, Stat, StatGrid, Text, Tile } from "../ui/console";
import { useConsoleMotion } from "../ui/motion";
import { FoundingShell } from "./founding-shell";

type Props = {
  /** The land's seed: the same land, the same investors. */
  seed: number;
  /** Who is founding, for the document. */
  founder: string;
  onBack: () => void;
  onSign: (investor: string, clauses: Clauses) => void;
};

/** How long the signatures take to write in — the document scrolled to them first — before the company is founded, ms. */
const SIGN_MS = 2200;

const ROUND: Record<string, string> = { none: "Bootstrap agreement", angel: "Angel round", seed: "Seed round", seriesA: "Series A" };
const pct = (k: number) => `${Math.round(k * 100)}%`;
const mult = (k: number) => (k === 1 ? "×1" : `×${k.toFixed(2)}`);

export function TermSheetSelect({ seed, founder, onBack, onSign }: Props) {
  // FOUR INVESTORS, five with Founder Worship; a different draw for each reroll, paid for with an Exit. @see PrestigeModifiers.termSheets
  const offered = usePrestigeStore((p) => p.modifiers.termSheets);
  const exits = usePrestigeStore((p) => p.exits);
  const [rerolls, setRerolls] = useState(0);
  const sheets = useMemo(() => termSheetsFor(seed, offered, rerolls), [seed, offered, rerolls]);
  const [investor, setInvestor] = useState(sheets[0].id);
  // EACH INVESTOR'S DRAFT, kept as it was left: going to another and back finds yours where you left it.
  const fresh = (list: typeof sheets) => ({
    drafts: Object.fromEntries(list.map((t) => [t.id, openingDeal(t.id)])) as Record<string, Clauses>,
    versions: Object.fromEntries(list.map((t) => [t.id, 1])) as Record<string, number>,
  });
  const [drafts, setDrafts] = useState<Record<string, Clauses>>(() => fresh(sheets).drafts);
  const [versions, setVersions] = useState<Record<string, number>>(() => fresh(sheets).versions);
  const reroll = () => {
    if (signing || !usePrestigeStore.getState().spendExit()) return;
    const next = termSheetsFor(seed, offered, rerolls + 1);
    const f = fresh(next);
    setDrafts(f.drafts);
    setVersions(f.versions);
    setInvestor(next[0].id);
    setRerolls((r) => r + 1);
  };
  const [signing, setSigning] = useState(false);
  const { calm } = useConsoleMotion();

  const sheet = sheets.find((t) => t.id === investor)!;
  const clauses = drafts[investor];
  const n = NEGOTIATORS[investor];
  const a = appetite(investor, clauses), ok = willSign(investor, clauses);
  const fx = dealEffects(clauses);
  const share = (1 - fx.dilution) * fx.saleMult;

  const amend = (id: ClauseId, opt: string) => {
    if (signing || clauses[id] === opt) return;
    setDrafts((d) => ({ ...d, [investor]: { ...d[investor], [id]: opt } }));
    setVersions((v) => ({ ...v, [investor]: v[investor] + 1 }));
  };
  const backToTheirs = () => {
    setDrafts((d) => ({ ...d, [investor]: openingDeal(investor) }));
    setVersions((v) => ({ ...v, [investor]: v[investor] + 1 }));
  };
  const sign = () => {
    if (!ok || signing) return;
    setSigning(true);
    window.setTimeout(() => onSign(investor, clauses), calm ? 0 : SIGN_MS);
  };

  return (
    <FoundingShell step="terms" title="Negotiate the term sheet"
      subtitle="Each investor sends a draft. Push back where you can; give what they need to sign."
      back={signing ? undefined : onBack}
      next={{ label: signing ? "Signing…" : ok ? `Sign with ${sheet.investor}` : `${sheet.investor} won't sign this`, disabled: !ok || signing, onClick: sign }}>
      <div className="mx-auto flex w-full max-w-[110rem] flex-col gap-4">
        {/* THE INVESTORS, a tile each: who, what they want, what they care about, and whether your draft would do. */}
        <div className="flex items-center justify-between gap-3">
          <Label>{sheets.length} investors on this land</Label>
          <Button size="sm" disabled={signing || exits < 1} onClick={reroll}
            title={exits < 1 ? "No Exits to spend: sell a company to earn one" : "Spend an Exit for four other investors"}>
            Reroll investors · 1 Exit <span className="text-fg-muted">({exits})</span>
          </Button>
        </div>
        <div role="radiogroup" aria-label="Investors" className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2">
          {sheets.map((t) => {
            const willThey = willSign(t.id, drafts[t.id]);
            return (
              <Tile key={t.id} role="radio" aria-checked={t.id === investor} selected={t.id === investor} disabled={signing}
                onClick={() => setInvestor(t.id)} className="flex flex-col gap-1 px-3 py-2">
                <span className="truncate font-display text-sm uppercase tracking-widest">{t.investor}</span>
                <span className="text-xs text-fg-muted">{t.goal}</span>
                <span className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <span className="min-w-0 truncate text-[10px] uppercase tracking-widest text-fg-faint" title={`+${Math.round(t.bonus * 100)}% kicker · cares most about ${clause(NEGOTIATORS[t.id].cares).title.toLowerCase()}`}>+{Math.round(t.bonus * 100)}% · ★ {clause(NEGOTIATORS[t.id].cares).title.toLowerCase()}</span>
                  <Badge tone={willThey ? "good" : "bad"}>{willThey ? "Would sign" : "Won't sign"}</Badge>
                </span>
              </Tile>
            );
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(20rem,1fr)]">
          <div className="flex flex-col gap-3">
            <TermDocument sheet={sheet} clauses={clauses} founder={founder} seed={seed} version={versions[investor]} signing={signing} />
            {/* WHAT THE DEAL DOES to the run, all together. */}
            <StatGrid className="grid-flow-row grid-cols-3 xl:grid-cols-6">
              <Stat label="Cash" value={`$${fx.cash.toLocaleString("en-GB")}`} role="money" />
              <Stat label="Your share" value={pct(share)} role={share < 0.75 ? "warn" : "good"} />
              <Stat label="Kicker" value={`+${pct(sheet.bonus * fx.bonusMult)}`} role="good" />
              <Stat label="Hiring" value={mult(fx.hireCostMult)} />
              <Stat label="Mandates" value={mult(fx.mandateCostMult)} />
              <Stat label="Acquirers" value={fx.offers === "open" ? "Open" : fx.offers === "halved" ? "Half premium" : "None"} role={fx.offers === "none" ? "warn" : undefined} />
            </StatGrid>
          </div>

          {/* THE NEGOTIATION: every clause's options, what each does, and how the investor takes it. */}
          <div className="flex flex-col gap-3">
            <Panel title="Their answer" tone={ok ? "good" : "bad"}>
              <Meter tone={ok ? "good" : "bad"} value={Math.max(0, Math.min(1, (a + 4) / (n.demand + 8)))}
                label="Their appetite" detail={<>{a} <span className="text-fg-muted">· needs {n.demand}</span></>} />
              <p className={twMerge("italic", ok ? "text-fg" : "text-bad")}>“{reply(investor, clauses)}” <span className="not-italic text-[11px] text-fg-muted">★ counts twice.</span></p>

            </Panel>

            <Panel title="Redline" controls={<Button size="sm" variant="quiet" disabled={signing} onClick={backToTheirs}>Their draft</Button>}>
              <div className="flex flex-col divide-y divide-line-quiet">
                {CLAUSES.map((c) => {
                  const chosen = option(c.id, clauses[c.id])!;
                  const delta = clauseAppetite(investor, c.id, chosen.id);
                  const changed = clauses[c.id] !== n.opening[c.id];
                  return (
                    <div key={c.id} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0" title={chosen.says}>
                      <div className="flex items-center justify-between gap-2">
                        <Label className={changed ? "text-warn" : undefined}>§{c.number} {c.title}{n.cares === c.id && " ★"} <span className="normal-case tracking-normal text-fg-faint">· {chosen.says}</span></Label>
                        <span className={twMerge("text-[10px] tabular-nums", delta > 0 ? "text-good" : delta < 0 ? "text-bad" : "text-fg-faint")}
                          title="What this option does to their appetite">
                          {delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${-delta}` : "—"}
                        </span>
                      </div>
                      <Segmented label={c.title} value={clauses[c.id]} onChange={(v) => amend(c.id, v)}
                        options={c.options.map((o) => ({ value: o.id, label: o.label, title: o.says }))} />
                    </div>
                  );
                })}
              </div>
            </Panel>


          </div>
        </div>
      </div>
    </FoundingShell>
  );
}

/**
 * THE DOCUMENT: a term sheet as a console would print one — a classification
 * band, the investor's letterhead, the parties, a numbered clause each, the
 * milestone, the boilerplate, and the signatures. Each clause types itself in
 * and types again when it is amended, flushed in the warn tint and marked
 * AMENDED in the margin against the investor's opening draft.
 */
function TermDocument({ sheet, clauses, founder, seed, version, signing }: {
  sheet: TermSheet; clauses: Clauses; founder: string; seed: number; version: number; signing: boolean;
}) {
  const n = NEGOTIATORS[sheet.id];
  const ctx = { investor: sheet.investor, founder };
  const fx = dealEffects(clauses);
  const ref = `TS-${(seed >>> 0).toString(16).toUpperCase().padStart(8, "0").slice(-6)}-${sheet.id.toUpperCase()}`;
  // WHAT CHANGED JUST NOW, to flush it: the clause, and a key that restarts the flush.
  const last = useRef<{ investor: string; clauses: Clauses } | null>(null);
  const [flash, setFlash] = useState<{ id: ClauseId; at: number } | null>(null);
  // SIGNING, the signatures brought into view to be watched writing themselves in.
  const signatures = useRef<HTMLElement>(null);
  const { calm } = useConsoleMotion();
  useEffect(() => {
    if (signing) signatures.current?.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" });
  }, [signing, calm]);
  useEffect(() => {
    const was = last.current;
    last.current = { investor: sheet.id, clauses };
    if (!was || was.investor !== sheet.id) return;
    const changed = CLAUSES.find((c) => was.clauses[c.id] !== clauses[c.id]);
    if (changed) setFlash({ id: changed.id, at: Date.now() });
  }, [sheet.id, clauses]);

  return (
    <article aria-label={`Term sheet: ${sheet.investor}`}
      className="relative flex flex-col overflow-hidden border border-line-strong border-t-2 border-t-console bg-surface-1 font-mono text-[12px] leading-relaxed text-fg shadow-2xl">
      <Backdrop kind="dots" />
      {/* THE BAND: what kind of paper this is. */}
      <div className="relative flex flex-wrap items-center justify-between gap-2 border-b border-line-quiet bg-surface-2/60 px-5 py-1.5 text-[10px] uppercase tracking-[0.25em] text-fg-muted">
        <span><span className="text-bad">Confidential</span> · Non-binding · Draft v{version}</span>
        <span className="tabular-nums">Ref {ref}</span>
      </div>

      <div className="relative flex flex-col gap-4 px-5 py-4 sm:px-7">
        {/* THE LETTERHEAD */}
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 border-b border-line-quiet pb-3">
          <div className="flex flex-col">
            <Text key={`name:${sheet.id}`} mode="decipher" as="h2" text={sheet.investor} className="font-display text-xl uppercase tracking-[0.2em]" />
            <span className="text-[10px] uppercase tracking-widest text-fg-faint">{n.motto}</span>
          </div>
          <Text key={`round:${sheet.id}:${clauses.investment}`} mode="decipher" as="span"
            text={`${ROUND[clauses.investment] ?? "Investment"} · ${founder}`} className="font-display text-xs uppercase tracking-widest text-console" />
        </header>

        {/* THE CLAUSES, a line each, and the covenant: what it is all for. */}
        <ol className="flex flex-col gap-2">
          {CLAUSES.map((c) => {
            const o = option(c.id, clauses[c.id])!;
            const amended = clauses[c.id] !== n.opening[c.id];
            const flushed = flash?.id === c.id;
            return (
              <li key={`${c.id}:${flushed ? flash!.at : 0}`}
                className={twMerge("relative -ml-3 grid grid-cols-[1.75rem_7.5rem_1fr] items-baseline gap-x-2 border-l-2 py-0.5 pl-3",
                  amended ? "border-warn" : "border-transparent", flushed && "ui-redline")}>
                <span className="font-display text-console">§{c.number}</span>
                <span className="flex flex-col text-[10px] uppercase tracking-widest text-fg">
                  {c.title}
                  {amended && <span className="text-warn">Amended</span>}
                </span>
                <Text key={`${sheet.id}:${c.id}:${o.id}`} mode="sequence" as="p" text={o.text(ctx)} className="text-fg-muted" />
              </li>
            );
          })}
          <li className="grid grid-cols-[1.75rem_7.5rem_1fr] items-baseline gap-x-2 border-t border-line-quiet pt-2">
            <span className="font-display text-console">§6</span>
            <span className="text-[10px] uppercase tracking-widest text-fg">Covenant</span>
            <Text key={`${sheet.id}:goal:${clauses.milestone}`} mode="sequence" as="p"
              text={`${sheet.goalAt(fx.goalScale)}: +${pct(sheet.bonus * fx.bonusMult)} Equity.`} className="text-fg" />
          </li>
        </ol>

        {/* THE SIGNATURES: lines until it is signed, then both names written in. */}
        <footer ref={signatures} className="relative grid gap-4 border-t border-line-quiet pt-3 sm:grid-cols-2">
          {[{ for: sheet.investor, who: n.partner }, { for: "the company", who: founder }].map((s) => (
            <div key={s.for} className="flex flex-col gap-0.5">
              <div className="flex h-7 items-end border-b border-line-strong">
                {signing && <Text mode="decipher" as="span" text={s.who.split(",")[0]} className="font-display text-base italic text-console" />}
              </div>
              <span className="truncate text-[10px] uppercase tracking-widest text-fg-faint">For {s.for} · {s.who}</span>
            </div>
          ))}
          {signing && (
            <span className="ui-tab-in absolute -top-3 right-0 rotate-[-6deg] border-2 border-good px-3 py-1 font-display text-sm uppercase tracking-[0.3em] text-good">
              Executed
            </span>
          )}
        </footer>
      </div>
    </article>
  );
}
