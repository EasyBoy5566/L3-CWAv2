// Liquid glass: refraction, the pointer light, the liquid segmented control,
// and the sky tint.
//
// Refraction: every element marked [data-refract] gets its own SVG filter,
// applied with `backdrop-filter: url(#id) blur() saturate()` (Chromium only;
// elsewhere the CSS blur alone remains). The glass is modelled as a slab
// whose edge rounds over in a squircle bezel. For each pixel of the bezel the
// surface slope gives, by Snell's law (n = 1.5), how far a ray from behind is
// bent; that becomes a displacement map. Red, green and blue are displaced by
// slightly different amounts, so the rim splits light a little the way thick
// glass does, and a second map adds the specular rim: bright where the bezel
// faces the light (top left), fainter on the opposite edge.

const SVG_NS = "http://www.w3.org/2000/svg";
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const reducedTransparency = matchMedia("(prefers-reduced-transparency: reduce)");
const chromium = Boolean(navigator.userAgentData?.brands?.some((b) => /Chromium/.test(b.brand)));

export const refractionEnabled = chromium && !reducedTransparency.matches;

let defs = null;
let nextId = 0;
const registry = new Map(); // element → { id, width, height }

function ensureDefs() {
  if (defs) return defs;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  defs = document.createElementNS(SVG_NS, "defs");
  svg.append(defs);
  document.body.append(svg);
  return defs;
}

// Signed distance from (px, py) to the edge of a w×h rounded rectangle; negative inside.
function roundedRectDistance(px, py, w, h, r) {
  const qx = Math.abs(px - w / 2) - (w / 2 - r);
  const qy = Math.abs(py - h / 2) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const IOR = 1.5;
// The bezel's height profile: a squircle, 0 at the rim rising to 1 inside.
const squircle = (x) => (1 - (1 - x) ** 4) ** 0.25;
// How far a vertical ray is bent where the bezel is at x (0 rim → 1 flat),
// relative to the most it is bent anywhere, from Snell's law.
const bend = (() => {
  const samples = 128;
  const values = [];
  for (let i = 0; i <= samples; i += 1) {
    const x = Math.min(Math.max(i / samples, 0.001), 0.999);
    const slope = (squircle(x + 0.001) - squircle(x - 0.001)) / 0.002;
    const incidence = Math.atan(slope);
    const refracted = Math.asin(Math.sin(incidence) / IOR);
    values.push(Math.tan(incidence - refracted) * (1 - squircle(x) * 0.6));
  }
  const max = Math.max(...values);
  return (x) => values[Math.round(Math.min(Math.max(x, 0), 1) * samples)] / max;
})();
const LIGHT = [-0.62, -0.78]; // from the top left

// The displacement map (red x, green y) and the specular map (white, alpha
// the highlight) for a w×h rounded rectangle, as canvases.
function glassMaps(width, height, radius, bezel) {
  const scale = 0.5; // half resolution is plenty; feImage stretches it back
  const cw = Math.max(2, Math.ceil(width * scale));
  const ch = Math.max(2, Math.ceil(height * scale));
  const make = () => {
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const context = canvas.getContext("2d");
    return { canvas, context, image: context.createImageData(cw, ch) };
  };
  const shift = make();
  const shine = make();
  const d = shift.image.data;
  const l = shine.image.data;
  const eps = 0.75;
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;
      const inside = -roundedRectDistance(px, py, width, height, radius);
      let dx = 0;
      let dy = 0;
      let highlight = 0;
      if (inside > 0 && inside < bezel) {
        // Outward normal from the distance field's gradient.
        const gx = roundedRectDistance(px + eps, py, width, height, radius) - roundedRectDistance(px - eps, py, width, height, radius);
        const gy = roundedRectDistance(px, py + eps, width, height, radius) - roundedRectDistance(px, py - eps, width, height, radius);
        const length = Math.hypot(gx, gy) || 1;
        const nx = gx / length;
        const ny = gy / length;
        const t = inside / bezel;
        const strength = bend(t);
        // Sample from further inside: the rim magnifies what lies under the glass.
        dx = -nx * strength;
        dy = -ny * strength;
        const facing = nx * LIGHT[0] + ny * LIGHT[1];
        const rim = (1 - t) ** 2.4;
        highlight = rim * (Math.max(facing, 0) ** 1.4 + 0.4 * Math.max(-facing, 0) ** 1.6);
      }
      const i = (y * cw + x) * 4;
      d[i] = 128 + dx * 127;
      d[i + 1] = 128 + dy * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
      l[i] = l[i + 1] = l[i + 2] = 255;
      l[i + 3] = Math.min(255, highlight * 235);
    }
  }
  shift.context.putImageData(shift.image, 0, 0);
  shine.context.putImageData(shine.image, 0, 0);
  return { displacement: shift.canvas, specular: shine.canvas };
}

function build(element) {
  const rect = element.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  if (width < 4 || height < 4) return;
  const entry = registry.get(element);
  if (entry.width === width && entry.height === height) return;
  entry.width = width;
  entry.height = height;

  const style = getComputedStyle(element);
  const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, width / 2, height / 2);
  const bezel = Number(element.dataset.bezel || Math.min(30, Math.max(12, Math.min(width, height) * 0.28)));
  const strength = (Number(element.dataset.refract || 0) || 56) * 1.25;
  const blur = style.getPropertyValue("--glass-blur").trim() || "14px";

  let filter = defs.querySelector(`#${entry.id}`);
  if (!filter) {
    filter = document.createElementNS(SVG_NS, "filter");
    filter.id = entry.id;
    filter.setAttribute("color-interpolation-filters", "sRGB");
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("primitiveUnits", "userSpaceOnUse");
    // Each colour is displaced on its own and the three screened back
    // together; then the specular rim is screened over the result.
    const channel = (name, matrix) => `
      <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" data-spread="${name}"/>
      <feColorMatrix type="matrix" values="${matrix}" result="${name}"/>`;
    filter.innerHTML = `
      <feImage result="map" preserveAspectRatio="none" x="0" y="0"/>
      ${channel("r", "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0")}
      ${channel("g", "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0")}
      ${channel("b", "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0")}
      <feBlend in="r" in2="g" mode="screen" result="rg"/>
      <feBlend in="rg" in2="b" mode="screen" result="refracted"/>
      <feImage result="shine" preserveAspectRatio="none" x="0" y="0"/>
      <feBlend in="shine" in2="refracted" mode="screen"/>`;
    defs.append(filter);
  }
  // The maps are PNG-encoded off the main thread (toBlob, not toDataURL,
  // which took ~300 ms on the main thread for a panel). The filter changes
  // only once both are ready, so it never runs with a missing map.
  const version = (entry.version ?? 0) + 1;
  entry.version = version;
  const maps = glassMaps(width, height, radius, bezel);
  return Promise.all([maps.displacement, maps.specular].map(blobUrl)).then(([displacement, specular]) => {
    if (entry.version !== version || !element.isConnected) {
      URL.revokeObjectURL(displacement);
      URL.revokeObjectURL(specular);
      return;
    }
    for (const [name, value] of [["x", 0], ["y", 0], ["width", width], ["height", height]]) filter.setAttribute(name, value);
    const [map, shine] = filter.querySelectorAll("feImage");
    for (const [image, href] of [[map, displacement], [shine, specular]]) {
      image.setAttribute("width", width);
      image.setAttribute("height", height);
      image.setAttribute("href", href);
    }
    // Red bends least and blue most, as in glass; the spread is a few percent.
    const spread = { r: 0.94, g: 1, b: 1.07 };
    for (const node of filter.querySelectorAll("feDisplacementMap")) node.setAttribute("scale", strength * spread[node.dataset.spread]);
    for (const url of entry.urls ?? []) URL.revokeObjectURL(url);
    entry.urls = [displacement, specular];
    element.style.backdropFilter = `url(#${entry.id}) blur(${blur}) saturate(190%) brightness(1.06)`;
  }, () => {});
}

const blobUrl = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("toBlob failed"))), "image/png");
});

const pending = new Set();
let frame = 0;
function schedule(element) {
  pending.add(element);
  if (frame) return;
  // Wait for layout to settle (panels resize as their content loads).
  frame = setTimeout(() => {
    frame = 0;
    // An element mid-morph is rebuilt by refractNow() once it has its final size.
    for (const item of pending) if (item.isConnected && !item.classList.contains("morphing")) build(item);
    pending.clear();
  }, 120);
}

const observer = refractionEnabled
  ? new ResizeObserver((entries) => entries.forEach((entry) => schedule(entry.target)))
  : null;

/** Give an element (and any [data-refract] inside it) liquid refraction. */
export function refract(root = document) {
  if (!refractionEnabled) return;
  ensureDefs();
  const elements = root.matches?.("[data-refract]") ? [root] : [];
  elements.push(...root.querySelectorAll("[data-refract]"));
  for (const element of elements) {
    if (registry.has(element)) continue;
    nextId += 1;
    registry.set(element, { id: `liquid-glass-${nextId}`, width: 0, height: 0 });
    observer.observe(element);
    schedule(element);
  }
}

/** Rebuild one element's refraction for its size now; resolves once it is applied. */
export async function refractNow(element) {
  const entry = registry.get(element);
  if (!refractionEnabled || !entry) return;
  entry.width = 0;
  await build(element);
}

/** Rebuild after a style change that alters blur (the sky tint does). */
export function refreshRefraction() {
  if (!refractionEnabled) return;
  for (const [element, entry] of registry) {
    if (!element.isConnected) {
      for (const url of entry.urls ?? []) URL.revokeObjectURL(url);
      defs.querySelector(`#${entry.id}`)?.remove();
      registry.delete(element);
      continue;
    }
    entry.width = 0;
    schedule(element);
  }
}

// ---------------------------------------------------------------------------
// Pointer light. The glass under the pointer catches it on its rim, brightest
// nearest the pointer (the CSS reads --lx, --ly and --light, see .glass::before).

let lit = null;
let pointer = null;
let lightFrame = 0;
function moveLight() {
  lightFrame = 0;
  const glass = pointer?.target instanceof Element ? pointer.target.closest(".glass") : null;
  if (lit && lit !== glass) lit.style.setProperty("--light", "0");
  lit = glass;
  if (!glass) return;
  const rect = glass.getBoundingClientRect();
  glass.style.setProperty("--lx", `${pointer.clientX - rect.left}px`);
  glass.style.setProperty("--ly", `${pointer.clientY - rect.top}px`);
  glass.style.setProperty("--light", "1");
}
if (!reducedMotion.matches && matchMedia("(hover: hover)").matches) {
  document.addEventListener("pointermove", (event) => {
    pointer = event;
    if (!lightFrame) lightFrame = requestAnimationFrame(moveLight);
  }, { passive: true });
  document.addEventListener("pointerleave", () => {
    pointer = null;
    moveLight();
  });
}

// The springs the CSS uses (--spring, --spring-soft), for animations started
// from script; browsers without linear() easing get a plain ease-out.
export const springEasing = (name = "spring") => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();
  return value && CSS.supports("transition-timing-function", value) ? value : "cubic-bezier(.3, .7, .2, 1)";
};

/**
 * Show or hide an item in a row without shoving its neighbours: its width,
 * padding and the gap before it grow from nothing on a spring (or shrink
 * away), so the items beside it glide over instead of jumping.
 */
export function revealInline(element, show) {
  const shown = !element.hidden && !element.dataset.leaving;
  if (show === shown) return;
  for (const animation of element.getAnimations()) animation.cancel();
  delete element.dataset.leaving;
  if (reducedMotion.matches) {
    element.hidden = !show;
    return;
  }
  element.hidden = false;
  const style = getComputedStyle(element);
  const gap = parseFloat(getComputedStyle(element.parentElement).columnGap) || 0;
  const open = {
    width: `${element.offsetWidth}px`, paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
    borderWidth: style.borderTopWidth, marginLeft: "0px", opacity: 1, transform: "scale(1)",
  };
  const closed = {
    width: "0px", paddingLeft: "0px", paddingRight: "0px", borderWidth: "0px",
    marginLeft: `${-gap}px`, opacity: 0, transform: "scale(0.6)",
  };
  element.style.overflow = "hidden";
  const done = () => { element.style.overflow = ""; };
  if (show) {
    element.animate([closed, open], { duration: 620, easing: springEasing("spring-soft") }).finished.then(done, () => {});
    return;
  }
  element.dataset.leaving = "1";
  element.animate([open, closed], { duration: 340, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "forwards" }).finished.then(() => {
    element.hidden = true;
    delete element.dataset.leaving;
    for (const animation of element.getAnimations()) animation.cancel();
    done();
  }, () => {});
}

// ---------------------------------------------------------------------------
// Liquid segmented control. The highlight stretches across the old and new
// choice, then settles on the new one, like a drop of liquid moving over.

export class Segmented {
  constructor(root, { onChange, attribute = "aria-checked" } = {}) {
    this.root = root;
    this.attribute = attribute;
    this.onChange = onChange;
    this.root.classList.add("segmented");
    this.pill = document.createElement("span");
    this.pill.className = "segmented-pill";
    this.pill.setAttribute("aria-hidden", "true");
    this.root.prepend(this.pill);
    this.current = this.buttons().find((b) => b.getAttribute(attribute) === "true") ?? this.buttons()[0];
    this.root.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button || button.disabled || button === this.current) return;
      this.select(button);
      this.onChange?.(button.dataset.value, button);
    });
    new ResizeObserver(() => this.place(false)).observe(this.root);
    requestAnimationFrame(() => this.place(false));
  }

  buttons() {
    return [...this.root.querySelectorAll("button")];
  }

  select(button, animate = true) {
    for (const b of this.buttons()) b.setAttribute(this.attribute, String(b === button));
    const previous = this.geometry;
    this.current = button;
    this.place(animate, previous);
  }

  place(animate, previous = this.geometry) {
    if (!this.current) return;
    const root = this.root.getBoundingClientRect();
    const box = this.current.getBoundingClientRect();
    const next = { x: box.left - root.left, y: box.top - root.top, w: box.width, h: box.height };
    this.geometry = next;
    const at = (g, squash = 1) => ({ transform: `translate(${g.x}px, ${g.y}px) scaleY(${squash})`, width: `${g.w}px`, height: `${g.h}px` });
    Object.assign(this.pill.style, at(next));
    if (!animate || !previous || reducedMotion.matches || previous.y !== next.y) return;
    const left = Math.min(previous.x, next.x);
    const right = Math.max(previous.x + previous.w, next.x + next.w);
    // Stretch across both choices, squashed like a drop, then spring onto the new one.
    this.pill.animate(
      [at(previous), { ...at({ x: left, y: next.y, w: right - left, h: next.h }, 0.78), offset: 0.4 }, at(next)],
      { duration: 620, easing: springEasing() },
    );
  }
}

// ---------------------------------------------------------------------------
// Sky state from the sun's elevation over Taiwan, for the glass tint.

const RAD = Math.PI / 180;

export function sunElevation(date, lat = 23.7, lon = 121) {
  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const hourAngle = ((gmst * 15 + lon - ra) % 360) * RAD;
  return Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(hourAngle)) / RAD;
}

export function skyFor(date) {
  const elevation = sunElevation(date);
  if (elevation > 6) return "day";
  if (elevation > -6) return "dusk";
  return "night";
}

export function setSky(date = new Date()) {
  const sky = skyFor(date);
  if (document.body.dataset.sky !== sky) {
    document.body.dataset.sky = sky;
    refreshRefraction();
  }
  return sky;
}

export const prefersReducedMotion = () => reducedMotion.matches;

// ---------------------------------------------------------------------------
// Glass select. A native <select> cannot be styled when open and shows the
// platform's scrollbar, so it is kept hidden as the source of truth (value,
// options, disabled, the change event) and drawn as a glass trigger and a
// glass menu. Callers that change the select in code call sync().
//
// The menu lives on <body>, positioned against its trigger: an element with
// a backdrop filter only blurs what is inside its nearest glass ancestor, so
// a menu inside the controls card would lose its blur where it hangs over
// the map.

let openSelect = null;
document.addEventListener("pointerdown", (event) => {
  if (openSelect && !openSelect.root.contains(event.target) && !openSelect.menu.contains(event.target)) openSelect.close();
});
window.addEventListener("resize", () => openSelect?.close());

export class GlassSelect {
  constructor(select, { columns = 1, placeholder = "" } = {}) {
    this.select = select;
    this.columns = columns;
    this.placeholder = placeholder;
    this.root = document.createElement("div");
    this.root.className = "gselect";
    select.after(this.root);
    select.classList.add("gselect-native");
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    this.trigger = document.createElement("button");
    this.trigger.type = "button";
    this.trigger.className = "gselect-trigger";
    this.trigger.setAttribute("aria-haspopup", "listbox");
    this.trigger.setAttribute("aria-expanded", "false");
    const label = select.getAttribute("aria-label") || select.closest("label")?.querySelector(".control-title")?.textContent;
    if (label) this.trigger.setAttribute("aria-label", label);
    this.menu = document.createElement("ul");
    this.menu.className = "gselect-menu glass";
    this.menu.setAttribute("role", "listbox");
    this.menu.style.setProperty("--columns", columns);
    this.menu.hidden = true;
    this.root.append(this.trigger);
    document.body.append(this.menu);

    this.trigger.addEventListener("click", () => (this.isOpen ? this.close() : this.open()));
    this.trigger.addEventListener("keydown", (event) => this.onKey(event));
    this.menu.addEventListener("keydown", (event) => this.onKey(event));
    this.menu.addEventListener("click", (event) => {
      const item = event.target.closest("li[data-value]");
      if (item) this.choose(item.dataset.value);
    });
    this.sync();
  }

  get isOpen() {
    return !this.menu.hidden;
  }

  options() {
    return [...this.select.options].filter((o) => o.value !== "");
  }

  sync() {
    const current = this.select.selectedOptions[0];
    const text = current && current.value !== "" ? current.textContent : this.placeholder || current?.textContent || "";
    this.trigger.innerHTML = `<span class="gselect-value">${text}</span><svg class="gselect-chevron" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    this.trigger.classList.toggle("empty", !current || current.value === "");
    this.trigger.disabled = this.select.disabled;
    this.root.classList.toggle("disabled", this.select.disabled);
    this.menu.innerHTML = this.options().map((o) =>
      `<li role="option" tabindex="-1" data-value="${o.value}" aria-selected="${o.value === this.select.value}">${o.textContent}</li>`).join("");
    if (this.select.disabled && this.isOpen) this.close();
  }

  open() {
    if (this.select.disabled) return;
    openSelect?.close();
    openSelect = this;
    this.sync();
    // Open upward when there is not enough room below.
    const rect = this.trigger.getBoundingClientRect();
    const up = window.innerHeight - rect.bottom < 280 && rect.top > window.innerHeight / 2;
    this.menu.classList.toggle("up", up);
    Object.assign(this.menu.style, {
      minWidth: `${rect.width}px`,
      left: `${rect.left}px`,
      top: up ? "auto" : `${rect.bottom + 8}px`,
      bottom: up ? `${window.innerHeight - rect.top + 10}px` : "auto",
    });
    this.menu.hidden = false;
    // Keep it on screen when the trigger sits near the right edge.
    const overflow = this.menu.getBoundingClientRect().right - (window.innerWidth - 12);
    if (overflow > 0) this.menu.style.left = `${rect.left - overflow}px`;
    this.root.classList.add("open");
    this.trigger.setAttribute("aria-expanded", "true");
    refract(this.menu);
    const selected = this.menu.querySelector('[aria-selected="true"]') ?? this.menu.querySelector("li");
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView({ block: "nearest" });
    if (!reducedMotion.matches) {
      this.menu.animate(
        [
          { opacity: 0, transform: "scale(0.86, 0.74)", filter: "blur(4px)" },
          { opacity: 1, transform: "scale(1)", filter: "blur(0)" },
        ],
        { duration: 560, easing: springEasing() },
      );
    }
  }

  close({ focus = false } = {}) {
    if (!this.isOpen) return;
    this.menu.hidden = true;
    this.root.classList.remove("open");
    this.trigger.setAttribute("aria-expanded", "false");
    if (openSelect === this) openSelect = null;
    if (focus) this.trigger.focus();
  }

  choose(value) {
    this.close({ focus: true });
    if (value === this.select.value) return;
    this.select.value = value;
    this.sync();
    this.select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  onKey(event) {
    const items = [...this.menu.querySelectorAll("li")];
    const index = items.indexOf(document.activeElement);
    const move = (delta) => {
      event.preventDefault();
      if (!this.isOpen) return this.open();
      const next = items[Math.min(Math.max((index < 0 ? 0 : index + delta), 0), items.length - 1)];
      next?.focus();
      next?.scrollIntoView({ block: "nearest" });
    };
    switch (event.key) {
      case "ArrowDown": return move(this.columns);
      case "ArrowUp": return move(-this.columns);
      case "ArrowRight": return this.isOpen ? move(1) : undefined;
      case "ArrowLeft": return this.isOpen ? move(-1) : undefined;
      case "Enter":
      case " ":
        event.preventDefault();
        if (this.isOpen && index >= 0) this.choose(items[index].dataset.value);
        else if (!this.isOpen) this.open();
        return undefined;
      case "Escape":
        if (this.isOpen) {
          event.preventDefault();
          event.stopPropagation();
          this.close({ focus: true });
        }
        return undefined;
      case "Tab":
        this.close();
        return undefined;
      default:
        return undefined;
    }
  }
}
