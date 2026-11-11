import { PlaytestLog, summarize, type PlaytestSnapshot } from "./PlaytestLog";

/**
 * Playtest mode (`?playtest=1`): records one real session on a real device and lets the player
 * copy the report. Nothing is sent anywhere. It measures what a headless test cannot: frame times
 * on real hardware, how long a person takes to reach each "first", taps that land on nothing, and
 * what they thought.
 */
export interface PlaytestHost {
  profile: {
    progress: { totalKills: number; bestStage: number; bossGate: number; bossWins: number; bossLosses: number };
    player: { gold: number; level: number; statLevels: Record<string, number> };
    summons: { collection: { deployed: boolean }[] };
    equipment: { inventory: unknown[]; equipped: Record<string, unknown> };
    tutorial: { finished: boolean };
  };
  uiStore: { get(): { guide: { label: string } | null; modal: { kind: string } | null; panel: string } };
  world: { mode: string; player: { dead: boolean } } | null;
}

/** Statements adapted from the constructs of the Player Experience Inventory (own wording). 1 = strongly disagree, 7 = strongly agree. */
export const SURVEY: { id: string; text: string }[] = [
  { id: "impact", text: "Hits felt powerful." },
  { id: "clarity", text: "I always knew what to do next." },
  { id: "appeal", text: "It looked and sounded good." },
  { id: "progress", text: "I could tell I was getting stronger." },
  { id: "control", text: "The controls did what I expected." },
  { id: "curiosity", text: "I wanted to see what comes next." },
  { id: "enjoyment", text: "I enjoyed playing." },
];

export function playtestRequested(search: string): boolean {
  return new URLSearchParams(search).get("playtest") === "1";
}

export function snapshotOf(host: PlaytestHost): PlaytestSnapshot {
  const p = host.profile;
  const ui = host.uiStore.get();
  return {
    kills: p.progress.totalKills,
    gold: p.player.gold,
    level: p.player.level,
    stageCleared: p.progress.bestStage,
    bossGate: p.progress.bossGate,
    bossWins: p.progress.bossWins,
    bossLosses: p.progress.bossLosses,
    upgrades: Object.values(p.player.statLevels).reduce((a, b) => a + b, 0) - Object.keys(p.player.statLevels).length,
    shadows: p.summons.collection.length,
    deployed: p.summons.collection.filter((s) => s.deployed).length,
    items: p.equipment.inventory.length,
    equipped: Object.keys(p.equipment.equipped).length,
    tutorialDone: p.tutorial.finished,
    guide: ui.guide?.label ?? null,
    card: ui.modal?.kind ?? null,
    panel: ui.panel,
    mode: host.world?.mode ?? "campaign",
    dead: !!host.world?.player.dead,
  };
}

const INTERACTIVE = "button, a, input, textarea, select, [role=button], [role=tab], [role=switch], canvas, [data-testid=battle-canvas]";

function describeDevice(): Record<string, string | number> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const out: Record<string, string | number> = {
    ua: nav.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: window.devicePixelRatio,
    cores: nav.hardwareConcurrency ?? 0,
    memoryGb: nav.deviceMemory ?? 0,
    standalone: window.matchMedia("(display-mode: standalone)").matches ? 1 : 0,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 0,
  };
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    if (gl && ext) out.gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    /* no GPU string: fine */
  }
  return out;
}

/** Starts recording. Returns a function that stops it and removes its interface. */
export function attachPlaytest(host: PlaytestHost): () => void {
  const log = new PlaytestLog();
  log.device = describeDevice();
  let raf = 0;
  let last = performance.now();
  let sincePoll = 0;
  let stopped = false;

  const pill = document.createElement("button");
  pill.type = "button";
  pill.setAttribute("data-testid", "playtest-pill");
  pill.setAttribute("data-playtest", "1");
  pill.style.cssText =
    "position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 50px);transform:translateX(-50%);z-index:95;height:28px;padding:0 12px;border:0;border-radius:999px;background:rgba(12,12,13,.72);color:#f3f0e9;font:500 12px/28px system-ui,sans-serif;letter-spacing:.01em;opacity:.85;touch-action:manipulation";
  document.body.appendChild(pill);

  const tick = (now: number) => {
    if (stopped) return;
    const ms = now - last;
    last = now;
    log.frame(ms);
    sincePoll += ms / 1000;
    if (sincePoll >= 1) {
      log.poll(snapshotOf(host), sincePoll);
      sincePoll = 0;
      const s = Math.floor(log.report().seconds);
      pill.textContent = `Playtest ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} · Report`;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  const onDown = (e: PointerEvent) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!el || el.closest("[data-playtest]")) return;
    const hit = el.closest(INTERACTIVE);
    const named = el.closest("[data-testid]");
    log.tap({ x: e.clientX, y: e.clientY, target: named?.getAttribute("data-testid") ?? (hit ? hit.tagName.toLowerCase() : ""), interactive: !!hit });
  };
  const onVisibility = () => {
    if (document.hidden) log.wentHidden();
    else last = performance.now();
  };
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("visibilitychange", onVisibility);

  let sheet: HTMLDivElement | null = null;
  const closeSheet = () => {
    sheet?.remove();
    sheet = null;
  };
  const openSheet = () => {
    closeSheet();
    const r = log.report();
    sheet = document.createElement("div");
    sheet.setAttribute("data-playtest", "1");
    sheet.setAttribute("data-testid", "playtest-sheet");
    sheet.style.cssText = "position:fixed;inset:0;z-index:96;background:#0a0a0b;color:#f3f0e9;font:400 14px/20px system-ui,sans-serif;overflow:auto;padding:calc(env(safe-area-inset-top,0px) + 20px) 20px calc(env(safe-area-inset-bottom,0px) + 24px);touch-action:pan-y;user-select:text;-webkit-user-select:text";
    const h = (tag: string, css: string, text = "") => {
      const n = document.createElement(tag);
      n.style.cssText = css;
      if (text) n.textContent = text;
      return n;
    };
    sheet.appendChild(h("div", "font:600 20px/26px system-ui,sans-serif;margin-bottom:4px", "Playtest report"));
    sheet.appendChild(h("div", "color:#a9a59d;margin-bottom:16px", "Recorded on this device only. Nothing is sent. Copy it and paste it back to the developer."));
    for (const line of summarize(r)) sheet.appendChild(h("div", "padding:8px 0;border-bottom:1px solid rgba(255,255,255,.07)", line));
    sheet.appendChild(h("div", "font:600 12px/16px system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#a9a59d;margin:22px 0 4px", "Two minutes of your opinion"));
    sheet.appendChild(h("div", "color:#74716b;font-size:12px;margin-bottom:6px", "1 = strongly disagree, 7 = strongly agree"));
    for (const q of SURVEY) {
      const row = h("div", "padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07)");
      row.appendChild(h("div", "margin-bottom:8px", q.text));
      const scale = h("div", "display:grid;grid-template-columns:repeat(7,1fr);gap:6px");
      for (let v = 1; v <= 7; v++) {
        const b = h("button", "height:44px;border:0;border-radius:10px;background:#1b1b1d;color:#f3f0e9;font:600 15px system-ui,sans-serif", String(v)) as HTMLButtonElement;
        b.type = "button";
        const paint = () => {
          b.style.background = log.survey[q.id] === v ? "#dab86c" : "#1b1b1d";
          b.style.color = log.survey[q.id] === v ? "#1b1508" : "#f3f0e9";
        };
        paint();
        b.onclick = () => {
          log.survey[q.id] = v;
          for (const sib of Array.from(scale.children)) (sib as HTMLButtonElement).dispatchEvent(new Event("repaint"));
        };
        b.addEventListener("repaint", paint);
        scale.appendChild(b);
      }
      row.appendChild(scale);
      sheet.appendChild(row);
    }
    const ret = h("div", "padding:10px 0;border-bottom:1px solid rgba(255,255,255,.07)");
    ret.appendChild(h("div", "margin-bottom:8px", "How likely are you to open it again tomorrow? (0 to 10)"));
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = "10";
    range.value = String(log.survey.return ?? 5);
    range.style.cssText = "width:100%;height:44px;touch-action:pan-x";
    const rv = h("div", "color:#a9a59d;font-size:12px", `${range.value}`);
    range.oninput = () => {
      log.survey.return = Number(range.value);
      rv.textContent = range.value;
    };
    ret.appendChild(range);
    ret.appendChild(rv);
    sheet.appendChild(ret);
    const ta = document.createElement("textarea");
    ta.placeholder = "What felt cheap, confusing or slow? What was the best moment?";
    ta.value = String(log.survey.notes ?? "");
    ta.style.cssText = "width:100%;min-height:96px;margin-top:14px;padding:12px;border:0;border-radius:14px;background:#1b1b1d;color:#f3f0e9;font:400 14px/20px system-ui,sans-serif;user-select:text;-webkit-user-select:text;touch-action:manipulation";
    ta.oninput = () => (log.survey.notes = ta.value);
    sheet.appendChild(ta);
    const actions = h("div", "display:flex;gap:10px;margin-top:18px");
    const close = h("button", "flex:.8;height:52px;border:0;border-radius:14px;background:#1b1b1d;color:#f3f0e9;font:600 16px system-ui,sans-serif", "Keep playing") as HTMLButtonElement;
    close.type = "button";
    close.onclick = closeSheet;
    const copy = h("button", "flex:1.2;height:52px;border:0;border-radius:14px;background:#dab86c;color:#1b1508;font:600 16px system-ui,sans-serif", "Copy report") as HTMLButtonElement;
    copy.type = "button";
    copy.setAttribute("data-testid", "playtest-copy");
    const raw = document.createElement("textarea");
    raw.readOnly = true;
    raw.setAttribute("data-testid", "playtest-json");
    raw.style.cssText = "width:100%;height:72px;margin-top:14px;padding:10px;border:0;border-radius:10px;background:#121213;color:#74716b;font:400 11px/14px ui-monospace,monospace;user-select:text;-webkit-user-select:text";
    const fill = () => (raw.value = JSON.stringify(log.report()));
    fill();
    copy.onclick = async () => {
      fill();
      try {
        await navigator.clipboard.writeText(raw.value);
        copy.textContent = "Copied";
      } catch {
        // No clipboard permission: select the text so the player can copy it by hand.
        raw.focus();
        raw.select();
        copy.textContent = "Select all, then copy";
      }
    };
    actions.appendChild(close);
    actions.appendChild(copy);
    sheet.appendChild(actions);
    sheet.appendChild(raw);
    document.body.appendChild(sheet);
  };
  pill.onclick = openSheet;

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    document.removeEventListener("pointerdown", onDown, true);
    document.removeEventListener("visibilitychange", onVisibility);
    closeSheet();
    pill.remove();
  };
}
