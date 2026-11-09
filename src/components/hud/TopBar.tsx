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
  const stage = useHud((s) => s?.stage ?? 1);
  const wave = useHud((s) => s?.wave ?? 0);
  const phase = useHud((s) => s?.phase ?? "intro");
  const bestStage = useProfile((p) => p.progress.bestStage);
  const speed = useProfile((p) => p.settings.battleSpeed);
  const speedUnlocked = bestStage >= 3;
  const xpFrac = Math.min(1, xp / xpForLevel(level));
  const accent = weaponPathDef(path)?.color ?? "#4ee6ff";
  return (
    <header className="relative z-20 flex items-center gap-2 px-2 pt-1.5 pb-1 h-[48px]" data-testid="top-bar">
      <div className="relative flex items-center gap-1.5 min-w-0">
        <WarriorPortrait size={34} accent={accent} />
        <div className="flex flex-col leading-none min-w-0">
          <span className="font-display text-[11px] tracking-wider text-bone">Lv {level}</span>
          <div className="bar w-[52px] mt-1">
            <div style={{ width: `${xpFrac * 100}%`, background: "linear-gradient(90deg,#1fa9c6,#4ee6ff)" }} data-testid="xp-bar" />
          </div>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center gap-1 min-w-0 overflow-hidden">
        <Stat icon="coin" value={fmt(gold)} color="text-gold" testId="gold" />
        <Stat icon="essence" value={fmt(essence)} color="text-soul" testId="essence" />
        {cores > 0 && <Stat icon="core" value={fmt(cores)} color="text-violet" testId="cores" />}
      </div>
      <button
        className={`h-7 px-1.5 rounded-md border text-[10px] font-black tabular-nums ${speedUnlocked && speed === 2 ? "border-cyan/70 bg-cyan/15 text-cyan" : "border-white/10 bg-white/5 text-mist"}`}
        onClick={() => c.toggleBattleSpeed()}
        aria-label={speedUnlocked ? `Battle speed ${speed}x` : "Battle speed, unlocks after stage 3"}
        data-testid="speed-toggle"
        style={{ opacity: speedUnlocked ? 1 : 0.45 }}
      >
        {speedUnlocked ? `${speed}×` : <Icon name="lock" size={11} />}
      </button>
      <div className="flex flex-col items-end leading-none">
        <span className="font-display text-[11px] tracking-widest text-bone">STAGE {stage}</span>
        <div className="flex items-center gap-1 mt-1" aria-label="Wave progress">
          {[1, 2, 3].map((w) => (
            <span key={w} className="h-1.5 w-3 rounded-sm" style={{ background: wave >= w ? "#4ee6ff" : "rgba(154,163,181,0.25)", boxShadow: wave === w && phase === "wave" ? "0 0 6px #4ee6ff" : "none" }} />
          ))}
          <Icon name="skull" size={12} className={phase === "boss" || phase === "boss_intro" ? "text-crimson" : "text-mist"} />
        </div>
      </div>
      <button className="ml-1 h-8 w-8 flex items-center justify-center rounded-lg border border-white/10 bg-white/5 text-mist" onClick={() => c.openSettings()} aria-label="Menu" data-testid="menu-button">
        <Icon name="menu" size={16} />
      </button>
    </header>
  );
}

function Stat({ icon, value, color, testId }: { icon: "coin" | "essence" | "core"; value: string; color: string; testId: string }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-black/40 border border-white/8 px-2 py-0.5 min-w-0">
      <Icon name={icon} size={12} className={color} />
      <span className={`text-[11px] font-bold tabular-nums ${color}`} data-testid={testId}>
        {value}
      </span>
    </div>
  );
}
