"use client";

import { createContext, useContext, useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion } from "motion/react";
import { useReducedEffects } from "@/hooks/useReducedEffects";
import { cn } from "@/lib/cn";

interface Ctx {
  value: string;
  onChange: (id: string) => void;
  thumb: string;
  tone: "glass" | "solid";
  stretch: boolean;
  reduced: boolean;
}
const SegCtx = createContext<Ctx | null>(null);

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (id: T) => void;
  /** glass: over the battlefield. solid: inside the panel and sheets. */
  tone?: "glass" | "solid";
  /** Fill the container width with equal segments. */
  stretch?: boolean;
  label?: string;
  className?: string;
  children: ReactNode;
}

/**
 * A pill track with a thumb that slides to the selection (a critically damped spring, no
 * overshoot). Segments are 36 high with a 4px hit margin above and below, so each target is 44.
 *
 *   <Segmented value={v} onChange={setV}>
 *     <Segment id="power" data-testid="branch-power">Power</Segment>
 *   </Segmented>
 */
export function Segmented<T extends string>({ value, onChange, tone = "solid", stretch = false, label, className, children }: SegmentedProps<T>) {
  const thumb = useId();
  const reduced = useReducedEffects();
  return (
    <SegCtx.Provider value={{ value, onChange: onChange as (id: string) => void, thumb, tone, stretch, reduced }}>
      <div className={cn("relative flex h-9 rounded-full p-[3px]", tone === "glass" ? "glass" : "bg-bg-2", stretch ? "w-full" : "self-start", className)} role="group" aria-label={label}>
        {children}
      </div>
    </SegCtx.Provider>
  );
}

interface SegmentProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "id" | "onChange"> {
  id: string;
  /** A 6px gold dot: something here wants attention. */
  badge?: boolean;
}

export function Segment({ id, badge, children, className, ...rest }: SegmentProps) {
  const ctx = useContext(SegCtx);
  if (!ctx) throw new Error("Segment outside Segmented");
  const on = ctx.value === id;
  return (
    <button
      type="button"
      className={cn(
        "relative flex items-center justify-center rounded-full px-3 t-label whitespace-nowrap transition-colors duration-200",
        "before:absolute before:inset-x-0 before:-inset-y-[7px] before:content-['']",
        ctx.stretch && "flex-1 min-w-0",
        on ? "text-t1" : "text-t2 active:text-t1",
        className,
      )}
      onClick={() => ctx.onChange(id)}
      aria-pressed={on}
      {...rest}
    >
      {on && <motion.span layoutId={ctx.thumb} className={cn("absolute inset-0 rounded-full", ctx.tone === "glass" ? "bg-white/[0.14]" : "bg-bg-3")} transition={ctx.reduced ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 46, mass: 1 }} />}
      <span className="relative truncate">{children}</span>
      {badge && <span className="absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
    </button>
  );
}
