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
 * The selected panel, faded in on every switch. There is deliberately no exit animation: waiting
 * for one to finish before showing the next ("wait" mode) could leave the wrong panel on screen
 * after fast tab switching. The keyed element always shows exactly the selected panel.
 */
export function PanelHost() {
  const panel = useUi((u) => u.panel);
  return (
    <section className="panel-surface relative min-h-0 overflow-hidden" data-testid={`panel-${panel}`}>
      <motion.div key={panel} className="absolute inset-0 flex flex-col min-h-0" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.14 }} data-panel={panel}>
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
