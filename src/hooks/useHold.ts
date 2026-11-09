"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { holdRepeatDelay } from "@/game/progression/upgrades";

/**
 * Press-and-hold repeat. First action fires immediately, then repeats with acceleration.
 * Stops instantly on pointer up / cancel / leave, and never double-fires for one press.
 */
export function useHold(action: () => boolean, enabled = true) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holding = useRef(false);
  const index = useRef(0);
  const actionRef = useRef(action);
  actionRef.current = action;
  const [active, setActive] = useState(false);

  const stop = useCallback(() => {
    holding.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setActive(false);
  }, []);

  const tick = useCallback(() => {
    if (!holding.current) return;
    const ok = actionRef.current();
    if (!ok) {
      stop();
      return;
    }
    index.current += 1;
    timer.current = setTimeout(tick, holdRepeatDelay(index.current));
  }, [stop]);

  const start = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled) return;
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      if (holding.current) return;
      holding.current = true;
      index.current = 0;
      setActive(true);
      tick();
    },
    [enabled, tick],
  );

  // With pointer capture the element keeps receiving events after the finger slides off it,
  // so we cancel explicitly when the pointer leaves the element's box.
  const move = useCallback(
    (e: React.PointerEvent) => {
      if (!holding.current) return;
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const margin = 10;
      if (e.clientX < r.left - margin || e.clientX > r.right + margin || e.clientY < r.top - margin || e.clientY > r.bottom + margin) stop();
    },
    [stop],
  );

  useEffect(() => stop, [stop]);

  return {
    active,
    handlers: {
      onPointerDown: start,
      onPointerUp: stop,
      onPointerCancel: stop,
      onPointerLeave: stop,
      onPointerMove: move,
      onContextMenu: (e: React.SyntheticEvent) => e.preventDefault(),
    },
  };
}
