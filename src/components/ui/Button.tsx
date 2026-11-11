"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "threat" | "quiet" | "plain";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: gold fill (one per view). threat: crimson fill. quiet: graphite fill. plain: text only. */
  variant?: ButtonVariant;
  /** md is 52 high, sm is 44 (the touch floor). */
  size?: "md" | "sm";
  loading?: boolean;
  /** Stretch to the container's width. */
  block?: boolean;
  leading?: ReactNode;
}

/**
 * The one button. Filled shapes, no borders. Press: scale 0.97 and a darkening veil over 120ms,
 * released over 200ms. Disabled: 40% and no press.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "quiet", size = "md", loading = false, block = false, leading, className, children, disabled, type = "button", ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn("ui-btn press", size === "md" ? "t-button" : "text-[14px] leading-[18px] font-semibold", block && "w-full", className)}
      data-variant={variant}
      data-size={size}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : leading}
      {children}
    </button>
  );
});

function Spinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="animate-spin shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.5" />
      <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
