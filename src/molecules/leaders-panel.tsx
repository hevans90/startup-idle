/**
 * LEADERS, on the Employees tab once the Talent Agency stands: a leader for
 * each kind, or a way to hire one; where they lead and how many, their rank
 * and how far to the next, the perk to pick when a rank is reached; placed
 * on the map, moved, or let go. @see game/leaders, team-leaders.store
 */
import { twMerge } from "tailwind-merge";
import { useShallow } from "zustand/shallow";

import { LEADER_PERKS, MAX_LEADER_RANK, PERSONALITIES, XP_AT, perkOffer, type Leader } from "../game/leaders";
import { RED_FLAGS } from "../game/linkedout";
import { useLinkedOutStore } from "../state/linkedout.store";
import { leaderTeam } from "../game/projects";
import { structureDef } from "../world/structures/def";
import { useGeneratorStore, type GeneratorId } from "../state/generators.store";
import { useTeamLeadersEmployeesStore } from "../state/team-leaders.store";
import { useWorldStore } from "../state/world.store";
import { Button, Panel, Tile } from "../ui/console";
import { useTicking } from "../hooks/use-ticking";
import { TenXDevText } from "../utils/ten-x-utils";
import { RainbowText } from "../utils/vibe-utils";
import { EmployeeAvatar } from "./innovation/employee-avatar";

export const KIND_PLURAL: Record<GeneratorId, string> = { intern: "interns", vibe_coder: "vibe coders", "10x_dev": "10x devs" };

function Kind({ id }: { id: GeneratorId }) {
  if (id === "vibe_coder") return <RainbowText text="Vibe coders" inline />;
  if (id === "10x_dev") return <TenXDevText text="10x devs" />;
  return <>Interns</>;
}

/** Where a leader is, in words: the building and its team, or not placed. */
function whereText(l: Leader, owned: number): { text: string; ok: boolean } {
  if (l.placedAt === null) return { text: "Not placed: they do nothing until you put them in a building.", ok: false };
  const s = useWorldStore.getState().grid.structures.get(l.placedAt);
  const name = s ? structureDef(s.def)?.name ?? "their building" : "a building that is gone";
  return { text: `Leads ${leaderTeam(l.role)} of ${owned} at the ${name}; the rest of them feel half.`, ok: !!s };
}

function LeaderCard({ l, owned }: { l: Leader; owned: number }) {
  const { pickPerk, setPlacing, placeLeader } = useTeamLeadersEmployeesStore.getState();
  const letGo = useLinkedOutStore((s) => s.letGo);
  const flag = l.flag ? RED_FLAGS[l.flag] : null;
  const placing = useTeamLeadersEmployeesStore((s) => s.placing === l.role);
  const p = PERSONALITIES[l.personality];
  const offer = perkOffer(l);
  const where = whereText(l, owned);
  const top = l.rank >= MAX_LEADER_RANK;
  const from = XP_AT[l.rank], to = XP_AT[Math.min(MAX_LEADER_RANK, l.rank + 1)];
  const pct = top ? 100 : Math.min(100, ((l.xp - from) / (to - from)) * 100);
  const place = () => { useWorldStore.getState().setTool("inspect"); setPlacing(l.role); };
  return (
    <div className="flex flex-col gap-2 border border-line-quiet bg-surface-1 p-2.5">
      <div className="flex gap-2.5">
        <EmployeeAvatar name={l.name} role={l.role} traitId={l.personality} avatarId={l.avatarId} size="md" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <b className="truncate text-sm">{l.name}</b>
            <span className="shrink-0 font-display text-[11px] tabular-nums text-warn">Rank {l.rank}</span>
          </div>
          <span className="text-[11px] text-fg-muted"><b className="text-fg">{p.name}</b> · {p.says}</span>
          <div role="progressbar" aria-label={`${l.name}: to the next rank`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className="mt-1 h-1 bg-surface-3">
            <div className="h-full bg-warn transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
      {/* What their profile did not say, shown once they started. @see RED_FLAGS */}
      {flag && <p className={twMerge("text-[11px]", flag.bad ? "text-bad" : "text-good")}>{flag.name}: {flag.says}</p>}
      <p className={twMerge("text-[11px]", where.ok ? "text-fg-muted" : "text-bad")}>
        {placing ? `Click a building where your ${KIND_PLURAL[l.role]} work.` : where.text}
      </p>
      {offer.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-warn">Rank {l.perks.length + 1}: pick one</span>
          <div className="grid grid-cols-3 gap-1">
            {offer.map((k) => (
              <Tile key={k} lit onClick={() => pickPerk(l.id, k)} className="flex flex-col items-start gap-0.5 px-1.5 py-1">
                <span className="text-[11px] font-bold">{LEADER_PERKS[k].name}</span>
                <span className="text-[10px] leading-snug text-fg-muted">{LEADER_PERKS[k].says}</span>
              </Tile>
            ))}
          </div>
        </div>
      )}
      {l.perks.length > 0 && (
        <p className="flex flex-wrap gap-1 text-[10px]">
          {l.perks.map((k) => <span key={k} title={LEADER_PERKS[k].says} className="border border-line-quiet px-1 py-px">{LEADER_PERKS[k].name}</span>)}
        </p>
      )}
      <div className="flex justify-end gap-1">
        {placing
          ? <Button size="sm" variant="quiet" onClick={() => setPlacing(null)}>Cancel</Button>
          : <Button size="sm" variant={l.placedAt === null ? "primary" : "secondary"} onClick={place}>{l.placedAt === null ? "Place on the map" : "Move"}</Button>}
        {l.placedAt !== null && !placing && <Button size="sm" variant="quiet" onClick={() => placeLeader(l.id, null)}>Take out</Button>}
        <Button size="sm" variant="danger" confirm={`Let ${l.name.split(" ")[0]} go?`} onClick={() => letGo(l.id)}>Let go</Button>
      </div>
    </div>
  );
}

const clock = (ms: number) => {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
};

/**
 * THE SEARCH FOR A KIND'S LEADER, as it stands on LinkedOut: the job posted
 * and how long it has left, the applicants waiting and for how long; with no
 * leader and nothing under way, a way to start.
 */
function Hiring({ role, hasLeader, onOpen }: { role: GeneratorId; hasLeader: boolean; onOpen: () => void }) {
  const post = useLinkedOutStore((s) => s.posts.find((p) => p.role === role));
  const waiting = useLinkedOutStore(useShallow((s) => s.applicants.filter((a) => a.role === role)));
  if (hasLeader && !post && !waiting.length) return null;
  const now = Date.now();
  const soonest = waiting.length ? Math.min(...waiting.map((a) => a.leavesAt)) : null;
  return (
    <div className={twMerge("flex items-center justify-between gap-2 border px-2.5 py-2 text-xs", waiting.length ? "border-console-line" : "border-dashed border-line")}>
      <div className="flex min-w-0 flex-col gap-0.5">
        {!post && !waiting.length && <span className="text-fg-muted">No leader yet.</span>}
        {post && (
          <span className="text-fg-muted">
            Job posted · <span className="tabular-nums">closes in {clock(post.closesAt - now)}</span>
            {post.left > 0 && <> · up to {post.left} more</>}
          </span>
        )}
        {waiting.length > 0 && (
          <span className="text-fg">
            <b className="text-console">{waiting.length} {waiting.length === 1 ? "applicant" : "applicants"}</b> waiting
            {soonest !== null && <span className="tabular-nums text-fg-muted"> · the first leaves in {clock(soonest - now)}</span>}
          </span>
        )}
        {post && !waiting.length && <span className="text-fg-faint">No one yet: they come every minute or three.</span>}
      </div>
      <Button size="sm" variant={waiting.length || !post ? "primary" : "secondary"} className="shrink-0" onClick={onOpen}>
        {waiting.length ? "See them" : post ? "Open LinkedOut" : "Find one on LinkedOut"}
      </Button>
    </div>
  );
}

export function LeadersPanel({ className }: { className?: string }) {
  useTicking(1000);
  const generators = useGeneratorStore((s) => s.generators);
  const leaders = useTeamLeadersEmployeesStore((s) => s.employees);
  const openLinkedOut = useLinkedOutStore((s) => s.setOpen);
  const kinds = generators.filter((g) => g.amount > 0);
  if (!kinds.length) return null;
  return (
    <Panel title="Leaders" className={className} help="One leader for each kind, in a building where that kind works: the people there feel them in full, the rest of the kind half. They rank up from their team's work, and pick a perk at every rank.">
      <div className="flex flex-col gap-3">
        {kinds.map((g) => {
          const id = g.id as GeneratorId, l = leaders.find((x) => x.role === id);
          return (
            <section key={id} aria-label={`${id} leader`} className="flex flex-col gap-1.5">
              <span className="font-display text-xs uppercase tracking-wider"><Kind id={id} /></span>
              {l && <LeaderCard l={l} owned={g.amount} />}
              <Hiring role={id} hasLeader={!!l} onOpen={() => openLinkedOut(true)} />
            </section>
          );
        })}
      </div>
    </Panel>
  );
}
