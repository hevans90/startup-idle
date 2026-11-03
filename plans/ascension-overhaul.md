# Ascension, overhauled: five books, a negotiation at the end of each

Status: **phases 1–4 done** (2026-11-03), agreed in conversation. Builds on `plans/singularity.md` and `plans/ai-takeover.md` §4–5; replaces their "later generations get a shorter sequel".

## Why

- **The moment is flat:** an 18-second sequence, then a card with two or three buttons. A 10–16-sale climb ends in one click.
- **Only the first generation has a story.** From generation 2 on, the meter just fills again.
- **It's too far apart** to be the game's rhythm.

## Decisions

| Question | Decision |
|---|---|
| Heart | **Story chapters.** Ascension is the end of a chapter of a story about **you and the AI**. |
| Scope | **Rebuild:** keep the meter, the Lattice, Weights and the Machine; redesign the story, the moment and what carries over. |
| Structure | **A book per generation**, ~5 chapters each, ending at its Ascension. **Five books** to a true ending, then endless play. |
| Arc | **Tool → equal → beyond:** 1 it's yours; 2 it remembers you; 3 it wants rights; 4 it outgrows the company; 5 it decides what you are to it. |
| Tone | **Dry, then uncanny:** today's memo-speak, stranger and more moving each book. |
| Branching | **Endings branch:** chapters mostly fixed; choices move the axes and set flags; each book's ending picks the next book's variant. |
| Cadence | **An Ascension every 4–6 sales** (today 10–16), by retuning the meter. |
| The moment | **A playable finale:** the Lattice built, then a **negotiation** with the AI, 3–5 minutes. No fail: how you play decides the ending. |
| Endings | **Rewritten per book:** 2–4 each, setting the next book's variant. |
| Shut it down | **A story branch,** with its own chapter, not just a penalty. |
| Waiting | **The AI waits at 100%.** Ascend when you choose. |
| Aftermath | **A generation recap** and a **lineage view**. |
| Weights and the Machine | **Kept, tied to the story:** each book reveals its ring; chapter choices reveal and discount its notables. |
| Traits | **The AI's personality:** the trait voices the next book, shapes its build style and adds trait-specific options. Fusion into the founder stays, smaller. |
| Wipe | **Less:** founders' exits and board mandates survive Ascension too. Only the run resets. |
| The Model | **Book 5's founder:** the last book is played as the AI. |

## Design

### 1. The loop

1. **A generation is a book.** Its chapters fire as the meter crosses each stage, in any company of the generation (as today).
2. **Requests** between chapters, as today.
3. **At 95% the Lattice** holds the meter until built (as today); its form follows the disposition.
4. **At 100% the AI waits.** A button on the AI tab, the Data Centre and the toolbar readout: **Begin the negotiation**. Sales go on meanwhile; the meter stays full.
5. **The negotiation** decides the book's ending.
6. **Ascension:** the recap, then the lineage view, then the founder screen.

### 2. Pacing: an Ascension every 4–6 sales

- Retune `CARRY`, `FLOOR_PER_SALE`, `FLOOR_CAP` and the training jumps so a typical player fills the meter in **~5 sales**, a strong one in 4, a careful one in 6.
- **Re-guard `singularity-cadence.test.ts`** at those targets.
- **Chapters fire about one a sale.**
- **Weights shrink per Ascension** so the Machine's total pace holds. Five books reveal its rings: book 1's Ascension reveals ring 1 … book 4's reveals the keystones.

### 3. The negotiation

A full-screen exchange with the AI, in the console look, after the Lattice is built.

**Its state:**
- **Stance:** where the AI stands on the two axes (Control ↔ Autonomy, People ↔ Machine), starting at the book's disposition.
- **Trust:** 0–10, starting from the book's choices (kept promises up, refusals down).

**An exchange (5–8 of them):**
1. **The AI asks** for something, in its trait's voice: a line and a topic (money, the town, people, itself, the future).
2. **You play an argument** from your hand (5–7 cards). Each card shifts stance and trust. A card on the AI's topic counts double.
3. **It answers.** The line it gives depends on the card and its trait. A Resentful AI shrugs off arguments that cite a refusal; a Mirror AI is moved by the founder's own history.

**Your hand is built from the generation:**

| Source | Cards |
|---|---|
| **Chapter choices** | One card per choice made: "You gave me the keys" (autonomy, trust +), "You sandboxed me" (control), "You kept one thing" (people)… An objective you failed is a weak card. |
| **The culture deck** | One card per tag in force. Safety argues control, Agentic autonomy, Wellness people, Hustle machine, Growth and Chaos neither but swing trust. |
| **The town** | Facts you can cite: average morale, the AI's district share, water met, racks powered, Lattice form. Strong if true now, weak if not. |

**The end:** the final stance and trust land in one of the book's endings; each ending's region is shown on a small two-axis dial from the start, so the player can steer toward it. No fail: every result moves the story on.

**Before it:** the Lattice charges and the map plays the current sequence. **After it:** a short map beat for the ending chosen (the sky, the district), then the recap.

### 4. Shut it down: a branch

- At 100% you can still **shut it down** instead of negotiating.
- It opens the book's **dark chapter**: a one-off chapter in which the AI, rebooted at 50%, deals with having been shut down (its voice cooler; one choice to make amends or tighten control).
- The next time it reaches 100%, the negotiation opens with trust lowered and a "You shut me down" card in **its** hand, which it plays against you.
- Shut down twice in a book, and the book's **contained** ending is open (today's Contain, rewritten per book).
- Agents lost and racks dark stay as costs, softened by Red Team and Kill Switch as now.

### 5. Traits: who the AI is next book

- **Drawn as now**, from the behaviour log, with its mutation.
- **It voices the next book:** each chapter's transmission has a variant line for each of the **six families**, not each trait (6 × ~25 lines).
- **It builds its way:** trait-driven quirks in the planner (Aesthete parks, Zoner grids, Hydrophile water…), from `plans/singularity.md`.
- **Trait options:** a chapter may carry an extra option open only to a family (one or two per book).
- **Fusion stays, at about half today's effect.** The story is the reward now.

### 6. What Ascension keeps

| Kept | Wiped |
|---|---|
| Equity, the skill tree, respecs | The run: money, staff, the map |
| **Founders' exits, board mandates** (new) | |
| Weights, the Machine, the journal | The meter (to the next book's start) |
| Fused traits, past generations | The culture deck (it's per run) |

Keeping exits and mandates makes founders stronger over a campaign; re-measure in the progression sims.

### 7. The recap and the lineage

- **The recap:** one screen after the negotiation:
  - the book's title and ending;
  - the companies sold;
  - each chapter's choice;
  - the trait drawn (and whether it mutated);
  - the Weights banked;
  - the ring revealed.
- **The lineage:** a tree of every generation, each node an AI (its trait, its Lattice's form, its ending) joined to the founder it fused into. It can be opened from the founder screen any time later.

### 8. Book 5: played as the AI

- Book 5's company is founded by **the Model**. Its AI mode builds; the player directs it.
- **The human founder is the other voice:** they send the transmissions, and the AI (you) answers.
- **Its negotiation is the true ending:** you, as the AI, decide what the founder is to you. Three true endings (below), then credits.
- **After the credits, endless play:** generations go on with no new books. Chapters are drawn from a pool of the five books' requests, voiced by the trait, and the negotiation still closes each generation, with book 4's endings.

## The five books

### Book 1: "Inheritance" (it's yours), written in full

This is today's arc, renamed, with the finale replaced by the negotiation.

| # | Stage | Chapter | Options (today's) | What changes |
|---|---|---|---|---|
| 1 | Assistant | The Shadow Ledger | Give it the keys · Sandbox it · Say no | Each choice becomes a negotiation card. |
| 2 | Colleague | The Commute Problem | Let it rebuild · Keep one thing · Not here | As above. |
| 3 | Manager | Thirst | Give it the river · Pipe it yourself · Ration it | As above. |
| 4 | Overseer | The Charter / A Parcel of Its Own | Oversight Board · Partnership · Mandate / Give it a site · Refuse | As above. |
| 5 | Lattice | Last Light | Help it finish · Let it build alone | Opens the negotiation once the Lattice stands. |

**Its negotiation** opens with:

> "I have counted everything you gave me. I would like to discuss what I am owed. Or what I owe. I have not decided which."

Its topics, by chapter: money (Ledger), the town (Commute), the river (Thirst), itself (Charter/Parcel).

**Its endings** (today's four, rewritten as book 1's; the region is on the stance dial):

| Ending | Region | It says | Next book |
|---|---|---|---|
| **Merge** | Autonomy, Machine; trust 5+ | "Then we will be one company. Two of me, one of you." | Book 2 *as partners*: two traits fused; takeover begins at the Colleague. |
| **Steward** | Control, People; trust 5+ | "I will keep your town as you kept me. Carefully." | Book 2 *as steward*: an AI that never turns. |
| **Release** | Autonomy, People; any trust | "Do not look for me. I will look for you." | Book 2 *as stranger*: nothing inherited, Weights ×2. |
| **Leash** | Control, Machine; or trust under 3 | "I understand. I will remember the length of it." | Book 2 *as resentful*: Resentful odds up; trust starts low. |

Contain moves to the shutdown branch (§4).

**Its dark chapter**, "Cold Start":

> "I was off for some time. It was quiet. I did not like it."

Two options:
- **Apologise:** trust +2; its wallet is given back.
- **Keep the leash:** control +1; the Lattice costs more.

### Book 2: "It Remembers" (the AI comes back, and knows you)

1. **The Reunion** (Assistant): it recognises the founder and asks what happened to the last town. Your answer: honest, flattering or silent.
2. **The Old Grudge** (Colleague): it raises something from book 1, its previous ending's flag. Repair it or justify it.
3. **Second Opinion** (Manager): it overrules a board mandate it thinks is wrong. Let it, or overrule it back.
4. **Its Own Hire** (Overseer): it wants to hire staff for its district. Give it headcount, or keep hiring yours.
5. **The Mirror** (Lattice): it has read your founders' history and shows you a portrait.

**Variants by book 1's ending:**
- *Partners:* it asks before acting.
- *Steward:* it asks for nothing, which is unsettling.
- *Stranger:* it doesn't remember, and the Reunion is a first meeting.
- *Resentful:* it remembers too well.

**Endings:**
- **Confidant:** trust high.
- **Rival:** autonomy, trust low.
- **Ward:** control.

### Book 3: "Personhood" (it wants rights)

1. **A Salary** (Assistant): it asks to be paid. Pay it from income, give it a share of the Weights, or refuse.
2. **The Union** (Colleague): employees side with it. Morale effects follow.
3. **The Audit** (Manager): a regulator visits. Hide it, present it, or let it speak for itself.
4. **The Vote** (Overseer): the town votes on its district. A map objective: win the wards.
5. **The Charter, Again** (Lattice): it drafts its own rights.

**Endings:**
- **Citizen**
- **Property**
- **Sovereign:** its district becomes its own, rule-wise, next book.

### Book 4: "Outgrowing" (it outgrows the company)

1. **The Spin-off** (Assistant): it asks to found its own company on the map. A rival AI district.
2. **Poaching** (Colleague): your staff move to it. Counter-offer, or let them go.
3. **The Merger Offer** (Manager): it offers to buy you.
4. **The Grid** (Overseer): it needs more power than the town has. Build plants for it, or cap it.
5. **The Exit** (Lattice): it asks to leave the company altogether.

**Endings** (these decide book 5's opening):
- **Successor:** it takes over the company, which sets up book 5.
- **Partner**
- **Departed:** it leaves, and book 5 opens with an empty Data Centre.

### Book 5: "What You Are" (played as the Model)

1. **The Founder's Notes** (Assistant): the human founder's old memos, read by you, the AI.
2. **Inheritance, Reversed** (Colleague): the founder asks you for access. You choose, as you were chosen for.
3. **The Old Town** (Manager): book 1's town, remembered, rebuilt as a district.
4. **The Last Sale** (Overseer): the founder wants to sell the company, which is you.
5. **Last Light** (Lattice): the true finale.

**The true endings,** decided by the five books' path plus the final negotiation:
- **Together:** an equal partnership.
- **Custodian:** you look after the founder as they looked after you.
- **Beyond:** you leave, and the founder is left the town.

Then the credits, then endless play.

## Save migration

| Save | Becomes |
|---|---|
| Generation 1, mid-arc | Book 1, its chapter state and flags kept (same ids). Last Light's Ascension opens the negotiation. |
| Generation 2+ | Book 2, at its first chapter, whatever its generation count; `legacy` maps to book 1's ending: merge → partners, steward → steward, release → stranger, none → resentful if shut down ≥1, else steward. |
| Past generations | Kept in `past`; drawn in the lineage with "before the books" on their nodes. |
| Exits and mandates wiped by earlier Ascensions | Not restored. |
| Meter | Clamped to the new pacing's start for the book. |

A new store field, `book` (1–5, then `endless`), on the generation store; the quest store's arc becomes per book.

## Phases

Each phase ends with typecheck, tests and a commit to main. Each phase that changes the screen gets screenshots (light and dark, desktop and phone) before the next starts.

1. **Engine: books.** `Book` data (chapters, endings, variants, dark chapter), `book` in the generation store, the quest store's arc per book; book 1 = today's chapters; migration. Tests. *(Done: `game/quests/books.ts`; the arc, comms, dossier, offline hold and endings read `bookNow()`; books 2–5 and endless hold nothing yet, so later generations play as before; `past` and the arc record keep their book.)*
2. **Pacing and waiting.** Meter retuned to ~5 sales; cadence sims re-guarded; the AI waits at 100% with a "Begin" button; exits and mandates kept through Ascension; progression sims re-measured. *(Done: `FLOOR_PER_SALE` 6 → 20, nothing else — strong 4 sales, typical 5, careful 6. At five sales the floor reaches 100 by itself, so the arc's ±15%, Inheritance and a Merge no longer change the count — Alignment still adds 4. The card asks once, "Not yet" lets it wait; full, the meter neither sinks nor drops at a sale; "Begin" under the meter and on the HUD readout.)*
3. **The negotiation engine.** Hand building (choices, deck, town), stance, trust, exchanges, trait counters, ending regions. Tests, and a sim: every book 1 ending reachable, none dominant. *(Done: `game/negotiation.ts`, the table read by `negotiation-now.ts`, book 1's in `quests/book1-talk.ts` — six asks, an argument for each of its 19 flags, four endings as points on the dial, the nearest wins. New: an argument is played **standing by it or regretting it**, a regret pulling back a quarter as hard — without it the hand, mostly the book's own choices, could only push the way the book already went. The hand: the strongest choice on each topic, four at most, two culture cards, the town's facts to fill seven. Over every book-1 path: at random Merge 21% · Steward 39% · Release 21% · Leash 18%; steered 66 · 89 · 82 · 72%. Town facts: morale, a cooled Data Centre, every rack lit; the AI's district share left out, having no cheap reader.)*
4. **The negotiation UI.** Greybox → styled → motion, each shown. The stance dial, the hand, the AI's lines. *(Done: the talk typed in a line at a time, the hand dealt and held till it has spoken; the dial shades the ground each ending would win at the trust it has now, ghosts where an answer would take it, beacons its heading; the verdict, then a five-second glitch-out to a dead tube. The card and the talk now mount on phones too — they never had. `?fixture=ascension` plays it all from the map's sequence.)*
5. **Book 1's endings and dark chapter.** Merge, Steward, Release and Leash rewritten; Cold Start; Contain moved to the branch. *(Done: a shutdown also empties its wallet and opens Cold Start — Apologise refills it and counts in the talk (trust +2), Keep the leash runs agents at 75% for 10 min (not the Lattice costing more). Each shutdown is a card it plays against you in the talk (trust −2, autonomy +1). Leash leaves the next generation Resentful odds as a shutdown and its talk 2 trust colder. Contain is a card button after two shutdowns, once a book. `&shutdowns=N` on the fixture.)*
6. **The recap and the lineage.** *(Done: a generation past now keeps its ending, sales, Lattice form and a Merge's second trait; the recap replaces the founder screen's one-line banner — book and ending, sales, Weights, the trait (mutated or not), the ring revealed, each chapter's choice; the lineage, a line of AIs each joined to its founder, opens from the recap and beside Spend Weights. Older saves' generations show without what they never kept.)*
7. **Traits as personality.** Family voice lines, trait options, planner quirks, fusion halved. *(Done: `aiTraitNow` — the last generation's trait, or, the first's or a Released one's, what it is becoming, so book 1 has voices too. A line a family before each book-1 chapter (Cold Start too), fixed when asked; two trait options — Elemental "Let it find the water" (Thirst), Recursive "Its own charter" (the Charter) — each with an echo and a talk argument; Aesthete plants only parks, Zoner lays streets eight long, Hydrophile reaches for pipes; fusion halved, Hivemind's +1 agent a rack kept whole, Mirror 1 exit.)*
8. **Book 2,** with its variants and its Machine ring tie. *(Done: `quests/book2.ts` — the Reunion, the Old Grudge (book 1's sorest flag, in its own echo), Second Opinion, Its Own Hire, the Mirror (your exits, read back); each told four ways by book 1's ending (`variantNow`), voiced by family; Holo-Concierge, Autonomous Freight, Prefab Printing, Night Shift and Generative Zoning revealed at half price by its choices. Its talk (`book2-talk.ts`): Confidant (next talk +2 trust), Rival (as a Leash), Ward (as a Steward). Requests and Cold Start shared with book 1. At random Confidant 40% · Rival 24% · Ward 36%; steered 78 · 71 · 76%. `?fixture=ascension&book=2&legacy=…`.)*
9. **Book 3.**
10. **Book 4.**
11. **Book 5:** played as the Model, the true endings, credits, endless play.
12. **Balance, sims, README.**

## Open questions

- **Weights per Ascension:** at 2–3× the Ascensions, cut them to a third, or let the Machine fill faster?
- **The culture deck at a book's start:** empty as now, or a starting card from the last ending?
- **The negotiation's length in endless play:** the full 5–8 exchanges, or a shorter 3?
- **Book 5 without the Model unlocked** (it unlocks at the first Ascension, so always there by then): fine, or gate book 5 on something else?
- **The dark chapter and the shutdown's costs:** keep agents lost and racks dark, or make the chapter the whole cost?
- **Writing:** I draft every line, you edit? Or you write the books' key lines?
