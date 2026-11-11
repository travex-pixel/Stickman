"use client";

import { useLayoutEffect, useRef } from "react";
import { useReducedEffects } from "@/hooks/useReducedEffects";
import { replayClass } from "@/hooks/useShake";
import { fmt } from "@/lib/format";

interface Props {
  value: number;
  format?: (n: number) => string;
  /** Milliseconds for a change to count from the old value to the new one. */
  duration?: number;
  /** Brighten briefly when the value rises (currencies). */
  flash?: boolean;
  className?: string;
  testId?: string;
  prefix?: string;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

/**
 * A number that counts from its old value to its new one (320ms, ease-out), without re-rendering:
 * React renders an empty span once and the frames are written straight to its text, so a fast
 * hold-to-upgrade costs one commit per purchase, not one per frame.
 */
export function Ticker({ value, format = fmt, duration = 320, flash = false, className, testId, prefix = "" }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const formatRef = useRef(format);
  formatRef.current = format;
  const reduced = useReducedEffects();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const write = (n: number) => {
      el.textContent = `${prefix}${formatRef.current(n)}`;
    };
    const from = shown.current;
    if (from === null || reduced || from === value || !Number.isFinite(from) || !Number.isFinite(value)) {
      shown.current = value;
      write(value);
      return;
    }
    if (flash && value > from) replayClass(el, "flash-up");
    const start = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = t >= 1 ? value : from + (value - from) * easeOut(t);
      shown.current = v;
      write(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    write(from);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, reduced, duration, flash, prefix]);

  return <span ref={ref} className={className} data-testid={testId} />;
}
