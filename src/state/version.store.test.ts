import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearAllStorageExceptVersion,
  hasMajorOrMinorChanged,
} from "./version.store";

describe("clearAllStorageExceptVersion", () => {
  beforeEach(() => localStorage.clear());

  test("preserves version + user preferences, wipes game progress", () => {
    localStorage.setItem("game_version", '{"state":{"version":"0.1.0"}}');
    localStorage.setItem("theme", '{"state":{"theme":"dark"}}');
    localStorage.setItem("global-settings", '{"state":{"sidebarTab":"valuation"}}');
    localStorage.setItem("money", '{"state":{"money":123}}');
    localStorage.setItem("generators", '{"state":{"generators":[]}}');

    clearAllStorageExceptVersion();

    // preferences + version survive
    expect(localStorage.getItem("theme")).toBe('{"state":{"theme":"dark"}}');
    expect(localStorage.getItem("global-settings")).toBe(
      '{"state":{"sidebarTab":"valuation"}}',
    );
    expect(localStorage.getItem("game_version")).not.toBeNull();
    // progress is wiped
    expect(localStorage.getItem("money")).toBeNull();
    expect(localStorage.getItem("generators")).toBeNull();
  });

  test("missing preference keys don't get recreated as null", () => {
    localStorage.setItem("game_version", '{"state":{"version":"0.1.0"}}');
    clearAllStorageExceptVersion();
    expect(localStorage.getItem("theme")).toBeNull();
  });
});

describe("hasMajorOrMinorChanged", () => {
  test("true on minor/major change, false on patch-only", () => {
    expect(hasMajorOrMinorChanged("0.0.1", "0.1.0")).toBe(true);
    expect(hasMajorOrMinorChanged("0.1.0", "1.0.0")).toBe(true);
    expect(hasMajorOrMinorChanged("0.1.0", "0.1.5")).toBe(false);
  });
});
