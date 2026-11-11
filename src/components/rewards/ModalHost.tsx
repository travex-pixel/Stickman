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
import { MODES, huntableStages, isKeyedMode } from "@/game/data/modes";
import { WEAPON_PATHS } from "@/game/progression/weaponPaths";
import { fmt, fmtDuration } from "@/lib/format";
import { bossForStage, isBossStage } from "@/game/data/regions";
import { affordableUpgrades } from "@/game/progression/readiness";
import { nextMilestone } from "@/game/progression/milestones";
import { AETHER_GOLD, AETHER_POWER, ASCEND_MIN_STAGE, aetherFor, canAscend, romanAscension } from "@/game/progression/ascension";
import { DAILY_BONUS, objectiveDef, objectivePayout } from "@/game/progression/objectives";
import { cn } from "@/lib/cn";
import { SettingsModal } from "@/components/settings/SettingsModal";
import { CountUp, LootCard } from "@/components/rewards/RewardFx";
import { ABILITIES, TECHNIQUE_OWNED_ATTACK } from "@/game/data/abilities";
import { ABILITY_ICON } from "@/components/ui/abilityIcons";
import { isBattlefieldModal } from "@/components/rewards/BossCards";

export function ModalHost() {
  const modal = useUi((u) => u.modal);
  return (
    <AnimatePresence>
      {modal && modal.kind !== "boss_intro" && !isBattlefieldModal(modal.kind) && (
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
    case "objectives":
      return <Objectives />;
    case "ascend":
      return <AscendSheet />;
    case "hunt_pick":
      return <HuntPick />;
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
      {profile.player.pendingPerkChoices > 2 && (
        <div className="px-4 pb-3 -mt-2">
          <button className="btn-ghost w-full !py-1.5 text-[11px]" onClick={() => c.autoPickPerks()} data-testid="perk-auto">
            Choose all {profile.player.pendingPerkChoices} for me
          </button>
        </div>
      )}
    </Card>
  );
}

function Offline({ modal }: { modal: Extract<Modal, { kind: "offline" }> }) {
  const c = useController();
  const profile = useProfileRef();
  const r = modal.summary;
  const ups = affordableUpgrades(profile);
  const shardTotal = Object.values(r.shards).reduce((a, b) => a + b, 0);
  const boss = r.bossWaiting ? ENEMIES[bossForStage(r.bossWaiting)] : undefined;
  const stats: [string, React.ReactNode, string][] = [
    ["Enemies", fmt(r.kills), "text-ivory"],
    ["Cycles", fmt(r.cycles), "text-ivory"],
    ["XP", `+${fmt(r.xp)}`, "text-gold-2"],
    ["Stage", r.endStage !== r.startStage ? `${r.startStage}→${r.endStage}` : `${r.endStage}`, r.stagesCleared.length ? "text-jade-2" : "text-ivory"],
  ];
  return (
    <Card>
      <div className="px-4 pt-4 pb-3 text-center flex flex-col gap-2 items-stretch short-tight" data-testid="offline-summary">
        <div>
          <div className="caps">While you were away</div>
          <div className="font-display text-[19px] text-ivory leading-tight">{fmtDuration(r.seconds)}{r.capped ? " (max)" : ""}</div>
          <div className="text-[10px] text-mist">Your warrior fought for {fmtDuration(Math.round(r.foughtSeconds))} of it{modal.levels > 0 ? ` and reached level ${profile.player.level}` : ""}.</div>
        </div>
        <div className="flex justify-center gap-4 text-[15px] font-bold">
          <span className="flex items-center gap-1 text-gold">
            <Icon name="coin" size={15} />
            <CountUp prefix="+" value={r.gold + r.salvageGold} delay={250} duration={1100} onTick={() => c.rewardCue("tick")} />
          </span>
          {r.essence > 0 && (
            <span className="flex items-center gap-1 text-jade-2">
              <Icon name="essence" size={15} />
              <CountUp prefix="+" value={r.essence} delay={400} duration={900} />
            </span>
          )}
        </div>
        <div className="grid grid-cols-4 gap-1">
          {stats.map(([k, v, tone]) => (
            <div key={k} className="rounded-md bg-white/[0.04] border border-white/8 py-1 leading-none">
              <div className="text-[9px] uppercase tracking-[0.1em] text-mist">{k}</div>
              <div className={cn("text-[13px] font-bold mt-0.5 tabular-nums", tone)}>{v}</div>
            </div>
          ))}
        </div>
        {(r.items.length > 0 || shardTotal > 0) && (
          <div className="text-[11px] text-parch">
            {r.items.length > 0 && <span>{r.items.length} piece{r.items.length > 1 ? "s" : ""} of gear kept{r.salvageGold > 0 ? `, the rest salvaged` : ""}</span>}
            {r.items.length > 0 && shardTotal > 0 && " · "}
            {shardTotal > 0 && <span className="text-jade-2">{shardTotal} shadow shard{shardTotal > 1 ? "s" : ""}</span>}
          </div>
        )}
        {r.items.length > 0 && (
          <div className="w-full flex flex-col gap-1 short-hide" style={{ perspective: 600 }}>
            {r.items.slice(0, 2).map((it, k) => (
              <LootCard key={it.uid} item={it} index={k} baseDelay={0.7} onReveal={(rare) => c.rewardCue(rare ? "rare" : "card")} />
            ))}
          </div>
        )}
        {r.fellBack && <div className="text-[10px] text-crimson-2">Your warrior could not hold the frontier and stepped back to stage {r.endStage}.</div>}
        {!boss && (
          <div className="text-[11px] text-parch" data-testid="offline-next">
            <span className="caps !text-[9px] mr-1.5">Next</span>
            {nextMilestone(profile)}
          </div>
        )}
        {boss && (
          <div className="flex items-center gap-2 rounded-lg border border-crimson/50 bg-crimson/10 px-2 py-1.5 text-left" data-testid="offline-boss">
            <Icon name="skull" size={14} className="text-crimson-2 shrink-0" />
            <span className="text-[11px] text-parch leading-snug">
              <b className="text-ivory">{boss.name}</b> still waits at stage {r.bossWaiting}. It is never fought without you.
            </span>
          </div>
        )}
        <div className="flex gap-2 mt-0.5">
          {ups > 0 && (
            <button
              className="btn-ghost flex-1 !py-2 text-[12px]"
              onClick={() => {
                c.dismissOffline();
                c.spendGoldNow();
              }}
              data-testid="offline-upgrade"
            >
              {ups >= 50 ? "50+" : ups} upgrades ready
            </button>
          )}
          <button className="btn-primary flex-1 !py-2" onClick={() => c.dismissOffline()} data-testid="offline-collect">
            Collect
          </button>
        </div>
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

function Objectives() {
  const c = useController();
  const profile = useProfileRef();
  const o = profile.objectives;
  const allDaily = o.daily.length > 0 && o.daily.every((s) => s.claimed);
  const row = (st: { id: string; progress: number; claimed: boolean }) => {
    const def = objectiveDef(st.id);
    if (!def) return null;
    const pay = objectivePayout(profile, def);
    const done = st.progress >= def.target;
    return (
      <div key={st.id} className={cn("rounded-lg border px-2.5 py-1.5 flex items-center gap-2", st.claimed ? "border-white/8 opacity-60" : done ? "border-gold/60 bg-gold/10" : "border-white/10 bg-white/[0.03]")} data-testid={`objective-${st.id}`}>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-ivory truncate">{def.text}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <div className="bar bar-gold flex-1 !h-1.5">
              <div style={{ width: `${Math.min(100, (st.progress / def.target) * 100)}%` }} />
            </div>
            <span className="text-[10px] text-mist tabular-nums shrink-0">
              {fmt(Math.min(st.progress, def.target))}/{fmt(def.target)}
            </span>
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-0.5 text-[10px] font-bold leading-none">
          {pay.gold > 0 && <span className="flex items-center gap-0.5 text-gold-2"><Icon name="coin" size={10} />{fmt(pay.gold)}</span>}
          {pay.essence > 0 && <span className="flex items-center gap-0.5 text-jade-2"><Icon name="essence" size={10} />{pay.essence}</span>}
          {pay.cores > 0 && <span className="flex items-center gap-0.5 text-parch"><Icon name="core" size={10} />{pay.cores}</span>}
        </div>
        <button
          className={cn("shrink-0 h-8 min-w-[58px] rounded-md text-[11px] font-extrabold", st.claimed ? "text-mist" : done ? "btn-primary !py-0 !px-2 !text-[12px]" : "border border-white/10 text-mist")}
          disabled={!done || st.claimed}
          onClick={() => c.claimObjective(st.id)}
          data-testid={`claim-${st.id}`}
        >
          {st.claimed ? "Done" : done ? "Claim" : "…"}
        </button>
      </div>
    );
  };
  return (
    <Card>
      <div className="px-3 pt-3 pb-3 flex flex-col gap-1.5" data-testid="objectives">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-[17px] text-ivory">Objectives</span>
          <span className="text-[10px] text-mist">Optional. Missing a day costs nothing.</span>
        </div>
        <div className="caps">Today</div>
        {o.daily.map(row)}
        <div className={cn("text-[10px] text-center", allDaily ? "text-jade-2" : "text-mist")}>{allDaily ? `All three done: +${DAILY_BONUS.cores} Rift Core received` : `Finish all three today for +${DAILY_BONUS.cores} Rift Core`}</div>
        <div className="caps mt-1">This week</div>
        {o.weekly.map(row)}
        <button className="btn-ghost w-full mt-1 !py-2" onClick={() => c.closeModal()} data-testid="objectives-close">
          Close
        </button>
      </div>
    </Card>
  );
}

function AscendSheet() {
  const c = useController();
  const profile = useProfileRef();
  const a = profile.ascension;
  const can = canAscend(profile);
  const gain = aetherFor(profile.progress.bestStage);
  const after = a.aether + gain;
  const pct = (n: number) => Math.round(n * AETHER_POWER * 100);
  return (
    <Card>
      <div className="px-4 pt-4 pb-3 flex flex-col gap-2" data-testid="ascend-sheet">
        <div className="text-center">
          <div className="caps text-gold-2">{a.count > 0 ? `Ascension ${romanAscension(a.count)}` : "Ascension"}</div>
          <div className="font-display text-[20px] text-ivory leading-tight">Begin the climb anew</div>
          <p className="text-[11px] text-mist leading-snug mt-1">The Rift lets the worthy start again, stronger. Each point of Aether is +{Math.round(AETHER_POWER * 100)}% Attack and Health and +{Math.round(AETHER_GOLD * 100)}% gold, forever.</p>
        </div>
        <div className="grid grid-cols-3 gap-1 text-center">
          {[
            ["Aether now", `${a.aether}`],
            ["This ascension", can ? `+${gain}` : "–"],
            ["Power after", `+${pct(can ? after : a.aether)}%`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-md bg-white/[0.04] border border-white/8 py-1.5 leading-none">
              <div className="text-[9px] uppercase tracking-[0.1em] text-mist">{k}</div>
              <div className="text-[15px] font-bold text-gold-2 mt-1 tabular-nums">{v}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 text-[11px] leading-snug">
          <div className="rounded-md border border-crimson/40 bg-crimson/5 px-2 py-1.5">
            <div className="caps !text-[9px] !text-crimson-2 mb-0.5">Starts over</div>
            <div className="text-parch">Campaign stage, gold, stat levels</div>
          </div>
          <div className="rounded-md border border-jade/40 bg-jade/5 px-2 py-1.5">
            <div className="caps !text-[9px] !text-jade-2 mb-0.5">You keep</div>
            <div className="text-parch">Shadows, gear, level, skills, techniques, perks, rank, Codex</div>
          </div>
        </div>
        {!can && <p className="text-[11px] text-mist text-center">Reach stage {ASCEND_MIN_STAGE} to ascend. Deeper stages grant more Aether.</p>}
        <div className="flex gap-2 mt-1">
          <button className="btn-ghost flex-1 !py-2" onClick={() => c.closeModal()} data-testid="ascend-later">
            Not yet
          </button>
          <HoldConfirm disabled={!can} onConfirm={() => c.confirmAscend()} label={`Hold to ascend (+${gain})`} />
        </div>
      </div>
    </Card>
  );
}

/** A deliberate action: hold for a moment to confirm, release to cancel. */
function HoldConfirm({ disabled, onConfirm, label }: { disabled: boolean; onConfirm: () => void; label: string }) {
  const [t0, setT0] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  const HOLD_MS = 900;
  useEffect(() => {
    if (t0 === null) return;
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / HOLD_MS);
      setProgress(p);
      if (p >= 1) {
        setT0(null);
        setProgress(0);
        onConfirm();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [t0, onConfirm]);
  const stop = () => {
    setT0(null);
    setProgress(0);
  };
  return (
    <button
      className="btn-primary flex-[1.4] !py-2 relative overflow-hidden"
      disabled={disabled}
      onPointerDown={() => !disabled && setT0(performance.now())}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      data-testid="ascend-confirm"
    >
      <span className="absolute inset-y-0 left-0 bg-white/30" style={{ width: `${progress * 100}%` }} />
      <span className="relative">{label}</span>
    </button>
  );
}

function HuntPick() {
  const c = useController();
  const profile = useProfileRef();
  const stages = huntableStages(profile.progress.bestStage, isBossStage);
  const keys = profile.modes.keys.hunt;
  return (
    <Card>
      <div className="px-3 pt-3 pb-3 flex flex-col gap-1.5" data-testid="hunt-pick">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-[17px] text-ivory">Boss Hunt</span>
          <span className="text-[11px] text-mist">{keys}/3 today</span>
        </div>
        <p className="text-[11px] text-mist leading-snug">Rematch a boss you have beaten: half its stage reward, boss gear, a chance at a Rift Core, and another chance to bind its shadow. Progress is never at stake.</p>
        {stages.map((s) => {
          const def = ENEMIES[bossForStage(s)];
          return (
            <button key={s} className="card flex items-center gap-2 px-2 py-1.5 text-left disabled:opacity-50" disabled={keys <= 0} onClick={() => c.startHunt(s)} data-testid={`hunt-${s}`}>
              <span className="h-8 w-8 shrink-0 rounded-md overflow-hidden border border-crimson/40 bg-black/30">
                <SummonPortrait defId={bossForStage(s)} size={32} enemy />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-[12px] font-semibold text-ivory truncate">{def?.name ?? "Boss"}</span>
                <span className="block text-[10px] text-mist">Stage {s}</span>
              </span>
              <span className="font-display text-[12px] text-crimson-2 shrink-0">Hunt</span>
            </button>
          );
        })}
        <button className="btn-ghost w-full mt-1 !py-2" onClick={() => c.closeModal()} data-testid="hunt-close">
          Close
        </button>
      </div>
    </Card>
  );
}
