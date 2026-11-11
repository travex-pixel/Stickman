"use client";

import { Button } from "@/components/ui/Button";
import { Row } from "@/components/ui/Row";
import { Sheet } from "@/components/ui/Sheet";
import { CurrencyGlyph } from "@/components/ui/Currency";
import { useController, useHud, useProfileRef } from "@/hooks/useGame";
import { useStore } from "@/lib/store";
import { useShortScreen } from "@/hooks/useShortScreen";
import type { Modal } from "@/game/GameController";
import { ENEMIES } from "@/game/data/enemies";
import { bossForStage, regionForStage } from "@/game/data/regions";
import { TWISTS, depthForStage, romanDepth, twistForStage } from "@/game/data/depths";
import { stageClearCores, stageClearGold } from "@/game/economy/rewards";
import { computeModifiers } from "@/game/progression/stats";
import { TIER_LABEL, readinessTips, type ReadinessTier, type ReadinessTip } from "@/game/progression/readiness";
import { cn } from "@/lib/cn";
import { fmt } from "@/lib/format";

export const TIER_TONE: Record<ReadinessTier, string> = { ready: "text-jade", even: "text-t1", hard: "text-gold", deadly: "text-crimson" };

/** Readiness tips as tappable rows: each closes the sheet on the panel that fixes it. */
export function TipRows({ tips, max }: { tips: ReadinessTip[]; max: number }) {
  const c = useController();
  if (tips.length === 0) return null;
  return (
    <div className="-mx-5 mt-2" data-testid="boss-tips">
      {tips.slice(0, max).map((t) => (
        <Row
          key={t.text}
          className="px-5"
          gutter={false}
          title={<span className="whitespace-normal">{t.text.replace(/\.$/, "")}</span>}
          chevron
          onClick={() => {
            c.closeModal();
            c.setPanel(t.panel);
          }}
        />
      ))}
    </div>
  );
}

/**
 * Boss readiness: who waits, how a fight would likely go, and what would help. Farming keeps
 * running behind it; the boss is only fought from "Fight".
 */
export function BossReadySheet({ modal, open }: { modal: Extract<Modal, { kind: "boss_ready" }>; open: boolean }) {
  const c = useController();
  // useProfileRef re-renders on every commit, so tips and numbers follow upgrades made below.
  const profile = useProfileRef();
  const fc = useStore(c.forecastStore, (s) => s);
  const alive = useHud((s) => s?.player.alive ?? true);
  const boss = ENEMIES[bossForStage(modal.stage)];
  const tips = readinessTips(profile, modal.stage);
  const forecast = fc?.stage === modal.stage ? fc.forecast : null;
  const running = !!fc?.running;
  const gold = stageClearGold(modal.stage, computeModifiers(profile).goldFind);
  const cores = stageClearCores(modal.stage, true, true);
  const twistId = twistForStage(modal.stage);
  const twist = twistId ? TWISTS[twistId] : null;
  const depth = depthForStage(modal.stage);
  const fights = forecast?.fights ?? 4;
  const short = useShortScreen();
  return (
    <Sheet open={open} onDismiss={() => c.closeModal()} testId="modal-boss_ready" labelledBy="boss-ready-title">
      <div data-testid="boss-ready">
        <span className="t-eyebrow text-crimson">Boss · Stage {modal.stage}</span>
        <h2 id="boss-ready-title" className="t-display text-t1 mt-1.5">
          {boss?.name ?? "The Warden"}
        </h2>
        <p className="t-label text-t2 mt-1 flex flex-wrap items-center gap-x-1.5">
          <span>Clears the way to stage {modal.stage + 1}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5 tnum">
            <CurrencyGlyph kind="gold" size={6} />
            {fmt(gold)}
          </span>
          {cores > 0 && (
            <span className="inline-flex items-center gap-1.5 tnum">
              <CurrencyGlyph kind="core" size={6} />
              {cores} Rift Core{cores > 1 ? "s" : ""}
            </span>
          )}
          <span className="sr-only">
            {regionForStage(modal.stage).name}
            {depth > 1 ? `, depth ${romanDepth(depth)}` : ""}
          </span>
        </p>

        <div className="mt-5 flex items-end justify-between gap-3">
          <span className="flex items-baseline gap-1.5">
            <span className="t-num-serif-xl text-t1">{forecast ? forecast.wins : "–"}</span>
            <span className="t-num-m text-t2">of {fights}</span>
          </span>
          <span className={cn("text-[14px] leading-[18px] font-semibold", forecast ? TIER_TONE[forecast.tier] : "text-t2")} data-testid="boss-readiness">
            {forecast ? TIER_LABEL[forecast.tier] : running ? "Reading the fight…" : "–"}
          </span>
        </div>
        <p className="t-label text-t2 mt-1" data-testid="boss-forecast">
          {forecast ? (
            <>
              Forecast fights won on auto.
              {forecast.wins < forecast.fights && forecast.avgBossHpLeft > 0 && <> Losses left it at {Math.round(forecast.avgBossHpLeft * 100)}%.</>}
              {running && " Updating."}
            </>
          ) : (
            "Simulating the fight with your current build."
          )}
        </p>
        <div className="mt-3 flex gap-1" aria-hidden="true">
          {Array.from({ length: fights }, (_, i) => (
            <span key={i} className={cn("h-[3px] flex-1 rounded-full", forecast && i < forecast.wins ? (forecast.tier === "ready" ? "bg-jade" : "bg-t1") : "bg-bg-3")} />
          ))}
        </div>

        {/* A short phone keeps Fight on screen: one tip, the rest wait in the panels. */}
        <TipRows tips={tips} max={short ? 1 : 3} />
        {twist && (
          <div className="-mx-5" data-testid="boss-twist">
            <Row className="px-5" gutter={false} title={<span className="whitespace-normal">{twist.name}</span>} detail={<span className="whitespace-normal">{`${twist.blurb} ${twist.counter}`}</span>} />
          </div>
        )}
        {boss?.counter && <p className="t-flavour text-t2 mt-4">{boss.counter}</p>}

        <div className="mt-5 flex items-center gap-3">
          <Button variant="plain" className="shrink-0 px-4" onClick={() => c.closeModal()} data-testid="boss-later">
            Keep farming
          </Button>
          <Button variant="threat" className="flex-1" onClick={() => c.challengeBoss()} disabled={!alive} data-guide="boss-fight" data-testid="boss-fight">
            {alive ? "Fight" : "Regrouping…"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
