export type BreakdownRow = {
  source: string;
  value: string;
  tone: "good" | "bad" | "neutral";
};

export type ModifierBreakdown = {
  label: string;
  description?: string;
  rows: BreakdownRow[];
  total: string;
};
