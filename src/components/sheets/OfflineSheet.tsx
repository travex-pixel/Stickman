"use client";

import { Button } from "@/components/ui/Button";
import { MomentGroup, MomentItem } from "@/components/ui/Moment";
import { Row } from "@/components/ui/Row";
import { Sheet } from "@/components/ui/Sheet";
import { Stat } from "@/components/ui/Stat";
import { Icon } from "@/components/ui/Icon";
import { useController, useProfileRef } from "@/hooks/useGame";
import type { Modal } from "@/game/GameController";
import { ENEMIES } from "@/game/data/enemies";
import { bossForStage } from "@/game/data/regions";
import { affordableUpgrades } from "@/game/progression/readiness";
import { nextMilestone } from "@/game/progression/milestones";
import { fmt, fmtDuration } from "@/lib/format";
import { LootRow, RewardTotal } from "./parts";

/** The return: how long, what it earned (counting up), four facts, and the boss that waits. */
export function OfflineSheet({ modal, open }: { modal: Extract<Modal, { kind: "offline" }>; open: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const r = modal.summary;
  const ups = affordableUpgrades(profile);
  const shardTotal = Object.values(r.shards).reduce((a, b) => a + b, 0);
  const boss = r.bossWaiting ? ENEMIES[bossForStage(r.bossWaiting)] : undefined;
  return (
    <Sheet open={open} onDismiss={() => c.dismissOffline()} testId="modal-offline" labelledBy="offline-title">
      <MomentGroup className="flex flex-col" delay={0.12}>
        <div data-testid="offline-summary">
          <MomentItem>
            <span className="t-eyebrow text-t2">While you were away</span>
            <h2 id="offline-title" className="t-display text-t1 mt-1.5">
              {fmtDuration(r.seconds)}
              {r.capped && <span className="t-label text-t2 ml-2 align-middle">the most it holds</span>}
            </h2>
            <p className="t-label text-t2 mt-1">
              Your warrior fought for {fmtDuration(Math.round(r.foughtSeconds))} of it{modal.levels > 0 ? ` and reached level ${profile.player.level}` : ""}.
            </p>
          </MomentItem>
          <MomentItem className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <RewardTotal kind="gold" value={r.gold + r.salvageGold} delay={300} onStart={() => c.rewardCue("tick")} />
            {r.essence > 0 && <RewardTotal kind="essence" value={r.essence} delay={360} />}
          </MomentItem>
          <MomentItem className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3">
            <Stat label="Enemies" value={fmt(r.kills)} />
            <Stat label="Cycles" value={fmt(r.cycles)} />
            <Stat label="Experience" value={`+${fmt(r.xp)}`} />
            <Stat label="Stage" value={r.endStage !== r.startStage ? `${r.startStage} to ${r.endStage}` : `${r.endStage}`} />
          </MomentItem>
          {(r.items.length > 0 || shardTotal > 0) && (
            <MomentItem>
              <p className="t-label text-t2 mt-4">
                {r.items.length > 0 && `${r.items.length} piece${r.items.length > 1 ? "s" : ""} of gear kept${r.salvageGold > 0 ? ", the rest salvaged" : ""}`}
                {r.items.length > 0 && shardTotal > 0 && " · "}
                {shardTotal > 0 && <span className="text-jade">{shardTotal} shadow shard{shardTotal > 1 ? "s" : ""}</span>}
              </p>
            </MomentItem>
          )}
          {r.items.length > 0 && (
            <div className="mt-2 shadow-[inset_0_1px_0_var(--line)] short-hide">
              {r.items.slice(0, 2).map((it) => (
                <LootRow key={it.uid} item={it} />
              ))}
            </div>
          )}
          {r.fellBack && (
            <MomentItem>
              <p className="t-label text-t1 mt-3 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-crimson shrink-0" aria-hidden="true" />
                The frontier held you back to stage {r.endStage}.
              </p>
            </MomentItem>
          )}
          <MomentItem className="mt-4">
            {boss ? (
              <Row className="rounded-[14px] bg-[var(--tint-crimson)] shadow-none" leading={<Icon name="skull" size={18} className="text-threat" />} title={`${boss.name} waits at stage ${r.bossWaiting}`} detail="It is never fought without you." data-testid="offline-boss" />
            ) : (
              <Row gutter={false} title={nextMilestone(profile)} detail="Next" data-testid="offline-next" />
            )}
          </MomentItem>
        </div>
      </MomentGroup>
      <div className="mt-5 flex items-center gap-3">
        {ups > 0 && (
          <Button
            variant="plain"
            className="shrink-0 px-4"
            onClick={() => {
              c.dismissOffline();
              c.spendGoldNow();
            }}
            data-testid="offline-upgrade"
          >
            {ups >= 50 ? "50+" : ups} upgrades ready
          </Button>
        )}
        <Button variant="primary" className="flex-1" onClick={() => c.dismissOffline()} data-testid="offline-collect">
          Collect
        </Button>
      </div>
    </Sheet>
  );
}
