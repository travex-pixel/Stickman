"use client";

import { Icon } from "@/components/ui/Icon";
import { useController, useHud, useProfileRef } from "@/hooks/useGame";
import { regionForStage, stageScale } from "@/game/data/regions";
import { ACHIEVEMENTS, JOURNAL } from "@/game/data/lore";
import { ENEMIES } from "@/game/data/enemies";
import { SummonPortrait } from "@/components/ui/Portrait";
import { cn } from "@/lib/cn";

export default function RiftPanel() {
  const c = useController();
  const profile = useProfileRef();
  const stage = useHud((s) => s?.stage ?? profile.progress.currentStage);
  const region = regionForStage(stage);
  const maxStage = profile.progress.bestStage + 1;
  const stages = Array.from({ length: 6 }, (_, i) => Math.max(1, Math.min(maxStage, stage) - 2) + i).filter((s) => s <= maxStage);
  const scale = stageScale(stage);
  const seen = Object.keys(profile.progress.killsByEnemy);
  return (
    <div className="flex flex-col h-full min-h-0 px-2 pt-1.5 pb-1.5 gap-1.5">
      <div className="flex items-center justify-between leading-tight">
        <div>
          <div className="font-display text-[12px] tracking-[0.15em] text-bone">{region.name}</div>
          <div className="text-[9px] text-mist italic">{region.subtitle}</div>
        </div>
        <button className="btn-ghost !py-1 !px-2 text-[10px] flex items-center gap-1" onClick={() => c.openJournal()} data-testid="journal-button">
          <Icon name="book" size={12} /> Journal {profile.progress.journal.length}/{JOURNAL.length}
        </button>
      </div>
      <div className="flex gap-1">
        {stages.map((s) => (
          <button key={s} className={cn("flex-1 card py-1 text-center", s === stage && "card-active", s > profile.progress.bestStage + 1 && "opacity-40")} onClick={() => c.selectStage(s)} data-testid={`stage-${s}`} aria-label={`Stage ${s}`}>
            <div className="text-[9px] text-mist">STAGE</div>
            <div className="text-[13px] font-bold text-bone">{s}</div>
            {s <= profile.progress.bestStage && <Icon name="check" size={10} className="text-soul mx-auto" />}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1 text-[9px] text-mist">
        <Info label="Enemy HP" v={`×${scale.hp.toFixed(1)}`} />
        <Info label="Rewards" v={`×${scale.reward.toFixed(1)}`} />
        <Info label="Kills" v={`${profile.progress.totalKills}`} />
      </div>
      <div className="flex-1 min-h-0 flex gap-1.5">
        <div className="card flex-1 p-1.5 min-h-0">
          <div className="text-[9px] uppercase tracking-[0.2em] text-mist mb-1">Bestiary</div>
          <div className="flex gap-1 flex-wrap">
            {Object.values(ENEMIES).map((e) => {
              const known = seen.includes(e.id);
              return (
                <div key={e.id} className={cn("relative", !known && "opacity-30 grayscale")} title={known ? `${e.name}: ${e.lore}` : "Unknown"}>
                  <SummonPortrait defId={e.id} size={32} enemy />
                  {e.essenceSummonId && known && <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-soul" />}
                </div>
              );
            })}
          </div>
        </div>
        <div className="card flex-1 p-1.5 min-h-0 overflow-hidden">
          <div className="text-[9px] uppercase tracking-[0.2em] text-mist mb-1">Achievements {profile.progress.achievements.length}/{ACHIEVEMENTS.length}</div>
          <div className="grid grid-cols-4 gap-1">
            {ACHIEVEMENTS.map((a) => {
              const done = profile.progress.achievements.includes(a.id);
              return (
                <div key={a.id} className={cn("h-6 w-6 rounded-md flex items-center justify-center border", done ? "border-gold/60 bg-gold/15 text-gold" : "border-white/10 text-mist/40")} title={`${a.name}: ${a.description}`}>
                  <Icon name={done ? "star" : "lock"} size={11} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, v }: { label: string; v: string }) {
  return (
    <div className="card px-1.5 py-1 flex items-center justify-between">
      <span>{label}</span>
      <b className="text-bone">{v}</b>
    </div>
  );
}
