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

1. Fight a stage: three waves and the region's Warden. Basic attacks are automatic; abilities,
   dodge and BIND are the player's decisions. AUTO takes over abilities once taught.
2. Enemies marked with pale light leave a shadow. BIND shows its success chance before the tap.
3. Spend gold on stats (hold to upgrade), essence on shadow bonds, Rift Cores on evolution.
4. Level ups offer a choice of three perks. Clearing stages unlocks modes, ranks and regions.
5. Rank Trials turn levels into breakthroughs (E to S), each raising stats, BIND chance and,
   at C and S, the size of the army.

## Systems inventory

| System | Status | Where |
|---|---|---|
| Fixed-step deterministic combat, events | Working | `src/game/engine/World.ts` |
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
| IndexedDB saves: versioned (v8), validated, backed up, migrated, unload-safe | Working | `src/persistence/` |
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
  passive, active, spender and upgraded player policies.
- `npm run test:e2e`: Playwright on a phone profile and six viewports from 320x568 to 430x932,
  driving real taps and holds against the production build.
