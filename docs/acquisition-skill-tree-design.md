# Acquisition Skill Tree — Design Spec

> Status: **DRAFT for review.** Nothing here is implemented yet. Edit freely —
> numbers in _(tunable)_, whole clusters, and any passive can be changed before
> we build. Once locked, this drives the procedural generator + effect engine.

The tree is the Equity sink for the Company Acquisition prestige. It is **fixed
and hand-designed in shape** (like Path of Exile): a central start, themed
clusters of small "minor" passives orbiting a defining "notable", connected by
cheap "travel" nodes, with a handful of run-defining "keystones" at the edges.

Design pillars:

- **300+ nodes**, grouped into ~12 thematic clusters.
- Passives are **unique to this tree** — they do things no other system does
  (cross-generator synergy, headcount scaling, resource conversion, system
  inversions). Minor stat bumps exist only as the connective filler.
- **Keystones reshape, never punish.** Every downside is "a system is
  disabled / a resource is reduced." None ever destroy progress or stall you.
- **Fully respeccable** with a persistent respec-point economy bought with Exits.

---

## 1. Currencies & respec

| Currency          | Earned by                                            | Spent on                  |
| ----------------- | ---------------------------------------------------- | ------------------------- |
| **Equity**        | Accepting an acquisition (∝ total accrued valuation) | Allocating tree nodes     |
| **Exits**         | +1 per acquisition (already tracked)                 | Buying respec points      |
| **Respec points** | Converting Exits (persistent, infinite)              | Refunding allocated nodes |

**Respec rules**

- Convert **1 Exit → 20 respec points** _(tunable `RESPECS_PER_EXIT`)_. Respec
  points persist forever once bought.
- In **respec mode**, clicking an allocated node refunds it: −1 respec point,
  +its Equity back, node deallocated.
- A node can only be refunded if doing so **doesn't orphan** other allocated
  nodes (the remaining allocation must stay connected to a root) — PoE-style.
  Refund leaf-inward.
- Roots can't be refunded.

**UI** (in the existing tree overlay): a respec-mode toggle, the respec-point
balance, and a "Buy 20 respecs (1 Exit)" button.

---

## 2. Node taxonomy

| Kind         | Role                                                    |
| ------------ | ------------------------------------------------------- |
| **root**     | Always-allocatable entry point(s); pure connector.      |
| **travel**   | Connective tissue; no effect (or a tiny generic +1–2%). |
| **minor**    | Small stackable stat in the cluster's theme.            |
| **notable**  | The cluster's signature effect.                         |
| **keystone** | Run-defining; large upside + a reshape downside.        |

### Cost model — escalating by allocation order (per §6.1)

Node kind no longer sets price. Instead **each node you allocate costs more than
the last**, regardless of kind:

> `nextCost = round(BASE × GROWTH ^ (nodes already allocated))` &nbsp;_(tunable `BASE`, `GROWTH`)_

A keystone is "expensive" because you path through many (increasingly costly)
nodes to reach it, not via a flat premium. Tuned so a **full clear takes
hundreds of acquisitions** — and because Equity/run grows as your runs get
stronger, the curve stays reachable.

Illustrative (`BASE = 1`, `GROWTH = 1.03`): node #1 ≈ 1, #50 ≈ 4, #150 ≈ 84,
#320 ≈ 13k Equity; cumulative ≈ 440k to fully clear. `GROWTH` is the primary
tuning knob — we'll calibrate it against the live payout curve. The tooltip
shows the live cost of the next node.

---

## 3. Effect engine (the contract)

Allocated nodes fold into a resolved **`PrestigeModifiers`** object, applied at
the **same chokepoints the founder modifiers already use** (money chain,
innovation `getMultiplier`, valuation accrual, cost exponent, auto-buy, manager
progress…), composing **multiplicatively** with founders. Three implementation
tiers:

**Tier 1 — scalars & flags** (≈90% of nodes + most keystones; trivial, reuses the founder pattern)

| Field                                                                                                                                                                 | Default | Effect                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------- |
| `moneyMult`                                                                                                                                                           | 1       | global money output                      |
| `innovationMult`                                                                                                                                                      | 1       | global innovation output                 |
| `valuationAccrualMult`                                                                                                                                                | 1       | valuation/sec                            |
| `costExponentReduction`                                                                                                                                               | 0       | subtract from every cost-growth exponent |
| `autoBuyMult`                                                                                                                                                         | 1       | auto-buy rate                            |
| `managerProgressMult`                                                                                                                                                 | 1       | manager tiering speed                    |
| `headcountMoneyPerEmployee`                                                                                                                                           | 0       | +k×total employees to money              |
| `innovationLogMult`                                                                                                                                                   | 1       | steepen the innovation curve             |
| `mandateCostGrowthReduction`                                                                                                                                          | 0       | cheaper board mandates                   |
| `equityGainMult`                                                                                                                                                      | 1       | acquisition Equity payout                |
| `offlineEfficiencyBonus`                                                                                                                                              | 0       | + to the 100% offline rate               |
| `generatorMoneyMult[id]` | 1 | per-generator money |
| `generatorInnovationMult[id]` | 1 | per-generator innovation |
| `baseProductionMult` | 1 | global base-production (Bootstrapped) |
| `generatorBaseProductionMult[id]` | 1 | per-generator base production (AGI-Pilled) |
| `generatorCostExponentMult[id]` | 1 | per-generator cost-exponent multiplier (AGI-Pilled) |
| `singularityProgressMult` | 1 | AI-singularity accrual speed (AGI-Pilled) |
| `startingGeneratorLevelsPerExit` | 0 | free generator levels each new run, per Exit (Permanent Acqui-hire) |
| **flags:** `disableManagers`, `disableAutoBuy`, `satisfactionPinnedZero` | off | keystone system toggles actually in use |

**Tier 2 — relational scalars** (read other state at the chokepoint; moderate)

| Field                  | Effect                                            |
| ---------------------- | ------------------------------------------------- |
| `sqrtHeadcountScaling` | output scales with √(total headcount)             |
| `networkEffectPer100`  | +x% all multipliers per 100 employees             |
| `crossGenSynergy[a←b]` | generator `a` gains +x% per unit of generator `b` |
| `innovationToMoneyPct` | convert x% of innovation/sec into money/sec       |
| `perMandateMoneyPct`   | +x% money per board-mandate level                 |
| `founderAmplify`       | scale the active founder's modifiers by +x%       |

**Tier 3 — temporal** (new per-tick logic; build last)

| Field                 | Effect                                                       |
| --------------------- | ------------------------------------------------------------ |
| `runScalingPerMinute` | global multiplier grows over the run (resets on acquisition) — Hockey Stick |

---

## 4. Cluster catalog

**11 clusters** (Regulatory Capture cut). To still clear 300+ nodes across 11,
each cluster ≈ **1 notable + ~21 minors + ~5 travel** (≈27 nodes); **7 clusters**
terminate in a keystone. Minors are 2–3 repeated small effects in-theme.

### 4.1 Growth Hacking — _revenue & headcount_

- **Minors:** `+4% intern money`, `+3% all money`, `+0.1% money per employee owned`.
- **Notable — Blitzscaling:** all generator output scales with **√(total headcount)** _(tunable coefficient)_.
- **Notable — Network Effects:** **+5% to all multipliers per 100 total employees**.

### 4.2 Venture Capital — _valuation & hype_

- **Minors:** `+6% valuation/sec`, `−0.005 mandate cost growth`, `+3% all money`.
- **Notable — Term Sheet:** **+8% money per board-mandate level owned**.
- **Keystone — Down Round:** money **×3**, but valuation accrues **80% slower**.

### 4.3 Move Fast — _innovation & automation_

- **Minors:** `+5% innovation`, `+8% auto-buy rate`, `+4% vibe-coder money`.
- **Notable — Ship It:** **+25% innovation** and **+25% auto-buy**.
- **Keystone — Move Fast, Break Things:** innovation **×2.5** and auto-buy **×2**, but **−50% money** (you're not monetizing, you're shipping).

### 4.4 Lean Startup — _cost efficiency_

- **Minors:** `−0.004 cost exponent`, `×0.95 hire cost`, `+3% all money`.
- **Notable — Ramen Profitable:** **−0.02 cost exponent** on all generators.
- **Keystone — Bootstrapped:** **no managers, no auto-buy**, but base production **×4** and cost exponents **−0.05** (pure manual/lean).

### 4.5 Crunch Culture — _morale tradeoffs_

- **Minors:** `+4% all money`, `+4% innovation`, `−2% effective on a paired stat` (push/pull).
- **Notable — 996:** **+40% all output**, satisfaction gains halved.
- **Keystone — Crunch Mode:** satisfaction **pinned at 0** (no morale bonuses), but **all output ×2.5**.

### 4.6 AI Hype — _vibe coders & the singularity_

- **Minors:** `+6% vibe-coder money`, `+6% vibe-coder innovation`, `+4% innovation`.
- **Notable — Prompt Whisperer:** vibe coders **×1.6 money & innovation**.
- **Keystone — AGI-Pilled:** **huge vibe coder bonuses at the cost of other employees** (interns & 10x cost exponent \* 1.5 and halved base production), but vibe coders **×5** output and doubled base production AND double singularity progress from negative vibe coder satisfaction.
  - _Impl note:_ uses `generatorCostExponentMult` (intern/10x ×1.5), `generatorBaseProductionMult` (intern/10x ×0.5, vibe ×2), `generatorMoneyMult`/`generatorInnovationMult` (vibe ×5), `singularityProgressMult` ×2. The AI singularity is currently a cosmetic/achievement meter (no loss state), so this stays reshape-not-punish — just leans you toward the singularity achievement.

### 4.7 Empire Building — _big-number scaling_

- **Minors:** `+0.15% money per employee`, `+4% all money`, `+3% all innovation`.
- **Notable — Headcount Is Strategy:** **+0.4% money per total employee**.
- **Notable — Conglomerate:** **+3% all output per generator _type_ you own ≥50 of**.

### 4.8 Open Source — _resource conversion_

- **Minors:** `+5% innovation`, `+3% all money`, `convert +2% innovation→money`.
- **Notable — Open Core:** convert **15% of innovation/sec into money/sec** (on top of normal).
- **Notable — Foundation Grant:** **+20% innovation**, and innovation also boosts valuation **+10%**.

### 4.9 Exit Strategy — _prestige meta_

- **Minors:** `+5% Equity payout`, `+5% offline rate`, `+4% valuation/sec`.
- **Notable — Serial Founder:** **+25% Equity** from acquisitions.
- **Keystone — Permanent Acqui-hire:** each Exit permanently starts your next company with **free generator levels** _(scaling)_, but **Equity payout halved**.

### 4.10 Founder Cult — _founder synergy_

- **Minors:** `+4% all money`, `+4% innovation`, `+5% the stat your founder buffs`.
- **Notable — Founder Worship:** your active founder's modifiers are **amplified +50%**.
- **Notable — Cult of Personality:** **+30% valuation/sec** while you are a Hustler

### 4.11 Enshittification — _money up, quality down_

- **Minors:** `+6% all money`, `−2% innovation`, `+4% valuation/sec`.
- **Notable — Monetize Everything:** **+50% money**, **−25% innovation**.
- **Keystone — Enshittify:** money **+200%**, but **innovation output −80%** and **satisfaction bonuses disabled** (no decay — a flat reshape, not a stall).

### Free-floating notable (central-ish)

- **Hockey Stick** _(Tier 3, temporal):_ your global multiplier **grows over the run** and **resets on acquisition** — rewards long single runs.

---

## 5. Layout & connectivity

- **Central hub:** the `Incorporation` root + ~6 short travel spokes fanning out.
- Clusters sit at the spoke ends, arranged radially; **inter-cluster travel
  bridges** let you path between adjacent themes without returning to center.
- Keystones sit at cluster **extremities** (deep investment to reach).
- The procedural generator places minors on orbital rings around each cluster's
  notable, wires intra-cluster edges (ring + spoke), and connects clusters via
  the bridges. All positions/edges derived from the cluster data — no hand
  coordinates.

### Node-count tally (≥300)

| Group                          | Count    |
| ------------------------------ | -------- |
| Root + central spokes          | ~7       |
| 11 clusters × ~27 nodes        | ~297     |
| Keystones (7)                  | +7       |
| Free-floating notable (Hockey Stick) | +1 |
| Inter-cluster travel bridges   | ~12      |
| **Total**                      | **~324** |

---

## 6. Tuning decisions

1. **Equity economy — RESOLVED.** Each node costs more than the last; a full
   clear takes ~hundreds of acquisitions. → escalating cost model in §2.
2. **Keystone exclusivity — RESOLVED.** Allocate as many keystones as you can
   reach; contradictory combos just cancel, and respec is the safety valve.
3. **`RESPECS_PER_EXIT = 20`** — still open. Keep, or change?
4. **Cluster themes/passives** — open for continued edits. You've cut Regulatory
   Capture and reshaped AGI-Pilled + Cult of Personality (now Hustler-specific).
   The "wild" identity notables remain Blitzscaling, Open Core, Network Effects,
   cross-gen Synergy, Founder Worship.

---

## 7. Build phases (once locked)

- **Phase A:** node taxonomy + procedural generator (≥300 nodes) + respec system
  - Tier-1 scalar/flag effect engine wired to chokepoints + UI (respec mode, buy
    respecs, keystone styling). Fully playable.
- **Phase B:** Tier-2 relational notables (Blitzscaling, Network Effects,
  cross-gen Synergy, Open Core, Term Sheet, Founder Worship).
- **Phase C:** Tier-3 temporal — Hockey Stick (`runScalingPerMinute`).
