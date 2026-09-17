import { twMerge } from "tailwind-merge";
import { resolveAvatarUrl } from "../../game/team-leader-avatars";
import type { TeamLeaderTraitId } from "../../game/team-leaders.catalog";
import type { GeneratorId } from "../../state/generators.store";

const TRAIT_AVATAR_BG: Record<TeamLeaderTraitId, string> = {
  overachiever:   "bg-blue-100   dark:bg-blue-900   text-blue-600   dark:text-blue-300",
  chaos_agent:    "bg-red-100    dark:bg-red-900    text-red-600    dark:text-red-300",
  quiet_quitter:  "bg-slate-100  dark:bg-slate-800  text-slate-500  dark:text-slate-400",
  brown_noser:    "bg-yellow-100 dark:bg-yellow-900 text-yellow-600 dark:text-yellow-300",
  thought_leader: "bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300",
  burnout_risk:   "bg-orange-100 dark:bg-orange-900 text-orange-600 dark:text-orange-300",
};

const SIZE = {
  sm: { box: "w-8 h-8",   text: "text-sm"  },
  md: { box: "w-10 h-10", text: "text-base" },
  lg: { box: "w-14 h-14", text: "text-xl"  },
} as const;

type AvatarProps = {
  name: string;
  role: GeneratorId;
  traitId: TeamLeaderTraitId;
  avatarId?: string;
  size?: keyof typeof SIZE;
  className?: string;
};

export function EmployeeAvatar({
  name,
  role,
  traitId,
  avatarId,
  size = "md",
  className,
}: AvatarProps) {
  const { box, text } = SIZE[size];
  const initial = name[0]?.toUpperCase() ?? "?";

  if (avatarId) {
    return (
      <img
        src={resolveAvatarUrl(role, avatarId)}
        alt={name}
        className={twMerge(box, "object-cover object-top shrink-0", className)}
      />
    );
  }

  return (
    <div
      className={twMerge(
        box,
        "shrink-0 flex items-center justify-center font-semibold select-none",
        text,
        TRAIT_AVATAR_BG[traitId],
        className,
      )}
    >
      {initial}
    </div>
  );
}
