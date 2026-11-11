# Rebirth evidence log

What we are trying to prove, how each claim is measured, and what would disprove it. Confidence in
one's own work is not evidence, so each claim here is tied to an instrument anyone can re-run.

Labels: **Verified** (measured here, reproducible), **Sourced** (from outside references, with the
quality of the source stated), **Hypothesis** (plausible, not yet tested), **Speculation**.

## The outcome behind the brief

The brief asks for premium visuals, satisfying animation and strong UX. The outcome behind it is a
game a stranger keeps playing: one that reads as crafted in the first ten seconds, feels good in
the first fight, and gives a reason to return. Visual polish is one input to that. It is not the
proof of it. The only real proof is people playing on real phones.

**The gap this log exists to close:** until now every judgement of quality in this project was
made by its author from headless, software-rendered screenshots. No person and no real device has
been part of the loop.

## Instruments

| Instrument | Measures | Run |
|---|---|---|
| Design lint | Text under 11px, distinct sizes and families, capitals, heavy weights, bordered boxes, gradients, shadows, touch targets under 44px, contrast against solid backgrounds, overflow, on 17 screens | `PORT=3100 node scripts/design-audit.mjs` |
| First-session funnel | In game seconds: each "first", wait per tutorial step, cards that interrupt play, longest stretch with nothing new | `PORT=3100 SECONDS=300 node scripts/ftue.mjs` |
| Performance harness | Scripting time per frame at 4x CPU throttle | `scripts/perf.mjs` (Stream B) |
| Framing | Warrior height as a share of the battlefield; distance from centre | `PORT=3100 node scripts/framing.mjs` |
| Economy simulator | Hours to each gate, ascension cadence | `ECON_SIM=1 npx vitest run tests/unit/economy.sim.test.ts` |
| Playtest recorder | On a real device: frame-time distribution, the same funnel, taps on nothing, bursts of frustrated taps, a seven-statement survey and return intent | open the game with `?playtest=1`, play, tap "Report", copy |
| Blind pairwise judging | Preference between before and after screens by reviewers who are not told which is which | section "Planned" |

## Baseline (commit `d2dd1be`, before any Rebirth code)

### Design lint: Verified

Totals over 17 screens at 390 x 844:

| Measure | Before | Target after |
|---|---|---|
| Text elements under 11px | 389 | 0 |
| Bordered boxes | 175 | under 20 |
| Elements painted with a gradient | 288 | under 20 (rarity and art only) |
| Elements with a shadow | 284 | under 30 |
| Touch targets under 44px | 159 | 0 on primary controls |
| Uppercase text elements | 78 | at most 1 to 2 per screen |
| Text at weight 700 or more | 185 | under 30 |
| Font families | Marcellus, Manrope, system | Instrument Sans, Instrument Serif |
| Horizontal overflow | 0 | 0 |

Contrast could not be measured before: nearly all text sat on gradients, so its background was
not resolvable. Flat surfaces make it measurable after.

Limits: the lint counts rule violations. It cannot tell whether a screen is beautiful. A screen
can pass every rule and still be dull. It is a floor, not a verdict.

### Framing: Verified

`PORT=3100 node scripts/framing.mjs`, 24 samples in combat at 390 x 844: the warrior (weapon
and cape included) is a median **17.8%** of the battlefield's height and stands a median
**16.6%** of the width away from centre. Target after the camera: at least 24% and under 10%.

### First-session funnel

Simulation time, default profile, five seeds, no interface (unit-level): **Verified**

- First enemy on the field 1.7s, first hit 3.3s, first kill and first essence 5.2s.
- 10 gold (the first upgrade's price) from kills by 7 to 8s.
- First farming cycle cleared at 57 to 60s, which opens the first boss gate.

Through the real interface (bot): see the table at the end of this file once the controlled run
is recorded.

A correction worth keeping: the bot's first run, timed by the wall clock on a loaded machine,
showed the first kill at 15s and suggested a slow start. Measured in game time that was false.
The bot now reports game seconds and the frame rate it ran at.

## What outside sources say

| Claim in the blueprint | Finding | Source quality | Action |
|---|---|---|---|
| Hit-stop of 25ms on normal hits, 60ms on crits, through a global freeze | Published practice: roughly 2 to 3 frames (33 to 50ms) for light hits, 4 to 6 for medium, 6 to 10 for heavy; under 2 frames is hard to perceive; freeze the bodies involved, not the whole world | Developer articles and forum threads, consistent with each other; no primary measurement | **Changed.** Stream B was re-briefed: local hit-stop on attacker and target by default, 33 / 80 / 100ms, global freeze only for crits, abilities and kills of note |
| Touch targets 44px, text floor 11px | Matches the commonly cited Apple guidance (44pt targets, 11pt smallest text style) | Secondary summaries, not Apple's own page | Kept |
| "People will play for weeks" | Typical day-1 retention for idle games is quoted around 35 to 50%, day-30 around 10 to 15%, with wide disagreement between sources | Vendor blogs with unstated methods | **Cannot be validated here.** The simulator shows content and pacing exist for 60 hours; it says nothing about whether people stay. Only real players can |
| First session should reach the fun quickly and end on a goal | Consistent advice: measure the funnel step by step; reach core play fast; end each session with a goal met and a new one in view | Analytics vendors and platform guides | Funnel instrument built; "next goal" line is in the blueprint (section 10) |
| Short survey after a playtest | The miniPXI (11 single items, one per construct of the Player Experience Inventory) is a validated short form, with moderate reliability per item; a recommend or return-intent question is suggested alongside it | Peer-reviewed (CHI PLAY and follow-ups) | The recorder's survey is adapted from those constructs in our own words; it is not the validated instrument and results are indicative only |

## Hypotheses to test, and what would disprove them

| # | Hypothesis | Test | Disproved if |
|---|---|---|---|
| H1 | The redesign reads as higher quality to someone who has not seen either version | Blind pairwise judging of matched screens by fresh reviewers | Fewer than 75% of pairs prefer "after", or reviewers cannot say why |
| H2 | Hits now read as connected and weighty | Frame sequences: the weapon is through the target on the frame the number appears; survey item "Hits felt powerful" from real playtests | Contact is off by more than one frame; or the survey median is 4 or lower |
| H3 | The camera makes the fight the subject | `scripts/framing.mjs` before and after | Median height share stays under 24%, or the warrior is still more than 10% off centre |
| H4 | The new interface costs no frame time | Perf harness before and after | p95 scripting time rises more than 15% |
| H5 | A newcomer is never without something new for long in the first five minutes | Funnel "dead air" in game seconds | Longest quiet stretch in the first 300 game seconds exceeds 60s |
| H6 | It runs smoothly on a real phone | Playtest recorder: share of frames at 60 fps, 95th percentile frame time | Under 85% of frames within 17ms on a mid-range phone |
| H7 | A real person understands what to do and wants to come back | Playtest recorder survey (clarity, enjoyment, return intent) and dead-tap count | Clarity median 4 or lower; return intent under 6; many taps on nothing |

H6 and H7 cannot be tested from this environment. They need a person with a phone.

## Planned

- **Controlled before and after.** Build `d2dd1be` in its own worktree and run the lint, the
  funnel and the perf harness on both builds back to back on a quiet machine.
- **Blind pairwise judging.** Matched screens, sides randomised, labels removed. Several fresh
  reviewers each choose per pair and give one reason. Report the preference rate and the reasons
  against "after". Reviewers are language models looking at images, not players: weak evidence,
  useful mainly for finding where "after" loses.
- **Real-device playtest.** Wire `attachPlaytest` behind `?playtest=1` once the streams merge.
  One 10-minute session on an actual phone gives frame times, the funnel and a survey.

## Results after Rebirth

### After phase 1 (interface shell, HUD and panels; animation; camera), commit `f61c43c`

The modals had not been rebuilt at this point, so their screens still carry old markup.

**Design lint, totals over the same 17 screens: Verified**

| Measure | Before | After phase 1 | Note |
|---|---|---|---|
| Text elements under 11px | 389 | 40 | All 40 are inside modals awaiting phase 2 |
| Bordered boxes | 175 | 1 | |
| Elements painted with a gradient | 288 | 0 | |
| Elements with a shadow | 284 | 87 | |
| Touch targets under 44px | 159 | 116 | **Not fixed.** Speed and menu buttons 39px, command segments 26px high, skill seals 40px, Rift rows 37px |
| Uppercase text elements | 78 | 24 | Remainder in modals |
| Text at weight 700 or more | 185 | 40 | Remainder in modals |
| Low-contrast text | not measurable | 120 | **A defect the lint found.** The tertiary text token (3.85:1) was used for tab labels, stat levels and mode descriptions |
| Font families | Marcellus, Manrope | Instrument Sans, Instrument Serif | |

The two "not fixed" rows are the point of measuring: by eye the new screens looked finished. The
tertiary colour is raised to `#8a877f` (5.2:1) and the touch targets are enlarged in phase 2.

**Framing: Verified**

| Build | Warrior height, share of battlefield | Distance from centre |
|---|---|---|
| Before | 17.7% | 19.4% of width |
| First camera settings | 22.3% | 10.5% |
| Tuned (minimum zoom 1.12, maximum 1.5, tighter box) | 25.5% | 10.6% |

H3 is supported on height (target 24%). Centring misses its 10% target by half a point.

**Contact timing (H2, first half):** frame sequences stepped at exact simulation frames show the
blade through the target on the frame the damage number appears. Verified from the sequences in
the animation stream's contact sheets; the survey half of H2 still needs real players.

**Performance (H4): not met yet.** The animation stream measured the renderer's own scripting
time at about 25 to 30% over baseline at the median (4x CPU throttle, alternating runs on a noisy
machine). Reducing it is the first task of the cinematics stream. H4 stays open.

**Blind pairwise judging (H1): NOT MET. Verified.**

Eight matched screens (same save, same moment), old build vs phase-1 build, sides randomised by
a fixed seed, labels removed. Three fresh reviewers with different lenses, two different models,
told nothing about which version was new. Pairs and key: scratchpad `judge/pairs`, `judge/key.json`.

| Reviewer (lens) | Chose the new design |
|---|---|
| Game art director (art direction, premium feel, fantasy tone) | 1 of 8 |
| Usability researcher (first-time player) | 6 of 8 |
| Senior product designer (hierarchy, craft) | 5 of 8 |
| **Total** | **12 of 24 (50%)**, target 75% |

What the three agreed on, independently:

- **Clarity improved.** Bigger numbers, one obvious primary action per screen, readable rows,
  better empty-state legibility.
- **Identity was lost.** "The same dark-grey rounded-pill look as any 2020s productivity or
  fintech app"; "looks like a generic dark template"; the old design "chooses a world". The
  brief named this exact risk ("must remain a dark fantasy RPG, not a productivity dashboard"),
  and the blueprint's "quiet interface" direction walked into it.
- **Specific defects:** no visible boss health bar in the captured boss fight; the counter hint
  drawn over the action; AUTO not recognisable as a toggle; level and stage running together in
  the top bar; Retreat placed just above the ultimate; the tutorial hand covering its target;
  hold-to-upgrade not discoverable; empty states with no next step; skill nodes without state;
  truncated Rift descriptions.
- **A rendering defect:** two of three called the boss "a white blob": the impact silhouette was
  counted in frames, so at low frame rates and under constant hits a boss stayed white much of
  the time.

**Action taken:** the direction is amended to "Ink and Gilt, refined" (blueprint section 3a):
warm ink surfaces, paper texture and a gilt edge on the panel only, the serif for the numbers
that matter, one restrained gold ornament for "active", medallion ability discs, a designed boss
challenge. All listed defects were sent to the interface and cinematics leads. H1 will be re-run
on the phase-2 build with the same method and fresh reviewers.

What this says about method: before this test I judged the new screens finished and premium. The
lint and the blind test both found what self-review missed.

**First-session funnel (H5): NOT MET on either build. Verified (game seconds, bot).**

`SECONDS=240 node scripts/ftue.mjs`, fresh save, the bot follows the hand guide, accepts cards,
binds, upgrades every few seconds and fights a boss once its forecast is Ready or Even.

| Moment | Old build | Phase-1 build |
|---|---|---|
| First kill; first shadow bound | 5.3s | 5.4 to 5.6s |
| First upgrade | 6.1s | 6.8s |
| First boss gate | 35.2s | 35.0s |
| First boss win | 71.8s | 59.4s |
| Tutorial finished | 72s | 35s |
| Stage 3 cleared | 227s | 208s |
| Longest stretch with nothing new | 113s (114 to 227) | 106s (103 to 208) |

The first minute is strong on both. The quiet stretch is minutes 2 to 4: farming at the stage-3
gate until the forecast turns. Response: the boss sheet now points at the Gold Vault (open from
stage 2) while a gate is not winnable, and the bot can follow that advice (`VAULT=0` turns it
off); re-measured below.

A correction kept on the record: the bot's first report on both builds was invalid (it stalled
on the first summon reveal because it timed open cards in game time, which stops while a card is
open, yet it printed a full report). Fixed; runs that stop early now say so.

**Re-measured with the Vault advice followed (phase-1 build, `VAULT=1`):** longest quiet stretch
**55s** (stage 2 cleared at 108s, first Vault run at 163s): H5 is met when the player follows the
boss sheet. The cost: two Vault runs in the window (102 upgrades bought against 67) and the
stage-3 boss not yet challenged by 240s. A newcomer trades waiting for a new, rewarding activity.

**Long-term pacing (economy simulator).** A 100-hour run found a wall: stage 386 to 395 for the
last 30 hours, Attack and Health pinned at their level cap. Limit Break now goes to 25 levels;
the same player reaches 449 at 60 hours and 503 at 97. Details in `docs/DESIGN.md`.

### After phase 2 (every sheet and moment, cinematics, Ink and Gilt), commit `b6a6799`

**Design lint, all 35 screens of the shared walk (`scripts/lib/screens.mjs`): Verified**

The walk grew from 17 to 35 screens in phase 2 (every sheet, moment and panel state), so these
totals cover twice the surface of the baseline row and are still lower on every count.

| Measure | Before (17 screens) | After phase 2, 390px (35 screens) | 320px (35 screens) |
|---|---|---|---|
| Text elements under 11px | 389 | 0 | 0 |
| Bordered boxes | 175 | 0 | 0 |
| Elements painted with a gradient | 288 | 7 | 7 |
| Touch targets under 44px | 159 | 0 | 0 |
| Text at weight 700 or more | 185 | 0 | 0 |
| Low-contrast text | not measurable | 0 | 0 |
| Horizontal overflow | 0 | 0 | 0 |
| Font families | Marcellus, Manrope | Instrument Sans, Instrument Serif | same |

The seven gradients are the scrims behind moment text, allowed by the blueprint. The contrast row
needed a fix to the lint first: it treated the panel's paper texture as an unknown background and
so skipped most panel text. Once it read the texture as the colour beneath, it found ten failures
(crimson text at 4.0:1); a separate text tone, `--color-threat` at 6.2:1, fixed them.

**Framing (H3): Verified.** Warrior height 26.3% of the battlefield (target 24%), 10.6% of the
width from centre (target 10%). Height met; centring still half a point short, unchanged since
phase 1.

**Performance (H4): MET. Verified.** Paired runs of `scripts/perf.mjs` (4x CPU throttle, 30s at
stage 20), three rounds each, alternating between the baseline `a90d3bb` (the pre-Rebirth game
plus the harness, nothing else) and the phase-2 build. Medians of the three rounds:

| Speed | Measure | Baseline | Phase 2 | Change |
|---|---|---|---|---|
| 1x | Scripting per frame, p50 | 9.9ms | 9.6ms | -3% |
| 1x | Scripting per frame, p95 | 29.4ms | 28.9ms | -2% |
| 2x | Scripting per frame, p50 | 11.7ms | 9.1ms | -22% |
| 2x | Scripting per frame, p95 | 33.5ms | 28.1ms | -16% |

The 25 to 30% overrun measured after phase 1 is gone. The cinematics stream (commit `abd827e`)
measured number glyphs once at mount, shared rig drawings per kind, prepared white copies at
spawn, rewrote trails in place, pooled splatters and motes, redrew only on change and capped the
backdrop texture at 16 MB. In both builds the first round was the slowest, probably the machine
warming up, so the medians are taken over all three.

**Blind pairwise judging (H1), round 2: NOT MET, but close. Verified.**

Same method as round 1 (matched screens, sides randomised, answer key held outside the judges'
folder), now on twelve screens with four fresh reviewers, none told which side was new. The same
three lenses as round 1, plus a player of the genre.

| Reviewer (lens) | Round 1 | Round 2 |
|---|---|---|
| Usability researcher (first-time player) | 6 of 8 | 11 of 12 |
| Senior product designer (hierarchy, craft) | 5 of 8 | 10 of 12 |
| Game art director (art direction, premium feel, fantasy tone) | 1 of 8 | 4 of 12 |
| **Same three lenses** | **12 of 24 (50%)** | **25 of 36 (69%)**, target 75% |
| Mobile RPG player (new in round 2) | | 8 of 12 |

Per screen, how many of the four chose the new design:

| Screen | Chose new |
|---|---|
| First boot, boss ready, boss fight, Rift panel | 4 of 4 |
| Gate plaque, Ascension, Army, offline return | 3 of 4 |
| Gear | 2 of 4 |
| Hero battle screen, boss victory, Skills | 1 of 4 |

What changed between rounds: the usability reviewer now chose the new build on every screen but
one (the Hero battle screen), and the boss screens, which carry the new cinematics and the
designed challenge, won unanimously. What did not: the art director still preferred the old,
framed build on eight of twelve screens, writing that the new persistent HUD is "a generic
productivity-app dashboard with sans labels" while the new sheets and serif moments are the
stronger half. The identity gap of round 1 is narrower, not closed.

The weakest screens drew specific complaints, several made independently by two or more
reviewers. Each is now addressed:

| Screen | What the reviewers wrote | Change |
|---|---|---|
| Boss victory | "'Onward' is a dull grey button while 'BIND' is gold, so the main action is unclear"; the overlay is "not opaque enough: ... stat values show through behind the victory text" | Onward is always the one gold action and BIND a quiet button with gold text; the scrim behind moment text is opaque; leaving an unbound essence takes a second tap, with a warning |
| Gear, Skills, Rift | "the sheet crushes the battle"; "buries the battle under a mostly empty sheet"; "the fight is a thin strip" | Every tab opens at its base height; a detail that needs the room (a picked item, the Arts) raises the panel while it is open |
| Hero | "nothing marks the best buy"; the upgrade chip "looks the same and is low contrast"; "the upgrade pills are tiny" | Raised cost pills when affordable; a gold lozenge on the upgrade with the most Power per gold |
| Army, offline return, empty Gear | "'Star' and 'Evolve' are plain text with no button shape"; "'50+ upgrades ready' is plain grey text that looks like a label"; "'Find a boss' is a dark, low-contrast chip" and "doesn't say where it goes" | The cause was one token: the quiet button's fill measured 1.1:1 against the panel. It is now one step lighter with a hairline edge everywhere. The empty Gear button names the boss to face, or the Rift hunt |
| Gate plaque | "The red boss card and the gold Claim button sit side by side at almost equal weight" | Claim beside the gate is quiet, with gold text |
| Ascension | "'Starts over' gets no warning treatment" | Starts over in the threat red, You keep in jade |
| Boss fight | "A pill-shaped Retreat next to the controls invites mis-taps"; "Give the Retreat button a confirm step" | Retreat asks for a second tap within three seconds |
| Boss victory | "the essence line is truncated ('ling…')" | The row reads "Its essence lingers": the headline above already names the boss |
| Rift | "what '3/3' means is never stated" | "3 left" |
| Hero battle screen | "'Defeat enemies 1 of 3' is grey text on the scene and hard to read" | The objective sits on a small ink pill inside its 44px target |
| Hero battle screen (art direction) | the persistent HUD is "a generic productivity-app dashboard with sans labels" | A glyph per stat before its name (sword, heart, shield...), from 360px up. A partial answer at most; round 3 will say |

H1 will be re-run on these fixes with fresh reviewers.

**Blind pairwise judging (H1), round 3: MET on this measure. Verified, with a caveat.**

The same twelve screens and method (a new seed, the answer key outside the judges' folder), the
same four prompts and models, four fresh reviewers. The "before" side is the unchanged
pre-Rebirth build; the "after" side carries every fix above.

| Reviewer (lens) | Round 1 | Round 2 | Round 3 |
|---|---|---|---|
| Usability researcher | 6 of 8 | 11 of 12 | 11 of 12 |
| Senior product designer | 5 of 8 | 10 of 12 | 12 of 12 |
| Game art director | 1 of 8 | 4 of 12 | 12 of 12 |
| **Same three lenses** | **12 of 24 (50%)** | **25 of 36 (69%)** | **35 of 36 (97%)**, target 75% |
| Mobile RPG player | | 8 of 12 | 9 of 12 |

Eight screens went 4 of 4. The four dissents: the usability reviewer kept the old Hero battle
screen; the genre player kept the old boss sheet, victory and Army, each for the same reason:
"frames, portraits and rarity colour sell the fantasy" on reward moments. The product designer:
"System B is stronger, and it won every pair on the merits"; its weakness, that it "can read
like a polished fintech template rather than a dark-fantasy game".

The caveat, which limits what this shows: the judges are models, given the same prompts as in
round 2, and the changes between rounds answered round-2 judges' own words. Part of the gain may
be fitting this population's taste rather than players'. H1 as written is met; whether players
agree is H6 and H7, which need people on phones (`?playtest=1`).

What round 3 still found, and what was done:

| Finding | Reviewers | Change |
|---|---|---|
| Hints, the hand and Claim crowd the fight; the hand "does not clearly point at the button" | All four on the crowding; two on the hand itself | The drawing points up; above a target it pointed at its own bubble. It now turns to point down from above, its fingertip on the target's centre. Two browser tests assert the fingertip meets the target |
| "50+ upgrades ready" is "a heavy button nearly equal to Collect" | All four | A row with a chevron above a full-width Collect. In round 2 the same control read as a label: the row is the middle ground |
| "Attack spe..." truncated | All four | Introduced in this round by the stat glyph. Shorter names from 360 to 399px; no clipped text in the Hero panel at six widths |
| The Codex line in the Army header is cut off | Two | Its own ellipsis made it look cut: now the strongest bonus and a count of the rest |
| The boss sheet "reads like a settings sheet, not a boss intro": no boss art | Product designer, player | The boss's portrait (its own battlefield rig, rendered by the game) beside its name |
| No ceremony on victory: loot art, a burst, currency icons instead of dots | Product designer, player | **Open.** The rewards count up and the boss has its death cinematic, but stills cannot show either |
| Only two and a half to three Rift modes fit at the base height | Player, product designer | **Open.** The cost of opening tabs at the base; the grabber raises it |

Checking the "50+ upgrades ready" change at 320x568 found that the longer return sheet pushed
Collect below the fold, and the Ascension sheet already hid "Hold to ascend" there before this
round. Sheets now pin their own actions under the scrolling content, and a new browser test
asserts that both actions sit fully on screen at all seven phone sizes. Its first version also
failed at 390x844, where Collect was plainly visible: it measured the sheet before its slide
began. It now waits for the slide to end, fails on the old build at 320 only, and passes on the
new one at every size.

**Regressions caught by the tests, kept on the record.** Opening every tab at its base height
(the first fix above) pushed the equip and upgrade buttons of a picked item, and the rank-up
button of the Arts, below the panel's edge: the viewport suite failed at every phone size. The
raise on open detail views fixed it. The re-run then failed at 360x800 alone: Skills' Learn
button sat 4px past the edge. Measuring other sizes found it 23px past at 360x740 (Galaxy S8 and
S9), a size the suite did not cover. With 360x740 added, the suite found the same fault in the
Army panel, which had been there before this round: Deploy, Bond, Star and Evolve below the
edge, because its compact form only switched on below 700px of screen height. Both panels now
measure their own fit (`useCompactFit`): the full layout is drawn first and kept only if
nothing overflows, whatever the screen.

A process error, also on the record: one re-run hung because a stale server kept the port
(`next start` renames its process, so stopping it by command line missed it) and served the
previous build's page against the new build's files. That run's results were discarded; servers
are now stopped by folder, and each run first checks that the page boots without errors.
