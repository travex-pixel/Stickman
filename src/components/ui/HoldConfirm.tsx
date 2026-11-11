"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { ButtonVariant } from "@/components/ui/Button";

interface Props {
  onConfirm: () => void;
  disabled?: boolean;
  children: ReactNode;
  /** primary: gold fill. plain: text only (a destructive ask in crimson, for example). */
  variant?: Extract<ButtonVariant, "primary" | "threat" | "plain">;
  className?: string;
  testId?: string;
  label?: string;
  /** How long the press must last. */
  ms?: number;
}

/**
 * A deliberate action: press and hold to confirm, release to cancel. While held, a fill sweeps
 * left to right across the button (a transform, linear over the hold); released early, it
 * drains back in 200ms. A tap does nothing but start and drain the sweep.
 */
export function HoldConfirm({ onConfirm, disabled = false, children, variant = "primary", className, testId, label, ms = 900 }: Props) {
  const [held, setHeld] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHeld(false);
  };
  const start = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || (e.button !== undefined && e.button !== 0)) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setHeld(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHeld(false);
      confirmRef.current();
    }, ms);
  };
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const fill = variant === "plain" ? "bg-crimson/20" : "bg-black/15";
  return (
    <button
      type="button"
      className={cn("ui-btn press relative overflow-hidden t-button select-none", className)}
      data-variant={variant}
      data-size="md"
      data-pressed={held}
      disabled={disabled}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()}
      data-testid={testId}
      aria-label={label}
    >
      <span
        className={cn("pointer-events-none absolute inset-0 origin-left", fill)}
        style={{ transform: `scaleX(${held ? 1 : 0})`, transition: held ? `transform ${ms}ms linear` : "transform 200ms var(--ease)" }}
        aria-hidden="true"
      />
      <span className="relative flex items-center gap-2">{children}</span>
    </button>
  );
}
