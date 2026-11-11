"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import { useController, useHud, useProfile } from "@/hooks/useGame";
import { ABILITIES, ABILITY_SLOTS, ULTIMATE_ENERGY_COST, ULTIMATE_ID } from "@/game/data/abilities";
import type { AbilityId } from "@/game/data/ids";
import { cn } from "@/lib/cn";

const ICONS: Record<AbilityId, IconName> = { arc_slash: "arc", thunder_strike: "bolt", shadow_dash: "dodge", soul_burst: "soul", void_nova: "nova", ascendant_fury: "fury" };

/** Unlocks shown in the order they arrive, so the bar fills left to right as the warrior grows. */
const SLOTS = [...ABILITY_SLOTS].sort((a, b) => ABILITIES[a].unlockLevel - ABILITIES[b].unlockLevel);

/**
 * The ability row sits on the battlefield itself: round ink medallions, one glyph each,
 * a radial sweep for the cooldown and the seconds in the centre.
 */
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
    <div className="medal-row absolute inset-x-0 bottom-0 z-20 h-[78px] px-2 pb-2 pt-3 flex items-end gap-1.5 min-w-0" style={{ background: "linear-gradient(180deg, rgba(17,15,12,0) 0%, rgba(17,15,12,0.72) 42%, rgba(17,15,12,0.92) 100%)" }} data-testid="ability-bar">
      <button
        className={cn("medal medal-sm shrink-0", autoCast ? "text-gold-2" : "text-mist")}
        data-ready={autoCast}
        onClick={() => c.toggleAutoCast()}
        aria-pressed={autoCast}
        aria-label={`Auto abilities ${autoCast ? "on" : "off"}`}
        data-testid="auto-toggle"
        disabled={!tutorialFinished}
        style={{ opacity: tutorialFinished ? 1 : 0.35 }}
      >
        <span className="font-display text-[11px] leading-none">AUTO</span>
        <span className="text-[10px] font-extrabold leading-none mt-0.5">{autoCast ? "ON" : "OFF"}</span>
      </button>
      <div className="flex-1 min-w-0 flex items-end justify-center gap-1.5">
        {SLOTS.map((id) => {
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
              className={cn("medal", ready ? "text-ivory" : "text-mist", !unlocked && "medal-locked")}
              data-ready={ready}
              data-guide={isDodge ? "ability-dodge" : `ability-${id}`}
              data-testid={`ability-${id}`}
              onClick={() => (isDodge ? c.dodge() : c.castAbility(id))}
              aria-label={unlocked ? `${def.name}${ready ? ", ready" : `, ${cd.toFixed(1)} seconds`}` : `${def.name}, unlocks at level ${def.unlockLevel}`}
              disabled={!unlocked}
            >
              {unlocked ? (
                <>
                  <Icon name={ICONS[id]} size={22} strokeWidth={2.3} />
                  {cd > 0 && (
                    <>
                      <span className="medal-sweep" style={{ ["--cd" as string]: `${frac * 100}%` }} />
                      <span className="absolute inset-0 flex items-center justify-center font-display text-[15px] text-ivory tabular-nums">{cd < 10 ? cd.toFixed(1) : Math.ceil(cd)}</span>
                    </>
                  )}
                </>
              ) : (
                <span className="flex flex-col items-center leading-none">
                  <Icon name="lock" size={13} />
                  <span className="text-[10px] mt-0.5">Lv {def.unlockLevel}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        className={cn("medal medal-lg shrink-0", ultReady ? "text-gold-2" : "text-mist", !ultUnlocked && "medal-locked")}
        data-ready={ultReady}
        data-testid="ability-ultimate"
        onClick={() => c.castAbility(ULTIMATE_ID)}
        disabled={!ultUnlocked}
        aria-label={ultUnlocked ? `Ascendant Fury, ${Math.round(energy)} percent charged` : "Ascendant Fury, unlocks at level 3"}
      >
        {ultUnlocked ? (
          <>
            <span className="medal-fill" style={{ height: `${Math.min(100, (energy / ULTIMATE_ENERGY_COST) * 100)}%` }} />
            <Icon name="fury" size={26} strokeWidth={2.3} className={cn("relative", ultReady && "animate-pulse")} />
            {!ultReady && <span className="absolute bottom-1.5 inset-x-0 text-center text-[10px] font-extrabold tabular-nums text-parch">{Math.round(energy)}%</span>}
          </>
        ) : (
          <span className="flex flex-col items-center leading-none">
            <Icon name="lock" size={14} />
            <span className="text-[10px] mt-0.5">Lv 3</span>
          </span>
        )}
      </button>
    </div>
  );
}
