"use client";

import { createContext, useContext } from "react";

export type Detent = "base" | "tall";

/** The detent the panel is at (or springing to), for panels that show more when tall. */
export const DetentContext = createContext<Detent>("base");

export function usePanelDetent(): Detent {
  return useContext(DetentContext);
}
