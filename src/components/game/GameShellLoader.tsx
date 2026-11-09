"use client";

import dynamic from "next/dynamic";

const GameShell = dynamic(() => import("./GameShell"), {
  ssr: false,
  loading: () => (
    <div id="app-shell" className="items-center justify-center" style={{ display: "flex" }}>
      <div className="flex flex-col items-center gap-3">
        <div className="font-display text-3xl tracking-[0.35em] text-bone text-glow-cyan">ASCEND</div>
        <div className="text-xs uppercase tracking-[0.3em] text-mist">Opening the Rift</div>
      </div>
    </div>
  ),
});

export default function GameShellLoader() {
  return <GameShell />;
}
