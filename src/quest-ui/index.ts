/**
 * QUEST UI: the AI's console — arwes's frames, text and patterns behind our
 * own StrictMode-safe wrappers, themed from the palette. Loaded only through
 * `loadQuestUi`, so it and arwes stay out of the game's own bundle.
 * @see plans/ai-takeover.md "The UI"
 */
export { QuestFrame, ASSEMBLE, type QuestFrameKind } from "./quest-frame";
export { QuestText } from "./quest-text";
export { QuestBackground } from "./quest-background";
export { reducedMotion, useReducedMotion } from "./motion";
