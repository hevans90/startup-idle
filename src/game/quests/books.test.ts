import { afterEach, describe, expect, test } from "bun:test";

import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useFounderStore } from "../../state/founder.store";
import { useGenerationStore } from "../../state/generation.store";
import { useQuestStore } from "../../state/quest.store";
import { ascend } from "../ascension";
import { BOOKS, book, bookNow, chapterKicker, chapterOf, nextBook } from "./books";
import { CHAPTERS, REQUESTS } from "./chapters";
import { BOOK2_ENDINGS, ENDINGS } from "./endings";
import { BOOK2_CHAPTERS, grudge, variantNow } from "./book2";

afterEach(() => resetAllGameStores());

const g = () => useGenerationStore.getState();

describe("the books", () => {
  test("five, then endless; books 1 and 2 written, the rest unwritten yet", () => {
    expect(BOOKS.map((b) => b.id)).toEqual([1, 2, 3, 4, 5, "endless"]);
    expect(book(1).chapters).toBe(CHAPTERS);
    expect(book(1).requests).toBe(REQUESTS);
    expect(book(1).endings).toBe(ENDINGS);
    expect(book(2).chapters).toBe(BOOK2_CHAPTERS);
    expect(book(2).endings).toBe(BOOK2_ENDINGS);
    for (const id of [3, 4, 5, "endless"] as const) expect(book(id).chapters).toHaveLength(0);
    expect([1, 2, 3, 4, 5, "endless"].map((id) => nextBook(id as 1))).toEqual([2, 3, 4, 5, "endless", "endless"]);
  });

  test("a new game is in book 1; each Ascension turns to the next, kept in the record and the past", () => {
    expect(g().book).toBe(1);
    expect(bookNow().title).toBe("Inheritance");
    useFounderStore.getState().chooseFounder("neet");
    useQuestStore.setState({ chapters: { ledger: 0 } });
    ascend(() => 0.5);
    expect(g().book).toBe(2);
    expect(g().past.at(-1)?.book).toBe(1);
    expect(useQuestStore.getState().record.at(-1)?.book).toBe(1);
  });

  test("its dark chapter is found as its chapters are, and said as what it is; none in a book without one", () => {
    expect(chapterOf("cold-start")?.title).toBe("Cold Start");
    expect(chapterKicker(chapterOf("cold-start")!)).toBe("After the shutdown");
    expect(chapterKicker(chapterOf("ledger")!)).toBe("Chapter 1");
    useGenerationStore.setState({ book: 3 });
    expect(chapterOf("cold-start")).toBeUndefined();
  });

  test("a save from before the books: book 1 in the first generation, book 2 after", () => {
    const merge = useGenerationStore.persist.getOptions().merge!;
    expect(merge({ generation: 1 }, g()).book).toBe(1);
    expect(merge({ generation: 4 }, g()).book).toBe(2);
    expect(merge({ generation: 4, book: 3 }, g()).book).toBe(3);
    expect(merge(null, g()).book).toBe(1);
  });

  test("book 2 is told as book 1 ended, and raises the sorest thing book 1 left", () => {
    expect(variantNow()).toBeNull();
    for (const [legacy, v] of [["merge", "partners"], ["steward", "steward"], ["release", "stranger"], ["leash", "resentful"]] as const) {
      useGenerationStore.setState({ legacy });
      expect(variantNow()).toBe(v);
    }
    expect(grudge()).toContain("I looked for something");
    useQuestStore.setState({ record: [{ generation: 1, book: 1, chapters: {}, disposition: { autonomy: 0, machine: 0 }, flags: ["block:rebuilt", "site:refused", "ledger:refused"] }] });
    expect(grudge()).toBe(CHAPTERS.find((c) => c.id === "ledger")!.echoes!["ledger:refused"]);
  });
});
