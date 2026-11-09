"use client";

import { useEffect } from "react";
import { Icon } from "@/components/ui/Icon";
import { HoldButton } from "@/components/ui/HoldButton";
import { SummonPortrait } from "@/components/ui/Portrait";
import { useController, useProfileRef, useUi } from "@/hooks/useGame";
import { ROLE_INFO, summonDef, WARDEN_SIGILS_REQUIRED } from "@/game/data/summons";
import { computeModifiers } from "@/game/progression/stats";
import { bondCost, BOND_CAP, checkEvolution, summonPower, summonStats } from "@/game/summons/progression";
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
        <Icon name="summons" size={28} className="text-soul" />
        <div className="font-display text-[13px] tracking-[0.2em] text-bone">ECLIPSE</div>
        <p className="text-[11px] text-mist leading-snug">When an enemy marked with a soul light falls, its essence lingers. Claim it, and it will fight for you.</p>
        {profile.summons.wardenSigils > 0 && <p className="text-[10px] text-gold">Warden Sigils {profile.summons.wardenSigils}/{WARDEN_SIGILS_REQUIRED}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 px-2 pt-1.5 pb-1.5 gap-1.5">
      <div className="flex items-center justify-between px-1">
        <span className="font-display text-[11px] tracking-[0.2em] text-mist">COMPANIONS</span>
        <span className="text-[10px] text-mist">
          Deployed <span className="text-soul font-bold" data-testid="deploy-count">{deployedCount}/{slots}</span>
          {profile.summons.wardenSigils > 0 && !collection.some((s) => s.defId === "hollow_warden") && <span className="ml-2 text-gold">Sigils {profile.summons.wardenSigils}/{WARDEN_SIGILS_REQUIRED}</span>}
        </span>
      </div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar shrink-0" style={{ touchAction: "pan-x" }}>
        {collection.map((s) => {
          const def = summonDef(s.defId);
          return (
            <button key={s.instanceId} className={cn("relative shrink-0 rounded-xl border-2 overflow-hidden", selected?.instanceId === s.instanceId ? "border-cyan" : `border-rarity-${def.rarity}`)} onClick={() => c.selectSummon(s.instanceId)} data-testid={`summon-card-${s.defId}`} aria-label={def.name}>
              <SummonPortrait defId={s.defId} size={46} />
              {s.deployed && <span className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-soul shadow-[0_0_6px_#7df0c8]" />}
              <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] text-center font-bold text-bone">Lv {s.level}</span>
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
          className={cn("w-[72px] rounded-lg py-1.5 text-[10px] font-bold border", inst.deployed ? "bg-black/40 border-white/15 text-mist" : canDeploy ? "bg-soul/20 border-soul/70 text-soul" : "bg-black/40 border-white/10 text-mist opacity-60")}
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
            <span className="font-display text-[13px] text-bone truncate">{def.name}</span>
            <span className="text-[10px] text-mist shrink-0">{ROLE_INFO[def.role].label} · Lv {inst.level}</span>
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
        <div className="text-[9px] leading-snug text-bone/85 line-clamp-2">
          <span className="text-cyan font-semibold">{def.active.name}.</span> {def.active.description}
        </div>
        <div className="mt-auto flex items-center gap-1.5">
          <HoldButton onRepeat={() => c.upgradeBond(inst.instanceId)} disabled={!canBond} className="flex-1 h-[34px]" testId="bond-upgrade" label={`Strengthen bond for ${cost} essence`}>
            <span className="flex flex-col items-center leading-none">
              <span className="text-[8px] text-cyan tracking-wider">HOLD · BOND {inst.bond}</span>
              <span className={cn("flex items-center gap-0.5 text-[10px] font-bold", canBond ? "text-soul" : "text-crimson")}>
                <Icon name="essence" size={10} />
                {inst.bond >= BOND_CAP ? "MAX" : fmt(cost)}
              </span>
            </span>
          </HoldButton>
          {def.evolution && (
            <button className={cn("h-[34px] px-2 rounded-lg border text-[9px] font-bold leading-tight", evo.possible ? "bg-violet/25 border-violet text-bone" : "bg-black/40 border-white/10 text-mist")} onClick={() => c.evolve(inst.instanceId)} title={evo.reasons.join(", ")} data-testid="evolve-button">
              {evo.possible ? "EVOLVE" : <span>EVOLVE<br /><span className="text-[8px] font-normal">{inst.shards}/{def.evolution.requiredShards} shards</span></span>}
            </button>
          )}
          <span className="text-[9px] text-mist">⚡{fmt(summonPower(inst))}</span>
        </div>
      </div>
    </div>
  );
}

function Mini({ icon, v }: { icon: "heart" | "sword" | "shield" | "speed"; v: string }) {
  return (
    <span className="flex items-center gap-0.5 rounded bg-black/40 px-1 py-0.5">
      <Icon name={icon} size={9} className="text-cyan" />
      <span className="text-bone font-semibold tabular-nums">{v}</span>
    </span>
  );
}
