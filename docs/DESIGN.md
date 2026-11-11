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
   tutorial.
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
| IndexedDB saves: versioned (v10), validated, backed up, migrated, unload-safe | Working | `src/persistence/` |
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
and each gate challenged once the real forecast wins 2 of 4.

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
