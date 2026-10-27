/**
 * LINKEDOUT, the window: the jobs posted and who has answered them, the
 * company as the world sees it, and the connections from companies before.
 * Its own wordmark inside the console's look. Opened from the Leaders panel
 * and by clicking the Talent Agency. @see game/linkedout, useLinkedOutStore
 */
import { useState } from "react";
import { twMerge } from "tailwind-merge";

import { LEADER_PERKS, PERSONALITIES } from "../game/leaders";
import { CHECK_COST, POST_OPEN, REHIRE_COST, RED_FLAGS, hireCost, postCost, reviewsOf, type Applicant } from "../game/linkedout";
import { moralePartsNow } from "../game/morale-parts";
import { useTicking } from "../hooks/use-ticking";
import { useGeneratorStore, type GeneratorId } from "../state/generators.store";
import { useInnovationStore } from "../state/innovation.store";
import { useLinkedOutStore } from "../state/linkedout.store";
import { useTeamLeadersEmployeesStore } from "../state/team-leaders.store";
import { Button, Dialog, Tabs } from "../ui/console";
import { EmployeeAvatar } from "./innovation/employee-avatar";
import { KIND_PLURAL } from "./leaders-panel";

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const KIND_ONE: Record<GeneratorId, string> = { intern: "intern", vibe_coder: "vibe coder", "10x_dev": "10x dev" };

/** The wordmark: not anybody else's. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={twMerge("inline-flex items-center font-display text-lg font-bold tracking-tight", className)}>
      Linked<span className="ml-0.5 bg-console px-1 text-surface-0">Out</span>
    </span>
  );
}

const Stars = ({ n }: { n: number }) => (
  <span aria-label={`${n} stars of 5`} className="tabular-nums text-warn">{"★".repeat(n)}<span className="text-fg-faint">{"★".repeat(5 - n)}</span></span>
);

function ApplicantCard({ a, now }: { a: Applicant; now: number }) {
  const { check, hire, pass } = useLinkedOutStore.getState();
  const innovation = useInnovationStore((s) => s.innovation);
  const current = useTeamLeadersEmployeesStore((s) => s.employees.find((e) => e.role === a.role));
  const p = PERSONALITIES[a.personality], flag = a.flag ? RED_FLAGS[a.flag] : null, cost = hireCost(a.rank);
  return (
    <article className="flex gap-3 border border-line-quiet bg-surface-1 p-2.5">
      <EmployeeAvatar name={a.name} role={a.role} traitId={a.personality} avatarId={a.avatarId} size="lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <b className="truncate text-sm">{a.name}</b>
          <span className="shrink-0 text-[10px] tabular-nums text-fg-faint">leaves in {clock(a.leavesAt - now)}</span>
        </div>
        <p className="text-[11px] leading-snug text-fg">{a.headline}</p>
        <p className="text-[11px] italic text-fg-muted">“{a.about}”</p>
        <p className="text-[11px]">
          <b>{p.name}</b> <span className="text-fg-muted">· {p.says}</span>
          {a.rank > 0 && <span className="text-warn"> · starts at rank {a.rank}</span>}
        </p>
        <p className="text-[10px] text-fg-faint">{a.endorsements} endorsements for Synergy · grows into {p.pool.map((k) => LEADER_PERKS[k].name).join(", ")}</p>
        <p className={twMerge("text-[11px]", !a.flagKnown ? "text-fg-muted" : flag?.bad ? "text-bad" : "text-good")}>
          {!a.flagKnown ? "Background: unknown" : flag ? `${flag.name}: ${flag.says}` : "Background: clean"}
        </p>
        <div className="flex flex-wrap justify-end gap-1 pt-1">
          <Button size="sm" variant="quiet" onClick={() => pass(a.id)}>Pass</Button>
          {!a.flagKnown && (
            <Button size="sm" disabled={innovation.lt(CHECK_COST)} onClick={() => check(a.id)}>Background check · <span className="text-innovation">{CHECK_COST}</span></Button>
          )}
          <Button size="sm" variant="primary" disabled={innovation.lt(cost)} confirm={current ? `${current.name.split(" ")[0]} leaves: sure?` : undefined}
            onClick={() => hire(a.id)}>
            Hire · <span className="text-innovation">{cost}</span>
          </Button>
        </div>
      </div>
    </article>
  );
}

function Jobs() {
  useTicking(1000);
  const now = Date.now();
  const posts = useLinkedOutStore((s) => s.posts);
  const applicants = useLinkedOutStore((s) => s.applicants);
  const postsThisRun = useLinkedOutStore((s) => s.postsThisRun);
  const post = useLinkedOutStore((s) => s.post);
  const innovation = useInnovationStore((s) => s.innovation);
  const kinds = useGeneratorStore((s) => s.generators).filter((g) => g.amount > 0).map((g) => g.id as GeneratorId);
  const cost = postCost(postsThisRun);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {kinds.map((k) => {
          const open = posts.find((p) => p.role === k);
          return (
            <div key={k} className="flex items-center justify-between gap-2 border border-line-quiet px-2.5 py-1.5 text-xs">
              <span>Leader, {KIND_PLURAL[k]}</span>
              {open
                ? <span className="tabular-nums text-fg-muted">Posted · up to {open.left} more · closes in {clock(open.closesAt - now)}</span>
                : <Button size="sm" disabled={innovation.lt(cost)} onClick={() => post(k)}>Post a job · <span className="text-innovation">{cost}</span></Button>}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-fg-faint">A post stays up {POST_OPEN / 60} minutes; applicants come every minute or three, and wait eight for an answer.</p>
      <div className="flex flex-col gap-2">
        {applicants.length ? [...applicants].sort((a, b) => b.arrivedAt - a.arrivedAt).map((a) => <ApplicantCard key={a.id} a={a} now={now} />)
          : <p className="py-4 text-center text-xs text-fg-muted">No applicants yet. Post a job.</p>}
      </div>
    </div>
  );
}

function Company() {
  useTicking(1000);
  const stars = useLinkedOutStore((s) => s.stars)();
  const remembered = useLinkedOutStore((s) => s.moraleRemembered);
  const letGo = useLinkedOutStore((s) => s.letGoThisRun);
  const scores = useGeneratorStore((s) => s.satisfactionScores);
  const policies = useGeneratorStore((s) => s.employeeManagement.policies);
  const kinds = useGeneratorStore((s) => s.generators).filter((g) => g.amount > 0).map((g) => g.id as GeneratorId);
  const parts = moralePartsNow(policies);
  const reviews = reviewsOf(kinds.map((k) => ({ kind: k, ...parts[k], score: scores[k] })));
  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex items-baseline justify-between gap-2 border border-line-quiet px-3 py-2">
        <span className="font-display text-sm">Your company</span>
        <span className="text-base"><Stars n={stars} /></span>
      </div>
      <p className="text-fg-muted">
        From your people's morale over the last ten minutes ({remembered >= 0 ? "+" : ""}{Math.round(remembered)}), and {letGo} let go this run.
        More stars bring more applicants, further along, hiding less.
      </p>
      <div className="flex flex-col gap-1.5">
        {reviews.map((r) => (
          <blockquote key={r.kind} className="border-l-2 border-line px-2.5 py-1">
            <Stars n={r.stars} /> <span className="text-fg-muted">— a {KIND_ONE[r.kind]}</span>
            <p className="mt-0.5 italic">“{r.text}”</p>
          </blockquote>
        ))}
      </div>
    </div>
  );
}

function Connections() {
  const connections = useLinkedOutStore((s) => s.connections);
  const rehire = useLinkedOutStore((s) => s.rehire);
  const innovation = useInnovationStore((s) => s.innovation);
  const leaders = useTeamLeadersEmployeesStore((s) => s.employees);
  const kinds = new Set(useGeneratorStore((s) => s.generators).filter((g) => g.amount > 0).map((g) => g.id));
  if (!connections.length) return <p className="py-4 text-center text-xs text-fg-muted">Every leader you have had becomes a connection: here, to bring back in a company to come.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {connections.map((c) => {
        const flag = c.flag ? RED_FLAGS[c.flag] : null, current = leaders.find((l) => l.role === c.role);
        return (
          <div key={c.id} className="flex items-center gap-2.5 border border-line-quiet p-2 text-xs">
            <EmployeeAvatar name={c.name} role={c.role} traitId={c.personality} avatarId={c.avatarId} size="sm" />
            <div className="min-w-0 flex-1">
              <b>{c.name}</b> <span className="text-fg-muted">· {PERSONALITIES[c.personality].name} · {KIND_ONE[c.role]}, was rank {c.rankWas}</span>
              <p className={twMerge("text-[10px]", flag?.bad ? "text-bad" : flag ? "text-good" : "text-fg-faint")}>{flag ? flag.name : "Background: clean"}</p>
            </div>
            <Button size="sm" disabled={!kinds.has(c.role) || innovation.lt(REHIRE_COST)} confirm={current ? `${current.name.split(" ")[0]} leaves: sure?` : undefined}
              title={kinds.has(c.role) ? "Back at rank 1" : `No ${KIND_PLURAL[c.role]} here to lead`} onClick={() => rehire(c.id)}>
              Rehire · <span className="text-innovation">{REHIRE_COST}</span>
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export function LinkedOut() {
  const open = useLinkedOutStore((s) => s.open);
  const setOpen = useLinkedOutStore((s) => s.setOpen);
  const stars = useLinkedOutStore((s) => s.stars)();
  const [tab, setTab] = useState<"jobs" | "company" | "connections">("jobs");
  if (!open) return null;
  return (
    <Dialog title="LinkedOut" kicker={`Your company · ${"★".repeat(stars)}`} wide onClose={() => setOpen(false)}>
      <div className="-mt-2 mb-3 flex items-center justify-between gap-2">
        <Wordmark />
        <span className="text-[10px] uppercase tracking-widest text-fg-faint">Where leaders are found</span>
      </div>
      <Tabs label="LinkedOut" value={tab} onChange={setTab} className="mb-3"
        tabs={[{ id: "jobs", label: "Jobs" }, { id: "company", label: "Company" }, { id: "connections", label: "Connections" }]} />
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        {tab === "jobs" ? <Jobs /> : tab === "company" ? <Company /> : <Connections />}
      </div>
    </Dialog>
  );
}
