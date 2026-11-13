"use client";

import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { useSheetRise } from "@/hooks/useSheetLift";
import { useController, useHud, useProfile } from "@/hooks/useGame";
import { replayClass } from "@/hooks/useShake";
import { ABILITIES, ABILITY_SLOTS, ULTIMATE_ENERGY_COST, ULTIMATE_ID } from "@/game/data/abilities";
import type { AbilityId } from "@/game/data/ids";
import { cn } from "@/lib/cn";
import { ABILITY_ICON } from "@/components/ui/abilityIcons";
import { slotForm } from "@/game/progression/techniques";

/** Unlocks shown in the order they arrive, so the bar fills left to right as the warrior grows. */
const SLOTS = [...ABILITY_SLOTS].sort((a, b) => ABILITIES[a].unlockLevel - ABILITIES[b].unlockLevel);

/**
 * The ability row sits on the battlefield itself: borderless glass discs, one glyph each. Cooling
 * discs dim their glyph, show the seconds and sweep a thin ring clockwise. The ultimate is larger
 * and carries a gold charge ring. AUTO is a word at the row's left.
 *
 * Each disc subscribes to its own cooldown (quantised to 50ms), so a cooling disc re-renders
 * itself and nothing else.
 */
export function AbilityBar() {
  const level = useProfile((p) => p.player.level);
  // A string selector so a form swap (mutated in place) still re-renders the bar.
  const formKey = useProfile((p) => SLOTS.map((s) => slotForm(p, s)).join(","));
  const forms = formKey.split(",") as AbilityId[];
  // Rides the panel's top edge when the panel is pulled tall.
  const rise = useSheetRise();
  return (
    <motion.div className="ab-host absolute inset-x-0 bottom-[calc(var(--panel-overlap)+12px)] z-20" style={{ y: rise }} data-testid="ability-bar">
      <div className="flex items-center justify-center">
        <AutoToggle />
        {SLOTS.map((slot, i) => (
          <AbilityDisc key={slot} slot={slot} id={forms[i] ?? slot} level={level} />
        ))}
        <UltimateDisc level={level} />
      </div>
    </motion.div>
  );
}

function AutoToggle() {
  const c = useController();
  const autoCast = useProfile((p) => p.player.autoCast);
  const tutorialFinished = useProfile((p) => p.tutorial.finished || (p.tutorial.completed.includes("ability") && p.tutorial.completed.includes("dodge")));
  return (
    <button
      className={cn("press flex h-11 w-11 shrink-0 items-center justify-center rounded-full", !tutorialFinished && "opacity-40")}
      onClick={() => (tutorialFinished ? c.toggleAutoCast() : c.toast("AUTO unlocks once you have used an ability and dodged", "info"))}
      aria-pressed={autoCast}
      aria-label={`Auto abilities ${autoCast ? "on" : "off"}`}
      data-testid="auto-toggle"
      aria-disabled={!tutorialFinished}
    >
      {/* A real toggle: a filled jade pill when on, a dim glass pill when off. */}
      <span className={cn("flex h-7 w-full flex-col items-center justify-center rounded-full text-[11px] leading-[12px] font-semibold tracking-[0.04em] transition-colors duration-200", autoCast ? "bg-jade text-gold-ink" : "glass-flat text-t2 shadow-[inset_0_0_0_1px_var(--line-2)]")}>
        AUTO
      </span>
    </button>
  );
}

const RING_R = 22.25;
const RING_LEN = 2 * Math.PI * RING_R;

function AbilityDisc({ slot, id, level }: { slot: AbilityId; id: AbilityId; level: number }) {
  const c = useController();
  const def = ABILITIES[id];
  const unlockLevel = ABILITIES[slot].unlockLevel;
  const unlocked = unlockLevel <= level;
  const cd = useHud((s) => Math.ceil((s?.cooldowns[id] ?? 0) * 20) / 20);
  const max = useHud((s) => s?.cooldownMax[id] ?? def.cooldown);
  const cooling = unlocked && cd > 0;
  const progress = max > 0 ? 1 - Math.min(1, cd / max) : 1;
  const isDodge = id === "shadow_dash";
  // While Ascendant Fury runs nothing else can be cast or dodged: the discs read held, not ready.
  const held = useHud((s) => s?.ultimateActive ?? false);
  const disc = useRef<HTMLSpanElement>(null);
  const flash = useRef<SVGCircleElement>(null);
  // A cast, by hand or by AUTO, shows on the disc: it dips and its ring flashes.
  const wasCooling = useRef(cooling);
  useEffect(() => {
    if (cooling && !wasCooling.current) {
      replayClass(disc.current, "cast-pop");
      replayClass(flash.current, "ring-flash");
    }
    wasCooling.current = cooling;
  }, [cooling]);
  return (
    <button
      className="ab-slot flex shrink-0 items-center justify-center"
      data-ready={unlocked && !cooling && !held}
      data-guide={isDodge ? "ability-dodge" : `ability-${slot}`}
      data-testid={`ability-${slot}`}
      data-form={id}
      onClick={() => (!unlocked ? c.toast(`${def.name} unlocks at level ${unlockLevel}`, "info") : isDodge ? c.dodge() : c.castAbility(id))}
      aria-label={unlocked ? `${def.name}${cooling ? `, ${cd.toFixed(1)} seconds` : ", ready"}` : `${def.name}, unlocks at level ${unlockLevel}`}
      aria-disabled={!unlocked}
    >
      <span ref={disc} className={cn("ab-disc press relative flex items-center justify-center rounded-full glass-flat", unlocked && !cooling && !held && "medallion-ready")}>
        {unlocked ? (
          <>
            <Icon name={ABILITY_ICON[id]} size={20} strokeWidth={1.8} className={cn("text-t1 transition-opacity duration-200", (cooling || held) && "opacity-25")} />
            <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 46 46" aria-hidden="true">
              {cooling && <circle cx="23" cy="23" r={RING_R} fill="none" stroke="var(--color-t1)" strokeWidth="1.5" strokeDasharray={RING_LEN} strokeDashoffset={RING_LEN * (1 - progress)} strokeLinecap="round" />}
              <circle ref={flash} cx="23" cy="23" r={RING_R} fill="none" stroke="var(--color-t1)" strokeWidth="1.5" opacity="0" />
            </svg>
            {cooling && <span className="absolute t-num-m text-t1">{cd < 10 ? cd.toFixed(1) : Math.ceil(cd)}</span>}
          </>
        ) : (
          <span className="flex flex-col items-center text-t3">
            <Icon name="lock" size={14} />
            <span className="t-caption tnum mt-[2px]">Lv {unlockLevel}</span>
          </span>
        )}
      </span>
    </button>
  );
}

const ULT_R = 26.25;
const ULT_LEN = 2 * Math.PI * ULT_R;

function UltimateDisc({ level }: { level: number }) {
  const c = useController();
  const energy = useHud((s) => Math.floor(s?.player.energy ?? 0));
  const ultActive = useHud((s) => s?.ultimateActive ?? false);
  const unlockLevel = ABILITIES[ULTIMATE_ID].unlockLevel;
  const unlocked = unlockLevel <= level;
  const ready = unlocked && energy >= ULTIMATE_ENERGY_COST && !ultActive;
  const frac = Math.min(1, energy / ULTIMATE_ENERGY_COST);
  const disc = useRef<HTMLSpanElement>(null);
  const was = useRef(ultActive);
  useEffect(() => {
    if (ultActive && !was.current) replayClass(disc.current, "cast-pop");
    was.current = ultActive;
  }, [ultActive]);
  return (
    <button
      className="ab-ult-slot flex shrink-0 items-center justify-center"
      data-ready={ready}
      data-testid="ability-ultimate"
      onClick={() => {
        if (!unlocked) c.toast(`Ascendant Fury unlocks at level ${unlockLevel}`, "info");
        else if (!ready && !ultActive) c.toast(`Ascendant Fury is charging: ${energy}%. Strikes, abilities and perfect dodges fill it.`, "info");
        else c.castAbility(ULTIMATE_ID);
      }}
      aria-disabled={!unlocked}
      aria-label={unlocked ? `Ascendant Fury, ${energy} percent charged` : `Ascendant Fury, unlocks at level ${unlockLevel}`}
    >
      <span ref={disc} className="ab-ult press relative flex items-center justify-center rounded-full glass-flat">
        {unlocked ? (
          <>
            <Icon name="fury" size={22} strokeWidth={1.8} className={ready ? "text-t1" : "text-t2"} />
            <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 56 56" aria-hidden="true">
              <circle cx="28" cy="28" r={ULT_R} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
              <circle cx="28" cy="28" r={ULT_R - 4} fill="none" stroke="rgba(218,184,108,0.4)" strokeWidth="1" />
              <circle className={cn(ready && "breathe")} cx="28" cy="28" r={ULT_R} fill="none" stroke="var(--color-gold)" strokeWidth="1.5" strokeDasharray={ULT_LEN} strokeDashoffset={ULT_LEN * (1 - frac)} strokeLinecap="round" />
            </svg>
          </>
        ) : (
          <span className="flex flex-col items-center text-t3">
            <Icon name="lock" size={14} />
            <span className="t-caption tnum mt-[2px]">Lv {unlockLevel}</span>
          </span>
        )}
      </span>
    </button>
  );
}
