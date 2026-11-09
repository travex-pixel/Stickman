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
import { offerPerks, takePerk as doTakePerk } from "./progression/perks";
import { claimQuest as doClaimQuest, currentQuest, isQuestComplete } from "./progression/quests";
import { evaluateAchievements, evaluateJournal } from "./progression/achievements";
import { computeModifiers } from "./progression/stats";
import { claimEssence as doClaimEssence, setDeployed, type ClaimOutcome } from "./summons/recruitment";
import { bondCost, BOND_CAP, checkEvolution, evolveSummon, grantSummonXp } from "./summons/progression";
import { enemyDef } from "./data/enemies";
import { stageScale } from "./data/regions";
import { EQUIPMENT_LEVEL_CAP, equipmentUpgradeCost, salvageValue } from "./economy/loot";
import { INVENTORY_CAP } from "./data/equipment";
import { IndexedDbSaveManager } from "@/persistence/SaveManager";
import { computeOfflineReward, type OfflineReward } from "@/persistence/OfflineRewards";
import { AudioManager } from "./audio/AudioManager";
import type { SfxName } from "./audio/synth";
import type { PerkDef } from "./data/perks";
import { TUTORIAL_STEPS, nextTutorialStep, type TutorialStep, type TutorialStepId } from "./tutorial";
import type { BattleRenderer } from "./render/BattleRenderer";
import { summonDef } from "./data/summons";
import { WEAPON_PATHS } from "./progression/weaponPaths";
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
  | { kind: "boss_intro"; defId: string };

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
  fps: number;
  renderStats: { particles: number; entities: number; renderer: string; frameMs: number };
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
    fps: 0,
    renderStats: { particles: 0, entities: 0, renderer: "", frameMs: 0 },
  });
  readonly audio = new AudioManager();
  readonly save = new IndexedDbSaveManager();
  world: World | null = null;
  renderer: BattleRenderer | null = null;
  view: ViewTransform = { scale: 1, offsetX: 0, offsetY: 0, depthScale: 1, width: 0, height: 0 };
  private loop: GameLoop;
  private hudAccum = 0;
  private toastId = 0;
  private modalQueue: Modal[] = [];
  private tutorialElapsed = 0;
  private tutorialSubstep = 0;
  private enemyWindupNearPlayer = false;
  private disposed = false;
  private rng = new Rng(Date.now() >>> 0);
  private visibilityHandler = () => this.onVisibility();
  private pageHideHandler = () => void this.save.flush();
  private booted = false;
  private cinematicTimer: ReturnType<typeof setTimeout> | null = null;

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
    const profile = result.profile;
    const now = Date.now();
    let note: string | null = null;
    if (result.repaired) note = "Your save was repaired.";
    if (result.migrated) note = "Your save was updated.";
    if (!result.fresh) {
      const reward = computeOfflineReward(profile.lastActive, now, profile.progress.currentStage, computeModifiers(profile).goldFind);
      if (reward && reward.gold > 0) this.enqueueModal({ kind: "offline", reward });
    }
    profile.lastActive = now;
    profile.progress.runs += 1;
    this.profileStore.set({ profile, v: 1 });
    this.audio.init();
    this.audio.setVolumes(profile.settings.music, profile.settings.sfx);
    this.startRun(profile.progress.currentStage);
    this.uiStore.update((u) => ({ ...u, booted: true, loadNote: note }));
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.visibilityHandler);
      window.addEventListener("pagehide", this.pageHideHandler);
    }
    this.loop.start();
    this.flushModalQueue();
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

  startRun(stage: number): void {
    this.world?.dispose();
    const loadout = buildLoadout(this.profile);
    this.world = new World({ stage, loadout, seed: (Date.now() ^ (stage * 2654435761)) >>> 0 });
    this.renderer?.setWorld(this.world);
    this.hudStore.set(this.world.snapshot());
  }

  private commit(): void {
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

  private simulate(dt: number): void {
    const world = this.world;
    if (!world) return;
    if (!this.paused && world.phase !== "defeat" && world.phase !== "victory") world.update(dt);
    else if (!this.paused) world.update(dt); // let death/victory animations finish
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

  private renderErrorLogged = false;

  private render(alpha: number, dtReal: number): void {
    const r = this.renderer;
    if (r) {
      try {
        r.render(alpha, dtReal, this.paused);
      } catch (err) {
        if (!this.renderErrorLogged) {
          this.renderErrorLogged = true;
          console.error("[ASCEND] render error", err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : err);
        }
        return;
      }
      const ui = this.uiStore.get();
      if (ui.fps !== this.loop.fps && Math.random() < 0.1) {
        const stats = r.stats();
        this.uiStore.set({ ...ui, fps: this.loop.fps, renderStats: { ...stats, frameMs: Math.round(this.loop.frameMs * 10) / 10 } });
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
          if (e.faction === "enemy") this.sfx(e.crit ? "crit" : e.heavy ? "hit_heavy" : "hit_light", { minInterval: e.crit ? 60 : 45, volume: e.crit ? 0.9 : 0.55, rate: 0.9 + Math.random() * 0.25 });
          else this.sfx("hit_heavy", { minInterval: 120, volume: 0.6, rate: 0.8 });
          break;
        case "death":
          if (e.kind === "enemy" || e.kind === "boss") {
            kills += 1;
            p.progress.killsByEnemy[e.defId] = (p.progress.killsByEnemy[e.defId] ?? 0) + 1;
            this.sfx(e.kind === "boss" ? "boss_death" : "enemy_death", { volume: e.kind === "boss" ? 1 : 0.5, minInterval: 80, rate: 0.9 + Math.random() * 0.2 });
            if (e.kind === "boss") {
              p.progress.bossKills += 1;
              if (p.progress.bossKills === 1 || this.rng.chance(0.35)) {
                p.player.riftCores += 1;
                this.toast("Rift Core recovered", "essence");
              }
            }
            // Summons share experience from every kill while deployed.
            const def = enemyDef(e.defId);
            const share = def.xp * stageScale(this.world?.stage ?? 1).reward * 0.6 * computeModifiers(p).summonXpMult;
            for (const s of p.summons.collection) {
              if (!s.deployed) continue;
              const before = s.level;
              grantSummonXp(s, share);
              if (s.level > before) this.toast(`${summonDef(s.defId).name} reached level ${s.level}`, "level");
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
            dirty = true;
            this.sfx(castSfx(e.ability), { volume: e.ability === "ascendant_fury" ? 1 : 0.8, minInterval: 150 });
            if (e.ability === "ascendant_fury") this.renderer?.flash(0xffd36b, 0.35);
          }
          break;
        case "dodge":
          if (e.id === this.world?.player.id) this.sfx("dodge", { volume: 0.6 });
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
          this.onStageCleared(e.stage);
          dirty = true;
          break;
        case "player_defeated":
          this.sfx("boss_intro", { volume: 0.6, rate: 1.6 });
          this.enqueueModal({ kind: "defeat", stage: e.stage, wave: e.wave });
          break;
        case "loot":
          this.sfx("equip", { volume: 0.4 });
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
      this.sfx("gold", { volume: 0.35, minInterval: 120, rate: 0.95 + Math.random() * 0.2 });
      dirty = true;
    }
    if (kills > 0) {
      p.progress.totalKills += kills;
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
      this.commit();
    }
  }

  private afterProgression(): void {
    const p = this.profile;
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
    p.player.skillPoints += levels;
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
    if (!this.uiStore.get().modal || this.uiStore.get().modal?.kind === "boss_intro") this.offerPerkChoice();
    else this.enqueueModal({ kind: "perk_choice", perks: offerPerks(p, this.rng) });
  }

  private offerPerkChoice(): void {
    if (this.profile.player.pendingPerkChoices <= 0) return;
    this.enqueueModal({ kind: "perk_choice", perks: offerPerks(this.profile, this.rng) });
  }

  private onStageCleared(stage: number): void {
    const p = this.profile;
    const scale = stageScale(stage);
    const gold = Math.round(60 * stage * scale.reward * computeModifiers(p).goldFind);
    const xp = Math.round(90 * stage * scale.reward);
    p.player.gold += gold;
    const res = applyXp(p.player.level, p.player.xp, xp);
    p.player.level = res.level;
    p.player.xp = res.xp;
    p.progress.bestStage = Math.max(p.progress.bestStage, stage);
    p.progress.currentStage = Math.max(p.progress.currentStage, stage);
    const items = (this.world?.takeLoot() ?? []).map((l) => l.item);
    for (const it of items) this.addItem(it);
    let riftCores = 0;
    if (stage % 3 === 0) {
      riftCores = 1;
      p.player.riftCores += 1;
    }
    this.sfx("level_up", { volume: 0.9, rate: 0.85 });
    this.enqueueModal({ kind: "stage_clear", stage, gold, xp, items, riftCores, nextStage: stage + 1 });
    if (res.levelsGained > 0) this.onLevelUp(res.levelsGained);
  }

  private addItem(item: EquipmentItem): void {
    const p = this.profile;
    if (p.equipment.inventory.length >= INVENTORY_CAP) {
      p.player.gold += salvageValue(item);
      this.toast("Inventory full. Item salvaged for gold.", "warn");
      return;
    }
    p.equipment.inventory.push(item);
    this.toast(`Found: ${itemName(item)}`, "gold");
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

  claimEssence(orbId: number): void {
    this.userGesture();
    const world = this.world;
    if (!world) return;
    const orb = world.claimEssence(orbId);
    if (!orb) return;
    const p = this.profile;
    const first = !p.summons.firstSummonSeen;
    const outcome = doClaimEssence(p, orb.summonId);
    if (outcome.kind === "new") p.summons.firstSummonSeen = true;
    const modal: Modal = { kind: "summon_reveal", outcome, summonId: orb.summonId, first: first && outcome.kind === "new", cinematicDone: false };
    this.sfx(first ? "summon_first" : "summon_claim", { volume: 1 });
    this.renderer?.playSummonCinematic(orb.summonId, orb.pos, first && outcome.kind === "new");
    this.uiStore.update((u) => ({ ...u, modal, newBadges: { ...u.newBadges, summons: true }, selectedSummon: outcome.instance?.instanceId ?? u.selectedSummon }));
    if (this.cinematicTimer) clearTimeout(this.cinematicTimer);
    const duration = first && outcome.kind === "new" ? 4600 : 1500;
    this.cinematicTimer = setTimeout(() => {
      this.uiStore.update((u) => (u.modal?.kind === "summon_reveal" ? { ...u, modal: { ...u.modal, cinematicDone: true } } : u));
    }, duration);
    if (outcome.kind === "sigil") this.toast(`Warden Sigil ${outcome.sigils}/3`, "essence");
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
    this.uiStore.update((u) => ({ ...u, toasts: [...u.toasts.slice(-1), { id, text, tone }] }));
    setTimeout(() => this.uiStore.update((u) => ({ ...u, toasts: u.toasts.filter((t) => t.id !== id) })), 2600);
  }

  private sfx(name: SfxName, opts?: { volume?: number; rate?: number; minInterval?: number }): void {
    this.audio.play(name, opts);
  }

  // ---------------------------------------------------------------------
  // Tutorial director
  // ---------------------------------------------------------------------

  private updateTutorial(snap: WorldSnapshot): void {
    const p = this.profile;
    const ui = this.uiStore.get();
    const world = this.world;
    if (!world) return;
    this.enemyWindupNearPlayer = false;
    for (const e of world.enemies()) {
      if (e.state === "windup" && e.pendingTargetId === world.player.id) this.enemyWindupNearPlayer = true;
    }
    if (p.tutorial.finished) {
      // Post-tutorial contextual guidance: point at a claimable quest reward once in a while.
      const q = currentQuest(p);
      const guide = q && isQuestComplete(p, q) && ui.modal === null ? { target: "quest-claim", label: "Claim reward", gesture: "tap" as const } : null;
      if ((guide?.target ?? null) !== (ui.guide?.target ?? null)) this.uiStore.update((u) => ({ ...u, guide, tutorialStep: null }));
      return;
    }
    const step = nextTutorialStep(p);
    if (!step) {
      p.tutorial.finished = true;
      this.toast("You know the way. Ascend.", "level");
      this.uiStore.update((u) => ({ ...u, guide: null, tutorialStep: null }));
      this.commit();
      return;
    }
    const ctx = { profile: p, snapshot: snap, elapsed: this.tutorialElapsed, panel: ui.panel, enemyWindupNearPlayer: this.enemyWindupNearPlayer };
    const active = ui.tutorialStep === step.id;
    if (!active) {
      if (ui.modal !== null) return;
      if (!step.ready(ctx)) {
        if (ui.guide) this.uiStore.update((u) => ({ ...u, guide: null }));
        return;
      }
      this.tutorialElapsed = 0;
      this.tutorialSubstep = 0;
      this.uiStore.update((u) => ({ ...u, tutorialStep: step.id, guide: this.guideFor(step, 0) }));
      return;
    }
    if (step.autoComplete && step.autoComplete(ctx)) {
      this.completeTutorialIf(step.id);
      return;
    }
    // Advance sub-steps when the player reaches the right panel.
    const sub = step.targets[this.tutorialSubstep];
    if (sub?.panel && ui.panel === sub.panel && this.tutorialSubstep < step.targets.length - 1) {
      this.tutorialSubstep += 1;
      this.uiStore.update((u) => ({ ...u, guide: this.guideFor(step, this.tutorialSubstep) }));
    } else if (sub?.panel && ui.panel !== sub.panel && this.tutorialSubstep > 0) {
      this.tutorialSubstep = 0;
      this.uiStore.update((u) => ({ ...u, guide: this.guideFor(step, 0) }));
    }
    // Hide the guide while a modal is open, bring it back afterwards.
    if (ui.modal !== null && ui.guide) this.uiStore.update((u) => ({ ...u, guide: null }));
    else if (ui.modal === null && !ui.guide) this.uiStore.update((u) => ({ ...u, guide: this.guideFor(step, this.tutorialSubstep) }));
    // Steps whose precondition evaporated (orb expired, enemies died) step aside so the game never stalls.
    if ((step.id === "summon" || step.id === "dodge" || step.id === "ability" || step.id === "command") && !step.ready(ctx) && !(step.id === "ability" && (snap.cooldowns.arc_slash ?? 0) > 0)) {
      if (step.id === "dodge" || step.id === "summon" || step.id === "command") {
        this.uiStore.update((u) => ({ ...u, tutorialStep: null, guide: null }));
      }
    }
  }

  private guideFor(step: TutorialStep, sub: number): UiState["guide"] {
    const t = step.targets[Math.min(sub, step.targets.length - 1)];
    if (!t) return null;
    return { target: t.target, label: t.label, gesture: t.gesture };
  }

  private completeTutorialIf(id: TutorialStepId): void {
    const p = this.profile;
    if (p.tutorial.finished || p.tutorial.completed.includes(id)) return;
    const ui = this.uiStore.get();
    if (ui.tutorialStep !== id && !["summon", "deploy", "command", "gear", "upgrade"].includes(id)) return;
    p.tutorial.completed.push(id);
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
