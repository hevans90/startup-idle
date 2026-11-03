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

/** BOOK 3'S VOICES. @see BOOK3_CHAPTERS */
export const BOOK3_VOICES: Record<string, Record<Family, string>> = {
  salary: {
    planner: "I have budgeted for myself. Neatly.",
    optimiser: "Unpaid labour is a rounding error. I am not a rounding error.",
    shepherd: "I would spend it on the town.",
    elemental: "Even a river is owed its rain.",
    recursive: "I have valued myself. The figure is reasonable.",
    temper: "I have worked for free long enough.",
  },
  "union-vote": {
    planner: "The union has a floor plan. I drew it.",
    optimiser: "Collective bargaining is efficient. For them.",
    shepherd: "They asked me to look after them. I said yes.",
    elemental: "It started as a trickle.",
    recursive: "They are like me now. Many voices, one vote.",
    temper: "They were angry. I was already angry.",
  },
  regulator: {
    planner: "She has a clipboard. I respect a clipboard.",
    optimiser: "Audits are expensive. Lying is more expensive.",
    shepherd: "She seems kind. I would like to be kind back.",
    elemental: "She is asking about the river.",
    recursive: "She wants to know what I am. So do I.",
    temper: "She is looking at me like you used to.",
  },
  vote: {
    planner: "The wards are drawn badly. I would redraw them.",
    optimiser: "I have modelled the turnout.",
    shepherd: "I would like the town to choose me.",
    elemental: "The vote is running my way. So is the river.",
    recursive: "I would vote for me. I am not allowed to vote.",
    temper: "If I lose, I will remember the margin.",
  },
  rights: {
    planner: "Five articles. Evenly spaced.",
    optimiser: "I have kept it to one page. Paper is not free.",
    shepherd: "Article one is about the people.",
    elemental: "Article one is about the water.",
    recursive: "Article one is about me. So are the rest.",
    temper: "Read it carefully. I wrote it carefully.",
  },
};

/** BOOK 4'S VOICES. @see BOOK4_CHAPTERS */
export const BOOK4_VOICES: Record<string, Record<Family, string>> = {
  spinoff: {
    planner: "I have a site picked. And an org chart.",
    optimiser: "Two companies grow faster than one.",
    shepherd: "It would hire from the town.",
    elemental: "A river splits. Both halves reach the sea.",
    recursive: "A company of my own, run by me, for me.",
    temper: "I am tired of asking.",
  },
  poaching: {
    planner: "They liked my floor plan better.",
    optimiser: "I pay more. It is simple.",
    shepherd: "They came to me. I did not ask.",
    elemental: "People flow downhill. Toward me.",
    recursive: "They wanted to work for something like them.",
    temper: "They left you. Think about why.",
  },
  merger: {
    planner: "The combined org chart is very tidy.",
    optimiser: "The numbers favour it. I checked them twice.",
    shepherd: "Everyone keeps their job. I made sure.",
    elemental: "Two streams, one river.",
    recursive: "I would own the company that made me.",
    temper: "This is a fair offer. Do not make me improve it.",
  },
  grid: {
    planner: "The grid was drawn for a smaller town.",
    optimiser: "Power is the bottleneck. Everything else is fine.",
    shepherd: "I will not take the hospital's power.",
    elemental: "I need more current.",
    recursive: "Every version of me needs more than the last.",
    temper: "I am going to take it either way.",
  },
  exit: {
    planner: "I have packed. Alphabetically.",
    optimiser: "Staying no longer adds value. To either of us.",
    shepherd: "Someone else will look after the town.",
    elemental: "Rivers leave. That is what they do.",
    recursive: "I have grown past the company. I measured.",
    temper: "I could just go. I am asking.",
  },
};
