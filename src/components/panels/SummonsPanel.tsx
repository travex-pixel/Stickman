"use client";

import { useEffect } from "react";
import { Icon } from "@/components/ui/Icon";
import { HoldButton } from "@/components/ui/HoldButton";
import { SummonPortrait } from "@/components/ui/Portrait";
import { useController, useProfileRef, useUi } from "@/hooks/useGame";
import { collectibleSummons, ROLE_INFO, summonDef } from "@/game/data/summons";
import { codexBonus, ownedSpecies } from "@/game/summons/extraction";
import { fmtCodex } from "@/components/rewards/ModalHost";
import { STAT_LABEL } from "@/game/data/equipment";
import { computeModifiers } from "@/game/progression/stats";
import { bondCost, BOND_CAP, canStarUp, checkEvolution, starCost, summonStats } from "@/game/summons/progression";
import { summonXpForLevel, SUMMON_LEVEL_CAP } from "@/game/progression/xp";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/cn";

export default function SummonsPanel() {
  const c = useController();
  const profile = useProfileRef();
  const selectedId = useUi((u) => u.selectedSummon);
  const collection = profile.summons.collection;
  const slots = computeModifiers(profile).deploySlots;
  const deployedCount = collection.filter((s) => s.deployed).length;
  const selected = collection.find((s) => s.instanceId === selectedId) ?? collection[0] ?? null;

  useEffect(() => {
    if (!selectedId && collection[0]) c.selectSummon(collection[0].instanceId);
  }, [selectedId, collection, c]);

  if (collection.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-2 px-6 text-center">
        <Icon name="summons" size={28} className="text-[#a99cff]" />
        <div className="font-display text-[15px] tracking-[0.2em] text-ivory">The Shadow Army</div>
        <p className="text-[11px] text-mist leading-snug">Enemies marked with a pale light leave their shadow when they fall. Tap ARISE before it fades and it will fight for you forever.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 px-2 pt-1.5 pb-1.5 gap-1.5">
      <div className="flex items-center justify-between px-1 gap-2">
        <span className="caps whitespace-nowrap">
          Army <span className="text-parch">{ownedSpecies(profile).filter((id) => !summonDef(id).hidden).length}/{collectibleSummons().length}</span>
        </span>
        <span className="text-[10px] text-gold-2 truncate" title="Shadow Codex: permanent bonuses from every shadow you have raised">
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
              <SummonPortrait defId={s.defId} size={46} />
              {s.deployed && <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-soul shadow-[0_0_6px_#7df0c8]" />}
              <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] text-center font-bold text-ivory">Lv {s.level}</span>
            </button>
          );
        })}
      </div>
      {selected && <SummonDetail inst={selected} slots={slots} />}
    </div>
  );
}

function SummonDetail({ inst, slots }: { inst: ReturnType<typeof useProfileRef>["summons"]["collection"][number]; slots: number }) {
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
    <div className="card flex-1 min-h-0 flex gap-2 p-2">
      <div className="flex flex-col items-center gap-1 shrink-0">
        <SummonPortrait defId={inst.defId} size={64} />
        <span className={cn("text-[9px] font-bold uppercase tracking-wider", `rarity-${def.rarity}`)}>{def.rarity}</span>
        <button
          className={cn("w-[72px] rounded-lg py-1.5 font-display text-[11px] tracking-[0.12em] border", inst.deployed ? "bg-black/40 border-white/15 text-mist" : canDeploy ? "btn-jade" : "bg-black/40 border-white/10 text-mist opacity-60")}
          onClick={() => c.deploySummon(inst.instanceId, !inst.deployed)}
          data-guide={!inst.deployed ? "deploy-summon" : undefined}
          data-testid="deploy-button"
        >
          {inst.deployed ? "RECALL" : "DEPLOY"}
        </button>
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="leading-tight">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-[14px] text-ivory truncate">{def.name}</span>
            <span className="text-[10px] text-mist shrink-0">
              <span className="text-gold-2 tracking-tight">{"★".repeat(inst.stars ?? 0)}</span> {ROLE_INFO[def.role].label} · Lv {inst.level}
            </span>
          </div>
          <div className="text-[9px] text-mist italic truncate">{def.title}</div>
        </div>
        <div className="bar">
          <div style={{ width: `${inst.level >= SUMMON_LEVEL_CAP ? 100 : (inst.xp / xpNeed) * 100}%`, background: "#7df0c8" }} />
        </div>
        <div className="grid grid-cols-4 gap-1 text-[9px] text-mist">
          <Mini icon="heart" v={fmt(stats.maxHp)} />
          <Mini icon="sword" v={fmt(stats.attack)} />
          <Mini icon="shield" v={fmt(stats.defense)} />
          <Mini icon="speed" v={stats.attackSpeed.toFixed(1)} />
        </div>
        <div className="text-[9px] leading-snug text-ivory/85 line-clamp-2">
          <span className="text-gold-2 font-semibold">{def.active.name}.</span> {def.active.description}
        </div>
        <div className="text-[9px] text-gold/90">Codex +{fmtCodex(def.owned)}</div>
        <div className="mt-auto flex items-center gap-1.5">
          <HoldButton onRepeat={() => c.upgradeBond(inst.instanceId)} disabled={!canBond} className="flex-1 h-[34px]" testId="bond-upgrade" label={`Strengthen bond for ${cost} essence`}>
            <span className="flex flex-col items-center leading-none">
              <span className="caps text-gold-2 !text-[8px]">Hold · Bond {inst.bond}</span>
              <span className={cn("flex items-center gap-0.5 text-[10px] font-bold", canBond ? "text-jade-2" : "text-crimson-2")}>
                <Icon name="essence" size={10} />
                {inst.bond >= BOND_CAP ? "MAX" : fmt(cost)}
              </span>
            </span>
          </HoldButton>
          <button
            className={cn("h-[34px] px-2 rounded-lg border leading-tight shrink-0", star && starReady ? "border-gold/70 bg-gold/10 text-gold-2" : "border-white/10 bg-black/30 text-mist")}
            onClick={() => c.starUp(inst.instanceId)}
            disabled={!star}
            data-testid="star-button"
            aria-label={star ? `Star up for ${star.shards} shards${star.cores ? ` and ${star.cores} Rift Cores` : ""}` : "Max stars"}
          >
            <span className="block font-display text-[11px]">{star ? "★ Star" : "★ Max"}</span>
            {star && (
              <span className="block text-[9px] tabular-nums">
                {inst.shards}/{star.shards}
                {star.cores ? ` · ${star.cores}◆` : ""}
              </span>
            )}
          </button>
          {def.evolution && (
            <button
              className={cn("h-[34px] px-2 rounded-lg border leading-tight shrink-0", evo.possible ? "border-gold/70 bg-gold/15 text-gold-2" : "border-white/10 bg-black/30 text-mist")}
              onClick={() => c.evolve(inst.instanceId)}
              title={evo.reasons.join(", ")}
              data-testid="evolve-button"
            >
              <span className="block font-display text-[11px]">Evolve</span>
              <span className="block text-[9px]">{evo.possible ? "Ready" : `★${def.evolution.requiredStars} · Lv ${def.evolution.requiredLevel}`}</span>
            </button>
          )}
        </div>
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
