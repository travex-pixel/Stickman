"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useController, useProfileRef } from "@/hooks/useGame";
import { SKILL_BRANCH_INFO, type SkillBranch } from "@/game/data/skills";
import { canUnlockSkill, skillsInBranch } from "@/game/progression/skills";
import { computeModifiers } from "@/game/progression/stats";
import { weaponPathDef } from "@/game/progression/weaponPaths";
import { cn } from "@/lib/cn";
import { fmt } from "@/lib/format";
import { ABILITIES, ABILITY_SLOTS, ULTIMATE_ID, TECHNIQUE_OWNED_ATTACK, techniquesFor } from "@/game/data/abilities";
import type { AbilityId } from "@/game/data/ids";
import { ABILITY_RANK_MAX, RANK_COOLDOWN_STEP, RANK_NUMERALS, RANK_POWER_STEP, abilityRank, anyAbilityRankReady, canRankAbility } from "@/game/progression/abilityRanks";
import { ABILITY_ICON } from "@/components/ui/abilityIcons";
import { slotForm } from "@/game/progression/techniques";

const BRANCHES: SkillBranch[] = ["power", "soul", "command"];

/** A branch is a path of five seals. Tap a seal to read it; unlock from the detail card. */
export default function SkillsPanel() {
  const [view, setView] = useState<SkillBranch | "arts">("power");
  return view === "arts" ? <ArtsView setView={setView} /> : <SealsView key={view} branch={view} setView={setView} />;
}

function Tabs({ view, setView }: { view: SkillBranch | "arts"; setView: (v: SkillBranch | "arts") => void }) {
  const profile = useProfileRef();
  const artsReady = anyAbilityRankReady(profile);
  return (
    <div className="flex items-center justify-between shrink-0 gap-1">
      <div className="flex gap-1 min-w-0">
        {BRANCHES.map((b) => (
          <button
            key={b}
            className={cn("px-2 h-7 rounded-lg font-display text-[12px] border", view === b ? "bg-white/5" : "border-white/10 text-mist")}
            style={view === b ? { borderColor: SKILL_BRANCH_INFO[b].color, color: SKILL_BRANCH_INFO[b].color } : undefined}
            onClick={() => setView(b)}
            data-testid={`branch-${b}`}
          >
            {SKILL_BRANCH_INFO[b].label}
          </button>
        ))}
        <button
          className={cn("relative px-2 h-7 rounded-lg font-display text-[12px] border", view === "arts" ? "bg-white/5 border-gold text-gold-2" : "border-white/10 text-mist")}
          onClick={() => setView("arts")}
          data-testid="branch-arts"
        >
          Arts
          {artsReady && view !== "arts" && <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-gold-2 border-2 border-ink" />}
        </button>
      </div>
      {view === "arts" ? (
        <span className="flex items-center gap-1 text-[11px] text-gold font-bold shrink-0">
          <Icon name="coin" size={12} />
          {fmt(profile.player.gold)}
        </span>
      ) : (
        <span className="text-[11px] text-mist shrink-0">
          <b className="text-gold-2 font-display text-[15px]" data-testid="skill-points">{profile.player.skillPoints}</b> pt
        </span>
      )}
    </div>
  );
}

function SealsView({ branch, setView }: { branch: SkillBranch; setView: (v: SkillBranch | "arts") => void }) {
  const c = useController();
  const profile = useProfileRef();
  const nodes = skillsInBranch(branch);
  const firstOpen = nodes.find((n) => !profile.skills.unlocked.includes(n.id)) ?? nodes[nodes.length - 1]!;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = nodes.find((n) => n.id === selectedId) ?? firstOpen;
  const owned = profile.skills.unlocked.includes(selected.id);
  const check = canUnlockSkill(profile, selected.id);
  const mods = computeModifiers(profile);
  const path = weaponPathDef(profile.player.weaponPath);
  const color = SKILL_BRANCH_INFO[branch].color;
  return (
    <div className="flex flex-col h-full min-h-0 px-2 pt-1.5 pb-1.5 gap-1">
      <Tabs view={branch} setView={setView} />
      <div className="relative flex items-center justify-between px-3 py-0.5 shrink-0">
        <div className="absolute left-6 right-6 top-1/2 h-[2px] -translate-y-1/2 bg-white/10" />
        {nodes.map((n) => {
          const has = profile.skills.unlocked.includes(n.id);
          const ok = canUnlockSkill(profile, n.id).ok;
          const isSel = n.id === selected.id;
          return (
            <button
              key={n.id}
              className={cn("relative h-10 w-10 rounded-full flex items-center justify-center font-display text-[14px] border-2 transition-transform", isSel && "scale-110")}
              style={{
                background: has ? `radial-gradient(circle at 50% 35%, ${color}55, #1a1611 75%)` : "radial-gradient(circle at 50% 35%, #2a241b, #15120e 75%)",
                borderColor: has ? color : ok ? `${color}aa` : "rgba(235,228,211,0.12)",
                color: has ? color : ok ? "#ebe4d3" : "#6f685b",
                boxShadow: isSel ? `0 0 0 3px rgba(17,15,12,1), 0 0 0 4px ${color}88` : undefined,
              }}
              onClick={() => setSelectedId(n.id)}
              data-testid={`skill-${n.id}`}
              aria-label={`${n.name}${has ? ", unlocked" : ""}`}
            >
              {has ? <Icon name="check" size={16} /> : ["I", "II", "III", "IV", "V"][n.tier - 1]}
              {ok && !has && <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-gold-2 border-2 border-ink" />}
            </button>
          );
        })}
      </div>
      <div className="card flex-1 min-h-0 px-3 py-1.5 flex flex-col gap-0.5" data-testid="skill-detail">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-display text-[16px] text-ivory truncate">{selected.name}</span>
          <span className="caps shrink-0">Tier {selected.tier}</span>
        </div>
        <p className="text-[12px] leading-snug text-parch line-clamp-2">{selected.description}</p>
        <div className="mt-auto flex items-center gap-2">
          {owned ? (
            <span className="flex-1 text-[12px] font-semibold" style={{ color }}>
              Learned
            </span>
          ) : (
            <button className="btn-primary flex-1 !py-1.5 !text-[14px]" disabled={!check.ok} onClick={() => c.unlockSkill(selected.id)} data-testid="skill-unlock">
              {check.ok ? `Learn · ${selected.cost} pt` : check.reason === "requires" ? "Learn the previous seal first" : `Needs ${selected.cost} pt`}
            </button>
          )}
          {mods.weaponPathUnlocked && (
            <button
              className={cn("shrink-0 px-2.5 h-9 rounded-lg border text-[11px] font-bold", path ? "border-white/15" : "border-gold/60 text-gold-2 bg-gold/10")}
              style={path ? { color: path.color, borderColor: path.color } : undefined}
              onClick={() => !path && c.openWeaponPath()}
              data-testid="weapon-path-button"
            >
              {path ? path.name : "Weapon path"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const ART_ICON = ABILITY_ICON;
const ARTS: AbilityId[] = [...ABILITY_SLOTS, ULTIMATE_ID].sort((a, b) => ABILITIES[a].unlockLevel - ABILITIES[b].unlockLevel);

/** Arts: every ability ranks from I to V with gold, gated by level. */
function ArtsView({ setView }: { setView: (v: SkillBranch | "arts") => void }) {
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
  return (
    <div className="flex flex-col h-full min-h-0 px-2 pt-1.5 pb-1.5 gap-1">
      <Tabs view="arts" setView={setView} />
      <div className="flex items-center justify-between px-1 py-0.5 shrink-0">
        {ARTS.map((slot) => {
          const id = slotForm(profile, slot);
          const r = abilityRank(profile, id);
          const isLocked = profile.player.level < ABILITIES[id].unlockLevel;
          const ready = canRankAbility(profile, id).ok;
          const isSel = slot === selectedSlot;
          return (
            <button
              key={slot}
              className={cn("relative h-10 w-10 rounded-full flex items-center justify-center border-2 transition-transform", isSel && "scale-110", isLocked ? "border-white/10 text-mist/50" : "border-gold/60 text-gold-2")}
              style={{ background: isLocked ? "radial-gradient(circle at 50% 35%, #2a241b, #15120e 75%)" : "radial-gradient(circle at 50% 35%, #3a2f1c, #15120e 75%)", boxShadow: isSel ? "0 0 0 3px rgba(17,15,12,1), 0 0 0 4px rgba(233,211,154,0.6)" : undefined }}
              onClick={() => setSelectedId(slot)}
              data-testid={`art-${slot}`}
              aria-label={`${ABILITIES[id].name}, rank ${RANK_NUMERALS[r]}`}
            >
              {isLocked ? <Icon name="lock" size={14} /> : <Icon name={ART_ICON[id]} size={17} />}
              {!isLocked && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded bg-ink px-1 font-display text-[9px] leading-[12px] text-gold-2 border border-gold/40">{RANK_NUMERALS[r]}</span>}
              {ready && <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-gold-2 border-2 border-ink" />}
            </button>
          );
        })}
      </div>
      <div className="card flex-1 min-h-0 px-3 py-1.5 flex flex-col gap-0.5" data-testid="art-detail">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-display text-[16px] text-ivory truncate">{def.name}</span>
          <span className="flex gap-0.5 shrink-0" aria-label={`Rank ${RANK_NUMERALS[rank]} of V`}>
            {Array.from({ length: ABILITY_RANK_MAX + 1 }, (_, i) => (
              <span key={i} className={cn("h-1.5 w-3 rounded-full", i <= rank && !locked ? "bg-gold-2" : "bg-white/10")} />
            ))}
          </span>
        </div>
        {forms.length > 1 && (
          <div className="flex gap-1 shrink-0" data-testid="art-forms">
            {forms.map((f) => {
              const learned = f === selectedSlot || profile.player.techniques.includes(f);
              const active = f === selectedId;
              return (
                <button
                  key={f}
                  className={cn("flex-1 min-w-0 h-7 rounded-md border px-1.5 flex items-center gap-1 text-[11px]", active ? "border-gold bg-gold/10 text-gold-2" : learned ? "border-white/15 text-parch" : "border-dashed border-white/10 text-mist")}
                  onClick={() => (learned ? c.setArtForm(selectedSlot, f) : c.toast(`${ABILITIES[f].name}: ${ABILITIES[f].learn ?? "not yet learned"}`, "info"))}
                  data-testid={`form-${f}`}
                  aria-pressed={active}
                >
                  <Icon name={learned ? ART_ICON[f] : "lock"} size={12} />
                  <span className="truncate">{learned ? ABILITIES[f].name : ABILITIES[f].learn}</span>
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[11px] leading-snug text-parch line-clamp-2">
          {def.description}
          {def.slot && <span className="text-gold/90"> Owned: +{Math.round(TECHNIQUE_OWNED_ATTACK * 100)}% attack.</span>}
        </p>
        <div className="text-[11px] text-mist">
          {locked ? (
            `Unlocks at level ${def.unlockLevel}`
          ) : (
            <>
              Power <b className="text-ivory">+{powerNow}%</b>
              {rank < ABILITY_RANK_MAX && <span className="text-jade-2"> → +{powerNow + Math.round(RANK_POWER_STEP * 100)}%</span>} · Cooldown <b className="text-ivory">−{cdNow}%</b>
              {rank < ABILITY_RANK_MAX && <span className="text-jade-2"> → −{cdNow + Math.round(RANK_COOLDOWN_STEP * 100)}%</span>}
            </>
          )}
        </div>
        <div className="mt-auto">
          <button className="btn-primary w-full !py-1.5 !text-[14px]" disabled={!check.ok} onClick={() => c.rankAbility(selectedId)} data-testid="art-rank-up">
            {check.ok
              ? <span className="inline-flex items-center gap-1">Rank {RANK_NUMERALS[rank + 1]} · <Icon name="coin" size={13} />{fmt(check.cost)}</span>
              : check.reason === "max"
                ? "Mastered"
                : check.reason === "locked"
                  ? `Unlocks at level ${def.unlockLevel}`
                  : check.reason === "level"
                    ? `Rank ${RANK_NUMERALS[rank + 1]} at level ${check.level}`
                    : <span className="inline-flex items-center gap-1">Need <Icon name="coin" size={13} />{fmt(check.cost)}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
