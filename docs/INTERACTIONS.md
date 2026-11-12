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
| FIGHT (`boss-fight`) | Start the boss encounter. The only entry to a boss fight | Sheet open, gate open, farming, warrior alive, no pending transition | Not shown | `challengeBoss()` | Boss horn; inside the 2.4s intro, letterbox, dimmed field, camera to the spawn, the boss's own emergence (fissure, water rings, ember column, gold flare) and an impact beat; then its counter tip | New `boss` world on the gate stage | Returns false with an error tone; nothing starts |
| Keep farming (`boss-later`) | Close the sheet | Always | – | Close | Sheet closes | Farming as before | – |
| Readiness tips | Go fix a weakness | Tip listed | – | Opens the named panel (sheet stays open) | Panel switch | Upgrades refresh the tips and the forecast | – |
| Retreat (`mode-leave`, upper left under the boss bar) | Leave a boss fight, hunt or Vault run | During the fight | – | Two taps: the first arms it ("Tap again to retreat", threat red, `data-armed`) for 3s; the second leaves | Label change, then a toast | Farming world; gate stays; no win or loss recorded | A single stray tap does nothing but arm it |
| BIND on the victory card (`victory-bind-button`) | Bind the fallen boss's essence | The boss left an essence | Not shown | A quiet button with gold text (Onward is the one gold action). Card steps aside, BIND rolls | Reveal on success, "Refused" and the new chance on failure; the card returns | Collection, pity; the countdown waits while the essence does | – |
| Onward (`victory-continue`) | Leave the victory card | Victory card | – | Farming at the next stage. With an unbound essence, the first tap shows "The essence stays here if you go. Tap again to leave it." (`victory-leave-warning`) and the second leaves | Card closes; stage banner; the countdown is a thin line along the button's foot | Farming world at `nextStage`; auto after a short countdown when enabled, never while an essence waits | – |
| Keep farming / Get stronger (defeat card) | Leave the defeat summary | Defeat card | – | Close; or close and open Hero with the hand on an upgrade | Card closes | Farming continues; the boss is never retried automatically | – |
| Push chip (`push-stage`, lower left) | Resume pushing after a fall or a manual hold | Farming below the frontier with auto-push off, warrior standing | Not shown (also hidden while the warrior is down) | `pushStage()` | Toast, foes withdraw, `STAGE n` banner | Farming moves up one stage now and keeps pushing | During the fall beat: "regrouping" toast, nothing changes |
| Stage tiles (Rift panel) | Farm a chosen stage | Any stage up to the frontier | Future stages not listed | `selectStage()` | Toast | Farming moves in place; below the frontier it holds there | – |

## Combat

| Control | Purpose | Available | Unavailable look | Press | Feedback | Result | Failure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ability medallions | Cast the slot's ability | Unlocked and off cooldown | Lock with unlock level; cooldown sweep and seconds | Cast | Medal flash, cast animation, effect, sound | Damage or effect in the simulation | Locked: toast with the unlock level. On cooldown or no target: error tone |
| Dodge | Dash through danger | Off cooldown | Cooldown sweep | Dodge | Afterimages; a dodge just before a blow lands is "Perfect" (gold text, slow-motion, energy, guaranteed next crit) | Brief invulnerability | Error tone |
| Ultimate | Ascendant Fury | Energy full | Charge percentage | Cast | Slowed time; the warrior blinks foe to foe with seven cuts, leaving ink afterimages; gold flash on the last | Seven strikes, each to every enemy | Locked or charging: toast with the charge and how to fill it |
| AUTO | Let abilities fire on their own | After using an ability and dodging; on by default when the tutorial ends | Faded | Toggle | ON/OFF label, gold when on | Loadout autoCast | Locked: toast explaining the unlock |
| Battle speed (`speed-toggle`) | 1x / 2x | After stage 3 | Lock icon, faded | Toggle | Label | Sim steps per frame | Locked: toast |
| Tap an enemy | Focus target | An enemy under the finger | – | `focusAt()` | Gold rotating reticle; first time, a toast | Warrior and army (except guards) target it | No enemy under the finger: nothing happens |
| BIND (`claim-essence`) | Try to bind a shadow | Orb on the field | Not shown | Roll at the shown chance | Success: a staging by rarity (quick 0.5s for a duplicate, common 0.9s, rare 1.6s, epic 2.3s, legendary and boss shadows 3.6s; the first bind ever is legendary), then the reveal; a tap after 0.4s skips to the name. Failure: the pool collapses with a dry crack, "Refused" and the new chance | Collection, pity | First failure explains that BIND is a chance that rises |
| Command buttons | Army stance | Army deployed | Not shown | `setCommand()` | Pressed state | Summon AI behaviour | – |

## Growth

| Control | Purpose | Available | Unavailable look | Press | Feedback | Result | Failure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Hold-to-upgrade (stats) | Raise a stat | Unlocked and affordable | Locked rule text; a flat grey cost pill when unaffordable (a raised pill with gold text when affordable) | Hold: repeats, accelerating | Tick sounds, fill, next value preview; a gold lozenge marks the affordable upgrade with the most Power per gold (`best-buy`) | Real stat change in the live world | Stops when gold runs out |
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
| Ascend badge (Hero panel) | Open the Ascension sheet | From stage 20, or once ascended | Not shown before stage 20 | Opens the sheet | Shows the Aether on offer | – | – |
| Hold to ascend (`ascend-confirm`) | Ascend: restart the climb for Aether | Stage 20 reached, farming, warrior standing | Disabled before stage 20 | Hold about a second (a tap does nothing) | Fill bar while held; gold flash and toast on ascending | Campaign, gold and stat levels reset; Aether added; saved at once | Mid-fight or while down: toast, nothing changes |
| Aether tree tab (`ascend-tab-tree`) | See and spend Aether | Once any Aether is owned | Badge with the spare Aether on the tab and a dot on the Ascend badge | Switches the sheet to the tree | Tab highlight | – | – |
| Tree node buy (`buy-<node>`) | Spend Aether on a lasting choice | Enough spare Aether and below the node's max | Muted cost when short; "Max" at the cap | `buyAscensionNode()` | Gold flash, toast with the node and level | Spare Aether falls; Might, Vigor, Fortune, Insight, Treasury, Oathbinder, Patience or Command applies at once and to every later climb. The flat lifetime bonus never drops | Error tone |
| Boss Hunt tile and list (`mode-hunt`, `hunt-N`) | Rematch a cleared boss | After stage 3, a hunt key left | Locked tile with reason; list rows disabled with no keys | Starts a hunt world on that boss | Boss horn and intro | Rewards only; campaign progress untouched; key spent | No keys: toast |
| Rift Tyrant tile (`mode-tyrant`) | Open this week's Tyrant | Stage 9 reached (in any climb) | Locked tile with the reason | Opens the Tyrant sheet | Boss, twist, tiers won and tries left on the tile | – | – |
| Face the Tyrant (`tyrant-fight`) | Start the weekly fight | A try left today | Disabled with the reason | Spends a try; a one-minute fight at the deepest stage | Timer and live bar score in the HUD; BREAK burst, shake and chime on each broken bar | Tiers reached for the first time this week pay at once; result card with the tier track | Out of tries: disabled |
| Leave (Tyrant fight) | Stop early | During the fight | – | Ends the try | Result card | The bars already broken count | – |
| Depth line (Rift panel, `depth-chip`) | Say which Rift Depth this is and what its twist does | Stage 31 and beyond | Region subtitle instead | – | Tinted in the depth's colour | – | – |
| Goals (Rift panel) | Daily and weekly objectives | Always | Badge when claimable | Opens objectives | – | – | – |
| Claim (objective) | Collect an objective | Complete and unclaimed | "…" or Done | Claim | Toast with the payout | Gold, essence, cores (and the all-three bonus once a day) | Error tone |
| Collect (offline card) | Close the return summary | Always | – | Close. Pinned under the scrolling summary, so it is always on screen | Gold tone | Rewards were credited and saved before the card opened | – |
| Upgrades ready (offline card, `offline-upgrade`) | Spend the return's gold | Affordable upgrades exist | Not shown | A row with a chevron above Collect (not a second button). Closes the card and opens Hero with the hand guide on an upgrade | Panel switch | Nothing is bought for the player | – |

## Panel and settings

| Control | Purpose | Available | Unavailable look | Press | Feedback | Result | Failure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Panel grabber (`panel-grabber`) | Switch the panel between its base and tall heights | Army, Gear, Skills and Rift, when the screen has room for a tall panel (Hero never grows) | Not shown | Tap, drag past 24px, or Enter/Space (a window splitter for assistive technology) | The panel slides over 320ms; the battlefield's framing lifts with it | Each tab opens at its base and remembers the choice for the session | – |
| Detail raise | Give a detail room for its actions | A picked item (Gear) or the Arts (Skills) | – | Opens with the detail; closes with it | The panel rises, then returns to the player's own height | Equip, upgrade and rank-up stay in reach at every phone size | Dragging the panel down while raised wins until the detail opens again |
| Claim beside the gate (quest banner) | Collect a finished quest while a boss waits | Quest complete and a gate open | – | Claim | Claim sound | Reward | – |
| Short reveals (Settings) | Shorter BIND stagings | Always | – | Toggle | Switch | Every bind plays its short form; the very first bind always plays in full; tap to skip works either way | – |

## Playtest recording

Add `?playtest=1` to the address to record a session on the device. Once a second the recorder
reads the game (kills, gold, level, stage, boss wins and losses, upgrades, shadows, gear, the
tutorial step, the card, panel and mode on screen); it also logs each tap with what it hit. At the
end the player rates seven statements from 1 to 7 ("Hits felt powerful", "I always knew what to
do next" and five more). The report is shown to the player, who chooses whether to copy and send
it: nothing leaves the device on its own, and nothing is recorded without the flag
(`src/game/telemetry/`).

## Hand guide

The hand points with its fingertip, which meets the edge of what it points at and never covers
it: from below for targets high on the screen (pointing up), from above for low ones (turned to
point down). It never sits on the boss gate or a Claim it is not pointing at. Taps and holds move
toward the target. Two browser tests check that the fingertip meets its target.

