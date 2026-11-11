"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { isBattlefieldModal } from "@/components/rewards/BossCards";
import { AnimatePresence, motion } from "motion/react";
import { useUi, useController } from "@/hooks/useGame";

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
  const c = useController();
  const [rect, setRect] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    if (!guide) {
      setRect(null);
      return;
    }
    let raf = 0;
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-guide="${guide.target}"]`);
      if (!el) {
        setRect(null);
      } else if (guide.target === "battlefield-player") {
        const host = el.parentElement?.getBoundingClientRect();
        const v = c.view;
        const snap = c.hudStore.get();
        if (host && snap) {
          const px = host.left + snap.player.x * v.scale;
          const py = host.top + v.offsetY + snap.player.y * v.depthScale - 40;
          setRect({ x: px - 24, y: py - 44, w: 48, h: 70 });
        }
      } else {
        const r = el.getBoundingClientRect();
        setRect({ x: r.left, y: r.top, w: r.width, h: r.height });
      }
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(raf);
  }, [guide, panel, modal, c]);

  const [visible, setVisible] = useState(false);
  // Battlefield cards (defeat, stage clear, mode results) leave the panels usable, so the guide may point past them.
  const blocking = modal !== null && !isBattlefieldModal(modal.kind);
  useEffect(() => {
    setVisible(Boolean(guide && rect && !blocking));
  }, [guide, rect, blocking]);

  if (!guide || !rect) return null;
  const vw = typeof window !== "undefined" ? window.innerWidth : 390;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  // Place the hand below-right of the target when there is room, otherwise above-left.
  const below = cy < vh * 0.42;
  const handX = Math.min(vw - 60, Math.max(16, cx + 8));
  const handY = below ? cy + rect.h / 2 - 6 : cy - rect.h / 2 - 58;
  const labelY = below ? handY + 64 : handY - 34;
  const labelX = Math.min(vw - 140, Math.max(10, cx - 70));
  const gestureAnim =
    guide.gesture === "tap"
      ? { y: [0, -10, 0], scale: [1, 0.9, 1] }
      : guide.gesture === "hold"
        ? { scale: [1, 0.86, 0.86, 1], y: [0, -4, -4, 0] }
        : { x: [0, 6, 0], y: [0, -6, 0] };
  const duration = guide.gesture === "hold" ? 1.6 : guide.gesture === "tap" ? 0.9 : 1.4;

  return (
    <AnimatePresence mode="wait">
      {visible && (
        <motion.div key={guide.target} className="pointer-events-none fixed inset-0 z-[60]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} data-testid="hand-guide" data-target={guide.target}>
          <div className="guide-pulse" style={{ left: rect.x - 6, top: rect.y - 6, width: rect.w + 12, height: rect.h + 12 }} />
          <motion.div className="absolute" style={{ left: handX, top: handY, width: 48, height: 56 }} animate={gestureAnim} transition={{ duration, repeat: Infinity, ease: "easeInOut" }}>
            <Hand />
          </motion.div>
          <motion.div
            className="absolute rounded-lg bg-[#141922]/96 border border-gold/50 px-3 py-1.5 text-[12px] font-semibold text-ivory shadow-[0_6px_24px_rgba(0,0,0,0.5)]"
            style={{ left: labelX, top: labelY, minWidth: 120, textAlign: "center" }}
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

/** Original vector hand: a pointing glove drawn with soft shading and a cyan trim. */
function Hand() {
  return (
    <svg viewBox="0 0 48 56" width="48" height="56" aria-hidden="true" style={{ filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.6))" }}>
      <defs>
        <linearGradient id="hand-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f7f3ea" />
          <stop offset="1" stopColor="#cfc6b6" />
        </linearGradient>
      </defs>
      {/* index finger */}
      <path d="M19 2.5c2.4 0 4 1.6 4 4V26h-8V6.5c0-2.4 1.6-4 4-4z" fill="url(#hand-grad)" stroke="#2a2d3a" strokeWidth="1.5" />
      {/* palm and folded fingers */}
      <path d="M11 24c0-2 1.5-3.5 3.5-3.5h16.5c4 0 7 2.6 7 7v7c0 7.5-5.5 13-13 13h-6c-5 0-8.5-3-10-7l-2.6-7c-.8-2.2.5-4.5 2.8-4.9z" fill="url(#hand-grad)" stroke="#2a2d3a" strokeWidth="1.5" />
      <path d="M27 21.5v8M33 22.5v8M38 25v7" stroke="#2a2d3a" strokeWidth="1.2" strokeLinecap="round" opacity="0.7" />
      {/* cuff */}
      <path d="M15 46.5h17c1.6 0 3 1.3 3 3v2c0 1.6-1.4 3-3 3H15c-1.6 0-3-1.4-3-3v-2c0-1.7 1.4-3 3-3z" fill="#1b2130" stroke="#cfa95e" strokeWidth="1.5" />
      <circle cx="23.5" cy="50.5" r="1.6" fill="#e9d39a" />
    </svg>
  );
}
