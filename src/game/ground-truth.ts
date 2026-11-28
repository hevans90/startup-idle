/**
 * GROUND-TRUTH DATA: what Drone Farming's drones bank from the fields they cut, a unit a field. While there is
 * some, a training run is faster and lands harder — the more banked, the more, up to a busy data plant's — and
 * each run spends a run's worth. Capped at three runs', so it rewards steady harvests, not hoarding. Live state of
 * the session, not saved. @see notable "drones", plans/farms-and-flood-walls.md §3
 */
/** What one training run spends, and the most banked. */
export const TRUTH_RUN = 40;
export const TRUTH_CAP = 3 * TRUTH_RUN;
/** What a full bank does to a run: its speed, and its jump. @see DATAPLANT_SPEED */
export const TRUTH_SPEED = 0.25;
export const TRUTH_JUMP = 0.1;

let bank = 0;
export const groundTruth = () => bank;
/** Fields scanned: banked, up to the cap. */
export const bankGroundTruth = (fields: number) => { bank = Math.min(TRUTH_CAP, bank + Math.max(0, fields)); };
/** How full the bank is, 0–1. */
export const truthShare = () => bank / TRUTH_CAP;
/** A run starting: what the bank does for it, and a run's worth spent. Returns the share it ran on. */
export function spendGroundTruth(): number {
  const share = truthShare();
  bank = Math.max(0, bank - TRUTH_RUN);
  return share;
}
export const resetGroundTruth = () => { bank = 0; };
