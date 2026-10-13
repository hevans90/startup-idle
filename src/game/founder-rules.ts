/**
 * THE FOUNDERS' RULES, applied: whether the founder of this company plays by
 * one. @see FounderDef.rule
 */
import { useFounderStore } from "../state/founder.store";

/** Whether this company's founder is the one named. */
export const founderIs = (id: string) => useFounderStore.getState().selectedFounderId === id;
