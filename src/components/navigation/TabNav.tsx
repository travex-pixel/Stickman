"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import { useController, useUi } from "@/hooks/useGame";
import type { PanelId } from "@/game/data/ids";

const TABS: { id: PanelId; label: string; icon: IconName }[] = [
  { id: "hero", label: "Hero", icon: "hero" },
  { id: "summons", label: "Army", icon: "summons" },
  { id: "gear", label: "Gear", icon: "gear" },
  { id: "skills", label: "Skills", icon: "skills" },
  { id: "rift", label: "Rift", icon: "rift" },
];

/** 58px. An icon over an 11px label; active is warm white, the rest tertiary. A gold dot marks news. */
export function TabNav() {
  const c = useController();
  const panel = useUi((u) => u.panel);
  const badges = useUi((u) => u.newBadges);
  return (
    <nav className="relative z-20 grid grid-cols-5 h-[58px] shrink-0 min-w-0 w-full bg-bg-1 shadow-[inset_0_1px_0_var(--line)]" aria-label="Main">
      {TABS.map((t) => {
        const on = panel === t.id;
        return (
          <button key={t.id} className="tab-btn min-w-0" data-active={on} data-guide={`tab-${t.id}`} data-testid={`tab-${t.id}`} onClick={() => c.setPanel(t.id)} aria-label={t.label} aria-current={on ? "page" : undefined}>
            <span className="relative">
              <Icon name={t.icon} size={21} strokeWidth={on ? 2 : 1.6} style={{ transition: "stroke-width 200ms var(--ease)" }} />
              {badges[t.id] && !on && <span className="absolute -right-1 -top-0.5 h-1.5 w-1.5 rounded-full bg-gold" aria-hidden="true" />}
            </span>
            <span className="t-caption">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
