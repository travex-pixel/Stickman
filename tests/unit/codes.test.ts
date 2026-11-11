import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { encodePayload, makeCode, normalizeCode, parsePayload, verifyCode, NAMED_CODES } from "@/game/economy/codes";

describe("gift codes", () => {
  it("round-trips rewards through a signed code", async () => {
    const code = await makeCode({ gold: 500, essence: 100, riftCores: 1, summonId: "veilshot", item: { rarity: "rare", slot: "weapon" } }, "s3cret");
    expect(code.startsWith("ASC-")).toBe(true);
    const r = await verifyCode(code, "s3cret");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reward).toEqual({ gold: 500, essence: 100, riftCores: 1, summonId: "veilshot", item: { rarity: "rare", slot: "weapon" } });
  });
  it("rejects tampered payloads and wrong secrets", async () => {
    const code = await makeCode({ gold: 500 }, "s3cret");
    const tampered = code.replace("G500", "G99999");
    expect((await verifyCode(tampered, "s3cret")).ok).toBe(false);
    expect((await verifyCode(code, "other")).ok).toBe(false);
    expect((await verifyCode("hello", "s3cret")).ok).toBe(false);
  });
  it("normalises user input (case, spaces, stray characters)", async () => {
    const code = await makeCode({ essence: 50 }, "s3cret");
    const messy = ` ${code.toLowerCase().replace("-", " - ")} `;
    expect(normalizeCode(messy)).toBe(code);
    expect((await verifyCode(messy, "s3cret")).ok).toBe(true);
  });
  it("accepts named codes", async () => {
    for (const key of Object.keys(NAMED_CODES)) expect((await verifyCode(key.toLowerCase())).ok).toBe(true);
  });
  it("rejects malformed payloads", () => {
    expect(parsePayload("G-5")).toBeNull();
    expect(parsePayload("SZZ")).toBeNull();
    expect(parsePayload("IQ")).toBeNull();
    expect(parsePayload("")).toBeNull();
    expect(() => encodePayload({})).toThrow();
  });
  it("the CLI generator produces codes the client verifies", async () => {
    const script = path.resolve(process.cwd(), "scripts/make-code.mjs");
    const out = execFileSync("node", [script, "--gold", "250", "--essence", "20", "--secret", "cli-secret"], { encoding: "utf8" }).trim();
    const r = await verifyCode(out, "cli-secret");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.reward).toEqual({ gold: 250, essence: 20 });
    const many = execFileSync("node", [script, "--essence", "20", "--count", "3", "--secret", "cli-secret"], { encoding: "utf8" }).trim().split("\n");
    expect(new Set(many).size).toBe(3);
    for (const c of many) expect((await verifyCode(c, "cli-secret")).ok).toBe(true);
  });
});
