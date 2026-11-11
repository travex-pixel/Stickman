"use client";

import { type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedEffects } from "@/hooks/useReducedEffects";
import { cn } from "@/lib/cn";

interface MomentProps {
  open: boolean;
  children: ReactNode;
  testId?: string;
  label?: string;
  /** Tap anywhere on the takeover (for example to skip to the final beat). */
  onTap?: () => void;
  /**
   * solid: an 86% scrim over everything. reveal: clear over the upper part of the screen, where
   * the battlefield canvas stages a figure, and solid behind the text at the foot.
   */
  scrim?: "solid" | "reveal";
  className?: string;
}

const EASE_OUT = [0.16, 1, 0.3, 1] as const;
/** The scrims are the only gradients in the interface besides rarity accents: the reveal's leaves the
    figure clear; the solid one is 86% over the field and nearly opaque behind the text. */
const REVEAL_SCRIM = "linear-gradient(180deg, rgba(12,11,9,0) 0%, rgba(12,11,9,0) 28%, rgba(12,11,9,0.82) 46%, rgba(12,11,9,0.97) 56%, rgba(12,11,9,0.97) 100%)";
const SOLID_SCRIM = "linear-gradient(180deg, rgba(12,11,9,0.86) 0%, rgba(12,11,9,0.86) 36%, rgba(12,11,9,0.97) 52%, rgba(12,11,9,0.97) 100%)";

/**
 * A full-bleed takeover for reveals and boss cards. Content sits bottom-aligned where the thumb
 * is, and enters in a short sequence (8px rise and fade, 60ms apart) through `MomentItem`.
 */
export function Moment({ open, children, testId, label, onTap, scrim = "solid", className }: MomentProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={cn("fixed inset-0 z-50 flex flex-col justify-end", className)}
          style={{ backgroundImage: scrim === "reveal" ? REVEAL_SCRIM : SOLID_SCRIM }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.32, ease: EASE_OUT }}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          data-testid={testId}
          onClick={onTap}
        >
          <MomentGroup className="mx-auto w-full max-w-[440px] px-6 pb-[calc(24px+var(--sab))] flex flex-col items-center text-center">{children}</MomentGroup>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Sequences its `MomentItem` children: 60ms apart, after a short beat. */
export function MomentGroup({ children, className, delay = 0.08 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div className={className} initial="hidden" animate="shown" variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.06, delayChildren: delay } } }}>
      {children}
    </motion.div>
  );
}

/** One line of a Moment's sequence. */
export function MomentItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduced = useReducedEffects();
  return (
    <motion.div
      className={cn("w-full", className)}
      variants={{ hidden: { opacity: 0, y: reduced ? 0 : 8 }, shown: { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT } } }}
    >
      {children}
    </motion.div>
  );
}
