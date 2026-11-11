"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/ui/Icon";
import { Currency } from "@/components/ui/Currency";
import { Ticker } from "@/components/ui/Ticker";
import { useController, useHud, useProfile } from "@/hooks/useGame";
import { replayClass } from "@/hooks/useShake";
import { xpForLevel } from "@/game/progression/xp";
import { regionForStage } from "@/game/data/regions";
import { cn } from "@/lib/cn";

/**
 * 44px, no boxes. Left: the level. Centre: the stage and its region, three wave ticks.
 * Right: gold and essence, the speed toggle and the menu. A 1px XP line runs along the bottom.
 */
export function TopBar() {
  const c = useController();
  const level = useProfile((p) => p.player.level);
  const gold = useProfile((p) => p.player.gold);
  const essence = useProfile((p) => p.player.essence);
  const cores = useProfile((p) => p.player.riftCores);
  const bestStage = useProfile((p) => p.progress.bestStage);
  const speed = useProfile((p) => p.settings.battleSpeed);
  const stage = useHud((s) => s?.stage ?? 1);
  const wave = useHud((s) => s?.wave ?? 0);
  const mode = useHud((s) => s?.mode ?? "campaign");
  const speedUnlocked = bestStage >= 3;
  // "Drowned Hollow", not "The Drowned Hollow": the bar has room for the name, not the article.
  const region = regionForStage(stage).name.replace(/^The /, "");
  return (
    <header className="relative z-20 flex items-center gap-2 min-[360px]:gap-3 h-11 pl-4 pr-1 min-w-0 w-full" data-testid="top-bar">
      <div className="flex items-baseline gap-1 shrink-0" aria-label={`Level ${level}`}>
        <span className="t-label text-t2 hidden min-[360px]:inline">Level</span>
        <span className="t-label text-t2 min-[360px]:hidden">Lv</span>
        <Ticker value={level} className="t-num-m text-[15px] text-t1" />
      </div>
      <div className="flex-1 min-w-0 flex flex-col items-center justify-center" aria-label={mode === "boss" ? `Boss fight, stage ${stage}` : `Stage ${stage}, wave ${wave}`}>
        <div className="flex items-baseline gap-1 min-w-0 max-w-full leading-[18px]" data-testid="stage-label">
          {mode === "boss" ? (
            <span className="text-[15px] font-semibold text-crimson">Boss</span>
          ) : (
            <>
              <span className="t-num-m text-[15px] text-t1 shrink-0">{stage}</span>
              <span className="t-label text-t3 truncate hidden min-[380px]:inline">· {region}</span>
            </>
          )}
        </div>
        {mode !== "boss" && (
          <div className="flex gap-1 mt-1" aria-hidden="true">
            {[1, 2, 3].map((w) => (
              <span key={w} className={cn("h-[2px] w-[10px] min-[360px]:w-[14px] rounded-full transition-colors duration-200", wave >= w ? "bg-t1" : "bg-[var(--line-2)]")} />
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Currency kind="gold" value={gold} testId="gold" />
        <Currency kind="essence" value={essence} testId="essence" />
        {cores > 0 && (
          <span className="hidden min-[420px]:flex">
            <Currency kind="core" value={cores} testId="cores" />
          </span>
        )}
      </div>
      <div className="flex items-center shrink-0">
        <button
          className={cn("press h-11 w-10 min-[360px]:w-11 flex items-center justify-center rounded-[10px] t-num-m", speedUnlocked ? (speed === 2 ? "text-t1" : "text-t2") : "text-t3")}
          onClick={() => c.toggleBattleSpeed()}
          aria-label={speedUnlocked ? `Battle speed ${speed}x` : "Battle speed, unlocks after stage 3"}
          data-testid="speed-toggle"
        >
          {speedUnlocked ? `${speed}×` : <Icon name="lock" size={14} />}
        </button>
        <button className="press h-11 w-11 flex items-center justify-center rounded-[10px] text-t2" onClick={() => c.openSettings()} aria-label="Menu" data-testid="menu-button">
          <Icon name="menu" size={20} />
        </button>
      </div>
      <XpLine level={level} />
    </header>
  );
}

/** The XP line: on a level up it flashes full, then resets. */
function XpLine({ level }: { level: number }) {
  const xp = useProfile((p) => p.player.xp);
  const frac = Math.min(1, xp / xpForLevel(level));
  const flash = useRef<HTMLSpanElement>(null);
  const last = useRef(level);
  useEffect(() => {
    if (level > last.current) replayClass(flash.current, "xp-flash");
    last.current = level;
  }, [level]);
  return (
    <div className="absolute left-0 right-0 bottom-0 h-px bg-[var(--line)] overflow-hidden" aria-hidden="true">
      <span className="absolute inset-0 origin-left bg-t2" style={{ transform: `scaleX(${frac})`, transition: "transform 200ms var(--ease)" }} data-testid="xp-bar" />
      <span ref={flash} className="absolute inset-0 bg-t1 opacity-0" />
    </div>
  );
}
