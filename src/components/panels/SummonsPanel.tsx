"use client";

import { useEffect } from "react";
import { Icon } from "@/components/ui/Icon";
import { HoldButton } from "@/components/ui/HoldButton";
import { SummonPortrait } from "@/components/ui/Portrait";
import { useController, useProfileRef, useUi } from "@/hooks/useGame";
import { collectibleSummons, ROLE_INFO, summonDef } from "@/game/data/summons";
import { codexBonus, codexMultiplier, ownedSpecies, speciesStars } from "@/game/summons/extraction";
import { fmtCodex } from "@/components/rewards/ModalHost";
import { STAT_LABEL } from "@/game/data/equipment";
import { computeModifiers } from "@/game/progression/stats";
import { bondCost, BOND_CAP, canStarUp, checkEvolution, starCost, summonStats } from "@/game/summons/progression";
import { summonXpForLevel, SUMMON_LEVEL_CAP } from "@/game/progression/xp";
import { REFINE_SHARDS, spareShards } from "@/game/summons/progression";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/cn";
import { useShortScreen } from "@/hooks/useShortScreen";

export default function SummonsPanel() {
  const c = useController();
  const profile = useProfileRef();
  const selectedId = useUi((u) => u.selectedSummon);
  const collection = profile.summons.collection;
  const slots = computeModifiers(profile).deploySlots;
  const deployedCount = collection.filter((s) => s.deployed).length;
  const selected = collection.find((s) => s.instanceId === selectedId) ?? collection[0] ?? null;
  const short = useShortScreen();

  useEffect(() => {
    if (!selectedId && collection[0]) c.selectSummon(collection[0].instanceId);
  }, [selectedId, collection, c]);

  if (collection.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-2 px-6 text-center">
        <Icon name="summons" size={28} className="text-gold" />
        <div className="font-display text-[15px] tracking-[0.2em] text-ivory">The Oathbound</div>
        <p className="text-[11px] text-mist leading-snug">Enemies marked with a pale light leave their oath behind when they fall. Tap BIND before it fades and they will fight for you forever.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 px-2 pt-1.5 pb-1.5 gap-1.5">
      <div className="flex items-center justify-between px-1 gap-2">
        <span className="caps whitespace-nowrap">
          Army <span className="text-parch">{ownedSpecies(profile).filter((id) => !summonDef(id).hidden).length}/{collectibleSummons().length}</span>
        </span>
        <span className="text-[10px] text-gold-2 truncate" title="Oath Codex: permanent bonuses from every shadow you have raised">
          {codexSummary(profile)}
        </span>
        <span className="text-[10px] text-mist whitespace-nowrap">
          Deployed <span className="text-jade-2 font-bold" data-testid="deploy-count">{deployedCount}/{slots}</span>
        </span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar shrink-0" style={{ touchAction: "pan-x" }}>
        {collection.map((s) => {
          const def = summonDef(s.defId);
          return (
            <button key={s.instanceId} className={cn("relative shrink-0 rounded-xl border-2 overflow-hidden", selected?.instanceId === s.instanceId ? "border-gold" : `border-rarity-${def.rarity}`)} onClick={() => c.selectSummon(s.instanceId)} data-testid={`summon-card-${s.defId}`} aria-label={def.name}>
              <SummonPortrait defId={s.defId} size={short ? 30 : 40} />
              {s.deployed && <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-soul shadow-[0_0_6px_#7df0c8]" />}
              <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] text-center font-bold text-ivory">Lv {s.level}</span>
            </button>
          );
        })}
      </div>
      {selected && <SummonDetail inst={selected} slots={slots} short={short} />}
    </div>
  );
}

function SummonDetail({ inst, slots, short }: { inst: ReturnType<typeof useProfileRef>["summons"]["collection"][number]; slots: number; short: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const def = summonDef(inst.defId);
  const mods = computeModifiers(profile);
  const stats = summonStats(inst, { damageMult: mods.summonDamageMult, defenseMult: mods.summonDefenseMult, hpMult: mods.summonHpMult });
  const xpNeed = summonXpForLevel(inst.level);
  const evo = checkEvolution(inst, profile.player.riftCores);
  const star = starCost(inst);
  const starReady = canStarUp(inst, profile.player.riftCores);
  const cost = bondCost(inst.bond);
  const canBond = inst.bond < BOND_CAP && profile.player.essence >= cost;
  const deployedCount = profile.summons.collection.filter((s) => s.deployed).length;
  const canDeploy = inst.deployed || deployedCount < slots;
  return (
    <div className="card flex-1 min-h-0 flex flex-col gap-1 px-2 py-1.5" style={{ ["--act-h" as string]: short ? "32px" : "36px" }}>
      <div className="flex gap-2 min-w-0 shrink-0">
        {!short && <SummonPortrait defId={inst.defId} size={46} />}
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 leading-tight">
            <span className="font-display text-[15px] text-ivory truncate">{def.name}</span>
            {spareShards(inst) >= REFINE_SHARDS && (
              <button className="shrink-0 rounded-full border border-gold/50 bg-gold/10 px-1.5 text-[10px] font-bold text-gold-2 leading-[18px]" onClick={() => c.refineShards(inst.instanceId)} data-testid="refine-shards" aria-label={`Refine ${REFINE_SHARDS} spare shards into a Rift Core`}>
                ◆ Refine {REFINE_SHARDS}
              </button>
            )}
            <span className="text-[10px] text-mist shrink-0">
              <span className="text-gold-2 tracking-tight">{"★".repeat(inst.stars ?? 0)}</span> <span className={`rarity-${def.rarity}`}>{ROLE_INFO[def.role].label}</span> · Lv {inst.level}
            </span>
          </div>
          <div className="bar">
            <div style={{ width: `${inst.level >= SUMMON_LEVEL_CAP ? 100 : (inst.xp / xpNeed) * 100}%`, background: "linear-gradient(90deg,#a67d36,#e3c783)" }} />
          </div>
          <div className={cn("grid grid-cols-4 gap-1 text-[10px] text-mist", short && "hidden")}>
            <Mini icon="heart" v={fmt(stats.maxHp)} />
            <Mini icon="sword" v={fmt(stats.attack)} />
            <Mini icon="shield" v={fmt(stats.defense)} />
            <Mini icon="speed" v={stats.attackSpeed.toFixed(1)} />
          </div>
        </div>
      </div>
      <div className="text-[11px] leading-snug text-ivory/85 truncate shrink-0" title={def.active.description}>
        <span className="text-gold-2 font-semibold">{def.active.name}</span> ·{" "}
        <span className="text-gold/90" data-testid="codex-line">
          Codex +{fmtCodex(def.owned, codexMultiplier(speciesStars(profile).get(inst.defId) ?? 0))}
          {(inst.stars ?? 0) < 5 && <span className="text-jade-2"> · ★ next +{fmtCodex(def.owned, codexMultiplier((speciesStars(profile).get(inst.defId) ?? 0) + 1))}</span>}
        </span>
      </div>
        <div className="mt-auto flex items-center gap-1.5">
          <button
            className={cn("h-[var(--act-h)] px-2.5 rounded-lg font-display text-[12px] tracking-[0.08em] border shrink-0", inst.deployed ? "bg-black/40 border-white/15 text-mist" : canDeploy ? "btn-jade" : "bg-black/40 border-white/10 text-mist opacity-60")}
            onClick={() => c.deploySummon(inst.instanceId, !inst.deployed)}
            data-guide={!inst.deployed ? "deploy-summon" : undefined}
            data-testid="deploy-button"
          >
            {inst.deployed ? "Recall" : "Deploy"}
          </button>
          <HoldButton onRepeat={() => c.upgradeBond(inst.instanceId)} disabled={!canBond} className="flex-1 min-w-0 h-[var(--act-h)]" testId="bond-upgrade" label={`Strengthen bond for ${cost} essence`}>
            <span className="flex flex-col items-center leading-none">
              <span className="caps text-gold-2 !text-[10px] whitespace-nowrap">Bond {inst.bond}</span>
              <span className={cn("flex items-center gap-0.5 text-[10px] font-bold", canBond ? "text-jade-2" : "text-crimson-2")}>
                <Icon name="essence" size={10} />
                {inst.bond >= BOND_CAP ? "MAX" : fmt(cost)}
              </span>
            </span>
          </HoldButton>
          <button
            className={cn("h-[var(--act-h)] px-2 rounded-lg border leading-tight shrink-0", star && starReady ? "border-gold/70 bg-gold/10 text-gold-2" : "border-white/10 bg-black/30 text-mist")}
            onClick={() => c.starUp(inst.instanceId)}
            disabled={!star}
            data-testid="star-button"
            aria-label={star ? `Star up for ${star.shards} shards${star.cores ? ` and ${star.cores} Rift Cores` : ""}` : "Max stars"}
          >
            <span className="block font-display text-[11px]">{star ? "★ Star" : "★ Max"}</span>
            {star && (
              <span className="block text-[10px] tabular-nums">
                {starReady ? (
                  <span className="text-jade-2 font-bold">Ready</span>
                ) : (
                  <>
                    {Math.min(inst.shards, star.shards)}/{star.shards}
                    {star.cores ? ` · ${star.cores}◆` : ""}
                  </>
                )}
              </span>
            )}
          </button>
          {def.evolution && (
            <button
              className={cn("h-[var(--act-h)] px-2 rounded-lg border leading-tight shrink-0", evo.possible ? "border-gold/70 bg-gold/15 text-gold-2" : "border-white/10 bg-black/30 text-mist")}
              onClick={() => c.evolve(inst.instanceId)}
              title={evo.reasons.join(", ")}
              data-testid="evolve-button"
            >
              <span className="block font-display text-[11px]">Evolve</span>
              <span className="block text-[10px]">{evo.possible ? "Ready" : `★${def.evolution.requiredStars} · Lv ${def.evolution.requiredLevel}`}</span>
            </button>
          )}
        </div>
    </div>
  );
}

function Mini({ icon, v }: { icon: "heart" | "sword" | "shield" | "speed"; v: string }) {
  return (
    <span className="flex items-center gap-0.5 rounded bg-black/35 px-1 py-0.5">
      <Icon name={icon} size={9} className="text-gold-2" />
      <span className="text-ivory font-semibold tabular-nums">{v}</span>
    </span>
  );
}

function codexSummary(profile: ReturnType<typeof useProfileRef>): string {
  const b = codexBonus(profile);
  const parts = (Object.entries(b) as [keyof typeof b, number][]).filter(([, v]) => v > 0).map(([k, v]) => `+${Math.round(v * 100)}% ${STAT_LABEL[k].replace("Critical ", "Crit ")}`);
  return parts.length ? `Codex ${parts.slice(0, 2).join(" · ")}${parts.length > 2 ? " …" : ""}` : "";
}
