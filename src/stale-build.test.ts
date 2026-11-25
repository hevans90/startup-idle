import { describe, expect, test } from "bun:test";
import { entryOf, newerBuild } from "./stale-build";

const page = (src: string) => `<html><head><script>var a = 1;</script><link rel="modulepreload" href="/assets/x.js">
  <script type="module" crossorigin src="${src}"></script></head></html>`;

describe("a tab open across a deploy", () => {
  test("is told by the entry script the site's page names now", () => {
    expect(entryOf(page("/assets/index-A.js"))).toBe("/assets/index-A.js");
    expect(newerBuild(page("/assets/index-B.js"), "/assets/index-A.js")).toBe(true);
    expect(newerBuild(page("/assets/index-A.js"), "/assets/index-A.js")).toBe(false);
  });
  test("and is left be where the site answers with no page of the game", () => {
    expect(newerBuild("<html>You are offline</html>", "/assets/index-A.js")).toBe(false);
    expect(newerBuild(page("/assets/index-B.js"), null)).toBe(false);
  });
});
