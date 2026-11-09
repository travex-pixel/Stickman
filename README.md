# ASCEND

A mobile-first dark-fantasy action RPG that runs entirely in the browser. You begin as a lone warrior at the edge of the first Rift. You fight, you grow, and you learn to claim the essence of what you defeat. Your fallen enemies become your companions. Your companions become an army.

Built with Next.js (App Router), React, TypeScript strict, PixiJS 8, Tailwind CSS 4, Motion, Howler, IndexedDB, Vitest and Playwright. Deploys to Vercel as a static client-side app.

## Playing

```bash
npm install
npm run dev        # http://localhost:3000, open in a phone-sized viewport
```

The whole game fits one phone screen with no scrolling:

- **Top**: level, gold, essence, Rift Cores, stage and wave progress, menu.
- **Battlefield**: the live PixiJS fight. Boss bar, essence claim prompts, summon command bar, quest banner.
- **Ability bar**: AUTO toggle, five ability slots (Arc Slash, Dash, Thunder, Soul Burst, Void Nova) and the Ascendant Fury ultimate.
- **Panel**: Hero (hold-to-upgrade stats), Summons (collection, deploy, bond, evolve), Gear (six slots, compare, equip, upgrade, salvage), Skills (three branches plus weapon paths), Rift (stage select, bestiary, achievements, journal).

Combat is hybrid: basic attacks are automatic, you choose when to use abilities and when to dodge. AUTO can take over the abilities once the tutorial has taught them.

## The ECLIPSE summoning system

Enemies marked with a soul light leave their essence behind when they fall. Claim it before it fades and the creature joins your collection as a permanent companion. The first claim is a cinematic; later ones are quick.

- Roles: Vanguard (frontline), Reaper (hunts weakened enemies), Ranger (marks dangerous targets), Arcanist (burning ground), Sovereign (the Hollow Warden).
- Deploy two companions to start; a Command skill unlocks a third.
- Commands: Follow, Attack, Guard. They change positioning and target selection immediately.
- Progression: companions earn XP from every kill while deployed, Bond is raised with Essence (hold-to-upgrade), duplicate essence becomes shards, and the Husk Blade evolves into the Gravewalker with shards and a Rift Core.
- The Hollow Warden drops a sigil on every defeat. Three sigils and it kneels.

Synergies are unlocked through the skill tree: Arc Slash drags enemies to your Vanguard, Thunder Strike chains through Ranger marks, Void Nova opens enemies to Reaper damage, Soul Burst mends companions.

## Architecture

```
src/game/engine        fixed-timestep loop, World simulation, events, RNG
src/game/entities      Combatant model shared by player, summons, enemies and bosses
src/game/combat        damage, statuses, targeting
src/game/abilities     player abilities
src/game/enemies       archetype AI (grunt, brute, ranger, arcanist)
src/game/bosses        the Hollow Warden, two phases
src/game/summons       role AI, recruitment, progression, evolution
src/game/progression   profile model, derived stats, upgrades, skills, perks, quests, loadout
src/game/economy       loot generation and item economy
src/game/data          all content as data: abilities, enemies, summons, regions, skills, perks, lore
src/game/render        PixiJS presentation: procedural rigs, particles, effects, background
src/game/audio         runtime-synthesised sound (no licensed assets) through Howler
src/persistence        IndexedDB saves, validation, migrations, offline rewards
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

Playwright uses the preinstalled Chromium at `/opt/pw-browsers/chromium` with software WebGL. Remove `launchOptions` in `playwright.config.ts` to use a normal browser locally.

## Deployment

The app is a static Next.js build with no server code, secrets or environment variables.

1. Push this repository to GitHub.
2. In Vercel, import the repository. Framework preset: Next.js. No environment variables are needed.
3. Deploy. `vercel.json` sets immutable caching for static chunks.

Verify on a real phone: open the production URL, play through the first stage, lock and unlock the screen (audio resumes on the next tap), reload (progress restored, offline reward offered after 90 seconds away).

## Design notes

- No ads, no purchases, no timers, no streaks. Offline rewards are a capped courtesy, not a simulation.
- Every currency has one job: Gold for stats, gear and items; Essence for companion bonds; Rift Cores for evolution.
- Stats unlock progressively so the first screen is two choices, not six.
- The quest banner always shows the next concrete goal and a reward you tap to collect.
- The hand guide is one instruction at a time, teaches through real play, and persists completion. It can be replayed from the menu.
