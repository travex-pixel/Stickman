"use client";

import { useCallback, useRef } from "react";

/** Restart a one-shot CSS animation class on an element. */
export function replayClass(el: Element | null, cls: string): void {
  if (!el) return;
  el.classList.remove(cls);
  // Reading layout restarts the animation even when the class was already present.
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
}

/** The error gesture: a 4px horizontal shake, twice, in 200ms (`.shake` in globals.css). */
export function useShake<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T | null>(null);
  const shake = useCallback(() => replayClass(ref.current, "shake"), []);
  return [ref, shake] as const;
}
