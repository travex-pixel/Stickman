"use client";

import { useEffect, useState } from "react";
import { GameController } from "@/game/GameController";
import { GameContext, useUi } from "@/hooks/useGame";
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
    void c.boot().then(() => alive && setReady(true));
    return () => {
      alive = false;
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
      <div id="app-shell" data-testid="app-shell" onPointerDownCapture={() => controller.userGesture()}>
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
    </GameContext.Provider>
  );
}

function BootVeil({ ready }: { ready: boolean }) {
  const booted = useUi((u) => u.booted);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (ready && booted) {
      const t = setTimeout(() => setGone(true), 500);
      return () => clearTimeout(t);
    }
  }, [ready, booted]);
  if (gone) return null;
  return (
    <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-ink transition-opacity duration-500" style={{ opacity: ready && booted ? 0 : 1, pointerEvents: ready && booted ? "none" : "auto" }} aria-hidden={ready && booted} data-testid="boot-veil">
      <div className="font-display text-4xl tracking-[0.4em] text-ivory text-glow-gold">ASCEND</div>
      <div className="mt-2 text-[11px] uppercase tracking-[0.3em] text-mist">Claim what falls</div>
    </div>
  );
}
