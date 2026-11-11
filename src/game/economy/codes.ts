import type { EquipSlot, Rarity } from "../data/ids";
import { SUMMONS } from "../data/summons";

/**
 * Gift codes.
 *
 * Two kinds are accepted:
 *  1. Named codes defined in NAMED_CODES (good for launch promotions).
 *  2. Signed codes you generate yourself with `npm run code -- --gold 500 --essence 100`.
 *     Format: ASC-<payload>-<signature>. The payload encodes the reward in plain text,
 *     the signature is the first 6 base32 characters of SHA-256(secret + "|" + payload).
 *
 * The verifying secret ships to the client, so a determined player could forge a code.
 * ASCEND sells nothing, so the only thing at stake is their own fun. Every code redeems
 * once per save.
 */
export interface CodeReward {
  gold?: number;
  essence?: number;
  riftCores?: number;
  summonId?: string;
  item?: { slot?: EquipSlot; rarity: Rarity };
}

export const NAMED_CODES: Record<string, CodeReward> = {
  WELCOME: { gold: 400, essence: 40 },
  ASCENDANT: { gold: 1200, riftCores: 1 },
  QUIETSOLDIER: { summonId: "husk_blade" },
  OATHKEEPER: { essence: 300 },
};

export const DEFAULT_CODE_SECRET = "ascend-dev-secret";

export function codeSecret(): string {
  return (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_ASCEND_CODE_SECRET) || DEFAULT_CODE_SECRET;
}

const SUMMON_SHORT: Record<string, string> = { husk_blade: "HB", gravewalker: "GW", ashborn_bulwark: "AB", veilshot: "VS", ember_acolyte: "EA", hollow_warden: "HW" };
const SHORT_SUMMON: Record<string, string> = Object.fromEntries(Object.entries(SUMMON_SHORT).map(([k, v]) => [v, k]));
const RARITY_CODE: Record<Rarity, string> = { common: "C", uncommon: "U", rare: "R", epic: "E", legendary: "L" };
const CODE_RARITY: Record<string, Rarity> = Object.fromEntries(Object.entries(RARITY_CODE).map(([k, v]) => [v, k as Rarity]));
const SLOT_CODE: Record<EquipSlot, string> = { weapon: "W", helm: "H", chest: "C", gloves: "G", boots: "B", relic: "R" };
const CODE_SLOT: Record<string, EquipSlot> = Object.fromEntries(Object.entries(SLOT_CODE).map(([k, v]) => [v, k as EquipSlot]));

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9.-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export function encodePayload(r: CodeReward): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`G${Math.floor(r.gold)}`);
  if (r.essence) parts.push(`E${Math.floor(r.essence)}`);
  if (r.riftCores) parts.push(`K${Math.floor(r.riftCores)}`);
  if (r.summonId) {
    const s = SUMMON_SHORT[r.summonId];
    if (!s) throw new Error(`Unknown summon ${r.summonId}`);
    parts.push(`S${s}`);
  }
  if (r.item) parts.push(`I${RARITY_CODE[r.item.rarity]}${r.item.slot ? SLOT_CODE[r.item.slot] : ""}`);
  if (parts.length === 0) throw new Error("Empty reward");
  return parts.join(".");
}

export function parsePayload(payload: string): CodeReward | null {
  const r: CodeReward = {};
  if (!payload) return null;
  for (const part of payload.split(".")) {
    const kind = part.charAt(0);
    const rest = part.slice(1);
    switch (kind) {
      case "G":
      case "E":
      case "K": {
        const n = Number(rest);
        if (!Number.isInteger(n) || n <= 0 || n > 1_000_000_000) return null;
        if (kind === "G") r.gold = n;
        if (kind === "E") r.essence = n;
        if (kind === "K") r.riftCores = n;
        break;
      }
      case "S": {
        const id = SHORT_SUMMON[rest];
        if (!id || !SUMMONS[id]) return null;
        r.summonId = id;
        break;
      }
      case "N": {
        // Nonce: makes each generated code distinct so mates each get their own. Ignored for rewards.
        if (!/^[A-Z0-9]{2,8}$/.test(rest)) return null;
        break;
      }
      case "I": {
        const rarity = CODE_RARITY[rest.charAt(0)];
        if (!rarity) return null;
        const slot = rest.charAt(1) ? CODE_SLOT[rest.charAt(1)] : undefined;
        if (rest.charAt(1) && !slot) return null;
        r.item = { rarity, slot };
        break;
      }
      default:
        return null;
    }
  }
  return Object.keys(r).length > 0 ? r : null;
}

export function withNonce(payload: string, nonce: string): string {
  return `${payload}.N${nonce}`;
}

const B32 = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

async function sha256(text: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(text);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(buf);
}

export async function signPayload(payload: string, secret: string): Promise<string> {
  const h = await sha256(`${secret}|${payload}`);
  let out = "";
  for (let i = 0; i < 6; i++) out += B32[(h[i] as number) % B32.length];
  return out;
}

export async function makeCode(reward: CodeReward, secret = codeSecret()): Promise<string> {
  const payload = encodePayload(reward);
  return `ASC-${payload}-${await signPayload(payload, secret)}`;
}

export type CodeCheck = { ok: true; reward: CodeReward; key: string } | { ok: false; reason: "format" | "signature" | "unknown" };

export async function verifyCode(input: string, secret = codeSecret()): Promise<CodeCheck> {
  const code = normalizeCode(input);
  if (!code) return { ok: false, reason: "format" };
  const named = NAMED_CODES[code];
  if (named) return { ok: true, reward: named, key: code };
  const m = /^ASC-([A-Z0-9.]+)-([A-Z0-9]{6})$/.exec(code);
  if (!m) return { ok: false, reason: "unknown" };
  const payload = m[1] as string;
  const sig = m[2] as string;
  const reward = parsePayload(payload);
  if (!reward) return { ok: false, reason: "format" };
  const expected = await signPayload(payload, secret);
  if (expected !== sig) return { ok: false, reason: "signature" };
  return { ok: true, reward, key: code };
}

export function describeReward(r: CodeReward): string {
  const parts: string[] = [];
  if (r.gold) parts.push(`${r.gold} gold`);
  if (r.essence) parts.push(`${r.essence} essence`);
  if (r.riftCores) parts.push(`${r.riftCores} Rift Core${r.riftCores > 1 ? "s" : ""}`);
  if (r.summonId) parts.push(SUMMONS[r.summonId]?.name ?? r.summonId);
  if (r.item) parts.push(`a ${r.item.rarity} ${r.item.slot ?? "item"}`);
  return parts.join(", ");
}
