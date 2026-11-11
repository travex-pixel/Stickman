"use client";

import { useContext, useSyncExternalStore } from "react";
import { GameContext } from "@/hooks/useGame";
import { Store, useStore } from "@/lib/store";

const QUERY = "(prefers-reduced-motion: reduce)";
type SettingsWrap = { profile: { settings: { reducedEffects: boolean } } };
const NO_PROFILE = new Store<SettingsWrap>({ profile: { settings: { reducedEffects: false } } });

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** The OS asks for less motion. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/**
 * True when motion should be cut back: the OS setting or the in-game "Reduced effects".
 * Safe outside the game tree (falls back to the OS setting alone).
 */
export function useReducedEffects(): boolean {
  const c = useContext(GameContext);
  const os = usePrefersReducedMotion();
  const store = (c?.profileStore ?? NO_PROFILE) as unknown as Store<SettingsWrap>;
  const setting = useStore(store, (w) => w.profile.settings.reducedEffects);
  return os || setting;
}
