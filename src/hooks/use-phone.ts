/**
 * THE PHONE: a screen this narrow or narrower gets the phone's layout — the
 * map and the company a tab each, comms one card, the build bar's views behind
 * a button, dialogs the whole screen. Read once, as the layout is chosen once.
 * @see App, plans/ui-overhaul.md §3.6
 */
export const PHONE_MAX = 768;

export const isPhone = (): boolean => typeof window !== "undefined" && window.innerWidth <= PHONE_MAX;
