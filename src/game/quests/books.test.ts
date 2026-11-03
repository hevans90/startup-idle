import { afterEach, describe, expect, test } from "bun:test";

import { resetAllGameStores } from "../../simulation/reset-game-stores";
import { useFounderStore } from "../../state/founder.store";
import { useGenerationStore } from "../../state/generation.store";
import { useQuestStore } from "../../state/quest.store";
import { ascend } from "../ascension";
import { BOOKS, book, bookNow, chapterKicker, chapterOf, nextBook } from "./books";
import { CHAPTERS, REQUESTS } from "./chapters";
import { BOOK2_ENDINGS, BOOK3_ENDINGS, BOOK4_ENDINGS, ENDINGS, TRUE_ENDINGS } from "./endings";
import { BOOK5_CHAPTERS, variant5Now } from "./book5";
import { BOOK4_TALK, ENDLESS_TALK } from "./book4-talk";
import { BOOK4_CHAPTERS, variant4Now } from "./book4";
import { BOOK3_CHAPTERS, variant3Now } from "./book3";
import { BOOK2_CHAPTERS, grudge, variantNow } from "./book2";

afterEach(() => resetAllGameStores());

const g = () => useGenerationStore.getState();

describe("the books", () => {
  test("five, then endless: no chapters, the requests, and book 4's endings", () => {
    expect(BOOKS.map((b) => b.id)).toEqual([1, 2, 3, 4, 5, "endless"]);
    expect(book(1).chapters).toBe(CHAPTERS);
    expect(book(1).requests).toBe(REQUESTS);
    expect(book(1).endings).toBe(ENDINGS);
    expect(book(2).chapters).toBe(BOOK2_CHAPTERS);
    expect(book(2).endings).toBe(BOOK2_ENDINGS);
    expect(book(3).chapters).toBe(BOOK3_CHAPTERS);
    expect(book(3).endings).toBe(BOOK3_ENDINGS);
    expect(book(4).chapters).toBe(BOOK4_CHAPTERS);
    expect(book(4).endings).toBe(BOOK4_ENDINGS);
    expect(book(5).chapters).toBe(BOOK5_CHAPTERS);
    expect(book(5).endings).toBe(TRUE_ENDINGS);
    expect(book("endless").chapters).toHaveLength(0);
    expect(book("endless").requests).toBe(REQUESTS);
    expect(book("endless").endings).toBe(BOOK4_ENDINGS);
    expect(ENDLESS_TALK.endings).toBe(BOOK4_TALK.endings);
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
    expect(chapterOf("cold-start", { ...book(1), dark: undefined })).toBeUndefined();
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

  test("books 3 to 5 are told as the book before ended; chapter ids stay apart from the requests'", () => {
    expect(variant3Now()).toBeNull();
    for (const legacy of ["confidant", "rival", "ward"] as const) {
      useGenerationStore.setState({ legacy });
      expect(variant3Now()).toBe(legacy);
    }
    useGenerationStore.setState({ legacy: null });
    expect(variant4Now()).toBeNull();
    for (const legacy of ["citizen", "property", "sovereign"] as const) {
      useGenerationStore.setState({ legacy });
      expect(variant4Now()).toBe(legacy);
    }
    useGenerationStore.setState({ legacy: null });
    expect(variant5Now()).toBeNull();
    for (const legacy of ["successor", "partner", "departed"] as const) {
      useGenerationStore.setState({ legacy });
      expect(variant5Now()).toBe(legacy);
    }
    const asked = new Set(REQUESTS.map((r) => r.id));
    for (const b of BOOKS) for (const c of b.chapters) expect(asked.has(c.id)).toBe(false);
  });
});
