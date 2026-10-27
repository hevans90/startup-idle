/**
 * LEADERS' NAMES: the pool each kind's candidates are drawn from. What a
 * leader is and does is in game/leaders. @see makeCandidates
 */
import type { GeneratorId } from "../state/generators.store";

const INTERN_NAMES = [
  "Tyler",
  "Madison",
  "Aiden",
  "Jordan",
  "Emma",
  "Jayden",
  "Lily",
  "Noah",
  "Chloe",
  "Liam",
  "Ava",
  "Ethan",
  "Sophia",
  "Mason",
  "Olivia",
  "Logan",
] as const;

const VIBE_NAMES = [
  "Zephyr",
  "Phoenix",
  "Sage",
  "River",
  "Ocean",
  "Blaze",
  "Storm",
  "Pixel",
  "Flux",
  "Neo",
  "Axiom",
  "Riff",
  "Spark",
  "Drift",
  "Echo",
  "Coda",
] as const;

const DEV_NAMES = [
  "Lars",
  "Dmitri",
  "Kenji",
  "Rajesh",
  "Friedrich",
  "Mikael",
  "Takeshi",
  "Björn",
  "Andrei",
  "Sven",
  "Magnus",
  "Priya",
  "Kai",
  "Yuki",
  "Elan",
] as const;

export function getNamePool(role: GeneratorId): readonly string[] {
  if (role === "intern") return INTERN_NAMES;
  if (role === "vibe_coder") return VIBE_NAMES;
  return DEV_NAMES;
}
