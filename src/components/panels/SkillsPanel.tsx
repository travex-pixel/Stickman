"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Button } from "@/components/ui/Button";
import { Segment, Segmented } from "@/components/ui/Segmented";
import { CurrencyGlyph } from "@/components/ui/Currency";
import { useController, useProfileRef } from "@/hooks/useGame";
import { replayClass } from "@/hooks/useShake";
import { SKILL_BRANCH_INFO, type SkillBranch } from "@/game/data/skills";
import { canUnlockSkill, skillsInBranch } from "@/game/progression/skills";
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
import { usePanelDetent } from "@/hooks/usePanelDetent";

const BRANCHES: SkillBranch[] = ["power", "soul", "command"];
const NUMERALS = ["I", "II", "III", "IV", "V"];
type View = SkillBranch | "arts";

/** A branch is a path of five seals; Arts ranks each ability. Tap to read, learn from the detail. */
export default function SkillsPanel() {
  const [view, setView] = useState<View>("power");
  const short = useShortScreen();
  return (
    <div className={cn("flex flex-col h-full min-h-0 px-4", short ? "pt-3 pb-2" : "pt-4 pb-3")}>
      <Header view={view} setView={setView} />
      {view === "arts" ? <ArtsView short={short} /> : <SealsView key={view} branch={view} short={short} />}
    </div>
  );
}

function Header({ view, setView }: { view: View; setView: (v: View) => void }) {
  const profile = useProfileRef();
  const artsReady = anyAbilityRankReady(profile);
  const points = profile.player.skillPoints;
  return (
    <div className="flex items-center justify-between gap-3 shrink-0">
      <Segmented value={view} onChange={setView} label="Skill paths">
        {BRANCHES.map((b) => (
          <Segment key={b} id={b} data-testid={`branch-${b}`}>
            {SKILL_BRANCH_INFO[b].label}
          </Segment>
        ))}
        <Segment id="arts" badge={artsReady && view !== "arts"} data-testid="branch-arts">
          Arts
        </Segment>
      </Segmented>
      {view === "arts" ? (
        <span className="flex items-center gap-1.5 t-num-m text-t1 shrink-0">
          <CurrencyGlyph kind="gold" />
          {fmt(profile.player.gold)}
        </span>
      ) : (
        <span className={cn("t-label shrink-0 whitespace-nowrap", points > 0 ? "text-gold" : "text-t3")}>
          <span className="t-num-m" data-testid="skill-points">
            {points}
          </span>
          <span className="hidden min-[360px]:inline"> {points === 1 ? "point" : "points"}</span>
          <span className="min-[360px]:hidden"> pt</span>
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
  const learnLabel = check.ok ? `Learn · ${selected.cost} ${selected.cost === 1 ? "point" : "points"}` : check.reason === "requires" ? "Learn the seal before" : `Needs ${selected.cost} ${selected.cost === 1 ? "point" : "points"}`;
  return (
    <>
      <div className={cn("relative flex items-center justify-between shrink-0 mb-4", short ? "mt-2" : "mt-4")} style={{ height: hit }}>
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
      <div className={cn("flex flex-1 min-h-0", short ? "mt-3 items-end gap-3" : "mt-5 flex-col")} data-testid="skill-detail">
        <div className="flex flex-col min-w-0 flex-1">
          <span className="t-title text-t1 truncate">{selected.name}</span>
          <p className={cn("t-body text-t2 mt-1", short ? "line-clamp-1" : "line-clamp-2")}>{selected.description}</p>
        </div>
        <div className={cn("flex items-center gap-2 shrink-0", !short && "mt-auto pt-3")}>
          {owned ? (
            <span className={cn("t-label text-jade flex items-center gap-1.5", short ? "h-11" : "h-[52px] flex-1")}>
              <Icon name="check" size={16} />
              Learned
            </span>
          ) : (
            <Button variant="primary" size={short ? "sm" : "md"} className={short ? "" : "flex-1 min-w-0"} disabled={!check.ok} onClick={() => c.unlockSkill(selected.id)} data-testid="skill-unlock">
              {learnLabel}
            </Button>
          )}
          {mods.weaponPathUnlocked && (
            <Button
              variant="quiet"
              size={short ? "sm" : "md"}
              className="shrink-0 px-4"
              onClick={() => !path && c.openWeaponPath()}
              data-testid="weapon-path-button"
              leading={!path ? <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" /> : undefined}
            >
              {path ? path.name : "Weapon path"}
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
