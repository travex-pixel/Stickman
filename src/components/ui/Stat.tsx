"use client";

import { type ReactNode } from "react";
import { Ticker } from "@/components/ui/Ticker";
import { cn } from "@/lib/cn";

interface StatProps {
  label: ReactNode;
  /** Numbers count to their new value; strings are shown as they are. */
  value: number | string;
  format?: (n: number) => string;
  /** A gain shown in jade after the value ("+8"). */
  delta?: ReactNode;
  className?: string;
  testId?: string;
  size?: "l" | "xl";
}

/** A label (t-label, t2) over a value (t-num-l), with an optional jade delta. */
export function Stat({ label, value, format, delta, className, testId, size = "l" }: StatProps) {
  const num = size === "xl" ? "t-num-xl" : "t-num-l";
  return (
    <div className={cn("flex flex-col min-w-0", className)}>
      <span className="t-label text-t2 truncate">{label}</span>
      <span className="flex items-baseline gap-1 min-w-0">
        {typeof value === "number" ? <Ticker value={value} format={format} className={cn(num, "text-t1")} testId={testId} /> : <span className={cn(num, "text-t1 truncate")} data-testid={testId}>{value}</span>}
        {delta !== undefined && delta !== null && <span className="t-label font-semibold text-jade tnum truncate">{delta}</span>}
      </span>
    </div>
  );
}
