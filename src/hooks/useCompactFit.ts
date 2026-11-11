"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Whether an element's full layout fits its box. The full form is drawn first and kept only if
 * nothing overflows; otherwise the caller draws its compact form. Measured rather than guessed
 * from the screen height: a media query for "short" screens missed 360x740 and 360x800, where
 * panel actions sat past the edge. `key` re-tests when the content changes (another selection,
 * a longer line); a change in the box's height re-tests on its own. All of it runs before paint.
 */
export function useCompactFit<T extends HTMLElement>(key: unknown): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [room, setRoom] = useState(0);
  const [tight, setTight] = useState(false);
  useLayoutEffect(() => {
    // The room is read from the parent, whose size does not depend on which form is drawn. Read
    // from the element itself, a form that changes the element's own margin would change the
    // room, re-test, switch back, and flicker between the two.
    const box = ref.current?.parentElement;
    if (!box) return;
    const ro = new ResizeObserver(() => setRoom(box.clientHeight));
    ro.observe(box);
    return () => ro.disconnect();
    // Re-attached with the content: the element may only exist once there is something to show.
  }, [key]);
  // Try the full form again whenever the room or the content changes...
  useLayoutEffect(() => setTight(false), [room, key]);
  // ...and keep it only if it fits.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!tight && el && el.scrollHeight > el.clientHeight + 1) setTight(true);
  }, [tight, room, key]);
  return [ref, tight];
}
