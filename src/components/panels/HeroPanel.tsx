"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { HoldButton } from "@/components/ui/HoldButton";
import { Ticker } from "@/components/ui/Ticker";
import { CurrencyGlyph } from "@/components/ui/Currency";
import { useController, useProfileRef } from "@/hooks/useGame";
import { replayClass, useShake } from "@/hooks/useShake";
import { useShortScreen } from "@/hooks/useShortScreen";
import type { UpgradeableStat } from "@/game/data/ids";
import { STAT_LABEL } from "@/game/data/equipment";
import { aetherFor, canAscend, romanAscension, spendableAether } from "@/game/progression/ascension";
import { combatPower, computePlayerStats, isStatUnlocked, MILESTONE_EVERY, MILESTONE_MULT, statUnlockRule, statUpgradeCost, statCap } from "@/game/progression/stats";
import type { Profile } from "@/game/progression/profile";
import { canAttemptTrial, nextRankStep, rankLetter } from "@/game/progression/ranks";
import { fmt, fmtStat } from "@/lib/format";
import { cn } from "@/lib/cn";

const STATS: UpgradeableStat[] = ["attack", "maxHp", "defense", "attackSpeed", "critChance", "critDamage"];
/** Sentence case, short enough for a half-width cell on a 320px phone. */
const LABEL: Record<UpgradeableStat, string> = { attack: "Attack", maxHp: "Health", defense: "Defence", attackSpeed: "Attack speed", critChance: "Crit rate", critDamage: "Crit damage" };
const NARROW: Partial<Record<UpgradeableStat, string>> = { attackSpeed: "Speed", critDamage: "Crit dmg" };
/** Stats whose every 25th level multiplies them: their cells carry a gold milestone line. */
const MILESTONE_STATS: UpgradeableStat[] = ["attack", "maxHp"];

/** Objective: get stronger now. Primary action: hold a stat. */
export default function HeroPanel() {
  const c = useController();
  const profile = useProfileRef();
  const short = useShortScreen();
  const stats = computePlayerStats(profile);
  const power = combatPower(stats);
  return (
    <div className={cn("flex flex-col h-full min-h-0 px-4", short ? "pt-3" : "pt-4")}>
      <div className={cn("flex items-end justify-between gap-3 shrink-0", short ? "mb-2" : "mb-3")}>
        <PowerReadout power={power} short={short} />
        <div className="flex items-center gap-2 min-w-0">
          <AscendBadge />
          <RankBadge />
        </div>
      </div>
      <div className="grid grid-cols-2 grid-rows-3 flex-1 min-h-0 -mx-4 shadow-[inset_0_1px_0_var(--line)]">
        {STATS.map((s, i) => (
          <StatCell key={s} stat={s} index={i} profile={profile} value={stats[s]} next={previewNext(profile, s)[s]} onUpgrade={() => c.upgradeStat(s).ok} onDenied={() => c.audio.play("error", { volume: 0.3, minInterval: 200 })} />
        ))}
      </div>
    </div>
  );
}

/** Derived stats after one more level of `stat`, so the cell can show what the hold will buy. */
function previewNext(profile: Profile, stat: UpgradeableStat) {
  const clone: Profile = { ...profile, player: { ...profile.player, statLevels: { ...profile.player.statLevels, [stat]: profile.player.statLevels[stat] + 1 } } };
  return computePlayerStats(clone);
}

function fmtDelta(stat: UpgradeableStat, d: number): string {
  if (stat === "critChance") return `+${(d * 100).toFixed(1)}`;
  if (stat === "critDamage") return `+${Math.round(d * 100)}`;
  if (stat === "attackSpeed") return `+${d.toFixed(2)}`;
  return `+${d >= 100 ? fmt(d) : d >= 10 ? Math.round(d) : Number(d.toFixed(1))}`;
}

interface CellProps {
  stat: UpgradeableStat;
  index: number;
  profile: Profile;
  value: number;
  next: number;
  onUpgrade: () => boolean;
  onDenied: () => void;
}

/**
 * One stat, and the whole cell is the hold target. Label and level, the value with what one more
 * level adds, the cost as a gold-tint pill. A 1px gold line along the foot shows the way to the
 * next milestone; reaching it tints the cell once.
 */
function StatCell({ stat, index, profile, value, next, onUpgrade, onDenied }: CellProps) {
  const level = profile.player.statLevels[stat];
  const cap = statCap(profile, stat);
  const cost = statUpgradeCost(stat, level);
  const capped = level >= cap;
  const affordable = profile.player.gold >= cost;
  const unlocked = isStatUnlocked(profile, stat);
  const rule = statUnlockRule(stat);
  const [pill, shake] = useShake<HTMLSpanElement>();
  const tint = useRef<HTMLSpanElement>(null);
  const valueRef = useRef<HTMLSpanElement>(null);
  const milestone = MILESTONE_STATS.includes(stat);
  const lastLevel = useRef(level);
  useEffect(() => {
    if (milestone && level > lastLevel.current && Math.floor(level / MILESTONE_EVERY) > Math.floor(lastLevel.current / MILESTONE_EVERY)) {
      replayClass(tint.current, "milestone-tint");
      replayClass(valueRef.current, "milestone-pop");
    }
    lastLevel.current = level;
  }, [level, milestone]);
  const edges = cn("relative min-w-0 min-h-0 shadow-[inset_0_-1px_0_var(--line)]", index % 2 === 0 && "after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-[var(--line)] after:content-['']");
  const label = (
    <>
      <span className="hidden min-[360px]:inline">{LABEL[stat]}</span>
      <span className="min-[360px]:hidden">{NARROW[stat] ?? LABEL[stat]}</span>
    </>
  );
  if (!unlocked && rule) {
    return (
      <div className={cn(edges, "flex items-center justify-between gap-2 px-3 min-[360px]:px-4")} data-testid={`stat-card-${stat}`}>
        <span className="flex flex-col min-w-0">
          <span className="t-label text-t2 truncate">{label}</span>
          <span className="t-caption text-t3 truncate">
            {STAT_LABEL[rule.requires]} Lv {rule.level}
          </span>
        </span>
        <Icon name="lock" size={16} className="shrink-0 text-t3" />
      </div>
    );
  }
  const toNext = (level % MILESTONE_EVERY) / MILESTONE_EVERY;
  const deny = () => {
    shake();
    onDenied();
  };
  return (
    <div className={edges} data-testid={`stat-card-${stat}`}>
      <HoldButton
        onRepeat={onUpgrade}
        disabled={capped || !affordable}
        onDenied={capped ? undefined : deny}
        className="absolute inset-0 flex items-center justify-between gap-1.5 px-3 min-[400px]:px-4 text-left"
        guide={`upgrade-${stat}`}
        testId={`upgrade-${stat}`}
        label={capped ? `${STAT_LABEL[stat]} is at its cap` : `Upgrade ${STAT_LABEL[stat]} for ${cost} gold`}
      >
        <span ref={tint} className="pointer-events-none absolute inset-0 bg-[var(--tint-gold)] opacity-0" aria-hidden="true" />
        <span className="relative flex flex-col min-w-0">
          <span className="t-label text-t2 truncate">
            {label}
            <span className="text-t3 ml-1 tnum">Lv {level}</span>
          </span>
          <span className="flex items-baseline gap-1.5 min-w-0">
            <span ref={valueRef} className="inline-block origin-left">
              <span data-testid={`stat-value-${stat}`}>
                <Ticker value={value} format={(v) => fmtStat(stat, v)} className="t-num-l text-t1" />
              </span>
            </span>
            {!capped && (
              <motion.span key={level} className="t-label font-semibold text-jade tnum truncate hidden min-[360px]:inline-block" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}>
                {fmtDelta(stat, next - value)}
              </motion.span>
            )}
          </span>
        </span>
        <span ref={pill} className={cn("relative shrink-0 flex items-center gap-[5px] rounded-full h-8 px-2.5 min-[360px]:px-3 t-num-m", capped ? "text-t3" : affordable ? "bg-[var(--tint-gold)] text-gold" : "text-t3")}>
          {capped ? (
            "Max"
          ) : (
            <>
              <CurrencyGlyph kind="gold" size={6} className={affordable ? undefined : "!bg-t3"} />
              {fmt(cost)}
            </>
          )}
        </span>
        {milestone && !capped && (
          <span className="pointer-events-none absolute left-0 bottom-0 h-px w-full origin-left bg-gold" style={{ transform: `scaleX(${toNext})`, transition: "transform 200ms var(--ease)" }} title={`Every ${MILESTONE_EVERY} levels multiply ${STAT_LABEL[stat]} ×${MILESTONE_MULT}`} aria-hidden="true" />
        )}
      </HoldButton>
    </div>
  );
}

/** One quiet pill: the rank, and the trial when it is ready (a gold dot says so). */
function RankBadge() {
  const c = useController();
  const profile = useProfileRef();
  const step = nextRankStep(profile);
  const ready = canAttemptTrial(profile);
  return (
    <button
      className="press flex h-9 items-center gap-2 rounded-full bg-bg-2 px-3 t-label text-t1 whitespace-nowrap min-w-0 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
      onClick={() => (ready ? c.startMode("trial") : c.setPanel("rift"))}
      data-testid="rank-badge"
      aria-label={`Ascendant rank ${rankLetter(profile.player.rank)}${ready ? ", trial ready" : ""}`}
    >
      {ready && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />}
      <span className="truncate">
        Rank {rankLetter(profile.player.rank)}
        <span className={ready ? "text-t1" : "text-t2"}>{step ? (ready ? " · Trial ready" : <span className="hidden min-[360px]:inline"> · Lv {step.level}</span>) : " · Apex"}</span>
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
  const spend = spendableAether(profile) > 0;
  return (
    <button
      className="press flex h-9 items-center gap-2 rounded-full bg-bg-2 px-3 t-label text-t1 whitespace-nowrap shrink-0 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']"
      onClick={() => c.openAscension()}
      data-testid="ascend-badge"
      aria-label={can ? `Ascend for ${fmt(gain)} Aether` : `Ascension ${romanAscension(a.count)}, ${fmt(a.aether)} Aether`}
    >
      {(can || spend) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" aria-hidden="true" />}
      <CurrencyGlyph kind="aether" />
      <span className="tnum">{can ? `+${fmt(gain)}` : fmt(a.aether)}</span>
    </button>
  );
}

/** Power: the headline number. Every purchase visibly lands: it counts up and a "+x%" rises beside it. */
function PowerReadout({ power, short }: { power: number; short: boolean }) {
  const prev = useRef(power);
  const [gain, setGain] = useState<{ id: number; pct: number } | null>(null);
  useEffect(() => {
    const before = prev.current;
    prev.current = power;
    if (before > 0 && power > before * 1.0005) {
      const id = Date.now();
      // Deferred a tick: the readout re-renders from the store, not from this effect.
      const t = setTimeout(() => setGain({ id, pct: (power / before - 1) * 100 }), 0);
      const clear = setTimeout(() => setGain((g) => (g?.id === id ? null : g)), 1400);
      return () => {
        clearTimeout(t);
        clearTimeout(clear);
      };
    }
    return undefined;
  }, [power]);
  return (
    <div className={cn("flex min-w-0", short ? "items-baseline gap-2" : "flex-col")}>
      <span className="t-label text-t2">Power</span>
      <span className={cn("relative flex items-start gap-1.5", !short && "mt-1")}>
        <span data-testid="combat-power">
          <Ticker value={power} className={short ? "t-num-l text-t1" : "t-num-xl text-t1"} />
        </span>
        <AnimatePresence>
          {gain && (
            <motion.span key={gain.id} className="t-label font-semibold text-jade tnum whitespace-nowrap" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }} data-testid="power-gain">
              +{gain.pct < 0.1 ? gain.pct.toFixed(2) : gain.pct < 10 ? gain.pct.toFixed(1) : Math.round(gain.pct)}%
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </div>
  );
}
