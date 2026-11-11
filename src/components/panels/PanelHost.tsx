"use client";

import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { animate, motion, useMotionValue } from "motion/react";
import { useController, useUi } from "@/hooks/useGame";
import { useReducedEffects } from "@/hooks/useReducedEffects";
import { useSheetLift } from "@/hooks/useSheetLift";
import { DetentContext, type Detent } from "@/hooks/usePanelDetent";
import type { PanelId } from "@/game/data/ids";

const HeroPanel = lazy(() => import("./HeroPanel"));
const SummonsPanel = lazy(() => import("./SummonsPanel"));
const GearPanel = lazy(() => import("./GearPanel"));
const SkillsPanel = lazy(() => import("./SkillsPanel"));
const RiftPanel = lazy(() => import("./RiftPanel"));


/** Where each tab opens the first time it is selected in a session. Hero stays at the base. */
const DEFAULT_DETENT: Record<PanelId, Detent> = { hero: "base", summons: "tall", gear: "tall", skills: "tall", rift: "tall" };
const CAN_GROW: Record<PanelId, boolean> = { hero: false, summons: true, gear: true, skills: true, rift: true };
/** The player's choice per tab, for the rest of the session. */
const chosen: Partial<Record<PanelId, Detent>> = {};

/** The battlefield above a tall panel keeps at least this much painting. */
const FIELD_FLOOR = 220;
/** Below this much extra height a tall detent is not worth a gesture: the panel stays at its base. */
const MIN_EXTRA = 60;
// The sheet motion of the blueprint: 320ms ease-out, no overshoot, a known end.
const SPRING = { duration: 0.32, ease: [0.16, 1, 0.3, 1] } as const;

/** Extra height the tall detent adds over the base, for the current viewport. */
function measureExtra(main: HTMLElement | null): number {
  if (!main) return 0;
  const vh = window.innerHeight;
  const base = Math.min(272, Math.max(176, vh * 0.31));
  const tall = Math.min(vh * 0.6, 520);
  const extra = Math.floor(Math.min(tall - base, main.clientHeight - base - FIELD_FLOOR));
  return extra >= MIN_EXTRA ? extra : 0;
}

/**
 * One sheet with rounded shoulders that overlaps the battlefield by 14px, with two detents: base
 * (the grid row) and tall (up to min(60dvh, 520px)), which grows OVER the battlefield: the canvas
 * never resizes, the renderer lifts its framing instead. The detent change is a transform: the
 * panel lays out at its larger height first and slides from where it was (or slides, then lays
 * out at the smaller height), so nothing animates layout.
 *
 * The selected panel cross-fades in over 120ms on every switch. There is deliberately no exit
 * animation: waiting for one could leave the wrong panel on screen after fast tab switching.
 */
export function PanelHost() {
  const c = useController();
  const panel = useUi((u) => u.panel);
  const reduced = useReducedEffects();
  const lift = useSheetLift();
  const ref = useRef<HTMLElement>(null);
  const y = useMotionValue(0);
  const [extraMax, setExtraMax] = useState(0);
  const [, setVersion] = useState(0);
  const [laidOut, setLaidOut] = useState(0);
  const laidRef = useRef(0);

  useLayoutEffect(() => {
    const main = ref.current?.parentElement ?? null;
    const update = () => setExtraMax(measureExtra(main));
    update();
    const ro = new ResizeObserver(update);
    if (main) ro.observe(main);
    return () => ro.disconnect();
  }, []);

  const canGrow = CAN_GROW[panel] && extraMax > 0;
  const detent: Detent = canGrow ? (chosen[panel] ?? DEFAULT_DETENT[panel]) : "base";
  const extra = detent === "tall" ? extraMax : 0;

  // The overlays riding the top edge follow the visible edge: laid-out extra minus the slide.
  useEffect(() => y.on("change", (v) => lift.set(Math.max(0, laidRef.current - v))), [y, lift]);

  useLayoutEffect(() => {
    const from = laidRef.current;
    c.renderer?.setViewportInsets({ bottom: extra });
    if (extra === from) return;
    const settle = (v: number) => {
      laidRef.current = v;
      setLaidOut(v);
    };
    if (reduced) {
      settle(extra);
      y.set(0);
      lift.set(extra);
      return;
    }
    if (extra > from) {
      // Grow: lay out tall now, start shifted down by the difference, slide up.
      const shift = extra - from + y.get();
      settle(extra);
      y.set(shift);
      const ctl = animate(y, 0, SPRING);
      return () => ctl.stop();
    }
    // Shrink: slide down by the difference, then lay out at the smaller height.
    const ctl = animate(y, from - extra, SPRING);
    void ctl.then(() => {
      settle(extra);
      y.set(0);
      lift.set(extra);
    });
    return () => ctl.stop();
  }, [extra, reduced, y, lift, c]);

  useEffect(() => () => c.renderer?.setViewportInsets({ bottom: 0 }), [c]);

  const choose = (d: Detent) => {
    if (!canGrow || d === detent) return;
    chosen[panel] = d;
    setVersion((v) => v + 1);
  };

  return (
    <motion.section
      ref={ref}
      className="panel-surface relative z-10 min-h-0 overflow-hidden rounded-t-[22px]"
      style={{ marginTop: -(14 + laidOut), y }}
      data-testid={`panel-${panel}`}
      data-detent={detent}
    >
      <span className="gilt-edge" aria-hidden="true" />
      {canGrow && <Grabber detent={detent} onChoose={choose} />}
      <DetentContext.Provider value={detent}>
        <motion.div key={panel} className="absolute inset-0 flex flex-col min-h-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }} data-panel={panel}>
          <Suspense fallback={<div className="flex-1" />}>
            <PanelBody id={panel} />
          </Suspense>
        </motion.div>
      </DetentContext.Provider>
    </motion.section>
  );
}

/**
 * The grabber: a 36 x 4 bar in a strip along the panel's top edge. Tap to switch detents, or drag
 * up or down past 24px. It is a window splitter for assistive technology (Enter or Space toggles).
 */
function Grabber({ detent, onChoose }: { detent: Detent; onChoose: (d: Detent) => void }) {
  const start = useRef<number | null>(null);
  const down = (e: PointerEvent<HTMLDivElement>) => {
    start.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current === null) return;
    const dy = e.clientY - start.current;
    start.current = null;
    if (dy < -24) onChoose("tall");
    else if (dy > 24) onChoose("base");
    else if (Math.abs(dy) < 8) onChoose(detent === "tall" ? "base" : "tall");
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onChoose(detent === "tall" ? "base" : "tall");
    }
  };
  return (
    <div
      className="absolute inset-x-[30%] top-0 z-10 flex h-5 cursor-grab touch-none items-start justify-center pt-[7px]"
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={() => (start.current = null)}
      onKeyDown={key}
      role="separator"
      aria-orientation="horizontal"
      aria-label={detent === "tall" ? "Panel is tall. Press to lower it" : "Panel is at its base height. Press to raise it"}
      tabIndex={0}
      data-testid="panel-grabber"
    >
      <span className="h-1 w-9 rounded-full bg-[var(--line-2)]" aria-hidden="true" />
    </div>
  );
}

function PanelBody({ id }: { id: PanelId }) {
  switch (id) {
    case "hero":
      return <HeroPanel />;
    case "summons":
      return <SummonsPanel />;
    case "gear":
      return <GearPanel />;
    case "skills":
      return <SkillsPanel />;
    case "rift":
      return <RiftPanel />;
    default:
      return null;
  }
}
