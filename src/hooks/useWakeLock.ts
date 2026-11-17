"use client";

import { useEffect } from "react";

/**
 * Keeps the screen awake while the game is on screen, so an idle fight can be watched without the
 * phone dimming. The browser drops the lock whenever the page is hidden, so it is taken again each
 * time the page comes back; some browsers only grant it after a touch, so a touch asks again.
 * Where the browser has no wake lock, or refuses (battery saver), nothing happens.
 */
export function useWakeLock(on: boolean): void {
  useEffect(() => {
    if (!on || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let asking = false;
    let gone = false;
    const take = async () => {
      if (gone || lock || asking || document.visibilityState !== "visible") return;
      asking = true;
      try {
        const l = await navigator.wakeLock.request("screen");
        if (gone) {
          void l.release().catch(() => {});
          return;
        }
        lock = l;
        l.addEventListener("release", () => {
          if (lock === l) lock = null;
        });
      } catch {
        // Refused (battery saver, no permission): the next touch or return to the page asks again.
      } finally {
        asking = false;
      }
    };
    const ask = () => void take();
    document.addEventListener("visibilitychange", ask);
    window.addEventListener("pointerdown", ask, { passive: true });
    ask();
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", ask);
      window.removeEventListener("pointerdown", ask);
      void lock?.release().catch(() => {});
      lock = null;
    };
  }, [on]);
}
