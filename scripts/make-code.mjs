#!/usr/bin/env node
/**
 * Generate ASCEND gift codes for friends.
 *
 *   npm run code -- --gold 500 --essence 100
 *   npm run code -- --summon veilshot --count 5        (five distinct codes)
 *   npm run code -- --cores 1 --item rare:weapon
 *
 * Options: --gold N --essence N --cores N --summon <id> --item <rarity[:slot]>
 *          --count N (default 1) --secret S (default NEXT_PUBLIC_ASCEND_CODE_SECRET or the dev secret)
 *
 * The game verifies codes with NEXT_PUBLIC_ASCEND_CODE_SECRET, so use the same secret here
 * as the one set in Vercel. Every code can be redeemed once per save.
 */
import { createHash, randomBytes } from "node:crypto";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const secret = opt("secret") ?? process.env.NEXT_PUBLIC_ASCEND_CODE_SECRET ?? "ascend-dev-secret";
const count = Math.max(1, Math.min(500, Number(opt("count") ?? "1")));
const SUMMON_SHORT = { husk_blade: "HB", gravewalker: "GW", ashborn_bulwark: "AB", veilshot: "VS", ember_acolyte: "EA", hollow_warden: "HW" };
const RARITY = { common: "C", uncommon: "U", rare: "R", epic: "E", legendary: "L" };
const SLOT = { weapon: "W", helm: "H", chest: "C", gloves: "G", boots: "B", relic: "R" };
const B32 = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

const parts = [];
const int = (name) => {
  const v = Number(opt(name));
  if (!Number.isInteger(v) || v <= 0) throw new Error(`--${name} must be a positive whole number`);
  return v;
};
if (opt("gold")) parts.push(`G${int("gold")}`);
if (opt("essence")) parts.push(`E${int("essence")}`);
if (opt("cores")) parts.push(`K${int("cores")}`);
if (opt("summon")) {
  const s = SUMMON_SHORT[opt("summon")];
  if (!s) throw new Error(`Unknown summon. Options: ${Object.keys(SUMMON_SHORT).join(", ")}`);
  parts.push(`S${s}`);
}
if (opt("item")) {
  const [rarity, slot] = opt("item").split(":");
  if (!RARITY[rarity]) throw new Error(`Unknown rarity. Options: ${Object.keys(RARITY).join(", ")}`);
  if (slot && !SLOT[slot]) throw new Error(`Unknown slot. Options: ${Object.keys(SLOT).join(", ")}`);
  parts.push(`I${RARITY[rarity]}${slot ? SLOT[slot] : ""}`);
}
if (parts.length === 0) {
  console.error("Nothing to give. Use --gold, --essence, --cores, --summon or --item. See the header of scripts/make-code.mjs.");
  process.exit(1);
}

const sign = (payload) => {
  const h = createHash("sha256").update(`${secret}|${payload}`).digest();
  let sig = "";
  for (let j = 0; j < 6; j++) sig += B32[h[j] % B32.length];
  return sig;
};
const nonce = () => Array.from(randomBytes(4), (b) => B32[b % B32.length]).join("");

const seen = new Set();
while (seen.size < count) {
  const payload = count > 1 ? `${parts.join(".")}.N${nonce()}` : parts.join(".");
  seen.add(`ASC-${payload}-${sign(payload)}`);
}
for (const c of seen) console.log(c);
