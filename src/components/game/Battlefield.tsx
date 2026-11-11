"use client";

import { useEffect, useRef } from "react";
import { useController, useProfile } from "@/hooks/useGame";
import { useStore } from "@/lib/store";
import { BattleOverlays } from "@/components/hud/BattleOverlays";

/** Hosts the PixiJS canvas and the HUD overlays that live on top of it. */
export function Battlefield() {
  const c = useController();
  const hostRef = useRef<HTMLDivElement>(null);
  const showDiag = useProfile((p) => p.settings.diagnostics);

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
      {showDiag && <Diagnostics />}
    </section>
  );
}

function Diagnostics() {
  const c = useController();
  const d = useStore(c.diagStore, (x) => x);
  return (
    <div className="absolute right-2 top-10 z-30 rounded-md bg-black/70 px-2 py-1 text-[9px] font-mono text-jade-2 leading-tight" data-testid="diagnostics">
      <div>
        {d.fps} fps · {d.frameMs} ms
      </div>
      <div>
        ent {d.entities} · fx {d.particles}
      </div>
      <div>{d.renderer}</div>
    </div>
  );
}
