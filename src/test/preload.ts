import { afterEach, beforeEach, jest } from "bun:test";

function ensureLocalStorage(): void {
  if (globalThis.localStorage !== undefined) return;
  const store = new Map<string, string>();
  globalThis.localStorage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  } as Storage;
}

/** Before any test file imports stores, so zustand `persist` sees a storage backend. */
ensureLocalStorage();

beforeEach(() => {
  localStorage.clear();
  jest.useFakeTimers({ now: 0 });
});

afterEach(() => {
  jest.useRealTimers();
});
