"use client";

import { createContext, useContext } from "react";
import type { GameController, UiState } from "@/game/GameController";
import type { Profile } from "@/game/progression/profile";
import type { WorldSnapshot } from "@/game/engine/World";
import { useStore } from "@/lib/store";

export const GameContext = createContext<GameController | null>(null);

export function useController(): GameController {
  const c = useContext(GameContext);
  if (!c) throw new Error("GameContext missing");
  return c;
}

export function useProfile<S>(selector: (p: Profile) => S): S {
  const c = useController();
  return useStore(c.profileStore, (w) => selector(w.profile));
}

/** Re-renders on every profile commit; returns the live (mutable) profile reference. */
export function useProfileRef(): Profile {
  const c = useController();
  return useStore(c.profileStore, (w) => w).profile;
}

export function useHud<S>(selector: (s: WorldSnapshot | null) => S): S {
  const c = useController();
  return useStore(c.hudStore, selector);
}

export function useUi<S>(selector: (u: UiState) => S): S {
  const c = useController();
  return useStore(c.uiStore, selector);
}
