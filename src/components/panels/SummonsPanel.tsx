"use client";

import { useEffect } from "react";
import { HoldButton } from "@/components/ui/HoldButton";
import { Button } from "@/components/ui/Button";
import { Stat } from "@/components/ui/Stat";
import { CurrencyGlyph } from "@/components/ui/Currency";
import { SummonPortrait } from "@/components/ui/Portrait";
import { useController, useProfile, useProfileRef, useUi } from "@/hooks/useGame";
import { bestSynergyMove, armySynergies, synergiesGained, synergyEffect } from "@/lib/synergy";
import { Icon } from "@/components/ui/Icon";
import { useShake } from "@/hooks/useShake";
import { useShortScreen } from "@/hooks/useShortScreen";
import { useCompactFit } from "@/hooks/useCompactFit";
import { collectibleSummons, ROLE_INFO, summonDef } from "@/game/data/summons";
import { codexBonus, codexMultiplier, ownedSpecies, speciesStars } from "@/game/summons/extraction";
import { fmtCodex } from "@/lib/codex";
import { usePanelDetent } from "@/hooks/usePanelDetent";
import { STAT_LABEL } from "@/game/data/equipment";
import { computeModifiers } from "@/game/progression/stats";
import { bondCost, BOND_CAP, canStarUp, checkEvolution, starCost, summonStats } from "@/game/summons/progression";
import { REFINE_SHARDS, spareShards } from "@/game/summons/progression";
import type { Profile } from "@/game/progression/profile";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/cn";

type Instance = Profile["summons"]["collection"][number];

const RARITY_VAR: Record<string, string> = { common: "var(--color-common)", uncommon: "var(--color-uncommon)", rare: "var(--color-rare)", epic: "var(--color-epic)", legendary: "var(--color-legendary)" };
const RARITY_WORD: Record<string, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary" };

/** Objective: field the best army and grow it. Primary action: Deploy. */
export default function SummonsPanel() {
  const c = useController();
  const profile = useProfileRef();
  const selectedId = useUi((u) => u.selectedSummon);
  const collection = profile.summons.collection;
  const slots = computeModifiers(profile).deploySlots;
  const deployedCount = collection.filter((s) => s.deployed).length;
  const selected = collection.find((s) => s.instanceId === selectedId) ?? collection[0] ?? null;
  // Compact on short screens, and wherever the full layout would push the actions off the panel
  // (measured: 360x740 did, though it is not "short").
  const [root, tight] = useCompactFit<HTMLDivElement>(`${selected?.instanceId}:${selected?.deployed}:${collection.length}`);
  const short = useShortScreen() || tight;

  useEffect(() => {
    if (!selectedId && collection[0]) c.selectSummon(collection[0].instanceId);
  }, [selectedId, collection, c]);

  if (collection.length === 0) return <EmptyArmy />;

  const owned = ownedSpecies(profile).filter((id) => !summonDef(id).hidden).length;
  return (
    <div ref={root} className={cn("flex flex-col h-full min-h-0 px-4", short ? "pt-3 pb-2" : "pt-4 pb-3")}>
      <div className="flex items-baseline justify-between gap-3 shrink-0 t-label">
        <span className="text-t2 whitespace-nowrap">
          Deployed{" "}
          <span className="text-t1 tnum" data-testid="deploy-count">
            {deployedCount} of {slots}
          </span>
        </span>
        <span className="text-t2 truncate min-w-0" title="Oath Codex: permanent bonuses from every shadow you have bound">
          {codexSummary(profile)}
        </span>
        <span className="text-t3 tnum whitespace-nowrap hidden min-[380px]:inline">
          {owned} of {collectibleSummons().length}
        </span>
      </div>
      <SynergyLine />
      <div className={cn("flex gap-3 overflow-x-auto no-scrollbar shrink-0 -mx-4 px-4", short ? "mt-2" : "mt-3")} style={{ touchAction: "pan-x" }}>
        {collection.map((s) => (
          <RosterDisc key={s.instanceId} s={s} selected={selected?.instanceId === s.instanceId} short={short} onSelect={() => c.selectSummon(s.instanceId)} />
        ))}
      </div>
      {selected && <ShadowDetail inst={selected} slots={slots} deployedCount={deployedCount} short={short} />}
    </div>
  );
}

/** A 2px rarity ring around the portrait, a jade dot when deployed, the level underneath. */
function RosterDisc({ s, selected, short, onSelect }: { s: Instance; selected: boolean; short: boolean; onSelect: () => void }) {
  const def = summonDef(s.defId);
  const size = short ? 44 : 48;
  return (
    <button className="press relative flex shrink-0 flex-col items-center rounded-full" onClick={onSelect} data-testid={`summon-card-${s.defId}`} aria-label={`${def.name}, level ${s.level}${s.deployed ? ", deployed" : ""}`} aria-pressed={selected}>
      <span className="relative rounded-full" style={{ width: size, height: size, boxShadow: selected ? `0 0 0 2px var(--color-bg-1), 0 0 0 3.5px var(--color-t1)` : undefined }}>
        <SummonPortrait defId={s.defId} size={size} round />
        <span className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: `inset 0 0 0 2px ${RARITY_VAR[def.rarity]}` }} aria-hidden="true" />
        {s.deployed && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-1 bg-jade" aria-hidden="true" />}
      </span>
      {!short && (
        <span className={cn("t-caption tnum mt-1 flex items-center gap-1", selected ? "text-t1" : "text-t2")}>
          {selected && <span className="lozenge" aria-hidden="true" />}
          Lv {s.level}
        </span>
      )}
    </button>
  );
}

function ShadowDetail({ inst, slots, deployedCount, short }: { inst: Instance; slots: number; deployedCount: number; short: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const def = summonDef(inst.defId);
  const mods = computeModifiers(profile);
  const stats = summonStats(inst, { damageMult: mods.summonDamageMult, defenseMult: mods.summonDefenseMult, hpMult: mods.summonHpMult });
  const evo = checkEvolution(inst, profile.player.riftCores);
  const star = starCost(inst);
  const starReady = canStarUp(inst, profile.player.riftCores);
  const cost = bondCost(inst.bond);
  const bondMax = inst.bond >= BOND_CAP;
  const canBond = !bondMax && profile.player.essence >= cost;
  const canDeploy = inst.deployed || deployedCount < slots;
  const starsNow = speciesStars(profile).get(inst.defId) ?? 0;
  const [bondPill, shakeBond] = useShake<HTMLSpanElement>();
  const h = short ? "h-11" : "h-[52px]";
  // Exactly one gold action: whatever is the real next step for this shadow.
  const next: "deploy" | "evolve" | "star" | "bond" | null = !inst.deployed && canDeploy ? "deploy" : evo.possible ? "evolve" : starReady ? "star" : canBond ? "bond" : null;
  const gold = "!bg-gold !text-gold-ink !shadow-none";
  const gains = useProfile((p) => {
    if (inst.deployed) return "";
    const fielded = p.summons.collection.filter((x) => x.deployed);
    const roles = fielded.map((x) => summonDef(x.defId).role);
    const free = fielded.length < computeModifiers(p).deploySlots;
    // Into a free place, or in place of whichever fielded shadow gains the most.
    const options = free ? [synergiesGained(roles, def.role, null)] : roles.map((_, i) => synergiesGained(roles, def.role, i));
    const g = options.reduce((best, o) => (o.length > best.length ? o : best), [] as ReturnType<typeof synergiesGained>);
    return g.map((x) => x.name).join(", ");
  });
  const tall = usePanelDetent() === "tall" && !short;
  return (
    <div className={cn("flex flex-col flex-1 min-h-0", short ? "mt-2" : "mt-3")}>
      <div className="flex items-end justify-between gap-3 shrink-0">
        <div className="flex flex-col min-w-0">
          <span className="t-eyebrow truncate" style={{ color: RARITY_VAR[def.rarity] }}>
            {RARITY_WORD[def.rarity]} · {ROLE_INFO[def.role].label}
            {(inst.stars ?? 0) > 0 && <span className="text-gold"> · {"★".repeat(inst.stars ?? 0)}</span>}
          </span>
          <span className="t-name text-t1 truncate mt-1">{def.name}</span>
        </div>
        {!tall && (
          <div className="flex gap-4 shrink-0">
            <Stat label="Health" value={stats.maxHp} />
            <Stat label="Attack" value={stats.attack} className="hidden min-[360px]:flex" />
          </div>
        )}
      </div>
      {tall && (
        <>
          <p className="t-flavour text-t2 mt-2 shrink-0 line-clamp-2" title={def.active.description}>
            {def.active.name}: {def.active.description}
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3 shrink-0">
            <Stat label="Health" value={stats.maxHp} />
            <Stat label="Attack" value={stats.attack} />
            <Stat label="Bond" value={`${inst.bond}`} />
          </div>
        </>
      )}
      {!short && (
        <div className="t-label text-t2 truncate mt-1 shrink-0" title={def.active.description}>
          {!tall && (
            <>
              <span className="text-t1">{def.active.name}</span>
              <span className="text-t2"> · </span>
            </>
          )}
          <span data-testid="codex-line">
            Codex +{fmtCodex(def.owned, codexMultiplier(starsNow))}
            {(inst.stars ?? 0) < 5 && <span className="text-t3"> · next star +{fmtCodex(def.owned, codexMultiplier(starsNow + 1))}</span>}
          </span>
        </div>
      )}
      <div className="mt-auto flex items-center gap-2 pt-3 shrink-0">
        {inst.deployed ? (
          <Button variant="quiet" className={cn(h, "shrink-0 px-4")} onClick={() => c.deploySummon(inst.instanceId, false)} data-testid="deploy-button">
            Recall
          </Button>
        ) : (
          <Button variant={next === "deploy" ? "primary" : "quiet"} className={cn(h, "shrink-0 px-5 flex-col !gap-0")} disabled={!canDeploy} onClick={() => c.deploySummon(inst.instanceId, true)} data-guide="deploy-summon" data-testid="deploy-button" aria-label={canDeploy ? `Deploy${gains ? `, gains ${gains}` : ""}` : `Deploy: all ${slots} places are taken`}>
            Deploy
            {gains && <span className="t-caption max-w-[120px] truncate">gains {gains}</span>}
          </Button>
        )}
        <HoldButton
          onRepeat={() => c.upgradeBond(inst.instanceId)}
          disabled={!canBond}
          onDenied={bondMax ? undefined : () => (shakeBond(), c.audio.play("error", { volume: 0.3, minInterval: 200 }))}
          feedback="scale"
          className={cn(h, "flex-1 min-w-0 rounded-[14px] btn-raised flex flex-col items-center justify-center", next === "bond" && gold, bondMax && "opacity-40")}
          testId="bond-upgrade"
          label={bondMax ? `Bond ${inst.bond}, at its cap` : `Strengthen bond for ${cost} essence`}
        >
          <span className={cn("t-label", next === "bond" ? "text-gold-ink" : "text-t1")}>Bond {inst.bond}</span>
          <span ref={bondPill} className={cn("flex items-center gap-1.5 t-caption tnum", next === "bond" ? "text-gold-ink" : canBond ? "text-jade" : "text-t2")}>
            {bondMax ? (
              "Max"
            ) : (
              <>
                <CurrencyGlyph kind="essence" size={6} className={next === "bond" ? "!bg-gold-ink" : canBond ? undefined : "!bg-t3"} />
                {fmt(cost)}
              </>
            )}
          </span>
        </HoldButton>
        <button
          className={cn("press flex flex-col items-center justify-center rounded-[14px] btn-raised px-3 shrink-0 min-w-11", h, next === "star" && gold, !star && "opacity-40")}
          onClick={() => c.starUp(inst.instanceId)}
          disabled={!star}
          data-testid="star-button"
          aria-label={star ? `Star up for ${star.shards} shards${star.cores ? ` and ${star.cores} Rift Cores` : ""}` : "Max stars"}
        >
          <span className={cn("t-label flex items-center gap-1.5", next === "star" ? "text-gold-ink" : "text-t1")}>
            {starReady && next !== "star" && <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
            Star
          </span>
          <span className={cn("t-caption tnum", next === "star" ? "text-gold-ink" : starReady ? "text-gold" : "text-t2")}>{!star ? "Max" : starReady ? "Ready" : `${Math.min(inst.shards, star.shards)}/${star.shards}`}</span>
        </button>
        {def.evolution && (
          <button className={cn("press flex flex-col items-center justify-center rounded-[14px] btn-raised px-3 shrink-0 min-w-11", h, next === "evolve" && gold)} onClick={() => c.evolve(inst.instanceId)} title={evo.reasons.join(", ")} data-testid="evolve-button" aria-label={evo.possible ? "Evolve, ready" : `Evolve: ${evo.reasons.join(", ")}`}>
            <span className={cn("t-label flex items-center gap-1.5", next === "evolve" ? "text-gold-ink" : "text-t1")}>
              {evo.possible && next !== "evolve" && <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
              Evolve
            </span>
            <span className={cn("t-caption tnum", next === "evolve" ? "text-gold-ink" : evo.possible ? "text-gold" : "text-t2")}>{evo.possible ? "Ready" : `Lv ${def.evolution.requiredLevel}`}</span>
          </button>
        )}
        {spareShards(inst) >= REFINE_SHARDS && (
          <button className="press flex flex-col items-center justify-center rounded-[14px] btn-raised px-3 shrink-0 min-w-11" style={{ height: short ? 44 : 52 }} onClick={() => c.refineShards(inst.instanceId)} data-testid="refine-shards" aria-label={`Refine ${REFINE_SHARDS} spare shards into a Rift Core`}>
            <span className="t-label text-t1">Refine</span>
            <span className="t-caption tnum text-t2 flex items-center gap-1">
              <CurrencyGlyph kind="core" size={6} />
              {REFINE_SHARDS}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

/** Before the first BIND: say what the Oathbound are and how to get one. */
function EmptyArmy() {
  const c = useController();
  return (
    <div className="flex flex-col h-full items-center justify-center gap-4 px-8 text-center">
      <div className="flex gap-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-12 w-12 rounded-full bg-bg-2" style={{ opacity: 1 - i * 0.3 }} />
        ))}
      </div>
      <div className="flex flex-col gap-1">
        <span className="t-title text-t1">No shadows yet</span>
        <span className="t-body text-t2">Marked enemies leave an essence when they fall. Tap BIND before it fades.</span>
      </div>
      <Button size="sm" variant="quiet" onClick={() => c.setPanel("hero")} data-testid="army-empty-next">
        Back to the fight
      </Button>
    </div>
  );
}

function codexSummary(profile: Profile): string {
  const b = codexBonus(profile);
  const parts = (Object.entries(b) as [keyof typeof b, number][]).filter(([, v]) => v > 0).map(([k, v]) => `+${Math.round(v * 100)}% ${STAT_LABEL[k].replace("Critical ", "Crit ")}`);
  return parts.length ? `Codex ${parts.slice(0, 2).join(", ")}${parts.length > 2 ? " …" : ""}` : "";
}

/**
 * Synergies: the active ones by name with the gold lozenge; when none is active, the single best
 * move as a quiet line that selects the shadow to bring in.
 */
function SynergyLine() {
  const c = useController();
  // A string key: re-renders when the fielded set (and so the synergies) changes.
  const active = useProfile((p) => armySynergies(p).map((s) => `${s.name}|${synergyEffect(s)}`).join("\n"));
  const move = useProfile((p) => {
    const m = bestSynergyMove(p);
    if (!m) return "";
    return `${m.bring.instanceId}|${summonDef(m.bring.defId).name}|${m.replace ? summonDef(m.replace.defId).name : ""}|${m.gains.map((g) => g.name).join(", ")}`;
  });
  if (active) {
    return (
      <div className="mt-2 flex flex-col shrink-0" data-testid="synergy-active">
        {active.split("\n").map((line) => {
          const [name, effect] = line.split("|");
          return (
            <span key={name} className="t-label text-t1 flex items-center gap-2 truncate">
              <span className="lozenge" aria-hidden="true" />
              <span className="truncate">
                {name}
                <span className="text-t2"> · {effect}</span>
              </span>
            </span>
          );
        })}
      </div>
    );
  }
  if (!move) return null;
  const [id, bring, replace, gains] = move.split("|");
  return (
    <button className="press-fill -mx-4 mt-1 flex h-11 shrink-0 items-center gap-2 px-4 text-left" onClick={() => c.selectSummon(id!)} data-testid="synergy-suggestion">
      <span className="t-label text-t2 min-w-0 flex-1 truncate">
        Field <span className="text-t1">{bring}</span>
        {replace ? ` in place of ${replace}` : ""}: <span className="text-gold">{gains}</span>
      </span>
      <Icon name="chevron" size={16} className="shrink-0 text-t2" />
    </button>
  );
}
