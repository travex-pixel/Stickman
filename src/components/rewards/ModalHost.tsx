"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { SummonPortrait } from "@/components/ui/Portrait";
import { useController, useProfileRef, useUi } from "@/hooks/useGame";
import type { Modal } from "@/game/GameController";
import { itemName } from "@/game/GameController";
import { ROLE_INFO, summonDef, WARDEN_SIGILS_REQUIRED } from "@/game/data/summons";
import { JOURNAL } from "@/game/data/lore";
import { WEAPON_PATHS } from "@/game/progression/weaponPaths";
import { fmt, fmtDuration } from "@/lib/format";
import { cn } from "@/lib/cn";
import { SettingsModal } from "@/components/settings/SettingsModal";

export function ModalHost() {
  const modal = useUi((u) => u.modal);
  return (
    <AnimatePresence>
      {modal && modal.kind !== "boss_intro" && modal.kind !== "defeat" && modal.kind !== "stage_clear" && (
        <motion.div key={modal.kind} className="fixed inset-0 z-50 flex items-center justify-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} data-testid={`modal-${modal.kind}`} role="dialog" aria-modal="true">
          {modal.kind !== "summon_reveal" && <div className="scrim" />}
          <ModalBody modal={modal} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ModalBody({ modal }: { modal: Modal }) {
  switch (modal.kind) {
    case "summon_reveal":
      return <SummonReveal modal={modal} />;
    case "perk_choice":
      return <PerkChoice modal={modal} />;
    case "offline":
      return <Offline modal={modal} />;
    case "settings":
      return <SettingsModal />;
    case "weapon_path":
      return <WeaponPathChoice />;
    case "journal":
      return <Journal />;
    default:
      return null;
  }
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div className={cn("modal-card relative w-full max-w-[360px] max-h-[88dvh] overflow-hidden flex flex-col", className)} initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0 }} transition={{ type: "spring", stiffness: 320, damping: 26 }}>
      {children}
    </motion.div>
  );
}

function SummonReveal({ modal }: { modal: Extract<Modal, { kind: "summon_reveal" }> }) {
  const c = useController();
  const def = summonDef(modal.summonId);
  const o = modal.outcome;
  if (!modal.cinematicDone) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-[30%] flex flex-col items-center text-center" data-testid="summon-cinematic">
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 1, 0.7] }} transition={{ duration: modal.first ? 4 : 1.4 }} className="font-display text-[11px] tracking-[0.4em] text-soul">
          {modal.first ? "SOMETHING ANSWERS" : "ESSENCE CLAIMED"}
        </motion.div>
      </div>
    );
  }
  const title = o.kind === "new" ? (modal.first ? "Your first companion has answered." : "A new companion joins you.") : o.kind === "sigil" ? "The Warden resists." : "Kindred essence absorbed.";
  return (
    <Card className="pointer-events-auto">
      <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(60% 50% at 50% 30%, rgba(125,240,200,0.14), transparent)` }} />
      <div className="relative flex flex-col items-center px-5 pt-5 pb-4 gap-2 text-center">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
          <SummonPortrait defId={modal.summonId} size={96} />
        </motion.div>
        <div className={cn("text-[10px] font-bold uppercase tracking-[0.3em]", `rarity-${def.rarity}`)}>{def.rarity} · {ROLE_INFO[def.role].label}</div>
        <div className="font-display text-[22px] text-bone text-glow-cyan leading-none" data-testid="summon-reveal-name">{def.name}</div>
        <div className="text-[11px] italic text-mist">{def.title}</div>
        <p className="text-[12px] text-bone/90 leading-snug">{title}</p>
        {o.kind === "new" && (
          <div className="w-full text-left card p-2 text-[10px] leading-snug">
            <div><span className="text-cyan font-semibold">{def.active.name}</span> — {def.active.description}</div>
            <div className="mt-1"><span className="text-soul font-semibold">{def.passive.name}</span> — {def.passive.description}</div>
          </div>
        )}
        {o.kind === "duplicate" && <div className="text-[11px] text-soul">+{o.essenceGained} Essence · +{o.shardsGained} shard toward evolution</div>}
        {o.kind === "sigil" && (
          <div className="text-[11px] text-gold">
            Warden Sigil {o.sigils}/{WARDEN_SIGILS_REQUIRED}. Break it {WARDEN_SIGILS_REQUIRED - (o.sigils ?? 0)} more time{WARDEN_SIGILS_REQUIRED - (o.sigils ?? 0) === 1 ? "" : "s"} and it will kneel.
          </div>
        )}
        <button className="btn-primary w-full mt-1" onClick={() => c.finishSummonReveal()} data-testid="summon-reveal-continue">
          {o.kind === "new" && modal.first ? "Meet your companion" : "Continue"}
        </button>
      </div>
    </Card>
  );
}

function PerkChoice({ modal }: { modal: Extract<Modal, { kind: "perk_choice" }> }) {
  const c = useController();
  const profile = useProfileRef();
  return (
    <Card>
      <div className="px-4 pt-4 pb-3 text-center">
        <div className="text-[10px] uppercase tracking-[0.3em] text-gold">Ascension</div>
        <div className="font-display text-[18px] text-bone">Level {profile.player.level}</div>
        <p className="text-[11px] text-mist">Choose one. These are permanent.</p>
      </div>
      <div className="flex flex-col gap-2 px-4 pb-4">
        {modal.perks.map((p) => {
          const stacks = profile.player.perks[p.id] ?? 0;
          const tone = p.tone === "power" ? "border-gold/50" : p.tone === "soul" ? "border-soul/50" : "border-cyan/50";
          return (
            <button key={p.id} className={cn("card text-left px-3 py-2 flex items-center justify-between gap-2 active:scale-[0.98]", tone)} onClick={() => c.takePerk(p.id)} data-testid={`perk-${p.id}`}>
              <div>
                <div className="text-[12px] font-bold text-bone">{p.name}</div>
                <div className="text-[10px] text-mist">{p.description}</div>
              </div>
              <div className="text-[9px] text-mist shrink-0">{stacks}/{p.maxStacks}</div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

export function StageClear({ modal }: { modal: Extract<Modal, { kind: "stage_clear" }> }) {
  const c = useController();
  const auto = useProfileRef().settings.autoAdvance;
  const [left, setLeft] = useState(auto ? 6 : -1);
  useEffect(() => {
    if (!auto) return;
    if (left <= 0) {
      c.advanceStage();
      return;
    }
    const t = setTimeout(() => setLeft((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [left, auto, c]);
  return (
    <Card>
      <div className="px-4 pt-3 pb-3 text-center flex flex-col gap-1.5 items-center">
        <div className="text-[10px] uppercase tracking-[0.3em] text-soul">The Warden falls</div>
        <div className="font-display text-[20px] text-bone text-glow-gold leading-none">Stage {modal.stage} cleared</div>
        <div className="flex gap-3 mt-1 text-[12px] font-bold">
          <span className="flex items-center gap-1 text-gold"><Icon name="coin" size={14} />+{fmt(modal.gold)}</span>
          <span className="flex items-center gap-1 text-cyan"><Icon name="xp" size={14} />+{fmt(modal.xp)} XP</span>
          {modal.riftCores > 0 && <span className="flex items-center gap-1 text-violet"><Icon name="core" size={14} />+{modal.riftCores}</span>}
        </div>
        {modal.items.length > 0 && (
          <div className="w-full card p-2 flex flex-col gap-1">
            {modal.items.map((it) => (
              <div key={it.uid} className={cn("text-[11px] font-semibold", `rarity-${it.rarity}`)}>{itemName(it)} <span className="text-mist font-normal">· {it.rarity}</span></div>
            ))}
          </div>
        )}
        <div className="flex gap-2 w-full mt-1">
          <button className="btn-ghost flex-1" onClick={() => { setLeft(-1); c.updateSettings({ autoAdvance: false }); c.replayStage(modal.stage); }} data-testid="replay-stage">Replay</button>
          <button className="btn-primary flex-1" onClick={() => c.advanceStage()} data-testid="advance-stage">
            Stage {modal.nextStage} →{left > 0 ? ` ${left}` : ""}
          </button>
        </div>
        {left > 0 && <div className="text-[9px] text-mist">Advancing automatically. Replay to stay.</div>}
      </div>
    </Card>
  );
}

export function Defeat({ modal }: { modal: Extract<Modal, { kind: "defeat" }> }) {
  const c = useController();
  return (
    <Card>
      <div className="px-4 pt-3 pb-3 text-center flex flex-col gap-1.5 items-center">
        <div className="text-[10px] uppercase tracking-[0.3em] text-crimson">You fell</div>
        <div className="font-display text-[18px] text-bone leading-none">Stage {modal.stage}, wave {Math.max(1, modal.wave)}</div>
        <p className="text-[11px] text-mist leading-snug">Everything you earned is kept. Spend your gold below, then return stronger.</p>
        <div className="flex gap-2 w-full mt-0.5">
          {modal.stage > 1 && <button className="btn-ghost flex-1" onClick={() => c.replayStage(modal.stage - 1)} data-testid="fall-back">Stage {modal.stage - 1}</button>}
          <button className="btn-primary flex-1" onClick={() => c.retry()} data-testid="retry">Try again</button>
        </div>
      </div>
    </Card>
  );
}

function Offline({ modal }: { modal: Extract<Modal, { kind: "offline" }> }) {
  const c = useController();
  const r = modal.reward;
  return (
    <Card>
      <div className="px-5 pt-5 pb-4 text-center flex flex-col gap-2 items-center">
        <div className="text-[10px] uppercase tracking-[0.3em] text-mist">While you were away</div>
        <div className="font-display text-[18px] text-bone">{fmtDuration(r.seconds)}{r.capped ? " (max)" : ""}</div>
        <div className="flex gap-3 text-[13px] font-bold">
          <span className="flex items-center gap-1 text-gold"><Icon name="coin" size={14} />+{fmt(r.gold)}</span>
          {r.essence > 0 && <span className="flex items-center gap-1 text-soul"><Icon name="essence" size={14} />+{fmt(r.essence)}</span>}
        </div>
        <p className="text-[10px] text-mist">Your companions kept the Verge quiet. Rewards are capped at 8 hours.</p>
        <button className="btn-primary w-full" onClick={() => c.dismissOffline()} data-testid="offline-collect">Collect</button>
      </div>
    </Card>
  );
}

function WeaponPathChoice() {
  const c = useController();
  return (
    <Card>
      <div className="px-4 pt-4 pb-3 text-center">
        <div className="text-[10px] uppercase tracking-[0.3em] text-gold">Weapon Awakening</div>
        <div className="font-display text-[18px] text-bone">Choose your path</div>
        <p className="text-[11px] text-mist">This changes how your blade fights. It cannot be undone.</p>
      </div>
      <div className="flex flex-col gap-2 px-4 pb-4">
        {WEAPON_PATHS.map((w) => (
          <button key={w.id} className="card text-left px-3 py-2 active:scale-[0.98]" style={{ borderColor: `${w.color}66` }} onClick={() => c.chooseWeaponPath(w.id)} data-testid={`path-${w.id}`}>
            <div className="flex items-baseline justify-between">
              <span className="font-display text-[14px]" style={{ color: w.color }}>{w.name}</span>
              <span className="text-[9px] uppercase tracking-widest text-mist">{w.tagline}</span>
            </div>
            <div className="text-[10px] text-bone/85 leading-snug mt-0.5">{w.description}</div>
          </button>
        ))}
        <button className="btn-ghost" onClick={() => c.closeModal()}>Not yet</button>
      </div>
    </Card>
  );
}

function Journal() {
  const c = useController();
  const profile = useProfileRef();
  const entries = JOURNAL.filter((j) => profile.progress.journal.includes(j.id));
  return (
    <Card>
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="font-display text-[16px] text-bone">Journal</div>
        <button className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/10" onClick={() => c.closeModal()} aria-label="Close"><Icon name="close" size={14} /></button>
      </div>
      <div className="px-4 pb-4 flex flex-col gap-2 overflow-y-auto" style={{ touchAction: "pan-y" }}>
        {entries.map((j) => (
          <div key={j.id} className="card p-2">
            <div className="text-[11px] font-bold text-cyan">{j.title}</div>
            <div className="text-[11px] text-bone/85 leading-snug mt-0.5">{j.body}</div>
          </div>
        ))}
        <div className="text-[10px] text-mist text-center">{JOURNAL.length - entries.length} entries remain hidden in the Rift.</div>
      </div>
    </Card>
  );
}
