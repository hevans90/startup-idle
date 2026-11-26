/**
 * LOCAL DEV'S BANK: run on the dev server, Equity and Weights are as good as
 * endless — a bonus added as the stores load, taken off again as they save, so
 * a save never holds it. Nothing in a built game. @see prestige.store, generation.store
 */
const dev = !!import.meta.env?.DEV;

/** Run locally: the Machine open, whole, before any Ascension. @see game/machine */
export const DEV_OPEN = dev;

/** Equity on top of what is saved. (Small enough that a Decimal still counts the saved part.) */
export const DEV_EQUITY = dev ? 1e12 : 0;
/** Weights on top of what is saved. */
export const DEV_WEIGHTS = dev ? 1e9 : 0;
