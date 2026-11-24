import { expect, test } from "bun:test";

import { FIXTURE_IDS } from "./fixtures";
import { FIXTURES, fixtureAddress } from "./fixture-list";

test("the tool bar lists every fixture, once", () => {
  expect(Object.values(FIXTURES).flat().map(([id]) => id).sort()).toEqual([...FIXTURE_IDS].sort());
});

test("a fixture's address keeps the other flags, and the map's own has none", () => {
  const at = fixtureAddress("http://x/?world=1&nosave&fixture=lake", "bigtown");
  expect(new URL(at).searchParams.get("fixture")).toBe("bigtown");
  expect(new URL(at).searchParams.has("nosave")).toBe(true);
  expect(new URL(fixtureAddress(at, null)).searchParams.has("fixture")).toBe(false);
});
