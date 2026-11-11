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

### After phase 2

To be filled.
