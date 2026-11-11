"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useUi } from "@/hooks/useGame";

const LABEL_W = 220;
const LABEL_H = 36;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Animated pointing hand that finds its target by data-guide attribute, follows layout changes,
 * respects safe areas, and performs point / tap / hold gestures with a short instruction label.
 */
export function HandGuide() {
  const guide = useUi((u) => u.guide);
  const modal = useUi((u) => u.modal);
  const panel = useUi((u) => u.panel);
  const [rect, setRect] = useState<Rect | null>(null);
  // Controls the label must never cover (the boss gate, a finished quest's Claim).
  const [keepClear, setKeepClear] = useState<Rect[]>([]);
  const [inDialog, setInDialog] = useState(false);

  useLayoutEffect(() => {
    if (!guide) {
      setRect(null);
      return;
    }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-guide="${guide.target}"]`);
      const clear: Rect[] = [];
      for (const k of document.querySelectorAll<HTMLElement>('[data-guide="boss-challenge"], [data-guide="quest-claim"]')) {
        if (k === el) continue;
        const r = k.getBoundingClientRect();
        if (r.width > 0 && getComputedStyle(k).opacity !== "0") clear.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
      setKeepClear((prev) => (sameRects(prev, clear) ? prev : clear));
      setInDialog(!!el?.closest("[role=dialog]"));
      if (!el) {
        setRect(null);
      } else if (guide.target === "battlefield-player") {
        // The camera keeps the warrior near the middle of the field, so the guide points at a
        // fixed anchor there rather than mapping world coordinates (which the camera owns).
        const r = el.getBoundingClientRect();
        setRect({ x: r.left - 24, y: r.top - 56, w: 48, h: 70 });
      } else {
        const r = el.getBoundingClientRect();
        setRect({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [guide, panel, modal]);

  const [visible, setVisible] = useState(false);
  // An open sheet covers the screen: the guide only shows when what it points at is inside it.
  const blocking = modal !== null && modal.kind !== "boss_intro" && !inDialog;
  useEffect(() => {
    setVisible(Boolean(guide && rect && !blocking));
  }, [guide, rect, blocking]);

  if (!guide || !rect) return null;
  const vw = typeof window !== "undefined" ? window.innerWidth : 390;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  // Point from below when the target is high on the screen, otherwise from above. FIGHT sits at
  // the foot of the readiness sheet: point from below so the sheet stays readable. The drawing
  // points up; from above it turns to point down, so the fingertip, never the cuff, meets the
  // target (blind reviewers read an upright hand above Claim as pointing at its own label).
  const TIP = { x: 19, y: 2.5 }; // the fingertip in the 48 x 56 drawing
  const placeX = (from: boolean) => Math.min(vw - 52, Math.max(4, cx - (from ? TIP.x : 48 - TIP.x)));
  const placeY = (from: boolean) => (from ? cy + rect.h / 2 + 2 - TIP.y : cy - rect.h / 2 - 2 - (56 - TIP.y));
  const overlaps = (from: boolean) => keepClear.some((k) => placeX(from) < k.x + k.w && k.x < placeX(from) + 48 && placeY(from) < k.y + k.h && k.y < placeY(from) + 56);
  let below = cy < vh * 0.42 || guide.target === "boss-fight";
  // The hand never sits on the gate or a Claim either: point from the other side instead.
  if (overlaps(below)) below = !below;
  const handX = placeX(below);
  const handY = placeY(below);
  const tipX = handX + (below ? TIP.x : 48 - TIP.x);
  const tipY = handY + (below ? TIP.y : 56 - TIP.y);
  let labelY = below ? handY + 64 : handY - 34;
  const labelX = Math.min(vw - 140, Math.max(10, cx - 70));
  // Never over the gate or a Claim: step the label above (or below) whatever it would cover.
  for (let i = 0; i < 3; i++) {
    const hit = [...keepClear, rect, { x: handX, y: handY, w: 48, h: 56 }].find((k) => labelX < k.x + k.w && k.x < labelX + LABEL_W && labelY < k.y + k.h && k.y < labelY + LABEL_H);
    if (!hit) break;
    labelY = below ? hit.y + hit.h + 8 : hit.y - LABEL_H - 8;
  }
  // Taps and holds move toward the target, whichever side the hand is on.
  const toward = below ? -1 : 1;
  const gestureAnim =
    guide.gesture === "tap"
      ? { y: [0, 10 * toward, 0], scale: [1, 0.9, 1] }
      : guide.gesture === "hold"
        ? { scale: [1, 0.86, 0.86, 1], y: [0, 4 * toward, 4 * toward, 0] }
        : { x: [0, 6, 0], y: [0, -6, 0] };
  const duration = guide.gesture === "hold" ? 1.6 : guide.gesture === "tap" ? 0.9 : 1.4;

  return (
    <AnimatePresence mode="wait">
      {visible && (
        <motion.div key={guide.target} className="pointer-events-none fixed inset-0 z-[60]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} data-testid="hand-guide" data-target={guide.target}>
          <div className="guide-pulse" style={{ left: rect.x - 6, top: rect.y - 6, width: rect.w + 12, height: rect.h + 12 }} />
          <motion.div className="absolute" style={{ left: handX, top: handY, width: 48, height: 56 }} animate={gestureAnim} transition={{ duration, repeat: Infinity, ease: "easeInOut" }} data-testid="hand-pointer" data-tip-x={Math.round(tipX)} data-tip-y={Math.round(tipY)}>
            <div style={below ? undefined : { transform: "rotate(180deg)" }}>
              <Hand />
            </div>
          </motion.div>
          <motion.div
            className="absolute rounded-[14px] bg-bg-2 px-3 py-2 t-label text-t1"
            style={{ left: labelX, top: labelY, minWidth: 120, maxWidth: LABEL_W, textAlign: "center" }}
            initial={{ y: 6, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            {guide.label}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Original vector hand: a flat pointing glove in warm white with a gold cuff. */
function Hand() {
  return (
    <svg viewBox="0 0 48 56" width="48" height="56" aria-hidden="true">
      
      {/* index finger */}
      <path d="M19 2.5c2.4 0 4 1.6 4 4V26h-8V6.5c0-2.4 1.6-4 4-4z" fill="#f3f0e9" stroke="#15130f" strokeWidth="1.5" />
      {/* palm and folded fingers */}
      <path d="M11 24c0-2 1.5-3.5 3.5-3.5h16.5c4 0 7 2.6 7 7v7c0 7.5-5.5 13-13 13h-6c-5 0-8.5-3-10-7l-2.6-7c-.8-2.2.5-4.5 2.8-4.9z" fill="#f3f0e9" stroke="#15130f" strokeWidth="1.5" />
      <path d="M27 21.5v8M33 22.5v8M38 25v7" stroke="#15130f" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
      {/* cuff */}
      <path d="M15 46.5h17c1.6 0 3 1.3 3 3v2c0 1.6-1.4 3-3 3H15c-1.6 0-3-1.4-3-3v-2c0-1.7 1.4-3 3-3z" fill="#1e1b16" stroke="#dab86c" strokeWidth="1.5" />
      <circle cx="23.5" cy="50.5" r="1.6" fill="#dab86c" />
    </svg>
  );
}

function sameRects(a: Rect[], b: Rect[]): boolean {
  return a.length === b.length && a.every((r, i) => Math.abs(r.x - b[i]!.x) < 1 && Math.abs(r.y - b[i]!.y) < 1 && Math.abs(r.w - b[i]!.w) < 1 && Math.abs(r.h - b[i]!.h) < 1);
}
