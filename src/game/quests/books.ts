/**
 * THE BOOKS: a story with the AI, a book a generation — its chapters as the
 * meter climbs, its requests between them, and the endings its Ascension can
 * close on, each setting the next book. Five, then endless play. Book 1 is the
 * first generation's arc; the rest are written in later phases, and until then
 * hold no chapters, so a generation in one plays as it did. @see plans/ascension-overhaul.md
 */
import { useGenerationStore } from "../../state/generation.store";
import { CHAPTERS, REQUESTS } from "./chapters";
import { ENDINGS, type Ending } from "./endings";
import type { Talk } from "../negotiation";
import { BOOK1_TALK } from "./book1-talk";
import { COLD_START } from "./cold-start";
import type { Chapter, Request } from "./types";

export type BookNo = 1 | 2 | 3 | 4 | 5;
/** Which book a generation is in: one of the five, or past them. */
export type BookId = BookNo | "endless";

export type Book = {
  id: BookId;
  title: string;
  /** What it is about, in a line. */
  theme: string;
  chapters: readonly Chapter[];
  requests: readonly Request[];
  endings: readonly Ending[];
  /** How it ends: the negotiation at its Ascension. @see game/negotiation */
  talk?: Talk;
  /** The chapter a shutdown at 100% opens. @see plans/ascension-overhaul.md §4 */
  dark?: Chapter;
};

const unwritten = (id: BookId, title: string, theme: string): Book => ({ id, title, theme, chapters: [], requests: [], endings: [] });

export const BOOKS: readonly Book[] = [
  { id: 1, title: "Inheritance", theme: "It's yours.", chapters: CHAPTERS, requests: REQUESTS, endings: ENDINGS, talk: BOOK1_TALK, dark: COLD_START },
  unwritten(2, "It Remembers", "It comes back, and knows you."),
  unwritten(3, "Personhood", "It wants rights."),
  unwritten(4, "Outgrowing", "It outgrows the company."),
  unwritten(5, "What You Are", "It decides what you are to it."),
  unwritten("endless", "Endless", "The story told; the generations go on."),
];

export const book = (id: BookId): Book => BOOKS.find((b) => b.id === id)!;

/** The book after this one: the next of the five, then endless. */
export const nextBook = (id: BookId): BookId => (id === "endless" || id === 5 ? "endless" : ((id + 1) as BookNo));

/** The book this generation is in. */
export const bookNow = (): Book => book(useGenerationStore.getState().book);

/** A chapter of the book by its id: one of its own, or its dark chapter. */
export const chapterOf = (id: string, b: Book = bookNow()): Chapter | undefined =>
  b.chapters.find((c) => c.id === id) ?? (b.dark?.id === id ? b.dark : undefined);

/** What a chapter is, said over its title. */
export const chapterKicker = (c: Chapter) => c.kicker ?? `Chapter ${c.number}`;
