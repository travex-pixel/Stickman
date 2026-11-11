"use client";

import { motion } from "motion/react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Moment, MomentItem } from "@/components/ui/Moment";
import { Row } from "@/components/ui/Row";
import { useController } from "@/hooks/useGame";
import { useReducedEffects } from "@/hooks/useReducedEffects";
import type { Modal } from "@/game/GameController";
import { RANKS } from "@/game/progression/ranks";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

/** The old letter gives way to the new one (serif 72, a cross-fade with an 8px slide), then the rewards. */
export function RankUpMoment({ modal, open }: { modal: Extract<Modal, { kind: "rank_up" }>; open: boolean }) {
  const c = useController();
  const reduced = useReducedEffects();
  const slide = reduced ? 0 : 8;
  return (
    <Moment open={open} testId="modal-rank_up" label={`Rank ${RANKS[modal.to]}`}>
      <div className="w-full flex flex-col items-center" data-testid="rank-up">
        <MomentItem>
          <span className="t-eyebrow text-gold">Ascendant rank</span>
        </MomentItem>
        <div className="relative mt-3 flex h-[80px] w-full items-center justify-center" aria-hidden="true">
          <motion.span className="absolute font-serif text-[72px] leading-[72px] text-t2" initial={{ opacity: 1, x: 0 }} animate={{ opacity: 0, x: -slide }} transition={{ delay: 0.5, duration: 0.32, ease: EASE_OUT }}>
            {RANKS[modal.from]}
          </motion.span>
          <motion.span className="absolute font-serif text-[72px] leading-[72px] text-gold" initial={{ opacity: 0, x: slide }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.62, duration: 0.32, ease: EASE_OUT }}>
            {RANKS[modal.to]}
          </motion.span>
        </div>
        <MomentItem>
          <h2 className="t-display text-t1 mt-3">{modal.to >= 5 ? "Nothing stands above you" : "You have broken through"}</h2>
        </MomentItem>
        <div className="w-full mt-4 text-left shadow-[inset_0_1px_0_var(--line)]">
          {modal.rewards.map((r) => (
            <MomentItem key={r}>
              <Row gutter={false} leading={<Icon name="check" size={16} className="text-gold" />} title={<span className="whitespace-normal">{r}</span>} />
            </MomentItem>
          ))}
        </div>
        <MomentItem className="mt-5">
          <Button variant="primary" block onClick={() => c.returnToCampaign()} data-testid="rank-up-continue">
            Continue
          </Button>
        </MomentItem>
      </div>
    </Moment>
  );
}
