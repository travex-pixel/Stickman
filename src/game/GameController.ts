import { Store } from "@/lib/store";
import { World, FIXED_DT, type WorldSnapshot } from "./engine/World";
import { GameLoop } from "./engine/GameLoop";
import type { GameEvent } from "./engine/events";
import { Rng } from "./engine/rng";
import type { AbilityId, EquipSlot, PanelId, SummonCommand, UpgradeableStat, WeaponPath } from "./data/ids";
import { createDefaultProfile, type EquipmentItem, type Profile, type SummonInstance } from "./progression/profile";
import { buildLoadout } from "./progression/loadout";
import { applyXp } from "./progression/xp";
import { upgradeStat as doUpgradeStat, type UpgradeAttempt } from "./progression/upgrades";
import { unlockSkill as doUnlockSkill } from "./progression/skills";
import { anyAbilityRankReady, rankAbility as doRankAbility } from "./progression/abilityRanks";
import { offerPerks, takePerk as doTakePerk } from "./progression/perks";
import { claimQuest as doClaimQuest, currentQuest, isQuestComplete } from "./progression/quests";
import { evaluateAchievements, evaluateJournal } from "./progression/achievements";
import { computeModifiers, isStatUnlocked, statUpgradeCost } from "./progression/stats";
import { claimEssence as doClaimEssence, setDeployed, type ClaimOutcome } from "./summons/recruitment";
import { CODEX_STAR_STEP, resolveExtraction, speciesStars } from "./summons/extraction";
import { STAT_LABEL } from "./data/equipment";
import { bondCost, BOND_CAP, canStarUp, checkEvolution, evolveSummon, grantSummonXp, starCost, starUp } from "./summons/progression";
import { enemyDef } from "./data/enemies";
import { MODES, RIFT_ESSENCE_PER_KILL, type ModeId } from "./data/modes";
import { REPEAT_BOSS_CORE_CHANCE, shadowXpShare, skillPointsBetween, stageClearCores, stageClearGold, stageClearXp } from "./economy/rewards";
import { isBossStage } from "./data/regions";
import { RANK_STEPS, nextRankStep, promote } from "./progression/ranks";
import { ELITES } from "./data/elites";
import { GEAR_EFFECTS } from "./data/gearEffects";
import { stageScale } from "./data/regions";
import { EQUIPMENT_LEVEL_CAP, equipmentUpgradeCost, fuseItems, salvageValue } from "./economy/loot";
import { INVENTORY_CAP } from "./data/equipment";
import { IndexedDbSaveManager } from "@/persistence/SaveManager";
import { computeOfflineReward, type OfflineReward } from "@/persistence/OfflineRewards";
import { AudioManager } from "./audio/AudioManager";
import type { SfxName } from "./audio/synth";
import type { PerkDef } from "./data/perks";
import { TUTORIAL_STEPS, type TutorialStep, type TutorialStepId } from "./tutorial";
import type { BattleRenderer } from "./render/BattleRenderer";
import { summonDef } from "./data/summons";
import { WEAPON_PATHS } from "./progression/weaponPaths";
import { describeReward, verifyCode } from "./economy/codes";
import { generateItem } from "./economy/loot";
import { ABILITIES } from "./data/abilities";

export type Modal =
  | { kind: "summon_reveal"; outcome: ClaimOutcome; summonId: string; first: boolean; cinematicDone: boolean }
  | { kind: "perk_choice"; perks: PerkDef[] }
  | { kind: "stage_clear"; stage: number; gold: number; xp: number; items: EquipmentItem[]; riftCores: number; nextStage: number }
  | { kind: "defeat"; stage: number; wave: number }
  | { kind: "offline"; reward: OfflineReward }
  | { kind: "settings" }
  | { kind: "weapon_path" }
  | { kind: "journal" }
  | { kind: "boss_intro"; defId: string }
  | { kind: "mode_result"; mode: ModeId; title: string; subtitle: string; lines: { label: string; value: string; tone?: "gold" | "jade" | "violet" }[]; success: boolean; record?: boolean }
  | { kind: "rank_up"; from: number; to: number; rewards: string[] };

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "gold" | "essence" | "warn" | "level";
}

export interface UiState {
  panel: PanelId;
  modal: Modal | null;
  toasts: Toast[];
  guide: { target: string; label: string; gesture: "point" | "tap" | "hold" } | null;
  tutorialStep: TutorialStepId | null;
  booted: boolean;
  loadNote: string | null;
  newBadges: Partial<Record<PanelId, boolean>>;
  selectedSummon: string | null;
  selectedItem: string | null;
  paused: boolean;
}

export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
  depthScale: number;
  width: number;
  height: number;
}

interface ProfileWrap {
  profile: Profile;
  v: number;
}

/**
 * GameController owns the whole runtime: profile, world, loop, renderer, audio, persistence and UI state.
 * React talks to it through stores and methods; the simulation never imports React.
 */
export class GameController {
  readonly profileStore = new Store<ProfileWrap>({ profile: createDefaultProfile(), v: 0 });
  readonly hudStore = new Store<WorldSnapshot | null>(null);
  readonly uiStore = new Store<UiState>({
    panel: "hero",
    modal: null,
    toasts: [],
    guide: null,
    tutorialStep: null,
    booted: false,
    loadNote: null,
    newBadges: {},
    selectedSummon: null,
    selectedItem: null,
    paused: false,
  });
  /** Rendered rig portraits by key ("summon:husk_blade"), filled on demand once the renderer is up. */
  readonly portraitStore = new Store<Record<string, string>>({});
  private portraitQueue = new Set<string>();

  requestPortrait(defId: string, kind: "summon" | "enemy"): void {
    const key = `${kind}:${defId}`;
    if (this.portraitStore.get()[key] || this.portraitQueue.has(key)) return;
    this.portraitQueue.add(key);
    void this.drainPortraits();
  }

  private portraitBusy = false;
  private async drainPortraits(): Promise<void> {
    if (this.portraitBusy || !this.renderer) return;
    this.portraitBusy = true;
    try {
      while (this.portraitQueue.size > 0 && this.renderer) {
        const key = this.portraitQueue.values().next().value as string;
        const [kind, defId] = key.split(":") as ["summon" | "enemy", string];
        const url = await this.renderer?.portrait(defId, kind);
        this.portraitQueue.delete(key);
        if (url) this.portraitStore.update((m) => ({ ...m, [key]: url }));
      }
    } finally {
      this.portraitBusy = false;
    }
  }

  /** Diagnostics live in their own store so the HUD never re-renders for them. */
  readonly diagStore = new Store<{ fps: number; particles: number; entities: number; renderer: string; frameMs: number }>({ fps: 0, particles: 0, entities: 0, renderer: "", frameMs: 0 });
  private diagAccum = 0;
  readonly audio = new AudioManager();
  readonly save = new IndexedDbSaveManager();
  world: World | null = null;
  renderer: BattleRenderer | null = null;
  view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0, depthScale: 1, width: 0, height: 0 };
  private loop: GameLoop;
  private hudAccum = 0;
  private toastId = 0;
  private modalQueue: Modal[] = [];
  private rankBadgeShown = false;
  private tutorialElapsed = 0;
  private tutorialSubstep = 0;
  private enemyWindupNearPlayer = false;
  private disposed = false;
  private rng = new Rng(Date.now() >>> 0);
  private visibilityHandler = () => this.onVisibility();
  private pageHideHandler = () => {
    this.save.stashUnsaved();
    void this.save.flush();
  };
  private booted = false;
  private cinematicTimer: ReturnType<typeof setTimeout> | null = null;
  private seenAffixes = new Set<string>();
  private seenPerfect = false;

  constructor() {
    this.loop = new GameLoop(FIXED_DT, (dt) => this.simulate(dt), (alpha, dtReal) => this.render(alpha, dtReal));
  }

  get profile(): Profile {
    return this.profileStore.get().profile;
  }

  // ---------------------------------------------------------------------
  // Boot / lifecycle
  // ---------------------------------------------------------------------

  async boot(): Promise<void> {
    if (this.booted) return;
    this.booted = true;
    const result = await this.save.load();
    if (this.disposed) return;
    const profile = result.profile;
    const now = Date.now();
    let note: string | null = null;
    if (result.repaired) note = "Your save was repaired.";
    if (result.migrated) note = "Your save was updated.";
    if (result.fromBackup) note = "Your save was restored from its backup.";
    if (result.readOnly) note = "Your save could not be read safely. It is untouched; progress this session will not be saved.";
    if (!result.fresh) {
      const reward = computeOfflineReward(profile.lastActive, now, profile.progress.currentStage, computeModifiers(profile).goldFind);
      if (reward && reward.gold > 0) this.enqueueModal({ kind: "offline", reward });
    }
    profile.lastActive = now;
    profile.progress.runs += 1;
    this.profileStore.set({ profile, v: 1 });
    this.refreshKeys();
    this.profileStore.set({ profile, v: 1 });
    this.audio.init();
    this.audio.setVolumes(profile.settings.music, profile.settings.sfx);
    this.startRun(profile.progress.currentStage);
    this.uiStore.update((u) => ({ ...u, booted: true, loadNote: note }));
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.visibilityHandler);
      window.addEventListener("pagehide", this.pageHideHandler);
    }
    if (this.disposed) return;
    this.loop.start();
    this.flushModalQueue();
    if (note) setTimeout(() => this.toast(note as string, result.readOnly ? "warn" : "info"), 1200);
  }

  private attaching = false;
  private rendererHost: HTMLElement | null = null;

  async attachRenderer(host: HTMLElement): Promise<void> {
    this.rendererHost = host;
    if (this.renderer || this.disposed || this.attaching) return;
    this.attaching = true;
    try {
      const mod = await import("./render/BattleRenderer");
      if (this.disposed || this.rendererHost !== host) return;
      const renderer = new mod.BattleRenderer(this);
      await renderer.mount(host);
      if (this.disposed || this.rendererHost !== host) {
        renderer.unmount();
        return;
      }
      this.renderer = renderer;
      renderer.setReducedEffects(this.profile.settings.reducedEffects);
      if (this.world) renderer.setWorld(this.world);
      void this.drainPortraits();
    } catch (err) {
      console.error("[ASCEND] renderer failed to start", err);
      this.toast("Graphics could not start on this device.", "warn");
    } finally {
      this.attaching = false;
    }
  }

  detachRenderer(): void {
    this.rendererHost = null;
    this.renderer?.unmount();
    this.renderer = null;
  }

  dispose(): void {
    this.disposed = true;
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.loop.stop();
    this.detachRenderer();
    this.world?.dispose();
    this.world = null;
    this.audio.dispose();
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      window.removeEventListener("pagehide", this.pageHideHandler);
    }
    void this.save.flush();
  }

  /** Any user gesture unlocks audio. */
  userGesture(): void {
    this.audio.unlock();
  }

  private onVisibility(): void {
    if (typeof document === "undefined") return;
    if (document.hidden) {
      this.audio.suspend();
      this.profile.lastActive = Date.now();
      this.save.schedule(this.profile, 0);
      this.save.stashUnsaved();
      void this.save.flush();
      this.loop.stop();
    } else {
      this.loop.resync();
      this.loop.start();
      this.audio.resume();
    }
  }

  // ---------------------------------------------------------------------
  // Run management
  // ---------------------------------------------------------------------

  startRun(stage: number, mode: ModeId = "campaign"): void {
    this.world?.dispose();
    const loadout = buildLoadout(this.profile);
    this.world = new World({ stage, loadout, mode, seed: (Date.now() ^ (stage * 2654435761)) >>> 0 });
    this.run = { gold: 0, kills: 0, raised: 0, mode };
    this.renderer?.setWorld(this.world);
    this.hudStore.set(this.world.snapshot());
  }

  /** Per-run tallies for the result screens. */
  private run: { gold: number; kills: number; raised: number; mode: ModeId } = { gold: 0, kills: 0, raised: 0, mode: "campaign" };

  get mode(): ModeId {
    return this.world?.mode ?? "campaign";
  }

  /** Keys refill at local midnight. Missing a day never costs anything. */
  refreshKeys(now = new Date()): void {
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const m = this.profile.modes;
    if (m.keyDay !== day) {
      m.keyDay = day;
      m.keys = { vault: MODES.vault.dailyKeys ?? 3, rift: MODES.rift.dailyKeys ?? 3 };
      this.commit();
    }
  }

  modeAvailability(mode: ModeId): { ok: boolean; reason?: string } {
    const p = this.profile;
    const def = MODES[mode];
    if (mode === "trial") {
      const step = nextRankStep(p);
      if (!step) return { ok: false, reason: "S rank reached" };
      if (p.player.level < step.level) return { ok: false, reason: `Reach level ${step.level}` };
      return { ok: true };
    }
    if (p.progress.bestStage < def.unlockAfterStage) return { ok: false, reason: `Clear stage ${def.unlockAfterStage}` };
    if (mode === "vault" || mode === "rift") {
      if (p.modes.keys[mode] <= 0) return { ok: false, reason: "Keys refill tomorrow" };
    }
    return { ok: true };
  }

  startMode(mode: ModeId): boolean {
    this.userGesture();
    this.refreshKeys();
    const avail = this.modeAvailability(mode);
    if (!avail.ok) {
      this.sfx("error", { volume: 0.4 });
      this.toast(avail.reason ?? "Locked", "warn");
      return false;
    }
    const p = this.profile;
    if (mode === "vault" || mode === "rift") p.modes.keys[mode] -= 1;
    const frontier = Math.max(1, p.progress.bestStage);
    const stage = mode === "trial" ? (nextRankStep(p)?.trialStage ?? frontier) : frontier;
    this.closeModal();
    this.commit();
    this.startRun(stage, mode);
    this.sfx("boss_intro", { volume: 0.45, rate: 1.4 });
    this.toast(MODES[mode].name, "level");
    return true;
  }

  /** Leave a mode early or after its result and return to the campaign frontier. */
  returnToCampaign(): void {
    this.userGesture();
    this.closeModal();
    this.startRun(this.profile.progress.currentStage, "campaign");
  }

  private commitTimer: ReturnType<typeof setTimeout> | null = null;

  /** Combat produces a stream of small changes; publish them to React at most every 150 ms. */
  private commitSoon(): void {
    if (this.commitTimer) return;
    this.commitTimer = setTimeout(() => {
      this.commitTimer = null;
      this.commit();
    }, 150);
  }

  private commit(): void {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    const p = this.profile;
    p.lastActive = Date.now();
    this.profileStore.set({ profile: p, v: this.profileStore.get().v + 1 });
    this.save.schedule(p);
  }

  /** Re-derive the player's loadout after any progression change and push it into the live world. */
  private refreshLoadout(): void {
    if (!this.world) return;
    this.world.setLoadout(buildLoadout(this.profile));
  }

  // ---------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------

  private get paused(): boolean {
    const ui = this.uiStore.get();
    return ui.modal !== null && ui.modal.kind !== "boss_intro";
  }

  /** 2x battle speed unlocks after clearing stage 3; it never changes the simulation, only how many steps run per frame. */
  get battleSpeedUnlocked(): boolean {
    return this.profile.progress.bestStage >= 3;
  }

  private simulate(dt: number): void {
    const world = this.world;
    if (!world) return;
    const steps = this.battleSpeedUnlocked && this.profile.settings.battleSpeed === 2 && world.phase !== "defeat" && world.phase !== "victory" && world.phase !== "boss_intro" ? 2 : 1;
    if (!this.paused) for (let i = 0; i < steps; i++) world.update(dt);
    this.processEvents(world.drainEvents());
    this.tutorialElapsed += dt;
    this.hudAccum += dt;
    if (this.hudAccum >= 0.08) {
      this.hudAccum = 0;
      const snap = world.snapshot();
      this.hudStore.set(snap);
      this.updateTutorial(snap);
    }
  }

  private lastRenderErrorAt = -Infinity;

  private render(alpha: number, dtReal: number): void {
    const r = this.renderer;
    if (r) {
      try {
        r.render(alpha, dtReal, this.paused);
      } catch (err) {
        const now = performance.now();
        if (now - this.lastRenderErrorAt > 5000) {
          this.lastRenderErrorAt = now;
          console.error("[ASCEND] render error", err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : err);
        }
        return;
      }
      this.diagAccum += dtReal;
      if (this.diagAccum >= 0.5 && this.profile.settings.diagnostics) {
        this.diagAccum = 0;
        this.diagStore.set({ fps: this.loop.fps, ...r.stats(), frameMs: Math.round(this.loop.frameMs * 10) / 10 });
      }
    }
  }

  // ---------------------------------------------------------------------
  // Event processing: simulation -> progression, audio, UI
  // ---------------------------------------------------------------------

  private processEvents(events: GameEvent[]): void {
    if (events.length === 0) return;
    const p = this.profile;
    let dirty = false;
    let gold = 0;
    let xp = 0;
    let kills = 0;
    this.renderer?.handleEvents(events);
    for (const e of events) {
      switch (e.type) {
        case "hit":
          if (e.faction === "enemy") {
            this.sfx(e.crit ? "crit" : e.heavy ? "hit_heavy" : "hit_light", { minInterval: e.crit ? 60 : 45, volume: e.crit ? 0.9 : 0.55, rate: 0.9 + Math.random() * 0.25 });
            // A short impact frame on the warrior's crits gives hits weight without slowing combat.
            if (e.crit && e.sourceId === this.world?.player.id && !p.settings.reducedEffects) this.loop.addFreeze(0.035);
          } else this.sfx("hit_heavy", { minInterval: 120, volume: 0.6, rate: 0.8 });
          break;
        case "death":
          if (e.kind === "enemy" || e.kind === "boss") {
            kills += 1;
            p.progress.killsByEnemy[e.defId] = (p.progress.killsByEnemy[e.defId] ?? 0) + 1;
            this.sfx(e.kind === "boss" ? "boss_death" : "enemy_death", { volume: e.kind === "boss" ? 1 : 0.5, minInterval: 80, rate: 0.9 + Math.random() * 0.2 });
            if (e.kind === "boss") {
              p.progress.bossKills += 1;
              // First clears pay a core at the stage-clear screen; repeat kills have a chance here.
              const repeat = (this.world?.stage ?? 1) <= p.progress.bestStage;
              if (repeat && this.rng.chance(REPEAT_BOSS_CORE_CHANCE)) {
                p.player.riftCores += 1;
                this.toast("Rift Core recovered", "essence");
              }
            }
            // The whole army learns from every kill: deployed shadows fully, the bench at 40%.
            const def = enemyDef(e.defId);
            const xpMult = computeModifiers(p).summonXpMult;
            for (const s of p.summons.collection) {
              const before = s.level;
              grantSummonXp(s, shadowXpShare(def.xp, this.world?.scaleStage ?? 1, s.deployed, xpMult));
              if (s.level > before && s.deployed) this.toast(`${summonDef(s.defId).name} reached level ${s.level}`, "level");
            }
            dirty = true;
          } else if (e.kind === "summon") {
            this.toast("A companion has fallen. It will return.", "warn");
          }
          break;
        case "gold":
          gold += e.amount;
          break;
        case "xp":
          xp += e.amount;
          break;
        case "cast":
          if (e.id === this.world?.player.id) {
            p.progress.abilityCasts += 1;
            if (e.ability !== "shadow_dash") this.completeTutorialIf("ability");
            dirty = true;
            this.sfx(castSfx(e.ability), { volume: e.ability === "ascendant_fury" ? 1 : 0.8, minInterval: 150 });
            if (e.ability === "ascendant_fury") this.renderer?.flash(0xffd36b, 0.35);
          }
          break;
        case "dodge":
          if (e.id === this.world?.player.id) {
            this.sfx("dodge", { volume: 0.6 });
            this.completeTutorialIf("dodge");
          }
          break;
        case "attack_swing":
          if (e.kind === "player") this.sfx("arc_slash", { volume: 0.12, minInterval: 90, rate: 1.4 + Math.random() * 0.3 });
          break;
        case "essence_available":
          this.sfx("essence_appear", { volume: 0.9 });
          this.toast(e.isBoss ? "The Warden's essence lingers. Claim it." : "Essence lingers. Claim it before it fades.", "essence");
          break;
        case "command":
          this.sfx("command", { volume: 0.6 });
          break;
        case "wave_start":
          if (e.wave === 1 && this.world?.stage === 1 && !p.tutorial.finished) this.toast("The Ashen Verge. Hold the line.", "info");
          break;
        case "boss_intro":
          this.sfx("boss_intro", { volume: 1 });
          this.renderer?.shake(10);
          break;
        case "boss_phase":
          this.sfx("void_nova", { volume: 0.9 });
          this.toast("The Warden remembers its oath. Phase two.", "warn");
          break;
        case "stage_cleared":
          if (e.mode === "campaign") this.onStageCleared(e.stage);
          else this.onModeCleared(e.mode as ModeId, e.wave, e.time);
          dirty = true;
          break;
        case "player_defeated":
          this.sfx("boss_intro", { volume: 0.6, rate: 1.6 });
          if (e.mode === "endless") this.onEndlessOver(e.wave);
          else if (e.mode === "campaign") {
            this.coachUpgrade = true;
            this.enqueueModal({ kind: "defeat", stage: e.stage, wave: e.wave });
          }
          else this.enqueueModal({ kind: "mode_result", mode: e.mode as ModeId, title: "You fell", subtitle: MODES[e.mode as ModeId].name, lines: [{ label: "Kills", value: `${this.run.kills}` }, { label: "Gold kept", value: `${this.run.gold}` }], success: false });
          break;
        case "loot":
          this.sfx("equip", { volume: 0.4 });
          break;
        case "elite_spawn": {
          const d = ELITES[e.affix as keyof typeof ELITES];
          if (!d) break;
          const name = `${d.name} ${enemyDef(e.defId).name}`;
          if (!this.seenAffixes.has(e.affix)) {
            this.seenAffixes.add(e.affix);
            this.toast(`Elite: ${name}. ${d.blurb}`, "warn");
          } else this.toast(`Elite: ${name}`, "warn");
          this.sfx("boss_intro", { volume: 0.35, rate: 1.8, minInterval: 800 });
          break;
        }
        case "shard_gain": {
          const inst = p.summons.collection.find((x) => x.defId === e.summonId || summonDef(x.defId).evolvedFrom === e.summonId);
          if (inst) {
            inst.shards += e.amount;
            p.player.essence += 3 * e.amount;
            dirty = true;
          }
          break;
        }
        case "perfect_dodge":
          this.sfx("crit", { volume: 0.8, rate: 1.3 });
          if (!this.seenPerfect) {
            this.seenPerfect = true;
            this.toast("Perfect dodge: your next strike is a guaranteed critical.", "level");
          }
          break;
        case "kill_streak":
          this.sfx("quest", { volume: 0.5, rate: 0.8 + Math.min(0.8, e.count / 25) });
          break;
        case "finisher":
          this.sfx(e.boss ? "boss_death" : "hit_heavy", { volume: e.boss ? 0.6 : 0.8, rate: 0.7 });
          break;
        case "guard_break":
          this.sfx("hit_heavy", { volume: 0.9, rate: 0.7, minInterval: 120 });
          break;
        case "blocked":
          this.sfx("equip", { volume: 0.25, rate: 1.6, minInterval: 160 });
          break;
        case "ultimate_ready":
          this.sfx("quest", { volume: 0.5, rate: 0.8 });
          this.toast("Ascendant Fury is ready", "level");
          break;
        case "summon_ability":
          this.sfx("command", { volume: 0.35, rate: 0.6, minInterval: 300 });
          break;
        case "shake":
          this.renderer?.shake(e.strength);
          break;
        case "freeze":
          this.loop.addFreeze(e.duration);
          break;
        default:
          break;
      }
    }
    if (gold > 0) {
      p.player.gold += gold;
      this.run.gold += gold;
      this.sfx("gold", { volume: 0.35, minInterval: 120, rate: 0.95 + Math.random() * 0.2 });
      dirty = true;
    }
    if (kills > 0) {
      p.progress.totalKills += kills;
      this.run.kills += kills;
      if (this.mode === "rift") {
        p.player.essence += kills * RIFT_ESSENCE_PER_KILL;
      }
      dirty = true;
    }
    if (xp > 0) {
      const res = applyXp(p.player.level, p.player.xp, xp);
      p.player.level = res.level;
      p.player.xp = res.xp;
      if (res.levelsGained > 0) this.onLevelUp(res.levelsGained);
      dirty = true;
    }
    const loot = this.world?.takeLoot() ?? [];
    if (loot.length > 0) {
      for (const l of loot) this.addItem(l.item);
      dirty = true;
    }
    if (dirty) {
      this.afterProgression();
      this.commitSoon();
    }
  }

  private afterProgression(): void {
    const p = this.profile;
    const ui = this.uiStore.get();
    if (ui.panel !== "hero" && !ui.newBadges.hero) {
      const affordable = (["attack", "maxHp", "defense", "attackSpeed", "critChance", "critDamage"] as const).some((st) => isStatUnlocked(p, st) && statUpgradeCost(st, p.player.statLevels[st]) <= p.player.gold);
      if (affordable) this.uiStore.update((u) => ({ ...u, newBadges: { ...u.newBadges, hero: true } }));
    }
    if (ui.panel !== "skills" && !this.rankBadgeShown && anyAbilityRankReady(p)) {
      this.rankBadgeShown = true;
      this.uiStore.update((u) => ({ ...u, newBadges: { ...u.newBadges, skills: true } }));
    }
    const newAch = evaluateAchievements(p);
    for (const id of newAch) this.toast(`Achievement: ${id.replace(/_/g, " ")}`, "level");
    const newJournal = evaluateJournal(p);
    if (newJournal.length > 0) this.uiStore.update((u) => ({ ...u, newBadges: { ...u.newBadges, rift: true } }));
    const q = currentQuest(p);
    if (q && isQuestComplete(p, q) && !p.progress.quest.complete) {
      p.progress.quest.complete = true;
      this.sfx("quest", { volume: 0.7 });
    }
  }

  private onLevelUp(levels: number): void {
    const p = this.profile;
    p.player.skillPoints += skillPointsBetween(p.player.level - levels, p.player.level);
    p.player.pendingPerkChoices += levels;
    this.sfx("level_up", { volume: 0.9 });
    this.toast(`Warrior level ${p.player.level}`, "level");
    this.renderer?.levelUpBurst();
    if (this.world && !this.world.player.dead) {
      this.world.player.hp = Math.min(this.world.player.stats.maxHp, this.world.player.hp + this.world.player.stats.maxHp * 0.3);
    }
    for (const id of Object.keys(ABILITIES) as AbilityId[]) {
      if (ABILITIES[id].unlockLevel === p.player.level) this.toast(`New ability: ${ABILITIES[id].name}`, "level");
    }
    this.uiStore.update((u) => ({ ...u, newBadges: { ...u.newBadges, skills: true } }));
    this.refreshLoadout();
    // Perks wait for the player: a chip pulses in the HUD instead of a modal freezing the fight.
    this.toast("Ascension ready: choose a perk", "level");
  }

  /** Opens the perk choice when the player taps the HUD chip. */
  openPerkChoice(): void {
    this.userGesture();
    this.offerPerkChoice();
  }

  private offerPerkChoice(): void {
    if (this.profile.player.pendingPerkChoices <= 0) return;
    this.enqueueModal({ kind: "perk_choice", perks: offerPerks(this.profile, this.rng) });
  }

  private onStageCleared(stage: number): void {
    const p = this.profile;
    const firstClear = stage > p.progress.bestStage;
    // Replays pay less, so pushing forward is always the better use of time.
    const gold = Math.round(stageClearGold(stage, computeModifiers(p).goldFind) * (firstClear ? 1 : 0.5));
    const xp = Math.round(stageClearXp(stage) * (firstClear ? 1 : 0.5));
    p.player.gold += gold;
    const res = applyXp(p.player.level, p.player.xp, xp);
    p.player.level = res.level;
    p.player.xp = res.xp;
    p.progress.bestStage = Math.max(p.progress.bestStage, stage);
    p.progress.currentStage = Math.max(p.progress.currentStage, stage);
    const items = (this.world?.takeLoot() ?? []).map((l) => l.item);
    for (const it of items) this.addItem(it);
    const riftCores = stageClearCores(stage, firstClear, isBossStage(stage));
    p.player.riftCores += riftCores;
    this.sfx("level_up", { volume: 0.9, rate: 0.85 });
    this.enqueueModal({ kind: "stage_clear", stage, gold, xp, items, riftCores, nextStage: stage + 1 });
    if (res.levelsGained > 0) this.onLevelUp(res.levelsGained);
  }

  private onModeCleared(mode: ModeId, wave: number, time: number): void {
    const p = this.profile;
    this.sfx("level_up", { volume: 0.9, rate: 0.9 });
    if (mode === "trial") {
      const from = p.player.rank;
      const to = promote(p);
      this.refreshLoadout();
      this.renderer?.flash(0xe9c97a, 0.5);
      this.renderer?.levelUpBurst();
      this.enqueueModal({ kind: "rank_up", from, to, rewards: RANK_STEPS.find((r) => r.to === to)?.rewards ?? [] });
      return;
    }
    if (mode === "vault") {
      const best = p.modes.vaultBest;
      p.modes.vaultBest = Math.max(best, this.run.gold);
      this.enqueueModal({ kind: "mode_result", mode, title: "Vault emptied", subtitle: `${Math.round(time)} seconds`, lines: [{ label: "Gold", value: `+${this.run.gold}`, tone: "gold" }, { label: "Kills", value: `${this.run.kills}` }, { label: "Best haul", value: `${p.modes.vaultBest}` }], success: true, record: this.run.gold > best });
      return;
    }
    if (mode === "rift") {
      this.enqueueModal({ kind: "mode_result", mode, title: "Rift sealed", subtitle: `${wave} waves`, lines: [{ label: "Essence", value: `+${this.run.kills * RIFT_ESSENCE_PER_KILL}`, tone: "jade" }, { label: "Oaths bound", value: `${this.run.raised}` }, { label: "Gold", value: `+${this.run.gold}`, tone: "gold" }], success: true });
    }
  }

  private onEndlessOver(wave: number): void {
    const p = this.profile;
    const reached = Math.max(0, wave - 1);
    const best = p.modes.endlessBest;
    const scale = stageScale(Math.max(1, p.progress.bestStage)).reward;
    const gold = Math.round(reached * 45 * scale);
    const essence = reached * 6;
    p.player.gold += gold;
    p.player.essence += essence;
    p.modes.endlessBest = Math.max(best, reached);
    this.enqueueModal({ kind: "mode_result", mode: "endless", title: reached > best ? "New record" : "The climb ends", subtitle: `Wave ${reached} cleared`, lines: [{ label: "Gold", value: `+${gold + this.run.gold}`, tone: "gold" }, { label: "Essence", value: `+${essence}`, tone: "jade" }, { label: "Best", value: `Wave ${p.modes.endlessBest}` }], success: true, record: reached > best });
    this.afterProgression();
    this.commit();
  }

  private addItem(item: EquipmentItem): void {
    const p = this.profile;
    if (p.equipment.inventory.length >= INVENTORY_CAP) {
      p.player.gold += salvageValue(item);
      this.toast("Inventory full. Item salvaged for gold.", "warn");
      return;
    }
    p.equipment.inventory.push(item);
    // Loot announces itself in proportion to its worth.
    if (item.effect) {
      this.toast(`${item.rarity === "legendary" ? "Legendary" : "Epic"}: ${itemName(item)} ✦ ${GEAR_EFFECTS[item.effect].name}`, "gold");
      this.sfx("level_up", { volume: 0.7, rate: 1.15 });
      this.renderer?.flash(item.rarity === "legendary" ? 0xe9c56f : 0xb595e6, 0.18);
    } else this.toast(`Found: ${itemName(item)}`, "gold");
    this.uiStore.update((u) => ({ ...u, newBadges: { ...u.newBadges, gear: true } }));
  }

  // ---------------------------------------------------------------------
  // Player actions
  // ---------------------------------------------------------------------

  castAbility(id: AbilityId): boolean {
    this.userGesture();
    const ok = this.world?.castAbility(id) ?? false;
    if (!ok) this.sfx("error", { volume: 0.25, minInterval: 200 });
    return ok;
  }

  dodge(): boolean {
    this.userGesture();
    const ok = this.world?.dodge() ?? false;
    if (!ok) this.sfx("error", { volume: 0.25, minInterval: 200 });
    return ok;
  }

  toggleAutoCast(): void {
    this.userGesture();
    const p = this.profile;
    p.player.autoCast = !p.player.autoCast;
    this.world?.setAutoCast(p.player.autoCast);
    this.sfx("ui_tap");
    this.toast(p.player.autoCast ? "Auto abilities on" : "Auto abilities off", "info");
    this.commit();
  }

  setCommand(cmd: SummonCommand): void {
    this.userGesture();
    const p = this.profile;
    p.summons.command = cmd;
    this.world?.setCommand(cmd);
    this.completeTutorialIf("command");
    this.commit();
  }

  /**
   * BIND. Rolls against the chance shown on the button. The very first extraction always
   * succeeds so every new player gets their first shadow; after that, pity softens bad luck.
   */
  claimEssence(orbId: number): void {
    this.userGesture();
    const world = this.world;
    if (!world) return;
    const peek = world.peekOrb(orbId);
    if (!peek) return;
    const p = this.profile;
    const first = !p.summons.firstSummonSeen;
    p.summons.totalAttempts += 1;
    const roll = first ? 0 : this.rng.next();
    const result = resolveExtraction(p, peek.summonId, roll, { elite: peek.elite, bonus: computeModifiers(p).extractionBonus });
    if (!result.success) {
      const left = world.failExtraction(orbId);
      this.sfx("enemy_death", { volume: 0.8, rate: 0.55 });
      this.renderer?.playExtractionFail(peek.pos);
      const pity = p.summons.pity[peek.summonId] ?? 0;
      this.toast(left > 0 ? `The oath is refused. ${left} attempt${left > 1 ? "s" : ""} left.` : `The oath is refused. +${result.essenceOnFail} essence, next attempt +${Math.round(pity * 12)}%`, "warn");
      this.afterProgression();
      this.commit();
      return;
    }
    const orb = world.claimEssence(orbId);
    if (!orb) return;
    const outcome = doClaimEssence(p, orb.summonId);
    if (outcome.kind === "new") p.summons.firstSummonSeen = true;
    this.run.raised += 1;
    // The first shadow joins the fight at once: the player should see their army before learning menus.
    if (first && outcome.kind === "new" && outcome.instance) {
      setDeployed(p, outcome.instance.instanceId, true, computeModifiers(p).deploySlots);
      this.refreshLoadout();
      this.completeTutorialIf("deploy");
    }
    const big = outcome.kind === "new" && (first || summonDef(orb.summonId).rarity === "legendary" || summonDef(orb.summonId).rarity === "epic");
    const modal: Modal = { kind: "summon_reveal", outcome, summonId: orb.summonId, first: first && outcome.kind === "new", cinematicDone: false };
    this.sfx(big ? "summon_first" : "summon_claim", { volume: 1 });
    this.renderer?.playSummonCinematic(orb.summonId, orb.pos, big);
    this.uiStore.update((u) => ({ ...u, modal, newBadges: { ...u.newBadges, summons: true }, selectedSummon: outcome.instance?.instanceId ?? u.selectedSummon }));
    if (this.cinematicTimer) clearTimeout(this.cinematicTimer);
    // Spectacle scales with significance: first and rare shadows get the full rite, duplicates are quick.
    const duration = big ? 4600 : outcome.kind === "new" ? 1700 : 1100;
    this.cinematicTimer = setTimeout(() => {
      this.uiStore.update((u) => (u.modal?.kind === "summon_reveal" ? { ...u, modal: { ...u.modal, cinematicDone: true } } : u));
    }, duration);
    if (outcome.kind === "duplicate") this.toast(`+${outcome.essenceGained} Essence, +1 shard`, "essence");
    this.completeTutorialIf("summon");
    this.afterProgression();
    this.commit();
  }

  /** Called when the player closes the reveal. New summons auto-deploy when the tutorial is behind us and a slot is free. */
  finishSummonReveal(): void {
    const ui = this.uiStore.get();
    if (ui.modal?.kind !== "summon_reveal") return;
    const outcome = ui.modal.outcome;
    const p = this.profile;
    if (outcome.kind === "new" && outcome.instance && p.tutorial.completed.includes("deploy")) {
      const slots = computeModifiers(p).deploySlots;
      if (setDeployed(p, outcome.instance.instanceId, true, slots)) {
        this.toast(`${summonDef(outcome.instance.defId).name} deployed`, "essence");
        this.refreshLoadout();
      }
    }
    this.closeModal();
    this.commit();
  }

  upgradeStat(stat: UpgradeableStat): UpgradeAttempt {
    const res = doUpgradeStat(this.profile, stat);
    if (res.ok) {
      this.coachUpgrade = false;
      this.sfx("upgrade", { volume: 0.5, minInterval: 30, rate: 0.95 + Math.random() * 0.15 });
      this.refreshLoadout();
      this.completeTutorialIf("upgrade");
      this.afterProgression();
      this.commit();
    }
    return res;
  }

  equipItem(uid: string): boolean {
    this.userGesture();
    const p = this.profile;
    const item = p.equipment.inventory.find((i) => i.uid === uid);
    if (!item) return false;
    p.equipment.equipped[item.slot] = uid;
    this.sfx("equip", { volume: 0.7 });
    this.refreshLoadout();
    this.completeTutorialIf("gear");
    this.afterProgression();
    this.commit();
    return true;
  }

  unequipSlot(slot: EquipSlot): void {
    this.userGesture();
    delete this.profile.equipment.equipped[slot];
    this.refreshLoadout();
    this.commit();
  }

  upgradeItem(uid: string): boolean {
    const p = this.profile;
    const item = p.equipment.inventory.find((i) => i.uid === uid);
    if (!item || item.level >= EQUIPMENT_LEVEL_CAP) return false;
    const cost = equipmentUpgradeCost(item);
    if (p.player.gold < cost) return false;
    p.player.gold -= cost;
    item.level += 1;
    this.sfx("upgrade", { volume: 0.5, minInterval: 30 });
    this.refreshLoadout();
    this.commit();
    return true;
  }

  /** Forge three of a rarity into one of the next rarity, in the chosen item's slot. */
  fuseItem(uid: string): boolean {
    this.userGesture();
    const p = this.profile;
    const out = fuseItems(p, uid, this.rng, Math.max(1, p.progress.bestStage));
    if (!out) {
      this.sfx("error", { volume: 0.3 });
      return false;
    }
    const rare = out.rarity === "epic" || out.rarity === "legendary";
    this.sfx("equip", { volume: 0.6, rate: 0.8 });
    this.sfx(rare ? "quest" : "upgrade", { volume: 0.5 });
    this.renderer?.flash(rare ? 0xe9c97a : 0xd9cdb2, rare ? 0.3 : 0.15);
    this.toast(`Forged: ${itemName(out)} · ${out.rarity}${out.effect ? ` ✦ ${GEAR_EFFECTS[out.effect].name}` : ""}`, rare ? "gold" : "level");
    this.uiStore.update((u) => ({ ...u, selectedItem: out.uid }));
    this.afterProgression();
    this.commit();
    return true;
  }

  salvageItem(uid: string): void {
    this.userGesture();
    const p = this.profile;
    const idx = p.equipment.inventory.findIndex((i) => i.uid === uid);
    if (idx < 0) return;
    const item = p.equipment.inventory[idx] as EquipmentItem;
    for (const slot of Object.keys(p.equipment.equipped) as EquipSlot[]) if (p.equipment.equipped[slot] === uid) delete p.equipment.equipped[slot];
    p.equipment.inventory.splice(idx, 1);
    p.player.gold += salvageValue(item);
    this.sfx("gold", { volume: 0.5 });
    this.uiStore.update((u) => ({ ...u, selectedItem: null }));
    this.refreshLoadout();
    this.commit();
  }

  deploySummon(instanceId: string, deployed: boolean): boolean {
    this.userGesture();
    const slots = computeModifiers(this.profile).deploySlots;
    const ok = setDeployed(this.profile, instanceId, deployed, slots);
    if (!ok) {
      this.sfx("error", { volume: 0.3 });
      this.toast(`All ${slots} deployment slots are in use`, "warn");
      return false;
    }
    this.sfx(deployed ? "summon_claim" : "ui_tap", { volume: deployed ? 0.7 : 0.5 });
    this.refreshLoadout();
    if (deployed) this.completeTutorialIf("deploy");
    this.afterProgression();
    this.commit();
    return true;
  }

  upgradeBond(instanceId: string): boolean {
    const p = this.profile;
    const inst = p.summons.collection.find((s) => s.instanceId === instanceId);
    if (!inst || inst.bond >= BOND_CAP) return false;
    const cost = bondCost(inst.bond);
    if (p.player.essence < cost) return false;
    p.player.essence -= cost;
    inst.bond += 1;
    this.sfx("upgrade", { volume: 0.5, minInterval: 30, rate: 1.1 });
    this.refreshLoadout();
    this.commit();
    return true;
  }

  evolve(instanceId: string): boolean {
    this.userGesture();
    const p = this.profile;
    const inst = p.summons.collection.find((s) => s.instanceId === instanceId);
    if (!inst) return false;
    const check = checkEvolution(inst, p.player.riftCores);
    if (!check.possible || !check.def) {
      this.sfx("error", { volume: 0.3 });
      return false;
    }
    const cores = summonDef(inst.defId).evolution?.requiredRiftCores ?? 0;
    p.player.riftCores -= cores;
    evolveSummon(inst);
    p.progress.evolutions += 1;
    this.sfx("summon_first", { volume: 0.9, rate: 1.3 });
    this.toast(`${check.def.name} has awakened`, "level");
    this.renderer?.flash(check.def.palette.glow, 0.5);
    this.refreshLoadout();
    this.afterProgression();
    this.commit();
    return true;
  }

  /** Spend gold to raise an ability one rank. */
  rankAbility(id: AbilityId): boolean {
    this.userGesture();
    const ok = doRankAbility(this.profile, id);
    if (ok) {
      this.sfx("upgrade", { volume: 0.6, rate: 0.9 });
      this.sfx("level_up", { volume: 0.35, rate: 1.4 });
      this.rankBadgeShown = false;
      this.refreshLoadout();
      this.afterProgression();
      this.commit();
    } else this.sfx("error", { volume: 0.3 });
    return ok;
  }

  unlockSkill(id: string): boolean {
    this.userGesture();
    const ok = doUnlockSkill(this.profile, id);
    if (ok) {
      this.sfx("level_up", { volume: 0.6, rate: 1.2 });
      this.refreshLoadout();
      this.afterProgression();
      this.commit();
    } else this.sfx("error", { volume: 0.3 });
    return ok;
  }

  chooseWeaponPath(path: WeaponPath): boolean {
    this.userGesture();
    const p = this.profile;
    if (!computeModifiers(p).weaponPathUnlocked || p.player.weaponPath !== "none") return false;
    if (!WEAPON_PATHS.some((w) => w.id === path)) return false;
    p.player.weaponPath = path;
    this.sfx("ultimate", { volume: 0.8 });
    this.renderer?.flash(WEAPON_PATHS.find((w) => w.id === path)?.colorHex ?? 0xffffff, 0.4);
    this.refreshLoadout();
    this.closeModal();
    this.commit();
    return true;
  }

  takePerk(id: string): void {
    this.userGesture();
    if (doTakePerk(this.profile, id)) {
      this.sfx("level_up", { volume: 0.5, rate: 1.3 });
      this.refreshLoadout();
      this.closeModal();
      this.commit();
      if (this.profile.player.pendingPerkChoices > 0) this.offerPerkChoice();
    }
  }

  claimQuest(): void {
    this.userGesture();
    const reward = doClaimQuest(this.profile);
    if (!reward) return;
    this.sfx("quest", { volume: 0.9 });
    const parts: string[] = [];
    if (reward.gold) parts.push(`+${reward.gold} gold`);
    if (reward.essence) parts.push(`+${reward.essence} essence`);
    if (reward.riftCores) parts.push(`+${reward.riftCores} Rift Core`);
    this.toast(parts.join(", "), "gold");
    this.afterProgression();
    this.commit();
  }

  /** Redeem a gift code. Each code works once per save. */
  async redeemCode(input: string): Promise<{ ok: boolean; message: string }> {
    this.userGesture();
    const check = await verifyCode(input);
    if (!check.ok) {
      this.sfx("error", { volume: 0.4 });
      const message =
        check.reason === "signature" ? "That code is not valid." : check.reason === "format" ? "Codes look like ASC-G500-XXXXXX." : check.reason === "disabled" ? "Friend codes are not enabled on this build yet." : "Unknown code.";
      return { ok: false, message };
    }
    const p = this.profile;
    if (p.progress.redeemedCodes.includes(check.key)) {
      this.sfx("error", { volume: 0.4 });
      return { ok: false, message: "You have already used that code." };
    }
    const r = check.reward;
    p.player.gold += r.gold ?? 0;
    p.player.essence += r.essence ?? 0;
    p.player.riftCores += r.riftCores ?? 0;
    if (r.item) this.addItem(generateItem(this.rng, Math.max(1, p.progress.bestStage), r.item.rarity, r.item.slot));
    if (r.summonId) {
      const outcome = doClaimEssence(p, r.summonId);
      if (outcome.kind === "new") p.summons.firstSummonSeen = true;
      const first = outcome.kind === "new" && p.summons.collection.length === 1;
      this.uiStore.update((u) => ({ ...u, modal: { kind: "summon_reveal", outcome, summonId: r.summonId as string, first, cinematicDone: true }, newBadges: { ...u.newBadges, summons: true } }));
    }
    p.progress.redeemedCodes.push(check.key);
    this.sfx("quest", { volume: 0.9 });
    this.toast(`Gift received: ${describeReward(r)}`, "gold");
    this.refreshLoadout();
    this.afterProgression();
    this.commit();
    return { ok: true, message: `Received ${describeReward(r)}.` };
  }

  starUp(instanceId: string): boolean {
    this.userGesture();
    const p = this.profile;
    const inst = p.summons.collection.find((s) => s.instanceId === instanceId);
    if (!inst || !canStarUp(inst, p.player.riftCores)) {
      this.sfx("error", { volume: 0.3 });
      const c = inst ? starCost(inst) : null;
      if (c) this.toast(`Needs ${c.shards} shards${c.cores ? ` and ${c.cores} Rift Core${c.cores > 1 ? "s" : ""}` : ""}`, "warn");
      return false;
    }
    const bestBefore = speciesStars(p).get(inst.defId) ?? 0;
    p.player.riftCores -= starUp(inst);
    this.sfx("level_up", { volume: 0.8, rate: 1.25 });
    const def = summonDef(inst.defId);
    const gained = Math.max(0, (inst.stars ?? 0) - bestBefore);
    const pct = Math.round(def.owned.pct * CODEX_STAR_STEP * gained * 1000) / 10;
    this.toast(`${def.name} reached ★${inst.stars}${pct > 0 ? ` · Codex +${pct}% ${STAT_LABEL[def.owned.stat]}` : ""}`, "level");
    this.renderer?.flash(0xe9c97a, 0.2);
    this.refreshLoadout();
    this.commit();
    return true;
  }

  toggleBattleSpeed(): void {
    this.userGesture();
    if (!this.battleSpeedUnlocked) {
      this.toast("Clear stage 3 to unlock 2x speed", "info");
      return;
    }
    this.profile.settings.battleSpeed = this.profile.settings.battleSpeed === 2 ? 1 : 2;
    this.sfx("ui_tap");
    this.commit();
  }

  advanceStage(): void {
    this.userGesture();
    const ui = this.uiStore.get();
    const next = ui.modal?.kind === "stage_clear" ? ui.modal.nextStage : this.profile.progress.currentStage + 1;
    this.profile.progress.currentStage = next;
    this.closeModal();
    this.commit();
    this.startRun(next);
  }

  replayStage(stage?: number): void {
    this.userGesture();
    const s = Math.max(1, stage ?? this.profile.progress.currentStage);
    this.profile.progress.currentStage = s;
    this.closeModal();
    this.commit();
    this.startRun(s);
  }

  retry(): void {
    this.userGesture();
    this.closeModal();
    this.startRun(this.profile.progress.currentStage);
  }

  selectStage(stage: number): void {
    this.userGesture();
    const max = this.profile.progress.bestStage + 1;
    const s = Math.min(max, Math.max(1, stage));
    this.profile.progress.currentStage = s;
    this.commit();
    this.startRun(s);
    this.toast(`Stage ${s}`, "info");
  }

  setPanel(panel: PanelId): void {
    this.userGesture();
    this.sfx("ui_tap", { volume: 0.4 });
    this.uiStore.update((u) => ({ ...u, panel, newBadges: { ...u.newBadges, [panel]: false } }));
  }

  selectSummon(id: string | null): void {
    this.uiStore.update((u) => ({ ...u, selectedSummon: id }));
  }

  selectItem(uid: string | null): void {
    this.uiStore.update((u) => ({ ...u, selectedItem: uid }));
  }

  openSettings(): void {
    this.userGesture();
    this.uiStore.update((u) => ({ ...u, modal: { kind: "settings" } }));
  }

  openJournal(): void {
    this.userGesture();
    this.uiStore.update((u) => ({ ...u, modal: { kind: "journal" }, newBadges: { ...u.newBadges, rift: false } }));
  }

  openWeaponPath(): void {
    this.userGesture();
    this.uiStore.update((u) => ({ ...u, modal: { kind: "weapon_path" } }));
  }

  updateSettings(patch: Partial<Profile["settings"]>): void {
    const p = this.profile;
    p.settings = { ...p.settings, ...patch };
    this.audio.setVolumes(p.settings.music, p.settings.sfx);
    this.renderer?.setReducedEffects(p.settings.reducedEffects);
    this.commit();
  }

  async resetSave(): Promise<void> {
    await this.save.reset();
    const fresh = createDefaultProfile();
    this.profileStore.set({ profile: fresh, v: this.profileStore.get().v + 1 });
    this.tutorialSubstep = 0;
    this.tutorialElapsed = 0;
    this.uiStore.update((u) => ({ ...u, modal: null, panel: "hero", guide: null, tutorialStep: null, selectedItem: null, selectedSummon: null }));
    this.modalQueue = [];
    this.startRun(1);
    await this.save.save(fresh);
  }

  replayTutorial(): void {
    const p = this.profile;
    p.tutorial = { completed: [], finished: false };
    this.tutorialSubstep = 0;
    this.tutorialElapsed = 0;
    this.closeModal();
    this.commit();
    this.toast("Guidance reset", "info");
  }

  closeModal(): void {
    if (this.uiStore.get().modal?.kind === "summon_reveal") this.renderer?.endCinematic();
    this.uiStore.update((u) => ({ ...u, modal: null }));
    this.flushModalQueue();
  }

  dismissOffline(): void {
    const ui = this.uiStore.get();
    if (ui.modal?.kind === "offline") {
      this.profile.player.gold += ui.modal.reward.gold;
      this.profile.player.essence += ui.modal.reward.essence;
      this.sfx("gold", { volume: 0.7 });
      this.commit();
    }
    this.closeModal();
  }

  private enqueueModal(modal: Modal): void {
    const ui = this.uiStore.get();
    if (ui.modal === null || ui.modal.kind === "boss_intro") this.uiStore.set({ ...ui, modal });
    else this.modalQueue.push(modal);
  }

  private flushModalQueue(): void {
    const next = this.modalQueue.shift();
    if (next) this.uiStore.update((u) => ({ ...u, modal: next }));
  }

  toast(text: string, tone: Toast["tone"] = "info"): void {
    const id = ++this.toastId;
    this.uiStore.update((u) => ({ ...u, toasts: [{ id, text, tone }] }));
    setTimeout(() => this.uiStore.update((u) => ({ ...u, toasts: u.toasts.filter((t) => t.id !== id) })), 2200);
  }

  /** UI-side reward cues (count-ups, card reveals). Throttled so a fast count never turns into noise. */
  rewardCue(kind: "tick" | "card" | "rare"): void {
    if (kind === "tick") this.sfx("gold", { volume: 0.18, minInterval: 70, rate: 1.1 + Math.random() * 0.15 });
    else if (kind === "card") this.sfx("equip", { volume: 0.3, rate: 1.1 });
    else this.sfx("quest", { volume: 0.4 });
  }

  private sfx(name: SfxName, opts?: { volume?: number; rate?: number; minInterval?: number }): void {
    this.audio.play(name, opts);
  }

  // ---------------------------------------------------------------------
  // Tutorial director
  // ---------------------------------------------------------------------

  /** Set after a campaign defeat: guide the player to spend gold on Health until they do. */
  private coachUpgrade = false;
  private dodgeSlowUntil = 0;

  /**
   * The tutorial director. Steps complete whenever the player performs the action, in any order.
   * Each tick it shows the first step that is ready (a waiting BIND always wins), otherwise a
   * contextual hint: a claimable reward, or after a defeat, where to spend gold.
   */
  private updateTutorial(snap: WorldSnapshot): void {
    const p = this.profile;
    const ui = this.uiStore.get();
    const world = this.world;
    if (!world) return;
    this.enemyWindupNearPlayer = false;
    for (const e of world.enemies()) {
      if (e.state === "windup" && e.pendingTargetId === world.player.id) this.enemyWindupNearPlayer = true;
    }
    // The dodge lesson slows the fight so the player can read the wind-up and react.
    world.tutorialSlow = performance.now() < this.dodgeSlowUntil;
    const setGuide = (guide: UiState["guide"], stepId: TutorialStepId | null) => {
      if ((guide?.target ?? null) !== (ui.guide?.target ?? null) || (guide?.label ?? null) !== (ui.guide?.label ?? null) || ui.tutorialStep !== stepId) {
        this.uiStore.update((u) => ({ ...u, guide, tutorialStep: stepId }));
      }
    };
    if (ui.modal !== null && ui.modal.kind !== "defeat") {
      if (ui.guide) setGuide(null, ui.tutorialStep);
      return;
    }
    const ctx = { profile: p, snapshot: snap, elapsed: this.tutorialElapsed, panel: ui.panel, enemyWindupNearPlayer: this.enemyWindupNearPlayer };
    if (!p.tutorial.finished) {
      const remaining = TUTORIAL_STEPS.filter((st) => !p.tutorial.completed.includes(st.id));
      if (remaining.length === 0) {
        p.tutorial.finished = true;
        this.toast("You know the way. Ascend.", "level");
        setGuide(null, null);
        this.commit();
        return;
      }
      const current = remaining.find((st) => st.id === ui.tutorialStep);
      const summon = remaining.find((st) => st.id === "summon" && st.ready(ctx));
      // Keep the active step on screen briefly even if its trigger passes (a wind-up ends, say).
      const holdActive = current && (current.ready(ctx) || this.tutorialElapsed < (current.id === "dodge" ? 2.5 : 0.5));
      const step = summon ?? (holdActive ? current : remaining.find((st) => st.ready(ctx)));
      if (step) {
        if (step.id !== ui.tutorialStep) {
          this.tutorialElapsed = 0;
          this.tutorialSubstep = 0;
          if (step.id === "dodge") this.dodgeSlowUntil = performance.now() + 2500;
        }
        if (step.autoComplete && step.autoComplete(ctx)) {
          this.completeTutorialIf(step.id);
          return;
        }
        const sub = step.targets[this.tutorialSubstep];
        if (sub?.panel && ui.panel === sub.panel && this.tutorialSubstep < step.targets.length - 1) this.tutorialSubstep += 1;
        else if (sub?.panel && ui.panel !== sub.panel && this.tutorialSubstep > 0) this.tutorialSubstep = 0;
        setGuide(this.guideFor(step, this.tutorialSubstep), step.id);
        return;
      }
    }
    setGuide(this.contextualGuide(ui.panel), null);
  }

  /** Hints outside the scripted steps: rewards to collect, and gold to spend after a loss. */
  private contextualGuide(panel: string): UiState["guide"] {
    const p = this.profile;
    const q = currentQuest(p);
    if (q && isQuestComplete(p, q)) return { target: "quest-claim", label: "Claim reward", gesture: "tap" };
    if (this.coachUpgrade) {
      const stat = statUpgradeCost("maxHp", p.player.statLevels.maxHp) <= p.player.gold ? "maxHp" : statUpgradeCost("attack", p.player.statLevels.attack) <= p.player.gold ? "attack" : null;
      if (!stat) return null;
      if (panel !== "hero") return { target: "tab-hero", label: "Spend your gold", gesture: "tap" };
      return { target: `upgrade-${stat}`, label: stat === "maxHp" ? "Hold to raise Health" : "Hold to raise Attack", gesture: "hold" };
    }
    return null;
  }

  private guideFor(step: TutorialStep, sub: number): UiState["guide"] {
    const t = step.targets[Math.min(sub, step.targets.length - 1)];
    if (!t) return null;
    return { target: t.target, label: t.label, gesture: t.gesture };
  }

  /** Marks a lesson learned the moment the player does the thing, whether or not it was being taught. */
  private completeTutorialIf(id: TutorialStepId): void {
    const p = this.profile;
    if (p.tutorial.finished || p.tutorial.completed.includes(id)) return;
    p.tutorial.completed.push(id);
    if (id === "dodge") this.dodgeSlowUntil = 0;
    this.tutorialSubstep = 0;
    this.tutorialElapsed = 0;
    this.sfx("quest", { volume: 0.5, rate: 1.2 });
    this.uiStore.update((u) => ({ ...u, tutorialStep: null, guide: null }));
    if (TUTORIAL_STEPS.every((s) => p.tutorial.completed.includes(s.id))) {
      p.tutorial.finished = true;
      this.toast("You know the way. Ascend.", "level");
    }
    this.commit();
  }
}

function castSfx(ability: AbilityId): SfxName {
  switch (ability) {
    case "arc_slash":
      return "arc_slash";
    case "thunder_strike":
      return "thunder";
    case "soul_burst":
      return "soul_burst";
    case "void_nova":
      return "void_nova";
    case "ascendant_fury":
      return "ultimate";
    default:
      return "dodge";
  }
}

export function itemName(item: EquipmentItem): string {
  return item.templateId
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export type { SummonInstance };
