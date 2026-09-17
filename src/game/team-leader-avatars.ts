import type { GeneratorId } from "../state/generators.store";

/**
 * Available avatar filenames per role. Drop images into:
 *   public/images/team-leaders/<role>/<filename>
 *
 * Candidates are assigned a random avatar from this pool at creation time;
 * all three candidates in a pool get distinct avatars when possible.
 */
export const AVATAR_POOLS: Record<GeneratorId, string[]> = {
  intern:     [],
  vibe_coder: [],
  "10x_dev":  [],
};

export function resolveAvatarUrl(role: GeneratorId, avatarId: string): string {
  return `/images/team-leaders/${role}/${avatarId}`;
}

/** Pick up to `count` distinct avatar IDs from the role's pool. Returns fewer if pool is small. */
export function pickAvatarIds(role: GeneratorId, count: number): (string | undefined)[] {
  const pool = AVATAR_POOLS[role];
  if (pool.length === 0) return Array(count).fill(undefined);

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const result: (string | undefined)[] = [];
  for (let i = 0; i < count; i++) {
    result.push(shuffled[i % shuffled.length]);
  }
  return result;
}
