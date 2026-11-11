"use client";

import { attachPlaytest, playtestRequested } from "@/game/telemetry/PlaytestRecorder";
import { useEffect, useState } from "react";
import { MotionConfig } from "motion/react";
import { GameController } from "@/game/GameController";
import { GameContext, useUi } from "@/hooks/useGame";
import { useReducedEffects } from "@/hooks/useReducedEffects";
import { Battlefield } from "./Battlefield";
import { TopBar } from "@/components/hud/TopBar";
import { TabNav } from "@/components/navigation/TabNav";
import { PanelHost } from "@/components/panels/PanelHost";
import { HandGuide } from "@/components/guidance/HandGuide";
import { ModalHost } from "@/components/rewards/ModalHost";

export default function GameShell() {
  // The controller is created inside an effect so React StrictMode's mount/unmount/mount
  // cycle creates a fresh instance instead of reusing a disposed one.
  const [controller, setController] = useState<GameController | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const c = new GameController();
    let alive = true;
    setController(c);
    // Debug and test hook: only with ?debug in the URL, or outside production.
    if (process.env.NODE_ENV !== "production" || new URLSearchParams(window.location.search).has("debug")) {
      (window as unknown as { __ASCEND__?: GameController }).__ASCEND__ = c;
    }
    // Playtest mode (?playtest=1): records this session on this device for the player to copy. Nothing is sent.
    const stopPlaytest = playtestRequested(window.location.search) ? attachPlaytest(c) : null;
    void c.boot().then(() => alive && setReady(true));
    return () => {
      alive = false;
      stopPlaytest?.();
      c.dispose();
    };
  }, []);

  useEffect(() => {
    // Warm the lazily-loaded panel chunks so the first tab switch is instant.
    const t = setTimeout(() => {
      void Promise.all([import("@/components/panels/SummonsPanel"), import("@/components/panels/GearPanel"), import("@/components/panels/SkillsPanel"), import("@/components/panels/RiftPanel")]);
    }, 1200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // Block pull-to-refresh / rubber banding and double-tap zoom at the document level.
    const prevent = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    document.addEventListener("touchmove", prevent, { passive: false });
    document.addEventListener("gesturestart", prevent as EventListener, { passive: false });
    return () => {
      document.removeEventListener("touchmove", prevent);
      document.removeEventListener("gesturestart", prevent as EventListener);
    };
  }, []);

  if (!controller) return <div id="app-shell" />;
  return (
    <GameContext.Provider value={controller}>
      <Shell controller={controller} ready={ready} />
    </GameContext.Provider>
  );
}

/**
 * Top bar (44), battlefield, panel, tab bar (58). The panel's rounded shoulders overlap the field
 * by 14px so the painting appears to continue behind it.
 */
function Shell({ controller, ready }: { controller: GameController; ready: boolean }) {
  const reduced = useReducedEffects();
  return (
    <MotionConfig reducedMotion={reduced ? "always" : "user"}>
      <div id="app-shell" data-testid="app-shell" data-reduced={reduced} onPointerDownCapture={() => controller.userGesture()}>
        <TopBar />
        <main className="relative min-h-0 min-w-0 grid" style={{ gridTemplateRows: "minmax(0,1fr) clamp(176px, 31dvh, 272px)", gridTemplateColumns: "minmax(0,1fr)" }}>
          <Battlefield />
          <PanelHost />
        </main>
        <TabNav />
        <HandGuide />
        <ModalHost />
        <BootVeil ready={ready} />
      </div>
    </MotionConfig>
  );
}

/** bg-0, the name in serif, the line in italic. It fades once the world is up. */
function BootVeil({ ready }: { ready: boolean }) {
  const booted = useUi((u) => u.booted);
  const [gone, setGone] = useState(false);
  const up = ready && booted;
  useEffect(() => {
    if (up) {
      const t = setTimeout(() => setGone(true), 500);
      return () => clearTimeout(t);
    }
  }, [up]);
  if (gone) return null;
  return (
    <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-bg-0 transition-opacity duration-[480ms] ease-[var(--ease-in)]" style={{ opacity: up ? 0 : 1, pointerEvents: up ? "none" : "auto" }} aria-hidden={up} data-testid="boot-veil">
      <BootMark />
    </div>
  );
}

export function BootMark() {
  return (
    <>
      <div className="font-serif text-[44px] leading-[44px] tracking-[0.02em] text-t1">ASCEND</div>
      <div className="t-flavour text-t2 mt-2">Claim what falls</div>
    </>
  );
}
