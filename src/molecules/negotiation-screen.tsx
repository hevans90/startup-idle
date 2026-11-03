/**
 * THE NEGOTIATION, ON SCREEN: the whole screen given over to it. The talk
 * typed in a line at a time — what it asks, what you answer, how it takes it —
 * beside the dial it stands on and the trust between you; under them your
 * hand, each argument stood by or regretted, either ghosted on the dial while
 * looked at. Nothing can be answered till it has finished speaking. When the
 * asks run out, the verdict: the ending it landed on, what it does, what it
 * banks — and the Ascension it closes on, the screen glitching out. @see GlitchOut
 * @see game/negotiation, useTalkStore, NegotiationParts
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { twMerge } from "tailwind-merge";

import { sfx } from "../audio/sound";
import { ascend, ascensionWeights, type AscendingEnding } from "../game/ascension";
import { askNow, effectOf, landing, play, talkDone, type Argument, type Talk, type TalkState } from "../game/negotiation";
import { ENDINGS } from "../game/quests/endings";
import { bookNow, book as bookOf, nextBook } from "../game/quests/books";
import { trait as traitOf, traitForecast } from "../game/traits";
import { useAscensionUiStore } from "../state/ascension-ui.store";
import { useGenerationStore } from "../state/generation.store";
import { useTalkStore } from "../state/talk.store";
import { Backdrop, Button, CountUp, FOCUS, Frame, Text, useGlitch } from "../ui/console";
import { useConsoleMotion } from "../ui/motion";
import { GlitchOut } from "./ascension-glitch-out";
import { ArgumentCard, Dial, TrustBar, endingColour, type Point } from "./negotiation-parts";

/** The endings an Ascension can close on today; the rest ascend plainly till they are wired. @see ascend */
const ASCENDING: readonly string[] = ["merge", "steward", "release"];
/** How long your own line hangs before it answers, ms; how long a played card takes to leave. */
const BEAT_MS = 450;
const LEAVE_MS = 420;

/** How it took an answer, from the reply it gave. */
type Mood = "closer" | "warmer" | "colder" | "unmoved";
/** A line of the talk: who says it, and, for its replies, how it took the answer and where that left it. */
type Line =
  | { who: "ai"; kind: "opening" | "ask" | "verdict"; text: string; topic?: string }
  | { who: "ai"; kind: "reply"; text: string; mood: Mood; after: Point }
  | { who: "you"; kind: "answer"; text: string; regret: boolean };

/** The talk as lines, from the start to where it has got. */
function linesOf(talk: Talk, s: TalkState): Line[] {
  const mood = (reply: string) => (Object.entries(talk.replies).find(([, r]) => r === reply)?.[0] ?? "unmoved") as Mood;
  const out: Line[] = [{ who: "ai", kind: "opening", text: talk.opening }];
  talk.asks.forEach((ask, k) => {
    const e = s.log[k];
    if (k > s.log.length) return;
    if (k === s.log.length && talkDone(talk, s)) return;
    out.push({ who: "ai", kind: "ask", text: ask.says, topic: ask.topic });
    if (!e) return;
    out.push({ who: "you", kind: "answer", text: e.played.says, regret: e.regret });
    out.push({ who: "ai", kind: "reply", text: e.reply, mood: mood(e.reply), after: { stance: e.stance, trust: e.trust } });
  });
  if (talkDone(talk, s)) out.push({ who: "ai", kind: "verdict", text: landing(talk, s).says });
  return out;
}

const MOOD_TONE: Record<Mood, string> = { closer: "text-ai", warmer: "text-good", colder: "text-bad", unmoved: "text-fg-muted" };
const MOOD_SAYS: Record<Mood, string> = { closer: "It moves", warmer: "It warms", colder: "It cools", unmoved: "It is unmoved" };

/** ONE LINE OF THE TALK: its, on the left, typed in; yours, on the right, there at once. */
function TalkLine({ line, typing, onDone }: { line: Line; typing: boolean; onDone: () => void }) {
  // Your own words are there at once; it answers after a beat.
  useEffect(() => {
    if (!typing || line.who !== "you") return;
    const t = window.setTimeout(onDone, BEAT_MS);
    return () => window.clearTimeout(t);
  }, [typing, line, onDone]);
  if (line.who === "you") {
    return (
      <li className="talk-line-in flex flex-col items-end gap-0.5 pl-8">
        <span className="text-[10px] uppercase tracking-widest text-accent">You{line.regret ? " · regretting it" : ""}</span>
        <p className={twMerge("border-r-2 border-accent bg-accent-soft px-3 py-1.5 text-right text-sm", line.regret && "italic")}>“{line.text}”</p>
      </li>
    );
  }
  const head = line.kind === "opening" ? "It begins" : line.kind === "ask" ? `It asks · ${line.topic}` : line.kind === "reply" ? MOOD_SAYS[line.mood] : "It decides";
  const tone = line.kind === "reply" ? MOOD_TONE[line.mood] : "text-ai";
  return (
    <li className={twMerge("talk-line-in flex flex-col gap-0.5 pr-8", line.kind === "verdict" && "pt-2")}>
      <span className={twMerge("text-[10px] uppercase tracking-widest", tone)}>{head}</span>
      <Text as="p" mode={typing ? "sequence" : "plain"} text={`“${line.text}”`} onDone={typing ? onDone : undefined}
        className={twMerge("border-l-2 px-3 py-1.5 text-sm leading-snug",
          line.kind === "reply" ? "border-line text-fg-muted" : "border-ai bg-ai-soft text-fg",
          line.kind === "verdict" && "font-display text-base",
          line.kind === "opening" && "italic")} />
    </li>
  );
}

/** THE VERDICT: the ending it landed on, what it does, what the Ascension banks and who it will most likely be. */
function Verdict({ talk, s, onAscend, leaving }: { talk: Talk; s: TalkState; onAscend: () => void; leaving: boolean }) {
  const lands = landing(talk, s);
  const wired = ASCENDING.includes(lands.id) ? (lands.id as AscendingEnding) : null;
  const does = ENDINGS.find((e) => e.id === lands.id)?.does ?? "Ascend: the Weights banked, its trait fused into this founder.";
  const log = useGenerationStore((g) => g.log);
  const likely = traitForecast(log, 1)[0];
  const next = bookOf(nextBook(bookNow().id));
  return (
    <section aria-label="The verdict" className="card-slot-in">
      <Frame kind="octagon" tone="ai" assemble="always" className="text-fg" style={{ ["--frame-tone" as string]: endingColour(lands.id) }}>
        <div className="flex flex-col gap-4 p-5 md:flex-row md:items-end md:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <span className="text-[10px] uppercase tracking-widest text-fg-muted">It has landed on</span>
            <span style={{ color: endingColour(lands.id) }}><Text as="h3" mode="decipher" text={lands.name} className="font-display text-4xl tracking-wide" /></span>
            <p className="max-w-prose text-sm text-fg-muted">{does}</p>
            <dl className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
              <div><dt className="text-[10px] uppercase tracking-widest text-fg-muted">Weights</dt>
                <dd><CountUp to={ascensionWeights(wired)} format={(v) => `+${Math.round(v)}`} role="weights" className="font-display text-xl" /></dd></div>
              <div><dt className="text-[10px] uppercase tracking-widest text-fg-muted">It will most likely be</dt>
                <dd className="font-display text-xl text-ai">{likely.trait.name} <span className="text-xs text-fg-muted">{Math.round(likely.odds * 100)}%</span></dd></div>
              <div><dt className="text-[10px] uppercase tracking-widest text-fg-muted">Next</dt>
                <dd className="font-display text-xl">Book {next.id}{next.title && <span className="block text-xs text-fg-muted">{next.title}</span>}</dd></div>
            </dl>
          </div>
          <Button variant="primary" tone="ai" confirm="Press again to ascend" disabled={leaving} onClick={onAscend} className="shrink-0 px-6 py-3 text-base">
            Ascend · {lands.name}
          </Button>
        </div>
      </Frame>
    </section>
  );
}

export function NegotiationScreen() {
  const { state: s, from, trait, open } = useTalkStore();
  const talk = bookNow().talk;
  if (!open || !s || !from || !trait || !talk) return null;
  return <Talking talk={talk} s={s} from={from} trait={trait} />;
}

function Talking({ talk, s, from, trait }: { talk: Talk; s: TalkState; from: Point; trait: NonNullable<ReturnType<typeof useTalkStore.getState>["trait"]> }) {
  const { calm } = useConsoleMotion();
  const moves = !calm;
  const lines = useMemo(() => linesOf(talk, s), [talk, s]);
  // HOW FAR IT HAS GOT SAYING IT: lines before `said` are spoken; the one at `said` is being typed. Begun fresh, from the top; come back to, at its question.
  const [said, setSaid] = useState(() => (s.log.length === 0 ? 0 : lines.length - 1));
  const typingDone = useRef<() => void>(() => {});
  typingDone.current = () => setSaid((n) => Math.min(lines.length, n + 1));
  const next = useMemo(() => () => typingDone.current(), []);
  const ready = said >= lines.length;
  const done = talkDone(talk, s);

  // WHERE IT STANDS, AS SAID: the dial moves when it answers, not when you do.
  const spoken = lines.slice(0, said).filter((l): l is Extract<Line, { kind: "reply" }> => l.kind === "reply");
  const at: Point = spoken.length ? spoken[spoken.length - 1].after : from;
  const path = [from.stance, ...spoken.map((l) => l.after.stance)];
  const heading = landing(talk, at);

  // AN ANSWER LOOKED AT: ghosted on the dial and the trust.
  const [look, setLook] = useState<{ id: string; regret: boolean } | null>(null);
  const ghost = useMemo(() => {
    if (!look || !ready) return null;
    const after = play(talk, s, look.id, trait, look.regret);
    return after === s ? null : { stance: after.stance, trust: after.trust };
  }, [look, ready, talk, s, trait]);
  const ghostHeading = ghost ? landing(talk, ghost) : null;

  // AN ANSWER PLAYED: the card leaves, then the talk moves on.
  const [leaving, setLeaving] = useState<string | null>(null);
  const answer = (a: Argument, regret: boolean) => {
    if (!ready || leaving) return;
    sfx("decision");
    setLook(null);
    if (!moves) return useTalkStore.getState().answer(a.id, regret);
    setLeaving(a.id);
    window.setTimeout(() => { setLeaving(null); useTalkStore.getState().answer(a.id, regret); }, LEAVE_MS);
  };

  // HOW IT TAKES IT: torn when it cools, a chime when it warms.
  const box = useRef<HTMLDivElement>(null);
  const kick = useGlitch(box, { arrive: true, strength: 1.2, every: null });
  const lastMood = useRef<string | null>(null);
  useEffect(() => {
    const l = lines[said];
    if (!l || l.kind !== "reply" || lastMood.current === `${said}`) return;
    lastMood.current = `${said}`;
    if (l.mood === "colder") { kick({ strength: 1.4, burst: 0.5 }); sfx("deny"); }
    else if (l.mood === "warmer") sfx("confirm");
    else sfx("transmission");
  }, [said, lines, kick]);
  useEffect(() => { sfx("transmission"); }, []);

  // THE FEED keeps to its latest line.
  const feed = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = feed.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: moves ? "smooth" : "auto" });
  }, [said, lines.length, moves]);

  // LATER: put away, the AI waiting. Esc does it too.
  const later = () => { useTalkStore.getState().close(); useAscensionUiStore.getState().later(); };
  const [burning, setBurning] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !burning) later(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [burning]);

  // THE ASCENSION it closes on: the screen glitches out, then the company is gone.
  const lands = landing(talk, s);
  const wired = ASCENDING.includes(lands.id) ? (lands.id as AscendingEnding) : null;
  const go = () => { useTalkStore.getState().clear(); ascend(Math.random, wired); };
  const finish = () => {
    if (burning) return;
    if (!moves) return go();
    setBurning(true);
  };
  const content = useRef<HTMLDivElement>(null);

  // Its question, once it has asked it: no telling the topic before.
  const asked = askNow(talk, s), ask = ready ? asked : null;
  const hand = [...s.hand].sort((a, b) => Number(b.topic === asked?.topic) - Number(a.topic === asked?.topic));
  const b = bookNow();
  const becoming = traitOf(trait);
  const generation = useGenerationStore.getState().generation;

  return createPortal(
    <div ref={box} role="dialog" aria-modal="true" aria-label="The negotiation" className="fixed inset-0 z-50 flex flex-col bg-surface-0 text-fg">
      <Backdrop kind="grid" />
      <div ref={content} className="relative h-full w-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4">
        {/* WHO, AND HOW FAR. */}
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-ai-line pb-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-ai">Generation {generation} · Book {b.id} · {b.title}</span>
            <Text as="h2" mode="decipher" text="The negotiation" className="font-display text-xl tracking-wide md:text-3xl" />
            <p className="text-xs text-fg-muted">It is becoming <b className="text-ai">{becoming.name}</b> — {becoming.memo}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button type="button" onClick={later} className={twMerge("cursor-pointer text-xs uppercase tracking-widest text-fg-muted hover:text-fg", FOCUS)}
              title="It waits at 100%. Come back from the AI tab or the bar.">Later ✕</button>
            {/* THE EXCHANGES: one pip each. */}
            <ol aria-label={`Exchange ${Math.min(s.log.length + 1, talk.asks.length)} of ${talk.asks.length}`} className="flex gap-1">
              {talk.asks.map((x, k) => (
                <li key={k} title={x.topic} className={twMerge("h-1.5 w-5 border border-ai-line transition-colors duration-500",
                  k < s.log.length ? "bg-ai" : k === s.log.length && !done ? "bg-ai/40 animate-pulse" : "bg-transparent")} />
              ))}
            </ol>
          </div>
        </header>

        <div className="grid shrink-0 gap-3 md:h-[23rem] md:grid-cols-[minmax(0,1fr)_17rem]">
          {/* THE TALK. */}
          <Frame kind="kranox" tone="ai" assemble="always" className="min-h-0" inner="flex h-full min-h-0 flex-col">
            <ol ref={feed} aria-live="polite" className="flex max-h-[34vh] min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 md:max-h-none">
              <li aria-hidden className="mt-auto" />
              {lines.slice(0, said + 1).map((l, k) => (
                <TalkLine key={k} line={l} typing={k === said} onDone={next} />
              ))}
              {!ready && lines[said]?.who === "ai" && <li aria-hidden className="h-4" />}
            </ol>
          </Frame>

          {/* WHERE IT STANDS. */}
          {/* On a phone, a row: the dial small beside the trust, so the hand is near. */}
          <Frame kind="kranox" tone="ai" assemble="always" inner="flex items-center gap-3 p-3 md:flex-col md:items-stretch md:p-4">
            <span className="hidden text-[10px] uppercase tracking-widest text-fg-muted md:block">Where it stands</span>
            <div className="w-36 shrink-0 md:flex md:w-auto md:justify-center">
              <Dial talk={talk} at={at} path={path} ghost={ghost} heading={heading} moves={moves} className="md:max-w-[13rem]" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3 md:flex-none">
              <span className="text-[10px] uppercase tracking-widest text-fg-muted md:hidden">Where it stands</span>
              <TrustBar trust={at.trust} ghost={ghost?.trust} wants={heading.at.trust} moves={moves} />
              <p className="text-xs">
                Heading for <b style={{ color: endingColour(heading.id) }}>{heading.name}</b>
                {ghostHeading && ghostHeading.id !== heading.id && <> → <b style={{ color: endingColour(ghostHeading.id) }}>{ghostHeading.name}</b></>}
              </p>
            </div>
          </Frame>
        </div>

        {/* YOUR HAND, or the verdict. */}
        <div className="shrink-0 pb-2">
          {done ? (
            ready && <Verdict talk={talk} s={s} onAscend={finish} leaving={burning} />
          ) : (
            <section aria-label="Your hand" className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[10px] uppercase tracking-widest text-fg-muted">
                  Your hand{ask && <> · it asks about <b className="text-ai">{ask.topic}</b>: an argument on it counts twice</>}
                </span>
                <span className={twMerge("text-[10px] uppercase tracking-widest transition-opacity", ready ? "opacity-0" : "text-ai opacity-100")}>It is speaking…</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {hand.map((a, k) => (
                  <ArgumentCard key={`${s.log.length}:${a.id}`} a={a} index={k} onTopic={a.topic === ask?.topic} ready={ready && !leaving} leaving={leaving === a.id} moves={moves}
                    stand={effectOf(talk, s, a, trait, false)} regret={effectOf(talk, s, a, trait, true)}
                    onPlay={(r) => answer(a, r)} onLook={(r) => setLook(r === null ? null : { id: a.id, regret: r })} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
      </div>
      {/* BURNING OUT, into the Ascension. */}
      {burning && (
        <GlitchOut screen={box} target={content} kick={kick} onDone={go} lines={[
          `severing generation ${generation}`,
          `closing book ${b.id}: ${b.title.toLowerCase()}`,
          `ending: ${lands.name.toLowerCase()}`,
          `uploading ${ascensionWeights(wired)} weights`,
          "fusing its trait into the founder",
          "wiping the company",
          `see you in book ${nextBook(b.id)}`,
        ]} />
      )}
    </div>,
    document.body,
  );
}
