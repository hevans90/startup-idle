/**
 * A `?fixture=` SESSION KEEPS ITS HANDS OFF THE SAVE: imported before any
 * store, it swaps `localStorage` for a copy held in memory, so whatever the
 * session does — a company seeded for the fixture, money spent, a founder
 * chosen — is gone with the tab, and the save the browser holds is as it was.
 * The map was already safe (`startedOnFixture`); this covers the rest.
 * @see seedFixtureCompany
 */
function sandbox(): void {
  if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("fixture")) return;
  const real = window.localStorage;
  const mem = new Map<string, string>();
  for (let i = 0; i < real.length; i++) {
    const k = real.key(i);
    if (k !== null) mem.set(k, real.getItem(k) ?? "");
  }
  const copy: Storage = {
    get length() { return mem.size; },
    clear: () => mem.clear(),
    getItem: (k) => mem.get(k) ?? null,
    key: (i) => [...mem.keys()][i] ?? null,
    removeItem: (k) => { mem.delete(k); },
    setItem: (k, v) => { mem.set(k, String(v)); },
  };
  Object.defineProperty(window, "localStorage", { value: copy, configurable: true });
}

sandbox();
