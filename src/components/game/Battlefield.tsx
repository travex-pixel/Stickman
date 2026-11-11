"use client";

import { useEffect, useRef } from "react";
import { useController, useProfile, useUi } from "@/hooks/useGame";
import { cn } from "@/lib/cn";

const MOMENT_KINDS = ["summon_reveal", "boss_victory", "rank_up", "technique"] as const;
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
  // Under a moment (a reveal, a victory) the field is the stage: the controls step aside.
  const moment = useUi((u) => !!u.modal && (MOMENT_KINDS as readonly string[]).includes(u.modal.kind) && !(u.modal.kind === "summon_reveal" && u.modal.outcome.kind !== "new"));

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
      <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(12,11,9,0.55) 0, rgba(12,11,9,0) 14%, rgba(12,11,9,0) 64%, rgba(12,11,9,0.88) 100%)" }} aria-hidden="true" />
      <div className="absolute left-1/2 top-[60%] h-0 w-0" data-guide="battlefield-player" />
      <div className={cn("transition-opacity duration-200", moment && "pointer-events-none opacity-0")} aria-hidden={moment || undefined}>
        <BattleOverlays />
        <AbilityBar />
      </div>
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
