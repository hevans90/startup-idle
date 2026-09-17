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

/**
 * Pixi asks a throwaway canvas what shader precision the GPU supports, the
 * first time anything builds a WebGL program. There is no GPU here and no
 * canvas to ask one for — but a null context is a case Pixi already handles,
 * falling back to `mediump`, so the stub only has to exist and say no.
 *
 * Deliberately not a DOM: `window` stays undefined, which is what the code that
 * asks whether it is in a browser is looking at.
 */
function ensureCanvasFactory(): void {
  if (globalThis.document !== undefined) return;
  globalThis.document = {
    createElement: () => ({ getContext: () => null }),
  } as unknown as Document;
}

/** Before any test file imports stores, so zustand `persist` sees a storage backend. */
ensureLocalStorage();
ensureCanvasFactory();

beforeEach(() => {
  localStorage.clear();
  jest.useFakeTimers({ now: 0 });
});

afterEach(() => {
  jest.useRealTimers();
});
