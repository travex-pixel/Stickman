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

export default function SkillsPanel() {
  const c = useController();
  const profile = useProfileRef();
  const [branch, setBranch] = useState<SkillBranch>("power");
  const nodes = skillsInBranch(branch);
  const mods = computeModifiers(profile);
  const path = weaponPathDef(profile.player.weaponPath);
  return (
    <div className="flex flex-col h-full min-h-0 px-2 pt-1.5 pb-1.5 gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {BRANCHES.map((b) => (
            <button key={b} className={cn("px-2.5 py-1 rounded-lg text-[10px] font-bold border", branch === b ? "border-white/40 bg-white/10 text-bone" : "border-white/10 text-mist")} style={branch === b ? { borderColor: SKILL_BRANCH_INFO[b].color, color: SKILL_BRANCH_INFO[b].color } : undefined} onClick={() => setBranch(b)} data-testid={`branch-${b}`}>
              {SKILL_BRANCH_INFO[b].label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-mist">
          Points <b className="text-cyan" data-testid="skill-points">{profile.player.skillPoints}</b>
        </span>
      </div>
      <div className="grid grid-cols-5 gap-1 flex-1 min-h-0">
        {nodes.map((n) => {
          const owned = profile.skills.unlocked.includes(n.id);
          const check = canUnlockSkill(profile, n.id);
          const locked = check.reason === "requires";
          return (
            <button
              key={n.id}
              className={cn("card flex flex-col items-center justify-between p-1 text-center min-h-0", owned && "card-active", locked && "opacity-50")}
              onClick={() => !owned && c.unlockSkill(n.id)}
              disabled={owned || locked}
              data-testid={`skill-${n.id}`}
              aria-label={`${n.name}: ${n.description}${owned ? ", unlocked" : ` (${n.cost} points)`}`}
            >
              <span className="text-[8px] text-mist">T{n.tier}</span>
              <span className="text-[10px] font-bold leading-tight text-bone">{n.name}</span>
              <span className="text-[8px] leading-tight text-mist line-clamp-3">{n.description}</span>
              <span className={cn("text-[9px] font-bold", owned ? "text-soul" : check.ok ? "text-cyan" : "text-mist")}>{owned ? <Icon name="check" size={12} /> : locked ? <Icon name="lock" size={11} /> : `${n.cost} pt`}</span>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[10px] text-mist">
        <span className="truncate">{SKILL_BRANCH_INFO[branch].blurb}</span>
        {mods.weaponPathUnlocked && (
          <button className={cn("ml-2 shrink-0 px-2 py-1 rounded-lg border text-[10px] font-bold", path ? "border-white/15 text-bone" : "border-gold/60 text-gold bg-gold/10")} style={path ? { color: path.color, borderColor: path.color } : undefined} onClick={() => !path && c.openWeaponPath()} data-testid="weapon-path-button">
            {path ? path.name : "Choose weapon path"}
          </button>
        )}
      </div>
    </div>
  );
}
