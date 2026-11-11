"use client";

import { Icon } from "@/components/ui/Icon";
import { WarriorPortrait } from "@/components/ui/Portrait";
import { useController, useHud, useProfile } from "@/hooks/useGame";
import { fmt } from "@/lib/format";
import { xpForLevel } from "@/game/progression/xp";
import { weaponPathDef } from "@/game/progression/weaponPaths";

export function TopBar() {
  const c = useController();
  const level = useProfile((p) => p.player.level);
  const xp = useProfile((p) => p.player.xp);
  const gold = useProfile((p) => p.player.gold);
  const essence = useProfile((p) => p.player.essence);
  const cores = useProfile((p) => p.player.riftCores);
  const path = useProfile((p) => p.player.weaponPath);
  const bestStage = useProfile((p) => p.progress.bestStage);
  const speed = useProfile((p) => p.settings.battleSpeed);
  const stage = useHud((s) => s?.stage ?? 1);
  const wave = useHud((s) => s?.wave ?? 0);
  const phase = useHud((s) => s?.phase ?? "intro");
  const mode = useHud((s) => s?.mode ?? "campaign");
  const gate = useProfile((p) => p.progress.bossGate);
  const speedUnlocked = bestStage >= 3;
  const xpFrac = Math.min(1, xp / xpForLevel(level));
  const accent = weaponPathDef(path)?.color ?? "#cfa95e";
  return (
    <header className="relative z-20 flex items-center gap-1 px-1.5 pt-1.5 pb-1 h-[48px] min-w-0 w-full overflow-hidden" data-testid="top-bar">
      <div className="relative flex items-center gap-1.5 shrink-0">
        <div className="rounded-[9px] p-[1px]" style={{ background: "linear-gradient(180deg, rgba(233,211,154,0.55), rgba(142,111,51,0.35))" }}>
          <WarriorPortrait size={30} accent={accent} />
        </div>
        <div className="flex flex-col leading-none">
          <span className="font-display text-[12px] text-ivory whitespace-nowrap">Lv {level}</span>
          <div className="bar bar-gold w-[52px] mt-1 hidden min-[360px]:block">
            <div style={{ width: `${xpFrac * 100}%` }} data-testid="xp-bar" />
          </div>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-start min-[400px]:justify-center gap-1 min-w-0 overflow-hidden">
        <Stat icon="coin" value={fmt(gold)} color="text-gold-2" testId="gold" />
        <Stat icon="essence" value={fmt(essence)} color="text-jade-2" testId="essence" />
        {cores > 0 && (
          <span className="hidden min-[400px]:flex">
            <Stat icon="core" value={fmt(cores)} color="text-violet" testId="cores" />
          </span>
        )}
      </div>
      <button
        className={`h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border text-[11px] font-extrabold tabular-nums ${speedUnlocked && speed === 2 ? "border-gold/70 bg-gold/15 text-gold-2" : "border-white/10 bg-white/5 text-mist"}`}
        onClick={() => c.toggleBattleSpeed()}
        aria-label={speedUnlocked ? `Battle speed ${speed}x` : "Battle speed, unlocks after stage 3"}
        data-testid="speed-toggle"
        style={{ opacity: speedUnlocked ? 1 : 0.45 }}
      >
        {speedUnlocked ? `${speed}×` : <Icon name="lock" size={10} />}
      </button>
      <div className="flex flex-col items-end leading-none shrink-0">
        <span className="font-display text-[11px] tracking-[0.12em] text-parch whitespace-nowrap hidden min-[360px]:block" data-testid="stage-label">
          {mode === "boss" ? <span className="text-crimson-2">BOSS {stage}</span> : `STAGE ${stage}`}
        </span>
        <span className="font-display text-[11px] tracking-[0.08em] text-parch whitespace-nowrap min-[360px]:hidden" aria-hidden="true">
          {mode === "boss" ? <span className="text-crimson-2">B{stage}</span> : `S${stage}`}
        </span>
        <div className="flex items-center gap-1 mt-1" aria-label={gate === stage && mode === "campaign" ? `Stage ${stage}, boss waiting` : `Stage ${stage}, wave ${wave}`}>
          {[1, 2, 3].map((w) => (
            <span key={w} className="h-1.5 w-3 rounded-sm" style={{ background: mode === "boss" || wave >= w ? "#cfa95e" : "rgba(235,228,211,0.16)" }} />
          ))}
          <Icon name="skull" size={12} className={phase === "boss" || phase === "boss_intro" ? "text-crimson-2" : gate === stage && mode === "campaign" ? "text-crimson-2 animate-pulse" : "text-mist"} />
        </div>
      </div>
      <button className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border border-white/10 bg-white/5 text-parch" onClick={() => c.openSettings()} aria-label="Menu" data-testid="menu-button">
        <Icon name="menu" size={15} />
      </button>
    </header>
  );
}

function Stat({ icon, value, color, testId }: { icon: "coin" | "essence" | "core"; value: string; color: string; testId: string }) {
  return (
    <div className="chip shrink-0">
      <Icon name={icon} size={11} className={`${color} shrink-0`} />
      <span className={`text-[10px] min-[360px]:text-[11px] font-bold tabular-nums ${color}`} data-testid={testId}>
        {value}
      </span>
    </div>
  );
}
