// Cards that can be picked up and moved: the controls, the weather cards and
// the typhoon card. A card follows the pointer from its grip, pulls against a
// soft resistance past the screen's edge, and on release springs to where it
// was put: back inside the screen, and against an edge when dropped near
// one. A double click on the grip sends it home. Where each card was left is
// remembered in this browser.
import { prefersReducedMotion, springEasing } from "./glass.js";

const MARGIN = 12; // px kept clear at the screen's sides
const BOTTOM = 16; // and at its foot, as the cards sit by default
const SNAP = 72; // px from an edge within which a dropped card goes to it
const THRESHOLD = 5; // px a press moves before it is a drag rather than a click
const STRETCH = 64; // the most a card goes past an edge while held
// Big enough screens only; a phone's cards have nowhere to go.
const roomy = matchMedia("(min-width: 720px)");

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// Past a limit the card moves less and less, up to STRETCH.
const resist = (value, min, max) => {
  if (value < min) return min - STRETCH * (1 - Math.exp((value - min) / (STRETCH * 2)));
  if (value > max) return max + STRETCH * (1 - Math.exp((max - value) / (STRETCH * 2)));
  return value;
};
const topBound = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--top")) || 76;

export class Draggable {
  /**
   * element: what moves. handles: a selector for what it is picked up by.
   * axis: "xy", or "x" for a card as tall as the screen. base: a transform
   * the element already has, kept in front of the offset.
   */
  constructor(element, { key, handles, axis = "xy", base = "" }) {
    this.element = element;
    this.key = `card-offset:${key}`;
    this.handles = handles;
    this.axis = axis;
    this.base = base;
    this.offset = this.load();
    this.apply(this.offset);
    element.addEventListener("pointerdown", (event) => this.down(event));
    element.addEventListener("dblclick", (event) => {
      if (event.target.closest(".grabber")) this.moveTo({ x: 0, y: 0 });
    });
    // A new screen size, or the card growing (the controls unfold), may push
    // it past an edge: it is brought back in.
    window.addEventListener("resize", () => this.settle(false));
    new ResizeObserver(() => this.settle(false)).observe(element);
    roomy.addEventListener("change", () => this.settle(false));
    element.addEventListener("transitionend", (event) => { if (event.target === element) this.settle(false); });
    element.addEventListener("animationend", (event) => { if (event.target === element) this.settle(false); });
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(this.key));
      if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) return saved;
    } catch {
      // Storage may be unavailable; the card starts at home.
    }
    return { x: 0, y: 0 };
  }

  save() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.offset));
    } catch {
      // Not remembered this time.
    }
  }

  transform({ x, y }) {
    return `${this.base} translate(${x}px, ${y}px)`.trim();
  }

  apply(offset) {
    this.element.style.transform = this.transform(offset);
  }

  // The offsets that keep the card on screen, from where it sits now.
  limits() {
    const rect = this.element.getBoundingClientRect();
    const home = { left: rect.left - this.offset.x, top: rect.top - this.offset.y, right: rect.right - this.offset.x, bottom: rect.bottom - this.offset.y };
    const minX = MARGIN - home.left;
    const maxX = Math.max(minX, innerWidth - MARGIN - home.right);
    const minY = topBound() - home.top;
    const maxY = Math.max(minY, innerHeight - BOTTOM - home.bottom);
    return { minX, maxX, minY, maxY, empty: rect.width === 0 };
  }

  down(event) {
    if (event.button !== 0 || !roomy.matches) return;
    const handle = event.target.closest(this.handles);
    if (!handle || !this.element.contains(handle)) return;
    // A button inside the grip still works as a button.
    const control = event.target.closest("button, a, input, select, textarea");
    if (control && control !== handle) return;
    this.animation?.cancel();
    const start = { x: event.clientX, y: event.clientY, from: { ...this.offset }, moved: false, limits: this.limits() };
    handle.setPointerCapture(event.pointerId);

    const move = (e) => {
      let dx = e.clientX - start.x;
      const dy = this.axis === "x" ? 0 : e.clientY - start.y;
      if (!start.moved) {
        if (Math.hypot(dx, dy) < THRESHOLD) return;
        start.moved = true;
        this.element.classList.add("dragging");
      }
      if (this.axis === "y") dx = 0;
      const { minX, maxX, minY, maxY } = start.limits;
      this.offset = { x: resist(start.from.x + dx, minX, maxX), y: resist(start.from.y + dy, minY, maxY) };
      this.apply(this.offset);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      if (!start.moved) return; // a click
      this.element.classList.remove("dragging");
      // The click that ends a drag is not a click on the grip.
      const swallow = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      handle.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => handle.removeEventListener("click", swallow, { capture: true }), 60);
      this.settle(true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  /** Bring the card inside the screen, against an edge if it is near one. */
  settle(animate) {
    if (this.element.classList.contains("dragging")) return;
    if (!roomy.matches) {
      this.element.style.transform = this.base;
      return;
    }
    // Measured while still: not mid-spring, mid-transition or while hidden;
    // each of those settles again when it ends.
    if (this.element.getAnimations().some((a) => a.playState === "running")) return;
    const { minX, maxX, minY, maxY, empty } = this.limits();
    if (empty) return;
    let x = clamp(this.offset.x, minX, maxX);
    let y = clamp(this.offset.y, minY, maxY);
    if (x - minX < SNAP) x = minX;
    else if (maxX - x < SNAP) x = maxX;
    if (this.axis !== "x") {
      if (y - minY < SNAP) y = minY;
      else if (maxY - y < SNAP) y = maxY;
    }
    // Home is where the page puts the card; a card close to it goes back there.
    if (Math.hypot(x, y) < SNAP / 2 && x >= minX && x <= maxX && y >= minY && y <= maxY) x = y = 0;
    this.moveTo({ x, y }, animate);
  }

  moveTo(offset, animate = true) {
    const from = this.offset;
    this.offset = offset;
    this.apply(offset);
    this.save();
    if (!animate || prefersReducedMotion() || (from.x === offset.x && from.y === offset.y)) return;
    this.animation = this.element.animate(
      [{ transform: this.transform(from) }, { transform: this.transform(offset) }],
      { duration: 700, easing: springEasing() },
    );
  }
}
