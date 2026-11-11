"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import { HoldButton } from "@/components/ui/HoldButton";
import { useController, useProfileRef } from "@/hooks/useGame";
import type { UpgradeableStat } from "@/game/data/ids";
import { STAT_LABEL } from "@/game/data/equipment";
import { aetherFor, canAscend, romanAscension } from "@/game/progression/ascension";

/** Card titles are narrow on phones: short names that never truncate. */
const SHORT_LABEL: Partial<Record<string, string>> = { attackSpeed: "Atk Speed", critChance: "Crit Rate", critDamage: "Crit Dmg" };
/** The narrowest phones (320 px) get labels that never truncate. */
const TINY_LABEL: Record<string, string> = { attack: "ATK", maxHp: "HP", defense: "DEF", attackSpeed: "SPD", critChance: "CRIT", critDamage: "CDMG" };
import { combatPower, computePlayerStats, isStatUnlocked, MILESTONE_EVERY, MILESTONE_MULT, statUnlockRule, statUpgradeCost, STAT_UPGRADE_CAP } from "@/game/progression/stats";
import type { Profile } from "@/game/progression/profile";
import { canAttemptTrial, nextRankStep, rankLetter } from "@/game/progression/ranks";
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
        <div className="flex items-center gap-1.5">
          <AscendBadge />
          <RankBadge />
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
          <div className="text-[10px] text-mist/80">Requires {STAT_LABEL[rule.requires]} Lv {rule.level}</div>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("card flex items-center gap-1.5 pl-2 pr-1.5 py-1 min-h-0 min-w-0 overflow-hidden", affordable && !capped && "card-active")} data-testid={`stat-card-${stat}`}>
      <div className="flex flex-col leading-tight min-w-0 flex-1">
        <div className="flex items-center gap-1 text-mist min-w-0">
          <Icon name={icon} size={12} className="text-gold shrink-0" />
          <span className="text-[10px] font-semibold truncate hidden min-[360px]:inline">{SHORT_LABEL[stat] ?? STAT_LABEL[stat]}</span>
          <span className="text-[10px] font-semibold min-[360px]:hidden">{TINY_LABEL[stat]}</span>
          <span className="ml-auto text-[10px] text-mist shrink-0">
            Lv {level}
            {(stat === "attack" || stat === "maxHp") && (
              <span className="text-gold-2 hidden min-[360px]:inline" title={`Every ${MILESTONE_EVERY} levels multiply ${STAT_LABEL[stat]} ×${MILESTONE_MULT}`}>
                {" "}
                ◆{(Math.floor(level / MILESTONE_EVERY) + 1) * MILESTONE_EVERY}
              </span>
            )}
          </span>
        </div>
        <div className="flex items-baseline gap-1 min-w-0">
          <span className="font-display text-[16px] text-ivory tabular-nums shrink-0" data-testid={`stat-value-${stat}`}>{value}</span>
          {!capped && <span className="text-[10px] text-jade-2 tabular-nums truncate hidden min-[360px]:inline">› {next}</span>}
        </div>
      </div>
      <HoldButton onRepeat={onUpgrade} disabled={capped || !affordable} className="h-[40px] w-[52px] min-[360px]:w-[56px] shrink-0" guide={`upgrade-${stat}`} testId={`upgrade-${stat}`} label={`Upgrade ${STAT_LABEL[stat]} for ${cost} gold`}>
        {capped ? (
          <span className="text-[10px] font-bold text-mist">MAX</span>
        ) : (
          <span className="flex flex-col items-center leading-none">
            <span className="caps text-gold-2 !text-[10px]">Hold</span>
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

function RankBadge() {
  const c = useController();
  const profile = useProfileRef();
  const step = nextRankStep(profile);
  const ready = canAttemptTrial(profile);
  return (
    <button
      className={cn("flex items-center gap-1.5 rounded-lg border pl-1 pr-2 py-0.5", ready ? "border-gold/70 bg-gold/10" : "border-white/10 bg-black/20")}
      onClick={() => (ready ? c.startMode("trial") : c.setPanel("rift"))}
      data-testid="rank-badge"
      aria-label={`Ascendant rank ${rankLetter(profile.player.rank)}${ready ? ", trial ready" : ""}`}
    >
      <span className="h-6 w-6 rounded-md flex items-center justify-center font-display text-[15px] text-gold-2" style={{ background: "linear-gradient(180deg,#2c2414,#17130b)", boxShadow: "inset 0 0 0 1px rgba(207,169,94,0.5)" }}>
        {rankLetter(profile.player.rank)}
      </span>
      <span className="text-[10px] leading-tight text-left">
        <span className="block caps !text-[10px]">Rank</span>
        <span className={cn("block font-semibold", ready ? "text-gold-2" : "text-mist")}>{step ? (ready ? "Trial ready" : `Trial at Lv ${step.level}`) : "Apex"}</span>
      </span>
    </button>
  );
}

/** Ascension: shown once it is available (or has been used), with what an ascension would grant. */
function AscendBadge() {
  const c = useController();
  const profile = useProfileRef();
  const can = canAscend(profile);
  const a = profile.ascension;
  if (!can && a.count === 0) return null;
  const gain = aetherFor(profile.progress.bestStage);
  return (
    <button
      className={cn("h-[34px] flex flex-col items-center justify-center rounded-lg border px-2 leading-none", can ? "border-gold/70 bg-gold/10" : "border-white/10 bg-black/20")}
      onClick={() => c.openAscension()}
      data-testid="ascend-badge"
      aria-label={can ? `Ascend for ${gain} Aether` : `Aether ${a.aether}`}
    >
      <span className="caps !text-[9px] text-gold-2">{a.count > 0 ? `Ascension ${romanAscension(a.count)}` : "Ascend"}</span>
      <span className="text-[11px] font-bold text-ivory tabular-nums mt-0.5">{can ? `+${gain} ✦` : `${a.aether} ✦`}</span>
    </button>
  );
}
