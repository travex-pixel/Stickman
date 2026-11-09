"use client";

import { useEffect, useRef } from "react";
import { useController, useHud, useUi } from "@/hooks/useGame";
import { BattleOverlays } from "@/components/hud/BattleOverlays";

/** Hosts the PixiJS canvas and the HUD overlays that live on top of it. */
export function Battlefield() {
  const c = useController();
  const hostRef = useRef<HTMLDivElement>(null);
  const diagnostics = useUi((u) => u.fps);
  const stats = useUi((u) => u.renderStats);
  const showDiag = useDiagnostics();
  const entities = useHud((s) => s?.entities ?? 0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    void c.attachRenderer(host);
    return () => c.detachRenderer();
  }, [c]);

  return (
    <section className="relative min-h-0 overflow-hidden" data-testid="battlefield" onPointerDown={() => c.userGesture()}>
      <div ref={hostRef} className="absolute inset-0" />
      <div className="absolute left-1/2 top-1/2 h-0 w-0" data-guide="battlefield-player" />
      <BattleOverlays />
      {showDiag && (
        <div className="absolute right-2 top-10 z-30 rounded-md bg-black/70 px-2 py-1 text-[9px] font-mono text-soul leading-tight" data-testid="diagnostics">
          <div>{diagnostics} fps · {stats.frameMs} ms</div>
          <div>ent {entities} · fx {stats.particles}</div>
          <div>{stats.renderer}</div>
        </div>
      )}
    </section>
  );
}

function useDiagnostics(): boolean {
  const c = useController();
  const on = c.profileStore.get().profile.settings.diagnostics;
  const live = useUi((u) => u.booted);
  void live;
  return on;
}
