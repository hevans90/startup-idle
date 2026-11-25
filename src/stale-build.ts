/**
 * A TAB OPEN ACROSS A DEPLOY: its code is in chunks named by what is in them, fetched as they are wanted, and a
 * deploy takes the old ones away — so a tab opened before it finds the next one it asks for gone. Where the site
 * has a newer build than the page was loaded from, the page is loaded again: the game is saved as it goes. Where
 * it has not — nobody is online — the page is left as it is, for a reload would lose that too.
 */

/** The least time between two reloads for it, ms. */
const GAP = 60_000;
const RELOADED_AT = "stale-build-reloaded-at";

/** The entry script a page names, by its path; null where it names none. */
export const entryOf = (html: string): string | null => {
  const tag = html.match(/<script\b[^>]*\btype="module"[^>]*>/)?.[0];
  return tag?.match(/\bsrc="([^"]+)"/)?.[1] ?? null;
};

/** Whether the site's page, as it is now, is a newer build than one whose entry script is `mine`. */
export const newerBuild = (html: string, mine: string | null): boolean => {
  const now = entryOf(html);
  return now !== null && mine !== null && now !== mine;
};

let checking: Promise<boolean> | null = null;
/** The check being made, if one is: whether the page is to be loaded again. */
export const staleCheck = () => checking;

async function reloadIfStale(): Promise<boolean> {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT) ?? 0);
    if (Date.now() - last < GAP) return false;
    const res = await fetch(location.pathname, { cache: "no-store", headers: { accept: "text/html" } });
    const mine = document.querySelector('script[type="module"][src]')?.getAttribute("src") ?? null;
    if (!res.ok || !newerBuild(await res.text(), mine)) return false;
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
    location.reload();
    return true;
  } catch { return false; }
}

/** Watch for a chunk that will not load. @see https://vite.dev/guide/build#load-error-handling */
export function installStaleBuild(): void {
  window.addEventListener("vite:preloadError", () => {
    checking ??= reloadIfStale().then((gone) => { if (!gone) checking = null; return gone; });
  });
}
