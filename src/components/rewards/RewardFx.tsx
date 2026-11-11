"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { EquipmentItem } from "@/game/progression/profile";
import type { EquipSlot } from "@/game/data/ids";
import { itemName } from "@/game/GameController";
import { GEAR_EFFECTS } from "@/game/data/gearEffects";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/cn";

/** A number that counts up from zero with an ease-out, ticking a quiet cue as it climbs. */
export function CountUp({ value, delay = 0, duration = 700, onTick, className, prefix = "" }: { value: number; delay?: number; duration?: number; onTick?: () => void; className?: string; prefix?: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const tickRef = useRef(onTick);
  tickRef.current = onTick;
  useEffect(() => {
    if (reduce || value <= 0) {
      setShown(value);
      return;
    }
    let raf = 0;
    let last = 0;
    const start = performance.now() + delay;
    const frame = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(value * eased);
      setShown(v);
      if (t > 0 && now - last > 80 && t < 1) {
        last = now;
        tickRef.current?.();
      }
      if (t < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value, delay, duration, reduce]);
  return (
    <span className={cn("tabular-nums", className)}>
      {prefix}
      {fmt(shown)}
    </span>
  );
}

const SLOT_ICON: Record<EquipSlot, IconName> = { weapon: "sword", helm: "helm", chest: "chest", gloves: "gloves", boots: "boots", relic: "relic" };
const RARITY_GLOW: Record<EquipmentItem["rarity"], string> = {
  common: "rgba(168,162,149,0.0)",
  uncommon: "rgba(108,196,154,0.18)",
  rare: "rgba(122,166,224,0.25)",
  epic: "rgba(181,149,230,0.35)",
  legendary: "rgba(233,197,111,0.45)",
};

/** A loot card that turns face-up after a beat. Epic and legendary cards hold a little longer and shine. */
export function LootCard({ item, index, baseDelay = 0.55, onReveal, className }: { item: EquipmentItem; index: number; baseDelay?: number; onReveal?: (rare: boolean) => void; className?: string }) {
  const reduce = useReducedMotion();
  const rare = item.rarity === "epic" || item.rarity === "legendary";
  const delay = baseDelay + index * 0.22;
  const revealRef = useRef(onReveal);
  revealRef.current = onReveal;
  useEffect(() => {
    const t = setTimeout(() => revealRef.current?.(rare), (reduce ? 0 : delay + 0.18) * 1000);
    return () => clearTimeout(t);
  }, [delay, rare, reduce]);
  return (
    <motion.div
      className={cn("loot-card relative rounded-lg border bg-ink-2/90 overflow-hidden flex items-center gap-2 px-2 py-1.5 text-left", `border-rarity-${item.rarity}`, className)}
      style={{ boxShadow: `inset 0 0 18px ${RARITY_GLOW[item.rarity]}`, transformPerspective: 600 }}
      initial={reduce ? false : { rotateY: 90, opacity: 0, y: 6 }}
      animate={{ rotateY: 0, opacity: 1, y: 0 }}
      transition={{ delay: reduce ? 0 : delay, type: "spring", stiffness: 260, damping: 20 }}
      data-testid="loot-card"
    >
      {rare && !reduce && (
        <motion.span
          className="pointer-events-none absolute inset-y-0 w-10 -skew-x-12"
          style={{ background: "linear-gradient(90deg, transparent, rgba(255,240,200,0.35), transparent)" }}
          initial={{ left: "-20%" }}
          animate={{ left: "120%" }}
          transition={{ delay: delay + 0.35, duration: 0.7, ease: "easeOut" }}
        />
      )}
      <span className={cn("shrink-0 h-7 w-7 rounded-md flex items-center justify-center border bg-black/40", `border-rarity-${item.rarity}`)}>
        <Icon name={SLOT_ICON[item.slot]} size={15} className={`rarity-${item.rarity}`} />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className={cn("block truncate text-[11px] font-semibold", `rarity-${item.rarity}`)}>{itemName(item)}</span>
        <span className="block truncate text-[10px] text-mist">
          <span className="capitalize">{item.rarity}</span>
          {item.effect && <span className="text-gold-2"> · ✦ {GEAR_EFFECTS[item.effect].name}</span>}
        </span>
      </span>
    </motion.div>
  );
}
