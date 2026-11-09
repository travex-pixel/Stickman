"use client";

import { useHold } from "@/hooks/useHold";
import { cn } from "@/lib/cn";

interface Props {
  onRepeat: () => boolean;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  guide?: string;
  testId?: string;
  label?: string;
}

/** Tactile press-and-hold control. Fires immediately, repeats with acceleration, stops on release. */
export function HoldButton({ onRepeat, disabled, className, children, guide, testId, label }: Props) {
  const { active, handlers } = useHold(onRepeat, !disabled);
  return (
    <button
      type="button"
      className={cn("hold-btn select-none", className)}
      data-disabled={disabled}
      data-active={active}
      data-guide={guide}
      data-testid={testId}
      aria-label={label}
      disabled={disabled}
      {...handlers}
    >
      {active && <span className="hold-progress" />}
      <span className="relative z-10 flex items-center justify-center gap-1">{children}</span>
    </button>
  );
}
