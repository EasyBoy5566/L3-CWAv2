// Liquid glass: refraction, the liquid segmented control, and the sky tint.
//
// Refraction: every element marked [data-refract] gets its own SVG filter.
// A canvas draws a displacement map for the element's exact size and corner
// radius: flat (no shift) in the middle, bending the backdrop toward the
// centre inside a bezel along the edges, the way a thick lens does. The
// filter is applied with `backdrop-filter: url(#id) blur() saturate()`,
// which only Chromium supports; elsewhere the CSS blur alone remains.

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

function displacementMap(width, height, radius, bezel) {
  const scale = 0.5; // half resolution is plenty; feImage stretches it back
  const cw = Math.max(2, Math.ceil(width * scale));
  const ch = Math.max(2, Math.ceil(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const context = canvas.getContext("2d");
  const image = context.createImageData(cw, ch);
  const data = image.data;
  const eps = 0.75;
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      const px = (x + 0.5) / scale;
      const py = (y + 0.5) / scale;
      const inside = -roundedRectDistance(px, py, width, height, radius);
      let dx = 0;
      let dy = 0;
      if (inside > 0 && inside < bezel) {
        // Outward normal from the distance field's gradient.
        const gx = roundedRectDistance(px + eps, py, width, height, radius) - roundedRectDistance(px - eps, py, width, height, radius);
        const gy = roundedRectDistance(px, py + eps, width, height, radius) - roundedRectDistance(px, py - eps, width, height, radius);
        const length = Math.hypot(gx, gy) || 1;
        // A convex (squircle-like) profile: strongest right at the rim.
        const t = 1 - inside / bezel;
        const strength = t * t * (3 - 2 * t);
        // Sample from further inside, so content near the rim is pulled outward.
        dx = -(gx / length) * strength;
        dy = -(gy / length) * strength;
      }
      const i = (y * cw + x) * 4;
      data[i] = 128 + dx * 127;
      data[i + 1] = 128 + dy * 127;
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
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
  const bezel = Number(element.dataset.bezel || Math.min(22, Math.max(10, Math.min(width, height) * 0.22)));
  const strength = Number(element.dataset.refract || 0) || 56;
  const blur = style.getPropertyValue("--glass-blur").trim() || "14px";

  let filter = defs.querySelector(`#${entry.id}`);
  if (!filter) {
    filter = document.createElementNS(SVG_NS, "filter");
    filter.id = entry.id;
    filter.setAttribute("color-interpolation-filters", "sRGB");
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("primitiveUnits", "userSpaceOnUse");
    filter.innerHTML = `
      <feImage result="map" preserveAspectRatio="none" x="0" y="0"/>
      <feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G"/>`;
    defs.append(filter);
  }
  for (const [name, value] of [["x", 0], ["y", 0], ["width", width], ["height", height]]) filter.setAttribute(name, value);
  const map = filter.querySelector("feImage");
  map.setAttribute("width", width);
  map.setAttribute("height", height);
  map.setAttribute("href", displacementMap(width, height, radius, bezel));
  filter.querySelector("feDisplacementMap").setAttribute("scale", strength);

  const value = `url(#${entry.id}) blur(${blur}) saturate(180%)`;
  element.style.backdropFilter = value;
}

const pending = new Set();
let frame = 0;
function schedule(element) {
  pending.add(element);
  if (frame) return;
  // Wait for layout to settle (panels resize as their content loads).
  frame = setTimeout(() => {
    frame = 0;
    for (const item of pending) if (item.isConnected) build(item);
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

/** Rebuild after a style change that alters blur (the sky tint does). */
export function refreshRefraction() {
  if (!refractionEnabled) return;
  for (const [element, entry] of registry) {
    if (!element.isConnected) {
      registry.delete(element);
      continue;
    }
    entry.width = 0;
    schedule(element);
  }
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
    this.pill.animate(
      [at(previous), { ...at({ x: left, y: next.y, w: right - left, h: next.h }, 0.82), offset: 0.45 }, at(next)],
      { duration: 460, easing: "cubic-bezier(.3, .7, .2, 1)" },
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
          { opacity: 0, transform: "scale(0.9, 0.82)", filter: "blur(4px)" },
          { opacity: 1, transform: "scale(1.02, 1.03)", filter: "blur(0)", offset: 0.7 },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: 320, easing: "cubic-bezier(.2, .8, .2, 1)" },
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
