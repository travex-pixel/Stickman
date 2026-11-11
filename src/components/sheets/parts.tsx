"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Row } from "@/components/ui/Row";
import { Ticker } from "@/components/ui/Ticker";
import { CurrencyGlyph, type CurrencyKind } from "@/components/ui/Currency";
import { MomentItem } from "@/components/ui/Moment";
import { useReducedEffects } from "@/hooks/useReducedEffects";
import type { EquipmentItem } from "@/game/progression/profile";
import type { EquipSlot } from "@/game/data/ids";
import { itemName } from "@/game/GameController";
import { GEAR_EFFECTS } from "@/game/data/gearEffects";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/cn";

export const RARITY_VAR: Record<string, string> = { common: "var(--color-common)", uncommon: "var(--color-uncommon)", rare: "var(--color-rare)", epic: "var(--color-epic)", legendary: "var(--color-legendary)" };
export const RARITY_WORD: Record<string, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary" };
const SLOT_ICON: Record<EquipSlot, IconName> = { weapon: "sword", helm: "helm", chest: "chest", gloves: "gloves", boots: "boots", relic: "relic" };

/**
 * A reward total that counts up from zero once its row has entered (through `Ticker`, so the
 * frames never re-render React). `onStart` fires as the count begins (a reward cue).
 */
export function CountUp({ value, delay = 200, duration = 700, prefix = "+", className, testId, onStart }: { value: number; delay?: number; duration?: number; prefix?: string; className?: string; testId?: string; onStart?: () => void }) {
  const reduced = useReducedEffects();
  const [shown, setShown] = useState(reduced ? value : 0);
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const t = setTimeout(() => {
      setShown(value);
      onStart?.();
    }, delay);
    return () => clearTimeout(t);
    // onStart is a cue: firing it with a stale closure is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, delay, reduced]);
  return <Ticker value={shown} duration={duration} prefix={prefix} className={className} testId={testId} format={(n) => fmt(Math.round(n))} />;
}

/** A large reward: the currency mark, then the total counting up in t-num-xl. */
export function RewardTotal({ kind, value, delay, testId, onStart, suffix }: { kind: CurrencyKind | "xp"; value: number; delay?: number; testId?: string; onStart?: () => void; suffix?: string }) {
  return (
    <span className="flex items-baseline gap-2 min-w-0">
      {kind === "xp" ? <span className="t-label text-t2">XP</span> : <CurrencyGlyph kind={kind} size={9} className="self-center" />}
      <CountUp value={value} delay={delay} className="t-num-serif-xl text-t1" testId={testId} onStart={onStart} />
      {suffix && <span className="t-label text-t2">{suffix}</span>}
    </span>
  );
}

/** A dropped item as a row: slot glyph in its rarity colour, the name, rarity and effect. */
export function LootRow({ item, className }: { item: EquipmentItem; className?: string }) {
  return (
    <MomentItem className={className}>
      <Row
        gutter={false}
        leading={<Icon name={SLOT_ICON[item.slot]} size={18} style={{ color: RARITY_VAR[item.rarity] }} />}
        title={<span style={{ color: RARITY_VAR[item.rarity] }}>{itemName(item)}</span>}
        detail={
          <>
            {RARITY_WORD[item.rarity]}
            {item.effect && <span className="text-t1"> · {GEAR_EFFECTS[item.effect].name}</span>}
          </>
        }
        data-testid="loot-card"
      />
    </MomentItem>
  );
}

/** A section title inside a sheet (the eyebrow style is kept for the one heading per view). */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("t-label text-t2 pt-4 pb-1", className)}>{children}</div>;
}

/** A quiet close in the top-right corner of a sheet: a 44px target with a 20px glyph. */
export function CloseButton({ onClick, testId, label = "Close" }: { onClick: () => void; testId?: string; label?: string }) {
  return (
    <button className="press -mr-3 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-t2" onClick={onClick} aria-label={label} data-testid={testId}>
      <Icon name="close" size={18} />
    </button>
  );
}

/** A cost or reward pill in the gold tint (t3 and untinted when it cannot be paid). */
export function CostPill({ children, ok = true, className }: { children: ReactNode; ok?: boolean; className?: string }) {
  return <span className={cn("inline-flex h-8 items-center gap-[6px] rounded-full px-3 t-num-m", ok ? "bg-[var(--tint-gold)] text-gold" : "text-t3", className)}>{children}</span>;
}
