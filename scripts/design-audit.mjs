// Design lint: measures every major screen against the Rebirth rules, so "premium" is checked
// with numbers and not by eye alone. It reads only what is actually on top (occluded elements
// are ignored), at a phone viewport.
//
// Usage: PORT=3100 [OUT=dir] [W=390 H=844] node scripts/design-audit.mjs   (needs `next start` on PORT)
//
// Per screen it reports:
//   text<11     text elements under 11px (the type floor)
//   sizes       distinct font sizes in view (target: few)
//   fams        distinct font families
//   caps        uppercase text elements (target: at most one eyebrow)
//   heavy       text at weight 700 or more
//   boxes       bordered containers (three or more visible sides, over 30x30)
//   grads       elements painted with a gradient
//   shadows     elements with a box or text shadow
//   targets<44  interactive elements smaller than 44px in either dimension
//   lowC        text under 4.5:1 against its resolved solid background (large text: 3:1)
//   unkC%       share of text whose background could not be resolved (gradient, glass, painting)
//   overflow    horizontal overflow in px
import { mkdirSync, writeFileSync } from "node:fs";
import { openGame, walkScreens } from "./lib/screens.mjs";

function measure() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,/ ]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const onTop = (el, r) => {
    const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
    const y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  };
  const solidBehind = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const img = cs.backgroundImage && cs.backgroundImage !== "none" ? cs.backgroundImage : "";
      // A gradient or a picture behind text: unknown. A faint SVG texture over a solid colour (the
      // panel's paper grain) does not change the colour text is read against: use the colour.
      const textureOnly = img !== "" && !img.includes("gradient") && /^url\("?data:image\/svg\+xml/.test(img);
      if (img !== "" && !textureOnly) return null;
      if (n.tagName === "CANVAS" || n.dataset?.testid === "battlefield") return null; // over the painting
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a >= 0.9) return bg;
      if (bg && bg.a > 0.05) return null; // translucent: unknown
    }
    return parse(getComputedStyle(document.body).backgroundColor);
  };
  const out = { small: [], sizes: new Set(), fams: new Set(), caps: 0, heavy: 0, boxes: 0, grads: 0, shadows: 0, targets: [], lowC: [], unknownC: 0, texts: 0 };
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible" || cs.display === "none" || Number(cs.opacity) < 0.05) continue;
    if (!onTop(el, r)) continue;
    const id = el.dataset?.testid || el.getAttribute("aria-label") || (el.textContent ?? "").trim().slice(0, 24);
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (hasText) {
      out.texts++;
      const size = parseFloat(cs.fontSize);
      out.sizes.add(Math.round(size * 2) / 2);
      out.fams.add(cs.fontFamily.split(",")[0].replace(/["']/g, "").trim());
      if (size < 11) out.small.push(`${size}px "${(el.textContent ?? "").trim().slice(0, 20)}"`);
      if (cs.textTransform === "uppercase") out.caps++;
      if (Number(cs.fontWeight) >= 700) out.heavy++;
      if (cs.textShadow && cs.textShadow !== "none") out.shadows++;
      const fg = parse(cs.color);
      const bg = solidBehind(el);
      if (!fg || !bg) out.unknownC++;
      else {
        const c = ratio(fg, bg);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        if (c < (large ? 3 : 4.5) && fg.a > 0.5) out.lowC.push(`${c.toFixed(1)} "${(el.textContent ?? "").trim().slice(0, 18)}"`);
      }
    }
    const sides = ["Top", "Right", "Bottom", "Left"].filter((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none" && (parse(cs[`border${s}Color`])?.a ?? 0) > 0.08).length;
    if (sides >= 3 && r.width > 30 && r.height > 30) out.boxes++;
    if (cs.backgroundImage.includes("gradient")) out.grads++;
    if (cs.boxShadow && cs.boxShadow !== "none") out.shadows++;
    if (el.matches("button, a[href], input, [role=button], [role=tab], [role=switch]") && !el.disabled && (r.width < 44 || r.height < 44)) out.targets.push(`${Math.round(r.width)}x${Math.round(r.height)} ${id}`);
  }
  return {
    texts: out.texts,
    small: out.small,
    sizes: [...out.sizes].sort((a, b) => a - b),
    fams: [...out.fams],
    caps: out.caps,
    heavy: out.heavy,
    boxes: out.boxes,
    grads: out.grads,
    shadows: out.shadows,
    targets: out.targets,
    lowC: out.lowC,
    unknownC: out.unknownC,
    overflow: Math.max(0, document.documentElement.scrollWidth - vw),
  };
}

const outDir = process.env.OUT;
if (outDir) mkdirSync(outDir, { recursive: true });
const { browser, page, errors } = await openGame();
const rows = {};
await walkScreens(page, async (name) => {
  rows[name] = await page.evaluate(measure);
});
await browser.close();

const cols = ["text<11", "sizes", "fams", "caps", "heavy", "boxes", "grads", "shadows", "targets<44", "lowC", "unkC%", "overflow"];
const line = (name, v) => [name.padEnd(18), ...v.map((x) => String(x).padStart(10))].join("");
console.log(line("screen", cols));
const total = new Array(cols.length).fill(0);
for (const [name, r] of Object.entries(rows)) {
  const v = [r.small.length, r.sizes.length, r.fams.length, r.caps, r.heavy, r.boxes, r.grads, r.shadows, r.targets.length, r.lowC.length, r.texts ? Math.round((100 * r.unknownC) / r.texts) : 0, r.overflow];
  v.forEach((x, i) => (total[i] += x));
  console.log(line(name, v));
}
console.log(line("TOTAL", total));
console.log(`families seen: ${[...new Set(Object.values(rows).flatMap((r) => r.fams))].join(", ")}`);
console.log(`page errors: ${errors.length}`);
if (outDir) writeFileSync(`${outDir}/design-audit.json`, JSON.stringify({ viewport: [process.env.W ?? 390, process.env.H ?? 844], rows, total: Object.fromEntries(cols.map((c, i) => [c, total[i]])) }, null, 2));
