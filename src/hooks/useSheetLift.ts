"use client";

import { createContext, useContext, useState } from "react";
import { motionValue, useTransform, type MotionValue } from "motion/react";

/**
 * How far the panel currently reaches above its base height, in px. The panel writes it as its
 * detent springs; the overlays that ride the panel's top edge (the ability bar, the bottom-left
 * stack) read it as a transform, so a detent change never re-renders or re-lays-out the field.
 */
export const SheetLiftContext = createContext<MotionValue<number> | null>(null);

export function useSheetLift(): MotionValue<number> {
  const ctx = useContext(SheetLiftContext);
  const [fallback] = useState(() => motionValue(0));
  return ctx ?? fallback;
}

/** The lift as an upward translation, for `style={{ y }}`. */
export function useSheetRise(): MotionValue<number> {
  return useTransform(useSheetLift(), (v) => -v);
}
