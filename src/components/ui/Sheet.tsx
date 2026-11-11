"use client";

import { type ReactNode } from "react";
import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { useReducedEffects } from "@/hooks/useReducedEffects";
import { cn } from "@/lib/cn";

interface SheetProps {
  open: boolean;
  onDismiss?: () => void;
  /** Tap the scrim or drag down 80px to close. */
  dismissible?: boolean;
  children: ReactNode;
  testId?: string;
  /** Accessible name when the sheet has no visible heading wired with aria-labelledby. */
  label?: string;
  labelledBy?: string;
  className?: string;
  /** Rendered above everything (z-50) by default; pass a lower layer for in-field sheets. */
  zClass?: string;
  /**
   * The sheet's own actions, pinned under the scrolling content so the main one is always in
   * view: at 320x568 Collect and "Hold to ascend" fell below the fold of long sheets.
   */
  footer?: ReactNode;
}

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

const TONE: Record<"t2" | "gold" | "crimson" | "jade", string> = { t2: "text-t2", gold: "text-gold", crimson: "text-threat", jade: "text-jade" };

/**
 * The top of a sheet: one eyebrow (the only uppercase in the view), the title, a quiet line.
 * `serif` sets the title in t-display, for sheets that name something (a boss, a shadow).
 */
export function SheetHeader({ eyebrow, title, subtitle, tone = "t2", serif = false, id }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; tone?: keyof typeof TONE; serif?: boolean; id?: string }) {
  return (
    <div className="flex flex-col">
      {eyebrow && (
        <span className={cn("t-eyebrow flex items-center gap-2", TONE[tone])}>
          <span className="lozenge" aria-hidden="true" />
          {eyebrow}
        </span>
      )}
      <h2 id={id} className={cn(serif ? "t-display" : "t-title", "text-t1", !!eyebrow && (serif ? "mt-1.5" : "mt-1"))}>
        {title}
      </h2>
      {subtitle && <p className="t-label text-t2 mt-1">{subtitle}</p>}
    </div>
  );
}

/** The foot of a sheet: a plain secondary at the left, the one filled action taking the rest. */
export function SheetActions({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mt-6 flex items-center gap-3 [&>*:last-child]:flex-1", className)}>{children}</div>;
}
const EASE_IN = [0.4, 0, 1, 1] as const;

/**
 * The bottom sheet: every non-moment dialog. bg-1, 28px shoulders, a grabber, 20px padding over
 * the safe area. Enters from below (320ms ease-out), leaves faster (200ms ease-in) over a blurred
 * scrim. Content scrolls inside a sheet capped at 86dvh.
 */
export function Sheet({ open, onDismiss, dismissible = true, children, testId, label, labelledBy, className, zClass = "z-50", footer }: SheetProps) {
  const reduced = useReducedEffects();
  const drag = useDragControls();
  const canDismiss = dismissible && !!onDismiss;
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (canDismiss && (info.offset.y > 80 || info.velocity.y > 600)) onDismiss?.();
  };
  return (
    <AnimatePresence>
      {open && (
        <div className={cn("fixed inset-0 flex flex-col justify-end", zClass)} role="dialog" aria-modal="true" aria-label={label} aria-labelledby={labelledBy} data-testid={testId}>
          <motion.div
            // A dim, not a blur: reviewers saw the blurred top half as dead space. The fight stays
            // legible behind the sheet (it keeps running there), just quieter.
            className="absolute inset-0 bg-[rgba(8,7,5,0.55)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => canDismiss && onDismiss?.()}
            aria-hidden="true"
          />
          <motion.div
            className={cn("panel-surface relative mx-auto w-full max-w-[480px] max-h-[86dvh] flex flex-col rounded-t-[28px]", className)}
            initial={reduced ? { opacity: 0 } : { y: "100%" }}
            animate={reduced ? { opacity: 1 } : { y: 0, transition: { duration: 0.32, ease: EASE_OUT } }}
            exit={reduced ? { opacity: 0, transition: { duration: 0.2 } } : { y: "100%", transition: { duration: 0.2, ease: EASE_IN } }}
            drag={canDismiss && !reduced ? "y" : false}
            dragListener={false}
            dragControls={drag}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.9 }}
            onDragEnd={onDragEnd}
          >
            <span className="gilt-edge !left-7 !right-7" aria-hidden="true" />
            <div className="shrink-0 h-[30px] flex items-start justify-center pt-[10px] touch-none" onPointerDown={(e) => canDismiss && drag.start(e)} aria-hidden="true">
              {canDismiss && <span className="h-1 w-9 rounded-full bg-[var(--line-2)]" />}
            </div>
            <div className={cn("min-h-0 overflow-y-auto overscroll-contain px-5", footer ? "pb-1" : "pb-[calc(20px+var(--sab))]")} style={{ touchAction: "pan-y" }}>
              {children}
            </div>
            {footer && <div className="shrink-0 px-5 pt-4 pb-[calc(20px+var(--sab))]">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
