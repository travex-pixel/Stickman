"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Row } from "@/components/ui/Row";
import { Segment, Segmented } from "@/components/ui/Segmented";
import { Sheet, SheetHeader } from "@/components/ui/Sheet";
import { SummonPortrait } from "@/components/ui/Portrait";
import { useController, useProfileRef } from "@/hooks/useGame";
import { ACHIEVEMENTS, JOURNAL } from "@/game/data/lore";
import { ENEMIES } from "@/game/data/enemies";
import { cn } from "@/lib/cn";
import { CloseButton } from "./parts";

type Tab = "lore" | "bestiary" | "feats";

/** The Journal: lore found in the Rift, every foe met, and feats. A tall sheet of rows. */
export function JournalSheet({ open }: { open: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const [tab, setTab] = useState<Tab>("lore");
  const entries = JOURNAL.filter((j) => profile.progress.journal.includes(j.id));
  const seen = profile.progress.killsByEnemy;
  return (
    <Sheet open={open} onDismiss={() => c.closeModal()} testId="modal-journal" labelledBy="journal-title">
      <div className="flex items-start justify-between gap-3">
        <SheetHeader id="journal-title" title="Journal" />
        <CloseButton onClick={() => c.closeModal()} />
      </div>
      <Segmented<Tab> value={tab} onChange={setTab} stretch label="Journal" className="mt-3">
        <Segment id="lore" data-testid="journal-lore">
          Lore
        </Segment>
        <Segment id="bestiary" data-testid="journal-bestiary">
          Bestiary
        </Segment>
        <Segment id="feats" data-testid="journal-feats">
          Feats
        </Segment>
      </Segmented>
      <div className="-mx-5 mt-2">
        {tab === "lore" && (
          <>
            {entries.map((j) => (
              <div key={j.id} className="px-5 py-3 shadow-[inset_0_-1px_0_var(--line)]">
                <div className="font-serif text-[20px] leading-[24px] text-t1">{j.title}</div>
                <p className="t-body text-t2 mt-1">{j.body}</p>
              </div>
            ))}
            <p className="t-label text-t2 px-5 py-4">{JOURNAL.length - entries.length} entries remain hidden in the Rift.</p>
          </>
        )}
        {tab === "bestiary" &&
          Object.values(ENEMIES).map((e) => {
            const known = e.id in seen;
            return (
              <div key={e.id} className={cn("flex gap-3 px-5 py-3 shadow-[inset_0_-1px_0_var(--line)]", !known && "opacity-60")}>
                <span className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-bg-2">{known && <SummonPortrait defId={e.id} size={40} enemy round />}</span>
                <div className="min-w-0 flex-1">
                  <div className="t-body text-t1">{known ? e.name : "Unknown"}</div>
                  <p className="t-label text-t2 mt-0.5">{known ? e.lore : "Defeat it to learn more."}</p>
                  {known && e.counter && <p className="t-label text-t1 mt-1">{e.counter}</p>}
                  {known && (
                    <p className="t-label text-t2 mt-1 tnum">
                      Slain {seen[e.id] ?? 0}
                      {e.essenceSummonId ? " · leaves a shadow" : ""}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        {tab === "feats" &&
          ACHIEVEMENTS.map((a) => {
            const done = profile.progress.achievements.includes(a.id);
            return <Row key={a.id} className={cn("px-5", !done && "opacity-60")} gutter={false} leading={<Icon name={done ? "star" : "lock"} size={16} className={done ? "text-gold" : "text-t2"} />} title={a.name} detail={<span className="whitespace-normal">{a.description}</span>} />;
          })}
      </div>
    </Sheet>
  );
}
