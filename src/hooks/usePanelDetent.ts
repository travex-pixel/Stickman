"use client";

import { createContext, useContext, useEffect } from "react";

export type Detent = "base" | "tall";

/** The detent the panel is at (or springing to), for panels that show more when tall. */
export const DetentContext = createContext<Detent>("base");

export function usePanelDetent(): Detent {
  return useContext(DetentContext);
}

/** Set by the panel host: a panel body asks for the tall detent, or lets it go. */
export const RaiseContext = createContext<(on: boolean) => void>(() => {});

/**
 * Raises the panel to its tall detent while `on` holds: a picked item or the ranks of the Arts, a
 * detail whose actions do not fit the base. The panel drops back to the player's own choice when
 * the detail closes, the way a map raises its sheet for a picked place. Dragging the panel down
 * while raised wins: the request is dropped until the detail opens again.
 */
export function useRaisePanel(on: boolean): void {
  const raise = useContext(RaiseContext);
  useEffect(() => {
    if (!on) return;
    raise(true);
    return () => raise(false);
  }, [on, raise]);
}

/** Set by the panel host: lower the panel to its base for `ms` (0 lets it rise again at once). */
export const LowerContext = createContext<(ms: number) => void>(() => {});

/**
 * Lowers the panel for a moment so the battlefield above it can be watched: a signature skill's
 * preview plays there. The panel returns to the height it had when the moment is over.
 */
export function usePanelLower(): (ms: number) => void {
  return useContext(LowerContext);
}
