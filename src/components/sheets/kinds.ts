/**
 * The boss and mode results. While one is open the battlefield's own boss controls step aside
 * (the gate button, the push chip), and the hand guide may still point into it (FIGHT).
 */
export const BATTLEFIELD_MODALS = ["boss_ready", "boss_victory", "boss_defeat", "mode_result"] as const;

export function isBattlefieldModal(kind: string): boolean {
  return (BATTLEFIELD_MODALS as readonly string[]).includes(kind);
}
