"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import { useController, useHud, useProfile } from "@/hooks/useGame";
import { ABILITIES, ABILITY_SLOTS, ULTIMATE_ENERGY_COST, ULTIMATE_ID } from "@/game/data/abilities";
import type { AbilityId } from "@/game/data/ids";
import { cn } from "@/lib/cn";

const ICONS: Record<AbilityId, IconName> = { arc_slash: "arc", thunder_strike: "bolt", shadow_dash: "dodge", soul_burst: "soul", void_nova: "nova", ascendant_fury: "fury" };

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
        className={cn("ability-btn w-[42px] shrink-0 flex flex-col items-center justify-center gap-0.5 text-[9px] font-bold", autoCast ? "text-cyan" : "text-mist")}
        data-ready={autoCast}
        onClick={() => c.toggleAutoCast()}
        aria-pressed={autoCast}
        aria-label="Toggle auto abilities"
        data-testid="auto-toggle"
        disabled={!tutorialFinished}
        style={{ opacity: tutorialFinished ? 1 : 0.35 }}
      >
        <Icon name="auto" size={16} />
        <span>AUTO</span>
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
              className={cn("ability-btn min-w-0 flex flex-col items-center justify-center gap-0.5", ready ? "text-bone" : "text-mist")}
              data-ready={ready}
              data-guide={isDodge ? "ability-dodge" : `ability-${id}`}
              data-testid={`ability-${id}`}
              onClick={() => (isDodge ? c.dodge() : c.castAbility(id))}
              aria-label={unlocked ? `${def.name}${ready ? ", ready" : `, ${cd.toFixed(1)} seconds`}` : `${def.name}, unlocks at level ${def.unlockLevel}`}
              disabled={!unlocked}
              style={{ color: ready ? `#${def.color.toString(16).padStart(6, "0")}` : undefined }}
            >
              {unlocked ? (
                <>
                  <Icon name={ICONS[id]} size={20} />
                  <span className="text-[9px] font-semibold text-bone/90 truncate max-w-full px-0.5">{def.short}</span>
                  {cd > 0 && <span className="absolute top-1 right-1.5 text-[9px] font-bold tabular-nums text-bone">{cd < 10 ? cd.toFixed(1) : Math.ceil(cd)}</span>}
                  <div className="ability-cd" style={{ height: `${frac * 100}%` }} />
                </>
              ) : (
                <>
                  <Icon name="lock" size={16} />
                  <span className="text-[8px] text-mist">Lv {def.unlockLevel}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      <button
        className={cn("ability-btn w-[50px] shrink-0 flex flex-col items-center justify-center gap-0.5", ultReady ? "text-gold" : "text-mist")}
        data-ready={ultReady}
        data-testid="ability-ultimate"
        onClick={() => c.castAbility(ULTIMATE_ID)}
        disabled={!ultUnlocked}
        aria-label={ultUnlocked ? `Ascendant Fury, ${Math.round(energy)} percent charged` : "Ascendant Fury, unlocks at level 3"}
        style={ultReady ? { borderColor: "rgba(255,211,107,0.7)", boxShadow: "0 0 18px rgba(255,211,107,0.35)" } : undefined}
      >
        {ultUnlocked ? (
          <>
            <Icon name="fury" size={22} className={ultReady ? "animate-pulse" : ""} />
            <span className="text-[9px] font-bold">{ultReady ? "FURY" : `${Math.round(energy)}%`}</span>
            <div className="ability-cd" style={{ height: `${(1 - Math.min(1, energy / ULTIMATE_ENERGY_COST)) * 100}%`, background: "rgba(5,6,10,0.6)" }} />
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
