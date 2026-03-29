/** Booleans / counts that only change on real progression — not every money tick. */
export type GameStageSnapshot = {
  internAmount: number;
  vibeAmount: number;
  dev10xAmount: number;
  hasPositiveMps: boolean;
  innovationBelowOne: boolean;
  innovationEarly: boolean;
  innovationFivePlus: boolean;
  isBrokeNews: boolean;
  managersUnlocked: boolean;
  employeeMgmtUnlocked: boolean;
  managerTierTotal: number;
  upgradeCount: number;
};

type NewsBucket = {
  when: (s: GameStageSnapshot) => boolean;
  lines: string[];
};

const FALLBACK_LINES = [
  "The product is fine. The product has always been fine. The product is you.",
  "If growth were a feeling, you'd still be numb.",
  "Your OKRs are watching. They are not impressed.",
  "Somewhere an angel gets its wings; here, another sprint gets renamed.",
];

const NEWS_BUCKETS: NewsBucket[] = [
  {
    when: (s) => s.internAmount === 0,
    lines: [
      "No interns yet. The cruelty hasn't scaled.",
      "Empty office, loud ambition. Classic Series A cosplay.",
      "You could hire someone. The universe bets you won't.",
      "Runway is a mood. Revenue is a rumor.",
    ],
  },
  {
    when: (s) => s.internAmount > 0 && s.internAmount < 10,
    lines: [
      "They asked for mentorship. You heard 'unpaid throughput.'",
      "Every intern is a little tragedy with a lanyard.",
      "Under ten interns walk into a bar. The bar files a headcount request.",
      "Almost ten. The vapers can smell weakness from three tabs away.",
    ],
  },
  {
    when: (s) => s.internAmount >= 10 && s.vibeAmount === 0,
    lines: [
      "Ten interns. The vibe coders unlock, like a curse in a terms-of-service update.",
      "You've bred enough juniors to summon the sloppers. Nature is healing.",
      "The building codes now require at least one person who 'ships vibes.'",
    ],
  },
  {
    when: (s) => s.vibeAmount > 0 && s.vibeAmount < 10,
    lines: [
      "The vapers whisper about 10x devs. You whisper about EBITDA. Nobody sleeps.",
      "Slop is a feature. Morale is a liability.",
      "Eight vibe coders and a dream. The dream is deprecating the dream.",
    ],
  },
  {
    when: (s) => s.dev10xAmount > 0 && s.dev10xAmount < 5,
    lines: [
      "10x devs: half myth, half invoice, all blame when prod breaks.",
      "They don't do tickets. They do 'impact.' The backlog files a restraining order.",
    ],
  },
  {
    when: (s) => s.hasPositiveMps && s.innovationBelowOne,
    lines: [
      "Innovation drips in, like guilt, but taxable.",
      "Ideas are forming. So is regret.",
    ],
  },
  {
    when: (s) => s.innovationEarly,
    lines: [
      "Innovation points: the only currency HR can't audit. Yet.",
      "Spend it on managers before it spends you on therapy.",
    ],
  },
  {
    when: (s) => s.managersUnlocked && s.managerTierTotal < 3,
    lines: [
      "Agile, Corpo, Sales — pick your poison; they all invoice the same soul.",
      "Managers multiply. Accountability divides. Math checks out.",
    ],
  },
  {
    when: (s) =>
      s.managersUnlocked && !s.employeeMgmtUnlocked && s.innovationFivePlus,
    lines: [
      "Employee Management waits, patient as a reorg in January.",
      "You have tiers to burn and perks to pretend are 'culture.'",
    ],
  },
  {
    when: (s) => s.employeeMgmtUnlocked,
    lines: [
      "Autobuy: capitalism's lullaby. Sleep; the interns compound without consent.",
      "−Cost perks: because exploitation should be efficient.",
      "Per-role tuning — HR calls it growth; finance calls it depreciation.",
    ],
  },
  {
    when: (s) => s.managersUnlocked,
    lines: [
      "Valuation accrues while you sleep. So does technical debt. Only one is on the cap table.",
      "Board mandates: permanent bonuses bought with imaginary money. Very on-brand.",
    ],
  },
  {
    when: (s) => s.upgradeCount > 0 && s.upgradeCount < 8,
    lines: [
      "Upgrades unlock like trauma: milestone by milestone.",
      "Each tier has a name. None of them are 'sorry.'",
    ],
  },
  {
    when: (s) => s.dev10xAmount >= 5 || s.upgradeCount >= 15,
    lines: [
      "Late game: you're not playing the idle game; the idle game is playing your calendar.",
      "Cross-tree synergies — corporate for 'we broke three laws at once.'",
      "The mandates stack. The meaning doesn't. Ship anyway.",
    ],
  },
  {
    when: (s) => s.isBrokeNews,
    lines: [
      "Cash flow negative. Spirit flow also negative. Alignment achieved.",
      "Tap the treasury. Pretend it's angel money. Same dopamine.",
    ],
  },
];

/** Eligible ironic news lines for the current snapshot (deduped). */
export function collectNewsMessages(s: GameStageSnapshot): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of NEWS_BUCKETS) {
    if (!b.when(s)) continue;
    for (const line of b.lines) {
      if (seen.has(line)) continue;
      seen.add(line);
      out.push(line);
    }
  }
  if (out.length === 0) return [...FALLBACK_LINES];
  return out;
}

export const NEWS_ROTATION_MS = 8_000;
