"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import { useController, useUi } from "@/hooks/useGame";
import type { PanelId } from "@/game/data/ids";

const TABS: { id: PanelId; label: string; icon: IconName }[] = [
  { id: "hero", label: "Hero", icon: "hero" },
  { id: "summons", label: "Summons", icon: "summons" },
  { id: "gear", label: "Gear", icon: "gear" },
  { id: "skills", label: "Skills", icon: "skills" },
  { id: "rift", label: "Rift", icon: "rift" },
];

export function TabNav() {
  const c = useController();
  const panel = useUi((u) => u.panel);
  const badges = useUi((u) => u.newBadges);
  return (
    <nav className="panel-surface grid grid-cols-5 h-[58px] shrink-0 min-w-0 w-full" aria-label="Main">
      {TABS.map((t) => (
        <button key={t.id} className="tab-btn min-w-0" data-active={panel === t.id} data-guide={`tab-${t.id}`} data-testid={`tab-${t.id}`} onClick={() => c.setPanel(t.id)} aria-label={t.label}>
          <Icon name={t.icon} size={20} />
          <span className="text-[10px] font-semibold tracking-wide">{t.label}</span>
          {badges[t.id] && panel !== t.id && <span className="badge-dot" />}
        </button>
      ))}
    </nav>
  );
}
