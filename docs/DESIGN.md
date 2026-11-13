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
   tutorial. AUTO really casts: its arts, dodges and Ascendant Fury land and hold their cast time
   exactly as a cast by hand (see "AUTO casts" below).
2. Enemies marked with pale light leave a shadow. BIND shows its success chance before the tap.
3. Spend gold on stats (hold to upgrade), essence on shadow bonds, Rift Cores on evolution.
4. Level ups offer a choice of three perks. Clearing stages unlocks modes, ranks and regions.
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
| Hunter rank E to S via Rank Trials | Working | `src/game/progression/ranks.ts` |
| Modes: campaign, Gold Vault, Essence Rift, Endless Ascent, Rank Trial | Working | `src/game/data/modes.ts` |
| Quests, achievements, journal, bestiary | Working | `src/game/progression/quests.ts` |
| Gift codes (signed, once per save) | Working | `src/game/economy/codes.ts`, `scripts/make-code.mjs` |
| IndexedDB saves: versioned (v12), validated, backed up, migrated, unload-safe | Working | `src/persistence/` |
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
- Level cap 150, shadow cap 40. Quest gold is a few stage clears per quest.
- Offline: up to 2 hours on a new save, +30 minutes per boss won, to 8 hours; the warrior fights
  40% of it, sampled from real cycles, and never passes a gate.

Measured (two seeds): gates 1 to 30 in about 40 minutes with short waits, then a few minutes to
over an hour of farming per gate through 42 to 48, reached after 3 to 5 hours of engaged play.
Ascension is the answer to the late ceiling: in eight simulated hours the same player stalls at
stage 51 without it and reaches stage 66 ascending whenever stuck for 30 minutes
(`ASCEND_AFTER=30` in the simulator).

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

### AUTO casts

Until this change, an ability cast by AUTO was overwritten in the same tick by the movement and
attack logic: impact arts (Arc Slash, Thunder Strike, Soul Burst, Void Nova and the techniques)
never landed, AUTO dodges never dashed, and he kept swinging through his ultimate. The balance had
been tuned on that. With the fix (`World.updatePlayer` stops when AUTO acted) three adjustments
bring the pace back near where it was:

- Ascendant Fury lands a sword cut on each lead: a basic blow at `FURY_CUT_POWER` (0.25), with
  its crits, on-hit effects and energy. It gives back the swings the cast lock now takes during
  the ultimate; late boss fights return to their earlier odds.
- The first gate's boss (stages 2 to 3) has `FIRST_GATE_HP` (x1.65) health, and the stage-1
  Warden keeps its full stage health (it was 70%): otherwise a player who has just reached them
  walks through.
- No enemy, mid or late, and no art changed.

Share of the warrior's damage in AUTO, from the boss and farming probe on the simulator's saved
profiles (3 per gate, one farming run and one boss fight each; the Fury's cut counts as
ultimate):

| Gate | Before: basic / arts / ultimate | After: basic / arts / ultimate |
| --- | --- | --- |
| 3 | 68% / 0% / 32% | 24% / 38% / 38% |
| 12 | 57% / 0% / 43% | 21% / 32% / 47% |
| 24 | 40% / 0% / 60% | 12% / 19% / 69% |
| 36 | 34% / 0% / 66% | 11% / 19% / 71% |

Measured effect on the simulator (seeds 101 to 124, 90 minutes, three runs each to show the
noise): gates 6 and 12 about the same; gates 18 to 39 reached 1 to 5 minutes sooner (the middle
game, where AUTO's arts now land, is faster); gate 42 reached by 19 to 22 seeds of 24 against 19
to 20; deepest stage and level slightly up.

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
| AUTO's casts never landed (overwritten in the same tick); dodges never dashed | Fixed; Fury's cut and the first gate's health keep the pace (see AUTO casts) |
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

## Testing

- `npm run test`: unit tests for every rule, plus a balance harness that simulates whole runs with
  passive, active, spender and upgraded player policies, and checks that every heavy boss blow is
  announced by the perfect-dodge window no more than 0.45 s before it lands.
- `ECON_SIM=1 npx vitest run tests/unit/economy.sim.test.ts`: the economy simulator (see Economy).
- `npm run test:e2e`: Playwright on a phone profile and six viewports from 320x568 to 430x932,
  driving real taps and holds against the production build.
