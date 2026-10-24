/**
 * QUEST UI, LAZILY: the one way in, so the console and arwes are a chunk of
 * their own, fetched when the first piece of it is shown. Wrap what uses it
 * in `React.lazy(() => loadQuestUi().then(...))`. @see quest-ui/index
 */
export const loadQuestUi = () => import("./index");
