"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";

interface MeterProps {
  /** 0 to 1. */
  value: number;
  /** Fill colour (a CSS colour or var). Defaults to warm white. */
  color?: string;
  /** Track height in px (3 by default; the boss bar uses 4). */
  height?: number;
  /** A white "damage ghost" that drains behind the real value. */
  ghost?: boolean;
  className?: string;
  testId?: string;
  label?: string;
}

/**
 * A 3px bar: bg-3 track, solid fill, no gradients. The fill moves by transform (scaleX), so a
 * meter that updates every frame never triggers layout.
 */
export function Meter({ value, color = "var(--color-t1)", height = 3, ghost = false, className, testId, label }: MeterProps) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  // The ghost lingers when the value drops and snaps along when it rises.
  const prev = useRef(v);
  const dropping = v < prev.current;
  prev.current = v;
  return (
    <div className={cn("relative w-full overflow-hidden rounded-full bg-bg-3", className)} style={{ height }} role={label ? "meter" : undefined} aria-label={label} aria-valuenow={label ? Math.round(v * 100) : undefined} aria-valuemin={label ? 0 : undefined} aria-valuemax={label ? 100 : undefined}>
      {ghost && <span className="absolute inset-0 origin-left rounded-full bg-t1/80" style={{ transform: `scaleX(${v})`, transition: dropping ? "transform 300ms var(--ease) 300ms" : "none" }} />}
      <span className="absolute inset-0 origin-left rounded-full" style={{ transform: `scaleX(${v})`, background: color, transition: "transform 200ms var(--ease)" }} data-testid={testId} />
    </div>
  );
}
