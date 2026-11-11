"use client";

import { lazy, Suspense } from "react";
import { motion } from "motion/react";
import { useUi } from "@/hooks/useGame";
import type { PanelId } from "@/game/data/ids";

const HeroPanel = lazy(() => import("./HeroPanel"));
const SummonsPanel = lazy(() => import("./SummonsPanel"));
const GearPanel = lazy(() => import("./GearPanel"));
const SkillsPanel = lazy(() => import("./SkillsPanel"));
const RiftPanel = lazy(() => import("./RiftPanel"));

/**
 * One sheet with rounded shoulders that overlaps the battlefield by 14px. The selected panel
 * cross-fades in over 120ms on every switch. There is deliberately no exit animation: waiting for
 * one ("wait" mode) could leave the wrong panel on screen after fast tab switching. The keyed
 * element always shows exactly the selected panel.
 */
export function PanelHost() {
  const panel = useUi((u) => u.panel);
  return (
    <section className="relative z-10 -mt-[14px] min-h-0 overflow-hidden rounded-t-[22px] bg-bg-1" data-testid={`panel-${panel}`}>
      <motion.div key={panel} className="absolute inset-0 flex flex-col min-h-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }} data-panel={panel}>
        <Suspense fallback={<div className="flex-1" />}>
          <PanelBody id={panel} />
        </Suspense>
      </motion.div>
    </section>
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
