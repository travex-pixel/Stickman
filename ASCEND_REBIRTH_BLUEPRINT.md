# ASCEND: Project Rebirth blueprint

Strategy and creative direction for the transformation of ASCEND. Written from an audit of the
repository at commit `d2dd1be` and of 17 screens captured at 390 x 844. Every instruction names
the real file it changes. The implementation lead is expected to challenge anything here that the
code contradicts, and to say so in the hand-back rather than silently diverge.

Visual reference: `docs/rebirth/mockup.html` (rendered: `docs/rebirth/mockup.png`). It shows the
battle screen with the Hero panel, the boss readiness sheet and a summon reveal in the new
identity, using the real fonts over a real frame of the battlefield.

**The one-line direction: quiet interface, loud battlefield.** The interface becomes calm,
typographic and nearly monochrome. Colour, motion and spectacle belong to the fight.

---

## 1. Existing architecture assessment

### What exists

| Layer | Where | State |
|---|---|---|
| App shell | `src/app/layout.tsx`, `src/components/game/GameShell.tsx` | Next.js 15 static export, one client page. Grid: top bar, battlefield, panel (31dvh), tab bar. |
| Simulation | `src/game/engine/World.ts` (1640 lines), `GameLoop.ts` | Deterministic fixed step 1/60, seeded RNG, typed events (`engine/events.ts`). Knows nothing of React or Pixi. |
| Controller | `src/game/GameController.ts` (2189 lines) | Owns World, renderer, audio, saves, modal queue. Exposes external stores (`hudStore`, `uiStore`, `profileStore`). |
| Renderer | `src/game/render/BattleRenderer.ts` (1191), `rigs/Rig.ts` (633), `Background.ts` (594), `Particles.ts`, `DamageNumbers.ts` | PixiJS 8. Procedural rigs animated by transforms. Painted backdrops cached as textures. Pooled particles and numbers. Position interpolation between sim steps. |
| UI | `src/components/**` (3,800 lines), `src/app/globals.css` (549) | React 19, Tailwind 4, motion. Five panels, one modal host (815 lines), battle overlays. |
| Progression | `src/game/progression/**`, `src/game/data/**` | Stats, gear, skills, perks, ranks, shadows, campaign gates, depths, ascension tree, Tyrant, objectives, offline. |
| Persistence | `src/persistence/**` | IndexedDB, version 12, migrations, field-by-field sanitiser, backup, unload stash. |
| Audio | `src/game/audio/synth.ts`, `AudioManager.ts` | Runtime-synthesised effects and ambience through Howler. |
| Tests | `tests/unit` (214), `tests/e2e` (42), economy simulator | All passing at the audited commit. |

### Verdict by system

**Preserve (sound, do not rewrite):**
- The simulation, its event stream and its determinism. All Rebirth animation work is render-side.
- The controller/store split. Combat does not re-render React: HUD reads go through selectors.
- Persistence. Version 12 saves must load unchanged; Rebirth adds no save fields unless section 10
  says so.
- The campaign rules: farming never stops, boss gates open only on an explicit FIGHT, a lost boss
  returns to farming, nothing retries a boss. These are product law.
- The painted backdrops in `Background.ts`. They are the best-looking thing in the game.
- The pooled particle system and BitmapText number pool.

**Refactor (right idea, weak execution):**
- `Rig.ts`: poses are recomputed from scratch every frame with no blending, so every state
  change pops. One generic melee swing for every fighter. No secondary motion.
- `BattleRenderer.ts`: no camera. The arena maps 1:1 to the canvas, so on a phone the fighters
  fill about 12% of the frame height and often fight at its edge (see
  `docs/rebirth/field.jpg`). Shake is per-frame random jitter. Effects are thin arcs and dots.
- `DamageNumbers.ts`: numbers are set in the display serif with a 5px stroke.
- `ModalHost.tsx`: fifteen modal kinds in one file, each hand-styled.

**Redesign (does not meet the bar):**
- The whole visual language in `globals.css`: brown gradients, gold hairlines, bevels and a
  bordered box around nearly every element (cards inside the panel, HOLD buttons inside cards,
  chips, plaques).
- Typography: Marcellus (a Roman-capitals display face) for headings and numerals, wide-tracked
  9 to 10px capitals for labels. This is the "generic fantasy" look.
- The summon reveal: one sequence for every rarity, differing in particle colour and count.
- Boss presentation: a text banner and a bar.

### Three defects found during the audit

1. **Melee hits land before the swing.** `World.progressAttack` applies damage on the first
   frame of the `attack` state. `computePose` starts the forward swing at that same frame, so the
   number appears while the arm is still raised. The fix is render-side (section 7).
2. **Terminology drifts.** The same thing is called summons, shadows, Oathbound, companions and
   army across screens. Section 6 fixes one vocabulary.
3. **Minimum type size is 9px.** Dozens of labels are 9 to 10px capitals. The new floor is 11px.

---

## 2. Complete UX audit

Scored against: primary objective clear, primary action obvious, hierarchy, feedback, comfort.

| Screen | What is wrong today | Severity |
|---|---|---|
| Battlefield | Fighters tiny and off-centre; 40% of the frame is empty sky. Nine separate bordered overlays (army portraits, command bar, quest pill, plaque, medallions, banner, toasts, mode HUD, chips) compete with the fight. | High |
| Top bar | Six boxed items in 44px. Avatar duplicates the level. Stage dots are 6px. | Medium |
| Hero | Six bordered cards, each holding a second bordered HOLD button; label, level, milestone marker, value, preview and cost all at 10 to 15px. The eye has no entry point. Power, the headline number, is 18px. | High |
| Army (Summons) | Roster of 36px portraits, then a card crammed with four stat boxes and four buttons in 262px. No sense of who these characters are. | High |
| Gear | Six empty squares and a sentence. The empty state teaches nothing and shows no goal. | High |
| Skills | Best of the five. Still boxed; "2 pt" is easy to miss. | Low |
| Rift | Eight bordered tiles with truncated taglines; the campaign's own position is four small boxes. | Medium |
| Boss readiness | Good content, poor form: thirteen bordered boxes in one sheet. Forecast, the key fact, is body text. | High |
| Boss fight | Boss bar is a thin line with small caps. Entrance is a centred caption. | High |
| Victory | Adequate, generic. Reward numbers are small. | Medium |
| Summon reveal | A card with a 96px portrait in a box. The character never appears at scale. | High |
| Offline | Four stat boxes, a warning box, two buttons. Fine structure, boxed execution. | Medium |
| Ascension | Three stat boxes, two coloured boxes, a paragraph. The consequence of the hold is clear; the excitement is absent. | Medium |
| Objectives, Journal, Settings | Functional lists wrapped in cards within a card. | Low |

Cross-cutting findings:

- **Boxes, not hierarchy.** Separation is done with borders, so nothing is more important than
  anything else. Fix: remove borders; separate with space and hairlines; let size and weight
  carry importance.
- **One primary action per view is not enforced.** Several views show two gold buttons.
- **Modal overload.** Centred cards for everything. Fix: one bottom-sheet pattern, plus
  full-bleed "moments" for reveals and boss events.
- **Feedback is uneven.** Hold buttons tick and fill; most taps only scale.
- **Touch targets.** Stage tiles, journal filters and roster portraits are under 40px. Floor: 44px.

---

## 3. Visual identity specification

**Principles**

1. The interface is graphite and warm white. It has no gradients, bevels, inner shadows or glow.
2. Colour means something or it is not used: gold is value and the primary action, crimson is
   threat, jade is life and essence, the five rarity hues are rarity.
3. Separation by space first, a 1px hairline second, a surface step third. Borders around
   controls are removed. A control is a filled shape.
4. One primary action per view, filled. Secondary actions are quiet fills or plain text.
5. Type carries hierarchy: three sizes per view at most, weight 400 to 600, never 800.
6. Uppercase only for the eyebrow style, at most once per view.
7. Over the battlefield, controls are dark glass (blur 14px, 56% graphite), borderless, so the
   painting shows through and the fight stays the subject.
8. Spectacle is saved for moments that earn it: a crit, a bind, a boss, a legendary.

**Shape and space**

- Spacing scale (px): 4, 8, 12, 16, 20, 24, 32. Screen gutter 16. No other values.
- Radii: 10 (small controls), 14 (buttons, rows), 22 (panel shoulders), 28 (sheets), 999 (pills).
- Touch target floor 44 x 44. Primary buttons 52 high.
- Elevation: none inside the interface. Sheets sit on a blurred scrim, not a drop shadow.

**Iconography**: keep the stroke set in `src/components/ui/Icon.tsx`, at 1.7 stroke, 20 to 22px.
Currency glyphs become simple filled marks (gold: disc, essence: diamond, core: hexagon,
Aether: four-point star).

---

### 3a. Amendment after blind judging: "Ink and Gilt, refined"

Evidence (`docs/rebirth/EVIDENCE.md`, H1): blind reviewers preferred the phase-1 interface in only
50% of matched screens. All three said it was clearer, and that it had lost the game's identity:
"a generic dark template". Neutral graphite, borderless pills and sans numerals throughout read as a
productivity app. The amendment keeps the clarity and restores a world:

- Surfaces are warm ink, not neutral graphite: `bg-0 #0c0b09`, `bg-1 #15130f`, `bg-2 #1e1b16`,
  `bg-3 #29251e`.
- The panel carries texture: a paper grain at about 5% and a gilt hairline along its top shoulder.
  Never over the battlefield.
- The serif sets the numbers that matter: Power, stage, stat values, boss names, reward totals,
  level, rank. Condensed sans stays for dense small numerals.
- One gold ornament means "active or selected": a small lozenge. Ability discs are medallions (a
  thin gold ring when ready; a double ring for the ultimate).
- The boss challenge is a designed object, not a saturated slab: dark crimson-black, a crimson
  rim, the boss name in serif, a verb, and the readiness.

Principle 1 of section 3 ("no gradients, bevels, inner shadows or glow") still holds. What changes
is principle 2's reading: colour and ornament are allowed where they carry the world, not only
where they carry meaning.

## 4. Typography

**Families (both SIL OFL, self-hosted, already added under `src/app/fonts/`):**

- **Instrument Sans** variable (`instrument-sans-latin-variable.woff2`, 57 KB): weight 400 to
  700 and width 75 to 100, with tabular figures. The whole interface.
- **Instrument Serif** regular and italic (21 KB each): names and story only. Boss names,
  shadow names, region names, sheet titles for "moments", flavour lines.

Why: Instrument Sans has more character than a neutral grotesque, and its width axis solves the
phone problem directly: numerals and tight labels can condense to 78 to 88% and stay a single
family. Geist was the alternative; it reads as developer tooling. Inter and system stacks were
excluded by brief. The serif gives the fantasy its voice without a "fantasy font".

Remove Marcellus and Manrope (`layout.tsx`, the four Manrope files, the Marcellus file and their
licence texts) once nothing references them.

**Scale** (define as utilities in `globals.css`; sizes in px, line height after the slash):

| Token | Family | Size | Weight | Width | Tracking | Use |
|---|---|---|---|---|---|---|
| `t-moment` | Serif | 40/40 | 400 | – | -0.01em | Summon name, boss name card, Victory |
| `t-display` | Serif | 30/32 | 400 | – | -0.01em | Sheet titles for moments |
| `t-title` | Sans | 17/22 | 600 | 100 | -0.01em | Panel and sheet titles |
| `t-body` | Sans | 14/20 | 400 | 100 | 0 | Body |
| `t-label` | Sans | 12/16 | 500 | 100 | 0 | Field labels, secondary |
| `t-caption` | Sans | 11/14 | 500 | 100 | 0 | Tertiary, minimum size |
| `t-eyebrow` | Sans | 11/14 | 600 | 100 | 0.09em, uppercase | One per view |
| `t-flavour` | Serif italic | 16/21 | 400 | – | 0 | Counter hints, epithets, lore |
| `t-num-xl` | Sans | 30/30 | 600 | 86 | -0.01em | Power, forecast, reward totals |
| `t-num-l` | Sans | 20/24 | 600 | 86 | -0.01em | Stat values |
| `t-num-m` | Sans | 14/18 | 600 | 90 | 0 | Costs, currencies, counters |
| `t-button` | Sans | 16/20 | 600 | 100 | 0 | Buttons |

All numerals: `font-variant-numeric: tabular-nums`. Width is set with `font-stretch`. Bold (700)
is reserved for damage numbers.

**Canvas numerals.** `DamageNumbers.ts` builds BitmapText from a CSS family. Canvas cannot select
a variable width reliably on Safari, so cut one static instance: Instrument Sans at width 78,
weight 700, digits and `.,KMBTQaQiSxSpOcNoDc+-!%×` only (`fonttools varLib.instancer` then
`pyftsubset`, both pip-installable; about 8 KB). Ship it as family `Ascend Numerals`. Fallback
if the tooling fails: the variable family at weight 700.

- Normal hit: 30px, warm white, 2px 55% black offset shadow, no stroke.
- Crit: 44px gold, with a small "CRIT" suffix at half size.
- Player damage taken: 26px crimson.
- Heal: 26px jade with "+".

---

## 5. Colour and design tokens

Replace the `@theme` block and `:root` in `src/app/globals.css`. Keep the old colour names as
aliases for one commit only if needed to land incrementally; the end state has no `ink`, `parch`,
`mist`, `gild`, bevel or hairline-gold tokens.

```css
@theme {
  --color-bg-0: #0a0a0b;   /* app, behind everything */
  --color-bg-1: #121213;   /* panel, sheets */
  --color-bg-2: #1b1b1d;   /* controls, rows on press */
  --color-bg-3: #262629;   /* pressed, selected */
  --color-t1: #f3f0e9;     /* primary text */
  --color-t2: #a9a59d;     /* secondary */
  --color-t3: #74716b;     /* tertiary, disabled */
  --color-gold: #dab86c;
  --color-gold-ink: #1b1508;
  --color-crimson: #cc3f4b;
  --color-jade: #5ecaa8;
  --color-common: #9a968e;
  --color-uncommon: #6cc49a;
  --color-rare: #74a8ea;
  --color-epic: #a98be8;
  --color-legendary: #e3bd6a;
  --font-sans: var(--font-instrument-sans), system-ui, sans-serif;
  --font-serif: var(--font-instrument-serif), Georgia, serif;
}
:root {
  --line: rgba(255, 255, 255, 0.07);
  --line-2: rgba(255, 255, 255, 0.13);
  --glass: rgba(12, 12, 13, 0.56);
  --tint-gold: rgba(218, 184, 108, 0.12);
  --tint-crimson: rgba(204, 63, 75, 0.16);
  --tint-jade: rgba(94, 202, 168, 0.12);
  --ease: cubic-bezier(0.2, 0, 0, 1);          /* standard */
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);   /* entrances */
  --ease-in: cubic-bezier(0.4, 0, 1, 1);       /* exits */
  --d1: 120ms; --d2: 200ms; --d3: 320ms; --d4: 480ms;
}
```

Contrast (computed, WCAG): on `bg-1`, `t1` is 16.5:1, `t2` 7.6:1, `t3` 3.8:1 (tertiary and
disabled only, never body), gold 9.9:1, jade 9.4:1, crimson 3.9:1 (so crimson text is only used
at 14px semibold or larger; body-size warnings use `t1` with a crimson dot). `gold-ink` on gold
is 9.6:1. White on the crimson fill is 4.8:1.

Delete: the paper-grain overlay on `#app-shell::after`, `.panel-surface`, `.card*`, `.gild`,
`.text-glow-gold`, `.ability-btn*`, `.medal*` gradients and rings, `.hold-btn` chrome,
`.btn-primary` gradient, `.btn-boss`, `.boss-plaque` and its breathing glow, `.modal-card` and its
gilt line, `.chip`, `.bar-*` gradients. Replace with the primitives in section 6.

Backdrops keep their own palettes. Rig colours keep their own palettes.

---

## 6. Screen-by-screen redesign

**Vocabulary (apply everywhere, including toasts and tutorial copy):** a bound enemy is a
**shadow**; all of them are the **Oathbound**; the deployed ones are the **army**; the act is
**BIND**. The tab is labelled **Army**. Never "summon" as a noun, never "companion".

**Test contract.** Every existing `data-testid` and `data-guide` stays on an element with the same
role. Before and after: `grep -rhoE 'data-testid=("[^"]*"|\{`[^`]*`\})' src | sort -u` must show
no removals. Copy asserted by tests (`grep -rn "toContainText\|toHaveText\|getByText" tests/e2e`)
must be checked whenever copy changes, and the test updated in the same commit when the new copy
is deliberate.

### Primitives (new files under `src/components/ui/`)

| Component | Spec |
|---|---|
| `Button.tsx` | Variants `primary` (gold fill, gold-ink text), `threat` (crimson fill, white), `quiet` (bg-2 fill, t1), `plain` (text only, t2). Height 52 (`md`) or 40 (`sm`), radius 14. Press: scale 0.97 and brightness 0.92 over 120ms. Disabled: 40% opacity, no press. Optional `loading`. |
| `Sheet.tsx` | Bottom sheet. bg-1, radius 28 top, grabber 36 x 4, padding 20 with safe-area bottom. Enters translateY 100% to 0, 320ms `--ease-out`; exits 200ms `--ease-in`. Scrim: rgba(6,6,7,0.6) with 10px blur, fades 200ms. Tap scrim or drag down 80px to dismiss when `dismissible`. Max height 86dvh, scrolls inside. |
| `Moment.tsx` | Full-bleed takeover for reveals and boss cards: scrim at 86%, content bottom-aligned, the Pixi figure visible above. |
| `Row.tsx` | List row: 52 min height, 16 gutter, hairline below, optional leading glyph, trailing value or chevron. Press: bg-2. |
| `Stat.tsx` | Label (`t-label`, t2) over value (`t-num-l`). Optional delta in jade. |
| `Segmented.tsx` | Pill track with a sliding thumb (motion `layoutId`), 200ms. Used for commands, journal filters, ascend tabs, skill paths. |
| `Meter.tsx` | 3px bar, bg-3 track, solid fill, 200ms width transition. No gradients. |
| `Currency.tsx` | Glyph plus `t-num-m`, animated count on change (section 7F). |
| `Toast` (in `BattleOverlays.tsx`) | One line of glass under the top bar, `t-label`, 200ms in, 2.2s hold, 200ms out. Tone shown by a 6px dot, not a coloured box. |

### Shell: `GameShell.tsx`, `TopBar.tsx`, `TabNav.tsx`, `PanelHost.tsx`

- Shell background `bg-0`, no radial gradient, no grain.
- **Top bar (44px, no boxes).** Left: "Level 24". Centre: stage number and region name, three
  14 x 2 wave ticks under it; in a boss fight the centre shows "Boss". Right: gold and essence as
  `Currency`, then the speed toggle ("1×"/"2×", plain text, 44px target) and the menu icon. A 1px
  XP line runs along the bottom edge of the bar. Remove the avatar.
- **Panel.** `bg-1`, top radius 22, overlapping the battlefield by 14px so the field appears to
  continue behind it. Padding 16. Panel content cross-fades 120ms on tab change (keep the
  no-wait behaviour fixed earlier).
- **Tab bar (58px).** `bg-1`, hairline top. Icon 21px over an 11px label. Active: t1. Inactive:
  t3. No underline, no gold. Badge: a 6px gold dot at the icon's top right.
- **Tall sheet (P1, after everything else in this section ships).** Army, Gear and Skills need
  more than 262px. Let the panel grow to `min(60dvh, 520px)` over the battlefield (the canvas does
  not resize). `PanelHost` gets a grabber and two detents; Hero and Rift stay at the base height.
  The ability bar rides the panel's top edge. The renderer exposes
  `setViewportInsets({ bottom })` so the camera lifts the action above the sheet (section 7,
  camera). If this destabilises the e2e suite, ship the base height only and say so.
  *Amended after blind judging round 2:* every tab opens at its base height (a tall panel by
  default "crushes the battle"), the grabber still grows it, and a detail whose actions need the
  room (a picked item, the Arts) raises the panel only while it is open (`useRaisePanel`).

### Battlefield overlays: `BattleOverlays.tsx`, `AbilityBar.tsx`

Goal: the player watches a fight, not a dashboard. At most five overlay groups at rest.

- **Top-left:** army command `Segmented` on glass (Follow, Attack, Guard).
- **Top-right:** army status as 30px glass discs with a jade health ring (grey and 50% when
  down). No portrait boxes.
- **Bottom-left, above the abilities:** the quest as one line of text with a 44px progress
  tick: "Defeat enemies 2 of 3". When complete it becomes a small gold `Button sm` "Claim 40".
- **Ability bar:** 46px glass discs, borderless. Ready: icon t1. Cooling: icon 25%, seconds in
  `t-num-m`, a 1.5px progress ring sweeping clockwise. Locked: lock glyph and "Lv 6" at t3.
  The ultimate is 56px with a gold charge ring; when full the ring pulses once per 2s (opacity
  only). AUTO is a text toggle at the row's left: "AUTO" in jade when on, t3 when off.
  On cast: the disc scales 0.9 then 1.0 over 160ms and its ring flashes t1.
- **Boss gate:** replaces the quest line with a crimson `Button`: boss portrait disc, "Challenge",
  the boss name in serif, readiness as a word at the right. One slow opacity pulse on the
  portrait ring; no glow box.
- **Push chip:** a quiet `Button sm` "Push to stage 12".
- **BIND:** when an essence orb is on the field, a centred glass pill above the ability bar:
  "BIND · 62%" with a countdown ring. It no longer tracks the orb's position (the camera moves
  now); the orb itself is marked in the scene (section 9). Several orbs: the pill addresses the
  rarest, with a "+2" counter. Keep `data-testid="claim-essence"`.
- **Boss bar (in a boss fight):** under the top bar: boss name in serif 20px left, phase ticks
  right, a 4px crimson `Meter` full width, with a white "damage ghost" that drains 300ms behind
  the real value.
- **Banners (`WaveBanner`):** stage changes show "Stage 12" in serif 30px for 1.2s, centre
  top third, fade and 8px rise. Region and depth changes add the region name in `t-flavour`.

### Hero: `HeroPanel.tsx`

Objective: get stronger now. Primary action: hold a stat.

- Header: "Power" (`t-label`) over the value in `t-num-xl`, with the "+1.4%" gain chip in jade
  (keep `PowerReadout`, restyled). Right: one quiet pill for rank ("Rank E · Trial ready", gold
  dot when ready). The Ascend entry sits beside it only once unlocked.
- Stats: a 2 x 3 grid with hairlines between cells and no cards. Each cell is the hold target:
  label and "Lv 48" in `t-label`, value in `t-num-l` with the next-level delta in jade, cost as a
  gold-tint pill at the right (`t-num-m`; t3 and untinted when unaffordable; "Max" when capped).
  A 1px gold line along the cell's bottom edge shows progress to the next x1.6 milestone.
- Press and hold: cell fills bg-2; each purchase ticks the value (section 7F) and plays the
  existing sound. Unaffordable press: the cost pill shakes 4px twice in 200ms and the error tone
  plays. Locked cell: label, the unlock rule in t3, a lock glyph; no dashed border.
- Milestone reached: the cell flashes gold tint once (320ms) and the value scales 1.12 to 1.

### Army: `SummonsPanel.tsx`, `Portrait.tsx`

Objective: field the best army and grow it. Primary action: Deploy or Recall.

- Roster: a horizontal scroll of 56px discs, rarity shown as a 2px ring, deployed marked by a
  jade dot, "Lv 8" under each. First cell when the collection is empty: an empty state (below).
- Detail (the selected shadow): name in serif 24, role and rarity as the eyebrow, the trait in
  `t-flavour`. Then one row of three `Stat`s (Health, Attack, Bond). Then actions: primary
  `Button` Deploy/Recall; quiet buttons Bond (hold), Star, Evolve, each showing its cost or what
  is missing. Codex bonus as a caption line.
- Header caption: "Deployed 2 of 2 · Codex +15% Attack, +9% Health".
- Empty state: "No shadows yet. Marked enemies leave an essence when they fall. Tap BIND."

### Gear: `GearPanel.tsx`

- Left: six equipped slots as 52px squares in a 3 x 2 grid, bg-2, radius 14, rarity as a 2px
  bottom edge, the item glyph, "+7" level. Empty slot: slot glyph at t3.
- Right: the bag as a 4-column grid of the same squares, scrolling.
- Selecting an item opens its detail in place of the bag: name (serif 22), rarity eyebrow,
  main stat as `Stat`, substats as rows, effect in `t-flavour`, and a compare line against the
  equipped item ("+12 Attack" jade or "-3" crimson). Actions: primary Equip; quiet Upgrade
  (hold, cost), Forge, Salvage.
- Empty state: the six slots plus "Gear drops from enemies. Every boss drops a piece."

### Skills: `SkillsPanel.tsx`

- `Segmented` for Power, Soul, Command, Arts. Points: "2 points" in gold at the right when any.
- The five-node path stays, redrawn: 40px discs on a hairline; learned = filled t1 with dark
  numeral; next = gold ring; locked = bg-2. Selected node detail below: name `t-title`, effect
  `t-body`, primary `Button` "Learn · 1 point".
- Arts: rows (ability glyph, name, rank pips, cost pill); form switch as a `Segmented` inside the
  row when a technique is owned.

### Rift: `RiftPanel.tsx`

- Header: region name in serif 22; under it the depth line when past stage 30, else the
  subtitle in `t-flavour`. Right: Goals and Journal as plain icon buttons with counters.
- Stage strip: a horizontal row of five stage cells (number in `t-num-l`, a tick or "new" under
  it), the current one filled bg-3.
- Modes: a list of `Row`s, not tiles. Leading glyph, name, one-line status in t2, trailing keys
  ("2/2") or a lock reason. The Rift Tyrant row comes first and carries this week's boss name.

### Sheets and moments (`ModalHost.tsx`, `BossCards.tsx`, `SettingsModal.tsx`)

Split `ModalHost.tsx` by kind into `src/components/sheets/*.tsx`; the host only routes.
Everything is a `Sheet` unless marked Moment.

- **Boss readiness (Sheet).** As the mockup: eyebrow "Boss · Stage 12", name in `t-display`,
  reward line, then the forecast as the hero ("0 of 4" in `t-num-xl`, the tier word at the right
  in its tone, four pips), tips as tappable `Row`s, the counter hint in `t-flavour`, the depth
  twist as a row when present, then `plain` "Keep farming" and `threat` "Fight".
- **Boss victory (Moment).** "Victory" eyebrow, "The Drowned Warden falls" in `t-moment`, time
  as caption; rewards count up in `t-num-xl` (gold, XP, cores); loot as rows with rarity dot;
  the BIND offer as a row with a gold `Button sm`; primary "Onward to stage 13" with the
  auto-continue countdown as a thin `Meter` on the button's bottom edge.
- **Boss defeat (Sheet).** "The Warden stands" in `t-display`; how close ("left at 61%") as the
  hero number; three facts as `Stat`s; the top two tips as rows; primary "Get stronger", plain
  "Keep farming".
- **Summon reveal (Moment).** Section 9.
- **Offline (Sheet).** Eyebrow "While you were away", duration in `t-display` ("4h 0m"), gold and
  essence in `t-num-xl`, four facts as a 2 x 2 of `Stat`s, the waiting boss as a crimson-tint
  row, primary "Collect", plain "50+ upgrades ready".
- **Ascension (Sheet, tall).** `Segmented` Ascend / Aether tree. Ascend: "Begin the climb anew"
  in `t-display`; the power multiplier before and after as two large numbers with an arrow; two
  plain lists, "Starts over" and "You keep", without coloured boxes; the Rift Memory line; hold
  to confirm on a `primary` button whose fill sweeps left to right while held. Tree: rows with
  name, effect, running total, level "3/100", and a cost pill.
- **Perk choice (Sheet).** Three large rows, each a full-width press target with name and effect.
- **Technique learned (Moment, short).** Glyph, name in serif, one line, Equip / Keep.
- **Rank up (Moment).** Old letter to new letter (serif 72, cross-fade with 8px slide), rewards
  as rows.
- **Mode result, Hunt list, Tyrant, Objectives, Journal, Settings (Sheets).** Lists of `Row`s
  with section titles in `t-eyebrow`. Settings toggles become iOS-style switches (jade when
  on); sliders get a 3px track and a 20px thumb; "Reset save" is `plain` in crimson and asks
  with a hold.
- **Boot veil.** bg-0, "ASCEND" in serif 44 with 0.02em tracking, "Claim what falls" in
  `t-flavour`. No glow.

---

## 7. Animation direction and timelines

All of this is render-side. The simulation, its event order and its timings do not change.
New code lives under `src/game/render/`.

### A. Animation foundation

1. **`render/anim/ease.ts`**: `damp(current, target, lambda, dt)` (frame-rate independent
   exponential smoothing), `spring` (critically damped by default), `easeOutCubic`,
   `easeInCubic`, `easeOutBack(overshoot)`, `easeInOutSine`, and `noise1(t)` for shake.
2. **`render/anim/Timeline.ts`**: a tiny sequencer for cinematics: `at(t, fn)`,
   `tween(t0, t1, ease, fn)`, `update(dt)`, `skipTo(label)`, `done`. Summon, BIND and boss
   sequences are timelines, not hand-rolled `if (t < a) ... else if` chains.
3. **Pose blending in `Rig.ts`.** `animate` gains `dt`. Keep `computePose` as the target; hold a
   `current` pose and move every channel toward the target with `damp`. Lambda by state: idle 9,
   move 14, windup 16, attack 60 (near-instant so contact is exact), recover 10, hit and stagger
   45, cast 14, dodge 40, victory 8. On a state change into `attack`, `hit`, `stagger` or `dodge`,
   snap rather than blend.
4. **Secondary motion in `Rig.ts`.** Cape, weapon and head lag the torso: each follows with its
   own lower lambda (cape 5, head 12, weapon 20) so starts and stops overlap. Add a slow weight
   shift to idle (hips x ±1.2u over 3.1s, out of phase with breathing) and a blink (eyes scale-y
   to 0.1 for 90ms every 3 to 6s, seeded).
5. **Reduced motion.** `reducedEffects` or `prefers-reduced-motion`: no hit-stop over 30ms, no
   camera kick or zoom (follow only), shake at 25%, particle counts at 40%, cinematics cut to
   their final beat with a 200ms fade.

### B. The camera (`render/Camera.ts`, wired in `BattleRenderer.ts`)

The largest single improvement to how the game looks.

- Put the background container, ground effects, entities, effects, projectiles, orbs and damage
  numbers in one `cameraLayer`. The vignette, flash and cinematic text stay outside it.
- **Framing.** Each frame, compute the box around the warrior and every hostile within 260
  world units of them (the boss always), padded 70 units. Target zoom = clamp(viewWidth / box
  width, 1.0, 1.32). Target centre = box centre, biased 20% toward the warrior, clamped so the
  view never leaves the painted area. Follow with `damp`: position lambda 4, zoom lambda 2.5.
  At rest in a typical fight this lands near 1.2, which makes fighters about 45% larger.
- **Kick.** On a hit dealt by the warrior, add an impulse of 3px (crit 7, heavy 9, kill 5) along
  the hit direction; it returns with a spring (stiffness 240, damping 22).
- **Punch.** On crit, ability impact and boss phase: zoom ×1.025 (ultimate ×1.05), returning over
  260ms `easeOutCubic`.
- **Shake.** Replace the per-frame random with trauma: `shake(amount)` adds to `trauma` (0 to 1),
  which decays 1.6 per second; offset = `trauma² × 10px × noise1(time × 28)` on each axis,
  rotation `trauma² × 0.6°`.
- **Backdrop sharpness.** `Background.layout` paints at the canvas size; at 1.32 zoom that is
  visibly soft. Paint at `min(2, devicePixelRatio) × 1.3`.
- **Insets.** `setViewportInsets({ bottom })` shifts the framing centre up by half the inset.
- **Mapping.** `controller.view` is used by `focusAt` and by `pickEnemy`. Replace its scale and
  offset fields with `project(worldX, worldY)` and `unproject(clientX, clientY)` that include the
  camera. Search for every reader of `controller.view`.
- **Off-screen hostiles.** A 10px t3 chevron at the screen edge for any hostile outside the view;
  crimson if it is winding up at the warrior.

### C. Combat choreography

**Fixing contact (the defect in section 1).** Damage lands at `attack` t = 0. So the swing must
already be at the target then:

| Sim state | What the body does | Curve |
|---|---|---|
| `windup` 0 to 70% | Anticipation: weight back, arm up, torso coils away from the target, a 1.5u crouch | `easeOutCubic` |
| `windup` 70 to 100% | The strike: blade travels from raised to through the target; body steps in 6u | `easeInCubic` (accelerating into contact) |
| `attack` (0.12s) | Contact held for the first 40ms (the pose that reads as the hit), then follow-through past the target with 12% overshoot | hold, then `easeOutBack(1.4)` |
| `recover` | Settle to guard; the weapon arrives last | `damp` blend |

**Combo variety (warrior and reaper-style melee).** Keep a swing counter per entity view
(render-side, incremented on `attack_swing`). Three alternating arcs: 1 high-right to low-left,
2 backhand low-left to right, 3 overhead with a deeper step. Each is a different target pose
set in `computePose` (pass `variant`). Brutes keep one heavy overhead with a longer hold;
shieldbearers get a short thrust; archers and casters keep their own.

**Weapon trail (`render/Trail.ts`).** Sample the weapon tip and a point 60% up the blade in
screen space each frame while the state is late-windup or attack; keep the last 7 samples; draw
a quad strip (Pixi `Graphics` polygon is enough at this count) between the two sample tracks,
alpha and width tapering to zero at the tail, additive, in the weapon path's colour. It lasts
120ms after the swing. This replaces the `slash` arc effect for melee.

**Impact (on `hit` events).**

| Hit | Hit-stop | Camera | Target reaction | Effects |
|---|---|---|---|---|
| Warrior normal | 25ms, at most once per 90ms | kick 3px | squash 6%, slide 4u away, white silhouette 1 frame | 5 sparks along the swing direction (a 70° cone, not a full circle), 1 flash disc |
| Warrior crit | 60ms | kick 7, punch ×1.025 | squash 10%, slide 10u, white 2 frames | 12 sparks in the cone, a 4-point star flash, a thin shock ring; number in gold |
| Warrior heavy or ability | 45ms | kick 9, trauma 0.25 | stagger pose, slide 14u, dust kick at the feet | ability-specific (below) |
| Kill | +30ms | kick 5 | death variant (below) | – |
| Army hit | none | none | squash 4%, 1 frame tint | 3 sparks |
| Warrior takes a hit | 40ms (heavy 70ms) | trauma 0.2 (heavy 0.45) | recoil pose | crimson vignette pulse 200ms |

Hit-stop goes through `GameLoop.addFreeze` (it already exists; the controller applies 35ms on
crits at `GameController.ts:610`). Move the policy into one function with the cooldown above so
2× speed and large packs do not stutter: total freeze is capped at 12% of any one second.
"White silhouette" is a tint on the rig container plus `rig.setHitFlash`; no filters.

**Knockback read.** The sim already moves the target. Add render-side dust at the feet when a
slide exceeds 8 units, and lean the body back along the slide.

**Deaths (`Rig.ts`, `dead` state).** Three variants chosen by the killing blow (carry `crit`,
`heavy` and direction on the view from the last `hit` event):
1. Collapse (normal): knees fold, torso drops forward, 0.5s, then the body sinks into an ink
   pool that shrinks away over 0.5s. No fade-to-transparent.
2. Launch (crit or heavy): the body is thrown 40 to 70u along the hit direction on an arc with
   spin, lands with a dust burst and a 0.15 trauma, then sinks.
3. Dissolve (ability or burn): the silhouette breaks upward into 14 shards in the element's
   colour over 0.45s.
Elites add a ring in their affix colour. Bosses are in section D.

**Ability signatures (`castFx`).** Each gets anticipation, a single strong shape and an aftermath:
- Arc Slash: 80ms crouch, a crescent that travels 140u and scales 0.6 to 1.2, 2-frame white
  crescent then the path colour; cut line lingers 200ms on the ground.
- Thunder Strike: 120ms sky-darken (backdrop tint 25%), a 3-segment bolt drawn in 2 frames,
  full-white 1 frame, ground scorch ring, 60ms hit-stop, trauma 0.4.
- Shadow Dash: 4 afterimages in ink with decreasing alpha, speed lines along the path, a cut
  flash on arrival.
- Soul Burst: jade motes are pulled inward for 150ms, then a ring expands to 180u; allies inside
  pulse jade once.
- Void Nova: the field desaturates for 400ms; a dark disc expands with a bright rim, debris is
  pulled in then thrown out.
- Ascendant Fury: letterbox 20px, slowed time, the camera holding the whole fight. The warrior
  blinks foe to foe, seven cuts 160ms apart, alternating sides: an ink afterimage with a gold rim
  where he was, a thin streak, a crossing cut through the target and a short stop on each; the
  seventh is wider, with a ring, trauma 0.6 and a longer stop. He then blinks back to where he
  began and settles; the ring and the running total's pop close it around him.
- Technique forms follow the same grammar.

**Telegraphs.** Keep true sizes. Draw as a thin rim that fills inward with the remaining time,
crimson for hostile, with a 1-frame white flash on the frame it resolves.

### D. Bosses

- **Entrance (sim phase `boss_intro`, 2.4s; do not change the timer).**
  0.0s letterbox bars slide in (22px, 240ms); army and enemies dim 30%; camera pans to the spawn
  point and zooms to 1.3 over 600ms.
  0.3s the boss emerges by kind: Wardens rise from a widening ground fissure with dust; the
  Drowned Warden surfaces through an expanding water ring with spray; the Ember Herald descends
  in a falling column of embers; the Crownless King walks out of a gold horizon flare while two
  banners unfurl. Use the existing `emerge` state with a kind-specific effect set.
  1.1s impact beat: trauma 0.5, 80ms stop, the name card appears: name in `t-moment`, a 40px
  hairline, the counter hint in `t-flavour`.
  2.0s card fades, bars retract, camera returns to fight framing by 2.4s.
- **Phase change (`boss_phase`).** 350ms hit-stop; white 1 frame; shock ring to full width;
  the backdrop tint shifts 20% toward the boss's glow for the rest of the fight; the boss bar's
  fill snaps to the next phase tick with a crack mark; "Phase two" in serif for 1s.
- **Heavy attacks.** Wind-up shows a rim telegraph plus a body cue (eyes flare, weapon glow);
  landing gives trauma 0.5 and a dust ring.
- **Death.** On the killing blow: 350ms freeze (exists), camera zoom to 1.35 on the boss, a
  2-frame inverted impact frame (boss white on black field). Then 1.2s: the boss kneels,
  cracks of its glow colour spread over the silhouette, and it breaks upward into 60 shards
  that rise and fade; a slow full-width ring; ambient motes drift for 2s. Then the Victory
  moment.
- **Tyrant break.** Keep "BREAK ×n"; restyle to the numeral face, add 80ms stop and punch.

### E. Shadows in battle

The army must read as characters. Idle variety per role (vanguard plants and rolls shoulders,
reaper sways low, ranger checks the string, arcanist's staff orbits slightly, sentinel sets the
shield). Ability casts get a 100ms anticipation pose and a role-coloured flash. A fallen shadow
dissolves downward into its pool and re-forms from the pool on return.

### F. Interface micro-animation

| Interaction | Motion |
|---|---|
| Any button | Scale 0.97 and darken on press, 120ms; release 200ms |
| Tab change | Content cross-fade 120ms; the active icon's stroke weight animates |
| Sheet | Section 6 `Sheet` |
| Number change (currency, stat value, power) | Count from old to new over 320ms `--ease-out`; brief t1 flash on currencies when they rise; no bounce |
| Upgrade purchase | Value ticks; delta chip slides 4px up and fades in; cost pill updates |
| Level up | The "Level" value in the top bar counts up; the XP line flashes full then resets; a field burst (existing `levelUpBurst`, retuned to one ring and 20 motes) |
| Equip | The slot square scales 0.9 to 1 with a rarity-coloured ring that fades 320ms |
| Reward reveal | Rows enter in sequence, 60ms apart, 8px rise and fade; totals count up |
| Rank up | Section 6 |
| Skill learn | The node fills from centre, the connecting hairline to the next node draws in 320ms |
| Error | 4px horizontal shake, twice, 200ms; error tone |

Springs are reserved for the `Segmented` thumb and sheets (no overshoot). Nothing bounces.

---

## 8. Combat improvements beyond animation

Small, high-value changes; each needs unit tests.

1. **Readable threat priority.** A hostile winding up at the warrior gets a thin crimson rim
   under its feet for the wind-up. (Render-only.)
2. **Perfect dodge deserves a moment.** Already slow-motion; add the camera punch, a gold
   afterimage and the numeral-face "Perfect".
3. **Focus target clarity.** Replace the rotating reticle with four corner ticks that contract
   on acquire.
4. **Auto-cast intent.** When AUTO fires an ability, its disc pulses, so the player learns what
   AUTO is doing.

No new abilities, enemies or stats in Rebirth.

---

## 9. Summon and BIND

BIND is the game's signature. Today it is a button, a 1.5s fade and a card. It becomes a short
piece of theatre in the scene itself, different by rarity in shape and staging, not only colour.

### Staging

The figure lives in the battlefield canvas at 2.1× normal scale, centred in the upper part of the
screen. The text lives in a `Moment` whose content is bottom-aligned over the panel area. The
simulation is already paused while the reveal modal is open.

### The sequence (timeline in `render/cinematics/arise.ts`)

| Beat | Common / Uncommon | Rare | Epic | Legendary and boss shadows |
|---|---|---|---|---|
| 1. Claim | Tap. 40ms stop. The orb snaps to the warrior's raised hand (warrior holds a `cast` pose). | same | same | same, plus all sound ducks to silence for 200ms |
| 2. Draw | A dark pool spreads under the fallen spot (0.3s). | Pool spreads wider; the field dims 50%; camera pushes to 1.25 (0.5s). | The backdrop turns to night (tint 70%); ink runs along the ground toward the pool from four directions (0.7s). | The field inverts to ink black with a single gold horizon line; a gold oath-ring draws itself clockwise around the pool (1.1s). |
| 3. Rise | The silhouette rises out of the pool, masked at ground level, 0.4s. | Rises 0.6s; two vertical seams of light open behind it. | Rises 0.8s as three offset afterimages that converge into one figure. | Rises slowly, 1.3s, gold dust lifting with it; the camera tilts up 12px. |
| 4. Oath | Eyes light. One ground ripple. | 80ms stop, eyes ignite blue-white, a ring; the seams close. | 120ms stop, violet lightning forks along the ground into it, eyes ignite, trauma 0.3. | 200ms stop; the ring flares and breaks outward as shards; the figure takes its signature pose; trauma 0.5; colour returns from the centre outward in 400ms. |
| 5. Name | Moment: eyebrow (rarity, role), name in `t-moment`, epithet in `t-flavour`. | same | Name letters fade in left to right over 300ms. | Full-bleed: name at 48px, a hairline that draws from centre, then the facts. |
| 6. Confirm | Trait and Codex rows, primary "Add to army". | same | same | same, plus device vibration (20ms, where supported) on beat 4 |
| Length before the card | 0.9s | 1.6s | 2.3s | 3.6s |

Rules:
- The first shadow ever bound always plays the legendary staging at its own rarity colour.
- A duplicate (shards) plays beats 1 and 4 only (0.5s) and shows a compact row, not the Moment.
- Tap anywhere after 0.4s to skip to beat 5. A setting "Quick reveals" (default off) applies the
  duplicate treatment to species already owned.
- A failed BIND: the pool collapses inward, a dry crack, the pill shows the chance ticking up
  ("62% to 71%") in the count-up style, 0.5s total.
- The orb in the scene: a hovering mote in the rarity colour with a slow vertical bob and a
  ground glint; boss essences are larger with a rotating ring.

Audio (`synth.ts`): a rising low drone through beat 2 and 3 (length per rarity), a struck tone on
beat 4 pitched by rarity (common lowest), a soft choir-like pad for legendary. Reuse
`summon_first` as the base for legendary.

---

## 10. Progression improvements

Rebirth is not a feature release. Three targeted changes, in priority order; the first two are
presentation of what exists.

1. **Make existing depth legible.** The game has stats, milestones, gear sets, skills, arts,
   techniques, perks, ranks, Codex, bond, stars, evolution, depths, ascension, the tree and the
   Tyrant. The audit found the player cannot see most of it. The redesign in section 6 is the
   progression work: milestones on the stat cells, Codex on the Army header, compare lines on
   gear, the tree's running totals.
2. **A "next goal" line** on the Hero header's second row, from the existing `nextMilestone`:
   one sentence, tappable to the panel that advances it.
3. **Army synergies (P2, only after sections 6, 7 and 9 are done and reviewed).** Role pairs
   among deployed shadows grant a named bonus, shown on the Army header: Vanguard + Sentinel
   "Shield wall" (army takes 10% less), Ranger + Arcanist "Crossfire" (marked targets take burn
   ticks), Reaper + Caller "Harvest" (shades last 50% longer), any three distinct roles
   "Warband" (+8% army attack). Data in `src/game/data/summons.ts`, applied in
   `progression/loadout.ts`, unit-tested, and checked in the economy simulator before and after.
   No new save fields: it derives from the deployed set.

Not doing: new currencies, new stat types, more modes.

---

## 11. Economy analysis

Evidence from `tests/unit/economy.sim.test.ts` (documented in `docs/DESIGN.md`):

| Phase | Measured | Assessment |
|---|---|---|
| 0 to 40 min | Gates 1 to 30 with waits under 2 minutes | Healthy onboarding pace |
| 40 min to 3 h | Gates 33 to 45, waits 7 to 26 minutes | Intended first wall; ascension answers it |
| 3 to 10 h | Ascend every 1.5 to 3 h, +10 to 20 stages each | Healthy |
| 10 to 28 h | +20 to 30 stages per ascension | The best stretch of the game |
| 28 to 60 h | +3 stages per ascension | **Long-tail flattening.** Might and Vigor hit level 100; Limit Break (10 levels) is exhausted. |

Findings and recommendations:

1. **Long tail (recommend, P2).** Uncap Might and Vigor (cost already grows 30% a level, which is
   self-limiting) and let Limit Break go to 25. Verify with `MAXMIN=6000`.
2. **Repeat ascension at the same depth** pays full Aether each time. It is what makes "ascend
   when stuck" work, and Rift Memory made it faster. Keep, but watch: if the simulator shows the
   optimal policy is to never push past remembered ground, pay 60% for ground already ascended
   from.
3. **Currencies.** Gold (stats, gear, arts), essence (bond), Rift Cores (stars, evolution),
   Aether (tree). None is dead. Essence has the weakest sink after bond 50: add nothing now;
   note it.
4. **BIND odds** have pity; the unlucky-streak bound is enforced in `extraction.ts` and tested.
5. **Offline** is sampled from real cycles, capped (2 to 8h plus Patience) and gate-safe.
   Setting the clock forward yields at most one cap of rewards; accepted for a single-player game.
6. **Exploits checked previously:** double payout on victory (guarded by `run.resolved`), Tyrant
   free bar and forfeits (fixed in `d2dd1be`), keys refill by date only.

Rebirth must not change any number in `regions.ts`, `stats.ts`, `rewards.ts` or `ascension.ts`
except under recommendation 1, and then only with before-and-after simulator output in the PR
description or hand-back.

---

## 12. Technical architecture

Keep Next.js, PixiJS 8, the fixed-step simulation and the store split. New modules:

```
src/game/render/
  anim/ease.ts            damp, spring, easings, noise
  anim/Timeline.ts        sequencer for cinematics
  Camera.ts               framing, kick, punch, trauma, project/unproject
  Trail.ts                weapon ribbons (pooled)
  ImpactDirector.ts       turns hit/death events into stop, kick, sparks, reactions (one policy)
  cinematics/arise.ts     BIND and reveal timelines by rarity
  cinematics/boss.ts      entrance, phase, death timelines by boss kind
src/components/ui/        Button, Sheet, Moment, Row, Stat, Segmented, Meter, Currency
src/components/sheets/    one file per modal kind, routed by ModalHost
```

Rules:
- Render code reads the World and events; it never writes to the World.
- Per-entity render state (swing counter, last hit direction, blended pose, trail samples) lives
  on the `EntityView`, created and destroyed with it.
- No allocation per frame in the hot path: reuse pose objects, sample arrays and effect records.
  Pool anything spawned on hit.
- Timelines own their display objects and destroy them on `done` or `dispose`. `setWorld` and
  `unmount` must dispose any running timeline (extend the existing `endCinematic` path).
- React: overlays subscribe with narrow selectors; no component may subscribe to the whole HUD
  snapshot. Count-ups use a ref and `requestAnimationFrame`, not state per frame.
- CSS animation only on `transform` and `opacity`. `backdrop-filter` only on the glass controls
  and the scrim (at most 8 blurred elements on screen).

---

## 13. Mobile performance requirements

Measure, do not claim.

- **Harness.** Add `scripts/perf.mjs` (Playwright, CDP `Emulation.setCPUThrottlingRate` 4):
  a scripted 30s fight at stage 20 with a full army and AUTO on, at 1× and 2×, recording per
  frame the JS time of simulate and render (wrap the calls in `GameLoop.frame` behind a `?perf=1`
  flag that stores samples on `window.__ASCEND_PERF__`). Report p50, p95 and max, and the particle
  and entity peaks. Headless Chromium uses software GL, so GPU time is not representative: the
  budget is on scripting time.
- **Baseline first.** Run the harness on `d2dd1be` and record it in `docs/DESIGN.md`.
- **Budget.** p95 scripting per frame at 4× throttle: no more than 15% over baseline and under
  8ms. No frame over 24ms outside cinematics. Particles capped at 420 (140 reduced). Trails
  capped at 8 live ribbons.
- **Memory.** A 10-minute soak (stage changes, 20 binds, 3 boss fights): Pixi display-object
  count and JS heap after a forced GC return to within 10% of the 1-minute mark.
- **Assets.** Fonts total under 110 KB. First-load JS must not grow by more than 25 KB gzip.

---

## 14. Security recommendations

- The game is a client-only static app. **Nothing in it is secure against a determined
  player**: saves are editable, the gift-code verifying secret ships in the bundle
  (`economy/codes.ts`), and the clock is the device's. This is acceptable because ASCEND sells
  nothing and has no shared state. Keep the README statement that says so.
- Do not add a backend for Rebirth. A server becomes justified only if a feature needs trust
  between players (a Tyrant leaderboard, cloud saves, purchases). At that point: server-side
  validation of submitted runs by re-simulation from seed and inputs, which the deterministic
  World already permits.
- Saves: keep migrations and the sanitiser in step with every new field (none planned).
- `npm audit --omit=dev` reports PostCSS advisories through Next 15's bundled copy. They concern
  processing untrusted CSS at build time; the build only processes this repository's CSS. No
  action in Rebirth; move to Next 16 as separate work.
- No secrets are added. No analytics or network calls are added.

---

## 15. Prioritised implementation roadmap

Two streams run in parallel in separate git worktrees, with disjoint file ownership. A third
follows the merge.

**Stream A: interface (owns `src/app/**`, `src/components/**`, `src/hooks/**`, `src/lib/**`,
`tests/e2e/**` copy fixes).** Must not edit `src/game/**` except type-only imports.

- A0. Tokens, fonts and primitives (`globals.css`, `layout.tsx`, `components/ui/*`).
- A1. Shell: top bar, tab bar, panel, toasts, boot veil.
- A2. Battlefield overlays and ability bar (BIND pill fixed in place; boss bar; banners).
- A3. The five panels.
- A4. Split `ModalHost.tsx`; every sheet and moment to the new pattern.
- A5. Interface micro-animation (count-ups, sequences, error shake).
- A6. Screens at 390 x 844 and 320 x 568 captured and reviewed; e2e green.

**Stream B: animation and combat feel (owns `src/game/render/**`, `src/game/engine/GameLoop.ts`,
`scripts/perf.mjs`, and the hit-stop policy lines in `GameController.ts`).** Must not edit
`src/components/**` or `src/app/**`.

- B0. Perf harness and baseline.
- B1. `anim/ease.ts`, pose blending, secondary motion, contact fix, combo variants.
- B2. Camera with project/unproject; backdrop resolution; off-screen chevrons.
- B3. `ImpactDirector`: hit-stop policy, kick, punch, trauma, directional sparks, reactions.
- B4. Trails; deaths; ability signatures; telegraph rims.
- B5. Damage numbers in the numeral face.
- B6. Perf re-measured; unit tests green.

**Stream C: cinematics (after A and B are merged; touches both sides).**

- C1. `Timeline`, `cinematics/arise.ts`, the reveal `Moment`, the scene orb, failed-bind beat,
  Quick reveals setting.
- C2. `cinematics/boss.ts`: entrance by kind, phase change, death; boss bar ghost.
- C3. Shadows in battle (section 7E); perfect dodge moment; focus ticks.
- C4. Tall sheet (section 6) with `setViewportInsets`.

**Stream D: quality gates** (section 16), then P2 items (synergies, long-tail economy) only if
the gates pass.

Order of value if time runs out: A0 to A4 and B1 to B3 are the transformation. C1 is the
signature. Everything else is polish.

---

## 16. Testing and acceptance criteria

**Automated**
- `npx tsc --noEmit`, `npx eslint . --max-warnings=0`, `npx vitest run` (214 or more),
  `npm run test:e2e` (42 or more) all pass.
- New unit tests: `damp` frame-rate independence (same result at 30, 60, 120 fps within 1%);
  `Timeline` ordering, skip and dispose; `Camera` framing clamps and `project`/`unproject`
  round-trip; hit-stop policy cap; swing-variant cycling; reveal sequence selection by rarity,
  first-ever and duplicate.
- New e2e: fonts loaded (`document.fonts.check` for both families); no element under 11px
  computed font size in the five panels; BIND pill reachable and working with the camera active;
  reveal skippable; boss intro does not block the FIGHT flow; every panel has no horizontal
  overflow at 320px.
- The `data-testid` contract in section 6.

**Measured**
- Section 13 harness: baseline and final numbers recorded.

**Visual**
- Screens at 390 x 844 and 320 x 568 for every row of the audit table, before and after, in
  `docs/rebirth/`.
- A frame sequence (12 frames at 60ms) of: a warrior crit, a kill by launch, a rare and a
  legendary bind, a boss entrance and a boss death.

**Reviews (three, each by a fresh reviewer with no stake in the build)**
1. Creative director: is it cohesive and premium? Typography, spacing, colour, motion.
2. Principal engineer: determinism untouched, lifecycle and leaks, re-renders, frame cost.
3. First-time player: understand, enjoy the first fight, feel the hits, want to bind, want to
   return.
Fix the highest-impact findings; re-review what changed.

**Done means:** core loop rules unchanged and tested; version 12 saves load; every screen in
section 6 rebuilt; contact fix verified in a frame sequence; camera on; rarity-distinct reveals;
boss entrance, phase and death sequences; no production deployment.

---

## 17. Known risks and dependencies

| Risk | Likelihood | Mitigation |
|---|---|---|
| The camera breaks DOM overlays that assume a fixed mapping (BIND pills, focus picking, hand guide on the battlefield) | High | BIND pill no longer tracks position; `project`/`unproject` on `controller.view`; e2e for focus and bind |
| Hit-stop makes 2× speed or large packs stutter | Medium | Single policy with cooldown and a 12% per-second cap; off for army hits |
| Pose blending delays contact | Medium | Snap on entering `attack`, `hit`, `stagger`, `dodge`; frame-sequence check |
| The redesign breaks e2e selectors or copy assertions | High | Test contract in section 6; run the suite per stream milestone |
| Backdrop repaint at higher resolution costs memory on small phones | Medium | Cap at DPR 2 × 1.3; measure texture bytes; fall back to × 1.15 |
| `backdrop-filter` cost on low-end Android | Medium | At most 8 blurred elements; `@supports` fallback to a solid 80% graphite |
| Static numeral font instancing fails in this environment | Low | Fallback to the variable family at weight 700 |
| Parallel streams conflict at merge | Medium | Disjoint ownership; the only shared seam is `controller.view`, owned by B, consumed by A after merge |
| Scope: this is several weeks of studio work | Certain | The roadmap's order of value; ship A0 to A4, B1 to B3 and C1 before anything else |
| Software-GL screenshots under-represent motion | Certain | Frame sequences and the perf harness; say plainly what was not verified on a real device |

Dependencies: no new runtime packages. Build-time only: `fonttools` and `brotli` (pip) to cut the
numeral instance, used once; the output is committed.
