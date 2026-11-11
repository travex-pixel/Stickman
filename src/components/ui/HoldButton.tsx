"use client";

import { useHold } from "@/hooks/useHold";
import { cn } from "@/lib/cn";

interface Props {
  onRepeat: () => boolean;
  disabled?: boolean;
  /** Pressed while disabled (cannot afford): the caller shakes the cost and plays the error tone. */
  onDenied?: () => void;
  className?: string;
  children: React.ReactNode;
  guide?: string;
  testId?: string;
  label?: string;
  /** fill: the surface fills bg-2 while held (cells, rows). scale: it presses in (buttons). */
  feedback?: "fill" | "scale";
}

/**
 * Press-and-hold control. Fires immediately, repeats with acceleration, stops on release or when
 * the finger slides off. It carries no chrome of its own: the caller draws the surface.
 */
export function HoldButton({ onRepeat, disabled, onDenied, className, children, guide, testId, label, feedback = "fill" }: Props) {
  const { active, handlers } = useHold(onRepeat, !disabled);
  // A denied press stays tappable (aria-disabled) so it can answer with a shake instead of nothing.
  const deny = disabled && onDenied;
  return (
    <button
      type="button"
      className={cn("select-none", feedback === "fill" ? "press-fill" : "press", className)}
      data-disabled={disabled}
      data-pressed={active}
      data-guide={guide}
      data-testid={testId}
      aria-label={label}
      aria-disabled={disabled || undefined}
      disabled={disabled && !deny}
      {...(deny ? { onPointerDown: () => onDenied(), onContextMenu: (e: React.SyntheticEvent) => e.preventDefault() } : handlers)}
    >
      {children}
    </button>
  );
}
