"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(max-height: 700px)";

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True on short phones (iPhone SE class): panels drop secondary lines so every control stays reachable. */
export function useShortScreen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
