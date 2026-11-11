"use client";

import { Ticker } from "@/components/ui/Ticker";
import { cn } from "@/lib/cn";
import { fmt } from "@/lib/format";

export type CurrencyKind = "gold" | "essence" | "core" | "aether";

/** Simple filled marks, one per currency: gold a disc, essence a diamond, core a hexagon, Aether a four-point star. */
export function CurrencyGlyph({ kind, size = 7, className }: { kind: CurrencyKind; size?: number; className?: string }) {
  if (kind === "gold") return <span className={cn("shrink-0 rounded-full bg-gold", className)} style={{ width: size, height: size }} aria-hidden="true" />;
  if (kind === "essence") return <span className={cn("shrink-0 rotate-45 rounded-[1.5px] bg-jade", className)} style={{ width: size * 0.86, height: size * 0.86 }} aria-hidden="true" />;
  if (kind === "core")
    return (
      <svg width={size + 1} height={size + 1} viewBox="0 0 10 10" className={cn("shrink-0 text-epic", className)} aria-hidden="true">
        <path d="M5 0.5 9 2.75v4.5L5 9.5 1 7.25v-4.5z" fill="currentColor" />
      </svg>
    );
  return (
    <svg width={size + 3} height={size + 3} viewBox="0 0 10 10" className={cn("shrink-0 text-t1", className)} aria-hidden="true">
      <path d="M5 0 6.1 3.9 10 5 6.1 6.1 5 10 3.9 6.1 0 5 3.9 3.9z" fill="currentColor" />
    </svg>
  );
}

interface CurrencyProps {
  kind: CurrencyKind;
  value: number;
  className?: string;
  /** Lands on the number itself, whose text is exactly the formatted value. */
  testId?: string;
  /** Count from the old value to the new one, with a brief brighten when it rises. */
  animate?: boolean;
}

/** A currency: its glyph and the amount in t-num-m. */
export function Currency({ kind, value, className, testId, animate = true }: CurrencyProps) {
  return (
    <span className={cn("inline-flex items-center gap-[6px] t-num-m text-t1", className)}>
      <CurrencyGlyph kind={kind} />
      {animate ? <Ticker value={value} flash testId={testId} /> : <span data-testid={testId}>{fmt(value)}</span>}
    </span>
  );
}
