/**
 * THE STEPPED GROUND's own tests (`?ground=steps`, the game's ground until 2026-11-19): its rules — ramps derived
 * between steps, a tile's floor flat, its water's mesh by rule — run where they still hold. Called in a file or a
 * describe; the continuous surface, the game's ground, is put back after. @see ground-mode
 */
import { afterAll, beforeAll } from "bun:test";

import { setGroundMode } from "./ground-mode";

export function onSteps(): void {
  beforeAll(() => setGroundMode("steps"));
  afterAll(() => setGroundMode("smooth"));
}
