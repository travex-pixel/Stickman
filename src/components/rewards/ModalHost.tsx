"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { SummonPortrait } from "@/components/ui/Portrait";
import { useController, useProfileRef, useUi } from "@/hooks/useGame";
import type { Modal } from "@/game/GameController";
import { ROLE_INFO, summonDef, type SummonDef } from "@/game/data/summons";
import { STAT_LABEL } from "@/game/data/equipment";
import { ACHIEVEMENTS, JOURNAL } from "@/game/data/lore";
import { ENEMIES } from "@/game/data/enemies";
import { RANKS } from "@/game/progression/ranks";
import { MODES, isKeyedMode } from "@/game/data/modes";
import { isBossStage } from "@/game/data/regions";
import { WEAPON_PATHS } from "@/game/progression/weaponPaths";
import { fmtDuration } from "@/lib/format";
import { cn } from "@/lib/cn";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { CountUp, LootCard } from "@/components/rewards/RewardFx";
import { ABILITIES, TECHNIQUE_OWNED_ATTACK } from "@/game/data/abilities";
import { ABILITY_ICON } from "@/components/ui/abilityIcons";

export function ModalHost() {
  const modal = useUi((u) => u.modal);
  return (
    <AnimatePresence>
      {modal && modal.kind !== "boss_intro" && modal.kind !== "defeat" && modal.kind !== "stage_clear" && modal.kind !== "mode_result" && (
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
    case "rank_up":
      return <RankUp modal={modal} />;
    case "technique":
      return <TechniqueLearned modal={modal} />;
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
      <div className="pointer-events-none absolute inset-x-0 top-[24%] flex flex-col items-center text-center" data-testid="summon-cinematic">
        <motion.div
          initial={{ opacity: 0, scale: 1.6, letterSpacing: "0.8em" }}
          animate={{ opacity: [0, 0, 1, 1], scale: [1.6, 1.6, 1, 1], letterSpacing: ["0.8em", "0.8em", "0.32em", "0.32em"] }}
          transition={{ duration: modal.first ? 3.2 : 0.9, times: [0, modal.first ? 0.55 : 0.1, modal.first ? 0.75 : 0.5, 1], ease: "easeOut" }}
          className="font-display text-[30px] text-gold-2"
          style={{ textShadow: "0 0 26px rgba(233,201,122,0.7), 0 2px 0 rgba(0,0,0,0.6)" }}
        >
          OATHBOUND
        </motion.div>
      </div>
    );
  }
  const title = o.kind === "new" ? (modal.first ? "Your first oath is sworn." : "A new Oathbound joins your army.") : "Kindred oath absorbed.";
  return (
    <Card className="pointer-events-auto">
      <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(60% 50% at 50% 30%, rgba(125,240,200,0.14), transparent)` }} />
      <div className="relative flex flex-col items-center px-5 pt-5 pb-4 gap-2 text-center">
        <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }}>
          <SummonPortrait defId={modal.summonId} size={96} />
        </motion.div>
        <div className={cn("text-[10px] font-bold uppercase tracking-[0.3em]", `rarity-${def.rarity}`)}>{def.rarity} · {ROLE_INFO[def.role].label}</div>
        <div className="font-display text-[22px] text-ivory text-glow-gold leading-none" data-testid="summon-reveal-name">{def.name}</div>
        <div className="text-[11px] italic text-mist">{def.title}</div>
        <p className="text-[12px] text-ivory/90 leading-snug">{title}</p>
        {o.kind === "new" && (
          <div className="text-[11px] text-gold-2 font-semibold" data-testid="codex-gain">
            Codex: +{fmtCodex(def.owned)} permanently
          </div>
        )}
        {o.kind === "new" && (
          <div className="w-full text-left card p-2 text-[10px] leading-snug">
            <div><span className="text-gold-2 font-semibold">{def.active.name}</span> — {def.active.description}</div>
            <div className="mt-1"><span className="text-jade-2 font-semibold">{def.passive.name}</span> — {def.passive.description}</div>
          </div>
        )}
        {o.kind === "duplicate" && <div className="text-[11px] text-jade-2">+{o.essenceGained} Essence · +{o.shardsGained} shard toward evolution</div>}
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
        <div className="caps text-gold-2">Ascension</div>
        <div className="font-display text-[18px] text-ivory">Level {profile.player.level}</div>
        <p className="text-[11px] text-mist">Choose one. These are permanent.</p>
      </div>
      <div className="flex flex-col gap-2 px-4 pb-4">
        {modal.perks.map((p) => {
          const stacks = profile.player.perks[p.id] ?? 0;
          const tone = p.tone === "power" ? "border-gold/50" : p.tone === "soul" ? "border-soul/50" : "border-gold/50";
          return (
            <button key={p.id} className={cn("card text-left px-3 py-2 flex items-center justify-between gap-2 active:scale-[0.98]", tone)} onClick={() => c.takePerk(p.id)} data-testid={`perk-${p.id}`}>
              <div>
                <div className="text-[12px] font-bold text-ivory">{p.name}</div>
                <div className="text-[10px] text-mist">{p.description}</div>
              </div>
              <div className="text-[10px] text-mist shrink-0">{stacks}/{p.maxStacks}</div>
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
  const [left, setLeft] = useState(auto ? 6 + Math.min(3, modal.items.length) : -1);
  const shortShown = modal.upgrades > 0 ? 1 : 2;
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
      <div className="px-4 pt-3 pb-3 text-center flex flex-col gap-1.5 items-center short-tight">
        <div className="caps text-jade-2">{isBossStage(modal.stage) ? "The Warden falls" : "The champion falls"}</div>
        <div className="font-display text-[20px] text-ivory text-glow-gold leading-none">Stage {modal.stage} cleared</div>
        <div className="flex gap-3 mt-1 text-[13px] font-bold">
          <motion.span initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-1 text-gold" data-testid="clear-gold">
            <Icon name="coin" size={14} /><CountUp prefix="+" value={modal.gold + (modal.runGold ?? 0)} delay={120} onTick={() => c.rewardCue("tick")} />
          </motion.span>
          <motion.span initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }} className="flex items-center gap-1 text-gold-2">
            <Icon name="xp" size={14} /><CountUp prefix="+" value={modal.xp} delay={240} /> XP
          </motion.span>
          {modal.riftCores > 0 && (
            <motion.span initial={{ opacity: 0, scale: 1.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.45, type: "spring", stiffness: 300, damping: 14 }} className="flex items-center gap-1 text-parch">
              <Icon name="core" size={14} className="text-gold-2" />+{modal.riftCores}
            </motion.span>
          )}
        </div>
        {modal.items.length > 0 && (
          <div className="w-full flex flex-col gap-1" style={{ perspective: 600 }}>
            {modal.items.slice(0, 3).map((it, i) => (
              <LootCard key={it.uid} item={it} index={i} className={i >= shortShown ? "short-hide" : undefined} onReveal={(rare) => c.rewardCue(rare ? "rare" : "card")} />
            ))}
            {modal.items.length > 3 && <div className="text-[10px] text-mist short-hide">and {modal.items.length - 3} more in your satchel</div>}
            {modal.items.length > shortShown && <div className="text-[10px] text-mist short-only">and {modal.items.length - shortShown} more in your satchel</div>}
          </div>
        )}
        {modal.upgrades > 0 && (
          <button
            className="w-full flex items-center justify-between gap-2 rounded-lg border border-gold/60 bg-gold/10 px-3 h-9"
            onClick={() => {
              setLeft(-1);
              c.spendGoldNow();
            }}
            data-testid="spend-gold"
          >
            <span className="text-[12px] text-parch">
              <b className="text-gold-2">{modal.upgrades >= 50 ? "50+" : modal.upgrades}</b> upgrade{modal.upgrades === 1 ? "" : "s"} ready
            </span>
            <span className="font-display text-[13px] text-gold-2 flex items-center gap-1">
              Spend gold <Icon name="chevron" size={12} />
            </span>
          </button>
        )}
        <div className="flex gap-2 w-full mt-1">
          <button className="btn-ghost flex-1" onClick={() => { setLeft(-1); c.updateSettings({ autoAdvance: false }); c.replayStage(modal.stage); }} data-testid="replay-stage">Replay</button>
          <button className="btn-primary flex-1" onClick={() => c.advanceStage()} data-testid="advance-stage">
            Stage {modal.nextStage} →{left > 0 && <span className="ml-1.5 inline-block rounded-full bg-black/25 px-1.5 text-[11px] font-sans font-bold tabular-nums align-middle">{left}s</span>}
          </button>
        </div>
        {left > 0 && <div className="text-[10px] text-mist short-hide">Advancing automatically. Replay to stay.</div>}
      </div>
    </Card>
  );
}

export function Defeat({ modal }: { modal: Extract<Modal, { kind: "defeat" }> }) {
  const c = useController();
  return (
    <Card>
      <div className="px-4 pt-3 pb-3 text-center flex flex-col gap-1.5 items-center">
        <div className="caps text-crimson-2">You fell</div>
        <div className="font-display text-[18px] text-ivory leading-none">Stage {modal.stage}, wave {Math.max(1, modal.wave)}</div>
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
        <div className="caps">While you were away</div>
        <div className="font-display text-[18px] text-ivory">{fmtDuration(r.seconds)}{r.capped ? " (max)" : ""}</div>
        <div className="flex gap-3 text-[13px] font-bold">
          <span className="flex items-center gap-1 text-gold"><Icon name="coin" size={14} /><CountUp prefix="+" value={r.gold} delay={250} duration={1100} onTick={() => c.rewardCue("tick")} /></span>
          {r.essence > 0 && <span className="flex items-center gap-1 text-jade-2"><Icon name="essence" size={14} /><CountUp prefix="+" value={r.essence} delay={400} duration={900} /></span>}
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
        <div className="caps text-gold-2">Weapon Awakening</div>
        <div className="font-display text-[18px] text-ivory">Choose your path</div>
        <p className="text-[11px] text-mist">This changes how your blade fights. It cannot be undone.</p>
      </div>
      <div className="flex flex-col gap-2 px-4 pb-4">
        {WEAPON_PATHS.map((w) => (
          <button key={w.id} className="card text-left px-3 py-2 active:scale-[0.98]" style={{ borderColor: `${w.color}66` }} onClick={() => c.chooseWeaponPath(w.id)} data-testid={`path-${w.id}`}>
            <div className="flex items-baseline justify-between">
              <span className="font-display text-[14px]" style={{ color: w.color }}>{w.name}</span>
              <span className="text-[10px] uppercase tracking-widest text-mist">{w.tagline}</span>
            </div>
            <div className="text-[10px] text-ivory/85 leading-snug mt-0.5">{w.description}</div>
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
  const [tab, setTab] = useState<"lore" | "bestiary" | "feats">("lore");
  const entries = JOURNAL.filter((j) => profile.progress.journal.includes(j.id));
  const seen = Object.keys(profile.progress.killsByEnemy);
  return (
    <Card>
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div className="font-display text-[18px] text-ivory">Journal</div>
        <button className="h-8 w-8 flex items-center justify-center rounded-lg border border-white/10" onClick={() => c.closeModal()} aria-label="Close"><Icon name="close" size={14} /></button>
      </div>
      <div className="px-4 flex gap-1">
        {(["lore", "bestiary", "feats"] as const).map((t) => (
          <button key={t} className={cn("px-2.5 py-1 rounded-md text-[11px] font-bold border", tab === t ? "border-gold/60 text-gold-2 bg-gold/10" : "border-white/10 text-mist")} onClick={() => setTab(t)} data-testid={`journal-${t}`}>
            {t === "lore" ? "Lore" : t === "bestiary" ? "Bestiary" : "Feats"}
          </button>
        ))}
      </div>
      <div className="px-4 py-3 flex flex-col gap-2 overflow-y-auto max-h-[60dvh]" style={{ touchAction: "pan-y" }}>
        {tab === "lore" && (
          <>
            {entries.map((j) => (
              <div key={j.id} className="card p-2.5">
                <div className="font-display text-[13px] text-gold-2">{j.title}</div>
                <div className="text-[11px] text-ivory/85 leading-snug mt-0.5">{j.body}</div>
              </div>
            ))}
            <div className="text-[10px] text-mist text-center">{JOURNAL.length - entries.length} entries remain hidden in the Rift.</div>
          </>
        )}
        {tab === "bestiary" &&
          Object.values(ENEMIES).map((e) => {
            const known = seen.includes(e.id);
            return (
              <div key={e.id} className={cn("card p-2 flex gap-2 items-center", !known && "opacity-50")}>
                <SummonPortrait defId={e.id} size={40} enemy />
                <div className="min-w-0">
                  <div className="text-[12px] font-bold text-ivory">{known ? e.name : "Unknown"}</div>
                  <div className="text-[10px] text-mist leading-snug line-clamp-2">{known ? e.lore : "Defeat it to learn more."}</div>
                  {known && e.counter && <div className="text-[10px] text-parch/90 leading-snug mt-0.5">{e.counter}</div>}
                  {known && <div className="text-[10px] text-gold mt-0.5">Slain {profile.progress.killsByEnemy[e.id] ?? 0}{e.essenceSummonId ? " · leaves a shadow" : ""}</div>}
                </div>
              </div>
            );
          })}
        {tab === "feats" &&
          ACHIEVEMENTS.map((a) => {
            const done = profile.progress.achievements.includes(a.id);
            return (
              <div key={a.id} className={cn("card p-2 flex items-center gap-2", done ? "card-active" : "opacity-70")}>
                <Icon name={done ? "star" : "lock"} size={14} className={done ? "text-gold-2" : "text-mist"} />
                <div>
                  <div className="text-[12px] font-bold text-ivory">{a.name}</div>
                  <div className="text-[10px] text-mist">{a.description}</div>
                </div>
              </div>
            );
          })}
      </div>
    </Card>
  );
}

export function fmtCodex(o: SummonDef["owned"], mult = 1): string {
  const pct = o.pct * mult * 100;
  return `${pct < 10 && pct % 1 !== 0 ? pct.toFixed(1) : Math.round(pct)}% ${STAT_LABEL[o.stat]}`;
}

function RankUp({ modal }: { modal: Extract<Modal, { kind: "rank_up" }> }) {
  const c = useController();
  return (
    <Card>
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(60% 45% at 50% 32%, rgba(233,201,122,0.22), transparent)" }} />
      <div className="relative px-5 pt-6 pb-4 flex flex-col items-center gap-2 text-center" data-testid="rank-up">
        <div className="caps text-gold-2">Ascendant rank</div>
        <div className="relative h-[110px] w-[110px] flex items-center justify-center">
          <motion.span className="absolute font-display text-[76px] text-mist" initial={{ opacity: 1, scale: 1 }} animate={{ opacity: 0, scale: 0.6, y: 20 }} transition={{ duration: 0.6, delay: 0.3 }}>
            {RANKS[modal.from]}
          </motion.span>
          <motion.span
            className="absolute font-display text-[92px] text-gold-2"
            style={{ textShadow: "0 0 28px rgba(233,201,122,0.6), 0 3px 0 rgba(0,0,0,0.6)" }}
            initial={{ opacity: 0, scale: 1.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.55, delay: 0.75, type: "spring", stiffness: 220, damping: 14 }}
          >
            {RANKS[modal.to]}
          </motion.span>
        </div>
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="font-display text-[20px] text-ivory">
          {modal.to >= 5 ? "S rank. There is nothing above you now." : "You have broken through."}
        </motion.div>
        <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }} className="w-full card p-2.5 flex flex-col gap-1 text-left">
          {modal.rewards.map((r) => (
            <li key={r} className="text-[12px] text-ivory flex items-center gap-2">
              <Icon name="check" size={12} className="text-gold-2" />
              {r}
            </li>
          ))}
        </motion.ul>
        <button className="btn-primary w-full mt-1" onClick={() => c.returnToCampaign()} data-testid="rank-up-continue">
          Continue
        </button>
      </div>
    </Card>
  );
}

export function ModeResult({ modal }: { modal: Extract<Modal, { kind: "mode_result" }> }) {
  const c = useController();
  const again = c.modeAvailability(modal.mode);
  const tone = { gold: "text-gold-2", jade: "text-jade-2", violet: "text-parch" } as const;
  return (
    <Card>
      <div className="px-4 pt-3 pb-3 text-center flex flex-col gap-1.5 items-center" data-testid="mode-result">
        <div className={cn("caps", modal.success ? "text-gold-2" : "text-crimson-2")}>{modal.subtitle}</div>
        <div className="font-display text-[20px] text-ivory leading-none">{modal.title}</div>
        {modal.record && <div className="text-[10px] font-bold text-gold-2 tracking-[0.2em]">NEW BEST</div>}
        <div className="w-full grid grid-cols-3 gap-1 mt-1">
          {modal.lines.map((l, i) => (
            <motion.div key={l.label} className="card px-1.5 py-1.5" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + i * 0.12 }}>
              <div className="caps !text-[10px]">{l.label}</div>
              <div className={cn("font-display text-[15px]", l.tone ? tone[l.tone] : "text-ivory")}>{l.value}</div>
            </motion.div>
          ))}
        </div>
        {modal.items && modal.items.length > 0 && (
          <div className="w-full flex flex-col gap-1" style={{ perspective: 600 }}>
            {modal.items.slice(0, 3).map((it, k) => (
              <LootCard key={it.uid} item={it} index={k} className={k >= 2 ? "short-hide" : undefined} onReveal={(rare) => c.rewardCue(rare ? "rare" : "card")} />
            ))}
          </div>
        )}
        <div className="flex gap-2 w-full mt-1">
          <button className="btn-ghost flex-1" onClick={() => c.returnToCampaign()} data-testid="mode-return">
            Campaign
          </button>
          <button className="btn-primary flex-1" disabled={!again.ok} onClick={() => c.startMode(modal.mode)} data-testid="mode-again">
            {again.ok ? `Again${isKeyedMode(modal.mode) ? ` (${c.profile.modes.keys[modal.mode]})` : ""}` : again.reason}
          </button>
        </div>
        <div className="text-[10px] text-mist">{MODES[modal.mode].name}</div>
      </div>
    </Card>
  );
}

function TechniqueLearned({ modal }: { modal: Extract<Modal, { kind: "technique" }> }) {
  const c = useController();
  const def = ABILITIES[modal.id];
  const base = def.slot ? ABILITIES[def.slot] : null;
  return (
    <Card>
      <div className="px-5 pt-5 pb-4 flex flex-col items-center gap-2 text-center" data-testid="technique-learned">
        <div className="caps text-gold-2">Technique learned</div>
        <motion.div initial={{ scale: 0.4, rotate: -30, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 14 }} className="medal medal-lg text-gold-2" data-ready="true" style={{ ["--m" as string]: "52px" }}>
          <Icon name={ABILITY_ICON[modal.id]} size={28} />
        </motion.div>
        <div className="font-display text-[20px] text-ivory leading-none">{def.name}</div>
        <p className="text-[12px] text-parch leading-snug">{def.description}</p>
        <div className="text-[11px] text-gold/90">Owned forever: +{Math.round(TECHNIQUE_OWNED_ATTACK * 100)}% attack, equipped or not.</div>
        {base && <div className="text-[11px] text-mist">It can take the place of {base.name}. Switch any time in Skills, Arts.</div>}
        <div className="flex gap-2 w-full mt-1">
          <button className="btn-ghost flex-1" onClick={() => c.closeModal()} data-testid="technique-later">
            Keep {base?.name ?? "current"}
          </button>
          <button
            className="btn-primary flex-1"
            onClick={() => {
              if (def.slot) c.setArtForm(def.slot, modal.id);
              c.closeModal();
            }}
            data-testid="technique-equip"
          >
            Equip
          </button>
        </div>
      </div>
    </Card>
  );
}
