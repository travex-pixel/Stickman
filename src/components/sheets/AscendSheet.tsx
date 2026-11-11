"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { HoldConfirm } from "@/components/ui/HoldConfirm";
import { Row } from "@/components/ui/Row";
import { Segment, Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { CurrencyGlyph } from "@/components/ui/Currency";
import { Icon } from "@/components/ui/Icon";
import { useController, useProfileRef } from "@/hooks/useGame";
import { SURGE_MAX } from "@/game/progression/campaign";
import { AETHER_GOLD, AETHER_POWER, ASCEND_MIN_STAGE, LIMIT_BREAK_STEP, TREE, TREE_COMPOUND, aetherFor, canAscend, nextNodeCost, nodeLevel, romanAscension, spendableAether, type TreeNodeId } from "@/game/progression/ascension";
import { fmt } from "@/lib/format";
import { CostPill } from "./parts";

type Tab = "ascend" | "tree";

/** Ascension, a tall sheet: begin again stronger, or spend Aether in the tree. */
export function AscendSheet({ open }: { open: boolean }) {
  const c = useController();
  const profile = useProfileRef();
  const spare = spendableAether(profile);
  const [tab, setTab] = useState<Tab>(() => (spare > 0 && !canAscend(profile) ? "tree" : "ascend"));
  return (
    <Sheet open={open} onDismiss={() => c.closeModal()} testId="modal-ascend" label="Ascension">
      <Segmented<Tab> value={tab} onChange={setTab} stretch label="Ascension">
        <Segment id="ascend" data-testid="ascend-tab-ascend">
          Ascend
        </Segment>
        <Segment id="tree" badge={spare > 0 && tab !== "tree"} data-testid="ascend-tab-tree">
          Aether tree{spare > 0 ? ` · ${fmt(spare)}` : ""}
        </Segment>
      </Segmented>
      {tab === "ascend" ? <AscendBody /> : <AetherTree />}
    </Sheet>
  );
}

function mult(n: number): string {
  const v = 1 + n * AETHER_POWER;
  return v < 100 ? `×${v.toFixed(v < 10 ? 2 : 1)}` : `×${fmt(v)}`;
}

function AscendBody() {
  const c = useController();
  const profile = useProfileRef();
  const a = profile.ascension;
  const can = canAscend(profile);
  const gain = aetherFor(profile.progress.bestStage);
  return (
    <div className="pt-5" data-testid="ascend-sheet">
      <span className="t-eyebrow text-gold">{a.count > 0 ? `Ascension ${romanAscension(a.count)}` : "Ascension"}</span>
      <h2 className="t-display text-t1 mt-1.5">Begin the climb anew</h2>
      <p className="t-body text-t2 mt-2">
        The Rift lets the worthy start again, stronger. Each point of Aether is +{Math.round(AETHER_POWER * 100)}% Attack and Health and +{Math.round(AETHER_GOLD * 100)}% gold, forever.
      </p>
      <div className="mt-5 flex items-center gap-4">
        <div className="flex flex-col">
          <span className="t-label text-t2">Power now</span>
          <span className="t-num-xl text-t2">{mult(a.aether)}</span>
        </div>
        <Icon name="chevron" size={20} className="text-t3 mt-4" />
        <div className="flex flex-col">
          <span className="t-label text-t2">After</span>
          <span className="t-num-xl text-gold">{mult(can ? a.aether + gain : a.aether)}</span>
        </div>
        <div className="ml-auto flex flex-col items-end">
          <span className="t-label text-t2">Aether</span>
          <span className="t-num-m text-t1 flex items-center gap-1.5 mt-1.5">
            <CurrencyGlyph kind="aether" />
            {can ? `+${fmt(gain)}` : fmt(a.aether)}
          </span>
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <div className="t-label text-threat">Starts over</div>
          <p className="t-body text-t1 mt-1">Campaign stage, gold, stat levels</p>
        </div>
        <div>
          <div className="t-label text-jade">You keep</div>
          <p className="t-body text-t1 mt-1">Shadows, gear, level, skills, techniques, perks, rank, Codex</p>
        </div>
      </div>
      {can ? (
        <p className="t-label text-t2 mt-4" data-testid="rift-memory">
          <span className="text-t1">Rift Memory:</span> every gate up to stage {Math.max(profile.progress.bestStage, a.bestEver)} stays open, and you surge through that ground up to {SURGE_MAX} stages a cycle.
        </p>
      ) : (
        <p className="t-label text-t2 mt-4">Reach stage {ASCEND_MIN_STAGE} to ascend. Deeper stages grant more Aether.</p>
      )}
      <div className="mt-5 flex items-center gap-3">
        <Button variant="plain" className="shrink-0 px-4" onClick={() => c.closeModal()} data-testid="ascend-later">
          Not yet
        </Button>
        <HoldConfirm disabled={!can} onConfirm={() => c.confirmAscend()} className="flex-1" testId="ascend-confirm" label={`Hold to ascend for ${fmt(gain)} Aether`}>
          Hold to ascend
        </HoldConfirm>
      </div>
    </div>
  );
}

/** A tree node's total effect at `lvl`, in words. */
function nodeTotal(id: TreeNodeId, lvl: number): string {
  if (id in TREE_COMPOUND) {
    const v = Math.pow(1 + TREE_COMPOUND[id as keyof typeof TREE_COMPOUND], lvl) - 1;
    return v < 10 ? `+${Math.round(v * 100)}%` : `×${fmt(v + 1)}`;
  }
  if (id === "limit") return `+${LIMIT_BREAK_STEP * lvl} caps`;
  if (id === "treasury") return `${10 * lvl}% kept`;
  if (id === "oathbinder") return `+${3 * lvl}%`;
  if (id === "patience") return `+${lvl}h`;
  return `${lvl}`;
}

function AetherTree() {
  const c = useController();
  const profile = useProfileRef();
  const spend = spendableAether(profile);
  return (
    <div className="pt-4" data-testid="aether-tree">
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-label text-t2">Spending never lowers the flat bonus from lifetime Aether.</span>
        <span className="t-num-m text-t1 flex items-center gap-1.5 shrink-0">
          <CurrencyGlyph kind="aether" />
          {fmt(spend)}
        </span>
      </div>
      <div className="-mx-5 mt-2 shadow-[inset_0_1px_0_var(--line)]">
        {TREE.map((n) => {
          const lvl = nodeLevel(profile, n.id);
          const cost = nextNodeCost(profile, n.id);
          const can = cost !== null && spend >= cost;
          return (
            <Row
              key={n.id}
              className="px-5"
              gutter={false}
              title={
                <>
                  {n.name} <span className="t-label text-t2 tnum">{lvl}/{n.max}</span>
                </>
              }
              detail={
                <>
                  {n.per}
                  {lvl > 0 && n.max > 1 && <span className="text-t1"> · now {nodeTotal(n.id, lvl)}</span>}
                </>
              }
              trailing={
                <button className="press -my-1 flex h-11 items-center rounded-full disabled:opacity-100" disabled={!can} onClick={() => c.buyAscensionNode(n.id)} data-testid={`buy-${n.id}`} aria-label={cost === null ? `${n.name} is at its cap` : `Buy ${n.name} for ${cost} Aether`}>
                  <CostPill ok={can}>
                    {cost === null ? (
                      "Max"
                    ) : (
                      <>
                        <CurrencyGlyph kind="aether" size={6} className={can ? "text-gold" : "text-t3"} />
                        {fmt(cost)}
                      </>
                    )}
                  </CostPill>
                </button>
              }
              data-testid={`node-${n.id}`}
            />
          );
        })}
      </div>
      <Button variant="plain" block className="mt-3" onClick={() => c.closeModal()}>
        Close
      </Button>
    </div>
  );
}
