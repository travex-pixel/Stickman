"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import { useController, useHud, useProfile } from "@/hooks/useGame";
import { ABILITIES, ABILITY_SLOTS, ULTIMATE_ENERGY_COST, ULTIMATE_ID } from "@/game/data/abilities";
import type { AbilityId } from "@/game/data/ids";
import { cn } from "@/lib/cn";

const ICONS: Record<AbilityId, IconName> = { arc_slash: "arc", thunder_strike: "bolt", shadow_dash: "dodge", soul_burst: "soul", void_nova: "nova", ascendant_fury: "fury" };
const TONE: Record<AbilityId, string> = { arc_slash: "#ebe4d3", thunder_strike: "#9fb8d9", shadow_dash: "#b595e6", soul_burst: "#9ee3c9", void_nova: "#b595e6", ascendant_fury: "#e9d39a" };

export function AbilityBar() {
  const c = useController();
  const level = useProfile((p) => p.player.level);
  const autoCast = useProfile((p) => p.player.autoCast);
  const tutorialFinished = useProfile((p) => p.tutorial.finished || p.tutorial.completed.includes("ability"));
  const cooldowns = useHud((s) => s?.cooldowns);
  const cooldownMax = useHud((s) => s?.cooldownMax);
  const energy = useHud((s) => s?.player.energy ?? 0);
  const ultActive = useHud((s) => s?.ultimateActive ?? false);
  const ultUnlocked = ABILITIES[ULTIMATE_ID].unlockLevel <= level;
  const ultReady = ultUnlocked && energy >= ULTIMATE_ENERGY_COST && !ultActive;
  return (
    <div className="relative z-20 flex items-stretch gap-1 px-1.5 pb-1.5 pt-1 h-[74px] min-w-0 w-full overflow-hidden" data-testid="ability-bar">
      <button
        className={cn("ability-btn w-[42px] shrink-0 flex flex-col items-center justify-center gap-0.5 text-[9px] font-extrabold tracking-wider", autoCast ? "text-gold-2" : "text-mist")}
        data-ready={autoCast}
        onClick={() => c.toggleAutoCast()}
        aria-pressed={autoCast}
        aria-label="Toggle auto abilities"
        data-testid="auto-toggle"
        disabled={!tutorialFinished}
        style={{ opacity: tutorialFinished ? 1 : 0.35 }}
      >
        <Icon name="auto" size={15} />
        <span className="text-[8px] tracking-[0.08em]">AUTO</span>
        <span className="text-[8px] opacity-80">{autoCast ? "ON" : "OFF"}</span>
      </button>
      <div className="flex-1 min-w-0 grid grid-cols-5 gap-1">
        {ABILITY_SLOTS.map((id) => {
          const def = ABILITIES[id];
          const unlocked = def.unlockLevel <= level;
          const cd = cooldowns?.[id] ?? 0;
          const max = cooldownMax?.[id] ?? def.cooldown;
          const frac = max > 0 ? Math.min(1, cd / max) : 0;
          const ready = unlocked && cd <= 0;
          const isDodge = id === "shadow_dash";
          return (
            <button
              key={id}
              className={cn("ability-btn min-w-0 flex flex-col items-center justify-center gap-0.5", ready ? "text-ivory" : "text-mist", !unlocked && "ability-locked")}
              data-ready={ready}
              data-guide={isDodge ? "ability-dodge" : `ability-${id}`}
              data-testid={`ability-${id}`}
              onClick={() => (isDodge ? c.dodge() : c.castAbility(id))}
              aria-label={unlocked ? `${def.name}${ready ? ", ready" : `, ${cd.toFixed(1)} seconds`}` : `${def.name}, unlocks at level ${def.unlockLevel}`}
              disabled={!unlocked}
              style={{ color: ready ? TONE[id] : undefined }}
            >
              {unlocked ? (
                <>
                  <Icon name={ICONS[id]} size={20} />
                  <span className="text-[9px] font-semibold text-parch truncate max-w-full px-0.5">{def.short}</span>
                  <div className="ability-cd" style={{ ["--cd" as string]: `${frac * 100}%` }} />
                  {cd > 0 && <span className="absolute inset-x-0 top-1 text-center text-[11px] font-display text-ivory tabular-nums">{cd < 10 ? cd.toFixed(1) : Math.ceil(cd)}</span>}
                </>
              ) : (
                <>
                  <Icon name="lock" size={13} />
                  <span className="text-[8px] text-mist">Lv {def.unlockLevel}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <button
        className={cn("ability-btn w-[50px] shrink-0 flex flex-col items-center justify-center gap-0.5", ultReady ? "text-gold-2" : "text-mist", !ultUnlocked && "ability-locked")}
        data-ready={ultReady}
        data-testid="ability-ultimate"
        onClick={() => c.castAbility(ULTIMATE_ID)}
        disabled={!ultUnlocked}
        aria-label={ultUnlocked ? `Ascendant Fury, ${Math.round(energy)} percent charged` : "Ascendant Fury, unlocks at level 3"}
        style={ultReady ? { boxShadow: "0 0 18px rgba(207,169,94,0.35), inset 0 1px 0 rgba(233,211,154,0.3)" } : undefined}
      >
        {ultUnlocked ? (
          <>
            <Icon name="fury" size={22} className={ultReady ? "animate-pulse" : ""} />
            <span className="text-[9px] font-extrabold tracking-wider">{ultReady ? "FURY" : `${Math.round(energy)}%`}</span>
            <div className="absolute left-0 right-0 bottom-0 pointer-events-none" style={{ height: `${(1 - Math.min(1, energy / ULTIMATE_ENERGY_COST)) * 100}%`, background: "rgba(8,10,14,0.6)" }} />
          </>
        ) : (
          <>
            <Icon name="lock" size={16} />
            <span className="text-[8px]">Lv 3</span>
          </>
        )}
      </button>
    </div>
  );
}
