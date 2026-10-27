import { twMerge } from "tailwind-merge";
import { resolveAvatarUrl } from "../../game/team-leader-avatars";
import type { PersonalityId } from "../../game/leaders";
import type { GeneratorId } from "../../state/generators.store";

const TRAIT_AVATAR_BG: Record<PersonalityId, string> = {
  overachiever:   "bg-info-soft     text-info  ",
  chaos_agent:    "bg-bad-soft       text-bad   ",
  quiet_quitter:  "bg-surface-1   text-fg-muted ",
  brown_noser:    "bg-warn-soft text-warn",
  thought_leader: "bg-ai-soft text-ai",
  burnout_risk:   "bg-warn-soft text-warn",
};

const SIZE = {
  sm: { box: "w-8 h-8",   text: "text-sm"  },
  md: { box: "w-10 h-10", text: "text-base" },
  lg: { box: "w-14 h-14", text: "text-xl"  },
} as const;

type AvatarProps = {
  name: string;
  role: GeneratorId;
  traitId: PersonalityId;
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
