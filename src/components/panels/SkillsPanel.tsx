"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Segment, Segmented } from "@/components/ui/Segmented";
import { CurrencyGlyph } from "@/components/ui/Currency";
import { useController, useProfileRef, useUi } from "@/hooks/useGame";
import { HoldButton } from "@/components/ui/HoldButton";
import { useShake } from "@/hooks/useShake";
import { APEX_NAME, anyApexReady, apexDoor, apexDoorText, apexEffectText, apexNextText, apexOpen, apexRanks, apexVisible, canBuyApex, nextApexSkill, statMaxed, APEX_OPEN_STAGE } from "@/game/progression/apex";
import { APEX_MAX, APEX_SKILLS, DOUBLE_CHANCE_PER_RANK, ECHO_POWER, PRISM_CHANCE_PER_RANK, PRISM_MULT, STORM_EVERY, STORM_FORKS, TRIPLE_CHANCE_PER_RANK, type ApexSkillId } from "@/game/data/apex";
import { SKILLS } from "@/game/data/skills";
import type { IconName } from "@/components/ui/Icon";
import { replayClass } from "@/hooks/useShake";
import { SKILL_BRANCH_INFO, type SkillBranch } from "@/game/data/skills";
import { BRANCH_PURPOSE, branchSummary, canUnlockSkill, nextSkillPointLevel, nodeEffectText, skillsInBranch } from "@/game/progression/skills";
import { computeModifiers } from "@/game/progression/stats";
import { weaponPathDef } from "@/game/progression/weaponPaths";
import { cn } from "@/lib/cn";
import { useShortScreen } from "@/hooks/useShortScreen";
import { fmt } from "@/lib/format";
import { ABILITIES, ABILITY_SLOTS, ULTIMATE_ID, TECHNIQUE_OWNED_ATTACK, techniquesFor } from "@/game/data/abilities";
import type { AbilityId } from "@/game/data/ids";
import { ABILITY_RANK_MAX, RANK_COOLDOWN_STEP, RANK_NUMERALS, RANK_POWER_STEP, abilityRank, anyAbilityRankReady, canRankAbility } from "@/game/progression/abilityRanks";
import { ABILITY_ICON } from "@/components/ui/abilityIcons";
import { slotForm } from "@/game/progression/techniques";
import { usePanelDetent, useRaisePanel } from "@/hooks/usePanelDetent";
import { useCompactFit } from "@/hooks/useCompactFit";

const BRANCHES: SkillBranch[] = ["power", "soul", "command"];
const NUMERALS = ["I", "II", "III", "IV", "V"];
type View = SkillBranch | "arts" | "apex";

/** A branch is a path of five seals; Arts ranks each ability; Apex is the late game's road. Tap to read, act from the detail. */
export default function SkillsPanel() {
  const c = useController();
  const profile = useProfileRef();
  const want = useUi((u) => u.skillsView);
  const [view, setView] = useState<View>(() => (want === "apex" && apexVisible(profile) ? "apex" : "power"));
  // A request to show Apex (from the Power sheet, the best next step) while the panel is already up.
  useEffect(() => {
    if (!want) return;
    if (want === "apex" && apexVisible(profile)) setView("apex");
    c.clearSkillsView();
  }, [want, c, profile]);
  const short = useShortScreen();
  useRaisePanel(view === "arts" || view === "apex");
  const shown: View = view === "apex" && !apexVisible(profile) ? "power" : view;
  return (
    <div className={cn("flex flex-col h-full min-h-0 px-4", short ? "pt-3 pb-2" : "pt-4 pb-3")}>
      <Header view={shown} setView={setView} />
      {shown === "arts" ? <ArtsView short={short} /> : shown === "apex" ? <ApexView short={short} /> : <SealsView key={shown} branch={shown} short={short} />}
    </div>
  );
}

function Header({ view, setView }: { view: View; setView: (v: View) => void }) {
  const profile = useProfileRef();
  const artsReady = anyAbilityRankReady(profile);
  const apexShown = apexVisible(profile);
  const apexReady = anyApexReady(profile);
  const points = profile.player.skillPoints;
  // Points read gold only while they can buy something: a bank with nothing to spend on is not news.
  const spendable = points > 0 && (apexReady || SKILLS.some((n) => canUnlockSkill(profile, n.id).ok));
  // Five views and the points fit 320px: from 360px up the segments keep their padding.
  const seg = apexShown ? "max-[359px]:px-2 min-w-11" : undefined;
  return (
    <div className={cn("flex items-center justify-between shrink-0", apexShown ? "gap-1 min-[360px]:gap-3" : "gap-3")}>
      <Segmented value={view} onChange={setView} label="Skill paths">
        {BRANCHES.map((b) => (
          <Segment key={b} id={b} className={seg} data-testid={`branch-${b}`}>
            {SKILL_BRANCH_INFO[b].label}
          </Segment>
        ))}
        <Segment id="arts" className={seg} badge={artsReady && view !== "arts"} data-testid="branch-arts">
          Arts
        </Segment>
        {apexShown && (
          <Segment id="apex" className={seg} badge={apexReady && view !== "apex"} data-testid="apex-tab">
            Apex
          </Segment>
        )}
      </Segmented>
      {view === "arts" ? (
        <span className="flex items-center gap-1.5 t-num-m text-t1 shrink-0">
          <CurrencyGlyph kind="gold" />
          {fmt(profile.player.gold)}
        </span>
      ) : (
        <span className={cn("t-label shrink-0 whitespace-nowrap", spendable ? "text-gold" : points > 0 ? "text-t2" : "text-t3")} aria-label={`${points} skill ${points === 1 ? "point" : "points"}`}>
          <span className="t-num-m" data-testid="skill-points">
            {points}
          </span>
          <span className="hidden min-[360px]:inline"> {points === 1 ? "point" : "points"}</span>
          <span className={cn("min-[360px]:hidden", apexShown && "hidden")}> pt</span>
        </span>
      )}
    </div>
  );
}

/**
 * Five seals on a hairline. Learned: filled warm white with a dark numeral. Next: a gold ring.
 * Locked: graphite. Learning fills the seal from its centre and draws the line to the next one.
 */
function SealsView({ branch, short }: { branch: SkillBranch; short: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const nodes = skillsInBranch(branch);
  const learned = (id: string) => profile.skills.unlocked.includes(id);
  const nextOpen = nodes.find((n) => !learned(n.id) && (!n.requires || learned(n.requires)));
  const firstOpen = nodes.find((n) => !learned(n.id)) ?? nodes[nodes.length - 1]!;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = nodes.find((n) => n.id === selectedId) ?? firstOpen;
  const owned = learned(selected.id);
  const check = canUnlockSkill(profile, selected.id);
  const mods = computeModifiers(profile);
  const path = weaponPathDef(profile.player.weaponPath);
  const learnedCount = nodes.filter((n) => learned(n.id)).length;
  // Learning: the seal fills from its centre, then the line to the next seal draws in.
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  const lines = useRef<(HTMLSpanElement | null)[]>([]);
  const lastCount = useRef(learnedCount);
  useEffect(() => {
    if (learnedCount > lastCount.current) {
      const i = learnedCount - 1;
      replayClass(fills.current[i] ?? null, "node-fill");
      replayClass(lines.current[i] ?? null, "line-draw");
    }
    lastCount.current = learnedCount;
  }, [learnedCount]);
  const disc = short ? 36 : 40;
  // The seal is drawn at `disc`; its button is never under 44.
  const hit = Math.max(44, disc);
  // The detail is stacked (title, description, a full-width Learn) where it fits, and one row with a
  // small Learn where it does not (measured: at 360x800 the stacked form pushed Learn off the panel).
  const [detail, tight] = useCompactFit<HTMLDivElement>(`${selected.id}:${owned}`);
  const compact = short || tight;
  const summary = branchSummary(profile, branch);
  const short1 = profile.player.skillPoints < selected.cost && !owned;
  const learnLabel = check.ok ? `Learn · ${selected.cost} ${selected.cost === 1 ? "point" : "points"}` : check.reason === "requires" ? "Learn the seal before" : `Needs ${selected.cost} ${selected.cost === 1 ? "point" : "points"}`;
  return (
    <>
      {/* What the branch is for, and what it gives now, in plain numbers. */}
      <div className="mt-1 shrink-0 min-w-0" data-testid="branch-summary">
        {!short && <p className="t-caption text-t2 truncate">{BRANCH_PURPOSE[branch]}</p>}
        <p className="t-caption truncate">
          {summary ? (
            <>
              <span className="text-t2">Now </span>
              <span className="text-jade">{summary}</span>
            </>
          ) : (
            <span className="text-t3">{short ? BRANCH_PURPOSE[branch] : "Nothing learned here yet"}</span>
          )}
        </p>
      </div>
      <div className={cn("relative flex items-center justify-between shrink-0 mb-4", short ? "mt-1.5" : "mt-2.5")} style={{ height: hit }}>
        {nodes.map((n, i) => {
          const has = learned(n.id);
          const isNext = n.id === nextOpen?.id;
          const isSel = n.id === selected.id;
          const lineLit = has && i < nodes.length - 1 && learned(nodes[i + 1]!.id);
          return (
            <div key={n.id} className={cn("relative flex items-center", i < nodes.length - 1 && "flex-1")}>
              <button
                className="press relative flex shrink-0 items-center justify-center rounded-full"
                style={{
                  width: hit,
                  height: hit,
                  marginInline: (disc - hit) / 2,
                }}
                onClick={() => setSelectedId(n.id)}
                data-testid={`skill-${n.id}`}
                aria-label={`${n.name}${has ? ", learned" : isNext ? `, open, ${n.cost} point${n.cost === 1 ? "" : "s"}` : ", locked"}`}
                aria-pressed={isSel}
              >
                <span className={cn("absolute rounded-full", has ? "bg-bg-2" : isNext ? "bg-bg-1 shadow-[inset_0_0_0_1.5px_var(--color-gold)]" : "bg-bg-2")} style={{ inset: (hit - disc) / 2 }} />
                <span ref={(el) => void (fills.current[i] = el)} className={cn("absolute rounded-full bg-t1", has ? "opacity-100" : "opacity-0")} style={{ inset: (hit - disc) / 2 }} />
                <span className={cn("relative font-serif text-[17px] leading-none", has ? "text-bg-0" : isNext ? "text-gold" : "text-t2 opacity-60")}>{NUMERALS[n.tier - 1]}</span>
                {isSel && <span className="absolute rounded-full shadow-[inset_0_0_0_1.5px_var(--color-t2)]" style={{ inset: (hit - disc) / 2 - 5 }} aria-hidden="true" />}
              </button>
              {/* Each seal says what it is: learned, open at its cost, or locked behind the one before. */}
              <span className="pointer-events-none absolute left-0 top-full mt-0.5 flex items-center justify-center gap-1 t-caption tnum" style={{ width: disc }} aria-hidden="true">
                {has ? <Icon name="check" size={12} className="text-t2" /> : isNext ? <span className="text-gold">{n.cost} pt</span> : (
                  <>
                    <Icon name="lock" size={10} className="text-t2" />
                    <span className="text-t2">{n.cost}</span>
                  </>
                )}
              </span>
              {i < nodes.length - 1 && (
                <span className="relative mx-2 h-px flex-1 bg-[var(--line-2)]" aria-hidden="true">
                  <span ref={(el) => void (lines.current[i] = el)} className={cn("absolute inset-0 origin-left bg-t2", lineLit ? "opacity-100" : "opacity-0")} />
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div ref={detail} className={cn("flex flex-1 min-h-0", compact ? "mt-2 items-end gap-3" : "mt-3 flex-col")} data-testid="skill-detail" data-compact={compact || undefined}>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="t-title text-t1 truncate">
            {selected.name} <span className="t-label text-gold">{nodeEffectText(selected)}</span>
          </span>
          <p className={cn("t-body text-t2 mt-1", compact ? "line-clamp-1" : "line-clamp-2")}>
            {selected.description}
            {short1 && <span className="text-t3"> Points come every second level, every level past 150; the next at level {nextSkillPointLevel(profile.player.level)}.</span>}
          </p>
        </div>
        <div className={cn("flex items-center gap-2 shrink-0", !compact && "mt-auto pt-3")}>
          {owned ? (
            <span className={cn("t-label text-jade flex items-center gap-1.5", compact ? "h-11" : "h-[52px] flex-1")}>
              <Icon name="check" size={16} />
              Learned
            </span>
          ) : (
            <Button variant="primary" size={compact ? "sm" : "md"} className={compact ? "" : "flex-1 min-w-0"} disabled={!check.ok} onClick={() => c.unlockSkill(selected.id)} data-testid="skill-unlock">
              {compact && check.ok ? `Learn · ${selected.cost}` : compact && check.reason === "points" ? `Needs ${selected.cost}` : learnLabel}
            </Button>
          )}
          {mods.weaponPathUnlocked && (
            <Button
              variant="quiet"
              size={compact ? "sm" : "md"}
              className={cn("shrink-0", compact ? "px-3" : "px-4")}
              onClick={() => !path && c.openWeaponPath()}
              data-testid="weapon-path-button"
              aria-label={path ? `Weapon path: ${path.name}` : "Choose a weapon path"}
              leading={!path ? <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" /> : undefined}
            >
              {/* Compact: the path is a glyph, so the selected seal's name keeps its room. */}
              {compact ? <Icon name="sword" size={16} /> : path ? path.name : "Weapon path"}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

const ARTS: AbilityId[] = [...ABILITY_SLOTS, ULTIMATE_ID].sort((a, b) => ABILITIES[a].unlockLevel - ABILITIES[b].unlockLevel);

/** Arts: every ability ranks from I to V with gold, gated by level. */
function ArtsView({ short }: { short: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const [selectedSlot, setSelectedId] = useState<AbilityId>(() => ARTS.find((id) => canRankAbility(profile, slotForm(profile, id)).ok) ?? "arc_slash");
  const selectedId = slotForm(profile, selectedSlot);
  const forms = [selectedSlot, ...techniquesFor(selectedSlot)];
  const def = ABILITIES[selectedId];
  const rank = abilityRank(profile, selectedId);
  const check = canRankAbility(profile, selectedId);
  const locked = profile.player.level < def.unlockLevel;
  const powerNow = Math.round(RANK_POWER_STEP * rank * 100);
  const cdNow = Math.round(RANK_COOLDOWN_STEP * rank * 100);
  const disc = 44;
  // With the panel tall and room for all six, the arts are rows; otherwise a strip of discs.
  const tall = usePanelDetent() === "tall";
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom(el.clientHeight));
    ro.observe(el);
    setRoom(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  // Rows, then the detail: gap, the form switch (when there is one), a line, the action.
  const rows = tall && room >= ARTS.length * 52 + 16 + 12 + (forms.length > 1 ? 52 : 0) + 24 + 8 + 52 + 8;
  return (
    <div ref={box} className="flex flex-col flex-1 min-h-0">
      {rows ? (
        <div className="-mx-4 mt-4 shrink-0 shadow-[inset_0_1px_0_var(--line)]">
          {ARTS.map((slot) => {
            const id = slotForm(profile, slot);
            const r = abilityRank(profile, id);
            const isLocked = profile.player.level < ABILITIES[id].unlockLevel;
            const ready = canRankAbility(profile, id).ok;
            const isSel = slot === selectedSlot;
            return (
              <button
                key={slot}
                className={cn("press-fill flex h-[52px] w-full items-center gap-3 px-4 text-left shadow-[inset_0_-1px_0_var(--line)]", isSel && "bg-bg-2")}
                onClick={() => setSelectedId(slot)}
                data-testid={`art-${slot}`}
                aria-label={`${ABILITIES[id].name}, rank ${RANK_NUMERALS[r]}`}
                aria-pressed={isSel}
              >
                <Icon name={isLocked ? "lock" : ABILITY_ICON[id]} size={18} className={cn("shrink-0", isLocked ? "text-t3" : "text-t1")} />
                <span className={cn("t-body flex-1 truncate", isLocked ? "text-t2" : "text-t1")}>{ABILITIES[id].name}</span>
                {ready && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />}
                {isLocked ? (
                  <span className="t-label text-t2 shrink-0">Lv {ABILITIES[id].unlockLevel}</span>
                ) : (
                  <span className="flex gap-1 shrink-0" aria-hidden="true">
                    {Array.from({ length: ABILITY_RANK_MAX + 1 }, (_, i) => (
                      <span key={i} className={cn("h-[3px] w-3 rounded-full", i <= r ? "bg-gold" : "bg-bg-3")} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className={cn("flex items-center justify-between shrink-0", short ? "mt-1.5" : "mt-4")}>
          {ARTS.map((slot) => {
            const id = slotForm(profile, slot);
            const r = abilityRank(profile, id);
            const isLocked = profile.player.level < ABILITIES[id].unlockLevel;
            const ready = canRankAbility(profile, id).ok;
            const isSel = slot === selectedSlot;
            return (
              <button
                key={slot}
                className="press relative flex shrink-0 items-center justify-center rounded-full"
                style={{ width: disc, height: disc }}
                onClick={() => setSelectedId(slot)}
                data-testid={`art-${slot}`}
                aria-label={`${ABILITIES[id].name}, rank ${RANK_NUMERALS[r]}`}
                aria-pressed={isSel}
              >
                <span className={cn("absolute inset-0 rounded-full", isSel ? "bg-bg-3" : "bg-bg-2")} />
                <Icon name={isLocked ? "lock" : ABILITY_ICON[id]} size={isLocked ? 14 : 19} className={cn("relative", isLocked ? "text-t3" : "text-t1")} />
                {isSel && <span className="absolute -inset-[5px] rounded-full shadow-[inset_0_0_0_1.5px_var(--color-t2)]" aria-hidden="true" />}
                {ready && <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
      <div className={cn("flex flex-col flex-1 min-h-0", short ? "mt-1.5" : rows ? "mt-3" : "mt-4")} data-testid="art-detail">
        <div className={cn("flex items-center justify-between gap-3 shrink-0", ((short && forms.length > 1) || rows) && "hidden")}>
          <span className="t-title text-t1 truncate">{def.name}</span>
          <span className="flex gap-1 shrink-0" aria-label={`Rank ${RANK_NUMERALS[rank]} of V`}>
            {Array.from({ length: ABILITY_RANK_MAX + 1 }, (_, i) => (
              <span key={i} className={cn("h-[3px] w-3 rounded-full", i <= rank && !locked ? "bg-gold" : "bg-bg-3")} />
            ))}
          </span>
        </div>
        {forms.length > 1 && (
          <div className={cn("shrink-0", short ? "" : "mt-2")} data-testid="art-forms">
            <Segmented
              stretch
              label="Form"
              value={selectedId}
              onChange={(f) => (f === selectedSlot || profile.player.techniques.includes(f) ? c.setArtForm(selectedSlot, f) : c.toast(`${ABILITIES[f].name}: ${ABILITIES[f].learn ?? "not yet learned"}`, "info"))}
            >
              {forms.map((f) => {
                const learned = f === selectedSlot || profile.player.techniques.includes(f);
                return (
                  <Segment key={f} id={f} data-testid={`form-${f}`}>
                    {learned ? (
                      ABILITIES[f].name
                    ) : (
                      <span className="flex items-center gap-1 text-t3">
                        <Icon name="lock" size={12} />
                        {ABILITIES[f].name}
                      </span>
                    )}
                  </Segment>
                );
              })}
            </Segmented>
          </div>
        )}
        <p className={cn("t-label text-t2 mt-1 overflow-hidden shrink-0", short ? (forms.length > 1 ? "hidden" : "line-clamp-1") : forms.length > 1 || rows ? "line-clamp-1" : "line-clamp-2")}>
          {def.description}
          {def.slot && <span className="text-t1"> Owned: +{Math.round(TECHNIQUE_OWNED_ATTACK * 100)}% attack.</span>}
        </p>
        <div className={cn("mt-auto flex items-center gap-3 shrink-0", short ? "pt-1.5" : "pt-2")}>
          <div className="flex-1 min-w-0 t-label text-t2 tnum">
            {locked ? (
              `Unlocks at level ${def.unlockLevel}`
            ) : (
              <>
                <div className="truncate">
                  Power <span className="text-t1">+{powerNow}%</span>
                  {rank < ABILITY_RANK_MAX && <span className="text-jade"> to +{powerNow + Math.round(RANK_POWER_STEP * 100)}%</span>}
                </div>
                <div className="truncate">
                  Cooldown <span className="text-t1">−{cdNow}%</span>
                  {rank < ABILITY_RANK_MAX && <span className="text-jade"> to −{cdNow + Math.round(RANK_COOLDOWN_STEP * 100)}%</span>}
                </div>
              </>
            )}
          </div>
          <Button variant="primary" size={short ? "sm" : "md"} className="shrink-0 px-4" disabled={!check.ok} onClick={() => c.rankAbility(selectedId)} data-testid="art-rank-up">
            {check.ok ? (
              <>
                Rank {RANK_NUMERALS[rank + 1]}
                <span className="flex items-center gap-1.5 tnum">
                  <CurrencyGlyph kind="gold" className="!bg-gold-ink" />
                  {fmt(check.cost)}
                </span>
              </>
            ) : check.reason === "max" ? (
              "Mastered"
            ) : check.reason === "locked" ? (
              `Level ${def.unlockLevel}`
            ) : check.reason === "level" ? (
              `Rank ${RANK_NUMERALS[rank + 1]} at Lv ${check.level}`
            ) : (
              <span className="flex items-center gap-1.5 tnum">
                Need <CurrencyGlyph kind="gold" className="!bg-gold-ink" />
                {fmt(check.cost)}
              </span>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

const APEX_ICON: Record<ApexSkillId, IconName> = { double: "sword", triple: "bolt", prism: "sparkle", crown: "star" };

/** What a skill is, before its first rank. */
const pc = (v: number) => `${Math.round(v * 100)}%`;
const APEX_ABOUT: Record<ApexSkillId, string> = {
  double: `Each rank, ${pc(DOUBLE_CHANCE_PER_RANK)} more of your swings strike again at once, for ${pc(ECHO_POWER[1])} of a blow. At 10, every swing.`,
  triple: `Each rank, ${pc(TRIPLE_CHANCE_PER_RANK)} more Double Strikes strike a third time, in lightning. At 10, every one.`,
  prism: `Each rank, ${pc(PRISM_CHANCE_PER_RANK)} more of your critical hits turn prismatic, abilities' too: ×${PRISM_MULT} damage.`,
  crown: `Every ${STORM_EVERY}th blow calls a prismatic bolt that forks to ${STORM_FORKS} foes. Your final form.`,
};

/** Rank pips: one bar a rank (Stormcrown has one). */
function Pips({ id, rank, className }: { id: ApexSkillId; rank: number; className?: string }) {
  return (
    <span className={cn("flex gap-[3px] shrink-0", className)} aria-hidden="true">
      {Array.from({ length: APEX_MAX[id] }, (_, i) => (
        <span key={i} className={cn("h-[3px] rounded-full", APEX_MAX[id] === 1 ? "w-6" : "w-[7px]", i < rank ? "bg-gold" : "bg-bg-3")} />
      ))}
    </span>
  );
}

/**
 * Apex: the four late skills in order, each with its ranks, what the next adds and its price, or
 * exactly what it waits for. One gold action buys the picked skill's next rank (hold to repeat).
 */
function ApexView({ short }: { short: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const ranks = apexRanks(profile);
  const open = apexOpen(profile);
  const points = profile.player.skillPoints;
  const [picked, setPicked] = useState<ApexSkillId | null>(null);
  const firstLocked = APEX_SKILLS.find((id) => ranks[id] < APEX_MAX[id]) ?? "crown";
  const selected = picked ?? nextApexSkill(profile) ?? firstLocked;
  const rank = ranks[selected];
  const check = canBuyApex(profile, selected);
  const maxed = rank >= APEX_MAX[selected];
  const door = apexDoorText(profile, selected);
  const next = apexNextText(selected, rank);
  const [pill, shake] = useShake<HTMLSpanElement>();
  const tall = usePanelDetent() === "tall";
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom(el.clientHeight));
    ro.observe(el);
    setRoom(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  // Rows when they fit with the detail under them (status, four rows, two lines, the action); else a strip.
  const rows = (tall || !short) && room >= 18 + 4 * 48 + 8 + 40 + 8 + 52;
  const allMax = APEX_SKILLS.every((id) => ranks[id] >= APEX_MAX[id]);
  const everyLevel = profile.player.level >= 150;
  const status = !open
    ? `Opens when the stage-${APEX_OPEN_STAGE - 1} boss falls. Its skills turn attack speed and crit past their ceilings into power.`
    : allMax
      ? "Apex mastered: every swing strikes three times."
      : ranks.double === 0 && statMaxed(profile, "attackSpeed")
        ? "Attack speed is at its ceiling: Double Strike is open"
        : ranks.prism === 0 && statMaxed(profile, "critChance") && ranks.double >= APEX_MAX.double
          ? "Crit rate is at its ceiling: Prismatic Edge is open"
          : `Skill points come ${everyLevel ? "with every level" : "every second level, then every level past 150"}.`;
  const buyLabel = maxed
    ? "Mastered"
    : check.ok
      ? `Rank ${rank + 1} · ${check.cost} ${check.cost === 1 ? "point" : "points"}`
      : check.reason === "points"
        ? `Needs ${check.cost} points · ${points}`
        : "Locked";
  return (
    <div ref={box} className="flex flex-col flex-1 min-h-0" data-testid="apex-view">
      <p className={cn("t-caption shrink-0 mt-1", open ? "text-t2" : "text-t3", rows ? "line-clamp-2" : "truncate")} data-testid="apex-status">
        {status}
      </p>
      {rows ? (
        <div className="-mx-4 mt-2 shrink-0 shadow-[inset_0_1px_0_var(--line)]">
          {APEX_SKILLS.map((id) => {
            const r = ranks[id];
            const ch = canBuyApex(profile, id);
            const isSel = id === selected;
            const locked = apexDoor(profile, id).kind !== "open" && r < APEX_MAX[id];
            const done = r >= APEX_MAX[id];
            return (
              <button
                key={id}
                className={cn("press-fill relative flex h-12 w-full items-center gap-3 px-4 text-left shadow-[inset_0_-1px_0_var(--line)]", isSel && "bg-bg-2")}
                onClick={() => setPicked(id)}
                data-testid={`apex-skill-${id}`}
                data-rank={r}
                aria-pressed={isSel}
                aria-label={`${APEX_NAME[id]}, ${r} of ${APEX_MAX[id]}${done ? ", mastered" : locked ? ", locked" : ch.ok ? `, ${ch.cost} points` : ""}`}
              >
                {isSel && <span className="absolute left-0 inset-y-2 w-[2px] rounded-full bg-gold" aria-hidden="true" />}
                <Icon name={locked ? "lock" : APEX_ICON[id]} size={17} className={cn("shrink-0", locked ? "text-t3" : r > 0 ? "text-gold" : "text-t1")} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn("t-body truncate", locked ? "text-t2" : "text-t1")}>{APEX_NAME[id]}</span>
                  <Pips id={id} rank={r} className="mt-1" />
                </span>
                <span className={cn("t-label tnum shrink-0", done ? "text-jade" : ch.ok ? "text-gold" : "text-t2")}>
                  {done ? <Icon name="check" size={14} /> : `${r}/${APEX_MAX[id]}`}
                </span>
                {!done && !locked && <span className={cn("t-label tnum shrink-0 w-11 text-right", ch.ok ? "text-gold" : "text-t3")}>{ch.cost} pt</span>}
              </button>
            );
          })}
        </div>
      ) : (
        <div className={cn("flex items-center justify-between shrink-0", short ? "mt-1.5" : "mt-3")}>
          {APEX_SKILLS.map((id, i) => {
            const r = ranks[id];
            const isSel = id === selected;
            const locked = apexDoor(profile, id).kind !== "open" && r < APEX_MAX[id];
            const ready = canBuyApex(profile, id).ok;
            return (
              <div key={id} className={cn("relative flex items-center", i < APEX_SKILLS.length - 1 && "flex-1")}>
                <button
                  className="press relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                  onClick={() => setPicked(id)}
                  data-testid={`apex-skill-${id}`}
                  data-rank={r}
                  aria-pressed={isSel}
                  aria-label={`${APEX_NAME[id]}, ${r} of ${APEX_MAX[id]}${locked ? ", locked" : ""}`}
                >
                  <span className={cn("absolute inset-0 rounded-full", isSel ? "bg-bg-3" : "bg-bg-2", r >= APEX_MAX[id] && "shadow-[inset_0_0_0_1.5px_var(--color-gold)]")} />
                  <Icon name={locked ? "lock" : APEX_ICON[id]} size={locked ? 14 : 18} className={cn("relative", locked ? "text-t3" : r > 0 ? "text-gold" : "text-t1")} />
                  {isSel && <span className="absolute -inset-[5px] rounded-full shadow-[inset_0_0_0_1.5px_var(--color-t2)]" aria-hidden="true" />}
                  {ready && <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
                </button>
                {i < APEX_SKILLS.length - 1 && <span className="mx-2 h-px flex-1 bg-[var(--line-2)]" aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      )}
      <div className={cn("flex flex-col flex-1 min-h-0", rows ? "mt-2" : short ? "mt-1.5" : "mt-3")} data-testid="apex-detail">
        <div className={cn("flex items-center justify-between gap-3 shrink-0", rows && "hidden")}>
          <span className="t-title text-t1 truncate">{APEX_NAME[selected]}</span>
          <span className="flex items-center gap-2 shrink-0">
            <Pips id={selected} rank={rank} />
            <span className="t-label tnum text-t2">
              {rank}/{APEX_MAX[selected]}
            </span>
          </span>
        </div>
        <p className={cn("t-label mt-1 shrink-0", rank > 0 ? "text-t1" : "text-t2", short && !rows ? "line-clamp-1" : "line-clamp-2")} data-testid="apex-about">
          {rows && <span className="text-t1">{APEX_NAME[selected]}. </span>}
          {rank > 0 ? `Now: ${apexEffectText(selected, rank)}.` : APEX_ABOUT[selected]}
        </p>
        <div className={cn("mt-auto flex items-center gap-3 shrink-0", short ? "pt-1.5" : "pt-2")}>
          <p className={cn("flex-1 min-w-0 t-label line-clamp-2", door && !maxed ? "text-t2" : "text-jade")} data-testid="apex-next">
            {maxed ? "Mastered" : door ? door : next ? `Next: ${next}` : null}
          </p>
          <HoldButton
            onRepeat={() => c.buyApex(selected)}
            disabled={!check.ok}
            onDenied={!maxed && check.reason === "points" ? () => (shake(), c.audio.play("error", { volume: 0.3, minInterval: 200 })) : undefined}
            feedback="scale"
            className={cn("ui-btn shrink-0", short ? "h-11 px-4 text-[14px] leading-[18px] font-semibold rounded-[14px]" : "h-[52px] px-5 t-button rounded-[14px]")}
            variant="primary"
            testId="apex-buy"
            label={check.ok ? `Buy ${APEX_NAME[selected]} rank ${rank + 1} for ${check.cost} skill points` : buyLabel}
          >
            <span ref={pill} className="flex items-center gap-1.5 tnum">
              {buyLabel}
            </span>
          </HoldButton>
        </div>
      </div>
    </div>
  );
}
