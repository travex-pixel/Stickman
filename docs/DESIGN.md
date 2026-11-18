# ASCEND design notes

This document records what ASCEND is, how it is built, and the decisions behind it. It is
kept short on purpose: the code and its tests are the detailed reference.

## The fantasy

Start weak. Discover power. Defeat impossible enemies. Absorb their strength. Build an army.

Every system serves one of four pillars: combat, progression, the shadow army, discovery.

## Reference research: Epic Stickman

Read from epicstickman.wiki.gg (Heros, Summoning, Activities, Shop, Asher pages):

- **Gacha pools with summon levels.** Gear, skills and pets come from pools whose odds improve
  the more you pull. Rarities run Common to Exotic.
- **Owned effects.** Every hero owned grants passives at levels 10/25/50/75/100 whether or not
  it is equipped; items have owned and equipped effects. Collection itself is power.
- **Signature hero skills on a timer** (Asher: a whirlwind every 6 seconds).
- **Gated stat chain** (Attack Speed needs Health level 30 and so on): the first screen offers
  two choices, not six.
- **Activities** (Forest minesweeper, Alchemy tree, Mine, Zodiac) and four dungeons, each feeding a
  specific resource.
- **Weaknesses** the community itself names: heavy pay-to-win, ad-gated summons, real-time timer
  walls on research.

A second pass over the wiki (Heros, Summoning, Activities, Dungeons) sharpened four lessons:
owned effects grow with depth (hero levels 10/25/50/75/100), duplicates always convert into
something (maxed items fuse upward), each dungeon farms one specific thing (Ring, Gold, Relic,
Trait), and build variety comes from choosing which of many skills fill six auto-cast slots.

What ASCEND takes: collection value that deepens with stars (the Oath Codex), gated stat unlocks,
resource-specific modes (Gold Vault, Essence Rift, and the Relic Crypt for one gear slot a day),
the Forge for surplus gear, techniques that swap into ability slots and stay as owned power, and
a readable pale-hero-versus-ink-enemies battlefield.
What ASCEND rejects: pay-to-win, ads, timers that gate progress, and summoning by currency.
Shadows are earned in combat, which ties the collection directly to the fighting.

## Core loop

1. Farm: the campaign fights a stage's three ordinary waves in cycles, on its own, and pushes to
   the next stage in place. Boss stages raise a gate instead of starting their boss; farming loops
   there until the player chooses BOSS CHALLENGE, reads the forecast, and presses FIGHT. A loss
   returns to farming; nothing retries automatically. Offline time is simulated with the same
   rules and stops at gates. Rules: `src/game/progression/campaign.ts`. Basic attacks are
   automatic; abilities, dodge, focus and BIND are the player's decisions; AUTO is on after the
   tutorial. AUTO really casts: its arts and dodges land and hold their cast time, and its
   Ascendant Fury holds him until he returns, exactly as a cast by hand (see "AUTO casts" below).
2. Enemies marked with pale light leave a shadow. BIND shows its success chance before the tap.
3. Spend gold on stats (hold to upgrade), essence on shadow bonds, Rift Cores on evolution.
4. Level ups offer a choice of three perks, always (past the last ordinary stack, repeatable
   perks fill the offer). Clearing stages unlocks modes, ranks and regions.
5. Rank Trials turn levels into breakthroughs (E to S), each raising stats, BIND chance and,
   at C and S, the size of the army.

## Systems inventory

| System | Status | Where |
|---|---|---|
| Fixed-step deterministic combat, events | Working | `src/game/engine/World.ts` |
| Always-on farming loop, boss gates, player-started boss challenges, fall-back and push | Working | `src/game/progression/campaign.ts`, `World.queueStage/moveToStage` |
| Boss readiness: real-simulation forecast (4 fights) and actionable tips | Working | `src/game/progression/readiness.ts` |
| Offline progression sampled from real cycles, gate-safe, credited once | Working | `src/game/progression/offline.ts` |
| Daily and weekly objectives | Working | `src/game/progression/objectives.ts` |
| Gear sets (2 and 4 piece) | Working | `src/game/data/gearSets.ts` |
| Focus targeting (tap an enemy) | Working | `World.setFocus`, `BattleRenderer.pickEnemy` |
| Third region, The Shattered Crown (Bannerman rally, Crownless King, Support role) | Working | `src/game/data/regions.ts`, `src/game/enemies/ai.ts`, `src/game/bosses/hollowWarden.ts` |
| Ascension (prestige for Aether) | Working | `src/game/progression/ascension.ts` |
| Boss Hunts (rematch cleared bosses) | Working | `src/game/data/modes.ts`, `GameController.startHunt` |
| Aether tree (Might, Vigor, Fortune, Insight, Treasury, Oathbinder, Patience, Command) | Working | `src/game/progression/ascension.ts` |
| Army synergies: seven named role pairings that raise the fielded army; advice in the boss sheet | Working | `src/game/data/synergies.ts`, `progression/synergyAdvice.ts` |
| Rift Tyrant: weekly rotating boss, one-minute bar-breaking score, seven weekly tiers | Working | `src/game/progression/tyrant.ts`, `World.tyrantBreak` |
| Rift Memory: remembered gates stay open after an ascension; surges up to 5 stages a cycle | Working | `src/game/progression/campaign.ts` (`isRemembered`, `surgeLeap`) |
| Rift Depths: regions cycle every 30 stages from 31 with a twist each (Frenzied, Bloodbound, Volatile, Swarming, Elite Tide), tinted backdrops, +20% rewards and +1 boss core per depth | Working | `src/game/data/depths.ts`, `World.twist` |
| Six abilities incl. ultimate with time dilation, dodge with i-frames | Working | `src/game/abilities/execute.ts` |
| Enemy archetypes: grunt, brute, ranger, arcanist, shieldbearer, summoner | Working | `src/game/enemies/ai.ts` |
| Elite affixes (Brutal, Armored, Hasted, Vampiric), stage 4+ mini-boss | Working | `src/game/data/elites.ts` |
| Two-phase Warden boss; Drowned Warden with Undertow and Riptide; empowered trial version | Working | `src/game/bosses/hollowWarden.ts` |
| Perfect dodge (manual only), kill chain, finisher slow-mo | Working | `src/game/engine/World.ts` |
| Ability ranks (Arts) I to V | Working | `src/game/progression/abilityRanks.ts` |
| Techniques: earned alternate ability forms, owned attack bonus | Working | `src/game/progression/techniques.ts` |
| Forge (3 of a rarity into the next) and Relic Crypt | Working | `src/game/economy/loot.ts`, `src/game/data/modes.ts` |
| Drowned Lurker (submerging enemy) and Tidestalker shadow | Working | `src/game/enemies/ai.ts`, `src/game/summons/ai.ts` |
| Reward presentation: count-ups, loot cards, tiered summon reveals | Working | `src/components/rewards/` |
| BIND extraction with chance, pity, boss attempts, failure feedback | Working | `src/game/summons/extraction.ts` |
| Shadow roles: reaper, vanguard, ranger, arcanist, sentinel, caller, sovereign | Working | `src/game/summons/ai.ts` |
| Shadow progression: XP, bond, shards, evolution, Codex | Working | `src/game/summons/progression.ts` |
| Stats, gear with build-defining effects, skills, weapon paths, perks | Working | `src/game/progression/` |
| Power by source, the best next step, equip best, the bag's lend | Working | `src/game/progression/power.ts`, `stats.ts` (`computePlayerStats(profile, without)`, `BAG_LEND`) |
| Hunter rank E to S via Rank Trials | Working | `src/game/progression/ranks.ts` |
| Apex: Double Strike, Triple Strike, Prismatic Edge, Stormcrown, bought with skill points past the stage-39 boss | Working | `src/game/data/apex.ts`, `src/game/progression/apex.ts`, `World.playerBasicHit` |
| Modes: campaign, Gold Vault, Essence Rift, Endless Ascent, Rank Trial | Working | `src/game/data/modes.ts` |
| Quests, achievements, journal, bestiary | Working | `src/game/progression/quests.ts` |
| Gift codes (signed, once per save) | Working | `src/game/economy/codes.ts`, `scripts/make-code.mjs` |
| IndexedDB saves: versioned (v14), validated, backed up, migrated, unload-safe | Working | `src/persistence/` |
| Capped offline rewards | Working | `src/persistence/OfflineRewards.ts` |
| Runtime-synthesised audio | Working, untested on devices | `src/game/audio/` |

## Architecture decisions

- **The simulation knows nothing about React or Pixi.** `World` advances in fixed 1/60 s steps
  and emits typed events. The renderer, audio and progression react to events. This keeps combat
  deterministic and lets the balance harness run whole stages headlessly in milliseconds.
- **Progression is derived, never cached.** Player stats, modifiers and the loadout are recomputed
  from the profile (`buildLoadout`), so a save can never hold stale derived numbers.
- **Content is data.** Enemies, shadows, waves, modes, elites, skills, perks, gear effects and
  quests are tables. A new enemy is a data entry plus, at most, a behaviour function.
- **Art is procedural and painted once.** Characters are flat silhouettes animated with transforms
  only; the battlefield is painted into canvases at layout time with watercolour techniques and
  uploaded as textures. Per frame we move sprites, so the cost stays low on mid-range phones.
- **Fonts are self-hosted** (SIL OFL) so builds never depend on a font CDN.
- **Saves never regress.** Every load runs migrations then field-by-field validation; a bad field
  falls back alone. Each write keeps the previous save as a backup. Because browsers do not wait
  for async IndexedDB writes during unload, the latest unwritten profile is also copied
  synchronously to localStorage on pagehide; the next load prefers it only if valid and newer.
- **Sim timers belong to the World.** Delayed effects (telegraphed hits, minion calls, tide pools)
  are scheduled on the World and die with it, so no callback can leak into the next run.
- **Gift codes are signed, not secret.** The verifying secret ships to the client, which means a
  determined player could forge one. ASCEND sells nothing, so the only thing at stake is their
  own fun; the trade-off buys a serverless deployment.

## Economy and pacing

Tuned with `tests/unit/economy.sim.test.ts` (opt-in: `ECON_SIM=1`), which plays the gated loop
headlessly as an engaged player: AUTO on, greedy spending, every shadow bound, rank trials taken,
and each gate challenged once the real forecast wins 2 of 4. It ranks the arts it uses (and the
ultimate) whenever a rank costs at most a quarter of the gold in hand (`RANK_GOLD_SHARE`), as a
sensible player would; before, it never bought ranks.

- Enemy strength has two phases (`stageScale`): x1.27 health and x1.16 attack per stage up to
  stage 18, then x1.17 and x1.10. Early on the player's power arrives in bursts (army, gear,
  skills, codex); later it comes from compounding stats, so the curve eases.
- Stage gold grows x1.10 per stage. Stat costs grow x1.085 per level.
- Attack and Health multiply x1.6 every 25 levels (milestones).
- Gate bosses are x4 health and x1.5 attack over their stage, growing slowly (`bossScale`). The
  stage 1 Warden keeps its plain strength: it is the tutorial's lesson.
- The warrior's strength stops growing with level at 150; levels go on (to 9999), and each one
  past 150 pays a skill point for Apex instead of a perk (see "Apex"). Shadow cap 40. Quest gold is
  a few stage clears per quest.
- Offline: up to 2 hours on a new save, +30 minutes per boss won, to 8 hours; the warrior fights
  40% of it, sampled from real cycles, and never passes a gate.

Measured (two seeds): gates 1 to 30 in about 40 minutes with short waits, then a few minutes to
over an hour of farming per gate through 42 to 48, reached after 3 to 5 hours of engaged play.
Ascension is the answer to the late ceiling: in eight simulated hours the same player stalls at
stage 51 without it and reaches stage 66 ascending whenever stuck for 30 minutes
(`ASCEND_AFTER=30` in the simulator).

### Power, where it comes from

Tapping Power in Hero opens the Power sheet: the best next step on top, then every source of
strength with its share of Power and a line of plain numbers, each leading to where it changes.
`computePlayerStats(profile, without)` can leave any source out (stat levels, warrior level, worn
gear, the bag, gear sets, skills, perks, weapon path, the army's Codex, techniques, rank, Aether,
the Aether tree, Apex); a source's drop is Power with everything less Power without it. Apex
counts as the expected damage of a swing with its echoes, prismatic crits and bolt over one
without (`apexDamageMult`), on the Power number's damage term. Sources multiply
each other, so the drops add up to more than Power; they are scaled down together, in proportion,
so the rows and the bare warrior add up to Power exactly (`powerBreakdown`, tested).

The best next step (`nextStep`) takes free steps first (a perk waiting, a skill point, an Apex
rank, stronger gear in the bag, Aether for Might or Vigor), then a Rank Trial, then the stat level with the most
Power per gold you can afford (`bestStatBuy`); failing those, the waiting boss, the stat to farm
gold for, or Ascension when the next useful level is far off.

### Gear and the bag

- Every kept item lends strength: an item in the bag lends `BAG_LEND` (3%) of its stat line, at
  its level; not its special effect, not its set. The forge folds its three inputs' stat lines
  (and whatever they had folded in) into the item it makes (`kept`), which lends the same share
  wherever it is, worn or not; so forging never lowers what the bag lends, stat by stat (tested
  over 40 seeds). Saves are v13 for it; older items have nothing folded in.
- Why 3%: measured on the simulator's saved profiles (a full bag is 18 items), 10% would add 9 to
  13% Power (the "felt" target) but moves the gate-30 forecast by 34 points, gate 36 by 13 and
  gate 42 by 12. 5% moves gate 30 by 18. 3% adds 3 to 4% Power and keeps every gate within 9
  points:

| Gate | 3 | 6 | 9 | 12 | 18 | 24 | 30 | 33 | 36 | 39 | 42 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Before (win %) | 38.2 | 100 | 98.6 | 100 | 99.3 | 95.1 | 26.7 | 91.3 | 69.4 | 3.1 | 0 |
| Bag at 3% | 39.6 | 100 | 98.6 | 100 | 99.3 | 97.9 | 35.4 | 92.7 | 75.3 | 3.1 | 0 |
| Bag at 10% | 40.3 | 100 | 100 | 100 | 97.9 | 97.9 | 60.8 | 100 | 82.6 | 10.8 | 12.5 |

  (24 forecast fights per saved profile; 6 profiles a gate to 24, 12 from 30.) In the economy
  simulator (three sets of 24 seeds, 90 minutes, paired by seed) the 3% bag reaches gates 6 to 24
  within a minute of before, gates 30 to 42 0 to 2 minutes sooner, and the same deepest stage
  (median 44) and level (69 to 72).
- Gear shows what each piece is and gives: the Worn view's six cards (name, main stat, effect and
  set), the Bag view strongest first with an arrow on each piece that would raise Power, and a
  picked item's Power if worn, its stats against the worn one, its effect in a sentence, its set
  and progress, and what it lends. Equip best (`equipBestPlan`) only makes swaps that raise Power
  and never takes off a worn special effect or four-piece set.
- A finding: attack speed and crit rate have value ceilings (3.2 a second, 85%), which the
  simulator's players reach by gate 18. Past them, items whose lines are attack speed or crit rate
  add nothing; the Power change on each item now shows it.

### Stat levels, caps and prices

Each stat's price rises 8.5% with every level of that stat (`statUpgradeCost`), so a stat bought
often costs far more than one bought rarely: Attack at level 118 costs about 140K, Health at
level 52 about 589. The gold "Best" mark names the affordable level with the most Power per gold.

Level caps are 400 for Attack and Health, 250 Defence, 300 Crit damage, 150 Crit rate and 120
Attack speed; Limit Break (Ascension's tree, open from stage 20) adds 40 to Attack, Health and
Defence per level, up to 25 levels. With the simulator's player, Attack is near 73 at gate 30 and
100 at gate 42: no level cap is reached before the first ascension. The two value ceilings come
first (gate 12 to 18) and are final by design; gold then goes to the four open stats. Hero shows
the road: "Lv 118 of 120" within 10 levels of a cap, and at Max what raises it ("Limit Break ›",
which opens Ascension) or why it stops.

### Army synergies

Measured with the simulator's player following the boss sheet's synergy advice, eight seeds per
condition (`SEEDS=1,...,8 MAXMIN=200 STOPGATE=48 WALL=45`, `ASCEND_SYNERGY=0` vs `1`):

| Gate | Median minutes to reach, off | On |
|---|---|---|
| 24 | 31.0 | 30.4 |
| 30 | 43.4 | 42.8 |
| 36 | 58.2 | 55.5 |
| 39 | 67.6 | 60.7 |
| 42 | 93.2 | 87.8 |

Median deepest stage in the window is 44 either way (on: up to 48). A reward for building a good
army that is felt mid-game without reshaping the curve.

### Perks past the last stack

The fourteen ordinary perks hold 55 stacks and every level from 2 gives one pick, so from level 57
the offer was empty: picks banked for ever, the chip kept asking and the sheet opened with no
cards. Three repeatable perks now fill any offer short of three, one per tone: Endless Edge
(+5% attack), Deep Vigor (+5% max health) and Legion's Oath (army +10% damage), with no stack
limit. Choose all spends every banked pick, taking whichever tone it has taken least.

Sized on the simulator's saved profiles, the banked picks spent as Choose all would:

| Gate (levels at reach) | Before (win %, boss health left) | +3% a stack | +5% a stack (chosen) |
| --- | --- | --- | --- |
| 36 (33 to 36) | 75.0, 0.029 | 75.0, 0.029 | 75.0, 0.029 |
| 39 (39 to 42) | 14.2, 0.243 | 14.2, 0.243 | 14.2, 0.243 |
| 42 (45 to 58) | 21.2, 0.219 | 21.9, 0.218 | 23.3, 0.218 |
| 45 (59 to 67) | 8.3, 0.307 | 8.3, 0.293 | 8.3, 0.284 |
| 48 (63 to 101) | 0, 0.428 | 0, 0.373 | 7.3, 0.335 |
| 51 (100 to 122) | 0, 0.420 | 0, 0.314 | 2.8, 0.235 |

The simulator's player runs dry in the late 50s of level, past gate 42, so the gates to 42 hardly
move; deeper, a stuck warrior gains ground. 53 picks at once (a long-stalled save) is about +30%
Power at 5% (+18% at 3%).

In the economy simulator (four hours of one climb, no ascension, three sets of 24 seeds paired by
seed; both sides press Deploy best) every gate to 42 is reached at the same minute as before, and
the deepest stage rises from a median of 50 to 56 to 59 at 5% (every seed deeper, +7 stages on
average; +5 at 3%), with the warrior at the level cap of 150 by the end. That is the point of the
fix (a stalled warrior keeps gaining), and it is where a smaller step would be felt if the late
climb now runs too fast.

### Deploy best

Army strength scores a line-up: each fielded shadow's stats as it fights (level, bond, stars, the
warrior's army bonuses and the line-up's synergies), scored as a shadow's power always has been
(attack × speed × 5 + health × 0.5 + defence × 6), summed. Deploy best tries every line-up of the
collection (792 for twelve shadows in five places) and fields the strongest; Swap in brings a
benched shadow into a full army in one step, the cheapest swap first.

Checked in boss fights on saved profiles (12 a gate, 4 fights each line-up): the army's own
damage per second with Deploy best's line-up against the simulator's old rule (strongest shadows,
then up to two synergy swaps) and three random line-ups:

| Gate | Deploy best | Old rule | Random |
| --- | --- | --- | --- |
| 36 | 360 | 319 | 148 |
| 39 | 346 | 294 | 203 |
| 42 | 536 | 462 | 360 |

The boss forecasts barely depend on the line-up (win rates within noise of each other, 192
fights a gate), since the warrior deals most of the damage. The simulator's player now presses
Deploy best (both sides of the comparison below).

### AUTO casts

Until this change, an ability cast by AUTO was overwritten in the same tick by the movement and
attack logic: impact arts (Arc Slash, Thunder Strike, Soul Burst, Void Nova and the techniques)
never landed, AUTO dodges never dashed, and he kept swinging through his ultimate. The balance had
been tuned on that. With the fix (`World.updatePlayer` stops when AUTO acted):

- Ascendant Fury's cast ends with the ultimate: he is free the moment he returns. (Its 1.6 s cast
  time is world time and outlived the slowed flurry, holding him idle for about a second.) His
  invulnerability ends with it too, after a short `FURY_AFTER_INVULN` (0.3 s) to land the return
  blink; it used to outlive the flurry by about a second.
- He cannot dodge while the Fury runs; every ability disc reads held until he returns.
- Each blink lands a sword cut on its lead, a basic blow at `FURY_CUT_POWER` (0.25), for feel.
- Nothing charges the ultimate while it runs (its cut, its strikes' crits and kills, the army's
  kills): it never pays for the next one. Before this rule AUTO recast it the moment he returned in
  late fights (every 2 s); now the median gap is 4 to 4.8 s in late boss fights (gates 30 to 42)
  and 4 to 7.4 s while farming (stages 29 to 41), against 2.8 to 3.6 s and 2.2 to 2.5 s before the
  AUTO fix.
- Bosses past the stage-1 Warden carry extra health, one rule (`bossHealthLift`): x1.55 at the
  first gate, falling by 0.0155 per stage to none from stage 39. Boss Hunts and the Rift Tyrant
  keep it; Trials do not. The stage-1 Warden keeps its full stage health (it was 70%).
- No ordinary enemy and no art changed.

Share of the warrior's damage in AUTO, from the boss and farming probe on the simulator's saved
profiles (3 per gate, one farming run and one boss fight each; the Fury's cut counts as
ultimate; measured before the shorter invulnerability, which does not change who deals the
damage):

| Gate | Before: basic / arts / ultimate | After: basic / arts / ultimate |
| --- | --- | --- |
| 3 | 68% / 0% / 32% | 31% / 43% / 25% |
| 12 | 57% / 0% / 43% | 35% / 35% / 30% |
| 24 | 40% / 0% / 60% | 28% / 30% / 42% |
| 30 | 29% / 0% / 71% | 21% / 30% / 49% |
| 36 | 34% / 0% / 66% | 19% / 33% / 49% |
| 42 | 20% / 0% / 80% | 14% / 26% / 60% |

Measured against the previous build, both with the simulator's rank-buying player:

- Boss forecasts (24 fights per saved profile, 120 to 288 fights per gate): every gate from 3 to 42
  within 8.7 points of its earlier odds (3: -4.2, 6: 0, 9: +1.4, 12: 0, 18: +7.6, 24: +8.3,
  30: -5.2, 33: +0.7, 36: +8.7, 39: +4.9, 42: 0).
- Rift Tyrant bars broken (4 bosses, 2 twists, 6 saved profiles per gate group): with the lift
  -15% at gate 12, -7.5% at 24, -4% at 30, +0.5% at 36, +6% at 42; without it +21%, +17%, +11%,
  +6%, +6%. The lift is the closer of the two, so the Tyrant keeps it.
- Economy simulator (seeds 101 to 124, 90 minutes, three runs each): gates 6 to 24 reached as
  before; gates 30 to 39 about 1 to 5 minutes sooner, because farming is faster from stage 29 on
  (cycles 2 to 8% shorter; the gates themselves are as hard as before); gate 42 reached by 21 to
  23 seeds (19 to 20 before); deepest stage 42 to 44 as before; level about 67.5 to 69 against
  64 to 66.5.

### Apex

The owner reached level 150 (the old cap) at stage 49 with 47 skill points and nothing to spend
them on: every tree learned, every Art mastered, attack speed and crit rate at their ceilings.
Apex is the fifth view of Skills, and turns those two wasted stats into the doors of the late game.

**When.** It opens once the stage-39 boss has fallen (best stage 40, in this climb or an earlier
one; `APEX_OPEN_STAGE`). From the moment attack speed first reaches its ceiling a quiet locked view
shows what is coming. Until a rank is bought nothing in the fight differs: no random draw, no stat,
no event (a digest of a late farming and boss minute is pinned to the commit before Apex, and the
economy simulator's first 39 gates are identical line for line, eight seeds).

**The four skills** (`src/game/data/apex.ts`; prices in `progression/apex.ts`):

| Skill | Ranks | Door | Each rank |
| --- | --- | --- | --- |
| Double Strike | 10 | Attack speed maxed (at its 3.2 ceiling, or its last level) | +10% chance an ordinary basic blow strikes again 0.08 s later, at 80% of a blow. At 10 every swing strikes twice |
| Triple Strike | 10 | Double Strike 10/10 | +10% chance a Double Strike's echo strikes a third time 0.08 s after it, as lightning |
| Prismatic Edge | 10 | Crit rate maxed (85% ceiling, or its last level) | +3% of the warrior's crits (abilities' too) turn prismatic: ×2.5 damage, the rainbow hits |
| Stormcrown | 1 | The other three at 10/10 | Every 12th blow (ordinary or echo) calls a critical, prismatic bolt (2× a blow) on its target that forks to the 3 foes nearest it (1× each); the warrior's final form |

**Rules of the blows** (`World.basicBlow`, `landEcho`, `stormBolt`):

- Only an ordinary basic blow can echo: never the Ascendant Fury's cut, an ability, or an echo.
- An echo is scheduled on the world (deterministic). If its target fell or left reach it takes the
  nearest foe in reach (`jumped`); with none, or if the warrior fell, the fight ended or the Fury
  began meanwhile, it is lost.
- An echo is a real blow for on-hit effects (weapon path procs, Bloodthirst and Blood Pact
  lifesteal, Hunter's Mark, the Thunderclap count), but it never spends a perfect dodge's crit and
  charges no energy, nor do the crits and procs it sets off, nor the bolt. Kills charge as before,
  whoever lands them. Without that, three blows a swing would triple the ultimate's charge and AUTO
  would cast the Fury back to back; measured, AUTO casts it exactly as often with full Apex.
- Prismatic rolls only on a blow that already crit, the warrior's only, abilities included (the
  Fury's total can go rainbow). Every draw waits on its rank.

**Skill points.** Levels used to stop at 150, where XP was thrown away. Now they go on; a level
past 150 adds no strength and no perk (so nothing but Apex changes), and pays one skill point
(every second level before, as always). The cap is 9999, for the top bar's sake (it holds four
figures at 320 px); Apex is bought out hundreds of levels before. Once nothing is left to buy,
a level past 150 is quiet news and the banked points stop reading as a nag (grey count, no dot,
no readiness tip).

**Prices** (skill points a rank; 245 for all):

| Skill | Ranks 1 to 10 | Total |
| --- | --- | --- |
| Double Strike | 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 | 65 |
| Triple Strike | 3 to 12 | 75 |
| Prismatic Edge | 3 to 12 | 75 |
| Stormcrown | 30 | 30 |

No gold price. **The prices are sized for the stuck warrior**, the player Apex was made for: level
150, every tree learned and every perk picked, 47 points banked, farming stage 49 behind a boss he
cannot beat. His points come one a level, and a level past 150 costs more XP each time (60 L^1.85)
while his XP an hour stays flat, so his points a day fall from about 95 to about 25 within a week.
The first prices (365 in all) took him about eight days to Stormcrown, past the owner's "a few days
max"; these take four. A warrior who is still climbing earns XP faster with each stage and
finishes in about two days. `tests/unit/apexPacing.test.ts` holds the stuck warrior inside five days.

**Pacing, measured** (the economy simulator on the final code, two seeds each). A day is two real
hours of AUTO at 2x (four game hours) and one eight-hour offline credit (the cap, fought at 40%),
the spender buying the next open rank, cheapest first. Both warriors start from the simulator's
player at gate 48 raised to level 150 with every tree, every Art mastered, 149 perk picks, attack
speed and crit at their ceilings and 47 points (`ownerLike`). Times are real minutes into a day's
play; "start" means bought with the night's credit before it.

Stuck at a gate (the sizing case: never challenges a boss, never pushes, holds stage 49; its
gate-51 forecast is 0 of 4. A weaker twin that cannot win even gate 48 earned the same points, since
farming XP at a held stage is set by the waves, not by damage):

| Milestone | Seed 101 | Seed 102 |
| --- | --- | --- |
| Double Strike 1 | at once | at once |
| Double Strike 10 | day 2 start | day 2 start |
| Prismatic Edge 10 | day 3 +49 min | day 3 +38 min |
| Triple Strike 10 | day 3 +108 min | day 3 +98 min |
| Stormcrown | day 4 +68 min | day 4 +68 min |
| Levels gained each day (play + night) | 63+29, 34+19, 25+16, 20+13 | 63+30, 33+21, 25+14, 20+13 |

Still climbing (pushes and challenges bosses when its forecast says 2 of 4; it climbs from 49 to 59
on day 1 and 65 by day 3):

| Milestone | Seed 101 | Seed 102 |
| --- | --- | --- |
| Double Strike 1 | at once | at once |
| Double Strike 10 | day 1 +66 min | day 1 +69 min |
| Prismatic Edge 10 | day 2 start | day 2 start |
| Triple Strike 10 | day 2 start | day 2 +12 min |
| Stormcrown | day 2 +58 min | day 2 +72 min |

Once everything is bought the points keep coming (the climbing warrior banks about 200 by day 4).
They are left grey and quiet: no dot, no readiness tip, and the level-up line is chatter that never
shows during a fight.

**Power.** A late warrior on AUTO deals most of his damage with the arts and the Fury: he swings
about 0.9 times a second against a 3.2 ceiling. Power therefore counts Prismatic Edge (any crit) in
full and the echoes and the bolt only on the basic blows' share of his damage, `BASIC_BLOW_SHARE`
(0.15). Counting them on a lone swing, as at first, showed full Apex as x4.8 Power. Measured on two
owner-like warriors (three boss fights at stage 54 each, AUTO):

| Ranks | Power at first | Power now | Boss damage | Farming damage, stage 49 |
| --- | --- | --- | --- | --- |
| Double 10 | x1.72 | x1.11 | x1.12 to 1.15 | x1.01 to 1.02 |
| + Triple 10 | x2.45 | x1.22 | x1.22 | x1.06 to 1.09 |
| + Prismatic 10 | x3.50 | x1.72 | x1.80 to 1.82 | x1.22 to 1.25 |
| + Stormcrown | x4.81 | x1.91 | x2.04 | x1.21 to 1.24 |

(On a stunned dummy with basic blows only, full Apex is x5.3: the old number described that.)
Farming barely moves because foes already die in a blow or two; kills a minute rise 6 to 9%.

**Boss forecasts, measured** (`APEX_SIM=forecast`; 24 fights a profile; a noise arm on other
seeds):

| Profiles | Boss of stage | No Apex (win, boss left) | Noise arm | Full Apex |
| --- | --- | --- | --- | --- |
| Owner-like, facing gate 51 | 51 | 0%, 0.26 | 0%, 0.26 | 100% (97 s) |
| | 54 | 0%, 0.59 | 0%, 0.59 | 33%, 0.18 |
| | 57 | 0%, 0.76 | 0%, 0.76 | 0%, 0.51 |
| | 60 to 66 | 0%, 0.86 to 0.93 | same | 0%, 0.72 to 0.87 |
| Stalled at gate 60 (10 h climb) | 60 | 0%, 0.31 | 0%, 0.31 | 100% (114 s) |
| | 63 | 0%, 0.55 | 0%, 0.56 | 50%, 0.28 |
| | 66 | 0%, 0.67 | 0%, 0.67 | 0%, 0.32 |
| | 69 to 75 | 0%, 0.85 to 0.95 | same | 0%, 0.70 to 0.90 |

Full Apex roughly doubles boss damage (Prismatic Edge is most of it: on the owner-like profiles
Double and Triple Strike take gate 51 from 0 to 44%, Prismatic Edge to 100%). It moves the stall
by one or two gates; the bosses six to nine stages past it still stop it. The first numbers
(echoes at 60%, 2% at ×2, a 1.5× bolt) raised boss damage about 1.5 times, too little for what
the owner asked; these were kept.

Long climb (five days as above, best stage at the end of each day, two to four seeds; measured
with the first prices, 365 points, so the "with Apex" arms bought their ranks a little later):

| Day | New save, no Apex | Noise arm | With Apex | Owner-like, no Apex | With Apex |
| --- | --- | --- | --- | --- | --- |
| 1 | 56, 59 | 59, 59 | 59 to 65 | 56 to 59 | 56 to 62 |
| 3 | 62, 62 | 65, 65 | 68 | 56 to 59 | 62 to 65 |
| 5 | 65, 65 | 65, 65 | 68 to 71 | 59 to 62 | 65 to 68 |

(The owner-like arm without Apex ran four days for two of its four seeds; its day-5 cell holds
their day 4.) Stages move by gates of three, so one seed's step is the noise: the noise arm, the
same player with one extra random draw, ends day 1 three stages from its twin.

AUTO with full Apex (stalled gate-60 profiles, 120 s of boss and farming each): the Fury every
3.98 s in boss fights with and without (no earlier recast); energy 25.6 against 24.9 a second;
swings 0.9 a second (the Fury and the arts hold him most of the time; the ceiling is 3.2); weapon
and Thunderclap chains 1.19 against 0.79 a second; healing 0.71% of health a second against
0.15%; lowest health 96%. Damage by kind: plain blows 10%, echoes 13%, prismatic hits 51%, the
rest 25%. Nothing degenerate, so nothing was capped. At the attack-speed ceiling against three
dummies (unit test) AUTO casts the Fury 11 times a minute with or without Apex.

### The weeks-long curve

Measured over 60 simulated hours of engaged play (two seeds, `MAXMIN=3600 ASCEND_AFTER=45`), which
is several weeks for most players once offline time is counted:

| Hours | Deepest stage | What the player is doing |
|---|---|---|
| 0 to 3 | 44 | First climb, first Depth (31) |
| 3 to 10 | 44 to 86 | Ascensions every 1.5 to 3 hours, +10 to 20 stages each; Aether tree bought out cheaply |
| 10 to 28 | 86 to 300 | The breakthrough: deep Aether (x1.1 per stage past 60) and the compounding tree push +20 to 30 stages per ascension, a new Depth every ascension or two |
| 28 to 60 | 300 to 450 | The long tail: Might and Vigor near their caps; Limit Break (25 levels) and the Tyrant's weekly tiers carry the power growth |
| 60 to 100 | 450 to 500 | Still moving: about one Rift Depth every 15 to 20 hours |

Past 60 hours (one seed, `MAXMIN=6000`): with Limit Break capped at 10 levels the climb hit a
wall, stage 386 at 68 hours and 395 at 97: Attack and Health were pinned at their 800-level cap.
Raising Limit Break to 25 levels (its cost grows 4x a level, so the last ones are a late-game
sink) turns the wall into steady progress: 449 at 60 hours, 503 at 97, with Attack at 1104 of a
possible 1400 (gold, not the cap, is now the limit). Also uncapping Might and Vigor reached 662
but pulled the mid-game forward by about 100 stages, spending content too fast; not adopted.

What made the difference, found with the simulator:

- Without deep Aether, Aether grows linearly against exponential enemies: every ascension
  reached a little less far and the climb stalled at about stage 98 for the last 15 hours.
- Without Rift Memory each re-climb took three hours of trivial stages and dozens of boss
  presses; with it a re-climb takes 75 to 90 minutes.
- Gold and Aether pass 2^53 around hour 18: saves keep them as plain doubles (up to 1e300), and
  numbers format with suffixes to Dc (1e33), then scientific notation.

### Signature skills

The owner's late game: eight anime-scale skills the warrior casts himself (`data/signatures.ts`
holds the catalogue and every number; the casts live in `src/game/signatures/`, the rules of
finding, ranking and mastering them in `progression/signatures.ts`). They are the idle layer: they
cast whether AUTO is on or off. Without one in a slot (and the crown not found) the World creates
no signature runtime at all: no draw, no event, no stat. That is pinned: five modes at stage 30 for
a late warrior and for one with an army that calls shades, every event, loot drop, snapshot and the
RNG's next draw, match the contract commit (`tests/unit/signatures.test.ts`); and a wider harness
(four warriors, nine modes, three seeds, offline and the boss forecast: 132 digests) matched to the
bit on the final code.

**How a cast runs.** A cast is a timeline in world seconds (so the Fury's slow motion slows it
too): `sig_cast` (where it will land, its windup and length), then each beat at the moment it
happens (`sig_beat`, before the hits it causes), the blows through `World.dealDamage` (the
warrior's attack times the skill's power and rank, crits, Prismatic Edge, defence, guards and
shields; every hit tagged `hit.sig`), statuses on and off (`sig_status`), and `sig_end`
(`interrupted` when the fight ended or the warrior fell). Nothing waits on a renderer. Their blows
charge no energy; their kills charge as any kill. A skill holds the warrior only for its cast time
(Death Parade's vanish and the Sovereign's crown are inside theirs). Bosses are never pulled,
trapped or frozen: Time Fracture only slows a boss's movement, and its wind-ups and telegraphs keep
their time to the step (tested against a twin fight). The boss rule is untouched: nothing here
starts a fight.

**The selection AI** (`signatures/ai.ts`). Nothing begins during the Ascendant Fury, a boss's
entrance, the end of a fight, the warrior's own cast, dodge or stagger, or an empty field; a global
lockout of 1.25 s (raw) separates any two casts and a cinematic skill comes at most once every 6 s.
With the Fury charged and AUTO about to cast it, nothing that would hold the warrior begins. Setup
skills (Void Collapse, Shadow Storm, Time Fracture) want unmarked foes; exploiters (Abyssal
Devourer, Death Parade) hold up to 2.5 s for a setup about to be ready when nothing is marked;
King's Judgement wants a boss or a crowd and never falls on a lone, nearly dead foe; in a boss
fight the boss-effective skills weigh more. It draws nothing (ties go to the earlier slot) and reads
only the world.

**The skills as built** (rank 1; `power` is times the warrior's attack per blow; cooldowns in
seconds; ranks multiply the damage by 1 + 0.12 a rank, x2.08 at 10):

| Skill | Cooldown, hold | What it does | Evolutions (Master: the second step) |
| --- | --- | --- | --- |
| Void Collapse (Rare) | 14 s, 0.2 s | A singularity over the densest group; non-boss, non-armoured foes within 120 drawn in for 0.9 s (they do not act); implodes for 9 on all within 120, its ring 45% of that out to 204; all struck carry a Void Mark (+25% from signature skills, 6 s) | Event Horizon: stronger, 25% wider pull; the drawn are `trapped` 1 s (1.6 s) and the implosion waits 0.35 s for them. Supernova: three blasts leap to the nearest foes (Master: each leaps once more). Consumption: each kill stores a stack (cap 10; Master 16, and each kill takes 0.5 s off its cooldown, up to 4 s): next collapse +7% damage and +3% radius a stack |
| Shadow Storm (Rare) | 10 s, none | Six blades orbit 0.8 s, then launch 0.12 s apart at the densest group within 260 (0.16 s flight), 0.55 each, each leaving a Shadow Mark (+10% from every ally blow, 5 s) | Thousand Blades: twelve blades at 55%, 0.07 s apart. Black Tempest: a ring spreads to 260 over 0.6 s cutting each foe once (Master: twice). Hunter's Instinct: the weakest first, finishing foes left under 15% (Master: a killing blade flies on) |
| Death Parade (Epic) | 18 s, 0.75 s | The warrior vanishes (untargetable, unharmed); four clones 0.12 s apart strike the most wounded first (1.8 each, never the same foe twice while another is unstruck); then he reappears beside the boss or the weakest for a 3.4 finisher; a non-boss foe under 15% is executed | Afterimage: six clones (Master: eight), faster. Executioner: seeks the wounded, +80% below a third (Master +120%, executes under 20%). Phantom King: every strike leaves a Shadow Mark and sets off Hunter's and Blade Parade itself (Master: two blades a strike) |
| Time Fracture (Epic) | 22 s, 0.2 s | A clock over the densest group (a boss if there is one); 0.3 s later everything within 200 stops for 2 s: ordinary foes `frozen` (no move, act or wind-up), a boss `slowed` (45% slower movement). All the damage allies deal them meanwhile is kept and released on resume as a `delayed` impact with a blow of 3 | Stop the World: 3 s (Master 3.6 s), keeping 80%. Fractured Future: each release echoes once at half (Master: twice). Temporal Execution: double release on foes under another skill's status (Master: executes ordinary foes it leaves under 20%) |
| Legion Awakening (Legendary, cinematic) | 28 s, 0.25 s | The field darkens; five soldiers rise where foes fell in the last 6 s (else in a rank by the warrior) and charge (a blow of 4 each on arrival), then fight for 6 s. Their attack is 60% of the fielded army's average, never under 60% of the warrior's, times the rank; they strike with his crits. Temporary shades in all but name: no XP, essence or save, never in the army or its snapshot, not counted by the Caller's Chorus, at most 12 at once | Endless Legion: eight (Master: eleven). Veteran Souls: three, 2.4x health, 1.7x attack, 8 s (Master 10 s). Legion Commander: a Vanguard or Sentinel fielded makes them 1.6x sturdier, a Reaper or Ranger 1.3x sharper, a Caller adds two, a Support lends its banner, an Arcanist makes their charge leave a Shadow Mark (Master: +2 s) |
| Abyssal Devourer (Legendary, cinematic) | 26 s, 0.25 s | A portal at the field's edge on the warrior's side (0.45 s), then the head sweeps to the far edge in 1.25 s along `devourerCurve(from, centre, to)`, biting every foe it passes (reach 44) for 6, at most twice a foe, +40% on the marked or trapped; each kill lets it coil 0.1 s longer at the exit (cap 0.4 s) | World Eater: reach 62 and the whole depth of the field (Master: three bites a foe). Soul Feeder: each kill charges the next bite +50% (cap 3; Master 5), carried to the next cast. Ancient Devourer: it turns and dives from above onto the boss or the thickest knot (5 within 80; Master: twice) |
| King's Judgement (Legendary, cinematic) | 32 s, 0.35 s | Hush, a hand (0.25 s), a sigil (0.55 s), a meteor falling 0.6 s (from 0.95 s), the impact at 1.55 s: 9 within 150, double on a boss. It follows the boss through the windup. Holds rather than fall on fewer than three foes with little health between them | Fallen Star: three stars of 2 follow 0.22 s apart (Master: five). Absolute Judgement: seeks the boss, x3.2 on it in a 70% circle (Master: a second judgement at half, 0.9 s later). World Breaker: 45% wider, and a second shockwave of 1.2 out to twice the radius 0.4 s later (Master: it traps foes 0.6 s) |
| Sovereign Awakening (Mythic, cinematic, the crown) | 75 s, 0.8 s | The army kneels (held 0.6 s), a crown forms (unharmed through the hold), then a 10 s aura (+0.5 s a rank; Master 12 s): other signature cooldowns run 60% faster, summons strike 25% harder, combinations' own effects 30% stronger, and an ultimate cast in it is crowned. Needs another skill equipped and a boss or four foes | (No evolutions: it grows by rank and mastery) |

**Combinations** (`signatures/synergies.ts`; each sends `sig_synergy` before its hits, at most once
per lockout, `first` on the save's first sight; depth one: their own blows set off nothing):

| Combination | Needs | What happens in the fight |
| --- | --- | --- |
| Gravity Feast | Void Collapse + Abyssal Devourer | With a singularity under 3 s old (or two foes trapped or Void Marked) the pass's curve bends through it; as the head crosses it the dragon bites every trapped or Void Marked foe within 150 at once (x1.6, outside the bite count) |
| Hunter's Parade | Death Parade + a marked foe | Clones go to the marked first (Void, Shadow or the Hunter's Mark) and cut them 35% harder |
| Blade Parade | Shadow Storm + Death Parade | Every clone strike looses a blade (two crowned) at the foe nearest it (0.4 at the Storm's rank), leaving a Shadow Mark |
| Legion Meteor | Legion Awakening + King's Judgement | Soldiers standing when the meteor lands hurl themselves in one after another, each an impact of 1.5 within 60; they are spent |
| Frozen Singularity | Time Fracture + Void Collapse | On resume the frozen are drawn together at once and a Void Collapse implosion at 60% fires there (Void Marks included), its cooldown notwithstanding |
| Crowned Ultimate | Sovereign Awakening | An ultimate in the aura is crowned: the Ascendant Fury throws nine strikes, King's Judgement falls 25% wider with one more star, Abyssal Devourer dives once more |

**Statuses** (on `Combatant.statuses`, announced on and off): `void_mark`, `shadow_mark`, `trapped`
(held, no action), `frozen` (no movement, action or wind-up; it does not age), `slowed` (a boss's
movement only). The Hunter's Mark (`mark`) counts as marked. `vanished` holds the warrior out of
reach in Death Parade.

**Finding them** (`checkDiscoveries`; best-ever stage counts across ascensions; the save's new
counters, elites, best chain, fastest boss win and kills of each boss, start at zero on the update;
elites fought offline count):

| Skill | Rule (numbers retuned by measurement) |
| --- | --- |
| Void Collapse | The stage-20 boss falls |
| Shadow Storm | A 40-kill chain (30 came at stage 10 on a new save) |
| Death Parade | 300 elites defeated (100 came at stage 20) |
| Time Fracture (hidden) | A gate challenge or Boss Hunt won within 20 s of the boss's entrance ending (a Rank Trial is not a boss fight: its Warden fell in 7 s at stage 4); a boss felled during its entrance counts |
| Legion Awakening | 12 species sworn: every species there is |
| Abyssal Devourer | The stage-60 boss falls |
| King's Judgement (hidden) | The Crownless King defeated 10 times, gates and hunts alike |
| Sovereign Awakening | The stage-90 boss falls with three skills at Master |

**Slots, ranks, mastery.** Three slots; a fourth once five skills are found (or the best stage
reaches 100). Equip and evolutions change freely while farming, never inside a boss or mode fight;
ranks can be bought any time. The crown is always on once found. Ranks 2 to 10 cost skill points,
each about twice the last (Rare 3, 6, 12, 25, 50, 100, 200, 350, 550 = 1,296; Epic 1,497; Legendary
1,713; Mythic 2,007; all eight 12,732): the first three of a new skill are cheap, and the whole is
sized to the owner's flood of points (below), about three weeks of them. Mastery is one number a
skill, its uses (casts plus the foes it killed), against thresholds sized per skill from its
measured uses a minute (Adept within an evening, Master in about two days of play, Grandmaster in
about a week); Adept opens the evolution choice, Master awakens its second step, Grandmaster is the
gilded look and a title:

| Skill | Adept | Master | Grandmaster |
| --- | --- | --- | --- |
| Void Collapse | 160 | 4,700 | 16,000 |
| Shadow Storm | 80 | 3,700 | 13,000 |
| Death Parade | 130 | 3,400 | 12,000 |
| Time Fracture | 80 | 1,600 | 5,600 |
| Legion Awakening | 150 | 3,000 | 10,500 |
| Abyssal Devourer | 200 | 4,000 | 14,000 |
| King's Judgement | 150 | 1,600 | 5,600 |
| Sovereign Awakening | 40 | 340 | 1,200 |

Offline credits mastery at half the sampled rate, at most two hours of live play's worth, and never
casts or reveals anything; tier-ups earned offline are listed in its summary
(`OfflineSummary.signatures`).

**Reveals.** Found skills wait in line and are revealed one at a time, once the screen has been
calm for three seconds (no card up or waiting, no press): only while farming, never over another
card, never during a boss or mode fight, never from offline. `signatureRevealed` marks one seen and
closes its card; the next follows after another calm moment.

**Power** counts the equipped skills by their measured share of boss damage (`SIG_BOSS_SHARE`),
times their rank, evolution and mastery, the crown on top. They have no row of their own in the
Power sheet (its sources are the menus'); until one is added they are spread over the others.

**Balance, measured** (the economy simulator's warriors: its player from a new save at gates 21
and 60, and at the end of a 1,000-minute climb, level 561, every Art at V, all Apex ranks,
stuck at gate 72: the closest the simulator gets to the owner's late fights). Boss damage is the
damage dealt to the gate's boss over the fight proper with its health raised so the fight runs its
full time, AUTO on, three seeds of 90 s (singles) or four of 120 s (full loadouts):

| Equipped | New player, gate 21 | New player, gate 60 | Level 561, gate 72 |
| --- | --- | --- | --- |
| Void Collapse, rank 1 | x1.12 | x1.12 | x1.05 |
| Shadow Storm, rank 1 | x1.16 | x1.15 | x1.13 |
| Death Parade, rank 1 | x1.18 | x1.11 | x1.00 |
| Time Fracture, rank 1 | x1.09 | x1.16 | x1.12 |
| Legion Awakening, rank 1 | x1.23 | x1.04 | x1.05 |
| Abyssal Devourer, rank 1 | x1.18 | x1.09 | x1.05 |
| King's Judgement, rank 1 | x1.14 | x1.09 | x1.07 |
| Void, Parade, Devourer, Judgement + crown, rank 1 | x1.92 | x1.46 | x1.29 |
| The same, rank 10, evolved, Master | (x3.9) | x2.47 | x2.07 |
| Fracture, Legion, Storm, Parade + crown, rank 10, evolved, Master | (x3.5) | (x2.1) | x2.03 |

A skill alone at rank 1 adds 9 to 23% to a new player's boss damage where it is found, and 0 to
16% to a late warrior's: his arts are at rank V and the Fury every four seconds carries most of his
damage; Death Parade's hold costs about what its blows add for him until it is ranked. A full late
loadout doubles a late warrior's boss damage (x2.03 to x2.07; the target was x1.8 to 2.3). The
bracketed cells are loadouts no new player can have there.

**Gates gained.** The boss forecast's own fights (four seeds a gate, two wins to pass) on the same
warriors, with and without:

| Warrior | Equipped | Without | With | Gained |
| --- | --- | --- | --- | --- |
| New player at gate 21 (two seeds) | Void Collapse 1 | passes 21, fails 24 (35% left) | passes 21, fails 24 (27% left) | 0 |
| New player at gate 39 (two seeds) | Void, Legion, Parade 1 | fails 39 (28 to 35% left) | fails 39 (11 to 29% left) | 0 |
| New player at gate 60 (two seeds) | Abyssal Devourer 1 | fails 60 (28 to 31%) | fails 60 (23 to 26%) | 0 |
| New player at gate 60 (two seeds) | Void, Legion, Parade, Devourer 1 | fails 60 | passes 60, fails 63 | 1 |
| Level 561, stuck at 72 | four + crown, rank 1 | fails 69 (5% left) and 72 | passes 69, fails 72 (35% left) | 1 |
| Level 561, stuck at 72 | four + crown, rank 10, evolved, Master | fails 69 and 72 | passes 69 and 72, fails 75 (34% left) | 2 |

Over a whole climb the simulator's player who equips what it finds (as a player tapping Equip on
each reveal would) reaches the gates sooner but stalls at the same wall: seed 101, gate 60 at 124
minutes (175 without), 66 at 179 (241), 69 at 217 (416), 72 at 542 (784), then stuck at 72 like
its twin; seed 102, 60 at 163 (156), 69 at 300 (250), 72 at 562 (never in 1,000 minutes). At any
moment it is at most one or two gates ahead.

**The Fury and AUTO's rhythm** (four seeds of 120 s; level 561 and gate 60, full late loadouts):

| | Boss fights | Farming (stage 71 / 59) |
| --- | --- | --- |
| Fury casts a minute, without / with | 15.0 / 13.6 (x0.91), 15.0 / 14.0 (x0.93); gate 60: 14.75 / 13.25 (x0.90) | 10.75 / 8.88 (x0.83), 10.75 / 9.13 (x0.85); gate 60: 9.38 / 8.00 (x0.85) |
| Signature casts a minute | Void 5.0, Parade 3.75, Devourer 2.1, Judgement 2.0, Sovereign 1.0; Storm 6.4, Fracture 3.25, Legion 2.5 | Parade 2.9, Void 2.75, Devourer 1.4, Judgement 0.9, Sovereign 0.5; Storm 4.75, Fracture 2.1, Legion 1.5 |
| Gap between casts | at least 1.25 s (the lockout), median 2.65 to 3.8 s | at least 1.25 s, median 3.5 to 4.5 s |
| Two casts beginning at once | never | never |
| Casts while another is still running | (cinematics excepted, by design) | 21 to 66% |

In boss fights the Fury comes 7 to 10% less often, the price of the holds (with every hold set to
zero, measured, it came exactly as often: 15.0 a minute); no hold begins while AUTO is about to cast
a charged Fury. In farming it comes 15 to 17% less often although kills a minute are the same (63
to 65): the warrior's own blows and arts find fewer foes standing, so his energy income falls 15%
(1,104 to 938 a minute), and AUTO keeps a charged Fury for three foes at once, which a field the
skills keep thin offers less often (charged and waiting 33% of the time without, 39% with). Their
blows charge nothing and their kills charge as any kill, as asked; nothing degenerate was found, so
nothing was capped. The simulation's step costs 10.7 µs without signature skills and 20.1 µs with
four (Endless Legion's eleven soldiers included) on this machine, headless.

**Pacing, measured** (the simulator's player with a `SigSim` on top: it finds skills by the rules,
taps Equip on each reveal into the first empty slot, takes the first open evolution, and spends
skill points on Apex first, then on the cheapest signature rank of what it has equipped).

*The owner* (two seeds): the simulator's warrior at the end of its 1,000-minute climb (level 561,
every Art at V, all Apex ranks, 202 to 213 points banked), raised to level 570 with a best-ever
stage of 84, then ascended (Aether spent as the simulator does) and climbing again from stage 1. A
day is four hours of AUTO (two real hours at 2x) then an eight-hour offline credit; times are minutes
of play since the update.

| | Seed 101 | Seed 102 |
| --- | --- | --- |
| Found on the first load (revealed one at a time) | Void Collapse, Legion Awakening, Abyssal Devourer | the same |
| Shadow Storm (40-kill chain) | 2 min (stage 15) | 5 min (stage 40) |
| Time Fracture (gate 87 won in 6.6 s) | 13 min | 13 min |
| Fourth slot (five found) | 13 min | 13 min |
| Death Parade (300 elites) | 31 min | 35 min |
| Sovereign Awakening (stage 90 and three Masters) | day 3, 530 min | day 3, 581 min |
| King's Judgement (the Crownless King ten times) | not in 7 days (6 kills: gates only, no Boss Hunts) | not in 7 days (8) |
| Adept (Void, Storm, Devourer, Legion) | 37, 29, 48, 56 min | 31, 27, 52, 63 min |
| Master | Devourer 359 (day 2), Void 434 (day 2), Storm 530 (day 3), Legion 886 min (day 4) | 355, 466, 581, 795 min |
| Grandmaster | Devourer 1136, Void 1169 min (day 5); Sovereign 1646 (day 7) | Devourer 1059 (day 5); Void at 15,954 of 16,000 uses on day 7 |
| Ranks | Void, Legion, Devourer to 5 at once (banked points), Storm 5 at 16 min; Void 10 on day 5, Storm 10 on day 7 | the same at once; Void 10 day 5, Storm day 6, Legion day 7 |
| Points spent in the week (of 12,732 for everything) | 5,735 | 6,455 |
| Best stage at the end of each day | 113, 116, 116, 116, 119, 119, 119 | 116, 119, 119, 119, 122, 122, 122 |

His points come from levels past 150: about 2,700 the first day (the re-climb pays enormous XP:
level 570 to 2,900), about 1,000 the second, falling to about 400 a day by the seventh. Mastery
offline adds 250 to 1,900 uses a skill a night. Without signature skills (seed 101) the same week
ended at 119 too (113 the first day); the forecast on his own day-3 and day-7 profiles, with his
skills as equipped and with the slots emptied, says one gate (114 and 117 pass with them, fail
without); his boss damage as equipped is x1.78 (day 3) and x1.80 (day 7), the Fury x0.94.

*A new player* (1,000 minutes of play from a new save, no offline; seed 101 on the final code, seed
102 before the last price change, which only touches ranks):

| | Seed 101 | Seed 102 |
| --- | --- | --- |
| Void Collapse (stage-20 boss) | 27 min (stage 21) | 26 min (21) |
| Legion Awakening (all 12 species) | 27 min (21) | 46 min (33) |
| Shadow Storm (40-kill chain) | 46 min (36) | 16 min (12: an early burst) |
| Death Parade (300 elites) | 57 min (41) | 59 min (40) |
| King's Judgement / Abyssal Devourer | 218 min (60) / 218 (61) | 238 (60) / 239 (61) |
| Fourth slot | 218 min | 238 min |
| Time Fracture | not found: its fastest gate win was 38 s (it never hunts) | not found (37.8 s) |
| Sovereign Awakening | not reached (the climb stalls at 69 to 72) | not reached |
| Adept, 25 to 60 min after equipping | Void 51, Legion 59, Storm 61, Parade 244 (equipped at 218) | Storm 28, Void 47, Legion 79, Parade 261 |
| Master | 608 to 731 min | 616 to 733 min |
| Rank 5 | 603 to 988 min (points are scarce before level 150) | (cheaper prices: 203 to 323 min) |

**What the renderer and the menus can rely on beyond the contract** (added, nothing renamed):
`death.sig` (the skill whose blow or soldier killed it; on a Legion soldier's own end, that it was
one); `SignatureLoadout.known`; `OfflineSummary.signatures`; the statuses above on `StatusKind`;
`World.sig` (the runtime: `casts`, each with its live `head` for the Devourer), `World.sigStrike`,
`World.bossEngagedAt`, `World.furyStrikeCount` (nine when crowned: `fury_step` indices run to 9);
`signatures/geometry.ts` (`devourerCurve(pass.from, sig_cast.center, pass.to)` is the dragon's path,
`orbitPoint` the Storm's orbit). Beats sent under another skill's cast: Death Parade's `blade` (Blade
Parade), King's Judgement's `charge` (Legion Meteor: from the soldier to the impact), Time Fracture's
`pull` and `implode` (Frozen Singularity), Abyssal Devourer's `impact` (each dive's landing).
`targetIds` of `rise` and `charge` (Legion) are the soldiers, of `kneel` the army; the crowned Fury's
`sig_synergy` has `castId` 0. The progression module adds `checkDiscoveries`, `discoveryMet`,
`markRevealed`, `equipSignature`, `unequipSignature`, `firstEmptySlot`, `buySignatureRank`,
`addMastery`, `masteryUses`, `masteryTierFor`, `chooseEvolution`, `recordSynergy` and
`signatureDamageMult`; `combatPower` takes the signature multiplier as a third argument.

## Studio review, round 3 (the always-on loop)

Three independent reviewers (combat, summoning and creative; mobile UX, hostile player and
technical; game director, idle and economy), each playing the built game and measuring in the
simulation. Decisions:

| Finding | Decision |
| --- | --- |
| Telegraphs drawn about a quarter of their real height | Fixed: drawn with the simulation's own geometry |
| Perfect dodge granted a second early; auto-dodge wasted its cooldown | Fixed: real time-to-impact on every boss move; AUTO dodges late and only half the time |
| Boss counters ask for movement the player lacks | Fixed both ways: the dash now leaves telegraphs and burning ground, and the lines name real verbs |
| Three summon passives did nothing | Fixed (Warden's Presence, Bulwark slow, Fast Hands) |
| Summon actives idle against a lone boss | Fixed; bosses also respect taunts |
| Shadows indistinguishable | Species sigil colours on weapons, eyes and ability bursts |
| Boss shadows could never be bound (victory card covered BIND) | Fixed: BIND from the card; orbs wait while cards are open |
| Health bars leaked on every world swap | Fixed |
| A pending post-fall beat could overwrite a newly started run | Fixed; runs cannot start while regrouping |
| Hard wall at gates 30 to 36; gates 1 to 27 trivial | Rebalanced (see Economy); early gates stay quick by choice, as the climb that teaches the loop |
| AUTO's casts never landed (overwritten in the same tick); dodges never dashed | Fixed; the ultimate frees him on return and charges nothing while it runs, and one boss-health rule keeps the gates' odds (see AUTO casts) |
| Eight hours offline erased the curve | Cap now grows with bosses won; 40% fought |
| Rift Cores starved while shards piled up | Shards refine 25:1 into cores |
| Boss rematches for repeat rewards | Deferred: refining covers the core shortage without inviting boss farming |
| Directional swipe dash | Deferred in favour of the automatic escape direction, which keeps the one-thumb control |
| Elite affixes with new behaviours | Done: Brutal smash, Hasted lunge, Armored guard |

Final QA (the brief's twelve checks, played in real time on the built game): 11 passed first
time, including no automatic retry after 30 s and more, offline credited once and gate-safe, and
a 13-minute session with flat entity, node and heap counts and victories equal to boss wins.
The mobile layout check failed on HUD overlaps; those were fixed (HUD zones for BIND pills, the
Push chip moved and hidden during falls, compact top bar and Rift tiles at 320 px) together with
a panel that could stick after fast tab switching, and each now has a browser test.

## Art direction: "Ink and Gilt"

- Palette: charcoal ink surfaces, antique gold trim, jade for life and essence, slate and gold
  for the shadow army, crimson for threat, a muted teal only in the Drowned Hollow. No neon and no
  purple gradients.
- The hero is the only pale figure on the field. Enemies are ink; their eyes carry the archetype
  colour. Shadows are slate with a gold edge and glow.
- Type: Marcellus for display and numbers, Manrope for body text.
- Spectacle scales with significance: duplicates resolve quickly, first and rare shadows get the
  full rite, rank-ups and boss kills get slow motion and a ceremony.

## How a blow is shaped

A swing is four parts, and each has its own curve (`src/game/render/rigs/pose.ts`). The
simulation's timings are untouched: the player's basic attack is still 0.13s of wind-up, 0.12s
of attack and 0.12s of recovery, and damage still lands on the first frame of the attack.

| Part | What the body does | Timing |
|---|---|---|
| Anticipation | Weight back, arm up, spine leaning away. The coil is reached in the first 60% of the window and then held, still loading 7% further, so the wind-up is seen before the blade moves. A long wind-up (a brute, a boss) trembles in the hold | The wind-up, less the strike |
| Strike | From the loaded coil into contact, accelerating (ease-in cubic) | The last 30% of the wind-up, 35 to 140ms |
| Contact | The pose is held with the hit-stop. The third swing of the combo holds half as long again | 40ms, 60ms on the third swing |
| Recovery | The follow-through is held for the first 30%, then the body eases back to guard, the weapon last | The recovery |

A combo left alone for 0.9s starts again from its first swing. The third swing is the beat the
other two lead to: a longer hold, a harder camera kick, a ring and dust.

Hit-stop (`src/game/render/hitStop.ts`) is short and read through the struck body, which
shudders a few pixels along the blow while it is held:

| Hit | The two bodies hold | The world stops |
|---|---|---|
| Light | 33ms | – |
| Critical | 35ms | – |
| Third swing of the combo | 50ms | – |
| Heavy blow or ability | 60ms | 33ms |
| Boss phase change; a boss's death | – | 100 to 110ms |

A struck body flinches away from whoever struck it, not simply backwards. The camera shakes only
for heavy blows, blows taken and bosses; an ordinary hit nudges it 3px along the blow, and the
army's hits never move it.
With reduced effects (the game's setting, or the device asking for less motion) there is no
shake, no stop of the world and no shudder.

A perfect dodge slows the world to a quarter speed for 0.35s, then lets go over 0.25s, fast at
first (an ease-out cubic); the backdrop sinks toward ink for that moment so the fighters stand
out.

## How a blow sounds

Every sound is synthesised in code (`src/game/audio/synth.ts`); the fight's rules live in one
pure module (`src/game/audio/cues.ts`) and the mix's density budget in another (`mix.ts`).

- **Struck, not swept.** Anything that can play more than about once a second (the swings, hits,
  crits, the army's blows, kills, blocks, the Fury's strikes) is a transient, a body and a quick
  exponential decay. It holds its pitch: at most a low thump settling in its first 20ms, and a
  playback rate within 3%. Tones that ring are struck partials at a fixed pitch. The tests hold
  every sound in `FREQUENT_SFX` to this, because pitch glides repeated several times a second
  are what made the old mix sound like sirens.
- **The combo is a rhythm.** The whoosh plays as the wind-up starts, one per swing of the
  three-swing combo (filtered noise, no tone): the forehand falls, the backhand rises, the
  overhead is lower and longer, and its blow lands as the heavy hit. The renderer says which
  swing it is posing (`comboSwing`); without a renderer the cues count the swings the same way.
- **Crits and kills are the rewards.** A crit is the hit with a short bright ring on top (B5 and
  its fifth, gone in a tenth of a second); a kill is a thud with a small E5 ping. Over budget, a
  crit falls back to its plain hit.
- **The Fury is a phrase.** Its seven strikes are notes of D natural minor on a struck D4, the
  seventh a heavy low D over an impact; consecutive casts take the next of three figures, and a
  Fury cut short still lands its final note.
- **Density has a budget.** Per category, in real time: swings 3 per 600ms, the warrior's hits 4
  per 400ms, crit rings 2 per 700ms, kills 3 per 700ms, the army 2 per 500ms. The army also
  yields for 90ms after any blow of the warrior's and only fills room under 5 impacts per 400ms,
  so at 2x speed with three shadows the mix thins instead of doubling. Reduced effects tightens
  every budget.
- **Levels.** The warrior's whooshes sit 6 to 10dB under his hits, the army's blows under those,
  and the Fury's final strike and the boss sounds on top. A soft limiter on the master bus is a
  safety net; a measured late-game mixdown peaks under full scale without it.
- **The ambience is still.** A low D, its fifth and octave (whole cycles in the 12s loop) and a
  deep noise wash crossfaded into itself at the seam: nothing beats, pulses or dips.

## How the Apex skills look and sound

The late game's four skills (`src/game/data/apex.ts`) are dressed in `src/game/render/apex/`.
At full ranks the warrior lands nearly ten blows a second at 2x, so the rule is restraint in the
common case and the show in the rare one.

- **Echo blows** (Double and Triple Strike) are one flourish with the swing that threw them: a
  coloured ghost of the warrior in the next cut of his combo, half a step behind him; a storm-blue
  rising arc on the target for the second blow, a white-violet lightning cut with two short forks
  for the third. An echo that jumped to a new body draws a jagged streak from the old one. Echoes
  stop nothing, move no camera and only tint the struck body (a body hit ten times a second must
  not strobe); the third shudders it for 16ms.
- **One figure per swing.** A swing's echoes on the same body fold into its figure, which ticks
  up and carries a small "×2" or "×3" in the echo's colour. An echo on another body starts its
  own figure. Prismatic figures stack with the ordinary ones.
- **Prismatic hits** are the rainbow: a figure cut glyph by glyph from an atlas drawn at mount,
  each glyph tinted from the spectrum by its place and the time, with a dark edge so it reads on
  every ground; a fan of spectral shards, a three-colour chromatic ring, the slash split into
  colour fringes for six frames, and the weapon ribbon iridescent for that swing. Colours are drawn
  over, not added as light, so they hold on the pale regions.
- **Lightning** comes from a bank of sixteen forked shapes made once by midpoint displacement
  (`lightning.ts`): drawing a bolt is a transform of points already made. A bolt races in, holds,
  dips once and strikes again on another channel, then fades: never a strobe.
- **Stormcrown's bolt** falls from above the frame to the target's feet beside a thinner coloured
  channel, crawls along the ground to each fork and climbs each foe, leaves scorch marks and a pool
  of light, and rings the ground. Its light (a pale flash, the backdrop sinking behind it, nearby
  bodies catching it) is one flash of the budget; its hits ride inside its own crack in the mix.
- **The warrior's form** grows with the ranks: a storm-blue light and motes on the blade (Double
  Strike), arcs crawling over blade and forearm in a combo (Triple Strike), an iridescent strip
  along the blade's edge (Prismatic Edge), and with Stormcrown a thin prismatic halo with five
  tines, a slow ring of colour at his feet and a cape that catches colour. The halo, the aura and
  the blade's lights are drawn once and only moved, turned and faded each frame.
- **Rank-ups** (`apexRankUp` on the renderer): a ring, motes up his body and a glint at the blade's
  tip with a two-note stinger a step higher each rank; a first rank or a maxed skill adds rings,
  shards or a bolt onto the blade and a chord. Under a second; the fight runs on.

**Flashes.** Every full-screen flash in the game asks one budget (`src/game/render/flashBudget.ts`):
at most three start in any sliding second of real time, alpha at most 0.45, a saturated red is
pulled to a warm grey, and with reduced effects none at all. With reduced effects there is also no
shake, no colour fringe (the chromatic ring is one white ring), no re-strike flicker and no
shudder; the blows read through shape, figures and sound.

**Sound.** An echo is a tiny tick (the third a three-snap crackle), budgeted at two per 450ms so
the ear keeps the rhythm and most are dropped; a prismatic blow is the hit under a glass chord
(D6, A6, D7, A7 struck as a quick strum), falling back to the crit and then the hit; the bolt is a
dry crack with the thunder's low roll a tenth of a second behind it in the same sample. The
stingers climb D minor. None glides; the tests measure them like the rest.

**Measured** (stage 49, five shadows, a crowd, AUTO at 2x, 30 s a side, the renderer's own
counters): damage figures started per second 7.3 without Apex and 7.5 with every rank at 412px
(9.0 and 8.8 at 320px), with 2.7 to 3.0 echo blows a second folded into a figure already showing;
the most flashes the budget let start in any second, 3. Frame time with the `?perf=1` instrument
(simulate plus render JS, 95th percentile, two rounds of 40 s a side, interleaved): within 10% of
the same scene without Apex at 4x CPU throttling, and as noisy as the machine at 1x; the Apex
section itself is 0.1ms at the median.

## How the signature skills look and sound

The eight signature skills (`src/game/data/signatures.ts`) are staged in `src/game/render/signatures/`.
The simulation sends each cast's moments as events (`sig_cast`, `sig_beat` at the world moment a beat
happens, `sig_status`, `sig_synergy`, `sig_end`, and `hit.sig`); a `SignatureDirector` turns each cast
into a stage that reacts to those beats and animates between them, on the fight's own clock (world
seconds: slowed with it, held in a stop). Damage is never the renderer's: a cast plays the same with
the renderer, without it, and at every quality. The director never writes to the world.

**One toolkit, eight looks.** Every skill is composed from one pooled, capped toolkit (`kit.ts`):
ground rings and shockwaves (an ink band under a white-hot line), cuts and slashes, streaks (speed
lines, the radial smear of bending space, trails), debris spirals (pieces started round a ring and
drawn in by an attractor), lent sprites, graphics and rigs, afterimages (a rig posed once and faded),
camera push-ins (one owner at a time, always released), stops and flashes through the renderer's one
hit-stop policy and the flash budget. What makes each skill recognisable is its own shape, motion and
colour, not a tint: violet and electric blue are ink (deep washes drawn over the scene), the light is
white-hot cores and gilt; Apex's spectrum stays Apex's.

| Skill | Anticipation | Action | Impact | Aftermath |
|---|---|---|---|---|
| Void Collapse | a point of black tears open above the group's heads; a violet-ink lens, a white-violet photon ring, an ink pool on the ground | accretion rings spin up (the far half behind the core, the near half in front); gravitational rings contract over the ground; light smears inward; debris spirals in; the caught lean and stretch toward it | the core collapses to a point, a beat of nothing, a white-violet star and the flash; bodies snap back | a circular shockwave runs out over the ground kicking dust; Void Marks over the struck |
| Abyssal Devourer | a jagged rift tears where the dragon's path enters the frame; the field dims, the camera leans in | a serpent of ink scales pours out and flies the simulation's own curve; every segment follows the head's path (a serpentine wave in it, a ripple down it); fins, whiskers, crimson eyes, smoke | the jaw opens as a foe nears and snaps on each bite: crimson crescents, ink spray | a second rift swallows it tail last |
| Death Parade | he breaks into ink and slate motes (an ivory afterimage left); the field dims; a crimson tick over each foe he will visit | slate-and-gold clones blink in beside their foes (afterimages, speed lines), each striking its own way: rising cut, overhead, dash through, cross, falling stab, reversed cut | he reappears, a glint runs his blade, one long crimson cut through every foe visited; a stop, the flash, speed lines | the clones break into ink |
| King's Judgement | the field falls to ink and the mix dips (the hush); a spectral gilt hand opens above the target finger by finger | a gold sigil draws itself on the ground (gold, never the foes' crimson) and pulses faster; the hand closes and points; an ink meteor with molten gold fissures falls with smoke and embers | the biggest blow in the game: a white-gold star, the flash, a stop, one shake, three rings, rock and gold thrown up | a smoking crater; the sigil breaks; the hand dissolves into gold dust |
| Legion Awakening | the field sinks to night | an ink pool opens under each soldier the simulation raises (a gold spark ring at its lip) as it claws up out of it | a gold war-cry ring; the rank charges with speed lines and dust | they sink back into ink |
| Time Fracture | a pale silver clock stands over the field, hands running backwards, electric-blue cracks spreading | the hands stop dead; colour drains from the backdrop; the frozen go pale glass and hold mid-motion; motes hang; a tick each half second, the cracks grow | the clock shatters into glass; a ripple in and out | every held blow lands at once: a blue-white star and a ring of cracks on each body |
| Shadow Storm | violet-ink blades with white edges cut themselves out of the air and orbit him on a tilted ring, passing behind and in front of him | one by one they leave the orbit and fly an arc to their foe, an ink wake behind each | a short violet cut with a white edge; a Shadow Mark | — |
| Sovereign Awakening | the field darkens; his army kneels | a column of violet ink rises round him, gold gathers, the crown draws itself spike by spike; the camera leans in | it settles on his brow: a ring, the flash | the reign: a slow violet ring at his feet, a small gilt crown floating over his head, a violet cape; at its end the crown breaks into gold dust |

**Evolutions** each change what is seen, not only the numbers: Event Horizon locks a bright horizon
ring on the ground and cages the trapped; Supernova throws white embers that burst into eight-ray
stars (Master: six-ray chains); Consumption carries the fallen's souls orbiting the next core, which
collapses larger. World Eater is a larger dragon sweeping the whole depth; Soul Feeder tears souls into
the maw and lights a pulse running down the spine; Ancient Devourer climbs out of the frame and dives
from above onto its landing. Afterimage leaves a chain of copies behind every blink; Executioner gives
the clones crimson eyes, reticles on the wounded and a guillotine stroke from above; Phantom King
crowns the clones in gilt and their cuts throw violet sparks. Fallen Star sends smaller meteors with
their own rings; Absolute Judgement makes the hand larger, crowns the sigil and echoes on the boss;
World Breaker cracks the ground in gold and rolls a second shockwave. Endless Legion raises more,
quicker; Veteran Souls raises big armoured greatswords who do not sink; Legion Commander gives each
soldier a fielded role's colours. Stop the World stands a larger clock with a minute ring and drains
the field further; Fractured Future echoes each release as a ghost of the clock's hand; Temporal
Execution turns the release crimson-gold on bodies under another mark. Thousand Blades: smaller blades
in two counter-turning rings; Black Tempest: a ring of spinning blades runs outward over the ground;
Hunter's Instinct: crimson glints and a seeking hook that ends in a stab from above.

**Mastery.** Master adds a layer: Void's counter-turning rune ring, the dragon's full mane of fins and
violet motes, a crimson ink trail behind every clone's blink, the sigil's outer rune ring, the gold
standard-line under the Legion's charge, the clock's minute ring, a second light trail on each blade,
a second ring at the Sovereign's feet. Grandmaster gilds: the white-hot light turns gilt, rims and
fins go gold, the figures read in gold.

**Combinations** get their own moment, and a name on the field once a fight: Gravity Feast (the
dragon's curve already bends through the singularity; its jaws snap three times there in a violet and
crimson whirl), Hunter's Parade (a crimson reticle on the marked, heavier gilt-edged cuts), Blade
Parade (shadow blades fly from every clone's strike), Legion Meteor (each soldier hurls itself into
the fall as an ink comet with a gold head and adds a ring), Frozen Singularity (the glass of every
frozen body streams into a small singularity that implodes), Crowned Ultimate (a gilt crown flares
over the warrior; a crowned dragon wears a crown and gold eyes, a crowned judgement a larger hand).

**On bodies.** Void Mark: a small black singularity glyph ringed in violet over the head; Shadow
Mark: two crossed shadow blades; trapped: a violet cage ring at the feet; frozen: the body pale glass,
cold and held mid-motion, with shards; slowed (a boss in the freeze): a slow clock under its feet.

**Readability.** The singularity hovers above heads, not on them; the dragon's segments thin out near
the hero; the warrior's own hit sparks, telegraphs and the boss's wind-up rims are never covered by a
signature's ground layer (it sits under the fighters). A signature's many hits only react on the body
(a flinch, the white, a few sparks): no camera, no stop. The big moment of each cast asks the camera
and the flash budget once. No constant shaking: a shake is a single one-off at a landing.

**Figures.** A signature hit's figure is in its skill's colour; one cast's repeated hits on a body (a
dragon's two bites, a storm's blades) fold into one figure with a small "×n".

**Visual quality** (Settings; `setVisualQuality`): full, balanced, performance. Lower tiers cut
particles (×1, ×0.6, ×0.3), secondary layers (rune rings, smoke, trails), distortion (the smear and the
bend), camera moves and afterimages, and draw fewer dragon segments (26, 22, 15); every tier keeps
each skill's silhouette and impact. Reduced effects is stricter at any tier: no flash, shake, stop,
distortion, push-in or fringe; the fewest particles; shapes, colours and motion still say which skill
it is.

**Caps and cleanup.** At most two cinematic casts (one in performance) and five or six casts at once
are staged in full; past that a cast gets its compact form (key silhouette and impact only), and past
ten only its figures. Marked bodies ≤ 40, lent sprites ≤ 220, rigs ≤ 18, two dragons, 40 rings, 32
cuts, 120 streaks. A new world drops every cast, mark and modifier; a body that leaves loses its marks.
If frames stay slow (60% of frames over 26 ms in a 3 s window) while signature effects are on screen,
the renderer steps the signature visuals down a tier on its own (never below performance; a new
choice in Settings resets it) and says so in diagnostics (`quality: balanced (auto)`).

**Preview and reveal.** `renderer.previewSignature(id, evo, { mastery, synergy })` plays the same
director on stand-in figures (the hero, a knot of ink foes, the army for the crown) in a sandbox above
the dimmed fight, from the synthetic driver (`driver.ts`), which writes the simulation's own timings
and beat shapes; it deals nothing and writes nothing. `stopPreview()` closes it. The reveal
(`playSignatureReveal(id)`) darkens the screen, draws the skill's sigil (a gilt ring, its rarity's
ticks, the skill's emblem), then plays its animation; it returns when the name and the details may
show (legendary and mythic: 0.9 s and 5.4 s of a 6.4 s rite; rare and epic: 0.5 s and 2.6 s of 3 s)
and holds until `endSignatureReveal()`; `skipSignatureReveal()` jumps to the details. The game's
reveal does not use that canvas rite: the `signature_reveal` sheet draws the rite itself (sigil, name,
rarity, words) and asks for a held preview in the band of battlefield it leaves clear
(`previewSignature(id, null, { hold: true, band })`, the top 40% of the screen): the stand-ins are laid
out in that band, the skill plays again after a breath while the words are read, and the sheet stops it
when it closes. One sigil, one darkening. A preview is refused during a boss or mode fight (the fight's
telegraphs are never dimmed under stand-ins). The camera takes in a cast aimed away from the warrior
(its `focus`: a singularity, a clock, the judgement's hand, a volley's knot) so nothing plays at the
screen's edge. When the step-down has acted, Settings says which tier is drawn.

**Sound.** Each skill's moments have their own synthesised voice: the singularity's indrawn air and
its implosion (a crack, a sub drop), the rift tearing and the dragon's growl, its bites, the vanishing
snap, the clones' thin slices and the finisher's ringing cut, the hush's far bell, the meteor's
falling whistle and the impact (the deepest sound in the game, a struck D minor inside it), the
Legion's rising low chord and war drums, the clock's tick-tock, glass held ringing and shattering, the
blades whirring up and zipping, the crown's chord. A combination is two struck chords a step of D minor
apart for each. The small repeated blows (clone cuts, blades, bites, signature hits) are struck at a
fixed pitch and budgeted (three in any 400 ms); a signature hit is a quiet tick, never the warrior's
hit on top. The hush dips the whole mix for 0.9 s.

**Measured** (`?perf=1`, stage 49, five shadows, AUTO at 2x, four skills equipped and the crown,
balanced quality, two interleaved rounds of 25 s a side, software WebGL, so noisy): simulate plus
render JS at the 95th percentile was 12.8 ms with signatures against 16.6 ms without at 1x, and
45.6 ms against 49.2 ms at 4x CPU throttling: within the noise, and the signature scene kills faster,
so it often had fewer bodies on the field. The signature section itself costs 0.3 to 3.2 ms at its
95th percentile. A first build that redrew its rings and accretion discs every frame measured 1.28x
and 1.36x; drawing them once and only moving them (sprites, cached shapes) is what brought it down.

## Testing

- `npm run test`: unit tests for every rule, plus a balance harness that simulates whole runs with
  passive, active, spender and upgraded player policies, and checks that every heavy boss blow is
  announced by the perfect-dodge window no more than 0.45 s before it lands.
- `ECON_SIM=1 npx vitest run tests/unit/economy.sim.test.ts`: the economy simulator (see Economy).
- `npm run test:e2e`: Playwright on a phone profile and six viewports from 320x568 to 430x932,
  driving real taps and holds against the production build.
