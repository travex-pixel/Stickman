"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import { HoldButton } from "@/components/ui/HoldButton";
import { useController, useProfileRef } from "@/hooks/useGame";
import type { UpgradeableStat } from "@/game/data/ids";
import { STAT_LABEL } from "@/game/data/equipment";
import { combatPower, computePlayerStats, isStatUnlocked, statUnlockRule, statUpgradeCost, STAT_UPGRADE_CAP } from "@/game/progression/stats";
import type { Profile } from "@/game/progression/profile";
import { fmt, fmtStat } from "@/lib/format";
import { cn } from "@/lib/cn";

const STATS: { key: UpgradeableStat; icon: IconName }[] = [
  { key: "attack", icon: "sword" },
  { key: "maxHp", icon: "heart" },
  { key: "defense", icon: "shield" },
  { key: "attackSpeed", icon: "speed" },
  { key: "critChance", icon: "crit" },
  { key: "critDamage", icon: "critdmg" },
];

export default function HeroPanel() {
  const c = useController();
  const profile = useProfileRef();
  const stats = computePlayerStats(profile);
  const power = combatPower(stats);
  return (
    <div className="flex flex-col h-full min-h-0 px-2 pt-1.5 pb-1.5 gap-1.5">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[12px] tracking-[0.2em] text-mist">POWER</span>
          <span className="font-display text-[18px] text-gold-2 text-glow-gold tabular-nums" data-testid="combat-power">{fmt(power)}</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-mist">
          <span className="flex items-center gap-1"><Icon name="move" size={11} />{Math.round(stats.moveSpeed)}</span>
          <span className="flex items-center gap-1"><Icon name="regen" size={11} />{stats.hpRegen.toFixed(1)}/s</span>
        </div>
      </div>
      <div className="grid grid-cols-2 grid-rows-3 gap-1.5 flex-1 min-h-0">
        {STATS.map((s) => (
          <StatCard key={s.key} stat={s.key} icon={s.icon} value={fmtStat(s.key, stats[s.key])} next={fmtStat(s.key, previewNext(profile, s.key)[s.key])} level={profile.player.statLevels[s.key]} gold={profile.player.gold} unlocked={isStatUnlocked(profile, s.key)} onUpgrade={() => c.upgradeStat(s.key).ok} />
        ))}
      </div>
    </div>
  );
}

/** Derived stats after one more level of `stat`, so the card can show what the hold will buy. */
function previewNext(profile: Profile, stat: UpgradeableStat) {
  const clone: Profile = { ...profile, player: { ...profile.player, statLevels: { ...profile.player.statLevels, [stat]: profile.player.statLevels[stat] + 1 } } };
  return computePlayerStats(clone);
}

function StatCard({ stat, icon, value, next, level, gold, unlocked, onUpgrade }: { stat: UpgradeableStat; icon: IconName; value: string; next: string; level: number; gold: number; unlocked: boolean; onUpgrade: () => boolean }) {
  const cost = statUpgradeCost(stat, level);
  const capped = level >= STAT_UPGRADE_CAP[stat];
  const affordable = gold >= cost;
  const rule = statUnlockRule(stat);
  if (!unlocked && rule) {
    return (
      <div className="card card-locked flex items-center gap-2 px-2 py-1 opacity-80 min-h-0 min-w-0 overflow-hidden">
        <Icon name="lock" size={16} className="text-mist shrink-0" />
        <div className="leading-tight min-w-0">
          <div className="text-[11px] font-semibold text-mist truncate">{STAT_LABEL[stat]}</div>
          <div className="text-[9px] text-mist/80">Requires {STAT_LABEL[rule.requires]} Lv {rule.level}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("card flex items-center gap-1.5 pl-2 pr-1.5 py-1 min-h-0 min-w-0 overflow-hidden", affordable && !capped && "card-active")} data-testid={`stat-card-${stat}`}>
      <div className="flex flex-col leading-tight min-w-0 flex-1">
        <div className="flex items-center gap-1 text-mist min-w-0">
          <Icon name={icon} size={12} className="text-gold shrink-0" />
          <span className="text-[10px] font-semibold truncate">{STAT_LABEL[stat]}</span>
          <span className="ml-auto text-[9px] text-mist shrink-0">Lv {level}</span>
        </div>
        <div className="flex items-baseline gap-1 min-w-0">
          <span className="font-display text-[16px] text-ivory tabular-nums shrink-0" data-testid={`stat-value-${stat}`}>{value}</span>
          {!capped && <span className="text-[9px] text-jade-2 tabular-nums truncate hidden min-[360px]:inline">› {next}</span>}
        </div>
      </div>
      <HoldButton onRepeat={onUpgrade} disabled={capped || !affordable} className="h-[40px] w-[52px] min-[360px]:w-[56px] shrink-0" guide={stat === "attack" ? "upgrade-attack" : undefined} testId={`upgrade-${stat}`} label={`Upgrade ${STAT_LABEL[stat]} for ${cost} gold`}>
        {capped ? (
          <span className="text-[10px] font-bold text-mist">MAX</span>
        ) : (
          <span className="flex flex-col items-center leading-none">
            <span className="caps text-gold-2 !text-[8px]">Hold</span>
            <span className={cn("flex items-center gap-0.5 text-[10px] font-bold tabular-nums", affordable ? "text-gold" : "text-crimson-2")}>
              <Icon name="coin" size={10} />
              {fmt(cost)}
            </span>
          </span>
        )}
      </HoldButton>
    </div>
  );
}
