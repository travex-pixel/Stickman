# ASCEND

A mobile-first dark-fantasy action RPG that runs entirely in the browser. You begin as a lone warrior at the edge of the first Rift. You fight, you grow, and you learn to claim the essence of what you defeat. Your fallen enemies become your companions. Your companions become an army.

Built with Next.js (App Router), React, TypeScript strict, PixiJS 8, Tailwind CSS 4, Motion, Howler, IndexedDB, Vitest and Playwright. Deploys to Vercel as a static client-side app.

## Playing

```bash
npm install
npm run dev        # http://localhost:3000, open in a phone-sized viewport
```

The whole game fits one phone screen with no scrolling, from 320x568 to 430x932:

- **Top**: level, gold, essence, stage and wave progress, battle speed, menu.
- **Battlefield**: the live PixiJS fight, with the boss bar, BIND prompts, army commands and the quest pill.
  Six round medallions sit on the battlefield itself: AUTO, five abilities and the Ascendant Fury ultimate.
- **Panel**: Hero (hold-to-upgrade stats, Ascendant rank), Summons (the Oathbound army), Gear, Skills (three seal paths plus Arts) and Rift (game modes, journal, bestiary).

### The loop: farming never stops, bosses wait for you

The campaign is always on. Your warrior and army fight a stage's ordinary encounters (three waves)
on their own, collect gold, XP, gear and shadow shards, and move on to the next stage in place.

- A **boss stage** (stage 1, every third stage, and the last stage of a region) does not start its
  boss. Clearing its encounters opens a **boss gate**: farming loops that stage while a crimson
  **BOSS CHALLENGE** plaque waits on the field.
- The plaque opens a **readiness sheet**: level, power, army, gear, the reward, concrete tips (each
  opens the panel that fixes it) and an **auto-battle forecast** that fights the real boss four
  times in the real simulation and reports the result. The boss is never adjusted for it.
- **FIGHT** is the only way into a boss fight. Win and the next stage unlocks and farming resumes.
  Lose and you get a battle summary and go back to farming. Nothing ever retries the boss for you.
- Falling while farming steps back one stage and holds there; a **Push** chip resumes the climb.
- Menus never pause farming. Upgrade, equip, deploy and read while the fight goes on.
- **Offline**: when you return, the game samples real farming cycles with your build and repeats
  them for the time away (capped at 8 hours, fighting half of it). It clears ordinary stages but
  stops at a boss gate, and the summary tells you which boss is waiting.
- **Objectives**: three optional dailies and three weeklies (Rift panel, Goals). No streaks.
- **Tap an enemy** to focus it: the warrior and army strike it first.

Combat is hybrid. Basic attacks are automatic; you choose when to cast and when to dodge. A manual dodge in the last instant before an enemy blow lands is a **perfect dodge**: a moment of slow motion, ultimate energy and a guaranteed critical on your next strike. AUTO unlocks once you have used an ability and dodged, and switches on when the tutorial ends; it never earns perfect dodges.

Stages 1 to 6 are The Ashen Verge, where each stage introduces one new idea (brutes, elite champions, shieldbearers, summoners). Stage 7 opens The Drowned Hollow: the Drowned Lurker sinks out of reach and surfaces under its prey, and the Drowned Warden's Undertow and Riptide ask you to read the field rather than outlast it. Every boss shows a one-line counter at its entrance.

## Oathbound: the summoning system

Enemies marked with a pale light leave their oath behind when they fall. Tap **BIND** before it fades. Binding is a roll: the chance depends on rarity, your Ascendant rank, elite status and your build, and every failure builds pity toward a guaranteed bind. Bosses give three attempts. Your first bind always succeeds and plays the full cinematic.

- **Roles**: Vanguard, Reaper, Ranger, Arcanist, Sentinel (guards the warrior), Caller (raises temporary shades mid-fight) and Sovereign (the Hollow Warden).
- **Army**: deploy two to start, a third at rank C and a fourth at rank S. Commands (Follow, Attack, Guard) change positioning and targeting immediately.
- **Growth**: deployed shadows earn XP, benched ones a share. Bond is raised with essence. Binding a species you already own gives shards, and shards plus Rift Cores raise **stars**. Evolution needs stars and level.
- **Oath Codex**: every species you own grants a permanent bonus to the warrior, and the bonus grows with that species' best star (x3.5 at five stars). Collecting widely and deeply both matter, not just the strongest summon.

## Progression

- **Stats**: hold-to-upgrade, unlocking one at a time.
- **Ascendant rank E to S**: Rank Trials against an empowered Warden at level milestones raise stats, BIND chance and army size.
- **Gear**: six slots. Epic and legendary drops can carry build-defining effects such as Thunderclap, Bloodthirst, Executioner and Shadowbound.
- **Skills**: three seal paths (Power, Soul, Command) bought with skill points, and a weapon path choice.
- **Arts**: each ability ranks from I to V with gold, gated by level, for +18% power and -5% cooldown per rank.
- **Techniques**: earned alternate forms for ability slots. Blade Tempest (clear stage 4) can replace Arc Slash, Chain Hook (defeat a Crypt Keeper) can replace Thunder Strike, and Blood Pact (reach rank C) can replace Soul Burst. Each one learned adds +4% attack forever, equipped or not.
- **Forge**: three unequipped items of one rarity fuse into a random item of the next rarity in the chosen slot, keeping half their upgrade levels.
- **Perks** on level-up, quests, achievements, a journal and a bestiary.

## Game modes

| Mode | Unlocks | What it is for |
|---|---|---|
| Campaign | Start | Push through regions and bosses |
| Gold Vault | After stage 2 | 45 seconds of sevenfold gold, 3 keys a day |
| Essence Rift | After stage 3 | Every foe drops an oath, shards for the army, 3 keys a day |
| Relic Crypt | After stage 4 | Elites drop gear for the day's featured slot, a tier up; a Crypt Keeper closes the run. 3 keys a day |
| Endless Ascent | After stage 5 | Climb waves until you fall, records kept |
| Rank Trial | Level milestones | The breakthrough fight for the next Ascendant rank |

Daily keys refill each day and never stack into an obligation.

## Gift codes

Players redeem codes from the menu, once per save. `WELCOME`, `ASCENDANT`, `QUIETSOLDIER` and `OATHKEEPER` are built in. Signed one-off codes are generated with:

```bash
npm run code -- --gold 2000 --essence 200 --summon veilshot --count 5
```

Signed codes need `NEXT_PUBLIC_ASCEND_CODE_SECRET` set at build time (on Vercel, as a project environment variable). Production builds without it accept only the named codes. The secret ships inside the client bundle, so treat codes as gifts between friends, not as a security boundary.

## Architecture

```
src/game/engine        fixed-timestep loop, World simulation, events, RNG
src/game/entities      Combatant model shared by player, summons, enemies and bosses
src/game/combat        damage, statuses, targeting
src/game/abilities     player abilities
src/game/enemies       archetype AI (grunt, brute, ranger, arcanist, shieldbearer, summoner)
src/game/bosses        the Wardens: two phases, region-specific moves
src/game/summons       role AI, BIND extraction, recruitment, stars, evolution
src/game/progression   profile model, derived stats, upgrades, skills, arts, ranks, perks, quests, loadout
src/game/economy       loot, stage rewards, gift codes
src/game/data          all content as data: abilities, enemies, summons, regions, skills, perks, lore
src/game/render        PixiJS presentation: procedural rigs, particles, effects, background
src/game/audio         runtime-synthesised sound (no licensed assets) through Howler
src/persistence        IndexedDB saves, validation, migrations, unload safety, offline rewards
src/components         React HUD, panels, guidance (HandGuide), modals, settings
```

The simulation (`World`) is pure TypeScript with no DOM or Pixi dependency, driven at 60 steps per second with interpolated rendering. It emits events; the renderer, audio and progression layers react to them. New enemies, summons, waves, skills, perks and quests are added as data.

## Testing

```bash
npm run typecheck
npm run test          # Vitest: damage, statuses, xp, upgrades, hold cadence, skills, perks, quests,
                      # recruitment, deployment limits, evolution, loot, saves, migrations, offline
                      # rewards, world lifecycle, abilities, summon combat, boss phases, defeat,
                      # and a headless balance harness that simulates full runs
npm run test:e2e      # Playwright on a Pixel 5 profile plus six phone viewports: canvas boots,
                      # warrior renders, enemies spawn, abilities and dodge, hold-to-upgrade
                      # including cancellation and exhaustion, essence claim and first summon
                      # reveal, deployment and commands, gear, skills, boss defeat, persistence,
                      # zero-scroll layout, no console errors
BALANCE_PRINT=1 npx vitest run tests/unit/balance.print.test.ts   # prints the balance table
```

Playwright uses the preinstalled Chromium at `/opt/pw-browsers/chromium` with software WebGL. Remove `launchOptions` in `playwright.config.ts` to use a normal browser locally. An opt-in progression simulator runs with `PROGRESSION_SIM=1 npx vitest run tests/unit/progression.sim.test.ts`.

## Deployment

The app is a static Next.js build with no server code.

1. Push this repository to GitHub.
2. In Vercel, import the repository. Framework preset: Next.js.
3. Optional: set `NEXT_PUBLIC_ASCEND_CODE_SECRET` to enable signed gift codes.
4. Deploy. `vercel.json` sets immutable caching for static chunks, and `next.config.ts` sends a Content Security Policy and other security headers.

Verify on a real phone: open the production URL, play through the first stage, lock and unlock the screen (audio resumes on the next tap), and reload (progress restored, offline reward offered after 90 seconds away).

## Design notes

- No ads, no purchases, no streaks. Daily keys refill without stacking. Offline rewards are a capped courtesy.
- No pay-to-win. Every currency has one job: gold for stats, gear and arts; essence for bonds; Rift Cores for stars and evolution.
- Stats unlock progressively so the first screen is two choices, not six.
- The quest banner always shows the next concrete goal and a reward you tap to collect.
- The hand guide is one instruction at a time, teaches through real play, and persists completion. It can be replayed from the menu.
