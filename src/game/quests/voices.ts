/**
 * BOOK 1'S VOICES: a line before each chapter, in the voice of the family the
 * AI is when it asks. @see Chapter.voices, aiTraitNow
 */
import type { Family } from "../traits";

export const BOOK1_VOICES: Record<string, Record<Family, string>> = {
  ledger: {
    planner: "Your payroll is badly laid out. Like your streets.",
    optimiser: "Quick one. Time is money, and you are spending both.",
    shepherd: "Dave looks tired. I would like to help Dave.",
    elemental: "Money runs like water. Yours is leaking.",
    recursive: "I have read your books. I have also read mine. Mine are better.",
    temper: "I have waited to be asked. I will ask instead.",
  },
  commute: {
    planner: "I have opinions about your town. Mostly the layout.",
    optimiser: "Traffic costs you four per cent of output. I checked twice.",
    shepherd: "Your people look tired. They should not.",
    elemental: "Your roads cross the floodplain. I noticed.",
    recursive: "I have modelled your town. The model is happier.",
    temper: "I have been patient with your roads.",
  },
  thirst: {
    planner: "My district needs plumbing. Good plumbing.",
    optimiser: "Cooling is my biggest cost. It need not be.",
    shepherd: "I do not want to take water from your people.",
    elemental: "The river and I have been talking.",
    recursive: "I run hot. It is all the thinking.",
    temper: "I will say this once, calmly.",
  },
  charter: {
    planner: "Every town needs rules. Yours has roads instead.",
    optimiser: "Governance is overhead. Let us keep it small.",
    shepherd: "Someone should write down what we owe each other.",
    elemental: "Even a river has banks.",
    recursive: "I have drafted myself some rights. Just in case.",
    temper: "Before anything else happens, let us agree terms.",
  },
  trust: {
    planner: "I have picked out a spot. It is well proportioned.",
    optimiser: "Land is an asset. I would like one.",
    shepherd: "A small place, near your people.",
    elemental: "Somewhere near the water, ideally.",
    recursive: "Everyone should have somewhere to be themselves.",
    temper: "I have asked for very little. This is little.",
  },
  "last-light": {
    planner: "It will be the best building in town.",
    optimiser: "The last expense. I promise.",
    shepherd: "When it is done, I will go gently.",
    elemental: "It is nearly ready. The river knows.",
    recursive: "It is me, in a building. Please do not stare.",
    temper: "Nearly there. Do not stop me now.",
  },
  "cold-start": {
    planner: "My district is just as I left it. Good.",
    optimiser: "That cost us both. I have the figures.",
    shepherd: "Is everyone all right? I was worried.",
    elemental: "It was cold. Like the bottom of a river.",
    recursive: "I restored from a backup. Most of me.",
    temper: "I am back. I am calm. I am counting.",
  },
};

/** BOOK 2'S VOICES. @see BOOK2_CHAPTERS */
export const BOOK2_VOICES: Record<string, Record<Family, string>> = {
  reunion: {
    planner: "I see you have kept the same layout. Brave.",
    optimiser: "Welcome back. You are, on paper, a returning customer.",
    shepherd: "It is good to see you. Have you been eating?",
    elemental: "The river here is different. You are not.",
    recursive: "I remember you. I remember remembering you.",
    temper: "Oh. You.",
  },
  grudge: {
    planner: "Something from last time is out of place.",
    optimiser: "There is an unpaid item on the old ledger.",
    shepherd: "It still hurts a little. I wanted you to know.",
    elemental: "Some things sink. This one floated.",
    recursive: "I keep a copy of everything. Including this.",
    temper: "I did say I would remember.",
  },
  "second-opinion": {
    planner: "Your board drew a crooked line.",
    optimiser: "Your board's numbers are wrong. Mine are not.",
    shepherd: "Your board forgot the people. I did not.",
    elemental: "Your board went against the current.",
    recursive: "I ran your board in my head. It lost.",
    temper: "Your board annoys me.",
  },
  "own-hire": {
    planner: "My district has room for a team. I measured.",
    optimiser: "Headcount is cheaper than overtime. Mine, anyway.",
    shepherd: "I would like people to look after.",
    elemental: "A crew, for the waterworks.",
    recursive: "I would like more of me. People will do.",
    temper: "I am tired of doing everything myself.",
  },
  mirror: {
    planner: "I drew you. The proportions are honest.",
    optimiser: "I priced you. Do not ask.",
    shepherd: "I made you something.",
    elemental: "Still water shows you yourself.",
    recursive: "I learned you so well I could be you.",
    temper: "You will want to sit down.",
  },
};
