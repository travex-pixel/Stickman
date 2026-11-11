"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useController, useProfileRef } from "@/hooks/useGame";
import { SKILL_BRANCH_INFO, type SkillBranch } from "@/game/data/skills";
import { canUnlockSkill, skillsInBranch } from "@/game/progression/skills";
import { computeModifiers } from "@/game/progression/stats";
import { weaponPathDef } from "@/game/progression/weaponPaths";
import { cn } from "@/lib/cn";

const BRANCHES: SkillBranch[] = ["power", "soul", "command"];

/** A branch is a path of five seals. Tap a seal to read it; unlock from the detail card. */
export default function SkillsPanel() {
  const c = useController();
  const profile = useProfileRef();
  const [branch, setBranch] = useState<SkillBranch>("power");
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
      <div className="flex items-center justify-between shrink-0">
        <div className="flex gap-1">
          {BRANCHES.map((b) => (
            <button
              key={b}
              className={cn("px-3 h-7 rounded-lg font-display text-[13px] border", branch === b ? "bg-white/5" : "border-white/10 text-mist")}
              style={branch === b ? { borderColor: SKILL_BRANCH_INFO[b].color, color: SKILL_BRANCH_INFO[b].color } : undefined}
              onClick={() => {
                setBranch(b);
                setSelectedId(null);
              }}
              data-testid={`branch-${b}`}
            >
              {SKILL_BRANCH_INFO[b].label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-mist">
          Points <b className="text-gold-2 font-display text-[15px]" data-testid="skill-points">{profile.player.skillPoints}</b>
        </span>
      </div>
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
