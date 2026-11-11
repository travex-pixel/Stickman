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
import { learnTechniques, setSlotForm } from "./progression/techniques";
import { offerPerks, takePerk as doTakePerk } from "./progression/perks";
import { claimQuest as doClaimQuest, currentQuest, isQuestComplete } from "./progression/quests";
import { evaluateAchievements, evaluateJournal } from "./progression/achievements";
import { computeModifiers, MILESTONE_EVERY, MILESTONE_MULT } from "./progression/stats";
import { canUpgradeStat } from "./progression/upgrades";
import { claimEssence as doClaimEssence, setDeployed, type ClaimOutcome } from "./summons/recruitment";
import { CODEX_STAR_STEP, resolveExtraction, speciesStars } from "./summons/extraction";
import { SLOT_LABEL, STAT_LABEL } from "./data/equipment";
import { bondCost, BOND_CAP, canStarUp, checkEvolution, evolveSummon, grantSummonXp, REFINE_SHARDS, refineShards as doRefineShards, starCost, starUp } from "./summons/progression";
import { enemyDef } from "./data/enemies";
import { MODES, RIFT_ESSENCE_PER_KILL, cryptSlot, isKeyedMode, type ModeId } from "./data/modes";
import { RARITY_ORDER } from "./data/ids";
import { REPEAT_BOSS_CORE_CHANCE, shadowXpShare, skillPointsBetween, stageClearGold, stageClearXp } from "./economy/rewards";
import { RANK_STEPS, nextRankStep, promote } from "./progression/ranks";
import { ELITES } from "./data/elites";
import { GEAR_EFFECTS } from "./data/gearEffects";
import { stageScale } from "./data/regions";
import { EQUIPMENT_LEVEL_CAP, equipmentUpgradeCost, fuseItems, salvageValue } from "./economy/loot";
import { INVENTORY_CAP } from "./data/equipment";
import { IndexedDbSaveManager } from "@/persistence/SaveManager";
import { applyOfflineProgress, elapsedAway, OFFLINE_MIN_SECONDS, type OfflineSummary } from "./progression/offline";
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
import { bossForStage, isBossStage, regionForStage } from "./data/regions";
import { TWISTS, depthForStage, romanDepth, twistForDepth, type TwistId } from "./data/depths";
import { clampFarmStage, frontierStage, normalizeCampaign, resolveBossDefeat, resolveBossVictory, resolveCycle, resolveFarmingDefeat } from "./progression/campaign";
import { bossFightStepper, readinessTips, summarizeForecast, FORECAST_SEEDS, type BossForecast, type FightResult, type ReadinessTip } from "./progression/readiness";
import { ascend as doAscend, buyNode as doBuyNode, romanAscension, type TreeNodeId } from "./progression/ascension";
import { claimObjective as doClaimObjective, objectiveDef, recordObjective, refreshObjectives, type ObjectiveCounter } from "./progression/objectives";
import { fmt } from "@/lib/format";

/** Per-run tallies for result screens and boss summaries. */
interface RunTally {
  gold: number;
  kills: number;
  raised: number;
  mode: ModeId;
  items: EquipmentItem[];
  casts: number;
  dodges: number;
  perfect: number;
  summonsLost: number;
  /** For a boss challenge: the stage farming returns to. */
  farmStage: number;
  /** The run's outcome has been paid out: never pay it twice. */
  resolved: boolean;
}

function newTally(mode: ModeId): RunTally {
  return { gold: 0, kills: 0, raised: 0, mode, items: [], casts: 0, dodges: 0, perfect: 0, summonsLost: 0, farmStage: 0, resolved: false };
}

export type Modal =
  | { kind: "summon_reveal"; outcome: ClaimOutcome; summonId: string; first: boolean; cinematicDone: boolean }
  | { kind: "perk_choice"; perks: PerkDef[] }
  | { kind: "boss_ready"; stage: number }
  | { kind: "boss_victory"; stage: number; defId: string; gold: number; xp: number; cores: number; items: EquipmentItem[]; nextStage: number; unlocks: string[]; seconds: number; firstWin: boolean; orbId?: number; hunt?: boolean }
  | { kind: "hunt_pick" }
  | { kind: "boss_defeat"; stage: number; defId: string; bossHpLeft: number; bossPhase: number; seconds: number; casts: number; dodges: number; perfect: number; summonsLost: number; farmStage: number; tips: ReadinessTip[] }
  | { kind: "offline"; summary: OfflineSummary; levels: number }
  | { kind: "settings" }
  | { kind: "weapon_path" }
  | { kind: "journal" }
  | { kind: "objectives" }
  | { kind: "ascend" }
  | { kind: "boss_intro"; defId: string }
  | { kind: "technique"; id: AbilityId }
  | { kind: "mode_result"; mode: ModeId; title: string; subtitle: string; lines: { label: string; value: string; tone?: "gold" | "jade" | "violet" }[]; success: boolean; record?: boolean; items?: EquipmentItem[] }
  | { kind: "rank_up"; from: number; to: number; rewards: string[] };

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "gold" | "essence" | "warn" | "level";
  /** Routine news that yields to anything else. */
  low?: boolean;
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
  /** A boss gate was just reached at this stage (drives the milestone banner). */
  gateFlash: number;
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
    gateFlash: 0,
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
  private explainedBind = false;
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
  /** A short beat after a fall before the world changes (the body hits the ground first). */
  private pending: { left: number; fn: () => void } | null = null;
  /** The stage being farmed when a boss challenge began: where a loss returns to. */
  private challengeFrom = 1;
  private forecast: BossForecast | null = null;
  private forecastJob = 0;
  readonly forecastStore = new Store<{ forecast: BossForecast | null; running: boolean; stage: number } | null>(null);

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
    normalizeCampaign(profile);
    let offline: OfflineSummary | null = null;
    if (!result.fresh && !result.readOnly) {
      const away = elapsedAway(profile.lastActive, now);
      if (away !== null) offline = applyOfflineProgress(profile, away, now >>> 0);
    }
    refreshObjectives(profile, new Date(now));
    profile.lastActive = now;
    profile.progress.runs += 1;
    this.profileStore.set({ profile, v: 1 });
    this.refreshKeys();
    this.profileStore.set({ profile, v: 1 });
    this.audio.init();
    this.audio.setVolumes(profile.settings.music, profile.settings.sfx);
    this.startRun(profile.progress.currentStage);
    this.uiStore.update((u) => ({ ...u, booted: true, loadNote: note }));
    if (offline) this.presentOffline(offline);
    if (profile.progress.bossGate) this.requestForecast(true);
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
      this.hiddenAt = Date.now();
      this.profile.lastActive = Date.now();
      this.save.schedule(this.profile, 0);
      this.save.stashUnsaved();
      void this.save.flush();
      this.loop.stop();
    } else {
      this.resumeFromBackground();
      this.loop.resync();
      this.loop.start();
      this.audio.resume();
    }
  }

  private hiddenAt = 0;

  /**
   * Back from the background: the loop was stopped, so farming did not run. If the tab was away
   * long enough, the time is filled with the same offline simulation as a cold start. A boss
   * fight left in the background is simply paused, never resolved or started.
   */
  private resumeFromBackground(): void {
    const away = this.hiddenAt ? elapsedAway(this.hiddenAt, Date.now()) : null;
    this.hiddenAt = 0;
    const world = this.world;
    if (away === null || away < OFFLINE_MIN_SECONDS || !world?.farming || this.save.readOnly) return;
    this.toast("Catching up on your time away…", "info");
    // Let that toast paint before the (short) simulation runs.
    setTimeout(() => {
      if (this.disposed || this.world !== world || !world.farming) return;
      const p = this.profile;
      const summary = applyOfflineProgress(p, away, Date.now() >>> 0);
      p.lastActive = Date.now();
      if (!summary) return;
      if (p.progress.currentStage !== world.stage && !world.player.dead) world.moveToStage(p.progress.currentStage);
      this.presentOffline(summary);
    }, 60);
  }

  /** Offline rewards are already in the profile: apply XP, feed objectives, save, then show. */
  private presentOffline(summary: OfflineSummary): void {
    const p = this.profile;
    summary.xp = Math.round(summary.xp * computeModifiers(p).xpMult);
    const lv = applyXp(p.player.level, p.player.xp, summary.xp);
    p.player.level = lv.level;
    p.player.xp = lv.xp;
    if (lv.levelsGained > 0) this.onLevelUp(lv.levelsGained);
    // Objectives reward playing: time away counts toward kills only.
    this.objectiveEvent("kills", summary.kills);
    this.refreshLoadout();
    this.commit();
    void this.save.flush();
    this.enqueueModal({ kind: "offline", summary, levels: lv.levelsGained });
  }

  // ---------------------------------------------------------------------
  // Run management
  // ---------------------------------------------------------------------

  startRun(stage: number, mode: ModeId = "campaign"): void {
    // Any new run supersedes a pending post-defeat beat: it must never overwrite this one.
    this.pending = null;
    this.world?.dispose();
    const loadout = buildLoadout(this.profile);
    this.world = new World({ stage, loadout, mode, seed: (Date.now() ^ (stage * 2654435761)) >>> 0, cryptSlot: cryptSlot() });
    this.run = newTally(mode);
    if (mode === "boss") this.run.farmStage = this.challengeFrom;
    this.renderer?.setWorld(this.world);
    this.hudStore.set(this.world.snapshot());
  }

  /** Per-run tallies for the result screens. */
  private run: RunTally = newTally("campaign");

  get mode(): ModeId {
    return this.world?.mode ?? "campaign";
  }

  /** Keys refill at local midnight. Missing a day never costs anything. */
  refreshKeys(now = new Date()): void {
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const m = this.profile.modes;
    if (m.keyDay !== day) {
      m.keyDay = day;
      m.keys = { vault: MODES.vault.dailyKeys ?? 3, rift: MODES.rift.dailyKeys ?? 3, crypt: MODES.crypt.dailyKeys ?? 3, hunt: MODES.hunt.dailyKeys ?? 3 };
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
    if (isKeyedMode(mode) && p.modes.keys[mode] <= 0) return { ok: false, reason: "Keys refill tomorrow" };
    return { ok: true };
  }

  startMode(mode: ModeId): boolean {
    this.userGesture();
    if (this.pending || this.world?.player.dead) {
      this.sfx("error", { volume: 0.4 });
      this.toast("Your warrior is regrouping", "warn");
      return false;
    }
    if (mode === "hunt") {
      // A hunt needs a chosen boss: show the list instead.
      if (this.modeAvailability(mode).ok) this.openHunts();
      else this.toast(this.modeAvailability(mode).reason ?? "Locked", "warn");
      return false;
    }
    this.refreshKeys();
    const avail = this.modeAvailability(mode);
    if (!avail.ok) {
      this.sfx("error", { volume: 0.4 });
      this.toast(avail.reason ?? "Locked", "warn");
      return false;
    }
    const p = this.profile;
    if (isKeyedMode(mode)) p.modes.keys[mode] -= 1;
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
    const retreat = (this.world?.mode === "boss" || this.world?.mode === "hunt") && this.world.phase !== "victory" && this.world.phase !== "defeat";
    this.closeModal();
    this.startRun(this.profile.progress.currentStage, "campaign");
    if (retreat) this.toast("You withdrew. The boss waits for your return.", "info");
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

  /**
   * The world keeps moving while the player reads or manages: only the summon cinematic stops
   * it. Outside the farming loop (a boss challenge, a mode) a modal does pause the fight.
   */
  private get paused(): boolean {
    const m = this.uiStore.get().modal;
    if (!m || m.kind === "boss_intro") return false;
    if (m.kind === "summon_reveal") return true;
    return !this.world?.farming;
  }

  /** 2x battle speed unlocks after clearing stage 3; it never changes the simulation, only how many steps run per frame. */
  get battleSpeedUnlocked(): boolean {
    return this.profile.progress.bestStage >= 3;
  }

  private simulate(dt: number): void {
    const world = this.world;
    if (!world) return;
    const steps = this.battleSpeedUnlocked && this.profile.settings.battleSpeed === 2 && world.phase !== "defeat" && world.phase !== "victory" && world.phase !== "boss_intro" ? 2 : 1;
    const modal = this.uiStore.get().modal;
    world.holdOrbs = modal !== null && modal.kind !== "boss_intro";
    if (!this.paused) for (let i = 0; i < steps; i++) world.update(dt);
    this.processEvents(world.drainEvents());
    if (this.pending) {
      this.pending.left -= dt;
      if (this.pending.left <= 0) {
        const fn = this.pending.fn;
        this.pending = null;
        fn();
      }
    }
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
    let cleared: Extract<GameEvent, { type: "stage_cleared" }> | null = null;
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
            if (e.elite) this.objectiveEvent("elites", 1);
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
            this.run.summonsLost += 1;
            if (this.run.summonsLost === 1) this.toast("A companion has fallen. It will return.", "warn", true);
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
            this.run.casts += 1;
            this.objectiveEvent("casts", 1);
            p.progress.abilityCasts += 1;
            if (e.ability !== "shadow_dash") this.completeTutorialIf("ability");
            dirty = true;
            this.sfx(castSfx(e.ability), { volume: e.ability === "ascendant_fury" ? 1 : 0.8, minInterval: 150 });
            if (e.ability === "ascendant_fury") this.renderer?.flash(0xffd36b, 0.35);
          }
          break;
        case "dodge":
          if (e.id === this.world?.player.id) {
            this.run.dodges += 1;
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
        case "encounters_cleared":
          if (this.world?.farming) this.onEncountersCleared(e.stage);
          dirty = true;
          break;
        case "stage_advanced":
          this.onStageAdvanced(e.from, e.stage);
          break;
        case "stage_cleared":
          // Resolved after this batch's gold, XP and loot are counted, so result cards are complete.
          cleared = e;
          dirty = true;
          break;
        case "player_defeated":
          this.sfx("boss_intro", { volume: 0.6, rate: 1.6 });
          if (e.mode === "endless") this.onEndlessOver(e.wave);
          else if (e.mode === "campaign") this.onFarmingDefeat(e.stage);
          else if (e.mode === "boss") this.onBossDefeat(e.stage);
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
          this.run.perfect += 1;
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
      this.objectiveEvent("kills", kills);
      p.progress.totalKills += kills;
      this.run.kills += kills;
      if (this.mode === "rift") {
        p.player.essence += kills * RIFT_ESSENCE_PER_KILL;
      }
      dirty = true;
    }
    if (xp > 0) {
      const res = applyXp(p.player.level, p.player.xp, Math.round(xp * (this.world?.loadout.mods.xpMult ?? 1)));
      p.player.level = res.level;
      p.player.xp = res.xp;
      if (res.levelsGained > 0) this.onLevelUp(res.levelsGained);
      dirty = true;
    }
    const loot = this.world?.takeLoot() ?? [];
    if (loot.length > 0) {
      for (const l of loot) {
        this.addItem(l.item);
        if (this.run.mode === "crypt" || this.run.mode === "boss" || this.run.mode === "hunt") this.run.items.push(l.item);
      }
      dirty = true;
    }
    if (cleared) {
      if (cleared.mode === "boss") this.onBossVictory(cleared.stage);
      else if (cleared.mode === "hunt") this.onHuntVictory(cleared.stage);
      else this.onModeCleared(cleared.mode as ModeId, cleared.wave, cleared.time);
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
      const affordable = (["attack", "maxHp", "defense", "attackSpeed", "critChance", "critDamage"] as const).some((st) => canUpgradeStat(p, st).ok);
      if (affordable) this.uiStore.update((u) => ({ ...u, newBadges: { ...u.newBadges, hero: true } }));
    }
    // The plaque's readiness follows the build: re-forecast when something that matters changed.
    if (p.progress.bossGate && this.world?.farming) this.requestForecast(false);
    // New techniques are revealed with a card: never in the middle of a boss fight or a mode.
    if (this.world?.farming) this.revealTechniques(learnTechniques(p));
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

  /** Many perks waiting (a long absence): take the first offer of each, in one tap. */
  autoPickPerks(): void {
    this.userGesture();
    const p = this.profile;
    let n = 0;
    while (p.player.pendingPerkChoices > 0 && n < 200) {
      const offer = offerPerks(p, this.rng);
      const pick = offer[0];
      if (!pick || !doTakePerk(p, pick.id)) break;
      n += 1;
    }
    this.closeModal();
    this.refreshLoadout();
    this.toast(`${n} perk${n === 1 ? "" : "s"} chosen`, "level");
    this.sfx("level_up", { volume: 0.6 });
    this.commit();
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

  // ---------------------------------------------------------------------
  // Campaign: farming cycles, the boss gate, and deliberate boss challenges
  // ---------------------------------------------------------------------

  /** Every ordinary encounter of the farmed stage is down: pay the cycle, then move on or hold. */
  private onEncountersCleared(stage: number): void {
    const p = this.profile;
    const mods = computeModifiers(p);
    const res = resolveCycle(p, stage, mods.goldFind);
    p.player.gold += res.gold;
    this.run.gold += res.gold;
    const lv = applyXp(p.player.level, p.player.xp, Math.round(res.xp * mods.xpMult));
    p.player.level = lv.level;
    p.player.xp = lv.xp;
    if (lv.levelsGained > 0) this.onLevelUp(lv.levelsGained);
    this.objectiveEvent("cycles", 1);
    if (res.gateReached) {
      this.sfx("boss_intro", { volume: 0.7, rate: 0.85 });
      this.renderer?.flash(0xc4453f, 0.18);
      this.uiStore.update((u) => ({ ...u, gateFlash: stage }));
      this.requestForecast(true);
    } else if (res.stageCleared) {
      this.sfx("quest", { volume: 0.6 });
      this.toast(`Stage ${stage} cleared · +${fmt(res.gold)} gold`, "gold");
    } else {
      this.toast(`Stage ${stage} · +${fmt(res.gold)} gold`, "gold", true);
    }
    if (res.next !== stage) this.world?.queueStage(res.next);
    this.commitSoon();
  }

  private onStageAdvanced(from: number, stage: number): void {
    this.renderer?.onStageChanged();
    const depth = depthForStage(stage);
    if (depth !== depthForStage(from) && twistForDepth(depth)) {
      const t = TWISTS[twistForDepth(depth) as TwistId];
      this.sfx("boss_intro", { volume: 0.6, rate: 0.9 });
      this.renderer?.flash(t.tint, 0.4);
      this.toast(`Rift Depth ${romanDepth(depth)} · ${t.name}`, "level");
      this.toast(`${t.blurb} ${t.counter}`, "info");
    } else if (regionForStage(stage).id !== regionForStage(from).id) {
      this.sfx("boss_intro", { volume: 0.5, rate: 1.2 });
      this.toast(depth > 1 ? `${regionForStage(stage).name} · Depth ${romanDepth(depth)}` : `${regionForStage(stage).name}`, "level");
    }
  }

  /** Falling while farming is never a dead end: step back a stage, hold, and get stronger. */
  private onFarmingDefeat(stage: number): void {
    if (this.run.resolved) return;
    this.run.resolved = true;
    this.coachUpgrade = true;
    this.pending = {
      left: 2.2,
      fn: () => {
        const p = this.profile;
        const fallback = resolveFarmingDefeat(p, stage);
        this.commit();
        this.startRun(fallback, "campaign");
        this.toast(fallback < stage ? `Fallen at stage ${stage}. Regrouping at stage ${fallback}: upgrade, then push on.` : "Fallen. Back on your feet: spend your gold.", "warn");
      },
    };
  }

  private forecastTimer: ReturnType<typeof setTimeout> | null = null;
  private forecastKey = "";
  private pendingForecastKey = "";

  /** What the forecast depends on: if none of it changed, the old forecast still stands. */
  private forecastSignature(): string {
    const p = this.profile;
    const eq = Object.values(p.equipment.equipped).map((uid) => {
      const it = p.equipment.inventory.find((i) => i.uid === uid);
      return it ? `${it.uid}:${it.level}` : "";
    });
    const army = p.summons.collection.filter((s) => s.deployed).map((s) => `${s.defId}:${s.level}:${s.stars ?? 0}:${s.bond}`);
    return JSON.stringify([p.progress.bossGate, p.player.level, p.player.rank, p.player.statLevels, eq, army, p.skills.unlocked, p.player.abilityRanks, p.player.artForms, p.player.perks, p.player.weaponPath]);
  }

  /**
   * Re-runs the boss forecast when something that matters changed. Fights run one per tick so
   * the frame never hitches; a newer request cancels an older one.
   */
  requestForecast(force: boolean): void {
    const gate = this.profile.progress.bossGate;
    if (!gate) {
      this.forecastStore.set(null);
      return;
    }
    const key = this.forecastSignature();
    if (!force && key === this.forecastKey && this.forecast?.stage === gate) return;
    // Already scheduled for this exact build: let it run rather than pushing it back again.
    if (!force && this.forecastTimer && key === this.pendingForecastKey) return;
    if (this.forecastTimer) clearTimeout(this.forecastTimer);
    this.pendingForecastKey = key;
    this.forecastTimer = setTimeout(() => this.runForecast(gate, key), force ? 0 : 900);
  }

  /** Runs the forecast fights in slices of a few milliseconds so frames keep flowing. */
  private runForecast(stage: number, key: string): void {
    this.forecastTimer = null;
    const job = ++this.forecastJob;
    const snapshot: Profile = JSON.parse(JSON.stringify(this.profile));
    const results: FightResult[] = [];
    let fight = 0;
    let stepper = bossFightStepper(snapshot, stage, FORECAST_SEEDS[0] as number);
    this.forecastStore.set({ forecast: this.forecast?.stage === stage ? this.forecast : null, running: true, stage });
    const slice = () => {
      if (job !== this.forecastJob || this.disposed) return;
      const until = performance.now() + 6;
      while (performance.now() < until) {
        const r = stepper.step(30);
        if (!r) continue;
        results.push(r);
        fight += 1;
        if (fight >= FORECAST_SEEDS.length) {
          this.forecast = summarizeForecast(stage, results);
          this.forecastKey = key;
          this.forecastStore.set({ forecast: this.forecast, running: false, stage });
          return;
        }
        stepper = bossFightStepper(snapshot, stage, FORECAST_SEEDS[fight] as number);
      }
      setTimeout(slice, 0);
    };
    slice();
  }

  /** Feeds daily and weekly objectives; announces any that just completed. */
  private objectiveEvent(counter: ObjectiveCounter, amount: number): void {
    const p = this.profile;
    refreshObjectives(p);
    const done = recordObjective(p, counter, amount);
    for (const d of done) {
      this.toast(`Objective complete: ${d.text}`, "level");
      this.sfx("quest", { volume: 0.5 });
      this.uiStore.update((u) => ({ ...u, newBadges: { ...u.newBadges, rift: true } }));
    }
  }

  claimObjective(id: string): boolean {
    this.userGesture();
    const pay = doClaimObjective(this.profile, id);
    if (!pay) {
      this.sfx("error", { volume: 0.3 });
      return false;
    }
    const parts = [pay.gold ? `+${fmt(pay.gold)} gold` : "", pay.essence ? `+${pay.essence} essence` : "", pay.cores ? `+${pay.cores} Rift Core${pay.cores > 1 ? "s" : ""}` : ""].filter(Boolean);
    this.toast(`${objectiveDef(id)?.text ?? "Objective"}: ${parts.join(", ")}`, "gold");
    this.sfx("gold", { volume: 0.7 });
    this.afterProgression();
    this.commit();
    return true;
  }

  /** The player chose to fight. Opens the readiness sheet first; the fight starts from there. */
  openBossChallenge(): void {
    this.userGesture();
    const gate = this.profile.progress.bossGate;
    if (!gate || !this.world?.farming) {
      this.sfx("error", { volume: 0.3 });
      return;
    }
    this.sfx("ui_tap", { volume: 0.6, rate: 0.8 });
    this.enqueueModal({ kind: "boss_ready", stage: gate });
    this.requestForecast(false);
  }

  /**
   * The only way into a boss fight. Called from the player's press on FIGHT; never from a
   * timer, an event, offline progress or a defeat. Returns false if nothing was started.
   */
  challengeBoss(): boolean {
    this.userGesture();
    const p = this.profile;
    const gate = p.progress.bossGate;
    const world = this.world;
    if (!gate || !world || !world.farming || world.player.dead || this.pending) {
      this.sfx("error", { volume: 0.3 });
      return false;
    }
    this.challengeFrom = world.stage;
    this.closeModal();
    this.completeTutorialIf("boss");
    this.startRun(gate, "boss");
    this.sfx("boss_intro", { volume: 0.8, rate: 0.9 });
    this.renderer?.flash(0x1a0d0b, 0.45);
    return true;
  }

  private onBossVictory(stage: number): void {
    if (this.run.resolved) return;
    this.run.resolved = true;
    const p = this.profile;
    const res = resolveBossVictory(p, stage, computeModifiers(p).goldFind);
    p.player.gold += res.gold;
    p.player.riftCores += res.cores;
    const lv = applyXp(p.player.level, p.player.xp, res.xp);
    p.player.level = lv.level;
    p.player.xp = lv.xp;
    const late = (this.world?.takeLoot() ?? []).map((l) => l.item);
    for (const it of late) this.addItem(it);
    const items = [...this.run.items, ...late];
    this.objectiveEvent("bossWins", 1);
    const bossOrb = this.world?.orbs.find((o) => o.isBoss && !o.claimed);
    this.forecast = null;
    this.forecastStore.set(null);
    this.sfx("level_up", { volume: 1, rate: 0.8 });
    this.renderer?.flash(0xe9c97a, 0.4);
    this.renderer?.levelUpBurst();
    this.enqueueModal({ kind: "boss_victory", stage, defId: bossForStage(stage), gold: res.gold + this.run.gold, xp: res.xp, cores: res.cores, items, nextStage: res.next, unlocks: res.unlocks, seconds: Math.round(this.world?.time ?? 0), firstWin: res.firstWin, orbId: bossOrb?.id });
    if (lv.levelsGained > 0) this.onLevelUp(lv.levelsGained);
    this.afterProgression();
    this.commit();
  }

  private onBossDefeat(stage: number): void {
    if (this.run.resolved) return;
    this.run.resolved = true;
    const p = this.profile;
    const world = this.world;
    const boss = world ? Array.from(world.entities.values()).find((e) => e.kind === "boss") : undefined;
    const summary = {
      stage,
      defId: bossForStage(stage),
      bossHpLeft: boss ? Math.max(0, boss.hp / boss.stats.maxHp) : 1,
      bossPhase: boss?.boss?.phase ?? 1,
      seconds: Math.round(world?.time ?? 0),
      casts: this.run.casts,
      dodges: this.run.dodges,
      perfect: this.run.perfect,
      summonsLost: this.run.summonsLost,
    };
    const farmStage = resolveBossDefeat(p, this.run.farmStage || stage);
    this.coachUpgrade = true;
    this.commit();
    this.pending = {
      left: 1.8,
      fn: () => {
        this.startRun(farmStage, "campaign");
        this.enqueueModal({ kind: "boss_defeat", ...summary, farmStage, tips: readinessTips(this.profile, stage) });
        this.requestForecast(true);
      },
    };
  }

  /**
   * BIND the fallen boss's essence from the victory card. The card steps aside for the attempt
   * (and the reveal, on success) and comes back afterwards with the attempts left.
   */
  bindBossEssence(orbId: number): void {
    const ui = this.uiStore.get();
    const victory = ui.modal?.kind === "boss_victory" ? ui.modal : null;
    this.uiStore.update((u) => ({ ...u, modal: null }));
    this.claimEssence(orbId);
    if (!victory) return;
    const still = this.world?.peekOrb(orbId) ? orbId : undefined;
    const next: Modal = { ...victory, orbId: still };
    if (this.uiStore.get().modal) this.modalQueue.unshift(next);
    else this.uiStore.update((u) => ({ ...u, modal: next }));
  }

  /** The Boss Hunt list: cleared bosses to rematch. */
  openHunts(): void {
    this.userGesture();
    this.refreshKeys();
    this.uiStore.update((u) => ({ ...u, modal: { kind: "hunt_pick" } }));
  }

  /** Rematch a cleared boss. Spends a hunt key; never changes campaign progress. */
  startHunt(stage: number): boolean {
    this.userGesture();
    const p = this.profile;
    this.refreshKeys();
    const world = this.world;
    const ok = isBossStage(stage) && stage <= p.progress.bestStage && p.progress.bestStage >= MODES.hunt.unlockAfterStage && p.modes.keys.hunt > 0 && !!world?.farming && !world.player.dead && !this.pending;
    if (!ok) {
      this.sfx("error", { volume: 0.4 });
      this.toast(p.modes.keys.hunt <= 0 ? "Hunts refill tomorrow" : "Not available right now", "warn");
      return false;
    }
    p.modes.keys.hunt -= 1;
    this.closeModal();
    this.commit();
    this.startRun(stage, "hunt");
    this.sfx("boss_intro", { volume: 0.7, rate: 1.1 });
    return true;
  }

  private onHuntVictory(stage: number): void {
    if (this.run.resolved) return;
    this.run.resolved = true;
    const p = this.profile;
    const goldFind = computeModifiers(p).goldFind;
    const gold = Math.round(stageClearGold(stage, goldFind) * 0.5);
    const xp = Math.round(stageClearXp(stage) * 0.5);
    p.player.gold += gold;
    const lv = applyXp(p.player.level, p.player.xp, xp);
    p.player.level = lv.level;
    p.player.xp = lv.xp;
    const late = (this.world?.takeLoot() ?? []).map((l) => l.item);
    for (const it of late) this.addItem(it);
    this.objectiveEvent("bossWins", 1);
    const bossOrb = this.world?.orbs.find((o) => o.isBoss && !o.claimed);
    this.sfx("level_up", { volume: 0.9, rate: 0.9 });
    this.renderer?.flash(0xe9c97a, 0.3);
    this.enqueueModal({ kind: "boss_victory", stage, defId: bossForStage(stage), gold: gold + this.run.gold, xp, cores: 0, items: [...this.run.items, ...late], nextStage: p.progress.currentStage, unlocks: [], seconds: Math.round(this.world?.time ?? 0), firstWin: false, orbId: bossOrb?.id, hunt: true });
    if (lv.levelsGained > 0) this.onLevelUp(lv.levelsGained);
    this.afterProgression();
    this.commit();
  }

  /** After the victory card: farming resumes at the next stage. */
  continueAfterVictory(): void {
    this.userGesture();
    const ui = this.uiStore.get();
    const next = ui.modal?.kind === "boss_victory" ? ui.modal.nextStage : clampFarmStage(this.profile, this.profile.progress.currentStage);
    this.closeModal();
    this.startRun(next, "campaign");
  }

  /** Farming was holding below the frontier: move up a stage now and keep pushing. */
  pushStage(): void {
    this.userGesture();
    const p = this.profile;
    const world = this.world;
    if (this.pending || world?.player.dead) {
      // The fall beat decides first; pushing then would be silently undone.
      this.toast("Your warrior is regrouping", "warn");
      return;
    }
    p.progress.autoPush = true;
    const next = clampFarmStage(p, (world?.farming ? world.stage : p.progress.currentStage) + 1);
    if (world?.farming && next !== world.stage) {
      p.progress.currentStage = next;
      world.moveToStage(next);
      this.toast(`Pushing to stage ${next}`, "level");
    }
    this.sfx("ui_tap", { volume: 0.6 });
    this.commit();
  }

  private onModeCleared(mode: ModeId, wave: number, time: number): void {
    const p = this.profile;
    if (mode === "trial") this.objectiveEvent("bossWins", 1);
    else this.objectiveEvent("modeRuns", 1);
    // A Crypt Keeper is boss-grade: it counts for the weekly boss objective too.
    if (mode === "crypt") this.objectiveEvent("bossWins", 1);
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
    if (mode === "crypt") {
      const items = [...this.run.items].sort((a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity));
      const best = items[0]?.rarity ?? "none";
      this.revealTechniques(learnTechniques(p, { keeperDefeated: true }));
      this.enqueueModal({ kind: "mode_result", mode, title: "Crypt plundered", subtitle: `${SLOT_LABEL[this.world?.cryptSlot ?? "weapon"]} relics`, lines: [{ label: "Relics", value: `${items.length}`, tone: "gold" }, { label: "Best", value: best }, { label: "Gold", value: `+${this.run.gold}`, tone: "gold" }], success: true, items });
      return;
    }
    if (mode === "rift") {
      this.enqueueModal({ kind: "mode_result", mode, title: "Rift sealed", subtitle: `${wave} waves`, lines: [{ label: "Essence", value: `+${this.run.kills * RIFT_ESSENCE_PER_KILL}`, tone: "jade" }, { label: "Oaths bound", value: `${this.run.raised}` }, { label: "Gold", value: `+${this.run.gold}`, tone: "gold" }], success: true });
    }
  }

  private onEndlessOver(wave: number): void {
    this.objectiveEvent("modeRuns", 1);
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
      this.objectiveEvent("gear", 1);
      p.player.gold += salvageValue(item);
      this.toast("Inventory full. Item salvaged for gold.", "warn");
      return;
    }
    p.equipment.inventory.push(item);
    this.objectiveEvent("gear", 1);
    // An empty slot is never a decision: once the gear lesson is learned, fill it straight away.
    const gearLearned = p.tutorial.finished || p.tutorial.completed.includes("gear");
    if (gearLearned && !p.equipment.equipped[item.slot]) {
      p.equipment.equipped[item.slot] = item.uid;
      this.refreshLoadout();
      this.toast(`Equipped: ${itemName(item)}`, "gold");
      this.sfx("equip", { volume: 0.5 });
      return;
    }
    // Loot announces itself in proportion to its worth.
    if (item.effect) {
      this.toast(`${item.rarity === "legendary" ? "Legendary" : "Epic"}: ${itemName(item)} ✦ ${GEAR_EFFECTS[item.effect].name}`, "gold");
      this.sfx("level_up", { volume: 0.7, rate: 1.15 });
      this.renderer?.flash(item.rarity === "legendary" ? 0xe9c56f : 0xb595e6, 0.18);
    } else this.toast(`Found: ${itemName(item)}`, "gold", true);
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

  /** Tap on the battlefield: an enemy under the finger becomes the focus target (tap again to clear). */
  focusAt(clientX: number, clientY: number): void {
    const world = this.world;
    const id = this.renderer?.pickEnemy(clientX, clientY) ?? null;
    if (!world || id === null) return;
    if (world.focusId === id) {
      world.setFocus(-1);
      this.sfx("ui_tap", { volume: 0.3, rate: 0.8 });
      return;
    }
    if (world.setFocus(id)) {
      this.sfx("ui_tap", { volume: 0.5, rate: 1.3 });
      if (!this.seenFocus) {
        this.seenFocus = true;
        this.toast("Focus: your warrior and army strike this foe first. Tap it again to release.", "info");
      }
    }
  }

  private seenFocus = false;

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
    this.objectiveEvent("binds", 1);
    const roll = first ? 0 : this.rng.next();
    const result = resolveExtraction(p, peek.summonId, roll, { elite: peek.elite, bonus: computeModifiers(p).extractionBonus });
    if (!result.success) {
      const left = world.failExtraction(orbId);
      this.sfx("enemy_death", { volume: 0.8, rate: 0.55 });
      this.renderer?.playExtractionFail(peek.pos);
      const pity = p.summons.pity[peek.summonId] ?? 0;
      const firstRefusal = p.summons.totalAttempts <= 6 && !this.explainedBind;
      this.explainedBind = true;
      if (firstRefusal) this.toast("BIND is a chance. Every refusal raises the next one until the oath must be kept.", "info");
      else this.toast(left > 0 ? `The oath is refused. ${left} attempt${left > 1 ? "s" : ""} left.` : `The oath is refused. +${result.essenceOnFail} essence, next attempt +${Math.round(pity * 12)}%`, "warn");
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
      this.objectiveEvent("upgrades", 1);
      this.coachUpgrade = false;
      const lvNow = this.profile.player.statLevels[stat];
      if ((stat === "attack" || stat === "maxHp") && lvNow % MILESTONE_EVERY === 0) {
        this.toast(`${STAT_LABEL[stat]} milestone: ×${MILESTONE_MULT}`, "level");
        this.sfx("level_up", { volume: 0.8, rate: 1.1 });
        this.renderer?.flash(0xe9c97a, 0.25);
        this.renderer?.levelUpBurst();
      }
      if (this.uiStore.get().guide?.target.startsWith("upgrade-")) this.uiStore.update((u) => ({ ...u, guide: null }));
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
    this.objectiveEvent("upgrades", 1);
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
    this.objectiveEvent("shadowUps", 1);
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
    this.objectiveEvent("shadowUps", 1);
    this.sfx("summon_first", { volume: 0.9, rate: 1.3 });
    this.toast(`${check.def.name} has awakened`, "level");
    this.renderer?.flash(check.def.palette.glow, 0.5);
    this.refreshLoadout();
    this.afterProgression();
    this.commit();
    return true;
  }

  private revealTechniques(ids: AbilityId[]): void {
    for (const id of ids) {
      this.sfx("quest", { volume: 0.6 });
      this.enqueueModal({ kind: "technique", id });
      this.uiStore.update((u) => ({ ...u, newBadges: { ...u.newBadges, skills: true } }));
    }
    if (ids.length) {
      this.refreshLoadout();
      this.commitSoon();
    }
  }

  /** From a result card: walk the player to their upgrades. */
  spendGoldNow(): void {
    this.userGesture();
    this.coachUpgrade = true;
    this.setPanel("hero");
    // A result card can pause the loop that normally refreshes guidance, so point now.
    const guide = this.contextualGuide("hero");
    if (guide) this.uiStore.update((u) => ({ ...u, guide }));
  }

  /** Swap a slot between its base ability and a learned technique. */
  setArtForm(slot: AbilityId, form: AbilityId): boolean {
    this.userGesture();
    const ok = setSlotForm(this.profile, slot, form);
    if (!ok) {
      this.sfx("error", { volume: 0.3 });
      return false;
    }
    this.sfx("equip", { volume: 0.5 });
    this.refreshLoadout();
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
    this.objectiveEvent("shadowUps", 1);
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

  /** Turn a shadow's surplus shards into a Rift Core. */
  refineShards(instanceId: string): boolean {
    this.userGesture();
    const p = this.profile;
    const inst = p.summons.collection.find((s) => s.instanceId === instanceId);
    const gained = inst ? doRefineShards(inst) : 0;
    if (!gained) {
      this.sfx("error", { volume: 0.3 });
      this.toast(`Refining needs ${REFINE_SHARDS} spare shards`, "warn");
      return false;
    }
    p.player.riftCores += gained;
    this.sfx("level_up", { volume: 0.5, rate: 1.4 });
    this.toast(`Refined ${REFINE_SHARDS} shards into a Rift Core`, "essence");
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

  /** Farm a chosen stage (from the Rift panel). Choosing below the frontier holds there. */
  selectStage(stage: number): void {
    this.userGesture();
    if (this.pending || this.world?.player.dead) {
      this.toast("Your warrior is regrouping", "warn");
      return;
    }
    const p = this.profile;
    const s = clampFarmStage(p, stage);
    p.progress.currentStage = s;
    p.progress.autoPush = s >= frontierStage(p);
    this.commit();
    if (this.world?.farming && !this.world.player.dead) this.world.moveToStage(s);
    else this.startRun(s);
    this.toast(s >= frontierStage(p) ? `Stage ${s}` : `Farming stage ${s}`, "info");
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

  openAscension(): void {
    this.userGesture();
    this.uiStore.update((u) => ({ ...u, modal: { kind: "ascend" } }));
  }

  /**
   * Ascend: the climb starts over for permanent Aether. Only from farming, never mid-fight or
   * while the warrior is down. Saved at once.
   */
  confirmAscend(): boolean {
    this.userGesture();
    const world = this.world;
    if (!world?.farming || world.player.dead || this.pending) {
      this.toast("Ascend from the campaign, between fights", "warn");
      return false;
    }
    const res = doAscend(this.profile);
    if (!res) {
      this.sfx("error", { volume: 0.3 });
      return false;
    }
    this.forecast = null;
    this.forecastStore.set(null);
    this.closeModal();
    this.startRun(1, "campaign");
    this.sfx("summon_first", { volume: 0.9, rate: 0.9 });
    this.renderer?.flash(0xe9c97a, 0.55);
    this.renderer?.levelUpBurst();
    this.toast(`Ascension ${romanAscension(res.count)}: +${fmt(res.gained)} Aether. Your power carries into every climb.`, "level");
    this.refreshLoadout();
    this.commit();
    void this.save.flush();
    return true;
  }

  /** Spend Aether on a node of the Ascension tree. */
  buyAscensionNode(id: TreeNodeId): boolean {
    this.userGesture();
    if (!doBuyNode(this.profile, id)) {
      this.sfx("error", { volume: 0.3 });
      return false;
    }
    this.sfx("upgrade", { volume: 0.7, rate: 0.85 });
    this.renderer?.flash(0xe9c97a, 0.15);
    this.refreshLoadout();
    this.commit();
    return true;
  }

  openObjectives(): void {
    this.userGesture();
    if (refreshObjectives(this.profile)) this.commit();
    this.uiStore.update((u) => ({ ...u, modal: { kind: "objectives" }, newBadges: { ...u.newBadges, rift: false } }));
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

  /** The offline card only reports: everything was credited (and saved) before it opened. */
  dismissOffline(): void {
    this.userGesture();
    if (this.uiStore.get().modal?.kind === "offline") this.sfx("gold", { volume: 0.7 });
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

  toast(text: string, tone: Toast["tone"] = "info", low = false): void {
    // Routine news (a fallen companion, a cycle's gold) never pushes out something more important.
    if (low && this.uiStore.get().toasts.some((t) => !t.low)) return;
    const id = ++this.toastId;
    this.uiStore.update((u) => ({ ...u, toasts: [{ id, text, tone, low }] }));
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
    if (ui.modal !== null) {
      // Only the boss lesson points into a card (at FIGHT); everything else waits for it to close.
      const bossStep = TUTORIAL_STEPS.find((st) => st.id === "boss");
      if (ui.modal.kind === "boss_ready" && bossStep && !p.tutorial.finished && !p.tutorial.completed.includes("boss")) setGuide(this.guideFor(bossStep, 1), "boss");
      else if (ui.guide) setGuide(null, ui.tutorialStep);
      return;
    }
    const ctx = { profile: p, snapshot: snap, elapsed: this.tutorialElapsed, panel: ui.panel, enemyWindupNearPlayer: this.enemyWindupNearPlayer };
    if (!p.tutorial.finished) {
      const remaining = TUTORIAL_STEPS.filter((st) => !p.tutorial.completed.includes(st.id));
      if (remaining.length === 0) {
        this.finishTutorial();
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
        if (step.id === "boss") this.tutorialSubstep = 0;
        setGuide(this.guideFor(step, this.tutorialSubstep), step.id);
        return;
      }
    }
    // Contextual hints wait while a card is open or a boss fight is on: one thing at a time.
    if (ui.modal !== null || !world.farming) {
      setGuide(null, null);
      return;
    }
    setGuide(this.contextualGuide(ui.panel), null);
  }

  /** Hints outside the scripted steps: rewards to collect, and gold to spend after a loss. */
  private contextualGuide(panel: string): UiState["guide"] {
    const p = this.profile;
    const q = currentQuest(p);
    if (q && isQuestComplete(p, q)) return { target: "quest-claim", label: "Claim reward", gesture: "tap" };
    if (this.coachUpgrade) {
      const stat = canUpgradeStat(p, "maxHp").ok ? "maxHp" : canUpgradeStat(p, "attack").ok ? "attack" : null;
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
    if (TUTORIAL_STEPS.every((s) => p.tutorial.completed.includes(s.id))) this.finishTutorial();
    this.commit();
  }

  /** The lessons are over: the warrior fights on their own from here, abilities included. */
  private finishTutorial(): void {
    const p = this.profile;
    if (p.tutorial.finished) return;
    p.tutorial.finished = true;
    if (!p.player.autoCast) {
      p.player.autoCast = true;
      this.refreshLoadout();
    }
    this.toast("You know the way. AUTO is on: tap it to take the abilities yourself.", "level");
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
    case "blade_tempest":
      return "arc_slash";
    case "chain_hook":
      return "command";
    case "blood_pact":
      return "soul_burst";
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
