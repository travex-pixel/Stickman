# Interaction contracts

Every control in ASCEND does something real. This is the contract for each one: what it is for,
when it can be used, what it looks like when it cannot, what pressing it does and shows, and what
happens when the press cannot succeed. Shared states: every button has a pressed scale (0.95 to
0.97), a hover brighten where hover exists, a muted or locked look when unavailable, and a toast
or error tone instead of silence when a press cannot succeed.

## Campaign and bosses

| Control | Purpose | Available | Unavailable look | Press | Feedback | Result | Failure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BOSS CHALLENGE plaque (`boss-challenge`) | Open the boss readiness sheet | A boss gate is open and the campaign is farming | Not shown | Opens the sheet over the battlefield (farming continues) | Breathing crimson glow, boss portrait, name and readiness tier; press scale | `boss_ready` sheet; forecast starts or refreshes | Not reachable without a gate; controller refuses with an error tone |
| FIGHT (`boss-fight`) | Start the boss encounter. The only entry to a boss fight | Sheet open, gate open, farming, warrior alive, no pending transition | Not shown | `challengeBoss()` | Dark flash, boss horn, `BOSS CHALLENGE` banner, boss intro with its counter tip | New `boss` world on the gate stage | Returns false with an error tone; nothing starts |
| Keep farming (`boss-later`) | Close the sheet | Always | – | Close | Sheet closes | Farming as before | – |
| Readiness tips | Go fix a weakness | Tip listed | – | Opens the named panel (sheet stays open) | Panel switch | Upgrades refresh the tips and the forecast | – |
| Retreat (`mode-leave`, lower right in a boss fight) | Leave a boss fight | During the fight | – | Back to farming | Toast | Farming world; gate stays; no win or loss recorded | – |
| BIND on the victory card (`victory-bind-button`) | Bind the fallen boss's essence | The boss left an essence | Not shown | Card steps aside, BIND rolls | Reveal on success, "Refused" and the new chance on failure; the card returns | Collection, pity; the countdown waits while the essence does | – |
| Onward (`victory-continue`) | Leave the victory card | Victory card | – | Farming at the next stage | Card closes; stage banner | Farming world at `nextStage`; auto after a short countdown when enabled | – |
| Keep farming / Get stronger (defeat card) | Leave the defeat summary | Defeat card | – | Close; or close and open Hero with the hand on an upgrade | Card closes | Farming continues; the boss is never retried automatically | – |
| Push chip (`push-stage`, lower left) | Resume pushing after a fall or a manual hold | Farming below the frontier with auto-push off, warrior standing | Not shown (also hidden while the warrior is down) | `pushStage()` | Toast, foes withdraw, `STAGE n` banner | Farming moves up one stage now and keeps pushing | During the fall beat: "regrouping" toast, nothing changes |
| Stage tiles (Rift panel) | Farm a chosen stage | Any stage up to the frontier | Future stages not listed | `selectStage()` | Toast | Farming moves in place; below the frontier it holds there | – |

## Combat

| Control | Purpose | Available | Unavailable look | Press | Feedback | Result | Failure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ability medallions | Cast the slot's ability | Unlocked and off cooldown | Lock with unlock level; cooldown sweep and seconds | Cast | Medal flash, cast animation, effect, sound | Damage or effect in the simulation | Locked: toast with the unlock level. On cooldown or no target: error tone |
| Dodge | Dash through danger | Off cooldown | Cooldown sweep | Dodge | Afterimages; a dodge just before a blow lands is "Perfect" (gold text, slow-motion, energy, guaranteed next crit) | Brief invulnerability | Error tone |
| Ultimate | Ascendant Fury | Energy full | Charge percentage | Cast | Gold flash, slowed time, blades | Damage to every enemy | Locked or charging: toast with the charge and how to fill it |
| AUTO | Let abilities fire on their own | After using an ability and dodging; on by default when the tutorial ends | Faded | Toggle | ON/OFF label, gold when on | Loadout autoCast | Locked: toast explaining the unlock |
| Battle speed (`speed-toggle`) | 1x / 2x | After stage 3 | Lock icon, faded | Toggle | Label | Sim steps per frame | Locked: toast |
| Tap an enemy | Focus target | An enemy under the finger | – | `focusAt()` | Gold rotating reticle; first time, a toast | Warrior and army (except guards) target it | No enemy under the finger: nothing happens |
| BIND (`claim-essence`) | Try to bind a shadow | Orb on the field | Not shown | Roll at the shown chance | Success: OATHBOUND cinematic and reveal. Failure: "Refused" and the new chance | Collection, pity | First failure explains that BIND is a chance that rises |
| Command buttons | Army stance | Army deployed | Not shown | `setCommand()` | Pressed state | Summon AI behaviour | – |

## Growth

| Control | Purpose | Available | Unavailable look | Press | Feedback | Result | Failure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Hold-to-upgrade (stats) | Raise a stat | Unlocked and affordable | Locked rule text; cost in red when unaffordable | Hold: repeats, accelerating | Tick sounds, fill, next value preview | Real stat change in the live world | Stops when gold runs out |
| Item upgrade (hold) | Level an item | Below cap and affordable | MAX or red cost | Hold | As above | Item level | Stops |
| Equip / Unequip | Wear an item | Item selected | – | Equip | Equip sound | Loadout and set bonuses | – |
| Forge | Fuse three of a rarity | Three unequipped of the rarity, not legendary | Not shown | Fuse | Bright reveal for epic and legendary, toast | New item of the next rarity in this slot; half the levels kept | Error tone |
| Salvage | Turn an item into gold | Item selected | – | Salvage | Gold sound | Gold | – |
| Deploy / Recall | Field a shadow | Free slot | Deploy disabled when full | Toggle | Summon appears or leaves | Army | Error tone |
| Bond (hold) | Level a shadow's bond | Affordable in essence | Cost in red | Hold | Ticks | Shadow stats | Stops |
| Star | Raise stars | Enough shards (and cores) | Shard progress | Star up | Flash, toast with the Codex gain | Stars and Codex | Toast with what is missing |
| Evolve | Evolve a shadow | Requirements met | Requirement text | Evolve | Cinematic sound, toast | New form | Error tone |
| Skill Learn | Spend points | Points and path order | Disabled with reason | Learn | Seal fill | Passive | – |
| Arts rank / form switch | Rank an ability, choose a technique | Gold and level | Reason on the button | Rank or switch | Toast, medal change | Ability power and cooldown, slot form | – |
| Perk chip | Choose a pending perk | Perks pending | Not shown | Opens the choice | – | Perk | – |
| Quest pill | Claim or go to the objective | Always | – | Complete: claim. Incomplete: opens the panel the quest needs | Claim sound | Reward | – |
| Goals (Rift panel) | Daily and weekly objectives | Always | Badge when claimable | Opens objectives | – | – | – |
| Claim (objective) | Collect an objective | Complete and unclaimed | "…" or Done | Claim | Toast with the payout | Gold, essence, cores (and the all-three bonus once a day) | Error tone |
| Collect (offline card) | Close the return summary | Always | – | Close | Gold tone | Rewards were credited and saved before the card opened | – |
