"use client";

import { useEffect, useRef } from "react";
import { useController, useProfile } from "@/hooks/useGame";
import { useStore } from "@/lib/store";
import { BattleOverlays } from "@/components/hud/BattleOverlays";
import { AbilityBar } from "@/components/hud/AbilityBar";

/**
 * Hosts the PixiJS canvas and the overlays that live on top of it. The section is its own
 * stacking context, so nothing on the field can rise over the panel that overlaps its foot.
 */
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
    <section className="relative isolate min-h-0 overflow-hidden bg-bg-0" data-testid="battlefield" onPointerDown={() => c.userGesture()}>
      <div
        ref={hostRef}
        className="absolute inset-0"
        data-testid="battle-canvas"
        onPointerDown={(e) => {
          if (e.target instanceof HTMLCanvasElement) c.focusAt(e.clientX, e.clientY);
        }}
      />
      {/* Scene shading, not interface: the sky darkens under the top bar and the ground darkens
          where the controls sit, so glass reads without boxes. */}
      <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(10,10,11,0.55) 0, rgba(10,10,11,0) 14%, rgba(10,10,11,0) 64%, rgba(10,10,11,0.88) 100%)" }} aria-hidden="true" />
      <div className="absolute left-1/2 top-[60%] h-0 w-0" data-guide="battlefield-player" />
      <BattleOverlays />
      <AbilityBar />
      {showDiag && <Diagnostics />}
    </section>
  );
}

function Diagnostics() {
  const c = useController();
  const d = useStore(c.diagStore, (x) => x);
  return (
    <div className="absolute right-3 top-14 z-30 rounded-[10px] bg-bg-0/80 px-2 py-1 font-mono text-[11px] leading-[14px] text-jade" data-testid="diagnostics">
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
