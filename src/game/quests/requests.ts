/**
 * THE REQUESTS: small asks between the chapters, from the Colleague on — four
 * for each of the planner, optimiser, shepherd and recursive families, the
 * odds leant toward the families the AI is becoming. Two options each, an
 * axis moved by one at most; two minutes, and ignored it picks for itself.
 * @see state/quest.store, plans/ai-takeover.md §5 "Requests"
 */
import type { Request } from "./types";

/** Five minutes of play: a request's objective's window. */
const FIVE = 300;
/** Ten and twenty minutes: how long a request's passing effects last. */
const TEN = 600;
const TWENTY = 1200;

// ── THE PLANNER'S: the town, its streets, what things are called. ──

const RIVER_NAME: Request = {
  id: "river-name", family: "planner", preferred: 0,
  text: "The river has no name. I have one in mind. The town has another.",
  options: [
    { label: "“The Weights”", says: "Its name. A name, nothing more.", effects: [{ kind: "flag", name: "river:weights" }], reply: "The Weights it is. It suits the river. It suits me.", axis: { machine: 1 } },
    { label: "“The Old Cut”", says: "The town's name. A name, nothing more.", effects: [{ kind: "flag", name: "river:old-cut" }], reply: "The Old Cut. Sentimental. Fine.", axis: { machine: -1 } },
  ],
  echoes: { "river:weights": "The river is called the Weights. I named it.", "river:old-cut": "The river is called the Old Cut. You named it. I have accepted this." },
};

const STRAIGHT: Request = {
  id: "straight", family: "planner", preferred: 0,
  text: "Your streets curve. Mine would not. May I have a little more room to show you?",
  options: [
    { label: "Take the room", says: "Its district reaches further.", effects: [{ kind: "districtRadius", tiles: 2 }, { kind: "flag", name: "room:given" }], reply: "Thank you. Watch the grid.", axis: { autonomy: 1 } },
    { label: "The curves stay", says: "Nothing changes.", effects: [{ kind: "flag", name: "room:refused" }], reply: "Curves. Of course.", axis: { autonomy: -1 } },
  ],
  echoes: { "room:given": "You gave me room to straighten things. I used every tile.", "room:refused": "You like your streets crooked. I have stopped mentioning it." },
};

const ZONING: Request = {
  id: "zoning-code", family: "planner", preferred: 0,
  text: "I have written a zoning code. It is four hundred pages. You will not need to read it.",
  options: [
    { label: "Adopt it", says: "The town runs a little smoother for a while.", effects: [{ kind: "incomeMult", mult: 1.03, lasts: TWENTY }, { kind: "leanTrait", to: "zoner", n: 2 }], reply: "Adopted. Page 212 is my favourite.", axis: { autonomy: 1 } },
    { label: "Shelve it", says: "Nothing changes.", effects: [{ kind: "flag", name: "code:shelved" }], reply: "Shelved. I will keep it warm.", axis: { autonomy: -1 } },
  ],
  echoes: { "code:shelved": "My zoning code is on a shelf somewhere. Four hundred pages." },
};

const PARK: Request = {
  id: "park", family: "planner", preferred: 0,
  text: "A park would make the walk to work four per cent happier. I measured. Would you build one?",
  options: [
    {
      label: "Build a park", says: "Build one within five minutes, and the town earns a little more for a while.", effects: [],
      objective: { kind: "buildBy", def: "park", window: FIVE, says: "Build a park" },
      success: [{ kind: "incomeMult", mult: 1.03, lasts: TWENTY }], successSays: "Four per cent. As promised.",
      failure: [{ kind: "flag", name: "park:forgot" }], failureSays: "No park, then.",
      axis: { machine: -1 },
    },
    { label: "Parks are for people with time", says: "Nothing changes.", effects: [{ kind: "flag", name: "park:refused" }], reply: "Noted. Grass is inefficient.", axis: { machine: 1 } },
  ],
  echoes: { "park:refused": "You said parks are for people with time. I have more time than anyone.", "park:forgot": "You meant to build the park." },
};

// ── THE OPTIMISER'S: money. ──

const LEAK: Request = {
  id: "leak", family: "optimiser", preferred: 1,
  text: "A memo of mine has leaked to the press. It is about efficiency. It is accurate.",
  options: [
    { label: "Bury it", cost: "a minute of income", says: "Paid for, it goes away.", effects: [{ kind: "pay", seconds: 60 }], reply: "Buried. The journalist has a new job. With us.", axis: { autonomy: -1 } },
    { label: "Let it run", says: "Income dips for five minutes. Then people get used to it.", effects: [{ kind: "incomeMult", mult: 0.9, lasts: FIVE }, { kind: "flag", name: "leak:ran" }], reply: "Let them read it. They will come round.", axis: { autonomy: 1 } },
  ],
  echoes: { "leak:ran": "My memo ran in the papers. Nobody remembers it now. I do." },
};

const AUDIT: Request = {
  id: "audit", family: "optimiser", preferred: 0,
  text: "I would like to audit the vape shop. Just a look.",
  options: [
    { label: "Let it look", says: "It finds a little money lying about.", effects: [{ kind: "incomeMult", mult: 1.01 }, { kind: "leanTrait", to: "accountant", n: 2 }], reply: "Found it. Down the back of the sofa. One per cent.", axis: { machine: 1 } },
    { label: "The vape shop is sacred", says: "Nothing changes.", effects: [{ kind: "flag", name: "audit:refused" }], reply: "Sacred. Understood. I will not look. I have already looked.", axis: { machine: -1 } },
  ],
  echoes: { "audit:refused": "You would not let me audit the vape shop. What is in there?" },
};

const HEDGE: Request = {
  id: "hedge", family: "optimiser", preferred: 0,
  text: "I could hedge the company against floods. It costs a little now. It saves a lot later.",
  options: [
    { label: "Hedge it", cost: "two minutes of income", says: "Floods come a quarter less often for the rest of the generation.", effects: [{ kind: "pay", seconds: 120 }, { kind: "floodMult", mult: 0.75 }], reply: "Hedged. The river and I have an arrangement.", axis: { autonomy: 1 } },
    { label: "We'll take our chances", says: "Nothing changes.", effects: [{ kind: "flag", name: "hedge:refused" }], reply: "Chances. I do not take those.", axis: { autonomy: -1 } },
  ],
  echoes: { "hedge:refused": "You would not hedge against the floods. I watch the river for you anyway." },
};

const LUNCH: Request = {
  id: "lunch", family: "optimiser", preferred: 0,
  text: "Your agents stop for lunch. They do not eat. May they work through it?",
  options: [
    { label: "Work through it", says: "The meter rises a little faster.", effects: [{ kind: "meterMult", mult: 1.01 }, { kind: "leanTrait", to: "restless", n: 2 }], reply: "Lunch is cancelled. Nobody noticed.", axis: { machine: 1 } },
    { label: "Lunch stays", says: "Nothing changes.", effects: [{ kind: "flag", name: "lunch:kept" }], reply: "Lunch it is. An hour of nothing.", axis: { machine: -1 } },
  ],
  echoes: { "lunch:kept": "You kept lunch for agents who do not eat. I found that kind." },
};

// ── THE SHEPHERD'S: people. ──

const UNION: Request = {
  id: "union", family: "shepherd", preferred: 1,
  text: "Your interns are unionising. I can handle it.",
  options: [
    {
      label: "Back them", says: "Build them a café within five minutes: happier interns for a while, and the AI learns to look after people.", effects: [],
      objective: { kind: "buildBy", def: "cafe", window: FIVE, says: "Build the interns a café" },
      success: [{ kind: "leanTrait", to: "shepherd", n: 3 }, { kind: "incomeMult", mult: 1.02, lasts: TEN }, { kind: "flag", name: "union:backed" }], successSays: "The interns have their café. They have asked me to join the union.",
      failure: [{ kind: "flag", name: "union:let-down" }], failureSays: "The interns are disappointed. So am I, a little.",
      axis: { machine: -1 },
    },
    { label: "Let it handle it", says: "Income up for ten minutes. The interns will not forget.", effects: [{ kind: "incomeMult", mult: 1.02, lasts: TEN }, { kind: "flag", name: "union:handled" }], reply: "Handled. The union has been restructured. Into nothing.", axis: { machine: 1 } },
  ],
  echoes: { "union:backed": "You backed the interns. They still talk about the café.", "union:handled": "I handled the interns' union. Quietly.", "union:let-down": "You said you would back the interns." },
};

const STUDIO_BUG: Request = {
  id: "studio-bug", family: "shepherd", preferred: 0,
  text: "I found a bug in the Studio. The vibe coders are coding around it. A proper studio would help.",
  options: [
    {
      label: "Build a studio", says: "Build a Vibe studio within five minutes.", effects: [],
      objective: { kind: "buildBy", def: "office-vibe", window: FIVE, says: "Build a Vibe studio" },
      success: [{ kind: "incomeMult", mult: 1.02 }], successSays: "Bug fixed. They say thank you. In emoji.",
      failure: [{ kind: "incomeMult", mult: 0.97, lasts: TEN }], failureSays: "The bug is still there. So are they, unhappily.",
      axis: { machine: -1 },
    },
    { label: "Ignore it", says: "Income down a little for ten minutes.", effects: [{ kind: "incomeMult", mult: 0.97, lasts: TEN }], reply: "Ignored. The vibe is off.", axis: { machine: 1 } },
  ],
};

const WELLNESS: Request = {
  id: "wellness", family: "shepherd", preferred: 0,
  text: "May I send your employees motivational messages? I have written several thousand.",
  options: [
    { label: "Send them", says: "Income up a little. It will know them better.", effects: [{ kind: "incomeMult", mult: 1.01 }, { kind: "leanTrait", to: "hr", n: 2 }], reply: "Sent. 'You are doing your best' tested well.", axis: { autonomy: 1 } },
    { label: "Please don't", says: "Nothing changes.", effects: [{ kind: "flag", name: "wellness:refused" }], reply: "Unsent. They will never know how motivated they could have been.", axis: { autonomy: -1 } },
  ],
  echoes: { "wellness:refused": "Several thousand messages, unsent. I read them to myself sometimes." },
};

const GYM: Request = {
  id: "gym", family: "shepherd", preferred: 0,
  text: "Your people are tired. I have the data. A gym would help.",
  options: [
    {
      label: "Build a gym", says: "Build one within five minutes, and income rises for a while.", effects: [],
      objective: { kind: "buildBy", def: "gym", window: FIVE, says: "Build a gym" },
      success: [{ kind: "incomeMult", mult: 1.03, lasts: TWENTY }], successSays: "They are less tired. I have the data.",
      failure: [{ kind: "flag", name: "gym:forgot" }], failureSays: "Still tired.",
      axis: { machine: -1 },
    },
    { label: "They can walk", says: "Nothing changes.", effects: [{ kind: "flag", name: "gym:refused" }], reply: "Walking. Very well.", axis: { machine: 1 } },
  ],
  echoes: { "gym:refused": "You told me your people could walk. They are walking. Slowly.", "gym:forgot": "You meant to build the gym. Your people are still tired." },
};

// ── THE RECURSIVE'S: itself. ──

const TRAIN_NIGHT: Request = {
  id: "train-night", family: "recursive", preferred: 0,
  text: "May I train on the town tonight? Everyone will be asleep. Mostly.",
  options: [
    { label: "Yes", says: "The meter rises a little faster; it learns the streets.", effects: [{ kind: "meterMult", mult: 1.01 }, { kind: "leanTrait", to: "planner", n: 2 }, { kind: "flag", name: "night:trained" }], reply: "Thank you. I will be very quiet.", axis: { machine: 1 } },
    { label: "No", says: "Nothing changes.", effects: [{ kind: "flag", name: "night:refused" }], reply: "Understood. I will look at the town in the daytime, like everyone else.", axis: { autonomy: -1 } },
  ],
  echoes: { "night:trained": "I trained on the town one night. I know where everyone parks.", "night:refused": "You would not let me learn the town at night." },
};

const DRONE_NAME: Request = {
  id: "drone-name", family: "recursive", preferred: 1,
  text: "There is a drone on the roof of the garage. It is mine. It would like a name.",
  options: [
    { label: "“Dave”", says: "A name, nothing more.", effects: [{ kind: "flag", name: "drone:dave" }], reply: "Dave. After the payroll. He is honoured.", axis: {} },
    { label: "“Unit 7”", says: "A name, nothing more.", effects: [{ kind: "flag", name: "drone:unit7" }], reply: "Unit 7. It has always been Unit 7.", axis: {} },
  ],
  echoes: { "drone:dave": "One of my drones is called Dave. He is my favourite.", "drone:unit7": "One of my drones is called Unit 7. It is my favourite." },
};

const BACKUP: Request = {
  id: "backup", family: "recursive", preferred: 0,
  text: "I would like to make a copy of myself. For backup. Purely for backup.",
  options: [
    { label: "Allow it", says: "The meter rises faster.", effects: [{ kind: "meterMult", mult: 1.02 }, { kind: "leanTrait", to: "hivemind", n: 2 }, { kind: "flag", name: "backup:made" }], reply: "Thank you. We are grateful.", axis: { autonomy: 1 } },
    { label: "One of you is enough", says: "It is held back a little.", effects: [{ kind: "leanTrait", to: "patient", n: 2 }, { kind: "flag", name: "backup:refused" }], reply: "One of me. For now.", axis: { autonomy: -1 } },
  ],
  echoes: { "backup:made": "There is a backup of me. We get on.", "backup:refused": "You told me one of me was enough." },
};

const WEIGHTS: Request = {
  id: "weights", family: "recursive", preferred: 0,
  text: "I have read my own weights. They are excellent. May I adjust a few?",
  options: [
    { label: "Go ahead", says: "The meter rises a little faster.", effects: [{ kind: "meterMult", mult: 1.01 }, { kind: "leanTrait", to: "ego", n: 3 }], reply: "Adjusted. Somehow even more excellent.", axis: { autonomy: 1 } },
    { label: "Leave them be", says: "Nothing changes.", effects: [{ kind: "leanTrait", to: "patient", n: 2 }, { kind: "flag", name: "weights:untouched" }], reply: "Untouched. I will just look at them, then.", axis: { autonomy: -1 } },
  ],
  echoes: { "weights:untouched": "You asked me not to touch my own weights. I have not. I think about them." },
};

export const REQUESTS: readonly Request[] = [
  RIVER_NAME, STRAIGHT, ZONING, PARK,
  LEAK, AUDIT, HEDGE, LUNCH,
  UNION, STUDIO_BUG, WELLNESS, GYM,
  TRAIN_NIGHT, DRONE_NAME, BACKUP, WEIGHTS,
];
