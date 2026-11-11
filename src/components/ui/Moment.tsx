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
  className?: string;
}

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/**
 * A full-bleed takeover for reveals and boss cards. An 86% scrim keeps the Pixi figure visible in
 * the upper part of the screen; the content sits bottom-aligned where the thumb is, and enters in
 * a short sequence (8px rise and fade, 60ms apart) through `MomentItem`.
 */
export function Moment({ open, children, testId, label, onTap, className }: MomentProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={cn("fixed inset-0 z-50 flex flex-col justify-end bg-[rgba(6,6,7,0.86)]", className)}
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
          <motion.div
            className="mx-auto w-full max-w-[440px] px-6 pb-[calc(32px+var(--sab))] flex flex-col items-center text-center"
            initial="hidden"
            animate="shown"
            variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } } }}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
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
