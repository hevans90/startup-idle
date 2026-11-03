/**
 * World v2 — WHAT THE TOWN'S SHOPS ARE CALLED: a pool of names a service,
 * one picked by the building it is in, so a shop keeps its name through a
 * save and a reload, and two bars on one street are two bars.
 */
import type { ServiceId } from "./needs";

export const SHOP_NAMES: Record<ServiceId, readonly string[]> = {
  takeaway: ["Byte-Sized Bites", "Ctrl+Alt+Delivery", "The Lazy Loader", "Wok & Rollback", "Null Pointer Noodles", "Fork & Spoon"],
  bakery: ["Byte Me Bakery", "Rolling Release", "Proof of Work", "Bread & Breakpoint", "The Sourdough Stack", "Cookie Consent"],
  bar: ["The Merge Conflict", "Root Access", "Happy Hour Hotfix", "The Rubber Duck", "Pull Request & Pint", "Tab & Spaces"],
  club: ["Club 404", "The Kernel Panic", "Rave Condition", "Bass Case", "Deep Learning", "The Mainframe"],
  arcade: ["Pixel Pushers", "Loot Box", "Respawn Point", "Insert Coin Op", "Speedrun Alley", "Hi-Score Hub"],
  cafe: ["Brew Request", "Espresso Yourself", "Latte Binding", "The Daily Grind", "Cold Start Coffee", "Async Espresso"],
  kombucha: ["Kubernetea", "Ferment Engine", "Bubble Valuation", "Fizz Buzz", "The Culture Fit", "Gut Feeling"],
  coworking: ["HotDesk Hive", "WeHustle", "The Standup", "Synergy Loft", "Open Plan B", "Desk Debt"],
  vape: ["Cloud Native", "Vaporware", "Big Cloud Energy", "Puff Request", "Mist Opportunity", "Cloud Compute"],
  cinema: ["The Big Screen Share", "Reel-Time Pictures", "Picture-in-Picture", "The Render Farm", "Frame Rate", "Popcorn Pipeline"],
  pharmacy: ["Patch Notes Pharmacy", "Hotfix Chemist", "Side Effects Ltd", "The Remedy Branch", "Pill Request", "Rx Refactor"],
  doctor: ["Dr. Patch, GP", "The Health Check", "Uptime Clinic", "Debug Medical", "Dr. Ping, GP", "Wellness Endpoint"],
  dentist: ["Root Canal Access", "Floss Tolerance", "Byte Right Dental", "The Tooth Commit", "Molar Monorepo", "Crown Jobs"],
  gym: ["Gains Driven Dev", "Iron Stack", "Full Stack Fitness", "Lift & Shift", "Push Pull Request", "Burn Rate Gym"],
  climbing: ["Belay Loader", "The Crux Branch", "Top Rope Down", "Boulder Valuation", "Ascend Ops", "Chalk Dust"],
  park: ["Greenfield Commons", "Sandbox Park", "The Idle Gardens", "Uptime Green", "Whitespace Park", "Fallow Field"],
};

/** A building's shop's name: from its service's pool, by the building's id. */
export function shopName(sv: ServiceId, seed: number): string {
  const pool = SHOP_NAMES[sv];
  // Scrambled, so neighbouring ids do not walk the pool in order.
  const h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  return pool[((h ^ (h >>> 13)) >>> 0) % pool.length];
}
