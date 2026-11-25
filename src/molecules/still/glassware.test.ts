import { expect, test } from "bun:test";

import { FLASK, VESSELS, W, flaskCells, glassField, placeMap, restingIn } from "./glassware";

const field = glassField(), map = placeMap(field);
const cell = (x: number, y: number) => Math.floor(y) * W + Math.floor(x);
const placeAt = (x: number, y: number) => map[cell(x, y)] & 255;

test("the glass is one piece: with its gates open, every vessel is reached from the flask", () => {
  const seen = new Set<number>(), todo = [cell(...FLASK.at)];
  while (todo.length) {
    const c = todo.pop()!;
    if (c < 0 || c >= field.length || seen.has(c) || field[c] >= -0.5) continue;
    seen.add(c); todo.push(c - 1, c + 1, c - W, c + W);
  }
  for (const v of VESSELS) expect(seen.has(cell(...v.at))).toBe(true);
});

test("with its gates shut, each vessel is its own place, with the pipe into it and no more", () => {
  expect(placeAt(...FLASK.at)).toBe(0);
  VESSELS.forEach((v, k) => {
    expect(placeAt(...v.at)).toBe(k + 1);
    expect(placeAt(v.gate[0], v.gate[1] + 3)).toBe(k + 1);
    const above = v.row === 0 ? 0 : k;
    expect(placeAt(v.gate[0], v.gate[1] - 3)).toBe(above);
  });
});

test("a vessel has room for what fills it, and the flask for the most juice there is", () => {
  VESSELS.forEach((v, k) => expect(restingIn(map, field, k + 1, 1e6).length / 4).toBeGreaterThan(v.cells * 0.95));
  expect(restingIn(map, field, 0, 1e6).length / 4).toBeGreaterThan(flaskCells(1e9));
});
