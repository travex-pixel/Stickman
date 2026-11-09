import type { Combatant, Status, StatusKind } from "../entities/types";

export function addStatus(target: Combatant, status: Status): void {
  const existing = target.statuses.find((s) => s.kind === status.kind);
  if (existing) {
    existing.remaining = Math.max(existing.remaining, status.remaining);
    if (status.kind === "shield") {
      existing.value += status.value;
      target.shield += status.value;
    } else {
      existing.value = Math.max(existing.value, status.value);
    }
    return;
  }
  target.statuses.push({ ...status });
  if (status.kind === "shield") target.shield += status.value;
}

export function hasStatus(target: Combatant, kind: StatusKind): boolean {
  return target.statuses.some((s) => s.kind === kind);
}

export function statusValue(target: Combatant, kind: StatusKind): number {
  const s = target.statuses.find((x) => x.kind === kind);
  return s ? s.value : 0;
}

export function removeStatus(target: Combatant, kind: StatusKind): void {
  target.statuses = target.statuses.filter((s) => s.kind !== kind);
  if (kind === "shield") target.shield = 0;
}

export function tickStatuses(target: Combatant, dt: number): { burnDamage: number } {
  let burnDamage = 0;
  for (const s of target.statuses) {
    s.remaining -= dt;
    if (s.kind === "burn") burnDamage += s.value * dt;
  }
  const expiredShield = target.statuses.some((s) => s.kind === "shield" && s.remaining <= 0);
  target.statuses = target.statuses.filter((s) => s.remaining > 0);
  if (expiredShield && !target.statuses.some((s) => s.kind === "shield")) target.shield = 0;
  return { burnDamage };
}

export function speedMultiplier(target: Combatant): number {
  let m = 1;
  if (hasStatus(target, "slow")) m *= 1 - statusValue(target, "slow");
  if (hasStatus(target, "haste")) m *= 1 + statusValue(target, "haste");
  if (hasStatus(target, "stun")) m = 0;
  return m;
}
