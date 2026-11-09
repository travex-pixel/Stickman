"use client";

import { lazy, Suspense } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useUi } from "@/hooks/useGame";

const HeroPanel = lazy(() => import("./HeroPanel"));
const SummonsPanel = lazy(() => import("./SummonsPanel"));
const GearPanel = lazy(() => import("./GearPanel"));
const SkillsPanel = lazy(() => import("./SkillsPanel"));
const RiftPanel = lazy(() => import("./RiftPanel"));

export function PanelHost() {
  const panel = useUi((u) => u.panel);
  return (
    <section className="panel-surface relative min-h-0 overflow-hidden" data-testid={`panel-${panel}`}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={panel} className="absolute inset-0 flex flex-col min-h-0" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
          <Suspense fallback={<div className="flex-1" />}>
            {panel === "hero" && <HeroPanel />}
            {panel === "summons" && <SummonsPanel />}
            {panel === "gear" && <GearPanel />}
            {panel === "skills" && <SkillsPanel />}
            {panel === "rift" && <RiftPanel />}
          </Suspense>
        </motion.div>
      </AnimatePresence>
    </section>
  );
}
