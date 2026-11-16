"use client";

import { useMemo } from "react";
import { Sheet, SheetHeader } from "@/components/ui/Sheet";
import { Icon, type IconName } from "@/components/ui/Icon";
import { useController, useProfileRef } from "@/hooks/useGame";
import type { Profile } from "@/game/progression/profile";
import type { UpgradeableStat } from "@/game/data/ids";
import { activeSets, nextStep, powerBreakdown, type NextStep } from "@/game/progression/power";
import { BAG_LEND, bagItems, equippedItems, milestoneMult, RANK_STAT_STEP, type PowerSource } from "@/game/progression/stats";
import { AETHER_POWER, TREE_COMPOUND, nodeLevel } from "@/game/progression/ascension";
import { codexBonus } from "@/game/summons/extraction";
import { TECHNIQUE_OWNED_ATTACK } from "@/game/data/abilities";
import { SKILLS } from "@/game/data/skills";
import { weaponPathDef } from "@/game/progression/weaponPaths";
import { canAttemptTrial, rankLetter } from "@/game/progression/ranks";
import { STAT_LABEL } from "@/game/data/equipment";
import { fmt } from "@/lib/format";
import { cn } from "@/lib/cn";

type Go = "hero" | "gear" | "skills" | "summons" | "rift" | "ascend" | "perks" | "trial" | null;

const SOURCE: Record<PowerSource, { label: string; icon: IconName; go: Go }> = {
  statLevels: { label: "Stat levels", icon: "level", go: "hero" },
  level: { label: "Warrior level", icon: "xp", go: null },
  gear: { label: "Equipped gear", icon: "gear", go: "gear" },
  bag: { label: "Your bag", icon: "chest", go: "gear" },
  sets: { label: "Gear sets", icon: "relic", go: "gear" },
  skills: { label: "Skills", icon: "skills", go: "skills" },
  perks: { label: "Perks", icon: "sparkle", go: "perks" },
  weaponPath: { label: "Weapon path", icon: "sword", go: "skills" },
  codex: { label: "Army Codex", icon: "summons", go: "summons" },
  techniques: { label: "Techniques", icon: "tempest", go: "skills" },
  rank: { label: "Rank", icon: "star", go: "trial" },
  aether: { label: "Aether", icon: "rift", go: "ascend" },
  tree: { label: "Aether tree", icon: "rift", go: "ascend" },
};

const SHORT: Record<UpgradeableStat, string> = { attack: "Attack", maxHp: "Health", defense: "Defence", attackSpeed: "Attack speed", critChance: "Crit rate", critDamage: "Crit damage" };
const pctOf = (v: number) => `+${v >= 10 ? fmt(Math.round(v * 100)) : Math.round(v * 100)}%`;

/** What a source gives, in plain numbers; or, when it gives nothing yet, how to get it. */
export function sourceDetail(p: Profile, s: PowerSource): string {
  switch (s) {
    case "statLevels": {
      const lv = p.player.statLevels;
      const top = (Object.keys(lv) as UpgradeableStat[]).sort((a, b) => lv[b] - lv[a]);
      const ms = milestoneMult(lv.attack);
      return `${SHORT[top[0]!]} Lv ${lv[top[0]!]}, ${SHORT[top[1]!]} Lv ${lv[top[1]!]} and 4 more${ms > 1 ? `; milestones ×${ms < 10 ? ms.toFixed(2) : fmt(ms)} Attack` : ""}`;
    }
    case "level":
      return `Level ${p.player.level}: ${pctOf((p.player.level - 1) * 0.045)} Attack and Health`;
    case "gear": {
      const n = equippedItems(p).length;
      return n ? `${n} of 6 slots worn` : "Nothing worn: equip what bosses drop";
    }
    case "bag": {
      const n = bagItems(p).length;
      const forged = p.equipment.inventory.some((i) => i.kept);
      return n || forged ? `${n} ${n === 1 ? "item lends" : "items lend"} ${Math.round(BAG_LEND * 100)}% of their stats${forged ? ", forged ones more" : ""}` : `Keep items: each lends ${Math.round(BAG_LEND * 100)}% of its stats`;
    }
    case "sets": {
      const on = activeSets(p).filter((x) => x.worn >= 2);
      return on.length ? on.map((x) => `${x.name} ${x.worn} of ${x.of}: ${x.two}`).join("; ") : "Wear 2 pieces of one set for its bonus";
    }
    case "skills": {
      const stat = p.skills.unlocked.map((id) => SKILLS.find((x) => x.id === id)).filter((n) => n?.effect.kind === "stat");
      return p.skills.unlocked.length ? `${p.skills.unlocked.length} of ${SKILLS.length} nodes; ${stat.length} raise stats` : "Spend skill points in Skills";
    }
    case "perks": {
      const picks = Object.values(p.player.perks).reduce((a, b) => a + b, 0);
      return picks ? `${picks} perk ${picks === 1 ? "pick" : "picks"}, one each level` : "A perk comes with every level";
    }
    case "weaponPath": {
      const def = weaponPathDef(p.player.weaponPath);
      return def ? `${def.name}: ${def.description.split(".")[0]}` : "Opens with the Power branch's third skill";
    }
    case "codex": {
      const b = codexBonus(p);
      const parts = (Object.keys(b) as UpgradeableStat[]).filter((k) => b[k] > 0).sort((x, y) => b[y] - b[x]);
      return parts.length ? parts.slice(0, 2).map((k) => `${pctOf(b[k])} ${SHORT[k]}`).join(", ") + (parts.length > 2 ? ` and ${parts.length - 2} more` : "") : "Every shadow you bind adds to it";
    }
    case "techniques": {
      const n = p.player.techniques.length;
      return n ? `${n} learned: ${pctOf(n * TECHNIQUE_OWNED_ATTACK)} Attack` : "Each technique learned adds Attack";
    }
    case "rank":
      return p.player.rank ? `Rank ${rankLetter(p.player.rank)}: ${pctOf(p.player.rank * RANK_STAT_STEP)} Attack and Health` : "Win a Rank Trial in the Rift";
    case "aether":
      return p.ascension.aether ? `${fmt(p.ascension.aether)} Aether: ${pctOf(p.ascension.aether * AETHER_POWER)} Attack and Health` : "Ascend from stage 20 to earn it";
    case "tree": {
      const m = nodeLevel(p, "might");
      const v = nodeLevel(p, "vigor");
      return m || v ? `Might ${m}, Vigor ${v}: ${pctOf(Math.pow(1 + TREE_COMPOUND.might, m) - 1)} Attack, ${pctOf(Math.pow(1 + TREE_COMPOUND.vigor, v) - 1)} Health` : "Spend Aether on Might and Vigor";
    }
  }
}

function shareText(share: number): string {
  const v = share * 100;
  return v >= 10 ? `${Math.round(v)}%` : v >= 0.1 ? `${v.toFixed(1)}%` : "<0.1%";
}

/**
 * Where my Power comes from. The best next step on top, then every source with its part of Power
 * (measured by taking it away), each leading to where it is changed.
 */
export function PowerSheet({ open }: { open: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const b = powerBreakdown(profile);
  const step = useMemo(() => nextStep(profile, fmt), [profile, profile.player.gold, profile.player.skillPoints, profile.player.pendingPerkChoices, profile.equipment.equipped, profile.equipment.inventory.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = [...b.rows].sort((x, y) => y.power - x.power);
  const live = rows.filter((r) => r.share >= 0.0005);
  const idle = rows.filter((r) => r.share < 0.0005);
  const go = (to: Go) => {
    if (!to) return;
    c.closeModal();
    if (to === "ascend") c.openAscension();
    else if (to === "perks") {
      if (profile.player.pendingPerkChoices > 0) c.openPerkChoice();
    } else if (to === "trial") {
      if (canAttemptTrial(profile)) c.startMode("trial");
      else c.setPanel("rift");
    } else c.setPanel(to);
  };
  const stepGo: Record<NextStep["kind"], Go> = { perk: "perks", skill: "skills", gear: "gear", aether: "ascend", trial: "trial", stat: "hero", boss: null, farm: "hero", ascend: "ascend" };
  const onStep = () => {
    if (step.kind === "boss") {
      c.closeModal();
      c.openBossChallenge();
    } else if (step.kind === "gear") {
      c.closeModal();
      c.setPanel("gear");
      c.equipBest();
    } else go(stepGo[step.kind]);
  };
  return (
    <Sheet open={open} onDismiss={() => c.closeModal()} testId="power-sheet" label="Where your Power comes from">
      <div className="pt-1">
        <SheetHeader eyebrow="Power" title={<span className="t-num-serif-xl" data-testid="power-total">{fmt(b.total)}</span>} subtitle="Where it comes from, and what to do next." />
        <button className="press mt-4 flex w-full min-h-[56px] items-center gap-3 rounded-[14px] bg-bg-2 px-4 py-2 text-left shadow-[inset_0_0_0_1px_rgba(218,184,108,0.35)]" onClick={onStep} data-testid="power-next-step" aria-label={`Best next step: ${step.text}`}>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="t-label text-gold">Best next step</span>
            <span className="t-body text-t1">{step.text}</span>
          </span>
          <Icon name="chevron" size={16} className="shrink-0 text-t2" />
        </button>
        <div className="-mx-5 mt-4 shadow-[inset_0_1px_0_var(--line)]" data-testid="power-rows">
          {live.map((r) => (
            <SourceRow key={r.source} source={r.source} share={r.share} detail={sourceDetail(profile, r.source)} onGo={SOURCE[r.source].go ? () => go(SOURCE[r.source].go) : undefined} />
          ))}
          <div className="flex min-h-[52px] items-center gap-3 px-5 py-2 shadow-[inset_0_-1px_0_var(--line)]" data-testid="power-row-base">
            <Icon name="hero" size={16} className="shrink-0 text-t3" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="t-body text-t1">Your warrior, bare</span>
              <span className="t-label text-t2">Level 1, no levels bought, nothing worn</span>
            </span>
            <span className="t-num-m tnum text-t2">{shareText(b.base / Math.max(1, b.total))}</span>
          </div>
        </div>
        {idle.length > 0 && (
          <>
            <p className="t-label text-t2 mt-4">Not yet giving anything</p>
            <div className="-mx-5 mt-1 shadow-[inset_0_1px_0_var(--line)]">
              {idle.map((r) => (
                <SourceRow key={r.source} source={r.source} share={0} detail={sourceDetail(profile, r.source)} onGo={SOURCE[r.source].go ? () => go(SOURCE[r.source].go) : undefined} idle />
              ))}
            </div>
          </>
        )}
        <p className="t-caption text-t3 mt-3 mb-1">
          Each share is what taking that source away would cost. Sources multiply each other, so the shares are scaled together to add up to your Power. {STAT_LABEL.attack} and {STAT_LABEL.maxHp} gains count most.
        </p>
      </div>
    </Sheet>
  );
}

function SourceRow({ source, share, detail, onGo, idle }: { source: PowerSource; share: number; detail: string; onGo?: () => void; idle?: boolean }) {
  const def = SOURCE[source];
  const body = (
    <>
      <Icon name={def.icon} size={16} className={cn("shrink-0", idle ? "text-t3" : "text-gold")} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn("t-body truncate", idle ? "text-t2" : "text-t1")}>{def.label}</span>
          {!idle && (
            <span className="t-num-m tnum text-t1 shrink-0">
              {shareText(share)}
            </span>
          )}
        </span>
        <span className="t-label text-t2 line-clamp-2">{detail}</span>
        {!idle && (
          <span className="mt-1 h-[3px] w-full rounded-full bg-bg-3" aria-hidden="true">
            <span className="block h-full rounded-full bg-gold" style={{ width: `${Math.max(1, Math.min(100, share * 100))}%` }} />
          </span>
        )}
      </span>
      {onGo && <Icon name="chevron" size={16} className="shrink-0 text-t3" />}
    </>
  );
  const cls = "relative flex w-full min-h-[56px] items-center gap-3 px-5 py-2 text-left shadow-[inset_0_-1px_0_var(--line)]";
  return onGo ? (
    <button className={cn(cls, "press-fill")} onClick={onGo} data-testid={`power-row-${source}`}>
      {body}
    </button>
  ) : (
    <div className={cls} data-testid={`power-row-${source}`}>
      {body}
    </div>
  );
}
