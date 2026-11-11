"use client";

import dynamic from "next/dynamic";

// The same mark as the boot veil, so loading and booting read as one continuous moment.
const GameShell = dynamic(() => import("./GameShell"), {
  ssr: false,
  loading: () => (
    <div id="app-shell" className="items-center justify-center" style={{ display: "flex" }}>
      <div className="flex flex-col items-center">
        <div className="font-serif text-[44px] leading-[44px] tracking-[0.02em] text-t1">ASCEND</div>
        <div className="t-flavour text-t2 mt-2">Claim what falls</div>
      </div>
    </div>
  ),
});

export default function GameShellLoader() {
  return <GameShell />;
}
